"""Local append-only review history with conditional writes. No acceptance authority."""

import hashlib
import json
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from .table_review import ReviewProgress, validate_draft, validate_progress


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def checksum(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


class Conflict(ValueError):
    pass


class ReviewStore:
    def __init__(self, path: Path, root: Path):
        self.path, self.root = path.resolve(), root.resolve()
        if self.path.is_relative_to(self.root):
            raise ValueError("History database must be outside the served directory")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.packages = {}
        candidates = list(self.root.glob("packages/*/artifact.json"))
        candidates += list(self.root.glob("benchmarks/*/packages/*/artifact.json"))
        if len(candidates) > 500:
            raise ValueError("Review package registry exceeds local budget")
        for file in candidates:
            if file.is_symlink() or not file.resolve().is_relative_to(self.root):
                raise ValueError("Unsafe review package path")
            data = json.loads(file.read_text())
            run = data["run_id"]
            if run in self.packages:
                raise ValueError("Duplicate run in package registry")
            self.packages[run] = file.parent
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS revisions (
                  id TEXT PRIMARY KEY, binding_key TEXT NOT NULL, parent_id TEXT,
                  payload TEXT NOT NULL, created_at TEXT NOT NULL,
                  request_id TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
                  strict_valid INTEGER NOT NULL CHECK(strict_valid IN (0,1)));
                CREATE TABLE IF NOT EXISTS heads (binding_key TEXT PRIMARY KEY, revision_id TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS revisions_binding ON revisions(binding_key);
                CREATE TRIGGER IF NOT EXISTS revisions_no_update BEFORE UPDATE ON revisions
                  BEGIN SELECT RAISE(ABORT, 'review revisions are immutable'); END;
                CREATE TRIGGER IF NOT EXISTS revisions_no_delete BEFORE DELETE ON revisions
                  BEGIN SELECT RAISE(ABORT, 'review revisions are immutable'); END;
            """)
        self.path.chmod(0o600)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def validate(self, payload):
        if not isinstance(payload, dict):
            raise ValueError("Invalid review payload")
        nested = (
            payload.get("draft") if payload.get("state") == "UNFINISHED_TABLE_REVIEW" else payload
        )
        if not isinstance(nested, dict) or not isinstance(nested.get("binding"), dict):
            raise ValueError("Review binding required")
        package = self.packages.get(nested["binding"].get("run_id"))
        if not package:
            raise ValueError("Unknown source revision")
        if payload.get("state") == "UNFINISHED_TABLE_REVIEW":
            model, valid = validate_progress(package, payload)
        else:
            model = validate_draft(package, payload)
            valid = True
        value = model.model_dump()
        binding = model.draft.binding if isinstance(model, ReviewProgress) else model.binding
        return value, checksum(binding.model_dump()), valid

    @staticmethod
    def verify_record(row):
        record = dict(row)
        payload = json.loads(record["payload"])
        content = {
            k: record[k]
            for k in (
                "binding_key",
                "parent_id",
                "created_at",
                "request_id",
                "request_hash",
                "strict_valid",
            )
        }
        content["payload"] = payload
        if checksum(content) != record["id"]:
            raise ValueError("History revision checksum mismatch")
        record["payload"] = payload
        record["strict_valid"] = bool(record["strict_valid"])
        return record

    def chain(self, db, key):
        row = db.execute("SELECT revision_id FROM heads WHERE binding_key=?", (key,)).fetchone()
        head = row[0] if row else None
        revisions, seen, current = [], set(), head
        while current:
            if current in seen or len(seen) >= 1000:
                raise ValueError("Invalid or oversized review chain")
            seen.add(current)
            record = db.execute("SELECT * FROM revisions WHERE id=?", (current,)).fetchone()
            if not record or record["binding_key"] != key:
                raise ValueError("Broken review chain")
            value = self.verify_record(record)
            revisions.append(value)
            current = value["parent_id"]
        total = db.execute("SELECT count(*) FROM revisions WHERE binding_key=?", (key,)).fetchone()[
            0
        ]
        if total != len(revisions):
            raise ValueError("Orphaned or rolled-back review history")
        return head, revisions

    def history(self, key):
        if (
            not isinstance(key, str)
            or len(key) != 64
            or any(c not in "0123456789abcdef" for c in key)
        ):
            raise ValueError("Invalid review history key")
        with self.connect() as db:
            head, revisions = self.chain(db, key)
        return {"head_revision": head, "revisions": revisions, "publication_eligible": False}

    def save(self, payload, parent_id, request_id):
        if (
            not isinstance(request_id, str)
            or not 16 <= len(request_id) <= 100
            or not all(c.isalnum() or c == "-" for c in request_id)
        ):
            raise ValueError("Invalid idempotency key")
        if parent_id is not None and (not isinstance(parent_id, str) or len(parent_id) != 64):
            raise ValueError("Invalid parent revision")
        if self.path.stat().st_size + len(canonical(payload).encode()) > 100 * 1024**2:
            raise ValueError("Local history byte budget reached")
        value, key, valid = self.validate(payload)
        request_hash = checksum({"binding_key": key, "parent_id": parent_id, "payload": value})
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            head, revisions = self.chain(db, key)
            previous = db.execute(
                "SELECT * FROM revisions WHERE request_id=?", (request_id,)
            ).fetchone()
            if previous:
                record = self.verify_record(previous)
                if record["request_hash"] != request_hash:
                    raise Conflict("Retry key was reused for a different save")
                return {
                    "revision_id": record["id"],
                    "head_revision": head,
                    "binding_key": key,
                    "strict_draft_valid": record["strict_valid"],
                    "publication_eligible": False,
                }
            if parent_id != head:
                raise Conflict("A newer review exists. Load it before saving changes")
            if len(revisions) >= 999:
                raise ValueError("Local revision budget reached")
            record = {
                "binding_key": key,
                "parent_id": parent_id,
                "payload": value,
                "created_at": datetime.now(UTC).isoformat(),
                "request_id": request_id,
                "request_hash": request_hash,
                "strict_valid": int(valid),
            }
            revision = checksum(record)
            db.execute(
                "INSERT INTO revisions VALUES (?,?,?,?,?,?,?,?)",
                (
                    revision,
                    key,
                    parent_id,
                    canonical(value),
                    record["created_at"],
                    request_id,
                    request_hash,
                    int(valid),
                ),
            )
            db.execute(
                "INSERT INTO heads VALUES (?,?) ON CONFLICT(binding_key) DO UPDATE SET revision_id=excluded.revision_id",
                (key, revision),
            )
        return {
            "revision_id": revision,
            "head_revision": revision,
            "binding_key": key,
            "strict_draft_valid": valid,
            "publication_eligible": False,
        }

    def backup(self, output):
        if output.exists() or output.resolve().is_relative_to(self.root):
            raise ValueError("Use a new backup path outside the served directory")
        output.parent.mkdir(parents=True, exist_ok=True)
        # SQLite's backup API provides a consistent snapshot, rather than copying a live file.
        with self.connect() as source:
            for row in source.execute("SELECT binding_key FROM heads"):
                self.chain(source, row[0])
            with sqlite3.connect(output) as target:
                source.backup(target)
        output.chmod(0o600)
        return {
            "backup_sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
            "publication_eligible": False,
        }


def new_request_id():
    return secrets.token_hex(16)

import copy
import http.client
import json
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing

import pytest

from tax_pdf.benchmark import digest
from tax_pdf.fixtures import table_bytes
from tax_pdf.models import Artifact
from tax_pdf.review_server import make_server
from tax_pdf.review_store import Conflict, ReviewStore, new_request_id
from tax_pdf.runner import process
from tax_pdf.table_review import CellDraft, TableDraft, binding


@pytest.fixture
def history(tmp_path):
    root = tmp_path / "public"
    source = tmp_path / "table.pdf"
    source.write_bytes(table_bytes())
    package = process(source, root / "packages")
    artifact = Artifact.model_validate_json((package / "artifact.json").read_text())
    page, table = artifact.pages[0], artifact.pages[0].tables[0]
    payload = TableDraft(
        binding=binding(artifact, digest(package / "artifact.json"), page, table),
        cells=[CellDraft(id=c.id, disposition="unreviewed") for c in table.cells],
    ).model_dump()
    store = ReviewStore(tmp_path / "private/history.sqlite", root)
    return store, payload, package


def test_revisions_survive_restart_and_backup(history, tmp_path):
    store, payload, _ = history
    one = store.save(payload, None, new_request_id())
    updated = {**payload, "table_note": "Needs table review"}
    two = store.save(updated, one["revision_id"], new_request_id())
    restarted = ReviewStore(store.path, store.root)
    rows = restarted.history(one["binding_key"])["revisions"]
    assert [r["id"] for r in rows] == [two["revision_id"], one["revision_id"]]
    assert rows[0]["payload"]["table_note"] == "Needs table review"
    assert all(r["payload"]["publication_eligible"] is False for r in rows)
    backup = tmp_path / "backup/history.sqlite"
    assert store.backup(backup)["backup_sha256"] == digest(backup)
    assert ReviewStore(backup, store.root).history(one["binding_key"]) == restarted.history(
        one["binding_key"]
    )
    with pytest.raises(ValueError):
        store.backup(backup)


def test_stale_writes_conflict_and_retry_is_idempotent(history):
    store, payload, _ = history
    request = new_request_id()
    one = store.save(payload, None, request)
    assert store.save(payload, None, request) == one
    two = store.save({**payload, "table_note": "second"}, one["revision_id"], new_request_id())
    retry = store.save(payload, None, request)
    assert (
        retry["revision_id"] == one["revision_id"] and retry["head_revision"] == two["revision_id"]
    )
    with pytest.raises(Conflict):
        store.save({**payload, "table_note": "stale"}, one["revision_id"], new_request_id())
    with pytest.raises(Conflict):
        store.save({**payload, "table_note": "different retry"}, None, request)
    assert len(store.history(one["binding_key"])["revisions"]) == 2


def test_concurrent_writers_cannot_silently_overwrite(history):
    store, payload, _ = history

    def save(label):
        try:
            return store.save({**payload, "table_note": label}, None, new_request_id())
        except Conflict:
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(save, ["a", "b"]))
    assert results.count("conflict") == 1
    saved = next(r for r in results if isinstance(r, dict))
    assert len(store.history(saved["binding_key"])["revisions"]) == 1


def test_unfinished_progress_is_retained_without_becoming_a_strict_draft(history):
    store, payload, _ = history
    payload["cells"][0].update(disposition="text", text="")
    progress = {
        "schema_version": "0.1.0",
        "state": "UNFINISHED_TABLE_REVIEW",
        "publication_eligible": False,
        "draft": payload,
    }
    saved = store.save(progress, None, new_request_id())
    assert saved["strict_draft_valid"] is False
    assert store.history(saved["binding_key"])["revisions"][0]["payload"] == progress
    bad = copy.deepcopy(progress)
    bad["draft"]["binding"]["artifact_sha256"] = "a" * 64
    with pytest.raises(ValueError):
        store.save(bad, None, new_request_id())


def test_immutable_rows_and_tampered_history_are_detected(history):
    store, payload, _ = history
    saved = store.save(payload, None, new_request_id())
    with sqlite3.connect(store.path) as db:
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("UPDATE revisions SET payload='{}'")
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("DELETE FROM revisions")
        db.execute("DROP TRIGGER revisions_no_update")
        db.execute("UPDATE revisions SET payload='{}'")
    with pytest.raises(ValueError, match="checksum"):
        store.history(saved["binding_key"])


def test_head_rollback_is_detected(history):
    store, payload, _ = history
    one = store.save(payload, None, new_request_id())
    store.save({**payload, "table_note": "second"}, one["revision_id"], new_request_id())
    with sqlite3.connect(store.path) as db:
        db.execute("UPDATE heads SET revision_id=?", (one["revision_id"],))
    with pytest.raises(ValueError, match="rolled-back"):
        store.history(one["binding_key"])


def test_history_cannot_be_put_in_web_root_or_save_changed_source(history):
    store, payload, package = history
    with pytest.raises(ValueError):
        ReviewStore(store.root / "leaked.sqlite", store.root)
    (package / "pages/0001.png").write_bytes(b"tampered")
    with pytest.raises(ValueError, match="integrity"):
        store.save(payload, None, new_request_id())


def test_loopback_api_guards_and_conflicts(history):
    store, payload, _ = history
    server = make_server(store.root, store.path, 0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_port

    def request(method, path, body=None, headers=None):
        with closing(http.client.HTTPConnection("127.0.0.1", port, timeout=5)) as conn:
            conn.request(method, path, body, headers or {})
            response = conn.getresponse()
            return response.status, response.read()

    origin = f"http://127.0.0.1:{port}"
    headers = {"Origin": origin, "X-Lab-Review": "1", "Content-Type": "application/json"}
    try:
        assert request("GET", "/api/reviews/capabilities")[0] == 200
        assert (
            request("GET", "/api/reviews/capabilities", headers={"Host": "attacker.test"})[0] == 403
        )
        assert (
            request(
                "GET", "/api/reviews/capabilities", headers={"Origin": "https://attacker.test"}
            )[0]
            == 403
        )
        command = json.dumps(
            {"payload": payload, "parent_id": None, "request_id": new_request_id()}
        )
        assert (
            request("POST", "/api/reviews", command, {"Content-Type": "application/json"})[0] == 403
        )
        status, body = request("POST", "/api/reviews", command, headers)
        assert status == 201
        saved = json.loads(body)
        assert (
            request(
                "POST",
                "/api/reviews",
                json.dumps({"payload": payload, "parent_id": None, "request_id": new_request_id()}),
                headers,
            )[0]
            == 409
        )
        status, body = request("GET", "/api/reviews?key=" + saved["binding_key"])
        assert status == 200 and json.loads(body)["total_revisions"] == 1
        status, body = request(
            "GET", "/api/reviews?key=" + saved["binding_key"] + "&revision=" + saved["revision_id"]
        )
        assert status == 200 and json.loads(body)["revision"]["payload"] == payload
        assert request("GET", "/../private/history.sqlite")[0] == 404
        escaped = store.root / "linked-index"
        escaped.mkdir()
        (escaped / "index.html").symlink_to(store.path)
        assert request("GET", "/linked-index/")[0] == 404
        assert request("HEAD", "/api/reviews/capabilities")[0] == 405
        assert (
            request(
                "POST", "/api/reviews", "", {**headers, "Content-Length": str(5 * 1024**2 + 1)}
            )[0]
            == 413
        )
    finally:
        server.shutdown()
        server.server_close()
        thread.join()

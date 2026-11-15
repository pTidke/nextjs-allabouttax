"""Register two fixed local examples in an isolated, non-publishing directory."""

import json
import shutil
import sqlite3
import tempfile
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

from pypdf import PdfReader

from .benchmark import digest
from .models import Artifact
from .review_store import ReviewStore
from .runner import verify_package
from .staging import (
    ImportEnvelope,
    ObjectRef,
    RegisteredRun,
    RegisteredSource,
    Registry,
    ScopeRevision,
    TextProposal,
    validate_import,
)
from .staging_bundle import load_registry, write_registry
from .table_repair import source_evidence, validate_repair


def prepare_demo(root: Path, history: Path, plan_path: Path, output: Path):
    if (
        output.exists()
        or output.resolve().is_relative_to(root.resolve())
        or plan_path.stat().st_size > 1024**2
    ):
        raise ValueError("Use a fresh staging directory and bounded operator plan")
    plan = json.loads(plan_path.read_text())
    if plan.get("state") != "FIXED_STAGING_DEMONSTRATION_NOT_ACCEPTED":
        raise ValueError("Unsupported staging demonstration plan")
    if (
        len(plan.get("examples", [])) != 2
        or len({r["id"] for r in plan["examples"]}) != 2
        or {r["kind"] for r in plan["examples"]} != {"native_full_pages", "image_table_band"}
    ):
        raise ValueError("Exactly two scoped demonstration examples required")
    registry = Registry({}, {}, {})
    envelopes, receipts = {}, {}

    def put(raw):
        import hashlib

        sha = hashlib.sha256(raw).hexdigest()
        key = "o-" + sha
        registry.objects[key] = raw
        return ObjectRef(object_id=key, sha256=sha)

    artifacts = list(root.glob("packages/*/artifact.json"))
    artifacts += list(root.glob("benchmarks/*/packages/*/artifact.json"))
    if len(artifacts) > 500:
        raise ValueError("Local package inventory exceeds budget")
    for row in plan["examples"]:
        matches = [p for p in artifacts if p.parent.name == row["run_id"]]
        if len(matches) != 1 or digest(matches[0]) != row["artifact_sha256"]:
            raise ValueError("Operator plan does not bind one exact local package")
        package = matches[0].parent
        artifact = Artifact.model_validate_json(matches[0].read_bytes())
        checked = verify_package(artifact.model_copy(deep=True), package)
        if any(
            i.code in {"ORIGINAL_CHECKSUM_MISMATCH", "RENDER_CHECKSUM_MISMATCH", "RENDER_MISSING"}
            for i in checked.issues
        ):
            raise ValueError("Package evidence changed")
        count = len(PdfReader(package / "original.pdf").pages)
        if count != artifact.expected_pages or artifact.source_sha256 != row["source_sha256"]:
            raise ValueError("Original source/page count differs from fixed plan")
        original = put((package / "original.pdf").read_bytes())
        artifact_ref = put(matches[0].read_bytes())
        source = RegisteredSource(
            source_id=row["id"],
            original=original,
            page_count=count,
            byte_length=artifact.source_bytes,
            official_url=row["official_url"],
            registered_at=datetime.now(UTC).isoformat(),
        )
        renders = [
            {"page": p.number, "object": put((package / p.render).read_bytes())}
            for p in artifact.pages
            if p.render
        ]
        revision = ScopeRevision(
            run_id=artifact.run_id,
            source_sha256=original.sha256,
            artifact_sha256=artifact_ref.sha256,
            kind=row["kind"],
            pages=row["pages"],
            scope_note=row["scope_note"],
        )
        raw_refs, contexts, feedback, binding = [], [], [], None
        if row["kind"] == "native_full_pages":
            reference_path = plan_path.parent / row["reference_file"]
            if digest(reference_path) != row["reference_sha256"]:
                raise ValueError("Prior feedback revision changed")
            reference = json.loads(reference_path.read_text())
            if reference["source_sha256"] != original.sha256:
                raise ValueError("Feedback belongs to another original")
            feedback = [put(reference_path.read_bytes())]
            for page in artifact.pages:
                if page.number in row["pages"]:
                    for block in page.blocks:
                        text, note = block.raw_text, ""
                        if block.id == "p1-b1":
                            if "रािपत्र" not in text or "राजपत्र" not in reference["expected_text"]:
                                raise ValueError("Fixed Hindi header correction no longer matches")
                            text = text.replace("रािपत्र", "राजपत्र")
                            note = "Previously chat-confirmed header correction; feedback object retained. Imported as a draft, not authenticated acceptance."
                        revision.text.append(TextProposal(block_id=block.id, text=text, note=note))
        else:
            # Read only the exact historical record selected by the fixed plan.
            with closing(sqlite3.connect(history.resolve().as_uri() + "?mode=ro", uri=True)) as db:
                db.row_factory = sqlite3.Row
                saved = db.execute(
                    "SELECT * FROM revisions WHERE id=?", (row["history_revision"],)
                ).fetchone()
            if saved is None:
                raise ValueError("Fixed reconstruction history revision missing")
            record = ReviewStore.verify_record(saved)
            repair, _ = validate_repair(package, record["payload"])
            bound, _, _, _ = source_evidence(package, repair.binding.case_id)
            binding = bound.model_dump()
            revision.reconstruction = repair
            trial = package.parent.parent
            report = json.loads((trial / "scan-tables.json").read_text())
            for case in report["cases"]:
                if case["artifact_sha256"] == artifact_ref.sha256:
                    for attempt in case["attempts"]:
                        if attempt.get("raw"):
                            raw_refs.append(put((trial / attempt["raw"]).read_bytes()))
            contexts = [
                put((trial / "scan-tables.json").read_bytes()),
                put((trial / "files.json").read_bytes()),
            ]
            feedback = [put(json.dumps(record, ensure_ascii=False).encode())]
        revision.context_objects = contexts
        revision.prior_feedback = feedback
        # Reparse list entries before serializing: constructing a list is not validation.
        revision = ScopeRevision.model_validate(revision.model_dump())
        revision_ref = put(revision.model_dump_json().encode())
        run = RegisteredRun(
            source_id=source.source_id,
            run_id=artifact.run_id,
            artifact=artifact_ref,
            renders=renders,
            raw_outputs=raw_refs,
            revision=revision_ref,
            context_objects=contexts,
            prior_feedback=feedback,
            repair_binding=binding,
        )
        registry.sources[source.source_id] = source
        registry.runs[run.run_id] = run
        envelope = ImportEnvelope(
            source_id=source.source_id,
            run_id=run.run_id,
            original=original,
            artifact=artifact_ref,
            renders=run.renders,
            raw_outputs=run.raw_outputs,
            revision=revision_ref,
        )
        envelopes[row["id"]] = envelope.model_dump()
        receipts[row["id"]] = validate_import(envelope.model_dump(), registry)
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".staging-demo-", dir=output.parent))
    try:
        write_registry(registry, staging / "registry")
        loaded = load_registry(staging / "registry")
        for key, envelope in envelopes.items():
            if validate_import(envelope, loaded) != receipts[key]:
                raise ValueError("Staged evidence did not round-trip")
            (staging / (key + "-envelope.json")).write_text(json.dumps(envelope, indent=2) + "\n")
            (staging / (key + "-receipt.json")).write_text(
                json.dumps(receipts[key], indent=2) + "\n"
            )
        report = {
            "state": "ISOLATED_STAGING_DEMONSTRATION_NOT_ACCEPTED",
            "publication_eligible": False,
            "plan_sha256": digest(plan_path),
            "receipts": receipts,
            "registry_sha256": digest(staging / "registry/registry.json"),
            "objects": len(registry.objects),
            "retrieval_items_created": 0,
            "database_writes": 0,
            "authenticated_reviews_created": 0,
        }
        (staging / "demo.json").write_text(json.dumps(report, indent=2) + "\n")
        (staging / "files.json").write_text(
            json.dumps(
                {
                    str(p.relative_to(staging)): digest(p)
                    for p in sorted(staging.rglob("*"))
                    if p.is_file()
                },
                indent=2,
            )
            + "\n"
        )
        staging.rename(output)
    except BaseException:
        shutil.rmtree(staging)
        raise
    return report

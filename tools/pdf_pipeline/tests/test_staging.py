import copy
import hashlib
import json
from io import BytesIO

import pytest
from PIL import Image

from tax_pdf.models import Artifact, Block, Box, Page
from tax_pdf.review_store import checksum
from tax_pdf.staging import (
    ImportEnvelope,
    ObjectRef,
    RegisteredRun,
    RegisteredSource,
    Registry,
    ScopeRevision,
    object_bytes,
    validate_import,
)
from tax_pdf.staging_bundle import load_registry, write_registry


def encoded(value):
    return json.dumps(value, ensure_ascii=False).encode()


def register(registry, key, raw):
    registry.objects[key] = raw
    return ObjectRef(object_id=key, sha256=hashlib.sha256(raw).hexdigest())


def update_revision(registry, envelope, value):
    ref = register(registry, "revision", encoded(value))
    registry.runs[envelope["run_id"]].revision = ref
    envelope["revision"] = ref.model_dump()


@pytest.fixture
def clean():
    """Synthetic trusted-registration stand-ins, no PDF parser or outside service."""
    registry = Registry({}, {}, {})
    original = register(registry, "original", b"%PDF-1.4\nsynthetic registration fixture\n%%EOF")
    image = BytesIO()
    Image.new("RGB", (100, 100), "white").save(image, format="PNG")
    render = register(registry, "render-1", image.getvalue())
    artifact = Artifact(
        pipeline_version="test",
        run_id="run-1",
        created_at="2026-11-11T00:00:00Z",
        source_sha256=original.sha256,
        source_bytes=len(registry.objects["original"]),
        source_title="Synthetic source",
        engine_versions={"test": "1"},
        config={},
        fingerprint="test-fingerprint",
        expected_pages=1,
        pages=[
            Page(
                number=1,
                width=100,
                height=100,
                status="native_candidate",
                render="pages/0001.png",
                render_sha256=render.sha256,
                blocks=[
                    Block(
                        id="p1-b1",
                        kind="text_line",
                        raw_text="A😀B",
                        display_text="A😀B",
                        bbox=Box(x0=1, top=1, x1=50, bottom=15),
                        order=0,
                        source="native",
                    )
                ],
            )
        ],
    )
    artifact_ref = register(registry, "artifact", artifact.model_dump_json().encode())
    source = RegisteredSource(
        source_id="source-1",
        original=original,
        page_count=1,
        byte_length=len(registry.objects["original"]),
        official_url="https://www.incometax.gov.in/example.pdf",
        registered_at="2026-11-11T00:00:00Z",
    )
    revision = ScopeRevision(
        run_id=artifact.run_id,
        source_sha256=original.sha256,
        artifact_sha256=artifact_ref.sha256,
        kind="native_full_pages",
        pages=[1],
        scope_note="One complete synthetic page, no legal meaning or approval.",
        text=[{"block_id": "p1-b1", "text": "A😀B"}],
    )
    revision_ref = register(registry, "revision", revision.model_dump_json().encode())
    run = RegisteredRun(
        source_id=source.source_id,
        run_id=artifact.run_id,
        artifact=artifact_ref,
        revision=revision_ref,
        renders=[{"page": 1, "object": render}],
        raw_outputs=[],
    )
    registry.sources[source.source_id] = source
    registry.runs[run.run_id] = run
    envelope = ImportEnvelope(
        source_id=source.source_id,
        run_id=run.run_id,
        original=original,
        artifact=artifact_ref,
        revision=revision_ref,
        renders=run.renders,
        raw_outputs=[],
    ).model_dump()
    return registry, envelope


@pytest.fixture
def table(clean):
    registry, envelope = clean
    raw = {"tables": [{"data": {"table_cells": [{"text": "Amount Section"}]}}]}
    raw_ref = register(registry, "raw-ocr", encoded(raw))
    run = registry.runs[envelope["run_id"]]
    run.raw_outputs = [raw_ref]
    envelope["raw_outputs"] = [raw_ref.model_dump()]
    binding = {
        "run_id": run.run_id,
        "source_sha256": envelope["original"]["sha256"],
        "artifact_sha256": run.artifact.sha256,
        "render_sha256": run.renders[0].object.sha256,
        "trial_sha256": "a" * 64,
        "raw_sha256": raw_ref.sha256,
        "table_sha256": checksum(raw["tables"][0]),
        "page": 1,
        "case_id": "synthetic-table",
        "table_index": 0,
    }
    run.repair_binding = binding
    revision = json.loads(registry.objects["revision"])
    revision.update(
        kind="image_table_band",
        text=[],
        reconstruction={
            "binding": binding,
            "scope_note": "Only a blank entry band; context remains unreviewed.",
            "x": [0, 50, 100],
            "y": [20, 40],
            "cells": [
                {
                    "id": f"c{i}",
                    "row": 0,
                    "column": i,
                    "state": "blank",
                    "text": "",
                    "note": "Explicit fixture blank choice.",
                }
                for i in range(2)
            ],
        },
    )
    update_revision(registry, envelope, revision)
    return registry, envelope


def test_clean_draft_only_enters_review_without_side_effects(clean):
    registry, envelope = clean
    before = copy.deepcopy((registry, envelope))
    first = validate_import(envelope, registry)
    assert first == validate_import(envelope, registry)
    assert (registry, envelope) == before
    assert first["state"] == "AWAITING_EXTRACTION_REVIEW"
    assert first["blocking_holds"] == []
    assert first["whole_document_processed"]
    assert first["review_holds"] == [
        "AUTHENTICATED_EXTRACTION_REVIEW_REQUIRED",
        "RELEASE_REQUIRED",
        "TAX_REVIEW_REQUIRED",
    ]
    assert not first["extraction_accepted"] and not first["tax_approved"]
    assert first["retrieval_items_created"] == 0 and first["acceptance"] is None


def test_blank_table_stays_blocked_and_preserves_raw_text(table):
    registry, envelope = table
    before = copy.deepcopy(registry.objects)
    result = validate_import(envelope, registry)
    assert result["state"] == "BLOCKED"
    assert result["table_accounting"]["unresolved_cells"] == 0
    assert result["table_accounting"]["unplaced_characters"] == len("Amount Section")
    assert "TABLE_RAW_TEXT_UNPLACED" in result["blocking_holds"]
    assert "TABLE_CONTEXT_AND_STRUCTURE_UNREVIEWED" in result["blocking_holds"]
    assert not result["publication_eligible"] and result["retrieval_items_created"] == 0
    assert registry.objects == before
    states = json.loads(registry.objects["revision"])["reconstruction"]["cells"]
    assert all(c["state"] == "blank" and c["text"] == "" for c in states)


@pytest.mark.parametrize("key", ["original", "artifact", "revision"])
def test_request_cannot_substitute_registered_objects(clean, key):
    registry, envelope = clean
    envelope[key]["sha256"] = "b" * 64
    with pytest.raises(ValueError, match="Stale"):
        validate_import(envelope, registry)


@pytest.mark.parametrize("key", ["original", "artifact", "revision", "render-1"])
def test_changed_registered_bytes_are_rejected(clean, key):
    registry, envelope = clean
    registry.objects[key] += b"changed"
    with pytest.raises(ValueError, match="checksum|metadata"):
        validate_import(envelope, registry)


@pytest.mark.parametrize(
    "change",
    [
        {"source_id": "foreign"},
        {"run_id": "foreign"},
        {"publication_eligible": True},
        {"acceptance": {"reviewer": "self"}},
        {"tax_approved": True},
        {"original": {"object_id": "../../secret", "sha256": "a" * 64}},
    ],
)
def test_foreign_paths_ids_and_self_approval_are_rejected(clean, change):
    registry, envelope = clean
    envelope.update(change)
    with pytest.raises(ValueError):
        validate_import(envelope, registry)


def test_stale_parent_and_cross_source_run_are_rejected(clean):
    registry, envelope = clean
    registry.runs["run-1"].review_head_sha256 = "a" * 64
    with pytest.raises(ValueError, match="Stale"):
        validate_import(envelope, registry)
    envelope["expected_parent_sha256"] = "a" * 64
    validate_import(envelope, registry)
    registry.runs["run-1"].source_id = "foreign"
    with pytest.raises(ValueError, match="different source"):
        validate_import(envelope, registry)


def test_evidence_cannot_be_pruned_duplicated_or_relabelled(table):
    registry, envelope = table
    for key in ["renders", "raw_outputs"]:
        for replacement in [[], envelope[key] * 2]:
            bad = {**envelope, key: replacement}
            with pytest.raises(ValueError, match="inventory"):
                validate_import(bad, registry)
    bad = copy.deepcopy(envelope)
    bad["renders"][0]["page"] = 2
    with pytest.raises(ValueError, match="inventory"):
        validate_import(bad, registry)


@pytest.mark.parametrize(
    "text",
    [
        [],
        [{"block_id": "foreign", "text": "x"}],
        [{"block_id": "p1-b1", "text": "A😀B"}] * 2,
        [{"block_id": "p1-b1", "text": "changed"}],
    ],
)
def test_text_scope_inventory_and_explained_edits_are_required(clean, text):
    registry, envelope = clean
    revision = json.loads(registry.objects["revision"])
    revision["text"] = text
    update_revision(registry, envelope, revision)
    with pytest.raises(ValueError):
        validate_import(envelope, registry)


def test_explained_edit_remains_a_draft_and_keeps_raw_text(clean):
    registry, envelope = clean
    artifact = registry.objects["artifact"]
    revision = json.loads(registry.objects["revision"])
    revision["text"][0].update(
        text="A😀B corrected", note="Synthetic source comparison; no acceptance."
    )
    update_revision(registry, envelope, revision)
    assert validate_import(envelope, registry)["state"] == "AWAITING_EXTRACTION_REVIEW"
    assert registry.objects["artifact"] == artifact


def test_missing_page_manifest_rejects_even_with_claimed_complete_flags(clean):
    registry, envelope = clean
    registry.sources["source-1"].page_count = 2
    a = json.loads(registry.objects["artifact"])
    a.update(expected_pages=2, page_accounting_complete=True, processed_pages_complete=True)
    ref = register(registry, "artifact", encoded(a))
    registry.runs["run-1"].artifact = ref
    envelope["artifact"] = ref.model_dump()
    with pytest.raises(ValueError, match="Every original page"):
        validate_import(envelope, registry)


def test_unprocessed_context_page_stays_visible_and_blocks_required_scope(clean):
    registry, envelope = clean
    registry.sources["source-1"].page_count = 2
    a = json.loads(registry.objects["artifact"])
    a.update(expected_pages=2, page_accounting_complete=True, processed_pages_complete=True)
    a["pages"].append(
        {
            "number": 2,
            "width": 100,
            "height": 100,
            "status": "not_processed",
            "blocks": [
                {
                    "id": "p2-b1",
                    "kind": "text_line",
                    "raw_text": "condition",
                    "display_text": "condition",
                    "bbox": {"x0": 1, "top": 1, "x1": 50, "bottom": 10},
                    "order": 0,
                    "source": "native",
                }
            ],
        }
    )
    ref = register(registry, "artifact", encoded(a))
    registry.runs["run-1"].artifact = ref
    envelope["artifact"] = ref.model_dump()
    revision = json.loads(registry.objects["revision"])
    revision.update(artifact_sha256=ref.sha256, required_context_regions=["p2-b1"])
    update_revision(registry, envelope, revision)
    result = validate_import(envelope, registry)
    assert not result["whole_document_processed"] and result["original_pages"] == 2
    assert "REQUIRED_CONTEXT_OUTSIDE_SCOPE" in result["blocking_holds"]
    revision["required_context_regions"] = ["foreign"]
    update_revision(registry, envelope, revision)
    with pytest.raises(ValueError, match="Foreign required context"):
        validate_import(envelope, registry)


def test_registered_holds_and_context_dependencies_cannot_be_cleared(clean):
    registry, envelope = clean
    run = registry.runs["run-1"]
    run.holds = ["CRITICAL_CONDITION_UNREVIEWED"]
    context = register(registry, "context", b"immutable outside context")
    run.context_objects = [context]
    revision = json.loads(registry.objects["revision"])
    revision["context_objects"] = [context.model_dump()]
    update_revision(registry, envelope, revision)
    result = validate_import(envelope, registry)
    assert set(result["blocking_holds"]) == {
        "CRITICAL_CONDITION_UNREVIEWED",
        "CONTEXT_DEPENDENCIES_UNREVIEWED",
    }
    revision["context_objects"] = []
    update_revision(registry, envelope, revision)
    with pytest.raises(ValueError, match="inventory"):
        validate_import(envelope, registry)


@pytest.mark.parametrize(
    "change",
    [
        {"state": "ACCEPTED"},
        {"publication_eligible": True},
        {"acceptance": {"user": "self"}},
        {"run_id": "foreign"},
    ],
)
def test_revision_cannot_self_approve_or_switch_run(clean, change):
    registry, envelope = clean
    revision = json.loads(registry.objects["revision"])
    revision.update(change)
    update_revision(registry, envelope, revision)
    with pytest.raises(ValueError):
        validate_import(envelope, registry)


def test_table_blank_requires_note_and_raw_table_binding(table):
    registry, envelope = table
    revision = json.loads(registry.objects["revision"])
    revision["reconstruction"]["cells"][0]["note"] = ""
    update_revision(registry, envelope, revision)
    with pytest.raises(ValueError, match="blank requires"):
        validate_import(envelope, registry)
    revision["reconstruction"]["cells"][0]["note"] = "explicit blank"
    revision["reconstruction"]["binding"]["table_sha256"] = "c" * 64
    update_revision(registry, envelope, revision)
    with pytest.raises(ValueError, match="source revision"):
        validate_import(envelope, registry)


def test_local_object_adapter_roundtrips_and_rejects_tampering(clean, tmp_path):
    registry, envelope = clean
    root = tmp_path / "registry"
    write_registry(registry, root)
    loaded = load_registry(root)
    assert validate_import(envelope, loaded) == validate_import(envelope, registry)
    ref = envelope["original"]["sha256"]
    (root / "objects" / (ref + ".blob")).write_bytes(b"tampered")
    with pytest.raises(ValueError, match="changed"):
        load_registry(root)


def test_local_registry_never_resolves_client_paths(clean, tmp_path):
    registry, _ = clean
    root = tmp_path / "registry"
    write_registry(registry, root)
    descriptor = root / "registry.json"
    data = json.loads(descriptor.read_text())
    data["objects"]["original"] = "../secret"
    descriptor.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="identifier"):
        load_registry(root)


def test_missing_objects_and_small_byte_budget_hold(clean):
    registry, envelope = clean
    with pytest.raises(ValueError, match="budget"):
        object_bytes(registry.sources["source-1"].original, registry, budget=1)
    del registry.objects["render-1"]
    with pytest.raises(ValueError, match="missing"):
        validate_import(envelope, registry)


def test_prior_feedback_is_preserved_without_granting_review_authority(clean):
    registry, envelope = clean
    prior = register(
        registry, "prior-feedback", b'{"reviewer":"self-reported owner","confirmed":"one field"}'
    )
    registry.runs["run-1"].prior_feedback = [prior]
    revision = json.loads(registry.objects["revision"])
    revision["prior_feedback"] = [prior.model_dump()]
    update_revision(registry, envelope, revision)
    result = validate_import(envelope, registry)
    assert not result["extraction_accepted"] and not result["tax_approved"]
    assert "AUTHENTICATED_EXTRACTION_REVIEW_REQUIRED" in result["review_holds"]
    revision["prior_feedback"] = []
    update_revision(registry, envelope, revision)
    with pytest.raises(ValueError, match="inventory"):
        validate_import(envelope, registry)


def test_blank_zero_dash_and_unreadable_are_not_collapsed(table):
    registry, envelope = table
    revision = json.loads(registry.objects["revision"])
    repair = revision["reconstruction"]
    repair["x"] = [0, 25, 50, 75, 100]
    repair["cells"] = [
        {
            "id": "blank",
            "row": 0,
            "column": 0,
            "state": "blank",
            "text": "",
            "note": "Explicit blank.",
        },
        {
            "id": "zero",
            "row": 0,
            "column": 1,
            "state": "transcribed",
            "text": "0",
            "note": "Synthetic proposed zero, not accepted.",
        },
        {
            "id": "dash",
            "row": 0,
            "column": 2,
            "state": "transcribed",
            "text": "-",
            "note": "Synthetic proposed dash, not accepted.",
        },
        {"id": "unreadable", "row": 0, "column": 3, "state": "unreadable", "text": None},
    ]
    update_revision(registry, envelope, revision)
    result = validate_import(envelope, registry)
    assert "TABLE_CELLS_UNRESOLVED" in result["blocking_holds"]
    saved = json.loads(registry.objects["revision"])["reconstruction"]["cells"]
    assert [(c["state"], c["text"]) for c in saved] == [
        ("blank", ""),
        ("transcribed", "0"),
        ("transcribed", "-"),
        ("unreadable", None),
    ]


def test_matching_table_binding_still_rejects_changed_raw_table(table):
    registry, envelope = table
    raw = json.loads(registry.objects["raw-ocr"])
    raw["tables"][0]["data"]["table_cells"][0]["text"] = "altered condition"
    ref = register(registry, "raw-ocr", encoded(raw))
    run = registry.runs["run-1"]
    run.raw_outputs = [ref]
    run.repair_binding["raw_sha256"] = ref.sha256
    envelope["raw_outputs"] = [ref.model_dump()]
    revision = json.loads(registry.objects["revision"])
    revision["reconstruction"]["binding"]["raw_sha256"] = ref.sha256
    update_revision(registry, envelope, revision)
    with pytest.raises(ValueError, match="Raw table revision"):
        validate_import(envelope, registry)


def test_local_adapter_rejects_symlinked_objects(clean, tmp_path):
    registry, envelope = clean
    root = tmp_path / "registry"
    write_registry(registry, root)
    file = root / "objects" / (envelope["original"]["sha256"] + ".blob")
    outside = tmp_path / "outside"
    file.rename(outside)
    file.symlink_to(outside)
    with pytest.raises(ValueError, match="unsafe"):
        load_registry(root)


def test_schema_rejects_unknown_versions_and_fields(clean):
    registry, envelope = clean
    for patch in [
        {"schema_version": "2.0"},
        {"reviewer_id": "client-assigned"},
        {"path": "/tmp/client-file"},
    ]:
        with pytest.raises(ValueError):
            validate_import({**envelope, **patch}, registry)


def test_pure_validator_cannot_open_files_connect_databases_or_use_network(table, monkeypatch):
    import builtins
    import socket
    import sqlite3

    registry, envelope = table

    def forbidden(*args, **kwargs):
        raise AssertionError("The pure validation boundary attempted external I/O")

    monkeypatch.setattr(builtins, "open", forbidden)
    monkeypatch.setattr(sqlite3, "connect", forbidden)
    monkeypatch.setattr(socket, "create_connection", forbidden)
    assert validate_import(envelope, registry)["retrieval_items_created"] == 0


@pytest.mark.parametrize("fixture_name, expected_exit", [("clean", 0), ("table", 2)])
def test_cli_distinguishes_reviewable_and_blocked_drafts(
    request, fixture_name, expected_exit, tmp_path
):
    import subprocess
    import sys

    registry, envelope = request.getfixturevalue(fixture_name)
    root = tmp_path / "operator-registry"
    write_registry(registry, root)
    packet = tmp_path / "request.json"
    packet.write_text(json.dumps(envelope))
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "tax_pdf.cli",
            "validate-staging-import",
            "--registry",
            str(root),
            str(packet),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == expected_exit, result.stderr
    receipt = json.loads(result.stdout)
    assert not receipt["publication_eligible"] and receipt["retrieval_items_created"] == 0


def test_printed_text_cannot_be_removed_using_a_transcription_note(clean):
    registry, envelope = clean
    revision = json.loads(registry.objects["revision"])
    revision["text"][0].update(
        text="", note="Attempt to exclude printed text through a correction."
    )
    update_revision(registry, envelope, revision)
    with pytest.raises(ValueError, match="exclusion contract"):
        validate_import(envelope, registry)

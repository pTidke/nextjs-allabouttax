import copy
import json
import shutil

import pytest

from tax_pdf.benchmark import digest
from tax_pdf.fixtures import native_bytes
from tax_pdf.models import Artifact
from tax_pdf.review_store import Conflict, ReviewStore
from tax_pdf.runner import process
from tax_pdf.table_repair import RepairDraft, source_evidence, validate_layout, validate_repair


@pytest.fixture(scope="module")
def example(tmp_path_factory):
    root = tmp_path_factory.mktemp("repair")
    served = root / "served"
    trial = served / "benchmarks/image-trial"
    source = root / "source.pdf"
    source.write_bytes(native_bytes())
    package = process(source, trial / "packages")
    artifact = Artifact.model_validate_json((package / "artifact.json").read_text())
    page = artifact.pages[0]
    raw = trial / "provider.json"
    raw.write_text(
        json.dumps(
            {
                "tables": [
                    {"data": {"table_cells": [{"text": "A😀B C"}, {"text": "Amount Section"}]}}
                ]
            }
        )
    )
    report = {
        "cases": [
            {
                "id": "synthetic-case",
                "source_sha256": artifact.source_sha256,
                "artifact_sha256": digest(package / "artifact.json"),
                "source_render_sha256": page.render_sha256,
                "source_page_width": page.width,
                "source_page_height": page.height,
                "page": 1,
                "image": str((package / page.render).relative_to(trial)),
                "attempts": [
                    {
                        "provider": "docling-image-en",
                        "state": "EXPERIMENTAL_NOT_ACCEPTED",
                        "raw": "provider.json",
                        "raw_sha256": digest(raw),
                    }
                ],
            }
        ]
    }
    (trial / "scan-tables.json").write_text(json.dumps(report))
    (trial / "files.json").write_text(
        json.dumps({str(p.relative_to(trial)): digest(p) for p in trial.rglob("*") if p.is_file()})
    )
    binding, _, _, _ = source_evidence(package, "synthetic-case")
    value = {
        "binding": binding.model_dump(),
        "scope_note": "Synthetic engineering test; no tax law.",
        "x": [10, 50, 100],
        "y": [10, 30, 60],
        "cells": [
            {
                "id": "header",
                "row": 0,
                "column": 0,
                "column_span": 2,
                "role": "header",
                "state": "transcribed",
                "text": "Amount Section",
                "source_refs": [{"cell": 1, "start": 0, "end": 14}],
            },
            {"id": "left", "row": 1, "column": 0, "headers": ["header"]},
            {"id": "right", "row": 1, "column": 1, "headers": ["header"]},
        ],
    }
    return root, served, package, RepairDraft.model_validate(value).model_dump()


def test_reconstruction_keeps_raw_original_and_unplaced_characters(example):
    _, _, package, value = example
    before = (package / "artifact.json").read_bytes()
    draft, summary = validate_repair(package, value)
    assert not draft.publication_eligible and not draft.owner_verified
    assert (
        summary["raw_characters"]
        == summary["mapped_characters"] + summary["unplaced_characters"]
        == 19
    )
    assert summary["unplaced_characters"] == 5 and summary["unresolved_cells"] == 2
    assert (package / "artifact.json").read_bytes() == before


@pytest.mark.parametrize(
    "key",
    [
        "run_id",
        "source_sha256",
        "artifact_sha256",
        "render_sha256",
        "trial_sha256",
        "raw_sha256",
        "table_sha256",
    ],
)
def test_stale_provider_or_source_binding_cannot_inherit_corrections(example, key):
    _, _, package, original = example
    value = copy.deepcopy(original)
    value["binding"][key] = "a" * 64
    with pytest.raises(ValueError):
        validate_repair(package, value)


@pytest.mark.parametrize(
    "change",
    [
        {"x": [10, 10, 100]},
        {"x": [10, 10000]},
        {"cells": []},
        {"publication_eligible": True},
        {"owner_verified": True},
    ],
)
def test_invalid_or_approved_reconstruction_rejected(example, change):
    _, _, package, value = example
    with pytest.raises(ValueError):
        validate_repair(package, {**value, **change})


def test_gaps_overlaps_and_spans_outside_grid_fail_closed(example):
    _, _, package, original = example
    for mutation in ["gap", "overlap", "outside", "header"]:
        value = copy.deepcopy(original)
        if mutation == "gap":
            value["cells"].pop()
        elif mutation == "overlap":
            value["cells"][2]["column"] = 0
        elif mutation == "outside":
            value["cells"][2]["column_span"] = 2
        else:
            value["cells"][0]["headers"] = ["left"]
        with pytest.raises(ValueError):
            validate_repair(package, value)


def test_source_transcriptions_and_blank_claims_need_explicit_notes(example):
    _, _, package, original = example
    for state, text in [("transcribed", "Source-added amount"), ("blank", "")]:
        value = copy.deepcopy(original)
        value["cells"][1].update(state=state, text=text)
        with pytest.raises(ValueError):
            validate_repair(package, value)
        value["cells"][1]["note"] = "Explicit synthetic source check; still unaccepted."
        validate_repair(package, value)


def test_unicode_offsets_and_duplicate_ocr_characters_are_checked(example):
    _, _, package, original = example
    value = copy.deepcopy(original)
    value["cells"][1].update(
        state="transcribed", text="A😀", source_refs=[{"cell": 0, "start": 0, "end": 2}]
    )
    _, summary = validate_repair(package, value)
    assert summary["mapped_characters"] == 16 and summary["unplaced_characters"] == 3
    value["cells"][2]["source_refs"] = [{"cell": 0, "start": 1, "end": 3}]
    with pytest.raises(ValueError, match="duplicated"):
        validate_repair(package, value)
    value["cells"][2]["source_refs"] = [{"cell": 0, "start": 3, "end": 6}]
    with pytest.raises(ValueError, match="outside raw"):
        validate_repair(package, value)


def test_reconstruction_revision_history_is_conditional_and_unaccepted(example):
    root, served, package, value = example
    store = ReviewStore(root / "history.sqlite3", served)
    first = store.save(value, None, "repair-save-first-00001")
    model, _, valid = store.validate(value)
    assert (
        valid
        and model["state"] == "TABLE_RECONSTRUCTION_DRAFT"
        and not model["publication_eligible"]
    )
    assert store.save(value, None, "repair-save-first-00001")["revision_id"] == first["revision_id"]
    other = copy.deepcopy(value)
    other["scope_note"] += " Another proposal."
    with pytest.raises(Conflict):
        store.save(other, None, "repair-save-other-00002")
    second = store.save(other, first["revision_id"], "repair-save-other-00002")
    history = store.history(second["binding_key"])
    assert len(history["revisions"]) == 2
    assert history["revisions"][1]["payload"] == value


def test_changed_pixels_or_raw_cells_cannot_inherit_reconstruction(example, tmp_path):
    _, served, package, value = example
    copied = tmp_path / "served"
    shutil.copytree(served, copied)
    copied_package = copied / package.relative_to(served)
    raw = copied_package.parent.parent / "provider.json"
    raw.write_text("{}")
    with pytest.raises(ValueError, match="evidence changed"):
        validate_repair(copied_package, value)


def test_scoped_real_development_examples_have_valid_geometry_and_character_accounting():
    import subprocess
    from pathlib import Path

    fixture = Path(__file__).parent / "fixtures/table-repair-cases.json"
    script = Path(__file__).parents[1] / "src/tax_pdf/table_assets/repair_examples.mjs"
    input_value = json.loads(fixture.read_text())
    result = subprocess.run(
        ["node", str(script)], input=fixture.read_text(), capture_output=True, text=True, check=True
    )
    samples = json.loads(result.stdout)["samples"]
    for sample, ctx in zip(samples, input_value["contexts"], strict=True):
        for key in ["draft", "prepared"]:
            draft = RepairDraft.model_validate(sample[key])
            summary = validate_layout(draft, ctx["width"], ctx["height"], ctx["raw_cells"])
            assert (
                summary["raw_characters"]
                == summary["mapped_characters"] + summary["unplaced_characters"]
            )
            assert summary["unplaced_characters"] > 0 and summary["unresolved_cells"] > 0
            assert not any(c.state == "blank" for c in draft.cells)
    a, b = samples
    assert len(a["draft"]["x"]) - 1 == 7 and len(a["prepared"]["x"]) - 1 == 8
    assert any(
        c["text"] == "Amount" and c["column"] == 2 and c["row_span"] == 2
        for c in a["prepared"]["cells"]
    )
    assert any(c["text"] == "C" and c["column"] == 2 for c in a["prepared"]["cells"])
    assert len(b["prepared"]["x"]) - 1 == 9
    leaves = [c for c in b["prepared"]["cells"] if c["row"] == 1 and c["text"]]
    assert [c["text"] for c in sorted(leaves, key=lambda c: c["column"])] == [
        "Amount (Rs.)",
        "Section",
        "Amount (Rs.)",
        "Section",
    ]

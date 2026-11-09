import copy
import json
import subprocess
import time
from pathlib import Path

import pytest
from PIL import Image

from tax_pdf import scan_tables as module
from tax_pdf.benchmark import digest
from tax_pdf.fixtures import native_bytes
from tax_pdf.table_inventory import box_on_page, table_inventory


def raw_table():
    return {
        "pages": {"1": {"size": {"width": 100, "height": 200}}},
        "tables": [
            {
                "self_ref": "#/tables/0",
                "prov": [
                    {
                        "page_no": 1,
                        "bbox": {
                            "l": 10,
                            "t": 180,
                            "r": 90,
                            "b": 100,
                            "coord_origin": "BOTTOMLEFT",
                        },
                    }
                ],
                "data": {
                    "num_rows": 1,
                    "num_cols": 2,
                    "table_cells": [
                        {
                            "text": "0",
                            "start_row_offset_idx": 0,
                            "end_row_offset_idx": 1,
                            "start_col_offset_idx": 0,
                            "end_col_offset_idx": 1,
                            "column_header": True,
                            "bbox": {
                                "l": 10,
                                "t": 180,
                                "r": 50,
                                "b": 100,
                                "coord_origin": "BOTTOMLEFT",
                            },
                        },
                        {
                            "text": "",
                            "start_row_offset_idx": 0,
                            "end_row_offset_idx": 1,
                            "start_col_offset_idx": 1,
                            "end_col_offset_idx": 2,
                            "bbox": {
                                "l": 50,
                                "t": 20,
                                "r": 90,
                                "b": 100,
                                "coord_origin": "TOPLEFT",
                            },
                        },
                    ],
                },
            }
        ],
    }


def test_provider_origins_map_without_changing_raw_or_confirming_empty_cells():
    raw = raw_table()
    before = copy.deepcopy(raw)
    result = table_inventory(raw)
    table = result["tables"][0]
    assert table["image_percent_box"] == {"x": 10, "y": 10, "width": 80, "height": 40}
    assert [c["text"] for c in table["cells"]] == ["0", ""]
    assert table["uncovered_positions"] == table["overlapping_positions"] == 0
    assert all(c["verified"] is False for c in table["cells"])
    assert "EMPTY_TEXT_IS_NOT_CONFIRMED_BLANK" in table["holds"]
    assert result["publication_eligible"] is False and raw == before


@pytest.mark.parametrize(
    "change",
    [
        {"coord_origin": "UNKNOWN"},
        {"l": -1},
        {"r": 101},
        {"t": float("nan")},
        {"l": True},
        {"r": 10},
    ],
)
def test_unmappable_source_geometry_gets_no_overlay(change):
    box = {"l": 10, "t": 20, "r": 90, "b": 100, "coord_origin": "TOPLEFT"}
    assert box_on_page({**box, **change}, 100, 200) is None


def test_invalid_and_overlapping_spans_remain_explicit_holds_without_grid_completion():
    raw = raw_table()
    cells = raw["tables"][0]["data"]["table_cells"]
    cells[1]["start_col_offset_idx"] = 0
    cells[1]["end_col_offset_idx"] = 1
    result = table_inventory(raw)["tables"][0]
    assert result["overlapping_positions"] == result["uncovered_positions"] == 1
    assert len(result["cells"]) == 2
    cells[1]["end_row_offset_idx"] = 100
    result = table_inventory(raw)["tables"][0]
    assert "INVALID_CELL_SPAN" in result["holds"]
    assert result["cells"][1]["row_end"] == 100  # raw claim remains visible


def test_invalid_grid_and_missing_geometry_never_create_structured_acceptance():
    raw = raw_table()
    raw["tables"][0]["data"]["num_rows"] = 0
    raw["tables"][0]["prov"] = []
    result = table_inventory(raw)["tables"][0]
    assert {"INVALID_GRID_DIMENSIONS", "TABLE_GEOMETRY_UNAVAILABLE"} <= set(result["holds"])
    assert result["uncovered_positions"] is None
    with pytest.raises(ValueError):
        table_inventory({"tables": [{}] * 51})


def test_wrong_page_geometry_and_excessive_span_claims_are_held():
    raw = raw_table()
    raw["tables"][0]["prov"][0]["page_no"] = 2
    table = table_inventory(raw)["tables"][0]
    assert all(c["image_percent_box"] is None for c in table["cells"])
    raw["tables"][0]["data"].update(num_rows=100, num_cols=100)
    cell = raw["tables"][0]["data"]["table_cells"][0]
    cell.update(end_row_offset_idx=100, end_col_offset_idx=100)
    raw["tables"][0]["data"]["table_cells"] = [cell] * 11
    with pytest.raises(ValueError, match="span claims"):
        table_inventory(raw)


def test_provider_grid_shows_unknown_positions_without_inventing_text_or_blank_cells():
    from tax_pdf.scan_table_view import grid_view

    raw = raw_table()
    raw["tables"][0]["data"]["table_cells"] = raw["tables"][0]["data"]["table_cells"][:1]
    raw["tables"][0]["data"]["table_cells"][0]["text"] = "<script>not executable</script>"
    table = table_inventory(raw)["tables"][0]
    view = grid_view(table)
    assert view.count('class="unknown"') == 1
    assert "<script>" not in view and "&lt;script&gt;" in view
    assert len(table["cells"]) == 1 and table["uncovered_positions"] == 1


@pytest.mark.parametrize("bad", [None, "wrong_hash", "wrong_size", "wrong_pages", "approved"])
def test_docling_child_receives_only_a_png_and_settings_not_app_secrets(tmp_path, monkeypatch, bad):
    image = tmp_path / "input.png"
    Image.new("RGB", (100, 200), "white").save(image)
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "test-secret-never-pass")
    monkeypatch.setenv("DATABASE_URL", "test-database-never-pass")

    def fake(command, *, env, stdout, stderr, timeout, check):
        assert command[3:5] == ["image-probe", "--file"]
        assert command[5] == str(image)
        assert not any(str(s).endswith(".pdf") for s in command)
        assert "DATABASE_URL" not in env and "AZURE_OPENAI_API_KEY" not in env
        out = Path(command[command.index("--out") + 1])
        out.mkdir()
        metadata = {
            "image_sha256": digest(image),
            "input_kind": "PNG_PIXELS_ONLY",
            "state": "EXPERIMENTAL_NOT_ACCEPTED",
            "publication_eligible": False,
            "returned_pages": [1],
            "language_config": "en",
            "width": 100,
            "height": 200,
        }
        if bad == "wrong_hash":
            metadata["image_sha256"] = "a" * 64
        elif bad == "wrong_size":
            metadata["width"] = 99
        elif bad == "wrong_pages":
            metadata["returned_pages"] = [1, 2]
        elif bad == "approved":
            metadata["publication_eligible"] = True
        (out / "probe.json").write_text(json.dumps(metadata))
        (out / "raw-docling.json").write_text(json.dumps(raw_table()))
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(module.subprocess, "run", fake)
    if bad:
        with pytest.raises(ValueError, match="protocol"):
            module.docling_image(
                image, tmp_path / "models", tmp_path / "out", time.monotonic() + 120
            )
    else:
        report, raw = module.docling_image(
            image, tmp_path / "models", tmp_path / "out", time.monotonic() + 120
        )
        assert report["image_sha256"] == digest(image) and raw == raw_table()


def test_plain_ocr_failure_and_missing_table_provider_stay_in_trial_denominator(
    tmp_path, monkeypatch
):
    source = tmp_path / "source.pdf"
    source.write_bytes(native_bytes())
    manifest = tmp_path / "sources.json"
    manifest.write_text(
        json.dumps(
            {
                "documents": [
                    {
                        "path": "source.pdf",
                        "sha256": digest(source),
                        "title": "<script>source</script>",
                    }
                ]
            }
        )
    )
    plan = tmp_path / "plan.json"
    plan.write_text(
        json.dumps(
            {
                "dpi": 300,
                "preprocessing": "none",
                "providers": ["docling-image-en", "tesseract-image-eng+hin-psm3"],
                "coverage_gaps": ["synthetic test"],
                "documents": [
                    {
                        "sha256": digest(source),
                        "kind": "synthetic",
                        "template_group": "test",
                        "split": "engineering",
                        "expected_pages": 1,
                        "pages": [1],
                        "image_kind": "rasterized_native_control_not_a_real_scan",
                        "checks": ["no reference"],
                    }
                ],
            }
        )
    )
    monkeypatch.setattr(module, "verify_models", lambda p: "test-weights")
    models = tmp_path / "models"
    models.mkdir()
    (models / "weights-manifest.json").write_text("{}")

    def fail(*args, **kwargs):
        raise TimeoutError("synthetic provider timeout")

    monkeypatch.setattr(module, "docling_image", fail)
    monkeypatch.setattr(module, "run_ocr", fail)
    report = module.run_trial(manifest, plan, models, models, tmp_path / "out")
    assert report["summary"]["failed_attempts"] == report["summary"]["provider_attempts"] == 2
    assert report["summary"]["accepted_tables"] == 0
    assert report["accuracy"]["table_accuracy"] is None
    assert all(a["state"] == "FAILED" for a in report["cases"][0]["attempts"])
    content = (tmp_path / "out/index.html").read_text()
    assert (
        "&lt;script&gt;source&lt;/script&gt;" in content
        and "<script>source</script>" not in content
    )
    with pytest.raises(ValueError, match="fresh"):
        module.run_trial(manifest, plan, models, models, tmp_path / "out")
    old_report = (tmp_path / "out/scan-tables.json").read_bytes()
    review = module.review_trial(tmp_path / "out", tmp_path / "review")
    assert review["saved_trial_review"]["provider_rerun"] is False
    assert (tmp_path / "out/scan-tables.json").read_bytes() == old_report
    findings = tmp_path / "findings.json"
    findings.write_text(
        json.dumps(
            {
                "state": "AGENT_SOURCE_COMPARISON_NOT_ACCEPTED",
                "publication_eligible": False,
                "owner_verified": True,
                "trial_report_sha256": digest(tmp_path / "out/scan-tables.json"),
                "cases": [],
            }
        )
    )
    with pytest.raises(ValueError, match="unaccepted"):
        module.review_trial(tmp_path / "out", tmp_path / "wrong-findings", findings)
    source_image = tmp_path / "out" / report["cases"][0]["image"]
    source_image.write_bytes(b"changed evidence")
    with pytest.raises(ValueError, match="evidence changed"):
        module.review_trial(tmp_path / "out", tmp_path / "changed-review")
    assert not (tmp_path / "changed-review").exists()


def test_image_probe_rejects_pdf_input_before_loading_optional_models(tmp_path):
    from tax_pdf.docling_probe import probe_image

    source = tmp_path / "source.pdf"
    source.write_bytes(native_bytes())
    with pytest.raises((ValueError, OSError)):
        probe_image(source, tmp_path / "no-models", tmp_path / "out", "en")
    assert not (tmp_path / "out").exists()

import hashlib
import json

import pytest

from tax_pdf import benchmark as module
from tax_pdf.fixtures import native_bytes
from tax_pdf.models import Artifact
from tax_pdf.runner import process


def inputs(root):
    data = native_bytes()
    (root / "source.pdf").write_bytes(data)
    sha = hashlib.sha256(data).hexdigest()
    manifest = root / "sources.json"
    manifest.write_text(
        json.dumps(
            {
                "documents": [
                    {"path": "source.pdf", "sha256": sha, "title": "<script>unsafe</script>"}
                ]
            }
        )
    )
    plan = root / "plan.json"
    selection = {
        "sha256": sha,
        "kind": "synthetic",
        "template_group": "fixture-family",
        "split": "engineering",
        "expected_pages": 1,
        "pages": [1],
    }
    plan.write_text(json.dumps({"documents": [selection]}))
    return manifest, plan, selection


def test_report_distinguishes_engineering_coverage_from_accuracy(tmp_path):
    manifest, plan, _ = inputs(tmp_path)
    out = tmp_path / "report"
    report = module.benchmark(manifest, plan, out)
    assert report["accuracy"]["cer"] is None
    assert report["accuracy"]["table_relationship_accuracy"] is None
    assert report["accuracy"]["accepted_pages"] == 0
    assert report["cohorts"]["official"]["documents"] == 0
    synthetic = report["cohorts"]["synthetic"]
    assert synthetic["processed_pages"] == synthetic["expected_pages"] == 1
    assert synthetic["integrity_verified_documents"] == 1
    assert report["publication_eligible"] is False
    assert report["documents"][0]["wall_seconds"] > 0
    html = (out / "index.html").read_text()
    assert "<script>unsafe</script>" not in html and "&lt;script&gt;" in html
    assert "not an OCR accuracy score" in html
    assert (out / "tables" / "workspace.js").is_file()
    with pytest.raises(ValueError):
        module.benchmark(manifest, plan, out)


def test_failed_runs_remain_in_denominator(tmp_path, monkeypatch):
    manifest, plan, _ = inputs(tmp_path)

    def fail(*args, **kwargs):
        raise ValueError("Sensitive parser detail must not be printed")

    monkeypatch.setattr(module, "process", fail)
    report = module.benchmark(manifest, plan, tmp_path / "report")
    total = report["cohorts"]["synthetic"]
    assert total["expected_pages"] == total["selected_pages"] == 1
    assert total["processed_pages"] == 0 and total["failed_runs"] == 1
    assert not report["documents"][0]["integrity_verified"]
    assert "Sensitive" not in json.dumps(report)


@pytest.mark.parametrize(
    "change",
    [
        {"split": "held_out"},
        {"pages": [1, 1]},
        {"pages": [2]},
        {"pages": [True]},
        {"expected_pages": 1001},
        {"kind": "approved"},
    ],
)
def test_plan_rejects_false_evaluation_claims_and_invalid_bounds(tmp_path, change):
    manifest, plan, selection = inputs(tmp_path)
    plan.write_text(json.dumps({"documents": [{**selection, **change}]}))
    with pytest.raises(ValueError):
        module.load_plan(manifest, plan)


def test_duplicate_source_selection_is_rejected(tmp_path):
    manifest, plan, selection = inputs(tmp_path)
    plan.write_text(json.dumps({"documents": [selection, selection]}))
    with pytest.raises(ValueError):
        module.load_plan(manifest, plan)


def test_plan_page_count_mismatch_is_explicitly_held(tmp_path):
    manifest, _, selection = inputs(tmp_path)
    package = process(tmp_path / "source.pdf", tmp_path / "packages")
    artifact = Artifact.model_validate_json((package / "artifact.json").read_text())
    report = module.summarize(artifact, package, {**selection, "expected_pages": 3}, 0.1)
    assert not report["page_accounting_complete"]
    assert not report["fully_processed"]
    assert report["expected_pages"] == 3 and report["observed_pages"] == 1
    assert report["state"] == "BLOCKED"
    assert "PLAN_PAGE_COUNT_MISMATCH" in report["issues"]

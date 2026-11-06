import hashlib
import json

import pytest

from tax_pdf.fixtures import native_bytes
from tax_pdf.reference_pack import build_pack, evaluate_pack
from tax_pdf.runner import process


def setup(root):
    source = root / "source.pdf"
    source.write_bytes(native_bytes())
    package = process(source, root / "packages")
    sha = hashlib.sha256(source.read_bytes()).hexdigest()
    native = root / "native-report.json"
    native.write_text(
        json.dumps(
            {"documents": [{"source_sha256": sha, "package": str(package.relative_to(root))}]}
        )
    )
    scans = root / "scan-report.json"
    scans.write_text(json.dumps({"documents": [], "cases": []}))
    plan = root / "plan.json"
    row = {
        "sha256": sha,
        "kind": "synthetic",
        "template_group": "test-family",
        "split": "development",
        "pages": [1],
        "focus": "<script>not markup</script>",
        "fixture": "native",
    }
    plan.write_text(json.dumps({"documents": [row]}))
    return native, scans, plan, package


def test_reference_pack_authored_labels_score_and_provenance_is_pinned(tmp_path):
    native, scans, plan, _ = setup(tmp_path)
    out = tmp_path / "reference-set"
    report = build_pack(tmp_path, native, scans, plan, out)
    assert report["reference_pages"] == 1
    assert report["official_verified_pages"] == 0
    assert report["by_kind"]["synthetic"]["cer"] == 0
    assert report["by_kind"]["official"]["cer"] is None
    assert report["publication_eligible"] is False
    html = (out / "results-v1" / "index.html").read_text()
    assert "<script>not markup</script>" not in html
    repeated = evaluate_pack(tmp_path, out / "dataset.json", out / "results-v2")
    assert repeated["by_kind"] == report["by_kind"]
    with pytest.raises(ValueError):
        build_pack(tmp_path, native, scans, plan, out)
    data = json.loads((out / "dataset.json").read_text())
    candidate = out / data["pages"][0]["candidates"][0]["path"]
    candidate.write_text(candidate.read_text().replace("1.5%", "15%"))
    with pytest.raises(ValueError, match="candidate snapshot"):
        evaluate_pack(tmp_path, out / "dataset.json", out / "results-v3")


def test_official_proposals_are_not_relabelled_from_candidate_output(tmp_path):
    native, scans, plan, _ = setup(tmp_path)
    data = json.loads(plan.read_text())
    data["documents"][0]["kind"] = "official"
    plan.write_text(json.dumps(data))
    out = tmp_path / "reference-set"
    report = build_pack(tmp_path, native, scans, plan, out)
    assert report["by_kind"]["official"]["cer"] is None
    assert report["by_kind"]["official"]["unscored_attempts"] == 1
    reference = json.loads(next((out / "references").glob("*.json")).read_text())
    assert reference["expected_text"] is None and reference["verification"] is None
    assert "&lt;script&gt;" in (out / "results-v1" / "index.html").read_text()


def test_changed_render_and_reference_traversal_are_rejected(tmp_path):
    native, scans, plan, package = setup(tmp_path)
    out = tmp_path / "reference-set"
    build_pack(tmp_path, native, scans, plan, out)
    render = package / "pages/0001.png"
    saved = render.read_bytes()
    render.write_bytes(b"corrupt")
    with pytest.raises(ValueError, match="checksum"):
        evaluate_pack(tmp_path, out / "dataset.json", out / "results-v2")
    render.write_bytes(saved)
    dataset = json.loads((out / "dataset.json").read_text())
    dataset["pages"][0]["reference"] = "../plan.json"
    (out / "dataset.json").write_text(json.dumps(dataset))
    with pytest.raises(ValueError, match="inside"):
        evaluate_pack(tmp_path, out / "dataset.json", out / "results-v3")


def test_split_and_duplicate_page_selection_cannot_invent_holdout_scores(tmp_path):
    native, scans, plan, _ = setup(tmp_path)
    data = json.loads(plan.read_text())
    data["documents"][0]["split"] = "held_out"
    plan.write_text(json.dumps(data))
    with pytest.raises(ValueError):
        build_pack(tmp_path, native, scans, plan, tmp_path / "bad")
    data["documents"][0]["split"] = "development"
    data["documents"][0]["pages"] = [1, 1]
    plan.write_text(json.dumps(data))
    with pytest.raises(ValueError):
        build_pack(tmp_path, native, scans, plan, tmp_path / "bad")


def test_failed_ocr_and_raw_evidence_are_retained_and_checked(tmp_path):
    native, scans, plan, package = setup(tmp_path)
    artifact = json.loads((package / "artifact.json").read_text())
    page = artifact["pages"][0]
    raw = tmp_path / "raw-ocr.json"
    raw.write_text(json.dumps({"text": "fixture candidate"}))
    data = {
        "documents": [
            {
                "source_sha256": artifact["source_sha256"],
                "package": str(package.relative_to(tmp_path)),
            }
        ],
        "cases": [
            {
                "source_sha256": artifact["source_sha256"],
                "page": 1,
                "transform": "unchanged",
                "source_render_sha256": page["render_sha256"],
                "variants": [
                    {
                        "languages": "eng",
                        "psm": 3,
                        "state": "FAILED",
                        "quality_issues": ["OCR_FAILED"],
                    },
                    {
                        "languages": "eng+hin",
                        "psm": 3,
                        "state": "EXPERIMENTAL_NOT_ACCEPTED",
                        "quality_issues": [],
                        "text": "fixture candidate",
                        "raw": "raw-ocr.json",
                        "raw_sha256": hashlib.sha256(raw.read_bytes()).hexdigest(),
                    },
                ],
            }
        ],
    }
    scans.write_text(json.dumps(data))
    out = tmp_path / "reference-set"
    report = build_pack(tmp_path, native, scans, plan, out)
    scores = report["by_kind"]["synthetic"]
    assert scores["candidate_attempts"] == scores["scored_attempts"] == 3
    assert scores["failed_attempts"] == scores["missing_output_attempts"] == 1
    raw.write_text("changed provider output")
    with pytest.raises(ValueError, match="candidate evidence"):
        evaluate_pack(tmp_path, out / "dataset.json", out / "results-v2")


def test_duplicate_attempts_and_changed_reference_groups_rejected(tmp_path):
    native, scans, plan, _ = setup(tmp_path)
    out = tmp_path / "reference-set"
    build_pack(tmp_path, native, scans, plan, out)
    dataset_file = out / "dataset.json"
    dataset = json.loads(dataset_file.read_text())
    original = dataset_file.read_text()
    dataset["pages"][0]["candidates"] *= 2
    dataset_file.write_text(json.dumps(dataset))
    with pytest.raises(ValueError, match="Duplicate"):
        evaluate_pack(tmp_path, dataset_file, out / "results-v2")
    dataset_file.write_text(original)
    reference_file = next((out / "references").glob("*.json"))
    ref = json.loads(reference_file.read_text())
    ref.update(status="PROPOSED", verification=None, template_group="new-group")
    reference_file.write_text(json.dumps(ref))
    with pytest.raises(ValueError, match="selected immutable source"):
        evaluate_pack(tmp_path, dataset_file, out / "results-v3")

import copy
import json
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from tax_pdf import refine_compare as refine
from tax_pdf.compare_review import render_line
from tax_pdf.easyocr_probe import convert_rows
from tax_pdf.fixtures import native_bytes
from tax_pdf.ocr_compare import digest


def snapshot(tmp_path):
    root = tmp_path / "previous"
    root.mkdir()
    (root / "pages").mkdir()
    (root / "regions").mkdir()
    (root / "raw").mkdir()
    (root / "original.pdf").write_bytes(native_bytes())
    (root / "baseline-artifact.json").write_text("{}")
    for name in ["pages/0001.png", "regions/signature.png", "regions/name.png"]:
        Image.new("RGB", (20, 20), "white").save(root / name)
    blocks = [
        {
            "id": "p1-b1",
            "raw_text": "old signature",
            "bbox": {"x0": 0, "top": 0, "x1": 2, "bottom": 2},
        },
        {"id": "p1-b2", "raw_text": "old name", "bbox": {"x0": 4, "top": 4, "x1": 8, "bottom": 8}},
    ]
    findings = []
    for index, block in enumerate(blocks):
        findings.append(
            {
                "id": f"case-{index + 1}",
                "region_ids": [block["id"]],
                "attempts": [],
                "groups": [
                    {
                        "id": f"group-{index + 1}",
                        "region_ids": [block["id"]],
                        "crop": f"regions/{'signature' if index == 0 else 'name'}.png",
                    }
                ],
                "category": "person_name_transcription",
            }
        )
    report = {
        "source_title": "Synthetic test, not tax law",
        "source_sha256": digest(root / "original.pdf"),
        "baseline_artifact_sha256": digest(root / "baseline-artifact.json"),
        "state": "BLOCKED",
        "publication_eligible": False,
        "acceptance": None,
        "limitations": [],
        "pages": [
            {
                "number": 1,
                "width": 10,
                "height": 10,
                "render": "pages/0001.png",
                "native_blocks": blocks,
                "variants": [],
            }
        ],
        "findings": findings,
        "files": {str(p.relative_to(root)): digest(p) for p in root.rglob("*") if p.is_file()},
    }
    (root / "comparison.json").write_text(json.dumps(report))
    review = {
        "feedback_type": "comparison_review",
        "comparison_sha256": digest(root / "comparison.json"),
        "source_sha256": report["source_sha256"],
        "baseline_artifact_sha256": report["baseline_artifact_sha256"],
        "scoped_exclusion_policy": {"requested_region_ids": ["p1-b1"]},
        "observations": [
            {
                "region_ids": ["p1-b1"],
                "outcome": "exclusion_requested",
                "user_report": "Ignore this signature",
            },
            {
                "region_ids": ["p1-b2"],
                "outcome": "still_incorrect",
                "user_report": "Expected user name NEVER_FEED_OCR",
            },
        ],
    }
    review_path = tmp_path / "review.json"
    review_path.write_text(json.dumps({"feedback": [review]}))
    return root, review_path, report, review


def fake_probe(requests, models, output):
    records = []
    for request in requests:
        assert set(request) == {"id", "image"}
        assert "NEVER_FEED_OCR" not in json.dumps(request)
        rows = [([[8, 8], [16, 8], [16, 16], [8, 16]], "New name", 0.85)]
        if request["id"].startswith("page"):
            rows.append(([[0, 0], [4, 0], [4, 4], [0, 4]], "raw signature noise", 0.25))
        preserved, blocks = convert_rows(rows, 20, 20)
        records.append(
            {
                "id": request["id"],
                "image_sha256": digest(request["image"]),
                "width": 20,
                "height": 20,
                "blocks": blocks,
                "provider_regions": preserved,
                "text": "New name",
                "languages": ["eng"],
                "state": "EXPERIMENTAL_NOT_ACCEPTED",
                "publication_eligible": False,
            }
        )
    value = {"records": records, "versions": {"test": "stub-not-real-ocr"}}
    output.write_text(json.dumps(value))
    return value


def test_easyocr_preserves_provider_polygons_order_and_confidence():
    rows = [
        ([[5, 5], [9, 4], [10, 8], [4, 9]], "lower", 0.8),
        ([[0, 0], [2, 0], [2, 2], [0, 2]], "upper", 0.1),
    ]
    preserved, blocks = convert_rows(rows, 20, 20)
    assert [r["text"] for r in preserved] == ["lower", "upper"]
    assert preserved[0]["polygon"] == rows[0][0]
    assert blocks[0]["paragraphs"][0]["lines"][0]["confidence"] == 80
    assert convert_rows([], 20, 20) == ([], [])
    for bad in [
        ([[0, 0], [30, 0], [30, 2], [0, 2]], "outside", 0.5),
        ([[0, 0], [2, 0], [2, 2], [0, 2]], "invalid", float("nan")),
    ]:
        with pytest.raises(ValueError):
            convert_rows([bad], 20, 20)


def test_exclusion_never_discards_partially_overlapping_text():
    exclusion = {"p1-b1": {"x0": 0, "top": 0, "x1": 5, "bottom": 5}}

    def line(box):
        return {"id": "line", "text": "raw important text", "bbox": box}

    inside = refine.annotate_scope(line({"x0": 1, "top": 1, "x1": 4, "bottom": 4}), exclusion)
    partial = refine.annotate_scope(line({"x0": 3, "top": 3, "x1": 8, "bottom": 8}), exclusion)
    outside = refine.annotate_scope(line({"x0": 6, "top": 6, "x1": 8, "bottom": 8}), exclusion)
    assert inside["text_scope"] == "EXCLUDED_BY_REVIEWER" and inside["text"] == "raw important text"
    assert (
        partial["text_scope"] == "MIXED_EXCLUSION_NEEDS_REVIEW"
        and partial["text"] == "raw important text"
    )
    assert outside["text_scope"] == "INCLUDED_CANDIDATE"
    assert "raw important text" not in render_line(inside, "OCR")
    assert "raw important text" in render_line(partial, "OCR")


def test_numeric_tokens_are_not_completed_or_repaired():
    values = [{"text": text} for text in ["noise", "1", "?", "3", "5", "7x", "0"]]
    assert refine.numeric_items(values) == ["1", "3", "5", "0"]
    assert refine.numeric_items([]) == []


def test_review_is_bound_to_comparison_and_scoped_regions(tmp_path):
    root, p, _, review = snapshot(tmp_path)
    refine.bind_review(root, p)
    bad = copy.deepcopy(review)
    bad["source_sha256"] = "different"
    p.write_text(json.dumps({"feedback": [bad]}))
    with pytest.raises(ValueError, match="different"):
        refine.bind_review(root, p)
    bad = copy.deepcopy(review)
    bad["scoped_exclusion_policy"]["requested_region_ids"] = ["other-region"]
    p.write_text(json.dumps({"feedback": [bad]}))
    with pytest.raises(ValueError, match="Exclusion"):
        refine.bind_review(root, p)
    p.write_text(json.dumps({"feedback": [review]}))
    (root / "regions/name.png").write_bytes(b"changed")
    with pytest.raises(ValueError, match="changed"):
        refine.bind_review(root, p)


def test_inventory_cannot_escape_the_snapshot(tmp_path):
    root, p, report, review = snapshot(tmp_path)
    report["files"]["../private-file"] = "forged"
    (root / "comparison.json").write_text(json.dumps(report))
    review["comparison_sha256"] = digest(root / "comparison.json")
    p.write_text(json.dumps({"feedback": [review]}))
    with pytest.raises(ValueError, match="path"):
        refine.bind_review(root, p)


def test_refinement_applies_only_requested_scope_and_keeps_raw_evidence(tmp_path, monkeypatch):
    root, p, original, _ = snapshot(tmp_path)
    original_hash = digest(root / "comparison.json")
    models = tmp_path / "models"
    models.mkdir()
    (models / "weights-manifest.json").write_text("{}")
    monkeypatch.setattr(refine, "verify_models", lambda _: "stub-model-hash")
    monkeypatch.setattr(refine, "run_probe", fake_probe)
    monkeypatch.setattr(
        refine,
        "write_comparison",
        lambda report, path: (path / "index.html").write_text("test view"),
    )
    out = tmp_path / "new"
    result = refine.refine(root, p, models, out)
    new = json.loads((out / "comparison.json").read_text())
    assert result["state"] == "BLOCKED" and result["publication_eligible"] is False
    assert result["ocr_requests"] == 2  # Page + active name crop; excluded signature not sent.
    assert new["findings"][0]["resolution"] == "REVIEWER_EXCLUDED_FROM_TEXT"
    assert new["findings"][0]["attempts"] == []
    assert new["findings"][1]["resolution"] == "UNRESOLVED_REVIEW_REQUIRED"
    assert new["refinement"]["excluded_regions_count_as_correct"] is False
    assert new["pages"][0]["variants"][0]["lines"][1]["text_scope"] == "EXCLUDED_BY_REVIEWER"
    assert new["pages"][0]["variants"][0]["lines"][1]["text"] == "raw signature noise"
    assert digest(out / "original.pdf") == original["source_sha256"]
    assert digest(root / "comparison.json") == original_hash
    assert (out / "previous-comparison.json").read_bytes() == (
        root / "comparison.json"
    ).read_bytes()


def test_refinement_failure_leaves_prior_revision_unchanged(tmp_path, monkeypatch):
    root, p, _, _ = snapshot(tmp_path)
    original_hash = digest(root / "comparison.json")
    models = tmp_path / "models"
    models.mkdir()
    (models / "weights-manifest.json").write_text("{}")
    monkeypatch.setattr(refine, "verify_models", lambda _: "stub")

    def fail(*args):
        raise TimeoutError("worker timeout")

    monkeypatch.setattr(refine, "run_probe", fail)
    out = tmp_path / "new"
    with pytest.raises(TimeoutError):
        refine.refine(root, p, models, out)
    assert not out.exists() and not list(tmp_path.glob(".ocr-refinement-*"))
    assert digest(root / "comparison.json") == original_hash


def test_probe_rejects_approval_and_removes_job(tmp_path, monkeypatch):
    image = tmp_path / "image.png"
    Image.new("RGB", (20, 20), "white").save(image)
    out = tmp_path / "probe.json"

    def run(args, **kwargs):
        assert "DATABASE_URL" not in kwargs["env"]
        job = json.loads(Path(args[args.index("--job") + 1]).read_text())
        raw = fake_probe(job, tmp_path, out)
        raw["publication_eligible"] = True
        raw["state"] = "EXPERIMENTAL_NOT_ACCEPTED"
        raw["model_manifest_sha256"] = "stub-model-hash"
        out.write_text(json.dumps(raw))
        return subprocess.CompletedProcess(args, 0)

    monkeypatch.setattr(subprocess, "run", run)
    monkeypatch.setenv("DATABASE_URL", "sensitive-test-value")
    monkeypatch.setattr(refine, "verify_models", lambda _: "stub-model-hash")
    with pytest.raises(ValueError, match="protocol"):
        refine.run_probe([{"id": "page-1", "image": str(image)}], tmp_path, out)
    assert not out.with_suffix(".job.json").exists()

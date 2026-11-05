import copy
import hashlib
import json
import subprocess
import time
from pathlib import Path

import pytest
from PIL import Image

from tax_pdf import ocr_compare, runner
from tax_pdf.fixtures import native_bytes
from tax_pdf.models import Artifact, Box, Page


def raw_ocr(image, text="Machine candidate"):
    with Image.open(image) as im:
        w, h = im.size
    return {
        "state": "EXPERIMENTAL_NOT_ACCEPTED",
        "publication_eligible": False,
        "image_sha256": ocr_compare.digest(image),
        "width": w,
        "height": h,
        "languages": ["eng", "hin"],
        "psm": 3,
        "text": text,
        "confidence": 70,
        "engine_versions": {"test": "stub-not-real-ocr"},
        "blocks": [
            {
                "paragraphs": [
                    {
                        "lines": [
                            {
                                "text": text,
                                "confidence": 70,
                                "bbox": {"x0": 0, "y0": 0, "x1": min(100, w), "y1": min(20, h)},
                            }
                        ]
                    }
                ]
            }
        ],
    }


def baseline_and_feedback(tmp_path):
    source = tmp_path / "source.pdf"
    source.write_bytes(native_bytes())
    baseline = runner.process(source, tmp_path / "baseline")
    p = baseline / "artifact.json"
    a = Artifact.model_validate_json(p.read_text())
    blocks = a.pages[0].blocks[:2]
    feedback = {
        "source_sha256": a.source_sha256,
        "run_id": a.run_id,
        "artifact_sha256": ocr_compare.digest(p),
        "processing_fingerprint": a.fingerprint,
        "feedback_type": "region_defect_report",
        "findings": [],
    }
    for index, block in enumerate(blocks):
        feedback["findings"].append(
            {
                "region_ids": [block.id],
                "regions": [
                    {
                        "id": block.id,
                        "bbox": block.bbox.model_dump(),
                        "extracted_text": block.raw_text,
                    }
                ],
                "category": "signature_misclassified_as_text"
                if index == 0
                else "person_name_transcription",
                "user_report": "Reviewer note <script>alert(1)</script>",
                "proposed_value": "USER_EXPECTED_NEVER_FEED_OCR",
                "value_scope": "Reviewer proposal only",
            }
        )
    return baseline, p, a, feedback


def test_feedback_is_bound_to_exact_revision_and_geometry(tmp_path):
    _, p, a, feedback = baseline_and_feedback(tmp_path)
    assert len(ocr_compare.bind_feedback(a, p, feedback)) == 2
    for key in ("source_sha256", "run_id", "artifact_sha256", "processing_fingerprint"):
        bad = copy.deepcopy(feedback)
        bad[key] = "changed"
        with pytest.raises(ValueError, match="different"):
            ocr_compare.bind_feedback(a, p, bad)
    bad = copy.deepcopy(feedback)
    bad["findings"][0]["regions"][0]["bbox"]["x0"] += 1
    with pytest.raises(ValueError, match="geometry/text"):
        ocr_compare.bind_feedback(a, p, bad)
    bad = copy.deepcopy(feedback)
    bad["findings"].append(bad["findings"][0])
    with pytest.raises(ValueError, match="duplicate"):
        ocr_compare.bind_feedback(a, p, bad)


def test_mapping_uses_actual_pixel_dimensions_and_never_sorts_lines():
    page = Page(number=2, width=600, height=800, status="ocr_required")
    raw = {
        "width": 2501,
        "height": 3337,
        "blocks": [
            {
                "paragraphs": [
                    {
                        "lines": [
                            {
                                "text": "Lower",
                                "confidence": 90,
                                "bbox": {"x0": 20, "x1": 120, "y0": 200, "y1": 220},
                            },
                            {
                                "text": "Upper",
                                "confidence": 40,
                                "bbox": {"x0": 0, "x1": 100, "y0": 0, "y1": 20},
                            },
                        ]
                    }
                ]
            }
        ],
    }
    result = ocr_compare.mapped_lines(raw, page)
    assert result[0]["text"] == "Lower" and result[1]["text"] == "Upper"
    assert result[0]["bbox"]["x0"] == pytest.approx(20 * 600 / 2501)
    assert result[0]["order_verified"] is False and result[1]["low_confidence"]
    raw["blocks"][0]["paragraphs"][0]["lines"][0]["bbox"]["x1"] = 9999
    with pytest.raises(ValueError, match="exceeds"):
        ocr_compare.mapped_lines(raw, page)


def test_crop_carries_actual_clipped_geometry(tmp_path):
    _, _, a, feedback = baseline_and_feedback(tmp_path)
    page = a.pages[0]
    pixels, box = ocr_compare.crop_box(page, feedback["findings"][0]["region_ids"], (2501, 3337))
    assert pixels[0] >= 0 and pixels[2] <= 2501
    assert box.x0 == pixels[0] * page.width / 2501
    assert box.bottom == pixels[3] * page.height / 3337
    with pytest.raises(ValueError, match="Missing"):
        ocr_compare.crop_box(page, ["missing-region"], (2501, 3337))


def test_worker_gets_pixels_and_settings_only_and_rejects_acceptance(tmp_path, monkeypatch):
    image = tmp_path / "image.png"
    Image.new("RGB", (40, 20), "white").save(image)
    output = tmp_path / "ocr.json"
    captured = {}

    def process(args, **kwargs):
        job = json.loads(Path(args[-1]).read_text())
        captured.update(job)
        assert set(job) == {"image", "models", "psm", "languages"}
        assert "DATABASE_URL" not in kwargs["env"]
        value = raw_ocr(image)
        value["languages"] = ["eng"]
        value["psm"] = 7
        value["publication_eligible"] = True
        kwargs["stdout"].write(json.dumps(value).encode())
        return subprocess.CompletedProcess(args, 0)

    monkeypatch.setattr(subprocess, "run", process)
    monkeypatch.setenv("DATABASE_URL", "sensitive-test-value")
    with pytest.raises(ValueError, match="protocol"):
        ocr_compare.run_ocr(
            image, tmp_path, output, psm=7, languages="eng", deadline=time.monotonic() + 20
        )
    assert captured["image"] == str(image.resolve())
    assert not output.with_suffix(".job.json").exists()


def test_timeout_cleans_job_and_does_not_claim_success(tmp_path, monkeypatch):
    image = tmp_path / "image.png"
    Image.new("RGB", (40, 20), "white").save(image)
    output = tmp_path / "ocr.json"

    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired("node", 1)

    monkeypatch.setattr(subprocess, "run", timeout)
    with pytest.raises(subprocess.TimeoutExpired):
        ocr_compare.run_ocr(
            image, tmp_path, output, psm=7, languages="eng", deadline=time.monotonic() + 20
        )
    assert not output.with_suffix(".job.json").exists()


def test_comparison_keeps_human_notes_separate_and_signatures_image_only(tmp_path, monkeypatch):
    baseline, p, a, feedback = baseline_and_feedback(tmp_path)
    feedback_file = tmp_path / "feedback.json"
    feedback_file.write_text(json.dumps({"feedback": [feedback]}))
    models = tmp_path / "models"
    models.mkdir()
    (models / "weights-manifest.json").write_text("{}")
    monkeypatch.setattr(ocr_compare, "verify_models", lambda _: "stub-model-hash")
    calls = []

    def fake_ocr(image, models, output, **kwargs):
        calls.append(kwargs)
        assert "USER_EXPECTED" not in json.dumps(kwargs)
        value = raw_ocr(image)
        value["languages"] = kwargs["languages"].split("+")
        value["psm"] = kwargs["psm"]
        output.write_text(json.dumps(value))
        return value

    monkeypatch.setattr(ocr_compare, "run_ocr", fake_ocr)
    original_hash = hashlib.sha256(p.read_bytes()).hexdigest()
    out = tmp_path / "comparison"
    result = ocr_compare.compare(baseline, feedback_file, models, out)
    assert result["state"] == "BLOCKED" and result["publication_eligible"] is False
    assert len(calls) == 3  # Two full-page language variants and one text crop, no signature OCR.
    report = json.loads((out / "comparison.json").read_text())
    assert report["acceptance"] is None and report["findings"][0]["attempts"] == []
    assert report["findings"][0]["handling"] == "REVIEWER_MARKED_SIGNATURE_IMAGE_ONLY"
    assert all(f["resolution"] == "UNRESOLVED_REVIEW_REQUIRED" for f in report["findings"])
    assert report["findings"][1]["attempts"][0]["text"] == "Machine candidate"
    assert report["findings"][1]["proposed_value"] == "USER_EXPECTED_NEVER_FEED_OCR"
    assert hashlib.sha256(p.read_bytes()).hexdigest() == original_hash
    assert ocr_compare.digest(out / "original.pdf") == a.source_sha256
    html = (out / "index.html").read_text()
    assert "<script>alert(1)</script>" not in html and "&lt;script&gt;" in html
    assert "form-action 'none'" in html and "No region OCR is run here" in html
    for file, expected in report["files"].items():
        assert ocr_compare.digest(out / file) == expected
    with pytest.raises(ValueError, match="fresh"):
        ocr_compare.compare(baseline, feedback_file, models, out)


def test_worker_failure_does_not_leave_a_complete_package(tmp_path, monkeypatch):
    baseline, _, _, feedback = baseline_and_feedback(tmp_path)
    feedback_file = tmp_path / "feedback.json"
    feedback_file.write_text(json.dumps({"feedback": [feedback]}))
    (tmp_path / "weights-manifest.json").write_text("{}")
    monkeypatch.setattr(ocr_compare, "verify_models", lambda _: "stub")

    def fail(*args, **kwargs):
        raise TimeoutError("OCR timeout")

    monkeypatch.setattr(ocr_compare, "run_ocr", fail)
    out = tmp_path / "comparison"
    with pytest.raises(TimeoutError):
        ocr_compare.compare(baseline, feedback_file, tmp_path, out)
    assert not out.exists() and not list(tmp_path.glob(".ocr-comparison-*"))


def test_disconnected_regions_do_not_become_one_large_crop(tmp_path):
    _, _, a, _ = baseline_and_feedback(tmp_path)
    page = a.pages[0]
    blocks = [b.model_copy(deep=True) for b in page.blocks[:3]]
    blocks[0].bbox = Box(x0=10, top=10, x1=60, bottom=20)
    blocks[1].bbox = Box(x0=10, top=25, x1=60, bottom=35)
    blocks[2].bbox = Box(x0=400, top=500, x1=500, bottom=520)
    page.blocks = blocks
    groups = ocr_compare.spatial_groups(page, [b.id for b in blocks])
    assert groups == [[blocks[0].id, blocks[1].id], [blocks[2].id]]


def test_changed_model_weights_are_rejected_before_ocr(tmp_path):
    manifest = {
        "revision": ocr_compare.REVISION,
        "files": {
            f"{language}.traineddata": {"sha256": expected}
            for language, expected in ocr_compare.WEIGHTS.items()
        },
    }
    (tmp_path / "weights-manifest.json").write_text(json.dumps(manifest))
    (tmp_path / "eng.traineddata").write_bytes(b"changed weights")
    with pytest.raises(ValueError, match="weights changed"):
        ocr_compare.verify_models(tmp_path)


def test_blank_ocr_output_is_not_replaced_with_reviewer_text(tmp_path, monkeypatch):
    baseline, _, _, feedback = baseline_and_feedback(tmp_path)
    feedback_file = tmp_path / "feedback.json"
    feedback_file.write_text(json.dumps({"feedback": [feedback]}))
    (tmp_path / "weights-manifest.json").write_text("{}")
    monkeypatch.setattr(ocr_compare, "verify_models", lambda _: "stub")

    def blank(image, models, output, **kwargs):
        value = raw_ocr(image, "")
        value["blocks"] = []
        output.write_text(json.dumps(value))
        return value

    monkeypatch.setattr(ocr_compare, "run_ocr", blank)
    out = tmp_path / "comparison"
    ocr_compare.compare(baseline, feedback_file, tmp_path, out)
    report = json.loads((out / "comparison.json").read_text())
    assert report["findings"][1]["attempts"][0]["text"] == ""
    assert report["state"] == "BLOCKED"
    assert "no text detected" in (out / "index.html").read_text()

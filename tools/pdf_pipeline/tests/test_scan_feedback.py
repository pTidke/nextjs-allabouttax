import copy
import json

import pytest
from PIL import Image

from tax_pdf.fixtures import native_bytes
from tax_pdf.reference_eval import digest
from tax_pdf.runner import process
from tax_pdf.scan_feedback import bind_feedback, write_feedback_view


def inputs(root):
    source = root / "source.pdf"
    source.write_bytes(native_bytes())
    package = process(source, root / "packages")
    artifact_file = package / "artifact.json"
    artifact = json.loads(artifact_file.read_text())
    page = artifact["pages"][0]
    image = package / page["render"]
    with Image.open(image) as im:
        width, height = im.size
        im.rotate(90, expand=True).save(root / "rotated.png")
    region = {
        "id": "p1-ocr-eng-1",
        "text": "<script>bad</script>",
        "bbox": {"x0": 72, "top": 42, "x1": 78, "bottom": 102},
        "image_bbox": {"x0": 120, "y0": 70, "x1": 130, "y1": 170},
        "confidence": 40,
    }
    raw = root / "raw.json"
    raw.write_text('{"raw":"unchanged"}')
    case = {
        "id": artifact["source_sha256"][:12] + "-p1-unchanged",
        "source_sha256": artifact["source_sha256"],
        "source_render_sha256": page["render_sha256"],
        "page": 1,
        "kind": "synthetic",
        "title": "<script>unsafe title</script>",
        "width": width,
        "height": height,
        "transform": "unchanged",
        "image": str(image.relative_to(root)),
        "image_sha256": digest(image),
        "variants": [
            {
                "languages": "eng",
                "psm": 3,
                "lines": [region],
                "raw": "raw.json",
                "raw_sha256": digest(raw),
            }
        ],
    }
    rotated = {
        **case,
        "id": artifact["source_sha256"][:12] + "-p1-rotated90",
        "image": "rotated.png",
        "image_sha256": digest(root / "rotated.png"),
        "transform": "rotated90",
        "width": height,
        "height": width,
    }
    report = root / "scan-report.json"
    report.write_text(
        json.dumps(
            {
                "documents": [
                    {
                        "source_sha256": artifact["source_sha256"],
                        "package": str(package.relative_to(root)),
                        "artifact_sha256": digest(artifact_file),
                    }
                ],
                "cases": [case, rotated],
            }
        )
    )
    finding = {
        "id": "column",
        "case_id": case["id"],
        "languages": "eng",
        "psm": 3,
        "category": "number_column",
        "action": "reconstruct_column",
        "user_report": "<script>not markup</script>",
        "regions": [region],
        "expected_sequence": ["1", "2", "3"],
        "value_scope": "Column only; not accepted",
    }
    orientation = {
        "id": "orientation",
        "case_id": rotated["id"],
        "category": "orientation_failure",
        "action": "reject_page",
        "user_report": "rotated text is bad",
        "value_scope": "Whole synthetic derivative only",
    }
    feedback = root / "feedback.json"
    feedback.write_text(
        json.dumps(
            {
                "scan_report_sha256": digest(report),
                "recorded_date": "2026-11-05",
                "original_message": "Synthetic mock feedback",
                "findings": [finding, orientation],
            }
        )
    )
    return report, feedback, package


def test_exact_revision_geometry_and_variant_binding(tmp_path):
    report, feedback, _ = inputs(tmp_path)
    _, bound = bind_feedback(report, feedback)
    assert bound.findings[0].full_page_reference_verified is False
    value = json.loads(feedback.read_text())
    original = copy.deepcopy(value)
    for change in [
        lambda v: v["findings"][0]["regions"][0].update(text="different"),
        lambda v: v["findings"][0].update(languages="eng+hin"),
        lambda v: v.update(scan_report_sha256="a" * 64),
    ]:
        changed = copy.deepcopy(original)
        change(changed)
        feedback.write_text(json.dumps(changed))
        with pytest.raises(ValueError):
            bind_feedback(report, feedback)


def test_changed_pixels_or_original_are_rejected(tmp_path):
    report, feedback, package = inputs(tmp_path)
    original = package / "original.pdf"
    original.chmod(0o644)
    original.write_bytes(b"changed")
    with pytest.raises(ValueError, match="original"):
        bind_feedback(report, feedback)


def test_feedback_view_escapes_notes_and_uses_image_pixel_geometry(tmp_path):
    report, feedback, _ = inputs(tmp_path)
    before = digest(report)
    out = tmp_path / "review"
    result = write_feedback_view(report, feedback, out)
    assert result["findings"] == 2 and result["publication_eligible"] is False
    html = (out / "index.html").read_text()
    assert "<script>not markup</script>" not in html and "&lt;script&gt;not markup" in html
    assert "&quot;x0&quot;:120" in html or "&quot;x0&quot;: 120" in html
    assert digest(report) == before
    with pytest.raises(ValueError):
        write_feedback_view(report, feedback, out)


def test_case_path_injection_and_duplicate_findings_are_rejected(tmp_path):
    report, feedback, _ = inputs(tmp_path)
    value = json.loads(feedback.read_text())
    value["findings"] *= 2
    feedback.write_text(json.dumps(value))
    with pytest.raises(ValueError, match="Duplicate"):
        bind_feedback(report, feedback)
    value["findings"] = value["findings"][:2]
    bad = json.loads(report.read_text())
    bad["cases"][0]["id"] = "../../unsafe"
    report.write_text(json.dumps(bad))
    value["scan_report_sha256"] = digest(report)
    feedback.write_text(json.dumps(value))
    with pytest.raises(ValueError, match="inventory"):
        bind_feedback(report, feedback)

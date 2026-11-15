import hashlib
import json

import pytest

from tax_pdf import scan_benchmark as module
from tax_pdf.fixtures import scan_bytes
from tax_pdf.models import Page


def test_inverse_rotation_maps_back_to_unchanged_source():
    page = Page(number=1, width=200, height=100, status="ocr_required")
    # Original x=20..60,y=10..30 -> CCW image x'=10..30,y'=140..180.
    box = module.source_box({"x0": 10, "x1": 30, "y0": 140, "y1": 180}, 100, 200, page, 90)
    assert box.model_dump() == {"x0": 20, "top": 10, "x1": 60, "bottom": 30}
    assert (
        module.source_box({"x0": 20, "x1": 60, "y0": 10, "y1": 30}, 200, 100, page).model_dump()
        == box.model_dump()
    )
    with pytest.raises(ValueError):
        module.source_box({"x0": 0, "x1": 1, "y0": 0, "y1": 1}, 100, 200, page, 45)


def test_scan_report_keeps_failed_jobs_and_does_not_invent_accuracy(tmp_path, monkeypatch):
    data = scan_bytes()
    original = tmp_path / "source.pdf"
    original.write_bytes(data)
    manifest = tmp_path / "sources.json"
    manifest.write_text(
        json.dumps(
            {
                "documents": [
                    {
                        "path": "source.pdf",
                        "sha256": hashlib.sha256(data).hexdigest(),
                        "title": "<script>untrusted</script>",
                        "kind": "synthetic",
                        "pages": [1],
                    }
                ]
            }
        )
    )
    monkeypatch.setattr(module, "verify_models", lambda p: "fixture-model-hash")

    def fail(*args, **kwargs):
        raise ValueError("OCR failed")

    monkeypatch.setattr(module, "run_ocr", fail)
    output = tmp_path / "out"
    report = module.scan_benchmark(manifest, tmp_path / "models", output)
    assert report["selected_case_count"] == 3
    assert len(report["cases"]) == 3
    assert sum(v["state"] == "FAILED" for c in report["cases"] for v in c["variants"]) == 6
    assert report["accuracy"]["cer"] is None
    assert report["publication_eligible"] is False
    assert all(c["state"] == "BLOCKED" for c in report["cases"])
    assert all(c["native_status"] == "ocr_required" for c in report["cases"])
    assert (output / report["documents"][0]["package"] / "original.pdf").read_bytes() == data
    html = (output / "index.html").read_text()
    assert "<script>untrusted</script>" not in html and "&lt;script&gt;" in html
    assert {c["transform"] for c in report["cases"]} == {"unchanged", "rotated90", "blurred"}
    assert len({c["image_sha256"] for c in report["cases"]}) == 3


def test_empty_default_layout_is_flagged_and_alternative_stays_unverified(tmp_path, monkeypatch):
    from PIL import Image

    from tax_pdf.fixtures import native_bytes

    data = native_bytes()
    (tmp_path / "source.pdf").write_bytes(data)
    manifest = tmp_path / "sources.json"
    manifest.write_text(
        json.dumps(
            {
                "documents": [
                    {
                        "path": "source.pdf",
                        "sha256": hashlib.sha256(data).hexdigest(),
                        "title": "Synthetic test",
                        "pages": [1],
                    }
                ]
            }
        )
    )
    monkeypatch.setattr(module, "verify_models", lambda p: "fixture-model-hash")

    def candidate(image, models, output, *, psm, languages, deadline):
        with Image.open(image) as im:
            width, height = im.size
        raw = {
            "width": width,
            "height": height,
            "languages": languages.split("+"),
            "engine_versions": {"test": "mock"},
            "blocks": [],
            "text": "",
        }
        if psm == 6:
            line = {
                "text": "<script>candidate</script>",
                "confidence": 70,
                "bbox": {"x0": 20, "y0": 20, "x1": 80, "y1": 40},
            }
            raw["blocks"] = [{"paragraphs": [{"lines": [line]}]}]
            raw["text"] = line["text"]
        output.write_text(json.dumps(raw))
        return raw

    monkeypatch.setattr(module, "run_ocr", candidate)
    output = tmp_path / "out"
    report = module.scan_benchmark(manifest, tmp_path / "models", output)
    variants = report["cases"][0]["variants"]
    assert len(variants) == 4
    assert all("OCR_RETURNED_NO_LINES" in v["quality_issues"] for v in variants if v["psm"] == 3)
    assert all(
        "ALTERNATIVE_LAYOUT_UNVERIFIED" in v["quality_issues"] for v in variants if v["psm"] == 6
    )
    assert report["state"] == "BLOCKED" and report["publication_eligible"] is False
    html = (output / "index.html").read_text()
    assert "layout 3" in html and "layout 6" in html
    assert "OCR_RETURNED_NO_LINES" in html
    assert "<script>candidate</script>" not in html

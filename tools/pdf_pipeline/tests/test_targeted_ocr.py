import json
from pathlib import Path

import pytest
from PIL import Image, ImageDraw, ImageOps
from test_scan_feedback import inputs

from tax_pdf import targeted_ocr as module
from tax_pdf.reference_eval import digest


def trial_inputs(root):
    report, feedback, _ = inputs(root)
    record = json.loads(feedback.read_text())
    source = json.loads(report.read_text())
    for source_case in source["cases"]:
        for variant in source_case["variants"]:
            variant["state"] = "EXPERIMENTAL_NOT_ACCEPTED"
    report.write_text(json.dumps(source))
    record["scan_report_sha256"] = digest(report)
    case = source["cases"][0]
    record["findings"].append(
        {
            "id": "background",
            "case_id": case["id"],
            "category": "foreground_bleed_through_failure",
            "action": "reject_page",
            "user_report": "The scan is wrong",
            "value_scope": "whole page",
        }
    )
    feedback.write_text(json.dumps(record))
    image = root / "row.png"
    source_image = root / case["image"]
    crop = [120, 75, 130, 85]
    with Image.open(source_image) as page, page.crop(crop) as row:
        with ImageOps.expand(row.convert("RGB"), border=16, fill="white") as padded:
            with padded.resize(
                (padded.width * 2, padded.height * 2), Image.Resampling.LANCZOS
            ) as resized:
                resized.save(image)
    baseline = root / "baseline-row.json"
    baseline.write_text('{"text":"raw original"}')
    previous = root / "previous.json"
    previous.write_text(
        json.dumps(
            {
                "scan_report_sha256": digest(report),
                "feedback_sha256": digest(feedback),
                "columns": [
                    {
                        "finding_id": "column",
                        "case_id": case["id"],
                        "source_sha256": case["source_sha256"],
                        "source_image_sha256": case["image_sha256"],
                        "region": record["findings"][0]["regions"][0],
                        "reviewer_expected_sequence": ["1", "2", "3"],
                        "row_candidates": [
                            {
                                "image": "row.png",
                                "image_sha256": digest(image),
                                "text": "raw original",
                                "raw": "baseline-row.json",
                                "raw_sha256": digest(baseline),
                                "source_image_bbox": dict(
                                    zip(("x0", "y0", "x1", "y1"), crop, strict=True)
                                ),
                                "input_transform": {
                                    "crop": crop,
                                    "white_border_pixels": 16,
                                    "resize_factor": 2,
                                },
                            }
                        ],
                    }
                ],
            }
        )
    )
    return report, feedback, previous


def mock_ocr(image, models, path, *, psm, languages, deadline, profile):
    assert languages == "eng" and profile in ("text", "numeric_label")
    with Image.open(image) as im:
        width, height = im.size
    text = "1." if profile == "numeric_label" else "<script>raw candidate</script>"
    raw = {
        "text": text,
        "width": width,
        "height": height,
        "engine_versions": {"test": "mock"},
        "languages": ["eng"],
        "blocks": [
            {
                "paragraphs": [
                    {
                        "lines": [
                            {
                                "text": text,
                                "confidence": 80,
                                "bbox": {
                                    "x0": 1,
                                    "y0": 1,
                                    "x1": min(10, width),
                                    "y1": min(10, height),
                                },
                            }
                        ]
                    }
                ]
            }
        ],
    }
    path.write_text(json.dumps(raw))
    return raw


def test_label_parser_keeps_digits_and_punctuation_distinct_without_glyph_repair():
    assert module.numeric_label(" 01.\n") == {"digits": "01", "delimiter": ".", "raw": " 01.\n"}
    for text in ("I.", "a", "Bi", "3:", "५", "1 2", "-1", "0.5", "1234", "."):
        assert module.numeric_label(text) is None


def test_background_controls_preserve_original_and_expose_faint_loss_risk():
    with Image.new("RGB", (240, 300), "white") as source:
        draw = ImageDraw.Draw(source)
        for y in range(300):
            draw.line((0, y, 239, y), fill=(180 + y // 10,) * 3)
        draw.rectangle((50, 80, 180, 85), fill="black")
        draw.rectangle((50, 130, 180, 135), fill=(188,) * 3)
        original = source.tobytes()
        controls = module.image_controls(source)
        try:
            assert source.tobytes() == original
            assert set(controls) == {"grayscale", "flattened", "ink-threshold"}
            assert all(im.size == source.size for im in controls.values())
            assert controls["flattened"].getpixel((80, 82)) < 120
            # The threshold may erase faint foreground: this is why no variant
            # becomes a certified bleed-through mask or an automatic clean page.
            assert controls["ink-threshold"].getpixel((80, 132)) == 255
        finally:
            for im in controls.values():
                im.close()


def test_targets_keep_all_variants_and_do_not_complete_expected_numbers(tmp_path, monkeypatch):
    report, feedback, previous = trial_inputs(tmp_path)
    monkeypatch.setattr(module, "verify_models", lambda p: "mock-models")
    jobs = []

    def ocr(*args, **kwargs):
        jobs.append(kwargs.copy())
        assert set(kwargs) == {"psm", "languages", "deadline", "profile"}
        return mock_ocr(*args, **kwargs)

    monkeypatch.setattr(module, "run_ocr", ocr)
    out = tmp_path / "out"
    result = module.targeted_trials(report, feedback, previous, tmp_path / "models", out)
    assert len(jobs) == 10  # one reviewed row, all nine foreground alternatives
    col = result["numeric_columns"][0]
    assert col["parsed_digits"] == ["1"] and not col["matches_reviewer_numbers"]
    assert col["independent_ocr"]["state"] == "NOT_REQUESTED"
    foreground = result["foreground"]
    assert len(foreground["attempts"]) == 9 and foreground["state"] == "BLOCKED"
    assert foreground["selected_variant"] is None
    assert all(
        a["accuracy"] is None and "FAINT_FOREGROUND_LOSS_UNMEASURED" in a["holds"]
        for a in foreground["attempts"]
    )
    strips = [a for a in foreground["attempts"] if a["scope"] == "overlapping_strip"]
    assert len(strips) == 3
    assert strips[1]["source_lines"][0]["bbox"]["top"] > 0
    html = (out / "index.html").read_text()
    assert "<script>raw candidate</script>" not in html and "&lt;script&gt;" in html
    assert not result["publication_eligible"]
    with pytest.raises(ValueError):
        module.targeted_trials(report, feedback, previous, tmp_path / "models", out)


def test_updated_hash_cannot_disguise_wrong_row_pixels(tmp_path, monkeypatch):
    report, feedback, previous = trial_inputs(tmp_path)
    monkeypatch.setattr(module, "verify_models", lambda p: "mock-models")
    with Image.new("RGB", (84, 84), "black") as im:
        im.save(tmp_path / "row.png")
    value = json.loads(previous.read_text())
    value["columns"][0]["row_candidates"][0]["image_sha256"] = digest(tmp_path / "row.png")
    previous.write_text(json.dumps(value))
    with pytest.raises(ValueError, match="pixels do not derive"):
        module.targeted_trials(report, feedback, previous, tmp_path / "models", tmp_path / "out")
    assert not (tmp_path / "out").exists()


def test_baseline_summary_must_match_preserved_raw_ocr(tmp_path, monkeypatch):
    report, feedback, previous = trial_inputs(tmp_path)
    monkeypatch.setattr(module, "verify_models", lambda p: "mock-models")
    value = json.loads(previous.read_text())
    value["columns"][0]["row_candidates"][0]["text"] = "rewritten label"
    previous.write_text(json.dumps(value))
    with pytest.raises(ValueError, match="differs from raw OCR"):
        module.targeted_trials(report, feedback, previous, tmp_path / "models", tmp_path / "out")
    assert not (tmp_path / "out").exists()


def test_independent_ocr_receives_only_pixels_and_retains_disagreement(tmp_path, monkeypatch):
    from tax_pdf import refine_compare

    report, feedback, previous = trial_inputs(tmp_path)
    monkeypatch.setattr(module, "verify_models", lambda p: "mock-models")
    monkeypatch.setattr(module, "run_ocr", mock_ocr)

    def probe(requests, models, out, *, timeout):
        assert 0 < timeout <= 180
        records = []
        for request in requests:
            assert set(request) == {"id", "image"}
            with Image.open(request["image"]) as im:
                width, height = im.size
            records.append(
                {
                    "id": request["id"],
                    "text": "7",
                    "width": width,
                    "height": height,
                    "blocks": [],
                    "image_sha256": digest(Path(request["image"])),
                }
            )
        raw = {
            "records": records,
            "model_manifest_sha256": "mock-easy-models",
            "versions": {"test": "mock"},
        }
        out.write_text(json.dumps(raw))
        return raw

    monkeypatch.setattr(refine_compare, "run_probe", probe)
    result = module.targeted_trials(
        report,
        feedback,
        previous,
        tmp_path / "models",
        tmp_path / "out",
        easyocr_models=tmp_path / "easy",
    )
    col = result["numeric_columns"][0]
    assert col["parsed_digits"] == ["1"] and col["independent_ocr"]["parsed_digits"] == ["7"]
    assert col["accepted"] is False and not col["independent_ocr"]["selected"]
    assert not col["independent_ocr"]["matches_reviewer_numbers"]


def test_failed_jobs_stay_visible_and_do_not_become_blank_successes(tmp_path, monkeypatch):
    report, feedback, previous = trial_inputs(tmp_path)
    monkeypatch.setattr(module, "verify_models", lambda p: "mock-models")

    def fail(*args, **kwargs):
        raise ValueError("sensitive parser detail")

    monkeypatch.setattr(module, "run_ocr", fail)
    result = module.targeted_trials(
        report, feedback, previous, tmp_path / "models", tmp_path / "out"
    )
    assert result["numeric_columns"][0]["parsed_digits"] == [None]
    assert all(a["state"] == "FAILED" and a["text"] == "" for a in result["foreground"]["attempts"])
    assert "sensitive parser detail" not in json.dumps(result)

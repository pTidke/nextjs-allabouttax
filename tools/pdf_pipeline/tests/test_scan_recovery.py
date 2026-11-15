import json
from datetime import UTC, datetime

import pytest
from PIL import Image, ImageDraw
from test_scan_feedback import inputs

from tax_pdf import scan_recovery as module
from tax_pdf.models import Page
from tax_pdf.reference_eval import Reference, sha_json


def test_ink_bands_are_detected_from_pixels_not_sequence_length():
    with Image.new("L", (40, 110), 255) as image:
        draw = ImageDraw.Draw(image)
        for top in (5, 40, 75):
            draw.rectangle((12, top, 25, top + 10), fill=0)
        draw.point((20, 99), fill=0)
        kept, discarded = module.ink_bands(image)
        assert kept == [[5, 16], [40, 51], [75, 86]]
        assert discarded == [[99, 100]]
        with Image.new("L", (10, 10), 255) as blank:
            assert module.ink_bands(blank) == ([], [])


@pytest.mark.parametrize(
    "angle,box,dims",
    [
        (0, {"x0": 20, "y0": 10, "x1": 60, "y1": 30}, (200, 100)),
        (90, {"x0": 10, "y0": 140, "x1": 30, "y1": 180}, (100, 200)),
        (180, {"x0": 140, "y0": 70, "x1": 180, "y1": 90}, (200, 100)),
        (270, {"x0": 70, "y0": 20, "x1": 90, "y1": 60}, (100, 200)),
    ],
)
def test_quarter_turn_boxes_return_to_original_page(angle, box, dims):
    page = Page(number=1, width=200, height=100, status="ocr_required")
    assert module.inverse_box(box, *dims, page, angle) == {
        "x0": 20,
        "top": 10,
        "x1": 60,
        "bottom": 30,
    }
    with pytest.raises(ValueError):
        module.inverse_box(box, *dims, page, 45)


def reference_file(root, report):
    data = json.loads(report.read_text())
    case = data["cases"][0]
    ref = Reference(
        id="fixture-p1",
        source_sha256=case["source_sha256"],
        render_sha256=case["source_render_sha256"],
        page=1,
        kind="synthetic",
        template_group="mock-fixture",
        expected_text="AUTHORED TEXT",
    )
    value = ref.model_dump(mode="json")
    value.update(
        status="AUTHORED_SYNTHETIC",
        verification={
            "reviewer": "Test author",
            "checked_at": datetime.now(UTC).isoformat(),
            "method": "fixture_authoring_contract",
            "annotation_sha256": sha_json(ref.annotation()),
        },
    )
    file = root / "reference.json"
    file.write_text(json.dumps(value))
    return file


def test_recovery_keeps_unmatched_rows_and_all_angles_without_label_hints(tmp_path, monkeypatch):
    report, feedback, _ = inputs(tmp_path)
    reference = reference_file(tmp_path, report)
    monkeypatch.setattr(module, "verify_models", lambda p: "mock-weights")
    monkeypatch.setattr(module, "ink_bands", lambda im: ([[1, 5], [12, 17]], []))
    jobs = []

    def ocr(image, models, output, *, psm, languages, deadline):
        jobs.append((image.name, psm, languages))
        assert "AUTHORED TEXT" not in image.name
        with Image.open(image) as im:
            width, height = im.size
        raw = {
            "text": "X",
            "width": width,
            "height": height,
            "blocks": [],
            "engine_versions": {"test": "mock"},
        }
        output.write_text(json.dumps(raw))
        return raw

    monkeypatch.setattr(module, "run_ocr", ocr)
    out = tmp_path / "out"
    result = module.recover_scans(report, feedback, tmp_path / "models", reference, out)
    assert len(jobs) == 10  # two detected rows, eight angle/language attempts
    column = result["columns"][0]
    assert column["observed"] == ["X", "X"]
    assert column["reviewer_expected_sequence"] == ["1", "2", "3"]
    assert not column["sequence_matches_review"]  # never complete the expected third number
    assert len(result["orientation_attempts"]) == 8 and result["selected_orientation"] is None
    assert all(a["diagnostic"]["character_edits"] > 0 for a in result["orientation_attempts"])
    assert not result["publication_eligible"]
    with pytest.raises(ValueError):
        module.recover_scans(report, feedback, tmp_path / "models", reference, out)


def test_failures_are_retained_with_full_omission_scores(tmp_path, monkeypatch):
    report, feedback, _ = inputs(tmp_path)
    ref = reference_file(tmp_path, report)
    monkeypatch.setattr(module, "verify_models", lambda p: "mock-weights")
    monkeypatch.setattr(module, "ink_bands", lambda im: ([[1, 5]], []))

    def fail(*args, **kwargs):
        raise ValueError("sensitive parser detail")

    monkeypatch.setattr(module, "run_ocr", fail)
    result = module.recover_scans(report, feedback, tmp_path / "models", ref, tmp_path / "out")
    assert result["columns"][0]["observed"] == [""]
    assert all(
        a["state"] == "FAILED" and a["diagnostic"]["missing_output"]
        for a in result["orientation_attempts"]
    )
    assert "sensitive parser detail" not in json.dumps(result)

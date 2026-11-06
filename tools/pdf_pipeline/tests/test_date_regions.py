from copy import deepcopy

import pytest

from tax_pdf.date_disagreement import compare_inputs, compare_regions
from tax_pdf.date_regions import date_evidence, region_box
from tax_pdf.date_review import date_findings
from tax_pdf.models import Page


def candidate(texts, *, split_paragraph=False, second_left=10, gap=10):
    lines = []
    top = 10
    for i, text in enumerate(texts):
        left = 10 if not i else second_left
        lines.append(
            {
                "text": text,
                "confidence": 99,
                "bbox": {"x0": left, "y0": top, "x1": left + 200, "y1": top + 20},
            }
        )
        top += 20 + gap
    paragraphs = [{"lines": [line]} for line in lines] if split_paragraph else [{"lines": lines}]
    raw = {
        "width": 800,
        "height": 600,
        "languages": ["eng"],
        "blocks": [{"paragraphs": paragraphs}],
    }
    return raw


def evidence(raw):
    return date_evidence(raw, Page(number=1, width=400, height=300, status="ocr_required"))


def test_split_date_retains_exact_source_fragments_without_rewriting_raw():
    raw = candidate(["  from 31*\n", "October, 2025 to 10th December, 2025\n"])
    before = deepcopy(raw)
    rows = evidence(raw)
    (cross,) = [r for r in rows if r["cross_line"]]
    assert cross["raw"] == "31* October, 2025"
    assert cross["codes"] == ["DATE_SUFFIX_MARK_REVIEW"]
    assert [f["text"] for f in cross["fragments"]] == ["31*", "October, 2025"]
    for f in cross["fragments"]:
        assert f["line_text"][f["start"] : f["end"]] == f["text"]
    assert not cross["reading_order_verified"] and cross["suggested_replacement"] is None
    assert len(rows) == 2  # the second date is not repeated by the two-line window
    assert raw == before


@pytest.mark.parametrize("kwargs", [{"split_paragraph": True}, {"second_left": 500}, {"gap": 100}])
def test_search_windows_do_not_bridge_paragraphs_columns_or_large_gaps(kwargs):
    assert evidence(candidate(["31*", "October, 2025"], **kwargs)) == []


def test_three_line_date_and_repeated_occurrences_keep_separate_source_locations():
    rows = evidence(candidate(["31*", "March", "2026", "31* March 2026"]))
    assert len(rows) == 2
    assert len(rows[0]["fragments"]) == 3 and not rows[1]["cross_line"]
    assert rows[0]["fragments"][0]["line_number"] != rows[1]["fragments"][0]["line_number"]


@pytest.mark.parametrize("text", ["1070 December, 2025", "001 January 2026", "999999 May 2026"])
def test_corrupted_day_width_is_reviewed_not_repaired(text):
    found = date_findings(text)
    assert len(found) == 1 and "DAY_DIGIT_COUNT_REVIEW" in found[0]["codes"]
    assert found[0]["raw"] == text


def test_word_boxes_are_used_only_with_complete_literal_alignment():
    line = candidate(["31* March 2026"])["blocks"][0]["paragraphs"][0]["lines"][0]
    line["words"] = [
        {"text": t, "bbox": {"x0": 10 + i * 50, "y0": 10, "x1": 50 + i * 50, "y1": 30}}
        for i, t in enumerate(["31*", "March", "2026"])
    ]
    box, precision = region_box(line, 0, 3, 800, 600)
    assert precision == "word" and box["x1"] == 50
    line["words"][1]["text"] = "Changed"
    assert region_box(line, 0, 3, 800, 600) == (line["bbox"], "line")
    line["words"][1]["text"] = "March"
    line["words"][0]["bbox"]["x1"] = 900
    with pytest.raises(ValueError):
        region_box(line, 0, 3, 800, 600)


def region(identity, text, x=10, y=10):
    return {
        "id": identity,
        "raw": text,
        "fragments": [{"image_bbox": {"x0": x, "y0": y, "x1": x + 50, "y1": y + 20}}],
    }


def test_disagreements_keep_literal_digits_and_missing_candidates():
    left = [region("a", "10th December 2025"), region("b", "31* March 2026", y=100)]
    right = [region("c", "1070 December 2025")]
    r = compare_regions(left, right)
    assert [f["kind"] for f in r["flags"]] == ["DATE_OCR_DISAGREEMENT", "UNMATCHED_DATE_REGION"]
    assert r["selected_candidate"] is None and r["accuracy"] is None
    assert left[0]["raw"] == "10th December 2025" and right[0]["raw"] == "1070 December 2025"


def test_identical_wrong_text_is_only_surface_agreement():
    r = compare_regions([region("a", "31* March 2026")], [region("b", "31* March 2026")])
    assert r["same_surface_text_unverified"] == 1 and r["flags"] == []
    assert r["selected_candidate"] is None


def test_ambiguous_geometry_is_not_forced_into_a_match():
    r = compare_regions(
        [region("a", "31 March 2026")], [region("b", "31 March 2026"), region("c", "30 March 2026")]
    )
    assert [f["kind"] for f in r["flags"]] == ["AMBIGUOUS_DATE_ALIGNMENT"]
    assert r["same_surface_text_unverified"] == 0


def test_same_text_at_a_different_location_does_not_hide_omissions():
    r = compare_regions([region("a", "31 March 2026")], [region("b", "31 March 2026", y=100)])
    assert len(r["flags"]) == 2 and all(f["kind"] == "UNMATCHED_DATE_REGION" for f in r["flags"])


def test_comparisons_do_not_cross_sources_pages_or_count_duplicate_raw_as_independent():
    a = {
        "id": "a",
        "source_sha256": "one",
        "page": 1,
        "source_render_sha256": "render",
        "state": "REVIEW_REQUIRED",
        "raw_sha256": "same",
        "date_evidence": [region("date-1", "31* March 2026")],
    }
    assert compare_inputs([a, {**a, "id": "b", "page": 2}]) == []
    assert compare_inputs([a, {**a, "id": "b", "source_sha256": "other"}]) == []
    assert compare_inputs([a, {**a, "id": "b"}])[0]["state"] == "DUPLICATE_EVIDENCE_NOT_INDEPENDENT"
    assert (
        compare_inputs([a, {**a, "id": "b", "state": "NOT_ASSESSED"}])[0]["state"]
        == "NOT_COMPARABLE"
    )

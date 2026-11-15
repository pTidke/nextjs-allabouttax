import json
from copy import deepcopy
from pathlib import Path

import pytest

from tax_pdf.date_regions import date_evidence
from tax_pdf.models import Page, Table


def raw_rows(rows):
    return {
        "width": 800,
        "height": 600,
        "languages": ["eng"],
        "blocks": [{"paragraphs": [{"lines": [r]} for r in rows]}],
    }


def line(text, x0, x1, *, y0=100, y1=120):
    return {"text": text, "bbox": {"x0": x0, "y0": y0, "x1": x1, "y1": y1}, "confidence": 99}


def evidence(raw, page=None):
    return date_evidence(raw, page or Page(number=1, width=800, height=600, status="ocr_required"))


def test_displaced_corrupt_day_gets_a_spatial_hint_without_reference_or_repair():
    # The confirmed circular regression: the provider returns day after month/year.
    raw = raw_rows([line("Dated", 100, 150), line("March, 2024", 195, 310), line("0sth", 153, 193)])
    before = deepcopy(raw)
    (result,) = evidence(raw)
    assert result["raw"] == "Dated 0sth March, 2024"
    assert [f["line_number"] for f in result["fragments"]] == [1, 3, 2]
    assert "DATE_SPATIAL_FRAGMENTS_REVIEW" in result["codes"]
    assert "CALENDAR_DATE_REVIEW" in result["codes"]
    assert result["provider_order_differs"] is True
    assert result["reading_order_verified"] is False and result["suggested_replacement"] is None
    for f in result["fragments"]:
        assert f["line_text"][f["start"] : f["end"]] == f["text"]
    assert raw == before


def test_separate_raised_ordinal_stays_separate_in_literal_search_view():
    raw = raw_rows(
        [
            line("31", 100, 125),
            line("March 2026", 145, 250),
            line("st", 128, 143, y0=95, y1=107),
        ]
    )
    (result,) = evidence(raw)
    assert result["raw"] == "31 st March 2026"
    assert "DATE_FRAGMENT_UNPARSED_REVIEW" in result["codes"]
    assert [f["text"] for f in result["fragments"]] == ["31", "st", "March 2026"]
    assert result["suggested_replacement"] is None


@pytest.mark.parametrize("defect", ["column", "row", "plain_number", "prose", "native_table"])
def test_no_spatial_bridge_for_unanchored_or_separated_content(defect):
    first = line("05th", 100, 150)
    month = line("March 2024", 155, 270)
    page = Page(number=1, width=800, height=600, status="ocr_required")
    if defect == "column":
        month["bbox"].update(x0=400, x1=550)
    elif defect == "row":
        month["bbox"].update(y0=200, y1=220)
    elif defect == "plain_number":
        first["text"] = "5"
    elif defect == "prose":
        first["text"] = "Section 5"
    else:
        page.tables = [
            Table.model_validate(
                {
                    "id": "p1-t1",
                    "bbox": {"x0": 90, "top": 90, "x1": 300, "bottom": 130},
                    "rows": 1,
                    "columns": 1,
                    "cells": [{"id": "cell", "row": 0, "column": 0, "raw_text": "", "bbox": None}],
                }
            )
        ]
    assert evidence(raw_rows([first, month]), page) == []


def test_competing_day_fragments_are_all_retained_and_flagged():
    raw = raw_rows([line("05th", 100, 150), line("06th", 102, 152), line("March 2024", 155, 270)])
    results = evidence(raw)
    assert {r["raw"] for r in results} == {"05th March 2024", "06th March 2024"}
    assert all("DATE_FRAGMENT_AMBIGUITY_REVIEW" in r["codes"] for r in results)
    assert all(r["suggested_replacement"] is None for r in results)


def test_single_line_correct_dates_and_existing_error_warnings_do_not_change():
    raw = raw_rows([line("01st April 2024", 100, 280), line('05" March 2024', 400, 580)])
    results = evidence(raw)
    assert len(results) == 2
    assert results[0]["codes"] == []
    assert results[1]["codes"] == ["DATE_SUFFIX_MARK_REVIEW"]
    assert all(not r["cross_line"] for r in results)


def test_spatial_neighbor_budget_fails_closed_on_dense_overlapping_alternatives():
    raw = raw_rows([line("05th", 100 + i * 0.1, 150 + i * 0.1) for i in range(9)])
    raw["blocks"][0]["paragraphs"].append({"lines": [line("March 2024", 155, 270)]})
    with pytest.raises(ValueError, match="neighbor budget"):
        evidence(raw)


@pytest.mark.parametrize("budget", ["anchor", "path"])
def test_anchor_and_branching_budgets_are_explicit(budget):
    if budget == "anchor":
        raw = raw_rows([line("March 2024", 175, 300) for _ in range(101)])
    else:
        raw = raw_rows(
            [line("05th", x + i * 0.1, x + 5 + i * 0.1) for x in (80, 110, 140) for i in range(4)]
            + [line("March 2024", 175, 300)]
        )
    with pytest.raises(ValueError, match=f"{budget} budget"):
        evidence(raw)


def test_real_displaced_date_regression_uses_only_original_text_and_geometry():
    fixture = json.loads(
        (Path(__file__).parent / "fixtures/circular2-displaced-date.json").read_text()
    )
    raw = fixture["raw"]
    before = deepcopy(raw)
    page = Page(number=1, status="ocr_required", **fixture["page"])
    (result,) = evidence(raw, page)
    assert result["raw"] == "Dated 0sth March, 2024"
    assert [
        fixture["original_line_numbers"][f["line_number"] - 1] for f in result["fragments"]
    ] == [8, 64, 9]
    assert "CALENDAR_DATE_REVIEW" in result["codes"]
    assert result["suggested_replacement"] is None and result["provider_order_differs"] is True
    assert raw == before

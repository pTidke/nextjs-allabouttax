from copy import deepcopy

import pytest

from tax_pdf.models import Table
from tax_pdf.table_projection import project_character_row


def source_row():
    texts = ["Last\nName/Surname", "A", "", "B", "(", "C", ")", ""]
    return Table.model_validate(
        {
            "id": "p1-t1",
            "bbox": {"x0": 0, "top": 0, "x1": 80, "bottom": 10},
            "rows": 1,
            "columns": len(texts),
            "cells": [
                {
                    "id": f"cell-{i}",
                    "row": 0,
                    "column": i,
                    "raw_text": text,
                    "bbox": {"x0": i * 10, "top": 0, "x1": (i + 1) * 10, "bottom": 10},
                }
                for i, text in enumerate(texts)
            ],
        }
    )


def test_source_projection_keeps_word_gaps_punctuation_padding_and_cells():
    table = source_row()
    before = deepcopy(table.model_dump())
    table.cells.reverse()  # Source position, not input-list order, determines display.
    result = project_character_row(table, 0)
    assert result["display_value"] == "A B(C)"
    assert result["padded_value"] == "A B(C) "
    assert result["raw_label"] == "Last\nName/Surname"
    assert result["source_cells"] == before["cells"]
    assert table.model_dump()["cells"] == list(reversed(before["cells"]))
    assert result["structure_verified"] is False and result["publication_eligible"] is False
    assert "EMPTY_SLOTS_ARE_NOT_VERIFIED_BLANKS" in result["holds"]


@pytest.mark.parametrize("defect", ["unknown", "prose", "control", "unicode", "missing", "id"])
def test_unresolved_or_non_character_grids_cannot_silently_become_names(defect):
    table = source_row()
    if defect == "unknown":
        table.cells[1].raw_text = None
    elif defect == "prose":
        table.cells[1].raw_text = "PRIVATE LIMITED"
    elif defect == "control":
        table.cells[1].raw_text = "\n"
    elif defect == "unicode":
        table.cells[1].raw_text = "क"
    elif defect == "missing":
        table.cells.pop()
    else:
        table.cells[1].id = table.cells[2].id
    with pytest.raises(ValueError):
        project_character_row(table, 0)


@pytest.mark.parametrize("defect", ["swap", "band", "outside", "span", "no_box"])
def test_geometry_and_span_defects_stay_held(defect):
    table = source_row()
    if defect == "swap":
        table.cells[1].bbox, table.cells[2].bbox = table.cells[2].bbox, table.cells[1].bbox
    elif defect == "band":
        table.cells[1].bbox.top = 2
    elif defect == "outside":
        table.cells[-1].bbox.x1 = 90
    elif defect == "span":
        table.cells[1].column_span = 2
    else:
        table.cells[0].bbox = None
    with pytest.raises(ValueError):
        project_character_row(table, 0)


@pytest.mark.parametrize("row", [True, -1, 1, 0.0])
def test_invalid_row_selection_is_rejected(row):
    with pytest.raises(ValueError):
        project_character_row(source_row(), row)

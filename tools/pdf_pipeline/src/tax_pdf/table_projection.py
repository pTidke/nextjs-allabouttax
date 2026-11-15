"""Read-only projections of explicitly chosen ASCII character-box table rows.

This does not detect forms, infer an entity type, join rows or approve blanks.
References are compared by the caller after projection, never passed in here.
"""

from .models import Table
from .table_review import table_digest


def project_character_row(table: Table, row: int) -> dict:
    if (
        type(row) is not int
        or not 0 <= row < table.rows
        or table.columns < 2
        or table.columns > 256
        or table.rows > 1000
        or len(table.cells) > 10000
    ):
        raise ValueError("Character-box projection exceeds row/grid bounds")
    # Revalidate even model_copy updates, and retain the complete source grid.
    table = Table.model_validate(table.model_dump())
    if len({c.id for c in table.cells}) != len(table.cells):
        raise ValueError("Source cell identities must be unique")
    cells = sorted((c for c in table.cells if c.row == row), key=lambda c: c.column)
    anchor = cells[0]
    if anchor.raw_text is None or not anchor.raw_text.strip():
        raise ValueError("A visible label cell is required")
    previous = None
    for cell in cells:
        box = cell.bbox
        if (
            box is None
            or box.x1 <= box.x0
            or box.bottom <= box.top
            or box.x0 < table.bbox.x0 - 0.01
            or box.top < table.bbox.top - 0.01
            or box.x1 > table.bbox.x1 + 0.01
            or box.bottom > table.bbox.bottom + 0.01
            or (previous is not None and box.x0 < previous.x1 - 0.01)
        ):
            raise ValueError("Cell geometry does not preserve left-to-right source order")
        if abs(box.top - anchor.bbox.top) > 0.1 or abs(box.bottom - anchor.bbox.bottom) > 0.1:
            raise ValueError("Value cells must share their label's source row band")
        if cell.row_span not in (None, 1) or cell.column_span not in (None, 1):
            raise ValueError("Spanning cells are not character-box slots")
        previous = box
    slots = cells[1:]
    if any(
        c.raw_text is None
        or len(c.raw_text) > 1
        or (c.raw_text and not 32 <= ord(c.raw_text) <= 126)
        for c in slots
    ):
        raise ValueError("Value slots require one printable ASCII character or an empty candidate")
    padded = "".join(c.raw_text if c.raw_text else " " for c in slots)
    return {
        "state": "CHARACTER_ROW_PROJECTION_NOT_ACCEPTED",
        "table_id": table.id,
        "table_sha256": table_digest(table),
        "row": row,
        "raw_label": anchor.raw_text,
        "label_cell_id": anchor.id,
        "padded_value": padded,
        "display_value": padded.rstrip(" "),
        "source_cells": [c.model_dump() for c in cells],
        "gap_policy": "Empty candidate slots display as spaces; only right padding is hidden.",
        "holds": [
            "EMPTY_SLOTS_ARE_NOT_VERIFIED_BLANKS",
            "RELATIONSHIP_REQUIRES_SOURCE_REVIEW",
            "NO_CROSS_ROW_OR_ENTITY_INFERENCE",
        ],
        "structure_verified": False,
        "publication_eligible": False,
    }

"""Inspect raw provider table claims without completing grids or accepting cells."""

import math


def number(value):
    return type(value) in {float, int} and math.isfinite(value)


def box_on_page(box, width, height):
    """Return top-left percentages only for known origins and valid same-page geometry."""
    if not (number(width) and number(height) and width > 0 and height > 0):
        return None
    if not isinstance(box, dict) or not all(number(box.get(k)) for k in ("l", "t", "r", "b")):
        return None
    left, top, right, bottom = (box[k] for k in ("l", "t", "r", "b"))
    if box.get("coord_origin") == "BOTTOMLEFT":
        top, bottom = height - top, height - bottom
    elif box.get("coord_origin") != "TOPLEFT":
        return None
    if not (0 <= left < right <= width and 0 <= top < bottom <= height):
        return None
    return {
        "x": 100 * left / width,
        "y": 100 * top / height,
        "width": 100 * (right - left) / width,
        "height": 100 * (bottom - top) / height,
    }


def table_inventory(raw):
    tables = raw.get("tables", [])
    if not isinstance(tables, list) or len(tables) > 50:
        raise ValueError("Provider table inventory exceeds budget")
    page = raw.get("pages", {}).get("1", {})
    size = page.get("size", {})
    width, height = size.get("width"), size.get("height")
    valid_size = number(width) and number(height) and width > 0 and height > 0
    result = []
    total = 0
    for index, table in enumerate(tables):
        data = table.get("data", {})
        rows, cols = data.get("num_rows"), data.get("num_cols")
        cells = data.get("table_cells", [])
        if not isinstance(cells, list) or len(cells) > 10000:
            raise ValueError("Provider cell inventory exceeds budget")
        total += len(cells)
        if total > 20000:
            raise ValueError("Provider cells exceed page budget")
        valid_grid = (
            type(rows) is int
            and type(cols) is int
            and 0 < rows * cols <= 20000
            and rows > 0
            and cols > 0
        )
        holds = {"PROVIDER_STRUCTURE_UNVERIFIED", "EMPTY_TEXT_IS_NOT_CONFIRMED_BLANK"}
        if not valid_grid:
            holds.add("INVALID_GRID_DIMENSIONS")
        prov = table.get("prov", [])
        same_page = len(prov) == 1 and prov[0].get("page_no") == 1
        occupied, candidates = {}, []
        span_budget = 0
        for cell in cells:
            keys = (
                "start_row_offset_idx",
                "end_row_offset_idx",
                "start_col_offset_idx",
                "end_col_offset_idx",
            )
            r0, r1, c0, c1 = (cell.get(k) for k in keys)
            valid_span = (
                valid_grid
                and all(type(x) is int for x in (r0, r1, c0, c1))
                and 0 <= r0 < r1 <= rows
                and 0 <= c0 < c1 <= cols
            )
            if valid_span:
                span_budget += (r1 - r0) * (c1 - c0)
                if span_budget > 100000:
                    raise ValueError("Provider span claims exceed inspection budget")
                for row in range(r0, r1):
                    for col in range(c0, c1):
                        occupied[(row, col)] = occupied.get((row, col), 0) + 1
            else:
                holds.add("INVALID_CELL_SPAN")
            geometry = (
                box_on_page(cell.get("bbox"), width, height) if valid_size and same_page else None
            )
            if geometry is None:
                holds.add("CELL_GEOMETRY_UNAVAILABLE")
            candidates.append(
                {
                    "text": cell.get("text"),
                    "row_start": r0,
                    "row_end": r1,
                    "column_start": c0,
                    "column_end": c1,
                    "provider_column_header": cell.get("column_header"),
                    "provider_row_header": cell.get("row_header"),
                    "span_in_bounds": bool(valid_span),
                    "image_percent_box": geometry,
                    "verified": False,
                }
            )
        overlaps = sum(count > 1 for count in occupied.values())
        uncovered = rows * cols - len(occupied) if valid_grid else None
        if overlaps:
            holds.add("OVERLAPPING_CELL_CLAIMS")
        if uncovered:
            holds.add("UNCOVERED_GRID_POSITIONS")
        table_box = (
            box_on_page(prov[0].get("bbox"), width, height) if same_page and valid_size else None
        )
        if table_box is None:
            holds.add("TABLE_GEOMETRY_UNAVAILABLE")
        result.append(
            {
                "id": f"provider-table-{index + 1}",
                "provider_reference": table.get("self_ref"),
                "rows_claimed": rows,
                "columns_claimed": cols,
                "cells_retained": len(cells),
                "uncovered_positions": uncovered,
                "overlapping_positions": overlaps,
                "image_percent_box": table_box,
                "holds": sorted(holds),
                "cells": candidates,
            }
        )
    return {
        "state": "PROVIDER_TABLE_CLAIMS_NOT_ACCEPTED",
        "publication_eligible": False,
        "provider_page_size": size,
        "tables": result,
        "cells_retained": total,
    }

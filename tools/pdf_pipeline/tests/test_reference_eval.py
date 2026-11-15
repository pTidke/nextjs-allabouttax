import itertools
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from tax_pdf.reference_eval import (
    Reference,
    aggregate,
    distance,
    normalize,
    score_candidate,
    score_tables,
    score_text,
    sha_json,
)
from tax_pdf.reference_pack import synthetic_table


def slow_distance(a, b):
    row = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        nxt = [i]
        for j, y in enumerate(b, 1):
            nxt.append(min(nxt[-1] + 1, row[j] + 1, row[j - 1] + (x != y)))
        row = nxt
    return row[-1]


def reference(**changes):
    return Reference(
        id="test-p1",
        source_sha256="a" * 64,
        render_sha256="b" * 64,
        page=1,
        kind="official",
        template_group="group",
        **changes,
    )


def verified(ref):
    value = ref.model_dump(mode="json")
    value.update(
        status="HUMAN_VERIFIED",
        verification={
            "reviewer": "Test reviewer",
            "checked_at": datetime.now(UTC).isoformat(),
            "method": "visual_source_comparison",
            "annotation_sha256": sha_json(ref.annotation()),
        },
    )
    return Reference.model_validate(value)


def candidate(ref, text=""):
    return {
        "binding": {k: getattr(ref, k) for k in ("source_sha256", "render_sha256", "page")},
        "text": text,
        "tables": [],
        "failed": False,
        "claims_clean": False,
    }


def test_exact_edit_distance_matches_independent_dynamic_program():
    values = [""] + ["".join(x) for n in range(1, 5) for x in itertools.product("ab", repeat=n)]
    for a, b in itertools.product(values, repeat=2):
        assert distance(a, b) == slow_distance(a, b)
    assert distance(["हिन्दी", "0", "-"], ["हिंदी", "0", ""]) == 2
    assert distance("a" * 10000, "a" * 9999 + "b") == 1


def test_normalization_cannot_hide_financial_or_language_errors():
    assert normalize("Cafe\u0301\n  हिन्दी") == "Café हिन्दी"
    for a, b in [
        ("1.5%", "15%"),
        ("1,00,000", "100000"),
        ("not exempt", "exempt"),
        ("06", "Q€"),
        ("Hardev Singh", "Hardev singh"),
        ("हिन्दी", "Hindi"),
    ]:
        assert score_text(a, b, [a])["character_edits"] > 0
    assert score_text("a", "aaaa", ["a"])["character_edits"] == 3


def test_proposals_never_score_and_changed_verified_annotations_are_rejected():
    ref = reference(expected_text="proposed")
    assert score_candidate(ref, candidate(ref, "proposed"))["text"] is None
    ref = verified(ref)
    changed = ref.model_dump(mode="json")
    changed["expected_text"] = "new proposed text"
    with pytest.raises(ValidationError):
        Reference.model_validate(changed)
    changed = ref.model_dump(mode="json")
    changed["status"] = "AUTHORED_SYNTHETIC"
    with pytest.raises(ValidationError):
        Reference.model_validate(changed)
    with pytest.raises(ValidationError):
        verified(reference())


def test_missing_failed_attempts_stay_in_micro_denominator_and_false_clean():
    ref = verified(reference(expected_text="Rate 1.5%", critical_strings=["1.5%"]))
    a = candidate(ref, "Rate 1.5%")
    b = {**candidate(ref), "failed": True, "claims_clean": True}
    rows = [{"score": score_candidate(ref, c)} for c in (a, b)]
    result = aggregate(rows)
    assert result["scored_attempts"] == 2
    assert result["cer"] == result["wer"] == 0.5
    assert result["missing_output_attempts"] == result["failed_attempts"] == 1
    assert result["critical_count_matches"] == 1 and result["critical_count_checks"] == 2
    assert result["false_clean_text_claims"] == 1
    assert result["accepted_extractions"] == 0


def test_wrong_page_or_incomplete_identity_rejected_even_for_proposal():
    ref = reference()
    value = candidate(ref)
    value["binding"]["page"] = 2
    with pytest.raises(ValueError):
        score_candidate(ref, value)
    value["binding"] = {}
    with pytest.raises(ValueError):
        score_candidate(ref, value)


def test_table_values_spans_missing_tables_and_unresolved_covered_cells():
    table = synthetic_table()
    cells = []
    for c in table.cells:
        cells.append(
            {
                "row": c.row,
                "column": c.column,
                "raw_text": c.text,
                "row_span": c.row_span,
                "column_span": c.column_span,
            }
        )
    exact = score_tables([table], [{"cells": cells}])
    assert exact["reference_cells"] == 15
    assert exact["reference_value_cells"] == exact["exact_cell_values"] == 14
    assert exact["exact_anchor_spans"] == 14
    assert exact["unresolved_covered_cells"] == 1
    # Deliberately corrupt 0, dash and blank; they cannot normalize to each other.
    for row, col, text in [(3, 1, "-"), (3, 2, ""), (4, 2, "0")]:
        next(c for c in cells if c["row"] == row and c["column"] == col)["raw_text"] = text
    assert score_tables([table], [{"cells": cells}])["exact_cell_values"] == 11
    missing = score_tables([table], [])
    assert missing["missing_tables"] == 1 and missing["reference_value_cells"] == 14
    assert missing["exact_cell_values"] == missing["exact_anchor_spans"] == 0
    assert score_tables(None, []) is None
    bad = table.model_dump()
    bad["cells"][2]["covered_by"] = [1, 1]
    with pytest.raises(ValidationError):
        type(table).model_validate(bad)

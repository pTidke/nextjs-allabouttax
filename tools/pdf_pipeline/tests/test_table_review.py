import copy
import json
import shutil

import pytest

from tax_pdf.benchmark import digest
from tax_pdf.fixtures import table_bytes
from tax_pdf.models import Artifact
from tax_pdf.runner import process
from tax_pdf.table_review import CellDraft, TableDraft, binding, validate_draft, write_workspace


@pytest.fixture(scope="module")
def example(tmp_path_factory):
    root = tmp_path_factory.mktemp("table-review")
    source = root / "table.pdf"
    source.write_bytes(table_bytes())
    package = process(source, root / "packages")
    artifact = Artifact.model_validate_json((package / "artifact.json").read_text())
    page = artifact.pages[0]
    table = page.tables[0]
    draft = TableDraft(
        binding=binding(artifact, digest(package / "artifact.json"), page, table),
        cells=[CellDraft(id=c.id, disposition="unreviewed") for c in table.cells],
    )
    return root, package, artifact, table, draft.model_dump()


def test_unreviewed_draft_does_not_approve_or_rewrite_raw_cells(example):
    _, package, artifact, table, value = example
    before = (package / "artifact.json").read_bytes()
    checked = validate_draft(package, value)
    assert checked.state == "DRAFT_NOT_ACCEPTED" and checked.publication_eligible is False
    assert all(c.text is None for c in checked.cells)
    assert {c.raw_text for c in table.cells} >= {None, "", "0", "-"}
    assert (package / "artifact.json").read_bytes() == before
    assert artifact.state == "BLOCKED"


def test_text_zero_dash_and_confirmed_blank_remain_distinct(example):
    _, package, _, table, value = example
    value = copy.deepcopy(value)
    for d, raw in zip(value["cells"], table.cells, strict=True):
        if raw.raw_text in {"0", "-", ""}:
            d.update(disposition="blank" if raw.raw_text == "" else "text", text=raw.raw_text)
    checked = validate_draft(package, value)
    assert {c.text for c in checked.cells} >= {None, "", "0", "-"}


@pytest.mark.parametrize(
    "key",
    ["source_sha256", "artifact_sha256", "render_sha256", "table_sha256", "fingerprint", "run_id"],
)
def test_revision_changes_cannot_inherit_a_draft(example, key):
    _, package, _, _, value = example
    value = copy.deepcopy(value)
    value["binding"][key] = "a" * 64
    with pytest.raises(ValueError):
        validate_draft(package, value)


def test_merged_anchor_needs_explicit_covered_cell_relationship(example):
    _, package, _, table, value = example
    value = copy.deepcopy(value)
    by_pos = {(c.row, c.column): c for c in table.cells}
    anchor, covered = by_pos[(0, 1)], by_pos[(0, 2)]
    drafts = {c["id"]: c for c in value["cells"]}
    drafts[anchor.id].update(disposition="text", text=anchor.raw_text, row_span=1, column_span=2)
    with pytest.raises(ValueError, match="explicitly"):
        validate_draft(package, value)
    drafts[covered.id].update(disposition="covered", covered_by=anchor.id)
    validate_draft(package, value)
    drafts[covered.id]["covered_by"] = "unknown-cell"
    with pytest.raises(ValueError):
        validate_draft(package, value)


def test_out_of_bounds_and_overlapping_spans_are_rejected(example):
    _, package, _, _, value = example
    value = copy.deepcopy(value)
    value["cells"][0].update(disposition="text", text="header", column_span=100)
    with pytest.raises(ValueError, match="exceeds"):
        validate_draft(package, value)
    value["cells"][0]["column_span"] = 2
    value["cells"][1].update(disposition="text", text="another header")
    with pytest.raises(ValueError, match="Overlapping"):
        validate_draft(package, value)


def test_missing_cells_unbound_footnotes_and_false_publication_are_rejected(example):
    _, package, _, _, original = example
    for update in [
        {"cells": original["cells"][:-1]},
        {"footnotes": [{"text": "not a real source", "source_block_ids": ["unknown"]}]},
        {"header_rows": [999]},
        {"publication_eligible": True},
        {"state": "APPROVED"},
    ]:
        with pytest.raises(ValueError):
            validate_draft(package, {**original, **update})


def test_footnotes_reference_actual_page_blocks_and_units_stay_literal(example):
    _, package, artifact, table, value = example
    value = copy.deepcopy(value)
    block = next(b for b in artifact.pages[0].blocks if "Footnote 1" in b.raw_text)
    value["footnotes"] = [{"text": block.raw_text, "source_block_ids": [block.id]}]
    cell = value["cells"][0]
    cell.update(
        disposition="text",
        text=table.cells[0].raw_text,
        header_path=["Illustrative values", "Amount"],
        unit="INR",
    )
    checked = validate_draft(package, value)
    assert checked.cells[0].unit == "INR"
    assert checked.footnotes[0].source_block_ids == [block.id]


def test_source_tampering_blocks_draft_even_when_binding_is_unchanged(example, tmp_path):
    _, package, _, _, value = example
    copied = tmp_path / "copy"
    shutil.copytree(package, copied)
    original = copied / "original.pdf"
    original.chmod(0o644)
    original.write_bytes(b"changed")
    with pytest.raises(ValueError, match="integrity"):
        validate_draft(copied, value)


def test_workspace_keeps_raw_data_and_escapes_via_dom_text(example, tmp_path):
    _, package, _, _, _ = example
    shutil.copytree(package, tmp_path / "packages" / package.name)
    write_workspace(tmp_path, [{"package": "packages/" + package.name, "kind": "synthetic"}])
    data = json.loads((tmp_path / "tables/tables.json").read_text())
    sample = data["tables"][0]
    assert sample["table"]["cells"][2]["raw_text"] is None
    assert sample["draft"]["binding"]["render_sha256"]
    script = (tmp_path / "tables/workspace.js").read_text()
    assert "innerHTML" not in script
    assert "source_block_ids" in script and "localStorage.setItem" in script
    assert "form-action 'none'" in (tmp_path / "tables/index.html").read_text()

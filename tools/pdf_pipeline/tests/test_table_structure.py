import copy
import io
import json
import shutil

import pytest
from reportlab.pdfgen import canvas

from tax_pdf.benchmark import digest
from tax_pdf.models import Artifact
from tax_pdf.runner import process
from tax_pdf.table_review import binding
from tax_pdf.table_structure import validate_structure, write_structure_review


@pytest.fixture(scope="module")
def sample(tmp_path_factory):
    root = tmp_path_factory.mktemp("structure")
    pdf = io.BytesIO()
    writer = canvas.Canvas(pdf, pagesize=(612, 792), invariant=1)

    def draw_table(top):
        writer.setFont("Helvetica", 10)
        for row in range(5):
            writer.line(50, top - row * 30, 350, top - row * 30)
        for x in (50, 150, 350):
            writer.line(x, top, x, top - 120)
        writer.line(250, top - 30, 250, top - 120)
        for y, values in (
            (top - 20, ("Label", "Shared <heading>", "")),
            (top - 50, ("Item", "Amount", "Section")),
            (top - 80, ("One", "0", "-")),
            (top - 110, ("Two", "", "B")),
        ):
            for x, value in zip((55, 155, 255), values, strict=True):
                writer.drawString(x, y, value)

    for page in range(3):
        draw_table(650)
        if page == 1:
            writer.drawString(180, 450, "OR")
            draw_table(300)
        writer.showPage()
    writer.save()
    source = root / "synthetic.pdf"
    source.write_bytes(pdf.getvalue())
    package = process(source, root / "packages")
    artifact = Artifact.model_validate_json((package / "artifact.json").read_text())
    plan = {
        "tables": [
            binding(artifact, digest(package / "artifact.json"), p, t).model_dump()
            for p in artifact.pages
            for t in p.tables
        ],
        "header_groups": [
            {
                "table_id": "p1-t1",
                "parent": "p1-t1-r0-c1",
                "covered": ["p1-t1-r0-c2"],
                "children": ["p1-t1-r1-c1", "p1-t1-r1-c2"],
            }
        ],
        "continuations": [
            {"before": "p1-t1", "after": "p2-t1", "kind": "data_rows"},
            {
                "before": "p2-t2",
                "after": "p3-t1",
                "kind": "split_header",
                "fragments": [{"before": "p2-t2-r1-c1", "after": "p3-t1-r1-c1"}],
            },
        ],
        "separations": [
            {
                "before": "p2-t1",
                "after": "p2-t2",
                "block_id": next(b.id for b in artifact.pages[1].blocks if b.raw_text == "OR"),
            }
        ],
    }
    return package, plan


def test_source_bound_relationships_leave_nulls_blanks_and_raw_tables_unchanged(sample):
    package, value = sample
    before = (package / "artifact.json").read_bytes()
    plan, artifact, selected, offsets = validate_structure(package, value)
    assert not plan.owner_verified and not plan.publication_eligible
    assert len(selected) == 4 and len(offsets) == 1
    assert {c.raw_text for p in artifact.pages for t in p.tables for c in t.cells} >= {
        None,
        "",
        "0",
        "-",
    }
    assert all(not t.structure_verified for _, t in selected.values())
    assert (package / "artifact.json").read_bytes() == before


@pytest.mark.parametrize(
    "key",
    [
        "source_sha256",
        "artifact_sha256",
        "render_sha256",
        "table_sha256",
        "run_id",
        "fingerprint",
    ],
)
def test_changed_revision_or_other_source_cannot_inherit_relationships(sample, key):
    package, value = sample
    value = copy.deepcopy(value)
    value["tables"][0][key] = "a" * 64
    with pytest.raises(ValueError):
        validate_structure(package, value)


def test_unknown_null_cannot_become_a_blank_or_erase_text(sample):
    package, original = sample
    for update in (
        {"covered": ["p1-t1-r0-c0"]},
        {"children": ["p1-t1-r1-c2", "p1-t1-r1-c1"]},
        {"children": ["p1-t1-r1-c1", "p1-t1-r2-c2"]},
        {"covered": []},
        {"parent": "p1-t1-r0-c2"},
    ):
        value = copy.deepcopy(original)
        value["header_groups"][0].update(update)
        with pytest.raises(ValueError):
            validate_structure(package, value)


@pytest.mark.parametrize(
    "update",
    [
        {"after": "p3-t1"},  # skipped page
        {"before": "p2-t1", "after": "p2-t2"},  # alternative, same page
        {"before": "p2-t1", "after": "p3-t1"},  # bypasses the lower alternative
        {"after": "unknown-table"},
    ],
)
def test_continuations_cannot_cross_alternatives_or_nonadjacent_pages(sample, update):
    package, value = sample
    value = copy.deepcopy(value)
    value["continuations"][0].update(update)
    with pytest.raises(ValueError):
        validate_structure(package, value)


def test_split_headers_need_explicit_geometrically_compatible_cells(sample):
    package, original = sample
    for fragments in ([], [{"before": "p2-t2-r1-c1", "after": "p3-t1-r1-c2"}]):
        value = copy.deepcopy(original)
        value["continuations"][1]["fragments"] = fragments
        with pytest.raises(ValueError):
            validate_structure(package, value)


def test_separator_cannot_be_invented_or_reversed(sample):
    package, original = sample
    for update in ({"block_id": "unknown"}, {"before": "p2-t2", "after": "p2-t1"}):
        value = copy.deepcopy(original)
        value["separations"][0].update(update)
        with pytest.raises(ValueError):
            validate_structure(package, value)


def test_tampered_source_render_and_duplicate_or_approved_plan_fail_closed(sample, tmp_path):
    package, original = sample
    for change in (
        {"owner_verified": True},
        {"publication_eligible": True},
        {"tables": original["tables"] * 2},
    ):
        with pytest.raises(ValueError):
            validate_structure(package, {**original, **change})
    copied = tmp_path / "package"
    shutil.copytree(package, copied)
    image = copied / "pages/0001.png"
    image.write_bytes(b"changed pixels")
    with pytest.raises(ValueError, match="integrity"):
        validate_structure(copied, original)


def test_readonly_comparison_preserves_source_copies_and_escapes_raw_text(sample, tmp_path):
    package, plan = sample
    plan_path = tmp_path / "plan.json"
    plan_path.write_text(json.dumps(plan))
    output = tmp_path / "review"
    report = write_structure_review(package, plan_path, output)
    assert report["summary"]["tables_joined"] == report["summary"]["accepted_tables"] == 0
    assert (output / "artifact.json").read_bytes() == (package / "artifact.json").read_bytes()
    assert (output / "original.pdf").read_bytes() == (package / "original.pdf").read_bytes()
    content = (output / "index.html").read_text()
    assert "Shared &lt;heading&gt;" in content and "<heading>" not in content
    assert "null: unresolved/covered" in content
    assert "<script" not in content and "does not save approvals" in content
    ledger = json.loads((output / "files.json").read_text())
    assert all(digest(output / name) == sha for name, sha in ledger.items())
    with pytest.raises(ValueError, match="fresh"):
        write_structure_review(package, plan_path, output)


def test_invalid_plan_leaves_no_finished_output(sample, tmp_path):
    package, original = sample
    value = copy.deepcopy(original)
    value["tables"][0]["table_sha256"] = "a" * 64
    path = tmp_path / "invalid.json"
    path.write_text(json.dumps(value))
    with pytest.raises(ValueError):
        write_structure_review(package, path, tmp_path / "review")
    assert not (tmp_path / "review").exists()


def test_subset_review_retains_the_full_render_inventory_for_integrity(sample, tmp_path):
    package, value = sample
    value = copy.deepcopy(value)
    value.update(tables=value["tables"][:1], continuations=[], separations=[])
    path = tmp_path / "plan.json"
    path.write_text(json.dumps(value))
    report = write_structure_review(package, path, tmp_path / "review")
    assert report["summary"]["pages"] == 1
    assert len(list((tmp_path / "review/pages").glob("*.png"))) == 3
    validate_structure(tmp_path / "review", tmp_path / "review/plan.json")
    content = (tmp_path / "review/index.html").read_text()
    assert "Table structure: 1 source checks" in content
    assert 'href="#case-2"' not in content

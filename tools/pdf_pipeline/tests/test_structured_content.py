import json
from copy import deepcopy
from pathlib import Path

import pytest
from PIL import Image

from tax_pdf.content_models import ContentPage, ContentPreview, ContentRegion
from tax_pdf.content_scope import partition_line, propose_order
from tax_pdf.content_view import write_content_view
from tax_pdf.date_review import audit_dates
from tax_pdf.fixtures import native_bytes
from tax_pdf.models import Box, Cell, Table
from tax_pdf.reference_eval import digest
from tax_pdf.runner import process
from tax_pdf.structured_content import prepare_content, reviewed_edits, validate_review

SHA = "a" * 64


def line(text, x=10, y=10, right=250, bottom=None):
    return {
        "text": text,
        "confidence": 96,
        "bbox": {"x0": x, "y0": y, "x1": right, "y1": bottom or y + 20},
    }


def region(text, identity, number, x=10, y=10, right=250):
    b = Box(x0=x, top=y, x1=right, bottom=y + 20)
    return ContentRegion(
        id=identity,
        source_line=number,
        start=0,
        end=len(text),
        raw_text=text,
        bbox=b,
        image_bbox=b,
        scope="content_candidate",
        proposed_order=number,
        crop=f"{identity}.png",
        crop_sha256=SHA,
    )


def test_mixed_line_partition_retains_every_character_and_does_not_erase_signature():
    original = line("12. The Guard File. SIGNATURE\n", right=700)
    original["words"] = [
        {"text": t, "bbox": line("", x, y=10, right=end)["bbox"]}
        for t, x, end in [
            ("12.", 10, 30),
            ("The", 40, 70),
            ("Guard", 80, 120),
            ("File.", 130, 170),
            ("SIGNATURE", 500, 700),
        ]
    ]
    before = deepcopy(original)
    areas = [
        {
            "id": "source-list",
            "scope": "administrative_excluded",
            "box": Box(x0=5, top=5, x1=300, bottom=35),
        }
    ]
    parts = partition_line(original, areas)
    assert len(parts) == 2
    assert parts[0][3] == "administrative_excluded" and parts[1][3] == "content_candidate"
    assert original["text"][parts[0][0] : parts[0][1]] == "12. The Guard File."
    assert "".join(original["text"][start:end] for start, end, *_ in parts) == original["text"]
    assert original == before
    # A missing or misaligned word never justifies excluding the entire mixed line.
    original["words"][1]["text"] = "Changed"
    assert partition_line(original, areas)[0][3] == "mixed_review"


def test_source_regions_do_not_imply_a_text_tail_cutoff():
    areas = [
        {
            "id": "list",
            "scope": "administrative_excluded",
            "box": Box(x0=5, top=40, x1=300, bottom=70),
        }
    ]
    lines = [
        line("Copy to:", y=45),
        line("Annexure: conditions and exceptions", y=100),
        line("Footnote: 0 is not a dash —", y=140),
    ]
    assert [partition_line(item, areas)[0][3] for item in lines] == [
        "administrative_excluded",
        "content_candidate",
        "content_candidate",
    ]
    assert (
        partition_line(line("Copy to: operative exception", y=10), areas)[0][3]
        == "content_candidate"
    )


def test_geometric_order_moves_displaced_fragments_and_retains_ambiguities():
    rs = [
        region("first body", "a", 1, x=100, y=10, right=400),
        region("December 2025", "b", 2, x=200, y=40, right=400),
        region("Recipient", "c", 3, y=100, right=400),
        region("10th", "d", 4, x=100, y=40, right=190),
        region("Copy", "e", 5, y=70, right=80),
    ]
    propose_order(rs)
    assert [r.id for r in sorted(rs, key=lambda r: r.proposed_order)] == ["a", "d", "b", "e", "c"]
    assert all(r.order_verified is False for r in rs)
    ambiguous = [
        region("left", "l", 1, x=10, y=10, right=100),
        region("right column", "r", 2, x=700, y=10, right=900),
    ]
    propose_order(ambiguous)
    assert all("ROW_OR_COLUMN_ASSOCIATION_UNVERIFIED" in r.holds for r in ambiguous)


def fixture(tmp_path):
    pdf = tmp_path / "source.pdf"
    pdf.write_bytes(native_bytes())
    package = process(pdf, tmp_path / "packages", dpi=72)
    artifact_file = package / "artifact.json"
    artifact = json.loads(artifact_file.read_text())
    image = package / artifact["pages"][0]["render"]
    with Image.open(image) as im:
        w, h = im.size
    texts = [
        line("New Delhi, dated the 31* March, 2026", right=400),
        line("Copy to:", y=100),
        line("1. Recipient", y=130),
        line("Annexure: a substantive exception; 0 and —", y=200),
    ]
    raw = {
        "state": "EXPERIMENTAL_NOT_ACCEPTED",
        "publication_eligible": False,
        "image_sha256": digest(image),
        "width": w,
        "height": h,
        "languages": ["eng"],
        "text": "\n".join(t["text"] for t in texts),
        "blocks": [{"paragraphs": [{"lines": texts}]}],
    }
    raw_file = tmp_path / "raw.json"
    raw_file.write_text(json.dumps(raw))
    item = {
        "id": "control",
        "title": "<script>evil</script>",
        "variant": "Unchanged · English",
        "engine": "synthetic fixture",
        "package": str(package.relative_to(tmp_path)),
        "artifact_sha256": digest(artifact_file),
        "source_sha256": digest(pdf),
        "page": 1,
        "preprocessing": "unchanged",
        "image": str(image.relative_to(tmp_path)),
        "image_sha256": digest(image),
        "state": "EXPERIMENTAL_NOT_ACCEPTED",
        "raw": "raw.json",
        "raw_sha256": digest(raw_file),
    }
    manifest = tmp_path / "inputs.json"
    manifest.write_text(json.dumps({"inputs": [item]}))
    report = audit_dates(manifest, tmp_path / "date-report")
    date_file = tmp_path / "date-report/date-review.json"
    snapshot = {
        "input_id": "control",
        "engine": item["engine"],
        "variant": item["variant"],
        "raw_sha256": digest(raw_file),
        "regions": [{"line_number": 1, **texts[0]}],
    }
    review = {
        "publication_eligible": False,
        "report_sha256": digest(date_file),
        "reviews": [
            {
                "source_sha256": digest(pdf),
                "page": 1,
                "source_render_sha256": digest(image),
                "field_correction": {
                    "field": "printed_header_date",
                    "raw_token": "31*",
                    "reviewed_token": "31st",
                    "reviewed_value": "31st March, 2026",
                },
                "raw_evidence": snapshot,
            }
        ],
    }
    review_file = tmp_path / "scope.json"
    review_file.write_text(json.dumps(review))
    return manifest, date_file, review_file, review, report


def test_package_preserves_evidence_and_is_always_held(tmp_path):
    manifest, date, review_file, _, _ = fixture(tmp_path)
    before = digest(tmp_path / "raw.json")
    result = prepare_content(manifest, date, review_file, tmp_path / "preview")
    page = result.pages[0]
    assert sum(len(r.raw_text) for r in page.regions) == sum(
        len(source.raw_text) for source in page.source_lines
    )
    changed = [r for r in page.regions if r.edits]
    assert len(changed) == 1 and changed[0].edits[0].before == "31*"
    assert changed[0].reviewed_text == "New Delhi, dated the 31st March, 2026"
    assert page.source_lines[0].raw_text.endswith("31* March, 2026")
    assert digest(tmp_path / "preview" / page.raw) == before == digest(tmp_path / "raw.json")
    assert digest(tmp_path / "preview" / page.original) == page.source_sha256
    assert digest(tmp_path / "preview" / page.artifact) == page.artifact_sha256
    assert result.publication_eligible is False and result.acceptance is None
    assert "FULL_PAGE_TEXT_UNVERIFIED" in page.holds and page.warnings
    assert "Annexure:" in "".join(r.raw_text for r in page.regions)
    html = (tmp_path / "preview/index.html").read_text()
    assert "<script>evil</script>" not in html and "&lt;script&gt;evil" in html
    ledger = json.loads((tmp_path / "preview/files.json").read_text())
    assert all(digest(tmp_path / "preview" / name) == sha for name, sha in ledger.items())
    with pytest.raises(ValueError):
        prepare_content(manifest, date, review_file, tmp_path / "preview")


@pytest.mark.parametrize(
    "change", ["report", "source", "render", "raw", "snapshot", "page", "duplicate"]
)
def test_stale_or_cross_source_scope_fails_without_finished_output(tmp_path, change):
    manifest, date, review_file, review, _ = fixture(tmp_path)
    entry = review["reviews"][0]
    if change == "report":
        review["report_sha256"] = "0" * 64
    elif change == "source":
        entry["source_sha256"] = "0" * 64
    elif change == "render":
        entry["source_render_sha256"] = "0" * 64
    elif change == "raw":
        entry["raw_evidence"]["raw_sha256"] = "0" * 64
    elif change == "snapshot":
        entry["raw_evidence"]["regions"][0]["text"] = "Invented"
    elif change == "page":
        entry["page"] = 2
    else:
        review["reviews"].append(deepcopy(entry))
    review_file.write_text(json.dumps(review))
    with pytest.raises(ValueError):
        prepare_content(manifest, date, review_file, tmp_path / "preview")
    assert not (tmp_path / "preview").exists() and not list(tmp_path.glob(".content-preview-*"))


def test_reviewed_header_does_not_transfer_edits_to_unbound_variants(tmp_path):
    _, _, _, review, _ = fixture(tmp_path)
    entry = review["reviews"][0]
    row = {"id": "different-engine", "raw_sha256": entry["raw_evidence"]["raw_sha256"]}
    assert reviewed_edits(entry, row, [], SHA) == ({}, False)
    row = {"id": "control", "raw_sha256": "0" * 64}
    assert reviewed_edits(entry, row, [], SHA) == ({}, False)


def test_split_header_and_corrupted_prefix_receive_only_bound_explicit_edits():
    texts = [line("New Delhi, datedgq Detober, 2025\n\n")]
    entry = {
        "field_correction": {"reviewed_value": "29th October, 2025"},
        "header_evidence": {"input_id": "tess", "raw_sha256": SHA, "regions": [{"line_number": 1}]},
    }
    edits, bound = reviewed_edits(entry, {"id": "tess", "raw_sha256": SHA}, texts, SHA)
    edit = edits[1]
    assert bound and edit.before == "gq Detober, 2025" and edit.after == " 29th October, 2025"
    texts = [line("New Delhi, dated"), line("124' October, 2025")]
    entry["independent_header_evidence"] = {
        "input_id": "easy",
        "raw_sha256": SHA,
        "regions": [{"line_number": 1}, {"line_number": 2}],
    }
    edits, bound = reviewed_edits(entry, {"id": "easy", "raw_sha256": SHA}, texts, SHA)
    assert bound and set(edits) == {2} and edits[2].after == "29th October, 2025"


def test_strict_contract_rejects_missing_raw_spans_invalid_edits_or_publication(tmp_path):
    manifest, date, scope, _, _ = fixture(tmp_path)
    preview = prepare_content(manifest, date, scope, tmp_path / "preview")
    original = preview.pages[0].model_dump()
    for change in (
        "missing",
        "text",
        "edit",
        "table",
        "empty_span",
        "missing_page",
        "box",
        "publish",
    ):
        value = deepcopy(original)
        if change == "missing":
            value["regions"].pop()
        elif change == "text":
            value["regions"][0]["raw_text"] = "changed"
        elif change == "edit":
            value["regions"][0]["reviewed_text"] = "invented replacement"
        elif change == "table":
            value["regions"][0]["table_ids"] = ["missing-table"]
        elif change == "empty_span":
            value["regions"][0]["end"] = 0
            value["regions"][0]["raw_text"] = ""
        elif change == "missing_page":
            value["expected_pages"] = 2
        elif change == "box":
            value["regions"][0]["image_bbox"]["x1"] = 8000
        else:
            value["publication_eligible"] = True
        with pytest.raises(ValueError):
            ContentPage.model_validate(value)
    value = preview.model_dump()
    value["pages"] *= 2
    with pytest.raises(ValueError):
        ContentPreview.model_validate(value)
    value = preview.model_dump()
    value["scope_review_sha256"] = "0" * 64
    with pytest.raises(ValueError):
        ContentPreview.model_validate(value)


def test_tables_keep_grid_null_blank_zero_dash_and_unverified_spans(tmp_path):
    manifest, date, scope, _, _ = fixture(tmp_path)
    preview = prepare_content(manifest, date, scope, tmp_path / "preview")
    page = preview.pages[0]
    box = Box(x0=10, top=300, x1=400, bottom=400)
    table = Table(
        id="t1",
        bbox=box,
        rows=2,
        columns=2,
        cells=[
            Cell(
                id=f"c{i}",
                row=i // 2,
                column=i % 2,
                raw_text=t,
                bbox=box,
                row_span=2 if i == 0 else None,
                column_span=None,
            )
            for i, t in enumerate([None, "", "0", "—"])
        ],
    )
    page.tables = [table]
    value = ContentPreview.model_validate(preview.model_dump())
    assert [c.raw_text for c in value.pages[0].tables[0].cells] == [None, "", "0", "—"]
    assert value.pages[0].tables[0].cells[0].row_span == 2
    write_content_view(value, tmp_path / "preview")
    html = (tmp_path / "preview/index.html").read_text()
    assert "[unresolved / covered]" in html and "[blank candidate]" in html
    assert "structure unverified" in html


def test_canonical_content_schema():
    root = Path(__file__).resolve().parents[1]
    assert (
        json.loads((root / "schemas/content-preview.schema.json").read_text())
        == ContentPreview.model_json_schema()
    )


def test_scoped_exclusion_keeps_subsequent_annexure_and_rejects_dimensions(tmp_path):
    manifest, date, scope_file, review, report = fixture(tmp_path)
    entry = review["reviews"][0]
    raw = json.loads((tmp_path / "raw.json").read_text())
    lines = raw["blocks"][0]["paragraphs"][0]["lines"]
    snapshot = entry["raw_evidence"]
    refs = {**snapshot, "regions": [{"line_number": i + 1, **lines[i]} for i in (1, 2)]}
    entry["retrieval_scope_draft"] = {
        "image_dimensions": [raw["width"], raw["height"]],
        "source_image_regions": [
            {"id": "administrative", "bbox": {"x0": 5, "y0": 95, "x1": 300, "y1": 155}}
        ],
        "reference_ocr_regions": refs,
        "issuer_name_and_designation": snapshot,
        "mixed_region": {"line_number": 3, "text": lines[2]["text"], "bbox": lines[2]["bbox"]},
    }
    scope_file.write_text(json.dumps(review))
    result = prepare_content(manifest, date, scope_file, tmp_path / "preview")
    scopes = {r.source_line: r.scope for r in result.pages[0].regions}
    assert scopes[2] == scopes[3] == "administrative_excluded"
    assert scopes[4] == "content_candidate"
    entry["retrieval_scope_draft"]["image_dimensions"][0] += 1
    with pytest.raises(ValueError):
        validate_review(review, report, date.parent)


def test_report_rewritten_after_review_cannot_bypass_evidence_reconstruction(tmp_path):
    manifest, date, scope_file, review, report = fixture(tmp_path)
    report["warning_count"] = 0
    date.write_text(json.dumps(report))
    review["report_sha256"] = digest(date)
    scope_file.write_text(json.dumps(review))
    with pytest.raises(ValueError, match="stale"):
        prepare_content(manifest, date, scope_file, tmp_path / "preview")
    assert not (tmp_path / "preview").exists()


def test_table_overlap_has_priority_over_administrative_exclusion(tmp_path):
    manifest, date, scope_file, review, _ = fixture(tmp_path)
    supplied = json.loads(manifest.read_text())
    item = supplied["inputs"][0]
    artifact_file = tmp_path / item["package"] / "artifact.json"
    artifact = json.loads(artifact_file.read_text())
    box = Box(x0=5, top=95, x1=300, bottom=155)
    table = Table(
        id="synthetic-table",
        bbox=box,
        rows=1,
        columns=1,
        cells=[Cell(id="cell", row=0, column=0, raw_text=None, bbox=box)],
    )
    artifact["pages"][0]["tables"] = [table.model_dump()]
    artifact_file.write_text(json.dumps(artifact))
    item["artifact_sha256"] = digest(artifact_file)
    manifest.write_text(json.dumps(supplied))
    new_report = tmp_path / "new-dates"
    audit_dates(manifest, new_report)
    review["report_sha256"] = digest(new_report / "date-review.json")
    entry = review["reviews"][0]
    raw = json.loads((tmp_path / "raw.json").read_text())
    lines = raw["blocks"][0]["paragraphs"][0]["lines"]
    snapshot = entry["raw_evidence"]
    entry["retrieval_scope_draft"] = {
        "image_dimensions": [raw["width"], raw["height"]],
        "source_image_regions": [
            {"id": "administrative", "bbox": {"x0": 5, "y0": 95, "x1": 300, "y1": 155}}
        ],
        "reference_ocr_regions": {
            **snapshot,
            "regions": [{"line_number": i + 1, **lines[i]} for i in (1, 2)],
        },
        "issuer_name_and_designation": snapshot,
        "mixed_region": {"line_number": 3, "text": lines[2]["text"], "bbox": lines[2]["bbox"]},
    }
    scope_file.write_text(json.dumps(review))
    preview = prepare_content(
        manifest, new_report / "date-review.json", scope_file, tmp_path / "preview"
    )
    regions = [r for r in preview.pages[0].regions if r.source_line in (2, 3)]
    assert all(r.scope == "table_review" and r.table_ids == ["synthetic-table"] for r in regions)
    assert preview.pages[0].tables[0].cells[0].raw_text is None

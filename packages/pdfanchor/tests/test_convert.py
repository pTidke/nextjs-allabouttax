import json
import shutil
from dataclasses import replace
from pathlib import Path

import pytest
from conftest import BAD_DATE, BODY, FakeEngine, echo_engine

from pdfanchor import Config, ConversionError, Document, Policy, convert, write
from pdfanchor.cli import main
from pdfanchor.export.chunks import to_chunks
from pdfanchor.export.markdown import to_markdown
from pdfanchor.ocr.tesseract import TesseractCli
from pdfanchor.policy import needs_review

TRUSTING = Config(policy=Policy(accept_native_without_crosscheck=True))


def by_text(document, text):
    return next(line for line in document.lines() if line.text == text)


def test_native_text_is_anchored_structured_and_held_until_something_confirms_it(native_pdf):
    document = convert(native_pdf, engines=[])
    assert [page.kind for page in document.pages] == ["native", "native"]
    assert document.source.pages == 2 and len(document.source.sha256) == 64
    assert document.title == "Notification No. 1/2026"
    for page in document.pages:
        for line in page.lines:
            assert 0 <= line.box.x0 < line.box.x1 <= page.width
            assert 0 <= line.box.top < line.box.bottom <= page.height
            assert line.source == "native" and line.raw
    # Default policy: with no second reading, nothing is accepted.
    assert document.summary["accepted"] == 0
    assert all("crosscheck.not-run" in [f.rule for f in line.flags] for line in document.lines())


def test_rules_accept_clean_lines_and_flag_only_what_needs_a_person(native_pdf):
    document = convert(native_pdf, config=TRUSTING, engines=[])
    assert by_text(document, BODY[0]).status == "accepted"
    assert by_text(document, BODY[1]).status == "accepted"
    bad = by_text(document, BAD_DATE)
    assert bad.status == "flagged" and [f.rule for f in bad.flags] == ["date.ordinal-suffix"]
    assert bad.text == BAD_DATE  # flagged, never rewritten
    table = document.pages[1].tables[0]
    assert (table.rows, table.columns, table.status) == (3, 2, "flagged")
    assert all(line.status == "flagged" for line in document.pages[1].lines if line.table_id)
    assert needs_review(document)


def test_an_agreeing_second_reading_accepts_and_one_changed_digit_flags(native_pdf):
    base = convert(native_pdf, engines=[])
    config = Config()
    agreed = convert(native_pdf, config=config, engines=[echo_engine(base, config.dpi)])
    assert by_text(agreed, BODY[0]).status == "accepted"
    assert by_text(agreed, BODY[0]).readings[0].source == "ocr:echo"
    assert by_text(agreed, BAD_DATE).status == "flagged"  # agreement does not clear a validator

    wrong = echo_engine(base, config.dpi, change=lambda text: text.replace("2026", "2028"))
    disputed = convert(native_pdf, config=config, engines=[wrong])
    line = by_text(disputed, BODY[0])
    assert line.status == "flagged" and line.text == BODY[0]
    assert [f.rule for f in line.flags] == ["crosscheck.disagreement"]
    assert "2028" in line.flags[0].message
    assert by_text(disputed, BODY[1]).status == "accepted"


def test_scanned_page_without_an_engine_is_blocked_not_silently_empty(scanned_pdf):
    document = convert(scanned_pdf, engines=[])
    page = document.pages[0]
    assert page.kind == "scanned" and not page.lines
    assert [f.rule for f in page.flags] == ["ocr.unavailable"]
    assert needs_review(document)
    assert "no text for pages: 1" in to_markdown(document)


def test_scanned_lines_need_two_agreeing_readers(scanned_pdf):
    box_a, box_b = (150, 200, 900, 260), (150, 360, 1100, 420)
    first = FakeEngine("one", [("Circular No. 7 of 2026", box_a), ("The due date is 31st July 2026.", box_b)])
    same = FakeEngine("two", [("Circular No. 7 of 2026", box_a), ("The due date is 3lst July 2026.", box_b)])
    alone = convert(scanned_pdf, engines=[first])
    assert {line.status for line in alone.lines()} == {"flagged"}
    assert alone.pages[0].lines[0].flags[0].rule == "ocr.single-reading"

    both = convert(scanned_pdf, engines=[first, same])
    title, due = both.pages[0].lines
    assert title.source == "ocr:one" and title.status == "accepted"
    assert due.status == "flagged" and due.flags[0].rule == "crosscheck.disagreement"
    assert due.text == "The due date is 31st July 2026."  # the first reader's text is never merged


@pytest.mark.skipif(not shutil.which("tesseract"), reason="tesseract is not installed")
def test_real_tesseract_reads_an_image_only_page(scanned_pdf):
    document = convert(scanned_pdf, engines=[TesseractCli()])
    page = document.pages[0]
    text = " ".join(line.text for line in page.lines)
    assert page.kind == "scanned" and "2026" in text and "Circular" in text
    assert all(line.source == "ocr:tesseract" and line.status == "flagged" for line in page.lines)
    assert all(0 <= line.box.x0 < line.box.x1 <= page.width for line in page.lines)
    assert document.engine.components["ocr:tesseract"]


def test_excluded_scripts_stay_as_evidence_and_leave_the_exports(scanned_pdf):
    engine = FakeEngine(
        "one", [("भारत का राजपत्र", (150, 200, 700, 260)), ("The Gazette of India 2026", (150, 360, 900, 420))]
    )
    config = replace(Config(exclude_scripts=("Deva",)), policy=Policy(accept_single_ocr_reading=True))
    document = convert(scanned_pdf, config=config, engines=[engine])
    hindi, english = document.pages[0].lines
    assert hindi.excluded == "script:Deva" and hindi.text == "भारत का राजपत्र"
    assert english.status == "accepted" and document.summary["excluded"] == 1
    assert "राजपत्र" not in to_markdown(document)
    assert [chunk["text"] for chunk in to_chunks(document, config)] == ["The Gazette of India 2026"]


def test_markdown_and_chunks_carry_structure_citations_and_status(native_pdf, tmp_path):
    document = convert(native_pdf, config=TRUSTING, engines=[])
    markdown = to_markdown(document)
    assert markdown.startswith("<!-- page 1 -->\n\n## Notification No. 1/2026")
    assert f"{BODY[0]} {BODY[1]}" in markdown  # lines of one paragraph are joined
    assert "<!-- flagged: date.ordinal-suffix -->" in markdown
    assert "| Individual | 1,50,000 |" in markdown and "<!-- page 2 -->" in markdown

    chunks = to_chunks(document, TRUSTING)
    assert len({chunk["id"] for chunk in chunks}) == len(chunks)
    first = chunks[0]
    assert first["context"] == ["Notification No. 1/2026"]
    assert first["embedding_text"].startswith("Notification No. 1/2026\n")
    # A chunk may run across a page break; it keeps one anchor per page it touches.
    assert first["pages"] == [1, 2] and [a["page"] for a in first["anchors"]] == [1, 2]
    assert all(anchor["line_ids"] and len(anchor["box"]) == 4 for anchor in first["anchors"])
    assert first["status"] == "flagged" and first["rules"] == ["date.ordinal-suffix"]
    table = next(chunk for chunk in chunks if chunk["kind"] == "table")
    assert table["pages"] == [2] and "5,00,000" in table["text"]
    accepted_only = to_chunks(document, TRUSTING, include=("accepted",))
    assert all(chunk["status"] == "accepted" for chunk in accepted_only)

    files = write(document, tmp_path / "out", TRUSTING)
    assert Document.model_validate_json(files["document"].read_text()) == document
    rows = [json.loads(row) for row in files["chunks"].read_text().splitlines()]
    assert rows == chunks


def test_small_chunk_size_splits_paragraphs_but_never_a_paragraph(native_pdf):
    config = replace(TRUSTING, chunk_chars=100)
    texts = [c["text"] for c in to_chunks(convert(native_pdf, config=config, engines=[]), config)]
    assert f"{BODY[0]} {BODY[1]}" in texts and BAD_DATE in texts


def test_command_line_exit_codes_and_files(native_pdf, tmp_path, capsys):
    out = tmp_path / "cli"
    assert main(["convert", str(native_pdf), "--out", str(out), "--ocr", "none", "--trust-native"]) == 2
    assert {p.name for p in out.iterdir()} == {"document.json", "document.md", "chunks.jsonl"}
    assert json.loads(capsys.readouterr().out)["summary"]["flagged"] >= 1
    not_pdf = tmp_path / "note.txt"
    not_pdf.write_text("hello")
    assert main(["convert", str(not_pdf), "--out", str(out)]) == 1
    with pytest.raises(ConversionError):
        convert(b"not a pdf")


def test_published_schema_matches_the_models():
    schema = Path(__file__).parents[1] / "schemas" / "document.schema.json"
    assert json.loads(schema.read_text()) == Document.model_json_schema()

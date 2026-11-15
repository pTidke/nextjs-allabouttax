import pytest

from pdfanchor.crosscheck import compare, critical_tokens
from pdfanchor.ocr.tesseract import parse_tsv
from pdfanchor.structure import scripts_of
from pdfanchor.validators import run
from pdfanchor.validators.dates import expected_suffix


def rules(text):
    return [flag.rule for flag in run(text)]


@pytest.mark.parametrize(
    "text",
    [
        "with effect from the 1st day of April, 2026",
        "dated 05th March, 2024",
        "dated 5 March 2024",
        "on 22nd June 2025 and 23rd June 2025",
        "under section 80C of the Act",
        "Rs. 1,50,000 in March",
        "as on 31.03.2026",
    ],
)
def test_well_formed_dates_and_ordinary_text_raise_nothing(text):
    assert rules(text) == []


@pytest.mark.parametrize(
    ("text", "rule"),
    [
        ("dated 31* March, 2025", "date.ordinal-suffix"),
        ('dated 05" March, 2024', "date.ordinal-suffix"),
        ("from 015 April 2024", "date.day-out-of-range"),
        ("on 22th June 2025", "date.ordinal-mismatch"),
        ("on 0sth March, 2024", "date.day-out-of-range"),
        ("dated 12th May, 20245", "date.year-implausible"),
    ],
)
def test_the_recorded_ocr_date_errors_are_flagged_and_never_rewritten(text, rule):
    assert rule in rules(text)


def test_ordinal_suffix_rule():
    assert [expected_suffix(d) for d in (1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31)] == [
        "st", "nd", "rd", "th", "th", "th", "th", "st", "nd", "rd", "st",
    ]  # fmt: skip


def test_unmapped_characters_are_flagged():
    assert rules("Income (cid:12) Tax") == ["encoding.unmapped"]
    assert rules("Income � Tax") == ["encoding.unmapped"]
    assert rules("Income  Tax") == ["encoding.unmapped"]


def test_critical_tokens_keep_numbers_references_and_negations():
    tokens = critical_tokens("Under section 10(23FE), w.e.f. 01.04.2026, not exceeding Rs. 1,50,000 (or 12.5%).")
    assert set(tokens) == {"10(23fe)", "01.04.2026", "not", "1,50,000", "12.5%"}


def test_one_wrong_digit_breaks_agreement_even_when_text_is_nearly_identical():
    first = "The due date is extended to 31st July 2026 for all assessees."
    close = compare(first, "The due date is extended to 31st July 2028 for all assessees.")
    assert close.similarity > 0.95 and not close.agrees(0.90)
    assert close.only_first == ("2026",) and close.only_second == ("2028",)
    assert compare(first, "The due date is  extended to 31st July 2026 for all assessees").agrees(0.90)
    assert not compare("shall not apply", "shall apply").agrees(0.5)


def test_scripts():
    assert scripts_of("भारत का राजपत्र") == ["Deva"]
    assert scripts_of("The Gazette of India 2026") == ["Latn"]
    assert scripts_of("आयकर Income-tax") == ["Deva", "Latn"]
    assert scripts_of("31.03.2026") == []


def test_tesseract_rows_become_lines_in_order():
    header = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext"
    rows = [
        "4\t1\t1\t1\t1\t0\t10\t10\t200\t20\t-1\t",
        "5\t1\t1\t1\t1\t1\t10\t10\t80\t20\t96.5\tCircular",
        "5\t1\t1\t1\t1\t2\t100\t12\t40\t18\t91.5\tNo.",
        "5\t1\t1\t1\t2\t1\t10\t50\t60\t20\t88\t2026",
        "5\t1\t1\t1\t2\t2\t80\t50\t10\t20\t95\t ",
    ]
    lines = parse_tsv("\n".join([header, *rows]))
    assert [line.text for line in lines] == ["Circular No.", "2026"]
    assert lines[0].box == (10, 10, 140, 30) and lines[0].confidence == 94.0

"""Source-bound reference scoring. Evaluation never grants extraction/tax approval."""

import hashlib
import json
import unicodedata
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator

from .models import Model, Table

SHA = r"^[a-f0-9]{64}$"


def sha_json(value):
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def safe_file(root, relative):
    path = (root / relative).resolve()
    if (
        Path(relative).is_absolute()
        or not path.is_relative_to(root.resolve())
        or not path.is_file()
    ):
        raise ValueError("Evidence must be an existing file inside the laboratory root")
    return path


def normalize(text):
    # Preserve case, punctuation, digits, separators, accents, Hindi and negation.
    # Only NFC and whitespace folding are allowed; no spelling/number repair.
    return " ".join(unicodedata.normalize("NFC", text).split())


def distance(expected, observed):
    """Exact unit-cost Levenshtein with Myers bit vectors; strings or token lists."""
    if not expected:
        return len(observed)
    masks = {}
    for i, token in enumerate(expected):
        masks[token] = masks.get(token, 0) | (1 << i)
    pv, mv, score = ~0, 0, len(expected)
    high = 1 << (len(expected) - 1)
    for token in observed:
        eq = masks.get(token, 0)
        xv = eq | mv
        xh = (((eq & pv) + pv) ^ pv) | eq
        ph, mh = mv | ~(xh | pv), pv & xh
        score += bool(ph & high) - bool(mh & high)
        ph = (ph << 1) | 1
        mh <<= 1
        pv, mv = mh | ~(xv | ph), ph & xv
    return score


class Verification(Model):
    reviewer: str = Field(min_length=1, max_length=160)
    checked_at: datetime
    method: Literal["visual_source_comparison", "fixture_authoring_contract"]
    annotation_sha256: str = Field(pattern=SHA)


class ExpectedCell(Model):
    row: int = Field(ge=0, le=200)
    column: int = Field(ge=0, le=100)
    meaning: Literal["text", "blank", "covered"]
    text: str | None = Field(default=None, max_length=10000)
    row_span: int = Field(default=1, ge=1, le=200)
    column_span: int = Field(default=1, ge=1, le=100)
    covered_by: tuple[int, int] | None = None

    @model_validator(mode="after")
    def meaning_valid(self):
        if (
            (self.meaning == "text" and not self.text)
            or (self.meaning == "blank" and self.text != "")
            or (self.meaning == "covered" and (self.text is not None or self.covered_by is None))
            or (self.meaning != "covered" and self.covered_by is not None)
            or (self.meaning == "covered" and (self.row_span != 1 or self.column_span != 1))
        ):
            raise ValueError("Blank, covered and transcribed cells have distinct meanings")
        return self


class ExpectedTable(Model):
    rows: int = Field(ge=1, le=200)
    columns: int = Field(ge=1, le=100)
    cells: list[ExpectedCell] = Field(max_length=20000)
    header_rows: list[int] = Field(default_factory=list)

    @model_validator(mode="after")
    def topology(self):
        grid = {(r, c) for r in range(self.rows) for c in range(self.columns)}
        by_pos = {(c.row, c.column): c for c in self.cells}
        if len(by_pos) != len(self.cells) or set(by_pos) != grid:
            raise ValueError("Reference table must account for every cell exactly once")
        if len(set(self.header_rows)) != len(self.header_rows) or any(
            r not in range(self.rows) for r in self.header_rows
        ):
            raise ValueError("Header rows must be unique and in bounds")
        coverage = {}
        for pos, cell in by_pos.items():
            if cell.meaning == "covered":
                continue
            for r in range(cell.row, cell.row + cell.row_span):
                for c in range(cell.column, cell.column + cell.column_span):
                    p = (r, c)
                    if p not in grid or p in coverage:
                        raise ValueError("Overlapping or out-of-bounds reference span")
                    coverage[p] = pos
        if set(coverage) != grid:
            raise ValueError("Uncovered reference table positions")
        for pos, cell in by_pos.items():
            if cell.meaning == "covered" and (
                coverage[pos] == pos or cell.covered_by != coverage[pos]
            ):
                raise ValueError("Covered position must identify its actual anchor")
        return self


class Reference(Model):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,100}$")
    source_sha256: str = Field(pattern=SHA)
    render_sha256: str = Field(pattern=SHA)
    page: int = Field(ge=1, le=1000)
    kind: Literal["official", "synthetic"]
    template_group: str = Field(min_length=1, max_length=160)
    split: Literal["development"] = "development"
    status: Literal["PROPOSED", "HUMAN_VERIFIED", "AUTHORED_SYNTHETIC"] = "PROPOSED"
    scope: Literal["all_visible_printed_text"] = "all_visible_printed_text"
    expected_text: str | None = Field(default=None, max_length=30000)
    critical_strings: list[str] = Field(default_factory=list, max_length=100)
    tables: list[ExpectedTable] | None = Field(default=None, max_length=20)
    notes: str = Field(default="", max_length=5000)
    verification: Verification | None = None
    publication_eligible: Literal[False] = False

    def annotation(self):
        return self.model_dump(mode="json", exclude={"status", "verification"})

    @model_validator(mode="after")
    def checked_reference(self):
        if len(set(self.critical_strings)) != len(self.critical_strings) or any(
            not normalize(s) or len(s) > 300 for s in self.critical_strings
        ):
            raise ValueError("Critical strings must be unique, nonempty and bounded")
        if self.expected_text is not None and any(
            normalize(s) not in normalize(self.expected_text) for s in self.critical_strings
        ):
            raise ValueError("Every critical string must occur in the reference")
        if self.status == "PROPOSED":
            if self.verification is not None:
                raise ValueError("Proposals cannot carry a verification record")
            return self
        method = (
            "fixture_authoring_contract"
            if self.status == "AUTHORED_SYNTHETIC"
            else "visual_source_comparison"
        )
        if (
            (self.status == "AUTHORED_SYNTHETIC" and self.kind != "synthetic")
            or self.expected_text is None
            or self.verification is None
            or self.verification.method != method
            or self.verification.checked_at.tzinfo is None
            or not self.verification.reviewer.strip()
            or self.verification.annotation_sha256 != sha_json(self.annotation())
        ):
            raise ValueError("Checked references require a current annotation hash and provenance")
        return self


class CandidateBinding(Model):
    source_sha256: str = Field(pattern=SHA)
    render_sha256: str = Field(pattern=SHA)
    page: int = Field(ge=1, le=1000)


class Candidate(Model):
    binding: CandidateBinding
    engine: str = Field(min_length=1, max_length=100)
    transform: Literal["unchanged", "rotated90", "blurred"]
    text: str = Field(max_length=60000)
    tables: list[Table] = Field(max_length=100)
    failed: bool
    claims_clean: bool
    holds: list[str] = Field(max_length=200)
    engine_versions: dict[str, str]
    fingerprint: str | None = None
    ocr_source_render_sha256: str | None = Field(default=None, pattern=SHA)


def score_text(expected, observed, critical_strings):
    a, b = normalize(expected), normalize(observed)
    words_a, words_b = a.split(), b.split()
    # Rates use micro totals: edit counts summed over pages / reference length.
    return {
        "reference_characters": len(a),
        "observed_characters": len(b),
        "character_edits": distance(a, b),
        "reference_words": len(words_a),
        "word_edits": distance(words_a, words_b),
        "exact_text": a == b,
        "missing_output": bool(a) and not b,
        "critical_string_counts": [
            {
                "text": s,
                "expected_occurrences": a.count(normalize(s)),
                "observed_occurrences": b.count(normalize(s)),
                "count_matches": a.count(normalize(s)) == b.count(normalize(s)),
            }
            for s in critical_strings
        ],
    }


def score_tables(expected, observed):
    if expected is None:
        return None
    result = Counter(
        reference_tables=len(expected),
        observed_tables=len(observed),
        missing_tables=max(0, len(expected) - len(observed)),
        extra_tables=max(0, len(observed) - len(expected)),
        reference_cells=0,
        reference_value_cells=0,
        unresolved_covered_cells=0,
        exact_cell_values=0,
        reference_anchors=0,
        exact_anchor_spans=0,
        unmeasured_header_tables=len(expected),
    )
    # Candidate tables are paired in supplied page order. This is an engineering
    # diagnostic, not topology-invariant matching or a semantic table metric.
    for i, table in enumerate(expected):
        actual = observed[i] if i < len(observed) else None
        cells = {(c["row"], c["column"]): c for c in actual["cells"]} if actual else {}
        for cell in table.cells:
            result["reference_cells"] += 1
            if cell.meaning == "covered":
                result["unresolved_covered_cells"] += 1
            else:
                result["reference_value_cells"] += 1
            candidate = cells.get((cell.row, cell.column))
            # A null candidate is unresolved; it does not prove a merged covered cell.
            if candidate is not None and cell.meaning != "covered":
                value = candidate["raw_text"]
                if value is not None and normalize(value) == normalize(cell.text):
                    result["exact_cell_values"] += 1
            if cell.meaning != "covered":
                result["reference_anchors"] += 1
                if candidate and (candidate["row_span"], candidate["column_span"]) == (
                    cell.row_span,
                    cell.column_span,
                ):
                    result["exact_anchor_spans"] += 1
    return dict(result)


def score_candidate(reference, candidate):
    if candidate["binding"] != {
        k: getattr(reference, k) for k in ("source_sha256", "render_sha256", "page")
    }:
        raise ValueError("Candidate and reference source/page/render do not match")
    if reference.status == "PROPOSED":
        return {"state": "UNSCORED_REFERENCE_NOT_VERIFIED", "text": None, "tables": None}
    text = score_text(reference.expected_text, candidate["text"], reference.critical_strings)
    tables = score_tables(reference.tables, candidate["tables"])
    return {
        "state": "DEVELOPMENT_DIAGNOSTIC",
        "text": text,
        "tables": tables,
        "candidate_failed": candidate["failed"],
        "false_clean_text": candidate["claims_clean"] and not text["exact_text"],
        "claims_clean": candidate["claims_clean"],
        "publication_eligible": False,
    }


def aggregate(rows):
    scored = [r for r in rows if r["score"]["text"] is not None]
    nchar = sum(r["score"]["text"]["reference_characters"] for r in scored)
    nword = sum(r["score"]["text"]["reference_words"] for r in scored)
    cedit = sum(r["score"]["text"]["character_edits"] for r in scored)
    wedit = sum(r["score"]["text"]["word_edits"] for r in scored)
    checks = [x for r in scored for x in r["score"]["text"]["critical_string_counts"]]
    return {
        "candidate_attempts": len(rows),
        "scored_attempts": len(scored),
        "unscored_attempts": len(rows) - len(scored),
        "reference_characters": nchar,
        "character_edits": cedit,
        "cer": cedit / nchar if nchar else None,
        "reference_words": nword,
        "word_edits": wedit,
        "wer": wedit / nword if nword else None,
        "missing_output_attempts": sum(r["score"]["text"]["missing_output"] for r in scored),
        "failed_attempts": sum(r["score"]["candidate_failed"] for r in scored),
        "critical_count_checks": len(checks),
        "critical_count_matches": sum(x["count_matches"] for x in checks),
        "clean_claims": sum(r["score"]["claims_clean"] for r in scored),
        "false_clean_text_claims": sum(r["score"]["false_clean_text"] for r in scored),
        "observed_empty_attempts": sum(r.get("output_empty", False) for r in rows),
        "reading_order_accuracy": None,
        "semantic_table_accuracy": None,
        "accepted_extractions": 0,
    }

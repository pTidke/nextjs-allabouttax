"""Source-bound, reshapable table drafts. Never overwrites OCR or grants acceptance."""

import json
from pathlib import Path
from typing import Literal

from pydantic import Field

from .benchmark import digest
from .models import Artifact, Model
from .review_store import checksum
from .runner import verify_package
from .table_review import SHA


class RepairBinding(Model):
    run_id: str
    source_sha256: str = Field(pattern=SHA)
    artifact_sha256: str = Field(pattern=SHA)
    render_sha256: str = Field(pattern=SHA)
    trial_sha256: str = Field(pattern=SHA)
    raw_sha256: str = Field(pattern=SHA)
    table_sha256: str = Field(pattern=SHA)
    page: int = Field(ge=1)
    case_id: str
    table_index: int = Field(ge=0, le=49)


class SourceSpan(Model):
    cell: int = Field(ge=0, le=9999)
    start: int = Field(ge=0)
    end: int = Field(ge=1)


class RepairCell(Model):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,80}$")
    row: int = Field(ge=0)
    column: int = Field(ge=0)
    row_span: int = Field(default=1, ge=1)
    column_span: int = Field(default=1, ge=1)
    state: Literal["unresolved", "transcribed", "blank", "unreadable"] = "unresolved"
    text: str | None = Field(default=None, max_length=20000)
    role: Literal["header", "value", "context"] = "value"
    headers: list[str] = Field(default_factory=list, max_length=20)
    source_refs: list[SourceSpan] = Field(default_factory=list, max_length=100)
    note: str = Field(default="", max_length=4000)


class RepairDraft(Model):
    schema_version: Literal["0.1.0"] = "0.1.0"
    state: Literal["TABLE_RECONSTRUCTION_DRAFT"] = "TABLE_RECONSTRUCTION_DRAFT"
    publication_eligible: Literal[False] = False
    owner_verified: Literal[False] = False
    binding: RepairBinding
    reviewer_name: str = Field(default="", max_length=200)
    scope_note: str = Field(min_length=1, max_length=4000)
    x: list[float] = Field(min_length=2, max_length=101)
    y: list[float] = Field(min_length=2, max_length=101)
    cells: list[RepairCell] = Field(min_length=1, max_length=10000)


def source_evidence(package, case_id, table_index=0):
    """Derive paths from the registered package/trial, never from a draft-supplied path."""
    package = package.resolve()
    trial = package.parent.parent
    ledger_path = trial / "files.json"
    if ledger_path.stat().st_size > 1024**2:
        raise ValueError("Trial ledger exceeds budget")
    ledger = json.loads(ledger_path.read_text())
    if not 1 <= len(ledger) <= 500:
        raise ValueError("Trial inventory exceeds budget")
    total = 0
    for name, sha in ledger.items():
        path = (trial / name).resolve()
        if not path.is_relative_to(trial) or not path.is_file():
            raise ValueError("Unsafe trial evidence path")
        total += path.stat().st_size
        if total > 300 * 1024**2 or digest(path) != sha:
            raise ValueError("Trial evidence changed or exceeds budget")
    artifact_file = package / "artifact.json"
    artifact = Artifact.model_validate_json(artifact_file.read_text())
    checked = verify_package(artifact.model_copy(deep=True), package)
    if any(
        i.code in {"ORIGINAL_CHECKSUM_MISMATCH", "RENDER_CHECKSUM_MISMATCH", "RENDER_MISSING"}
        for i in checked.issues
    ):
        raise ValueError("Source package integrity failed")
    report_file = trial / "scan-tables.json"
    report = json.loads(report_file.read_text())
    case = next((c for c in report["cases"] if c["id"] == case_id), None)
    if not case or case["source_sha256"] != artifact.source_sha256:
        raise ValueError("Case belongs to a different original")
    page = next((p for p in artifact.pages if p.number == case["page"]), None)
    if (
        not page
        or not page.render
        or digest(artifact_file) != case["artifact_sha256"]
        or page.render_sha256 != case["source_render_sha256"]
        or (page.width, page.height) != (case["source_page_width"], case["source_page_height"])
    ):
        raise ValueError("Source page revision mismatch")
    attempt = next(a for a in case["attempts"] if a["provider"] == "docling-image-en")
    raw_path = (trial / attempt["raw"]).resolve()
    image = (trial / case["image"]).resolve()
    if (
        attempt["state"] != "EXPERIMENTAL_NOT_ACCEPTED"
        or not raw_path.is_relative_to(trial)
        or not image.is_relative_to(trial)
        or attempt["raw"] not in ledger
        or case["image"] not in ledger
        or digest(raw_path) != attempt["raw_sha256"]
        or digest(image) != page.render_sha256
    ):
        raise ValueError("Image/provider revision mismatch")
    raw = json.loads(raw_path.read_text())
    tables = raw.get("tables", [])
    if not 0 <= table_index < min(50, len(tables)):
        raise ValueError("Unknown provider table")
    table = tables[table_index]
    cells = table.get("data", {}).get("table_cells", [])
    if not 1 <= len(cells) <= 10000 or any(not isinstance(c.get("text"), str) for c in cells):
        raise ValueError("Invalid raw cell inventory")
    bound = RepairBinding(
        run_id=artifact.run_id,
        source_sha256=artifact.source_sha256,
        artifact_sha256=digest(artifact_file),
        render_sha256=page.render_sha256,
        trial_sha256=digest(report_file),
        raw_sha256=digest(raw_path),
        table_sha256=checksum(table),
        page=page.number,
        case_id=case_id,
        table_index=table_index,
    )
    return bound, page, cells, image


def validate_layout(draft, width, height, raw_cells):
    """Validate geometry/accounting only. Unplaced characters remain explicit holds."""
    xs, ys = draft.x, draft.y
    if not (0 <= xs[0] < xs[-1] <= width and 0 <= ys[0] < ys[-1] <= height):
        raise ValueError("Grid outside source page")
    if any(b - a < 0.1 for axis in (xs, ys) for a, b in zip(axis, axis[1:], strict=False)):
        raise ValueError("Grid boundaries must be strictly ordered and separated")
    if (len(xs) - 1) * (len(ys) - 1) > 10000:
        raise ValueError("Grid exceeds budget")
    by_id = {c.id: c for c in draft.cells}
    if len(by_id) != len(draft.cells):
        raise ValueError("Duplicate cell identity")
    occupied, assigned, span_budget = set(), {}, 0
    for cell in draft.cells:
        if cell.row + cell.row_span >= len(ys) or cell.column + cell.column_span >= len(xs):
            raise ValueError("Cell span outside grid")
        span_budget += cell.row_span * cell.column_span
        if span_budget > 20000:
            raise ValueError("Cell spans exceed budget")
        for r in range(cell.row, cell.row + cell.row_span):
            for col in range(cell.column, cell.column + cell.column_span):
                if (r, col) in occupied:
                    raise ValueError("Overlapping reconstructed cells")
                occupied.add((r, col))
        if cell.state == "transcribed" and (cell.text is None or not cell.text.strip()):
            raise ValueError("Transcribed cells need visible text")
        if cell.state == "blank" and (cell.text != "" or not cell.note.strip()):
            raise ValueError("Confirmed blank requires an explicit source-review note")
        if cell.state in {"unresolved", "unreadable"} and cell.text is not None:
            raise ValueError("Unresolved cells cannot invent text")
        literal = []
        for ref in cell.source_refs:
            if ref.cell >= len(raw_cells):
                raise ValueError("Unknown raw cell reference")
            text = raw_cells[ref.cell]["text"]
            if not ref.start < ref.end <= len(text):
                raise ValueError("OCR span outside raw text")
            existing = assigned.setdefault(ref.cell, [])
            if any(ref.start < end and start < ref.end for start, end in existing):
                raise ValueError("OCR characters cannot be silently duplicated")
            existing.append((ref.start, ref.end))
            literal.append(text[ref.start : ref.end])
        if cell.state == "transcribed" and cell.text != "".join(literal) and not cell.note.strip():
            raise ValueError("Source transcription/correction requires a note")
        if len(set(cell.headers)) != len(cell.headers):
            raise ValueError("Duplicate header association")
        for key in cell.headers:
            header = by_id.get(key)
            if (
                not header
                or header.role != "header"
                or header.row + header.row_span > cell.row
                or not header.column <= cell.column
                or header.column + header.column_span < cell.column + cell.column_span
            ):
                raise ValueError("Header must precede and cover its associated columns")
    if len(occupied) != (len(xs) - 1) * (len(ys) - 1):
        raise ValueError("Every grid position needs an explicit cell, including unresolved areas")
    unplaced = []
    for index, raw in enumerate(raw_cells):
        cursor = 0
        for start, end in sorted(assigned.get(index, [])):
            if cursor < start:
                unplaced.append({"cell": index, "start": cursor, "end": start})
            cursor = end
        if cursor < len(raw["text"]):
            unplaced.append({"cell": index, "start": cursor, "end": len(raw["text"])})
    total = sum(len(c["text"]) for c in raw_cells)
    unused = sum(x["end"] - x["start"] for x in unplaced)
    return {
        "raw_characters": total,
        "mapped_characters": total - unused,
        "unplaced_characters": unused,
        "unplaced": unplaced,
        "unresolved_cells": sum(c.state == "unresolved" for c in draft.cells),
        "publication_eligible": False,
    }


def validate_repair(package: Path, value):
    if isinstance(value, Path):
        if value.stat().st_size > 5 * 1024**2:
            raise ValueError("Repair exceeds byte budget")
        value = json.loads(value.read_text())
    draft = RepairDraft.model_validate(value)
    bound, page, cells, _ = source_evidence(
        package, draft.binding.case_id, draft.binding.table_index
    )
    if bound != draft.binding:
        raise ValueError("Repair belongs to a different source/provider revision")
    return draft, validate_layout(draft, page.width, page.height, cells)

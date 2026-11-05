"""Source-bound table drafts. Drafts never change raw candidates or approve output."""

import json
import re
import shutil
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator

from .benchmark import digest
from .models import Artifact, Model
from .runner import verify_package

SHA = "^[a-f0-9]{64}$"


class Binding(Model):
    source_sha256: str = Field(pattern=SHA)
    artifact_sha256: str = Field(pattern=SHA)
    render_sha256: str = Field(pattern=SHA)
    table_sha256: str = Field(pattern=SHA)
    run_id: str
    fingerprint: str
    page: int = Field(ge=1)
    table_id: str


class CellDraft(Model):
    id: str
    disposition: Literal["unreviewed", "text", "blank", "covered", "unreadable"]
    text: str | None = Field(default=None, max_length=20000)
    row_span: int | None = Field(default=None, ge=1)
    column_span: int | None = Field(default=None, ge=1)
    covered_by: str | None = None
    header_path: list[str] = Field(default_factory=list, max_length=30)
    unit: str | None = Field(default=None, max_length=500)
    note: str = Field(default="", max_length=4000)

    @model_validator(mode="after")
    def preserve_meaning(self):
        if self.disposition == "text" and (self.text is None or not self.text.strip()):
            raise ValueError("Text cells require a visible transcription")
        if self.disposition == "blank" and self.text != "":
            raise ValueError("Confirmed blank is the empty string")
        if self.disposition not in {"text", "blank"} and self.text is not None:
            raise ValueError("Unreviewed/covered/unreadable cells cannot invent text")
        if (self.disposition == "covered") != bool(self.covered_by):
            raise ValueError("Covered cells must reference their spanning anchor")
        if self.disposition in {"covered", "unreviewed", "unreadable"} and (
            self.row_span is not None or self.column_span is not None
        ):
            raise ValueError("Only transcribed/blank anchors may propose spans")
        return self


class FootnoteDraft(Model):
    text: str = Field(min_length=1, max_length=8000)
    source_block_ids: list[str] = Field(min_length=1, max_length=100)


class TableDraft(Model):
    schema_version: Literal["0.1.0"] = "0.1.0"
    state: Literal["DRAFT_NOT_ACCEPTED"] = "DRAFT_NOT_ACCEPTED"
    publication_eligible: Literal[False] = False
    binding: Binding
    reviewer_name: str = Field(default="", max_length=200)
    header_rows: list[int] = Field(default_factory=list)
    cells: list[CellDraft] = Field(min_length=1, max_length=10000)
    footnotes: list[FootnoteDraft] = Field(default_factory=list, max_length=100)
    table_note: str = Field(default="", max_length=8000)


def table_digest(table):
    import hashlib

    return hashlib.sha256(json.dumps(table.model_dump(), sort_keys=True).encode()).hexdigest()


def binding(artifact, artifact_sha, page, table):
    return Binding(
        source_sha256=artifact.source_sha256,
        artifact_sha256=artifact_sha,
        render_sha256=page.render_sha256,
        table_sha256=table_digest(table),
        run_id=artifact.run_id,
        fingerprint=artifact.fingerprint,
        page=page.number,
        table_id=table.id,
    )


def validate_draft(package: Path, value) -> TableDraft:
    """Validate provenance/geometry, not transcription correctness or legal meaning."""
    if isinstance(value, Path):
        if value.stat().st_size > 5 * 1024**2:
            raise ValueError("Draft exceeds byte budget")
        value = json.loads(value.read_text())
    draft = TableDraft.model_validate(value)
    artifact_file = package / "artifact.json"
    artifact = Artifact.model_validate_json(artifact_file.read_text())
    checked = verify_package(artifact.model_copy(deep=True), package)
    if any(
        i.code in {"ORIGINAL_CHECKSUM_MISMATCH", "RENDER_CHECKSUM_MISMATCH", "RENDER_MISSING"}
        for i in checked.issues
    ):
        raise ValueError("Source package integrity failed")
    page = next((p for p in artifact.pages if p.number == draft.binding.page), None)
    table = next((t for t in page.tables if t.id == draft.binding.table_id), None) if page else None
    if (
        not table
        or not page.render
        or draft.binding != binding(artifact, digest(artifact_file), page, table)
    ):
        raise ValueError("Draft does not match this exact source/table revision")
    originals = {c.id: c for c in table.cells}
    cells = {c.id: c for c in draft.cells}
    if set(cells) != set(originals) or len(cells) != len(draft.cells):
        raise ValueError("Draft must contain every candidate cell exactly once")
    if len(set(draft.header_rows)) != len(draft.header_rows) or any(
        type(r) is not int or not 0 <= r < table.rows for r in draft.header_rows
    ):
        raise ValueError("Header row outside source grid")
    occupied = {}
    spans = {}
    for cell in draft.cells:
        if cell.disposition in {"covered", "unreviewed", "unreadable"}:
            continue
        original = originals[cell.id]
        rs, cs = cell.row_span or 1, cell.column_span or 1
        if original.row + rs > table.rows or original.column + cs > table.columns:
            raise ValueError("Proposed span exceeds source grid")
        points = {
            (r, c)
            for r in range(original.row, original.row + rs)
            for c in range(original.column, original.column + cs)
        }
        for point in points:
            if point in occupied:
                raise ValueError("Overlapping proposed anchors")
            occupied[point] = cell.id
        spans[cell.id] = points
    for cell in draft.cells:
        original = originals[cell.id]
        owner = occupied.get((original.row, original.column))
        if cell.disposition == "covered":
            if (
                cell.covered_by not in spans
                or owner != cell.covered_by
                or cell.covered_by == cell.id
            ):
                raise ValueError("Covered cell is not inside the referenced anchor span")
        elif owner and owner != cell.id:
            raise ValueError("Every cell covered by a span must explicitly reference its anchor")
    block_ids = {b.id for b in page.blocks}
    if any(
        not set(f.source_block_ids) <= block_ids
        or len(f.source_block_ids) != len(set(f.source_block_ids))
        for f in draft.footnotes
    ):
        raise ValueError("Footnotes require unique source blocks on this page")
    return draft


def write_workspace(root, rows):
    output = root / "tables"
    output.mkdir()
    tables = []
    for row in rows:
        if not row.get("package"):
            continue
        package = root / row["package"]
        artifact = Artifact.model_validate_json((package / "artifact.json").read_text())
        for page in artifact.pages:
            for table in page.tables:
                if not page.render:
                    continue
                if not re.fullmatch(r"[a-zA-Z0-9_-]+", table.id):
                    raise ValueError("Unsafe table identifier")
                draft = TableDraft(
                    binding=binding(artifact, digest(package / "artifact.json"), page, table),
                    cells=[CellDraft(id=c.id, disposition="unreviewed") for c in table.cells],
                )
                tables.append(
                    {
                        "id": f"{artifact.run_id}:{table.id}",
                        "title": artifact.source_title,
                        "kind": row["kind"],
                        "package": "../" + row["package"],
                        "render": "../" + row["package"] + "/" + page.render,
                        "width": page.width,
                        "height": page.height,
                        "page": page.number,
                        "table": table.model_dump(),
                        "blocks": [
                            {"id": b.id, "raw_text": b.raw_text, "bbox": b.bbox.model_dump()}
                            for b in page.blocks
                        ],
                        "draft": draft.model_dump(),
                    }
                )
    tables.sort(key=lambda t: (t["kind"] != "synthetic", t["title"], t["page"], t["table"]["id"]))
    (output / "tables.json").write_text(
        json.dumps({"publication_eligible": False, "tables": tables}, indent=2)
    )
    assets = Path(__file__).parent / "table_assets"
    for name in ("index.html", "workspace.js", "workspace.css"):
        shutil.copyfile(assets / name, output / name)

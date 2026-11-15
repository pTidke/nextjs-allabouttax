"""Provider-independent candidate contract. Coordinates use displayed page points,
top-left origin. Raw and normalised display text remain separate.
No model here represents an approved extraction or approved tax knowledge.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Box(Model):
    x0: float = Field(ge=0)
    top: float = Field(ge=0)
    x1: float = Field(ge=0)
    bottom: float = Field(ge=0)

    @model_validator(mode="after")
    def ordered(self):
        if self.x1 < self.x0 or self.bottom < self.top:
            raise ValueError("Inverted source region")
        return self


class Issue(Model):
    code: str = Field(pattern="^[A-Z][A-Z0-9_]{2,79}$")
    severity: Literal["blocking", "review", "info"]
    message: str
    page: int | None = Field(default=None, ge=1)
    region_id: str | None = None


class Glyph(Model):
    id: str
    text: str
    bbox: Box


class Block(Model):
    id: str
    kind: Literal["text_line", "paragraph", "heading", "footnote", "other"]
    raw_text: str
    display_text: str
    bbox: Box
    order: int = Field(ge=0)
    order_verified: Literal[False] = False
    source: Literal["native", "ocr", "layout"]
    glyphs: list[Glyph] = Field(default_factory=list)
    table_id: str | None = None


class Cell(Model):
    id: str
    row: int = Field(ge=0)
    column: int = Field(ge=0)
    raw_text: str | None  # None is unresolved/covered, not equivalent to blank.
    bbox: Box | None
    row_span: int | None = Field(default=None, ge=1)
    column_span: int | None = Field(default=None, ge=1)
    header_path: list[str] = Field(default_factory=list)
    header_verified: Literal[False] = False


class Table(Model):
    id: str
    bbox: Box
    rows: int = Field(ge=1)
    columns: int = Field(ge=1)
    cells: list[Cell]
    structure_verified: Literal[False] = False

    @model_validator(mode="after")
    def complete_grid(self):
        expected = {(r, c) for r in range(self.rows) for c in range(self.columns)}
        actual = {(c.row, c.column) for c in self.cells}
        if actual != expected or len(actual) != len(self.cells):
            raise ValueError("Table grid is incomplete or duplicated")
        return self


class Page(Model):
    number: int = Field(ge=1, le=1000)
    printed_label: str | None = None
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    rotation: int = 0
    status: Literal[
        "native_candidate", "ocr_required", "blank_candidate", "failed", "not_processed"
    ]
    render: str | None = Field(default=None, pattern=r"^pages/[0-9]{4}\.png$")
    render_sha256: str | None = Field(default=None, pattern="^[a-f0-9]{64}$")
    blocks: list[Block] = Field(default_factory=list)
    tables: list[Table] = Field(default_factory=list)
    issues: list[Issue] = Field(default_factory=list)
    metrics: dict[str, float | int | str] = Field(default_factory=dict)
    languages: list[str] = Field(default_factory=list)
    languages_verified: Literal[False] = False

    @model_validator(mode="after")
    def bounds(self):
        boxes = [b.bbox for b in self.blocks]
        boxes += [w.bbox for b in self.blocks for w in b.glyphs]
        boxes += [t.bbox for t in self.tables]
        boxes += [c.bbox for t in self.tables for c in t.cells if c.bbox]
        if any(b.x1 > self.width + 1 or b.bottom > self.height + 1 for b in boxes):
            raise ValueError("Source region exceeds displayed page bounds")
        return self


class Artifact(Model):
    schema_version: Literal["0.1.0"] = "0.1.0"
    pipeline_version: str
    run_id: str
    created_at: str
    source_sha256: str = Field(pattern="^[a-f0-9]{64}$")
    source_bytes: int = Field(ge=0)
    source_title: str
    original: Literal["original.pdf"] = "original.pdf"
    engine_versions: dict[str, str]
    config: dict[str, int | str | bool]
    fingerprint: str
    expected_pages: int | None = Field(default=None, ge=1, le=1000)
    pages: list[Page] = Field(default_factory=list, max_length=1000)
    issues: list[Issue] = Field(default_factory=list)
    page_accounting_complete: bool = False
    processed_pages_complete: bool = False
    state: Literal["BLOCKED", "AWAITING_EXTRACTION_REVIEW"] = "BLOCKED"
    publication_eligible: Literal[False] = False
    acceptance: None = None


def assess(artifact: Artifact) -> Artifact:
    """Recompute gates. Missing pages and missing renders are blocking, even if
    candidate text looks good. A successful native pass never approves content.
    """
    expected = set(range(1, (artifact.expected_pages or 0) + 1))
    actual = [p.number for p in artifact.pages]
    artifact.page_accounting_complete = (
        bool(expected) and set(actual) == expected and len(actual) == len(expected)
    )
    generated = {
        "PAGE_ACCOUNTING_INCOMPLETE",
        "PAGE_PROCESSING_INCOMPLETE",
        "UNIQUE_REGION_IDS_REQUIRED",
        "RENDER_MISSING",
    }
    artifact.issues = [i for i in artifact.issues if i.code not in generated]
    if not artifact.page_accounting_complete:
        artifact.issues.append(
            Issue(
                code="PAGE_ACCOUNTING_INCOMPLETE",
                severity="blocking",
                message="Every original page must have exactly one manifest entry.",
            )
        )
    artifact.processed_pages_complete = artifact.page_accounting_complete and all(
        p.status not in {"failed", "not_processed"} and p.render for p in artifact.pages
    )
    if not artifact.processed_pages_complete:
        artifact.issues.append(
            Issue(
                code="PAGE_PROCESSING_INCOMPLETE",
                severity="blocking",
                message="Some pages have not completed inspection and rendering.",
            )
        )
    ids = [b.id for p in artifact.pages for b in p.blocks]
    ids += [w.id for p in artifact.pages for b in p.blocks for w in b.glyphs]
    ids += [t.id for p in artifact.pages for t in p.tables]
    ids += [c.id for p in artifact.pages for t in p.tables for c in t.cells]
    if len(ids) != len(set(ids)):
        artifact.issues.append(
            Issue(
                code="UNIQUE_REGION_IDS_REQUIRED",
                severity="blocking",
                message="Source region identifiers must be unique within a revision.",
            )
        )
    blocked = any(i.severity == "blocking" for i in artifact.issues)
    blocked |= any(i.severity == "blocking" for p in artifact.pages for i in p.issues)
    blocked |= any(p.status != "native_candidate" for p in artifact.pages)
    artifact.state = "BLOCKED" if blocked else "AWAITING_EXTRACTION_REVIEW"
    return artifact

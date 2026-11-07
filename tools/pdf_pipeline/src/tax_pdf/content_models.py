"""Non-publishing structured content draft. Raw spans must be completely accounted for."""

from typing import Literal

from pydantic import Field, model_validator

from .models import Box, Model, Table

SHA = r"^[a-f0-9]{64}$"


class SourceLine(Model):
    number: int = Field(ge=1)
    raw_text: str
    image_bbox: Box
    bbox: Box
    confidence: float = Field(ge=0, le=100)


class FieldEdit(Model):
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    before: str
    after: str
    field: Literal["printed_header_date"]
    review_sha256: str = Field(pattern=SHA)


class ContentRegion(Model):
    id: str
    source_line: int = Field(ge=1)
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    raw_text: str
    reviewed_text: str | None = None
    edits: list[FieldEdit] = Field(default_factory=list)
    image_bbox: Box
    bbox: Box
    scope: Literal[
        "content_candidate",
        "administrative_excluded",
        "signature_excluded",
        "metadata",
        "mixed_review",
        "table_review",
    ]
    scope_evidence: list[str] = Field(default_factory=list)
    proposed_order: int = Field(ge=1)
    order_verified: Literal[False] = False
    holds: list[str] = Field(default_factory=list)
    table_ids: list[str] = Field(default_factory=list)
    crop: str
    crop_sha256: str = Field(pattern=SHA)


class ContentPage(Model):
    input_id: str
    title: str
    variant: str
    page: int = Field(ge=1)
    source_sha256: str = Field(pattern=SHA)
    source_render_sha256: str = Field(pattern=SHA)
    raw_sha256: str = Field(pattern=SHA)
    expected_pages: int = Field(ge=1)
    unrepresented_pages: list[int]
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    image_width: int = Field(gt=0)
    image_height: int = Field(gt=0)
    source_image: str
    original: str
    raw: str
    artifact: str
    artifact_sha256: str = Field(pattern=SHA)
    source_lines: list[SourceLine] = Field(max_length=2000)
    regions: list[ContentRegion] = Field(max_length=6000)
    tables: list[Table] = Field(default_factory=list)
    reviewed_fields: dict[str, str] = Field(default_factory=dict)
    warnings: list[dict] = Field(default_factory=list)
    holds: list[str]
    state: Literal["DRAFT_REVIEW_REQUIRED"] = "DRAFT_REVIEW_REQUIRED"
    publication_eligible: Literal[False] = False

    @model_validator(mode="after")
    def complete_spans(self):
        numbers = [line.number for line in self.source_lines]
        if numbers != list(range(1, len(numbers) + 1)):
            raise ValueError("Raw source lines must be complete and ordered")
        if len({r.id for r in self.regions}) != len(self.regions):
            raise ValueError("Duplicate structured region")
        if sorted(r.proposed_order for r in self.regions) != list(range(1, len(self.regions) + 1)):
            raise ValueError("Proposed order is incomplete")
        if any(r.source_line not in numbers for r in self.regions):
            raise ValueError("Unknown source line")
        if (
            self.unrepresented_pages
            != [p for p in range(1, self.expected_pages + 1) if p != self.page]
            or self.page > self.expected_pages
        ):
            raise ValueError("Incorrect partial-document accounting")
        for line in self.source_lines:
            if (
                line.image_bbox.x1 > self.image_width
                or line.image_bbox.bottom > self.image_height
                or line.bbox.x1 > self.width
                or line.bbox.bottom > self.height
            ):
                raise ValueError("Raw source line exceeds page")
            owned = [r for r in self.regions if r.source_line == line.number]
            if not owned or (not line.raw_text and len(owned) != 1):
                raise ValueError("Raw line must have an exhaustive unique partition")
            cursor = 0
            for r in sorted(
                (r for r in self.regions if r.source_line == line.number), key=lambda r: r.start
            ):
                if (
                    r.start != cursor
                    or r.end < r.start
                    or (r.end == r.start and bool(line.raw_text))
                    or r.raw_text != line.raw_text[r.start : r.end]
                ):
                    raise ValueError("Source characters omitted, duplicated or changed")
                cursor = r.end
                text = r.raw_text
                edits = sorted(r.edits, key=lambda e: e.start)
                if any(a.end > b.start for a, b in zip(edits[:-1], edits[1:], strict=True)):
                    raise ValueError("Overlapping reviewed edits")
                for edit in reversed(edits):
                    if (
                        not r.start <= edit.start <= edit.end <= r.end
                        or line.raw_text[edit.start : edit.end] != edit.before
                    ):
                        raise ValueError("Reviewed edit is not bound to raw text")
                    text = text[: edit.start - r.start] + edit.after + text[edit.end - r.start :]
                if r.reviewed_text != (text if edits else None):
                    raise ValueError("Reviewed text differs from explicit edits")
                if (
                    r.scope in ("administrative_excluded", "signature_excluded", "metadata")
                    and not r.scope_evidence
                ):
                    raise ValueError("Scope change requires review evidence")
                if r.scope == "signature_excluded" and (r.table_ids or r.edits):
                    raise ValueError(
                        "Signature scope cannot exclude table or reviewed field content"
                    )
                if (
                    r.image_bbox.x1 > self.image_width
                    or r.image_bbox.bottom > self.image_height
                    or r.bbox.x1 > self.width
                    or r.bbox.bottom > self.height
                ):
                    raise ValueError("Structured region exceeds source page")
            if cursor != len(line.raw_text):
                raise ValueError("Incomplete raw line coverage")
        if len({t.id for t in self.tables}) != len(self.tables) or any(
            t.bbox.x1 > self.width or t.bbox.bottom > self.height for t in self.tables
        ):
            raise ValueError("Invalid source table inventory")
        ids = {t.id for t in self.tables}
        if any(set(r.table_ids) - ids for r in self.regions):
            raise ValueError("Unknown table association")
        for region in self.regions:
            if not any(
                line.number == region.source_line
                and line.image_bbox.x0
                <= region.image_bbox.x0
                <= region.image_bbox.x1
                <= line.image_bbox.x1
                and line.image_bbox.top
                <= region.image_bbox.top
                <= region.image_bbox.bottom
                <= line.image_bbox.bottom
                for line in self.source_lines
            ):
                raise ValueError("Region is not inside its source line")
        return self


class ContentPreview(Model):
    schema_version: Literal["0.1.0"] = "0.1.0"
    state: Literal["DRAFT_NOT_ACCEPTED"] = "DRAFT_NOT_ACCEPTED"
    manifest_sha256: str = Field(pattern=SHA)
    date_report_sha256: str = Field(pattern=SHA)
    scope_review_sha256: str = Field(pattern=SHA)
    code_sha256: dict[str, str]
    pages: list[ContentPage] = Field(min_length=1, max_length=20)
    comparisons: list[dict]
    notes: list[str]
    acceptance: None = None
    publication_eligible: Literal[False] = False
    tax_review_completed: Literal[False] = False

    @model_validator(mode="after")
    def evidence_inventory(self):
        if len({p.input_id for p in self.pages}) != len(self.pages):
            raise ValueError("Duplicate OCR variant")
        if any(
            e.review_sha256 != self.scope_review_sha256
            for p in self.pages
            for r in p.regions
            for e in r.edits
        ):
            raise ValueError("Reviewed edit belongs to another scope review")
        return self

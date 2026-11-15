"""The output contract. Every piece of text stays anchored to its place on the page.

`schemas/document.schema.json` is generated from these models; a test keeps them in sync.
Coordinates are PDF points with a top-left origin on the displayed page.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = "0.1.0"

Status = Literal["accepted", "flagged", "blocked"]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Box(Model):
    x0: float
    top: float
    x1: float
    bottom: float


class Flag(Model):
    """Why a rule did not accept something. `rule` is a stable identifier."""

    rule: str
    severity: Literal["review", "blocking"]
    message: str


class Reading(Model):
    """Another reading of the same place, kept for comparison. Never merged into `text`."""

    source: str
    text: str
    confidence: float | None = None


class Line(Model):
    id: str
    page: int
    order: int
    box: Box
    raw: str = Field(description="Exactly what the reader returned.")
    text: str = Field(description="NFC-normalised `raw`. No other change is ever made.")
    source: str = Field(description='"native" or "ocr:<engine>".')
    readings: list[Reading] = Field(default_factory=list)
    font_size: float | None = None
    bold: bool = False
    scripts: list[str] = Field(default_factory=list)
    role: Literal["heading", "body", "table"] = "body"
    paragraph: int = 0
    table_id: str | None = None
    status: Status = "flagged"
    flags: list[Flag] = Field(default_factory=list)
    excluded: str | None = Field(
        default=None, description="Reason this line is kept as evidence but left out of exports."
    )


class Cell(Model):
    row: int
    column: int
    text: str | None = Field(description="None means the reader gave no value, not a blank.")
    box: Box | None = None


class Table(Model):
    id: str
    page: int
    box: Box
    rows: int
    columns: int
    cells: list[Cell]
    status: Status = "flagged"
    flags: list[Flag] = Field(default_factory=list)


class Page(Model):
    number: int
    width: float
    height: float
    rotation: int = 0
    kind: Literal["native", "scanned", "blank", "failed"]
    lines: list[Line] = Field(default_factory=list)
    tables: list[Table] = Field(default_factory=list)
    flags: list[Flag] = Field(default_factory=list)
    metrics: dict[str, float] = Field(default_factory=dict)


class Source(Model):
    sha256: str
    bytes: int
    filename: str
    pages: int


class Engine(Model):
    name: str
    version: str
    policy_version: str
    config_sha256: str
    components: dict[str, str]


class Document(Model):
    schema_version: Literal["0.1.0"] = SCHEMA_VERSION
    source: Source
    engine: Engine
    created_at: str
    title: str | None = None
    pages: list[Page]
    flags: list[Flag] = Field(default_factory=list)
    summary: dict[str, int] = Field(default_factory=dict)

    def lines(self):
        return (line for page in self.pages for line in page.lines)

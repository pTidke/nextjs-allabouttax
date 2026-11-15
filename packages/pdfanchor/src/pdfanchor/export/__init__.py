"""Turn a Document into files a language model or a vector index can use."""

from collections.abc import Iterator
from dataclasses import dataclass

from ..model import Document, Line, Table


@dataclass
class Unit:
    """One heading, paragraph or table in reading order."""

    kind: str
    page: int
    lines: list[Line]
    table: Table | None = None

    @property
    def text(self) -> str:
        if self.table:
            return table_markdown(self.table)
        return " ".join(line.text.strip() for line in self.lines if line.text.strip())

    @property
    def status(self) -> str:
        states = {line.status for line in self.lines} | ({self.table.status} if self.table else set())
        return "blocked" if "blocked" in states else "flagged" if "flagged" in states else "accepted"

    @property
    def rules(self) -> list[str]:
        flags = [flag for line in self.lines for flag in line.flags]
        flags += self.table.flags if self.table else []
        return sorted({flag.rule for flag in flags})


def table_markdown(table: Table) -> str:
    grid = [["" for _ in range(table.columns)] for _ in range(table.rows)]
    for cell in table.cells:
        grid[cell.row][cell.column] = " ".join((cell.text or "").split()).replace("|", "\\|")
    rows = ["| " + " | ".join(row) + " |" for row in grid]
    return "\n".join([rows[0], "|" + " --- |" * table.columns, *rows[1:]])


def units(document: Document) -> Iterator[Unit]:
    """Headings, paragraphs and tables in page order. Excluded lines are skipped."""
    for page in document.pages:
        tables = {table.id: table for table in page.tables}
        seen: set[str] = set()
        current: list[Line] = []
        for line in page.lines:
            if line.excluded:
                continue
            if line.table_id:
                if current:
                    yield Unit(current[0].role, page.number, current)
                    current = []
                if line.table_id not in seen:
                    seen.add(line.table_id)
                    members = [m for m in page.lines if m.table_id == line.table_id]
                    yield Unit("table", page.number, members, tables.get(line.table_id))
                continue
            if current and line.paragraph != current[0].paragraph:
                yield Unit(current[0].role, page.number, current)
                current = []
            current.append(line)
        if current:
            yield Unit(current[0].role, page.number, current)

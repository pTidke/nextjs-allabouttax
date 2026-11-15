"""Markdown for a language model to read. Page breaks and review flags are HTML comments,
so they survive in the text without being mistaken for content."""

from ..model import Document
from . import units


def to_markdown(document: Document, include: tuple[str, ...] = ("accepted", "flagged")) -> str:
    out: list[str] = []
    page = 0
    for unit in units(document):
        if unit.page != page:
            page = unit.page
            out.append(f"<!-- page {page} -->")
        if unit.status not in include:
            out.append(f"<!-- omitted ({unit.status}): {', '.join(unit.rules)} -->")
            continue
        text = unit.text
        if not text:
            continue
        out.append(f"## {text}" if unit.kind == "heading" else text)
        if unit.status != "accepted":
            out.append(f"<!-- {unit.status}: {', '.join(unit.rules)} -->")
    missing = [p.number for p in document.pages if p.kind in {"failed", "scanned"} and not p.lines]
    if missing:
        out.append(f"<!-- no text for pages: {', '.join(map(str, missing))} -->")
    return "\n\n".join(out) + "\n"

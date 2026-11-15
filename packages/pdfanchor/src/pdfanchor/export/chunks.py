"""Chunks for a vector index, one JSON object per line.

Each chunk carries what a retriever needs to cite it: the pages and boxes it came from,
the heading it sits under, and whether every rule accepted it. Index `embedding_text`;
show `text`; filter on `status`.
"""

import hashlib
import json

from ..config import Config
from ..model import SCHEMA_VERSION, Document
from . import Unit, units


def _chunk(document: Document, heading: str | None, members: list[Unit]) -> dict:
    lines = [line for unit in members for line in unit.lines]
    text = "\n\n".join(unit.text for unit in members if unit.text)
    context = [part for part in (document.title, heading) if part]
    if len(context) == 2 and context[0] == context[1]:
        context.pop()
    anchors = []
    for number in sorted({line.page for line in lines}):
        on_page = [line for line in lines if line.page == number]
        anchors.append(
            {
                "page": number,
                "box": [
                    round(min(line.box.x0 for line in on_page), 2),
                    round(min(line.box.top for line in on_page), 2),
                    round(max(line.box.x1 for line in on_page), 2),
                    round(max(line.box.bottom for line in on_page), 2),
                ],
                "line_ids": [line.id for line in on_page],
            }
        )
    states = {unit.status for unit in members}
    identity = document.source.sha256 + "|" + ",".join(line.id for line in lines)
    return {
        "schema_version": SCHEMA_VERSION,
        "id": hashlib.sha256(identity.encode()).hexdigest()[:24],
        "kind": "table" if members[0].kind == "table" else "text",
        "text": text,
        "context": context,
        "embedding_text": "\n".join([" > ".join(context), text]) if context else text,
        "pages": [anchor["page"] for anchor in anchors],
        "anchors": anchors,
        "status": "blocked" if "blocked" in states else "flagged" if "flagged" in states else "accepted",
        "rules": sorted({rule for unit in members for rule in unit.rules}),
        "sources": sorted({line.source for line in lines}),
        "document": {"sha256": document.source.sha256, "filename": document.source.filename},
    }


def to_chunks(
    document: Document, config: Config, include: tuple[str, ...] = ("accepted", "flagged")
) -> list[dict]:
    chunks: list[dict] = []
    heading: str | None = None
    pending: list[Unit] = []

    def flush():
        nonlocal pending
        if pending:
            chunks.append(_chunk(document, heading, pending))
            pending = []

    for unit in units(document):
        if unit.status not in include or not unit.text:
            continue
        if unit.kind == "heading":
            flush()
            heading = unit.text
        elif unit.kind == "table":
            flush()
            chunks.append(_chunk(document, heading, [unit]))
        else:
            size = sum(len(member.text) for member in pending)
            if pending and size + len(unit.text) > config.chunk_chars:
                flush()
            pending.append(unit)
    flush()
    return chunks


def to_jsonl(chunks: list[dict]) -> str:
    return "".join(json.dumps(chunk, ensure_ascii=False) + "\n" for chunk in chunks)

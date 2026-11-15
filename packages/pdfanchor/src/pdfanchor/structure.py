"""Light structure: scripts, headings, paragraphs, title. All of it is a proposal drawn
from layout, kept simple on purpose. It changes how text is grouped, never the text.
"""

import re
import statistics
import unicodedata

from .config import Config
from .model import Document

HEADING_WORD = re.compile(r"^(CHAPTER|PART|SCHEDULE|ANNEXURE|APPENDIX|SECTION)\b")
SCRIPTS = {"LATIN": "Latn", "DEVANAGARI": "Deva"}


def scripts_of(text: str) -> list[str]:
    found = set()
    for ch in text:
        if ch.isalpha() or unicodedata.category(ch).startswith("M"):
            name = unicodedata.name(ch, "").split(" ")[0]
            found.add(SCRIPTS.get(name, name.title()[:4] or "Zzzz"))
    return sorted(found)


def apply(document: Document, config: Config) -> None:
    sizes = [
        line.font_size
        for line in document.lines()
        if line.font_size and line.role == "body"
        for _ in range(max(1, len(line.text) // 20))
    ]
    body_size = statistics.median(sizes) if sizes else None
    for page in document.pages:
        heights = [line.box.bottom - line.box.top for line in page.lines]
        height = statistics.median(heights) if heights else 0.0
        paragraph, previous = 0, None
        for line in page.lines:
            line.scripts = scripts_of(line.text)
            if (
                line.scripts
                and config.exclude_scripts
                and set(line.scripts) <= set(config.exclude_scripts)
            ):
                line.excluded = "script:" + "+".join(line.scripts)
            text = line.text.strip()
            if line.role == "body" and text and len(text) <= 120:
                larger = bool(body_size and line.font_size and line.font_size >= body_size * 1.15)
                bold_title = line.bold and not text.endswith((".", ",", ";", ":"))
                if larger or bold_title or HEADING_WORD.match(text):
                    line.role = "heading"
            gap = line.box.top - previous.box.bottom if previous else 0.0
            if previous and (
                line.role != previous.role
                or line.role == "heading"
                or line.table_id != previous.table_id
                or gap > 0.6 * height
            ):
                paragraph += 1
            line.paragraph = paragraph
            previous = line
    document.title = next(
        (line.text.strip() for line in document.lines() if line.role == "heading"), None
    )

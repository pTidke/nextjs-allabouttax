"""Compare two readings of the same place. Agreement is decided by rule, not by confidence."""

import unicodedata
from collections import Counter
from dataclasses import dataclass
from difflib import SequenceMatcher

from .model import Box
from .ocr import OcrLine

NEGATIONS = {"not", "no", "nor", "never", "without", "except", "unless", "neither", "none"}
EDGE = ".,;:'\"“”‘’"


def normalise(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def critical_tokens(text: str) -> Counter:
    """Tokens where one wrong character changes the meaning: anything with a digit
    (amounts, dates, section and instrument numbers) and negations."""
    tokens: Counter = Counter()
    for word in normalise(text).split():
        word = word.strip(EDGE)
        if word.count("(") > word.count(")"):
            word = word.lstrip("(")
        if word.count(")") > word.count("("):
            word = word.rstrip(")")
        if any(ch.isdigit() for ch in word) or word in NEGATIONS:
            tokens[word] += 1
    return tokens


@dataclass(frozen=True)
class Agreement:
    similarity: float
    critical_equal: bool
    only_first: tuple[str, ...]
    only_second: tuple[str, ...]

    def agrees(self, min_similarity: float) -> bool:
        return self.critical_equal and self.similarity >= min_similarity


def compare(first: str, second: str) -> Agreement:
    a, b = critical_tokens(first), critical_tokens(second)
    return Agreement(
        similarity=round(SequenceMatcher(None, normalise(first), normalise(second)).ratio(), 4),
        critical_equal=a == b,
        only_first=tuple(sorted((a - b).elements())),
        only_second=tuple(sorted((b - a).elements())),
    )


def to_points(line: OcrLine, dpi: int) -> Box:
    scale = 72 / dpi
    x0, top, x1, bottom = (value * scale for value in line.box)
    return Box(x0=x0, top=top, x1=x1, bottom=bottom)


def text_inside(box: Box, readings: list[tuple[Box, OcrLine]], margin: float = 2.0) -> OcrLine | None:
    """The other engine's reading of the same line: OCR lines whose centre falls in `box`,
    joined left to right. None when the other engine found nothing there."""
    inside = [
        (other, line)
        for other, line in readings
        if box.x0 - margin <= (other.x0 + other.x1) / 2 <= box.x1 + margin
        and box.top - margin <= (other.top + other.bottom) / 2 <= box.bottom + margin
    ]
    if not inside:
        return None
    inside.sort(key=lambda pair: pair[0].x0)
    scores = [line.confidence for _, line in inside if line.confidence is not None]
    return OcrLine(
        text=" ".join(line.text for _, line in inside),
        box=(0, 0, 0, 0),
        confidence=round(sum(scores) / len(scores), 1) if scores else None,
    )

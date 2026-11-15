"""OCR engines sit behind one small interface so they can be compared and swapped.

An engine reads an image and returns lines with pixel boxes. It never sees another
engine's output or any expected text.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol, runtime_checkable


class EngineUnavailable(RuntimeError):
    """The engine's program or package is not installed."""


@dataclass(frozen=True)
class OcrLine:
    text: str
    box: tuple[float, float, float, float]  # x0, top, x1, bottom in image pixels
    confidence: float | None = None  # an engine signal, never a reason to accept


@runtime_checkable
class OcrEngine(Protocol):
    name: str

    def version(self) -> str: ...

    def read(self, image, languages: Sequence[str]) -> list[OcrLine]: ...


def available() -> list[OcrEngine]:
    """Engines that can run on this machine, most established first."""
    from .easyocr import EasyOcr
    from .tesseract import TesseractCli

    found: list[OcrEngine] = []
    for engine in (TesseractCli(), EasyOcr()):
        try:
            engine.version()
        except EngineUnavailable:
            continue
        found.append(engine)
    return found

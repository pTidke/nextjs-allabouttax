"""Settings. Everything that changes the output is here and is hashed into the result."""

import hashlib
import json
from dataclasses import asdict, dataclass, field


@dataclass(frozen=True)
class Policy:
    """Decision rules. The thresholds are starting values and are NOT calibrated yet.

    Until they are measured against verified reference pages, treat "accepted" as
    "passed every rule we have", not as a measured accuracy.
    """

    version: str = "0.1"
    # Two readings of a line agree when their similarity is at least this and
    # every critical token (numbers, dates, section references, negations) matches.
    min_similarity: float = 0.90
    # Accept clean native text when no OCR engine was available to cross-check it.
    accept_native_without_crosscheck: bool = False
    # Accept scanned text read by one engine only.
    accept_single_ocr_reading: bool = False


@dataclass(frozen=True)
class Config:
    dpi: int = 200
    languages: tuple[str, ...] = ("eng",)
    max_bytes: int = 100 * 1024**2
    max_pages: int = 1000
    max_render_pixels: int = 16_000_000
    min_native_chars: int = 20
    blank_dark_fraction: float = 0.0005
    # Lines made only of these scripts stay in document.json as evidence but are left
    # out of Markdown and chunks, and never need review. Example: ("Deva",).
    exclude_scripts: tuple[str, ...] = ()
    chunk_chars: int = 1200
    policy: Policy = field(default_factory=Policy)

    def sha256(self) -> str:
        return hashlib.sha256(json.dumps(asdict(self), sort_keys=True).encode()).hexdigest()

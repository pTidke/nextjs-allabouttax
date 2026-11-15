"""Text that a PDF's fonts could not map to real characters."""

import re
import unicodedata

from ..model import Flag

CID = re.compile(r"\(cid:\d+\)")


def check_encoding(text: str) -> list[Flag]:
    if (
        "�" in text
        or CID.search(text)
        or any(unicodedata.category(ch) in {"Co", "Cs"} for ch in text)
    ):
        return [
            Flag(
                rule="encoding.unmapped",
                severity="review",
                message="Contains characters the PDF could not map to text. "
                "Compare with the page image.",
            )
        ]
    return []

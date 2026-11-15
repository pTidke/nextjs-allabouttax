"""Tesseract through its command-line program. No Python binding is needed."""

import io
import shutil
import subprocess
from collections.abc import Sequence

from . import EngineUnavailable, OcrLine


def parse_tsv(tsv: str) -> list[OcrLine]:
    """Group Tesseract's word rows (level 5) into lines, keeping reading order."""
    groups: dict[tuple[str, ...], list[tuple[str, float, float, float, float, float]]] = {}
    rows = tsv.splitlines()
    for row in rows[1:]:
        cells = row.split("\t")
        if len(cells) < 12 or cells[0] != "5" or not cells[11].strip():
            continue
        left, top, width, height = (float(v) for v in cells[6:10])
        groups.setdefault(tuple(cells[1:5]), []).append(
            (cells[11], left, top, left + width, top + height, float(cells[10]))
        )
    lines = []
    for words in groups.values():
        scores = [w[5] for w in words if w[5] >= 0]
        lines.append(
            OcrLine(
                text=" ".join(w[0] for w in words),
                box=(
                    min(w[1] for w in words),
                    min(w[2] for w in words),
                    max(w[3] for w in words),
                    max(w[4] for w in words),
                ),
                confidence=round(sum(scores) / len(scores), 1) if scores else None,
            )
        )
    return lines


class TesseractCli:
    name = "tesseract"

    def __init__(self, binary: str = "tesseract", psm: int = 3, timeout: int = 120):
        self.binary, self.psm, self.timeout = binary, psm, timeout

    def version(self) -> str:
        if not shutil.which(self.binary):
            raise EngineUnavailable("The tesseract program is not installed.")
        output = subprocess.run(
            [self.binary, "--version"], capture_output=True, text=True, timeout=20, check=False
        )
        return (output.stdout or output.stderr).splitlines()[0].replace("tesseract", "").strip()

    def read(self, image, languages: Sequence[str]) -> list[OcrLine]:
        if not shutil.which(self.binary):
            raise EngineUnavailable("The tesseract program is not installed.")
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        result = subprocess.run(
            [self.binary, "stdin", "stdout", "-l", "+".join(languages), "--psm", str(self.psm),
             "--dpi", str(int(image.info.get("dpi", (300, 300))[0])), "tsv"],
            input=buffer.getvalue(),
            capture_output=True,
            timeout=self.timeout,
            check=False,
        )
        if result.returncode:
            raise RuntimeError("Tesseract failed: " + result.stderr.decode(errors="replace")[:300])
        return parse_tsv(result.stdout.decode("utf8", errors="replace"))

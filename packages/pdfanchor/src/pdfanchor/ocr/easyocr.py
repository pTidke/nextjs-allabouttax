"""EasyOCR as an independent second reader. Optional: `pip install pdfanchor[easyocr]`.

STATUS: written to the interface but not yet exercised by the test suite, because the
package and its weights are large. Port the pinned-weights, offline and time-budget
handling from `tools/pdf_pipeline/src/tax_pdf/easyocr_probe.py` before relying on it.
"""

from collections.abc import Sequence

from . import EngineUnavailable, OcrLine

CODES = {"eng": "en", "hin": "hi"}


class EasyOcr:
    name = "easyocr"

    def __init__(self, model_dir: str | None = None, download: bool = False):
        self.model_dir, self.download, self._readers = model_dir, download, {}

    def _module(self):
        try:
            import easyocr
        except ImportError as error:
            raise EngineUnavailable("The easyocr package is not installed.") from error
        return easyocr

    def version(self) -> str:
        return str(self._module().__version__)

    def read(self, image, languages: Sequence[str]) -> list[OcrLine]:
        import numpy

        codes = tuple(CODES.get(code, code) for code in languages)
        if codes not in self._readers:
            self._readers[codes] = self._module().Reader(
                list(codes),
                gpu=False,
                model_storage_directory=self.model_dir,
                download_enabled=self.download,
            )
        lines = []
        for polygon, text, confidence in self._readers[codes].readtext(numpy.asarray(image)):
            xs, ys = [p[0] for p in polygon], [p[1] for p in polygon]
            lines.append(
                OcrLine(
                    text=text,
                    box=(float(min(xs)), float(min(ys)), float(max(xs)), float(max(ys))),
                    confidence=round(float(confidence) * 100, 1),
                )
            )
        return lines

"""PDF in, anchored document out. One function runs every stage in order."""

import hashlib
import importlib.metadata
import io
import platform
import unicodedata
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

from . import __version__, native, policy, structure
from .config import Config
from .crosscheck import text_inside, to_points
from .export.chunks import to_chunks, to_jsonl
from .export.markdown import to_markdown
from .model import Document, Engine, Flag, Line, Page, Reading, Source
from .ocr import OcrEngine, OcrLine, available


class ConversionError(Exception):
    """The file could not be processed at all."""


def _preflight(data: bytes, config: Config) -> tuple[int, list[Flag]]:
    from pypdf import PdfReader
    from pypdf.errors import PyPdfError

    if len(data) > config.max_bytes:
        raise ConversionError("The file is larger than the byte budget.")
    if not data.startswith(b"%PDF-"):
        raise ConversionError("The file is not a PDF.")
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise ConversionError("The PDF is encrypted.")
        count = len(reader.pages)
        root = reader.trailer["/Root"]
        names = root.get("/Names", {})
        names = names.get_object() if hasattr(names, "get_object") else names
        fields = reader.get_fields() or {}
    except PyPdfError as error:
        raise ConversionError("The PDF could not be parsed.") from error
    flags = []
    if root.get("/OpenAction") or root.get("/AA") or names.get("/JavaScript"):
        flags.append(
            Flag(rule="pdf.active-content", severity="review", message="Has actions or scripts; none are run.")
        )
    if names.get("/EmbeddedFiles"):
        flags.append(
            Flag(rule="pdf.embedded-files", severity="review", message="Has attachments that were not read.")
        )
    if fields:
        flags.append(
            Flag(rule="pdf.form-fields", severity="review", message="Has form fields; their values were not read.")
        )
    return count, flags


def _ocr(engine: OcrEngine, image, config: Config) -> list[tuple]:
    return [(to_points(line, config.dpi), line) for line in engine.read(image, config.languages)]


def _scanned(page: Page, image, engines: Sequence[OcrEngine], config: Config) -> None:
    """Lines come from the first engine. Later engines only add comparison readings."""
    if not engines:
        page.flags.append(
            Flag(rule="ocr.unavailable", severity="blocking", message="A scanned page and no OCR engine.")
        )
        return
    first, *rest = engines
    others = [(engine.name, _ocr(engine, image, config)) for engine in rest]
    found = sorted(_ocr(first, image, config), key=lambda pair: (round(pair[0].top / 4), pair[0].x0))
    for order, (box, read) in enumerate(found):
        line = Line(
            id=f"p{page.number}-l{order + 1}",
            page=page.number,
            order=order,
            box=box,
            raw=read.text,
            text=unicodedata.normalize("NFC", read.text),
            source=f"ocr:{first.name}",
        )
        _attach(line, others, read)
        page.lines.append(line)
    if not page.lines:
        page.flags.append(
            Flag(rule="ocr.no-text", severity="blocking", message="The page has ink but OCR returned no lines.")
        )


def _attach(line: Line, readings: list[tuple[str, list[tuple]]], own: OcrLine | None = None) -> None:
    if own is not None:
        line.readings.append(Reading(source=line.source, text=own.text, confidence=own.confidence))
    for name, lines in readings:
        other = text_inside(line.box, lines)
        line.readings.append(
            Reading(
                source=f"ocr:{name}",
                text=other.text if other else "",
                confidence=other.confidence if other else None,
            )
        )


def convert(
    source: str | Path | bytes,
    *,
    config: Config | None = None,
    engines: Sequence[OcrEngine] | None = None,
    filename: str | None = None,
) -> Document:
    """Convert one PDF. `engines=None` uses whatever OCR engines are installed;
    pass `[]` to read the text layer only."""
    import pdfplumber

    config = config or Config()
    data = source if isinstance(source, bytes) else Path(source).read_bytes()
    name = filename or (Path(source).name if not isinstance(source, bytes) else "document.pdf")
    count, flags = _preflight(data, config)
    engines = available() if engines is None else list(engines)
    pages: list[Page] = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for number, raw in enumerate(pdf.pages, 1):
            if number > config.max_pages:
                pages.append(_failed(raw, number, "budget.page-limit", "Beyond the page budget; not read."))
                continue
            try:
                page = native.read_page(raw, number, config)
                if page.kind == "scanned" or (page.kind == "native" and engines):
                    image = native.render(raw, config.dpi, config.max_render_pixels)
                    image.info["dpi"] = (config.dpi, config.dpi)
                    if page.kind == "scanned":
                        _scanned(page, image, engines, config)
                    else:
                        readings = [(e.name, _ocr(e, image, config)) for e in engines]
                        for line in page.lines:
                            _attach(line, readings)
                pages.append(page)
            except Exception as error:  # one bad page must not lose the others
                pages.append(_failed(raw, number, "page.failed", f"{type(error).__name__} while reading."))
    components = {
        package: importlib.metadata.version(package)
        for package in ("pdfplumber", "pypdf", "pypdfium2", "pydantic", "Pillow")
    }
    components["python"] = platform.python_version()
    for engine in engines:
        components[f"ocr:{engine.name}"] = engine.version()
    document = Document(
        source=Source(sha256=hashlib.sha256(data).hexdigest(), bytes=len(data), filename=name, pages=count),
        engine=Engine(
            name="pdfanchor",
            version=__version__,
            policy_version=config.policy.version,
            config_sha256=config.sha256(),
            components=components,
        ),
        created_at=datetime.now(UTC).isoformat(timespec="seconds"),
        pages=pages,
        flags=flags,
    )
    if len(pages) != count:
        document.flags.append(
            Flag(rule="pdf.page-count-mismatch", severity="blocking", message="Readers disagree on page count.")
        )
    structure.apply(document, config)
    policy.decide(document, config.policy)
    return document


def _failed(raw, number: int, rule: str, message: str) -> Page:
    return Page(
        number=number,
        width=float(raw.width),
        height=float(raw.height),
        kind="failed",
        flags=[Flag(rule=rule, severity="blocking", message=message)],
    )


def write(document: Document, out: str | Path, config: Config | None = None) -> dict[str, Path]:
    """Write the three output files and return their paths."""
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    files = {
        "document": out / "document.json",
        "markdown": out / "document.md",
        "chunks": out / "chunks.jsonl",
    }
    files["document"].write_text(document.model_dump_json(indent=2), encoding="utf8")
    files["markdown"].write_text(to_markdown(document), encoding="utf8")
    files["chunks"].write_text(to_jsonl(to_chunks(document, config or Config())), encoding="utf8")
    return files

"""Single-process parser entry point. The parent enforces a wall-clock timeout.
Linux also enforces address-space/CPU limits; this lab is not a network sandbox.
"""

import hashlib
import io
import json
import math
import resource
import sys
import unicodedata
from pathlib import Path

from .models import Block, Box, Cell, Glyph, Issue, Page, Table


def limits(cpu_seconds: int):
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds + 1))
    if sys.platform.startswith("linux"):
        cap = 2 * 1024**3
        resource.setrlimit(resource.RLIMIT_AS, (cap, cap))


def preflight(path: Path) -> dict:
    import pypdfium2
    from pypdf import PdfReader

    snapshot = path.read_bytes()
    reader = PdfReader(io.BytesIO(snapshot), strict=True)
    if reader.is_encrypted:
        return {"error": "PASSWORD_OR_ENCRYPTION_REQUIRES_REVIEW"}
    count = len(reader.pages)
    if count < 1 or count > 1000:
        return {"error": "PAGE_LIMIT_EXCEEDED"}
    with pypdfium2.PdfDocument(snapshot) as rendered:
        if len(rendered) != count:
            return {"error": "PARSER_PAGE_COUNT_DISAGREEMENT"}
    pages = []
    for index, page in enumerate(reader.pages):
        width = float(page.mediabox.width)
        height = float(page.mediabox.height)
        rotation = int(page.get("/Rotate", 0)) % 360
        if rotation in {90, 270}:
            width, height = height, width
        if not all(math.isfinite(x) and 0 < x < 20000 for x in (width, height)):
            return {"error": "INVALID_PAGE_DIMENSIONS"}
        pages.append({"number": index + 1, "width": width, "height": height, "rotation": rotation})
    root = reader.root_object
    names = root.get("/Names", {})
    names = names.get_object() if hasattr(names, "get_object") else names
    issues = []
    if root.get("/OpenAction") or root.get("/AA") or names.get("/JavaScript"):
        issues.append(
            {
                "code": "ACTIVE_CONTENT_PRESENT",
                "severity": "blocking",
                "message": "Document actions require inspection; actions are never executed by the lab.",
            }
        )
    if names.get("/EmbeddedFiles"):
        issues.append(
            {
                "code": "EMBEDDED_FILES_PRESENT",
                "severity": "blocking",
                "message": "Embedded files are not processed; check for required annexures.",
            }
        )
    fields = reader.get_fields() or {}
    if any(f.get("/FT") != "/Sig" for f in fields.values()):
        issues.append(
            {
                "code": "FORM_FIELDS_REQUIRE_REVIEW",
                "severity": "blocking",
                "message": "Interactive field values and appearances need dedicated validation.",
            }
        )
    if any(f.get("/FT") == "/Sig" for f in fields.values()):
        issues.append(
            {
                "code": "DIGITAL_SIGNATURE_UNVERIFIED",
                "severity": "review",
                "message": "Signature field retained in original bytes; cryptographic validity is not established.",
            }
        )
    return {"pages": pages, "issues": issues, "expected_pages": count}


def inspect_page(path: Path, number: int, out: Path, dpi: int, max_pixels: int) -> dict:
    import pdfplumber

    # Backends receive a memory snapshot, never a writable source-file path.
    with pdfplumber.open(io.BytesIO(path.read_bytes())) as pdf:
        page = pdf.pages[number - 1]
        width, height = float(page.width), float(page.height)
        pixels = math.ceil(width * dpi / 72) * math.ceil(height * dpi / 72)
        if pixels > max_pixels:
            return {"error": "RENDER_PIXEL_LIMIT_EXCEEDED"}
        if len(page.chars) > 150000 or len(page.images) > 500:
            return {"error": "PAGE_COMPLEXITY_LIMIT_EXCEEDED"}
        origin_x, origin_y = page.bbox[:2]

        def box(values):
            x0, top, x1, bottom = (float(v) for v in values)
            # Out-of-bounds source geometry is rejected, never silently clamped.
            return Box(
                x0=x0 - origin_x, top=top - origin_y, x1=x1 - origin_x, bottom=bottom - origin_y
            )

        image = page.to_image(resolution=dpi, antialias=True, force_mediabox=True).original
        render = f"pages/{number:04d}.png"
        image.save(out / render, format="PNG")
        with (out / render).open("rb") as rendered:
            render_sha256 = hashlib.file_digest(rendered, "sha256").hexdigest()
        thumb = image.convert("L")
        thumb.thumbnail((256, 256))
        hist = thumb.histogram()
        dark_fraction = sum(hist[:240]) / max(1, sum(hist))
        image.close()
        thumb.close()
        issues: list[Issue] = []

        def issue(code, message, severity="blocking", region=None):
            issues.append(
                Issue(code=code, severity=severity, message=message, page=number, region_id=region)
            )

        # A native baseline cannot verify text embedded in images, or stale OCR.
        image_area = sum(
            max(0, min(width, i["x1"] - origin_x) - max(0, i["x0"] - origin_x))
            * max(0, min(height, i["bottom"] - origin_y) - max(0, i["top"] - origin_y))
            for i in page.images
        )
        image_fraction = min(1.0, image_area / (width * height))
        if page.images:
            issue(
                "IMAGE_CONTENT_UNVERIFIED",
                "Image regions may contain scans, seals or missing text; OCR/visual verification is required.",
            )
        if page.annots:
            issue(
                "ANNOTATIONS_UNVERIFIED",
                "Annotations or widgets may affect visible content; inspect the source.",
            )
        if page.cropbox != page.mediabox or page.bbox[0] != 0 or page.bbox[1] != 0:
            issue(
                "PAGE_GEOMETRY_REVIEW",
                "Non-default page boxes require source-overlay verification.",
            )

        tables = []
        detected = page.find_tables()
        if len(detected) > 100:
            return {"error": "TABLE_LIMIT_EXCEEDED"}
        for ti, candidate in enumerate(detected):
            table_id = f"p{number}-t{ti + 1}"
            matrix = candidate.extract()
            rows, columns = len(matrix), max((len(r) for r in matrix), default=0)
            if not rows or not columns:
                continue
            if rows * columns > 10000:
                return {"error": "TABLE_CELL_LIMIT_EXCEEDED"}
            cells = []
            for ri, row in enumerate(candidate.rows):
                for ci in range(columns):
                    region = row.cells[ci] if ci < len(row.cells) else None
                    value = matrix[ri][ci] if ci < len(matrix[ri]) else None
                    cells.append(
                        Cell(
                            id=f"{table_id}-r{ri}-c{ci}",
                            row=ri,
                            column=ci,
                            raw_text=value,
                            bbox=box(region) if region else None,
                        )
                    )
            tables.append(
                Table(
                    id=table_id, bbox=box(candidate.bbox), rows=rows, columns=columns, cells=cells
                )
            )
            issue(
                "TABLE_STRUCTURE_UNVERIFIED",
                "Grid is a candidate only: verify headers, merged spans, values, units and footnotes.",
                region=table_id,
            )

        lines = page.extract_text_lines(return_chars=True)
        if len(lines) > 10000:
            return {"error": "TEXT_BLOCK_LIMIT_EXCEEDED"}
        blocks = []
        for bi, line in enumerate(lines):
            bid = f"p{number}-b{bi + 1}"
            b = box((line["x0"], line["top"], line["x1"], line["bottom"]))
            table_id = next(
                (
                    t.id
                    for t in tables
                    if t.bbox.x0 <= (b.x0 + b.x1) / 2 <= t.bbox.x1
                    and t.bbox.top <= (b.top + b.bottom) / 2 <= t.bbox.bottom
                ),
                None,
            )
            # Preserve per-character source boxes; regrouped words are display-only.
            glyphs = [
                Glyph(
                    id=f"{bid}-g{ci}",
                    text=c["text"],
                    bbox=box((c["x0"], c["top"], c["x1"], c["bottom"])),
                )
                for ci, c in enumerate(line["chars"])
            ]
            blocks.append(
                Block(
                    id=bid,
                    kind="text_line",
                    raw_text=line["text"],
                    display_text=unicodedata.normalize("NFC", line["text"]),
                    bbox=b,
                    order=bi,
                    source="native",
                    glyphs=glyphs,
                    table_id=table_id,
                )
            )
        text = "\n".join(b.raw_text for b in blocks)
        bad = (
            "\ufffd" in text
            or "(cid:" in text
            or any(unicodedata.category(c) in {"Co", "Cs"} for c in text)
        )
        if bad:
            issue(
                "CHARACTER_MAPPING_SUSPECT",
                "Unmapped or private-use characters require visual OCR comparison.",
            )
        if blocks:
            issue(
                "READING_ORDER_UNVERIFIED",
                "Native geometric order is unverified, especially across columns, clauses and footnotes.",
                "review",
            )
        if len(text.strip()) < 20:
            if dark_fraction < 0.0005:
                status = "blank_candidate"
                issue(
                    "BLANK_PAGE_REQUIRES_VERIFICATION",
                    "Rendered page appears blank; a reviewer must confirm it.",
                )
            else:
                status = "ocr_required"
                issue(
                    "OCR_REQUIRED",
                    "Visible page content has insufficient native text; OCR is required.",
                )
        else:
            status = "ocr_required" if image_fraction > 0.15 or bad else "native_candidate"
        scripts = []
        if any("\u0900" <= c <= "\u097f" for c in text):
            scripts.append("und-Deva")
        if any(c.isascii() and c.isalpha() for c in text):
            scripts.append("und-Latn")
        result = Page(
            number=number,
            width=width,
            height=height,
            rotation=page.rotation,
            status=status,
            render=render,
            render_sha256=render_sha256,
            blocks=blocks,
            tables=tables,
            issues=issues,
            languages=scripts,
            metrics={
                "characters": len(page.chars),
                "image_regions": len(page.images),
                "image_area_fraction_upper_bound": round(image_fraction, 4),
                "render_dark_fraction": round(dark_fraction, 6),
                "table_candidates": len(tables),
            },
        )
        return result.model_dump(mode="json")


def profile(path: Path) -> dict:
    """Triage signals, never benchmark labels or extraction acceptance."""
    import pdfplumber

    info = preflight(path)
    if info.get("error"):
        return info
    records = []
    with pdfplumber.open(io.BytesIO(path.read_bytes())) as pdf:
        for page in pdf.pages:
            if len(page.chars) > 150000:
                return {"error": "PAGE_COMPLEXITY_LIMIT_EXCEEDED"}
            text = "".join(c["text"] for c in page.chars)
            records.append(
                {
                    "page": page.page_number,
                    "native_characters": len(page.chars),
                    "image_regions": len(page.images),
                    "devanagari_characters": sum("\u0900" <= c <= "\u097f" for c in text),
                    "suspect_characters": sum(
                        c == "\ufffd" or unicodedata.category(c) in {"Co", "Cs"} for c in text
                    ),
                }
            )
    return {"expected_pages": info["expected_pages"], "pages": records, "issues": info["issues"]}


def main():
    mode, file, *args = sys.argv[1:]
    limits(45)
    try:
        if mode == "preflight":
            result = preflight(Path(file))
        elif mode == "profile":
            result = profile(Path(file))
        else:
            number, out, dpi, max_pixels = args
            result = inspect_page(Path(file), int(number), Path(out), int(dpi), int(max_pixels))
    except Exception as error:
        result = {"error": "PARSER_OR_GEOMETRY_FAILURE", "exception_type": type(error).__name__}
    print(json.dumps(result, ensure_ascii=True, allow_nan=False))


if __name__ == "__main__":
    main()

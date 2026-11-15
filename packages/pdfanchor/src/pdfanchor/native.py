"""Read the PDF's own text layer, with a source box for every line and table cell."""

import statistics
import unicodedata

from .config import Config
from .model import Box, Cell, Flag, Line, Page, Table


def render(page, dpi: int, max_pixels: int):
    """Page image for OCR and blank detection. `page` is a pdfplumber page."""
    width = float(page.width) * dpi / 72
    height = float(page.height) * dpi / 72
    if width * height > max_pixels:
        raise ValueError("Render exceeds the pixel budget")
    return page.to_image(resolution=dpi, antialias=True).original.convert("RGB")


def dark_fraction(image) -> float:
    thumb = image.convert("L")
    thumb.thumbnail((256, 256))
    histogram = thumb.histogram()
    return sum(histogram[:240]) / max(1, sum(histogram))


def read_page(page, number: int, config: Config) -> Page:
    width, height = float(page.width), float(page.height)
    origin_x, origin_y = page.bbox[0], page.bbox[1]
    flags: list[Flag] = []
    overflow = False

    def box(x0, top, x1, bottom) -> Box:
        nonlocal overflow
        x0, top, x1, bottom = x0 - origin_x, top - origin_y, x1 - origin_x, bottom - origin_y
        if x0 < -1 or top < -1 or x1 > width + 1 or bottom > height + 1:
            overflow = True
        return Box(
            x0=max(0.0, x0), top=max(0.0, top), x1=min(width, x1), bottom=min(height, bottom)
        )

    tables: list[Table] = []
    for index, found in enumerate(page.find_tables()):
        matrix = found.extract()
        rows, columns = len(matrix), max((len(row) for row in matrix), default=0)
        if not rows or not columns:
            continue
        cells = []
        for r, row in enumerate(found.rows):
            for c in range(columns):
                region = row.cells[c] if c < len(row.cells) else None
                cells.append(
                    Cell(
                        row=r,
                        column=c,
                        text=matrix[r][c] if c < len(matrix[r]) else None,
                        box=box(*region) if region else None,
                    )
                )
        tables.append(
            Table(
                id=f"p{number}-t{index + 1}",
                page=number,
                box=box(*found.bbox),
                rows=rows,
                columns=columns,
                cells=cells,
            )
        )

    lines: list[Line] = []
    for order, found in enumerate(page.extract_text_lines(return_chars=True)):
        chars = found["chars"]
        line_box = box(found["x0"], found["top"], found["x1"], found["bottom"])
        middle_x, middle_y = (line_box.x0 + line_box.x1) / 2, (line_box.top + line_box.bottom) / 2
        table = next(
            (
                t
                for t in tables
                if t.box.x0 <= middle_x <= t.box.x1 and t.box.top <= middle_y <= t.box.bottom
            ),
            None,
        )
        sizes = [float(c["size"]) for c in chars if c.get("size")]
        bold = [("bold" in str(c.get("fontname", "")).lower()) for c in chars]
        lines.append(
            Line(
                id=f"p{number}-l{order + 1}",
                page=number,
                order=order,
                box=line_box,
                raw=found["text"],
                text=unicodedata.normalize("NFC", found["text"]),
                source="native",
                font_size=round(statistics.median(sizes), 2) if sizes else None,
                bold=bool(bold) and sum(bold) > len(bold) / 2,
                role="table" if table else "body",
                table_id=table.id if table else None,
            )
        )

    image_area = sum(
        max(0.0, min(width, i["x1"] - origin_x) - max(0.0, i["x0"] - origin_x))
        * max(0.0, min(height, i["bottom"] - origin_y) - max(0.0, i["top"] - origin_y))
        for i in page.images
    )
    image_fraction = min(1.0, image_area / (width * height))
    characters = sum(len(line.text.strip()) for line in lines)
    metrics = {
        "native_characters": float(characters),
        "image_fraction": round(image_fraction, 4),
        "tables": float(len(tables)),
    }
    if overflow:
        flags.append(
            Flag(
                rule="geometry.out-of-bounds",
                severity="review",
                message="Some text lies outside the visible page; boxes were clipped to the page.",
            )
        )
    if characters >= config.min_native_chars:
        kind = "native"
        if image_fraction > 0.5:
            flags.append(
                Flag(
                    rule="native.image-backed",
                    severity="review",
                    message="The text layer sits over a page-sized image and may be an old OCR "
                    "layer. It is only trusted when an independent reading agrees.",
                )
            )
    else:
        image = render(page, 72, config.max_render_pixels)
        dark = dark_fraction(image)
        metrics["dark_fraction"] = round(dark, 6)
        kind = "blank" if dark < config.blank_dark_fraction else "scanned"
        lines, tables = [], []
    return Page(
        number=number,
        width=width,
        height=height,
        rotation=int(page.rotation or 0),
        kind=kind,
        lines=lines,
        tables=tables,
        flags=flags,
        metrics=metrics,
    )

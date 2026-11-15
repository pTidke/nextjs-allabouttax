"""Synthetic PDFs only. Nothing here is an official document."""

import io

import pytest
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.platypus import Table, TableStyle

from pdfanchor.ocr import OcrLine

BODY = [
    "This notification shall come into force on the 1st day of April, 2026.",
    "It applies to income under section 10(23FE) and does not extend to other income.",
]
BAD_DATE = "The earlier order dated 31* March, 2025 is withdrawn."


@pytest.fixture(scope="session")
def native_pdf(tmp_path_factory):
    path = tmp_path_factory.mktemp("pdf") / "native.pdf"
    page = canvas.Canvas(str(path), pagesize=A4)
    page.setFont("Helvetica-Bold", 16)
    page.drawString(72, 770, "Notification No. 1/2026")
    page.setFont("Helvetica", 11)
    page.drawString(72, 730, BODY[0])
    page.drawString(72, 716, BODY[1])
    page.drawString(72, 676, BAD_DATE)
    page.showPage()
    page.setFont("Helvetica", 11)
    page.drawString(72, 770, "The limits are set out in the table below for each class.")
    table = Table([["Class", "Limit"], ["Individual", "1,50,000"], ["Company", "5,00,000"]])
    table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.8, colors.black)]))
    table.wrapOn(page, 400, 200)
    table.drawOn(page, 72, 660)
    page.save()
    return path


SCAN_LINES = ["Circular No. 7 of 2026", "The due date is 31st July 2026."]


@pytest.fixture(scope="session")
def scanned_pdf(tmp_path_factory):
    """An image-only page: no text layer at all."""
    path = tmp_path_factory.mktemp("pdf") / "scanned.pdf"
    image = Image.new("RGB", (1654, 2339), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=48)
    for index, text in enumerate(SCAN_LINES):
        draw.text((150, 200 + index * 160), text, fill="black", font=font)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    page = canvas.Canvas(str(path), pagesize=A4)
    page.drawImage(ImageReader(io.BytesIO(buffer.getvalue())), 0, 0, width=A4[0], height=A4[1])
    page.save()
    return path


class FakeEngine:
    """Returns fixed lines, so tests can state exactly what a second reader saw."""

    def __init__(self, name, lines):
        self.name, self.lines = name, lines

    def version(self):
        return "test"

    def read(self, image, languages):
        return [OcrLine(text=text, box=box, confidence=90.0) for text, box in self.lines]


def echo_engine(document, dpi, name="echo", change=None):
    """A second reader that agrees with the text layer, except where `change` edits it."""
    scale = dpi / 72
    lines = []
    for line in document.lines():
        text = change(line.text) if change else line.text
        box = (line.box.x0 * scale, line.box.top * scale, line.box.x1 * scale, line.box.bottom * scale)
        lines.append((text, box))
    return FakeEngine(name, lines)

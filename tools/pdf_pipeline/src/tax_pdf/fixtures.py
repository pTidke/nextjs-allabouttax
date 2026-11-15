"""Synthetic adversarial fixtures only. No real tax claims or taxpayer data."""

import argparse
import io
import json
from pathlib import Path


def native_bytes() -> bytes:
    from reportlab.pdfgen import canvas

    out = io.BytesIO()
    c = canvas.Canvas(out, pagesize=(612, 792), invariant=1)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(72, 730, "SYNTHETIC TEST - NOT TAX LAW")
    c.setFont("Helvetica", 12)
    for y, text in [
        (690, "Fixture identity: TEST-001"),
        (665, "Do not change 1.5% into 15%."),
        (640, "Illustrative deadline: 31 March 2030."),
        (615, "This statement is not an exemption or filing instruction."),
    ]:
        c.drawString(72, y, text)
    c.save()
    return out.getvalue()


def scan_bytes() -> bytes:
    import pypdfium2
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    with pypdfium2.PdfDocument(native_bytes()) as pdf:
        page = pdf[0]
        bitmap = page.render(scale=2)
        image = bitmap.to_pil()
        out = io.BytesIO()
        c = canvas.Canvas(out, pagesize=(612, 792), invariant=1)
        c.drawImage(ImageReader(image), 0, 0, 612, 792)
        c.save()
        image.close()
        bitmap.close()
        page.close()
    return out.getvalue()


def mixed_bytes() -> bytes:
    from pypdf import PdfReader, PdfWriter

    writer = PdfWriter()
    for data in (native_bytes(), scan_bytes()):
        writer.add_page(PdfReader(io.BytesIO(data)).pages[0])
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def table_bytes() -> bytes:
    from reportlab.pdfgen import canvas

    out = io.BytesIO()
    c = canvas.Canvas(out, pagesize=(612, 792), invariant=1)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(72, 730, "SYNTHETIC TABLE - NOT TAX LAW")
    c.setFont("Helvetica", 11)
    x = [72, 230, 350, 500]
    y = [685, 650, 615, 580, 545, 510]
    for yy in y:
        c.line(x[0], yy, x[-1], yy)
    for xx in (x[0], x[1], x[-1]):
        c.line(xx, y[0], xx, y[-1])
    c.line(x[2], y[1], x[2], y[-1])
    c.drawString(80, 662, "Category")
    c.drawString(240, 662, "Illustrative values (merged header)")
    c.drawString(80, 627, "Item")
    c.drawString(240, 627, "Rate (%)")
    c.drawString(360, 627, "Amount (INR)")
    for yy, row in [
        (592, ("Example A", "1.5", "1,00,000")),
        (557, ("Example B", "0", "-")),
        (522, ("Example C", "0.5", "")),
    ]:
        for xx, value in zip((80, 240, 360), row, strict=True):
            c.drawString(xx, yy, value)
    c.drawString(72, 470, "Footnote 1: blank, zero and dash have distinct source meanings.")
    c.save()
    return out.getvalue()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    fixtures = {
        "native": native_bytes,
        "scan": scan_bytes,
        "mixed": mixed_bytes,
        "table": table_bytes,
    }
    for name, factory in fixtures.items():
        path = args.out / f"{name}.pdf"
        if path.exists():
            raise ValueError("Refusing to overwrite an existing fixture PDF")
        path.write_bytes(factory())
    (args.out / "expected.json").write_text(
        json.dumps(
            {
                "scope": "Synthetic engineering tests only; never legal ground truth",
                "native": {
                    "pages": 1,
                    "critical_strings": ["1.5%", "15%", "31 March 2030", "not an exemption"],
                },
                "scan": {"pages": 1, "required_issue": "OCR_REQUIRED"},
                "mixed": {"pages": 2, "page_2_requires_ocr": True},
                "table": {
                    "pages": 1,
                    "distinct_values": ["1.5", "0", "-", "0.5", ""],
                    "merged_headers_require_review": True,
                },
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

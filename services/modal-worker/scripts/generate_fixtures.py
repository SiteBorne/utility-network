"""Generates the deterministic synthetic fixture corpus for the document
worker under services/modal-worker/fixtures/.

All fixtures are programmatically generated (reportlab for PDFs, Pillow for
images) — no downloaded/uncontrolled copyrighted documents. Re-running this
script regenerates byte-identical output (reportlab embeds a fixed creation
date below; without pinning it, PDF bytes would differ run-to-run even
though extracted content would not).
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw
from pypdf import PdfWriter
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, SimpleDocTemplate, TableStyle
from reportlab.platypus import Table as RLTable

FIXTURES_DIR = Path(__file__).parent.parent / "fixtures"


def _fixed_canvas(path: str) -> canvas.Canvas:
    c = canvas.Canvas(path, pagesize=letter)
    c.setAuthor("SITEBORNE Utility Network (fixture)")
    c.setTitle("document-worker fixture")
    return c


def make_native_text_one_page(path: Path) -> None:
    c = _fixed_canvas(str(path))
    c.drawString(72, 700, "SUN-0400A Fixture: Native Text Document")
    c.drawString(72, 680, "This page contains ordinary extractable native PDF text.")
    c.drawString(72, 660, "It exists solely to exercise the native-text extraction path.")
    c.save()


def make_native_text_multi_page(path: Path, pages: int = 3) -> None:
    c = _fixed_canvas(str(path))
    for i in range(1, pages + 1):
        c.drawString(72, 700, f"SUN-0400A Fixture: Multi-page document, page {i} of {pages}")
        c.drawString(72, 680, f"Deterministic page-ordering fixture content for page {i}.")
        c.showPage()
    c.save()


def make_blank_page(path: Path) -> None:
    c = _fixed_canvas(str(path))
    c.showPage()
    c.save()


def make_table_pdf(path: Path, rows: int = 5) -> None:
    doc = SimpleDocTemplate(str(path), pagesize=letter)
    styles = getSampleStyleSheet()
    data = [["Name", "Age", "City"]] + [[f"Person{i}", str(20 + i), "Metropolis"] for i in range(rows)]
    table = RLTable(data)
    table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 1, (0, 0, 0))]))
    doc.build([Paragraph("SUN-0400A Fixture: Table Document", styles["Title"]), table])


def make_multi_table_pdf(path: Path) -> None:
    doc = SimpleDocTemplate(str(path), pagesize=letter)
    styles = getSampleStyleSheet()
    t1 = RLTable([["A", "B"], ["1", "2"]])
    t1.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 1, (0, 0, 0))]))
    t2 = RLTable([["X", "Y", "Z"], ["a", "b", "c"], ["d", "e", "f"]])
    t2.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 1, (0, 0, 0))]))
    doc.build(
        [
            Paragraph("Table One", styles["Heading2"]),
            t1,
            Paragraph("Table Two", styles["Heading2"]),
            t2,
        ]
    )


def make_scanned_image_pdf(path: Path) -> None:
    """A page whose only content is a large embedded image (no native text) —
    exercises the scanned/OCR-required classification + OCR path.
    """
    from PIL import ImageFont

    img = Image.new("RGB", (1600, 2000), "white")
    d = ImageDraw.Draw(img)
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 64)
    except OSError:
        font = ImageFont.load_default(size=64)
    d.text((80, 900), "SUN-0400A Fixture: Scanned Page OCR Text", fill="black", font=font)
    img_path = FIXTURES_DIR / "_scanned_page_source.png"
    img.save(img_path)

    c = canvas.Canvas(str(path), pagesize=letter)
    c.drawImage(str(img_path), 0, 0, width=letter[0], height=letter[1])
    c.save()
    img_path.unlink()


def make_encrypted_pdf(path: Path, source: Path) -> None:
    w = PdfWriter()
    w.append(str(source))
    w.encrypt("fixture-password-not-a-secret")
    with open(path, "wb") as f:
        w.write(f)


def make_malformed_pdf(path: Path) -> None:
    path.write_bytes(b"%PDF-1.7\nthis is not a valid pdf body\n%%EOF")


def make_over_page_limit_pdf(path: Path, pages: int = 12) -> None:
    make_native_text_multi_page(path, pages=pages)


def make_png_text(path: Path) -> None:
    img = Image.new("RGB", (600, 200), "white")
    d = ImageDraw.Draw(img)
    d.text((20, 80), "SUN-0400A Fixture: PNG OCR Text", fill="black")
    img.save(path)


def make_jpeg_text(path: Path) -> None:
    img = Image.new("RGB", (600, 200), "white")
    d = ImageDraw.Draw(img)
    d.text((20, 80), "SUN-0400A Fixture: JPEG OCR Text", fill="black")
    img.save(path, "JPEG", quality=90)


def make_blank_image(path: Path) -> None:
    Image.new("RGB", (400, 300), "white").save(path)


def make_low_contrast_image(path: Path) -> None:
    img = Image.new("RGB", (600, 200), (250, 250, 250))
    d = ImageDraw.Draw(img)
    d.text((20, 80), "low contrast text", fill=(245, 245, 245))
    img.save(path)


def make_malformed_image(path: Path) -> None:
    path.write_bytes(b"\x89PNG\r\n\x1a\nthis is not valid PNG data")


def make_mismatched_extension_image(path: Path) -> None:
    """Bytes are a real JPEG but the fixture manifest declares it as PNG,
    for the media-type-mismatch adversarial test.
    """
    img = Image.new("RGB", (200, 200), "white")
    img.save(path, "JPEG")


def main() -> None:
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    pdf_dir = FIXTURES_DIR / "pdf"
    img_dir = FIXTURES_DIR / "images"
    pdf_dir.mkdir(exist_ok=True)
    img_dir.mkdir(exist_ok=True)

    make_native_text_one_page(pdf_dir / "native_text_one_page.pdf")
    make_native_text_multi_page(pdf_dir / "native_text_multi_page.pdf", pages=3)
    make_blank_page(pdf_dir / "blank_page.pdf")
    make_table_pdf(pdf_dir / "single_table.pdf", rows=5)
    make_multi_table_pdf(pdf_dir / "multi_table.pdf")
    make_scanned_image_pdf(pdf_dir / "scanned_page.pdf")
    make_encrypted_pdf(pdf_dir / "encrypted.pdf", pdf_dir / "native_text_one_page.pdf")
    make_malformed_pdf(pdf_dir / "malformed.pdf")
    make_over_page_limit_pdf(pdf_dir / "over_page_limit.pdf", pages=12)

    make_png_text(img_dir / "text.png")
    make_jpeg_text(img_dir / "text.jpg")
    make_blank_image(img_dir / "blank.png")
    make_low_contrast_image(img_dir / "low_contrast.png")
    make_malformed_image(img_dir / "malformed.png")
    make_mismatched_extension_image(img_dir / "mismatched_extension.png")

    manifest = {
        "generator": "scripts/generate_fixtures.py",
        "pdf": sorted(p.name for p in pdf_dir.glob("*.pdf")),
        "images": sorted(p.name for p in img_dir.glob("*.png")) + sorted(p.name for p in img_dir.glob("*.jpg")),
    }
    (FIXTURES_DIR / "MANIFEST.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(f"Generated {len(manifest['pdf'])} PDF fixtures and {len(manifest['images'])} image fixtures.")


if __name__ == "__main__":
    main()

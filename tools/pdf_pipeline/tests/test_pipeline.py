import hashlib
import io
import json

import pytest
from pydantic import ValidationError

from tax_pdf import runner
from tax_pdf.fixtures import mixed_bytes, native_bytes, scan_bytes, table_bytes
from tax_pdf.models import Artifact, Box, assess


def run(tmp_path, data, **options):
    original = tmp_path / "input.pdf"
    original.write_bytes(data)
    package = runner.process(original, tmp_path / "output", **options)
    artifact = Artifact.model_validate_json((package / "artifact.json").read_text())
    return package, artifact


def codes(artifact):
    return {i.code for i in artifact.issues} | {i.code for p in artifact.pages for i in p.issues}


def test_original_and_source_regions_are_preserved(tmp_path):
    data = native_bytes()
    package, artifact = run(tmp_path, data)
    assert (package / "original.pdf").read_bytes() == data
    assert artifact.source_sha256 == hashlib.sha256(data).hexdigest()
    assert artifact.expected_pages == 1
    assert artifact.page_accounting_complete and artifact.processed_pages_complete
    assert artifact.state == "AWAITING_EXTRACTION_REVIEW"
    assert artifact.publication_eligible is False and artifact.acceptance is None
    blocks = artifact.pages[0].blocks
    assert "1.5%" in "\n".join(b.raw_text for b in blocks)
    block = next(b for b in blocks if "Fixture identity" in b.raw_text)
    assert abs(block.bbox.x0 - 72) < 0.1
    assert block.glyphs
    assert all(g.bbox.x1 <= artifact.pages[0].width for g in block.glyphs)
    assert (package / artifact.pages[0].render).is_file()


def test_scans_do_not_succeed_on_a_text_length_heuristic(tmp_path):
    _, artifact = run(tmp_path, scan_bytes())
    assert artifact.pages[0].status == "ocr_required"
    assert "OCR_REQUIRED" in codes(artifact)
    assert artifact.state == "BLOCKED"
    assert artifact.page_accounting_complete


def test_mixed_document_does_not_hide_its_scanned_page(tmp_path):
    _, artifact = run(tmp_path, mixed_bytes())
    assert artifact.expected_pages == 2
    assert artifact.pages[0].blocks
    assert artifact.pages[1].status == "ocr_required"
    assert artifact.state == "BLOCKED"


def test_subset_cannot_claim_complete_processing(tmp_path):
    _, artifact = run(tmp_path, mixed_bytes(), pages={1})
    assert artifact.page_accounting_complete
    assert not artifact.processed_pages_complete
    assert artifact.pages[1].status == "not_processed"
    assert "PAGE_PROCESSING_INCOMPLETE" in codes(artifact)


def test_table_keeps_cells_and_distinguishes_missing_blank_zero_and_dash(tmp_path):
    _, artifact = run(tmp_path, table_bytes())
    tables = artifact.pages[0].tables
    assert tables
    values = [c.raw_text for t in tables for c in t.cells]
    for value in ["1.5", "0", "-", "0.5", ""]:
        assert value in values
    assert None in values  # merged/covered header remains unresolved
    assert all(not t.structure_verified for t in tables)
    assert "TABLE_STRUCTURE_UNVERIFIED" in codes(artifact)
    assert artifact.state == "BLOCKED"


def test_missing_or_duplicate_manifest_pages_block_even_if_text_looks_good(tmp_path):
    _, artifact = run(tmp_path, native_bytes())
    artifact.expected_pages = 2
    assert assess(artifact).state == "BLOCKED"
    assert "PAGE_ACCOUNTING_INCOMPLETE" in codes(artifact)
    artifact.pages.append(artifact.pages[0].model_copy(deep=True))
    assert not assess(artifact).page_accounting_complete


def test_page_worker_failure_remains_accounted_for(tmp_path, monkeypatch):
    real = runner.child

    def fail(mode, *args, **kwargs):
        return {"error": "PARSER_TIMEOUT"} if mode == "page" else real(mode, *args, **kwargs)

    monkeypatch.setattr(runner, "child", fail)
    _, artifact = run(tmp_path, native_bytes())
    assert artifact.page_accounting_complete
    assert artifact.pages[0].status == "failed"
    assert "PARSER_TIMEOUT" in codes(artifact)


def test_preflight_failure_does_not_invent_page_completeness(tmp_path):
    _, artifact = run(tmp_path, b"%PDF-1.7\nnot a valid PDF")
    assert artifact.expected_pages is None
    assert not artifact.page_accounting_complete
    assert artifact.state == "BLOCKED"


def test_original_tampering_and_missing_render_block_verification(tmp_path):
    package, artifact = run(tmp_path, native_bytes())
    (package / "original.pdf").chmod(0o644)
    (package / "original.pdf").write_bytes(b"changed")
    (package / artifact.pages[0].render).unlink()
    checked = runner.verify_package(artifact, package)
    assert checked.state == "BLOCKED"
    assert {"ORIGINAL_CHECKSUM_MISMATCH", "RENDER_MISSING"} <= codes(checked)


def test_encrypted_document_is_held(tmp_path):
    from pypdf import PdfReader, PdfWriter

    writer = PdfWriter()
    writer.append(PdfReader(io.BytesIO(native_bytes())))
    writer.encrypt("fixture-password")
    data = io.BytesIO()
    writer.write(data)
    _, artifact = run(tmp_path, data.getvalue())
    assert artifact.state == "BLOCKED"
    assert "PASSWORD_OR_ENCRYPTION_REQUIRES_REVIEW" in codes(artifact)


def test_review_does_not_execute_document_content(tmp_path):
    package, artifact = run(tmp_path, native_bytes(), title='<script>alert("x")</script>')
    text = (package / "review.html").read_text()
    assert '<script>alert("x")</script>' not in text
    assert "&lt;script&gt;" in text
    assert "object-src 'none'" in text
    assert "publication disabled" in text
    assert artifact.acceptance is None


def test_limits_and_source_geometry_are_enforced(tmp_path):
    original = tmp_path / "input.pdf"
    original.write_bytes(native_bytes())
    with pytest.raises(ValueError):
        runner.process(original, tmp_path / "out", max_bytes=10)
    _, artifact = run(tmp_path, native_bytes(), max_pixels=10)
    assert "RENDER_PIXEL_LIMIT_EXCEEDED" in codes(artifact)
    with pytest.raises(ValidationError):
        Box(x0=10, top=0, x1=2, bottom=20)
    with pytest.raises(ValidationError):
        Box(x0=0, top=0, x1=float("nan"), bottom=20)


def test_page_budget_keeps_unprocessed_original_pages(tmp_path):
    _, artifact = run(tmp_path, mixed_bytes(), page_limit=1)
    assert len(artifact.pages) == 2
    assert "DOCUMENT_PAGE_BUDGET_EXCEEDED" in codes(artifact)
    assert all(p.status == "not_processed" for p in artifact.pages)


def test_schema_cannot_claim_publication_or_acceptance(tmp_path):
    _, artifact = run(tmp_path, native_bytes())
    data = json.loads(artifact.model_dump_json())
    data["publication_eligible"] = True
    with pytest.raises(ValidationError):
        Artifact.model_validate(data)
    data["publication_eligible"] = False
    data["acceptance"] = {"approved": True}
    with pytest.raises(ValidationError):
        Artifact.model_validate(data)


def test_render_tampering_is_detected(tmp_path):
    package, artifact = run(tmp_path, native_bytes())
    (package / artifact.pages[0].render).write_bytes(b"not the original page image")
    assert "RENDER_CHECKSUM_MISMATCH" in codes(runner.verify_package(artifact, package))
    assert artifact.state == "BLOCKED"


def test_ocr_required_status_cannot_be_cleared_by_removing_issue_messages(tmp_path):
    _, artifact = run(tmp_path, scan_bytes())
    artifact.issues = []
    artifact.pages[0].issues = []
    assert assess(artifact).state == "BLOCKED"


def test_native_backend_receives_a_byte_snapshot_not_a_source_path(tmp_path, monkeypatch):
    import pdfplumber

    from tax_pdf.worker import inspect_page

    original = tmp_path / "original.pdf"
    data = native_bytes()
    original.write_bytes(data)
    (tmp_path / "pages").mkdir()
    actual_open = pdfplumber.open

    def guarded_open(source, **kwargs):
        assert isinstance(source, io.BytesIO)
        return actual_open(source, **kwargs)

    monkeypatch.setattr(pdfplumber, "open", guarded_open)
    result = inspect_page(original, 1, tmp_path, 120, 16000000)
    assert result["render_sha256"]
    assert original.read_bytes() == data


def test_rotated_page_preserves_display_dimensions(tmp_path):
    from PIL import Image
    from pypdf import PdfReader, PdfWriter

    page = PdfReader(io.BytesIO(native_bytes())).pages[0]
    page.rotate(90)
    writer = PdfWriter()
    writer.add_page(page)
    data = io.BytesIO()
    writer.write(data)
    package, artifact = run(tmp_path, data.getvalue())
    p = artifact.pages[0]
    assert p.rotation == 90
    assert p.width == 792 and p.height == 612
    with Image.open(package / p.render) as image:
        assert abs(image.width / image.height - p.width / p.height) < 0.01


def test_processing_and_glyph_budgets_leave_visible_holds(tmp_path):
    _, artifact = run(tmp_path, mixed_bytes(), max_processed_pages=1)
    assert artifact.pages[1].status == "not_processed"
    assert not artifact.processed_pages_complete
    assert artifact.state == "BLOCKED"
    _, artifact = run(tmp_path, native_bytes(), max_glyphs=1)
    assert "GLYPH_BUDGET_EXCEEDED" in codes(artifact)
    assert artifact.pages[0].status == "not_processed"


def test_active_pdf_actions_are_held_and_never_published(tmp_path):
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import DictionaryObject, NameObject, TextStringObject

    writer = PdfWriter()
    writer.append(PdfReader(io.BytesIO(native_bytes())))
    writer.root_object[NameObject("/OpenAction")] = DictionaryObject(
        {
            NameObject("/S"): NameObject("/JavaScript"),
            NameObject("/JS"): TextStringObject("app.alert('synthetic test only');"),
        }
    )
    data = io.BytesIO()
    writer.write(data)
    _, artifact = run(tmp_path, data.getvalue())
    assert "ACTIVE_CONTENT_PRESENT" in codes(artifact)
    assert artifact.state == "BLOCKED"
    assert artifact.publication_eligible is False


def test_corpus_manifest_cannot_escape_its_original_directory(tmp_path):
    from tax_pdf.corpus import load_sources

    outside = tmp_path / "outside.pdf"
    outside.write_bytes(native_bytes())
    root = tmp_path / "corpus"
    root.mkdir()
    manifest = root / "sources.json"
    manifest.write_text(
        json.dumps(
            {
                "documents": [
                    {
                        "path": "../outside.pdf",
                        "sha256": hashlib.sha256(outside.read_bytes()).hexdigest(),
                    }
                ]
            }
        )
    )
    with pytest.raises(ValueError):
        list(load_sources(manifest))

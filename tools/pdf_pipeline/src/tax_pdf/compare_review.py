"""Read-only comparison UI: original, native output, OCR and human notes stay distinct."""

from pathlib import Path

from .models import Box
from .review import CSS, JS, attrs, escape

EXTRA_CSS = """
nav{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}nav a{padding:8px 12px;border:1px solid #c8d5dc;border-radius:6px;background:white}
.case{margin:24px 32px;padding:22px;background:white;border:1px solid #c8d5dc;border-radius:8px;scroll-margin-top:12px}
.case h2{font-size:19px;margin-top:0}.case-grid{display:grid;grid-template-columns:minmax(300px,1fr) minmax(300px,1fr);gap:24px;align-items:start}
.crop{display:block;width:auto;max-width:100%;max-height:420px;border:1px solid #c8d5dc;background:white}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font:15px/1.7 system-ui;margin:8px 0;padding:12px;background:#f2f6f8;border-radius:4px}
.candidate{border-left:4px solid #168770;padding-left:12px;margin:16px 0}.human{padding:12px;background:#fff4d8}.low{color:#9c4518;font-size:12px}.pill{display:inline-block;background:#edf3f6;border-radius:4px;padding:4px 7px;font:12px monospace}
summary{cursor:pointer;font-weight:600;padding:12px 0}details{border-top:1px solid #d7e2e8}h3{font-size:16px}a{overflow-wrap:anywhere}.signature{background:#edf5ff;padding:12px}
@media(max-width:850px){.case{margin:18px;padding:16px}.case-grid{grid-template-columns:1fr}}
"""


def write_comparison(report: dict, root: Path):
    cases = []
    links = []
    for case in report["findings"]:
        title = ", ".join(case["region_ids"])
        links.append(f'<a href="#{escape(case["id"])}">{escape(title)}</a>')
        original = "\n".join(f"{r['id']}: {r['extracted_text']}" for r in case["regions"])
        proposed = (
            f"<p><strong>Reviewer-proposed value:</strong> {escape(case['proposed_value'])}</p><p>{escape(case['value_scope'])}</p>"
            if case.get("proposed_value") is not None
            else "<p>No replacement text supplied. Unreadable content is not completed from context.</p>"
        )
        attempts = []
        for attempt in case["attempts"]:
            language = {"eng": "English", "hin": "Hindi", "eng+hin": "English + Hindi"}[
                attempt["languages"]
            ]
            rotation = (
                f" · rotated {attempt['rotation_ccw']}° counterclockwise"
                if attempt["rotation_ccw"]
                else ""
            )
            attempts.append(
                f'<div class="candidate"><p class="muted">New OCR candidate · {language}{rotation}</p><pre>{escape(attempt["text"] or "[no text detected — still unresolved]")}</pre><details><summary>Extraction details</summary><p class="muted">Engine confidence: {escape(attempt["confidence"])} / 100; not a correctness score. Source group: {escape(attempt["group_id"])}. <a href="{escape(attempt["raw"])}">Raw output</a></p></details></div>'
            )
        if case["handling"] == "REVIEWER_MARKED_SIGNATURE_IMAGE_ONLY":
            candidates = '<p class="signature"><strong>Signature image, marked by reviewer.</strong> No region OCR is run here. The source crop remains visible; no identity or text is inferred from the signature. Full-page raw OCR remains available separately and may contain garbage for this region.</p>'
        else:
            candidates = "".join(attempts)
        crops = "".join(
            f'<p class="muted">{escape(", ".join(group["region_ids"]))}</p><a href="{escape(group["crop"])}" target="_blank" rel="noopener noreferrer"><img class="crop" src="{escape(group["crop"])}" alt="Source crop for {escape(", ".join(group["region_ids"]))}"></a>'
            for group in case["groups"]
        )
        cases.append(
            f'<section class="case" id="{escape(case["id"])}"><h2>{escape(title)}</h2><p><span class="pill">Unresolved · needs review</span> {escape(case["category"].replace("_", " "))}</p><div class="case-grid"><div><h3>Original source crop · page {case["page"]}</h3>{crops}<p class="muted">Includes six source-point margins. Open image for full size.</p><details><summary>Previous extracted text</summary><pre>{escape(original)}</pre></details></div><div><div class="human"><strong>Your reported issue</strong><p>{escape(case["user_report"])}</p>{proposed}<p class="muted">Reviewer notes are separate from machine output and are not passed to OCR.</p></div>{candidates}</div></div></section>'
        )
    pages = []
    for page in report["pages"]:
        variants = []
        for variant in page["variants"]:
            lines = "".join(
                f'<button class="block" {attrs(Box(**line["bbox"]), line["id"])}><span class="id">{escape(line["id"])} · confidence {line["confidence"]:.0f}{" · low confidence" if line["low_confidence"] else ""}</span>{escape(line["text"])}</button>'
                for line in variant["lines"]
            )
            variants.append(
                f'<details data-variant="{escape(variant["languages"])}"><summary>Full-page OCR · {escape(variant["languages"])} · unverified reading order</summary><p><a href="{escape(variant["raw"])}">Raw OCR JSON</a></p>{lines or "<p>No text detected. Remains unresolved.</p>"}</details>'
            )
        native = "".join(
            f'<button class="block" {attrs(Box(**b["bbox"]), b["id"])}><span class="id">{escape(b["id"])} · previous native</span>{escape(b["raw_text"])}</button>'
            for b in page["native_blocks"]
        )
        pages.append(
            f'<section class="page" id="page-{page["number"]}" data-width="{page["width"]}" data-height="{page["height"]}"><h2>Full source page {page["number"]}</h2><p><a href="{escape(page["render"])}" target="_blank" rel="noopener noreferrer">View full-size page image</a></p><div class="columns"><div class="source"><img loading="lazy" src="{escape(page["render"])}" alt="Original source page {page["number"]}"><div class="highlight"></div></div><div class="transcript"><p class="selection muted">Select a text line to highlight its source.</p>{"".join(variants)}<details><summary>Previous native text</summary>{native}</details></div></div></section>'
        )
    title = escape(report["source_title"])
    document = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>OCR comparison · {title}</title><link rel="stylesheet" href="comparison.css"></head><body><header><span class="badge">BLOCKED · EXPERIMENTAL COMPARISON</span><h1>{title}</h1><p>Original scan, previous extraction, local OCR candidates and your notes are preserved separately.</p></header><main><div class="summary"><p><strong>{len(report["pages"])} source pages · {len(report["findings"])} issue groups · all remain open</strong></p><p class="notice">English and Hindi OCR candidates are available. Improved-looking output is not accepted automatically. Signatures are marked from your review, not detected by this engine. No publication or RAG update occurs.</p><p><a href="original.pdf">Preserved original PDF</a><a href="comparison.json">Comparison evidence</a><a href="baseline-artifact.json">Previous artifact</a><a href="reviewer-feedback.json">Your feedback</a></p><p class="muted">Source SHA-256: {escape(report["source_sha256"])}</p><nav aria-label="Reported issues">{"".join(links)}</nav><p><a href="#page-1">Compare full pages and source highlights ↓</a></p></div>{"".join(cases)}{"".join(pages)}</main><footer>Read-only tuning experiment. Confidence is not accuracy. Table semantics, reading order and legal applicability remain unverified. Human notes never overwrite raw OCR.</footer><script src="comparison.js"></script></body></html>"""
    (root / "index.html").write_text(document, encoding="utf8")
    (root / "comparison.css").write_text(CSS + EXTRA_CSS, encoding="utf8")
    (root / "comparison.js").write_text(JS, encoding="utf8")

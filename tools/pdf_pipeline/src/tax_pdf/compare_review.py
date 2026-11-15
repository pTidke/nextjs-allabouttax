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


def render_line(item, label, *, raw_excluded=False):
    scope = item.get("text_scope", "INCLUDED_CANDIDATE")
    text = item["text"] if "text" in item else item["raw_text"]
    if scope == "EXCLUDED_BLEED_THROUGH" and not raw_excluded:
        text = "[Reviewer-confirmed bleed-through · excluded from text]"
    elif scope == "EXCLUDED_BY_REVIEWER" and not raw_excluded:
        text = "[Excluded signature/footer region · raw text preserved in evidence]"
    elif scope == "MIXED_EXCLUSION_NEEDS_REVIEW":
        text = "[Overlaps an excluded region · separation needs review]\n" + text
    if raw_excluded and not text.strip():
        text = "[no recognised text]"
    return f'<button class="block" {attrs(Box(**item["bbox"]), item["id"])}><span class="id">{escape(item["id"])} · {escape(label)}</span>{escape(text)}</button>'


def render_variant_lines(variant):
    bleed = [
        line for line in variant["lines"] if line.get("text_scope") == "EXCLUDED_BLEED_THROUGH"
    ]
    lines = "".join(
        render_line(
            line,
            f"{variant.get('engine', 'Tesseract')} · confidence {line['confidence']:.0f}",
        )
        for line in variant["lines"]
        if line.get("text_scope") != "EXCLUDED_BLEED_THROUGH"
    )
    if bleed:
        evidence = "".join(
            render_line(line, "Excluded bleed-through · raw OCR", raw_excluded=True)
            for line in bleed
        )
        lines += f'<details class="excluded-evidence"><summary>{len(bleed)} bleed-through regions excluded · inspect evidence</summary><p class="muted">Confirmed by your review of this source version. Raw OCR and source highlights remain available. These regions are not counted as correct extraction.</p>{evidence}</details>'
    return lines


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
        latest = "".join(
            f"<p><strong>Your review of the previous version:</strong> {escape(note['user_report'])}</p>"
            + (
                f"<p><strong>Reviewer-proposed sequence:</strong> {escape(' '.join(note['proposed_sequence']))}</p>"
                if note.get("proposed_sequence")
                else ""
            )
            for note in case.get("latest_review", [])
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
            engine = escape(attempt.get("engine", "Tesseract"))
            numbers = (
                f'<p><strong>Detected digit-only items:</strong> {escape(" ".join(attempt["numeric_items"]))}</p><p class="muted">Other detected tokens (still unresolved): {escape(", ".join(attempt["non_numeric_items"]) or "none")}</p>'
                if "numeric_items" in attempt
                else ""
            )
            attempts.append(
                f'<div class="candidate"><p class="muted">{engine} candidate · {language}{rotation}</p><pre>{escape(attempt["text"] or "[no text detected — still unresolved]")}</pre>{numbers}<details><summary>Extraction details</summary><p class="muted">Engine confidence: {escape(attempt["confidence"])} / 100; not a correctness score. Source group: {escape(attempt["group_id"])}. <a href="{escape(attempt["raw"])}">Raw output</a></p></details></div>'
            )
        if case.get("resolution") == "REVIEWER_EXCLUDED_FROM_TEXT":
            candidates = '<p class="signature"><strong>Excluded from this text view at your request.</strong> The original source crop and raw OCR remain preserved. This exclusion does not count as correct extraction and does not apply to other documents.</p>'
        elif case["handling"] == "REVIEWER_MARKED_SIGNATURE_IMAGE_ONLY":
            candidates = '<p class="signature"><strong>Signature image, marked by reviewer.</strong> No region OCR is run here. The source crop remains visible; no identity or text is inferred from the signature. Full-page raw OCR remains available separately and may contain garbage for this region.</p>'
        else:
            candidates = "".join(attempts)
        archived = "".join(
            f"<pre>{escape(a['group_id'])}: {escape(a['text'])}</pre>"
            for a in case.get("prior_attempts", [])
        )
        if archived:
            candidates += f"<details><summary>Previous OCR candidates</summary>{archived}</details>"
        badge = (
            "Excluded from text · source retained"
            if case.get("resolution") == "REVIEWER_EXCLUDED_FROM_TEXT"
            else "Unresolved · needs review"
        )
        if report.get("refinement") and case["category"] == "hindi_transcription":
            candidates = (
                '<p class="notice">This new engine is being tested for English text only. The Hindi candidate you reviewed is retained under Previous OCR candidates; these outputs have not been merged.</p>'
                + candidates
            )
        crops = "".join(
            f'<p class="muted">{escape(", ".join(group["region_ids"]))}{" · excluded from text" if group.get("excluded") else ""}</p><a href="{escape(group["crop"])}" target="_blank" rel="noopener noreferrer"><img class="crop" src="{escape(group["crop"])}" alt="Source crop for {escape(", ".join(group["region_ids"]))}"></a>'
            for group in case["groups"]
        )
        cases.append(
            f'<section class="case" id="{escape(case["id"])}"><h2>{escape(title)}</h2><p><span class="pill">{badge}</span> {escape(case["category"].replace("_", " "))}</p><div class="case-grid"><div><h3>Original source crop · page {case["page"]}</h3>{crops}<p class="muted">Includes six source-point margins. Open image for full size.</p><details><summary>Previous extracted text</summary><pre>{escape(original)}</pre></details></div><div><div class="human"><strong>Your reported issue</strong><p>{escape(case["user_report"])}</p>{proposed}{latest}<p class="muted">Reviewer notes are separate from machine output and are not passed to OCR.</p></div>{candidates}</div></div></section>'
        )
    pages = []
    for page in report["pages"]:
        variants = []
        for variant in page["variants"]:
            lines = render_variant_lines(variant)
            variants.append(
                f'<details data-variant="{escape(variant["languages"])}" data-engine="{escape(variant.get("engine", "Tesseract"))}"><summary>{escape(variant.get("engine", "Tesseract"))} full-page OCR · {escape(variant["languages"])} · unverified reading order</summary><p><a href="{escape(variant["raw"])}">Raw OCR JSON</a></p>{lines or "<p>No text detected. Remains unresolved.</p>"}</details>'
            )
        native = "".join(render_line(b, "previous native") for b in page["native_blocks"])
        pages.append(
            f'<section class="page" id="page-{page["number"]}" data-width="{page["width"]}" data-height="{page["height"]}"><h2>Full source page {page["number"]}</h2><p><a href="{escape(page["render"])}" target="_blank" rel="noopener noreferrer">View full-size page image</a></p><div class="columns"><div class="source"><img loading="lazy" src="{escape(page["render"])}" alt="Original source page {page["number"]}"><div class="highlight"></div></div><div class="transcript"><p class="selection muted">Select a text line to highlight its source.</p>{"".join(variants)}<details><summary>Previous native text</summary>{native}</details></div></div></section>'
        )
    excluded_count = sum(
        c.get("resolution") == "REVIEWER_EXCLUDED_FROM_TEXT" for c in report["findings"]
    )
    status = (
        f"{excluded_count} excluded issue groups · {len(report['findings']) - excluded_count} need review"
        if excluded_count
        else "all remain open"
    )
    scope_notice = (
        f"{len(report['refinement']['excluded_region_ids'])} source regions are excluded from this text view at your request. Raw evidence is retained; excluded content is not counted as correct. "
        if report.get("refinement")
        else ""
    )
    if report.get("scope_review"):
        bleed_count = sum(
            line.get("text_scope") == "EXCLUDED_BLEED_THROUGH"
            for page in report["pages"]
            for variant in page["variants"]
            for line in variant["lines"]
        )
        scope_notice += f"{bleed_count} additional OCR regions are reviewer-confirmed bleed-through and are collapsed under excluded evidence. "
        scope_link = (
            f'<a href="{escape(report["scope_review"]["review_file"])}">Bleed-through review</a>'
        )
    else:
        scope_link = ""
    title = escape(report["source_title"])
    document = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>OCR comparison · {title}</title><link rel="stylesheet" href="comparison.css"></head><body><header><span class="badge">BLOCKED · EXPERIMENTAL COMPARISON</span><h1>{title}</h1><p>Original scan, previous extraction, local OCR candidates and your notes are preserved separately.</p></header><main><div class="summary"><p><strong>{len(report["pages"])} source pages · {len(report["findings"])} issue groups · {status}</strong></p><p class="notice">{scope_notice}English OCR candidates and the prior bilingual candidate are available. Improved-looking output is not accepted automatically. Signatures are marked from your review, not detected by this engine. No publication or RAG update occurs.</p><p><a href="original.pdf">Preserved original PDF</a><a href="comparison.json">Comparison evidence</a><a href="baseline-artifact.json">Previous artifact</a><a href="reviewer-feedback.json">Your feedback</a>{scope_link}</p><p class="muted">Source SHA-256: {escape(report["source_sha256"])}</p><nav aria-label="Reported issues">{"".join(links)}</nav><p><a href="#page-1">Compare full pages and source highlights ↓</a></p></div>{"".join(cases)}{"".join(pages)}</main><footer>Read-only tuning experiment. Confidence is not accuracy. Table semantics, reading order and legal applicability remain unverified. Human notes never overwrite raw OCR.</footer><script src="comparison.js"></script></body></html>"""
    (root / "index.html").write_text(document, encoding="utf8")
    (root / "comparison.css").write_text(CSS + EXTRA_CSS, encoding="utf8")
    (root / "comparison.js").write_text(JS, encoding="utf8")

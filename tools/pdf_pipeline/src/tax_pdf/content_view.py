"""Read-only source comparison for structured drafts. Documents never become HTML."""

from collections import Counter

from .review import CSS, JS, attrs, escape

LABELS = {
    "content_candidate": "Content candidates",
    "administrative_excluded": "Administrative text proposed for exclusion",
    "signature_excluded": "Reviewed signature artifacts (excluded)",
    "metadata": "Header and issuer metadata",
    "mixed_review": "Mixed boundaries needing review",
    "table_review": "Text overlapping table candidates",
}


def region_html(region):
    change = ""
    if region.reviewed_text is not None:
        change = (
            f'<p class="reviewed">Reviewed: {escape(region.reviewed_text)}</p>'
            '<p class="muted">Explicit header edit; the original OCR above is unchanged.</p>'
        )
    return (
        f'<div class="region"><button class="block" {attrs(region.image_bbox, region.id)}>'
        f'<span class="id">Proposed position {region.proposed_order} · provider line '
        f"{region.source_line} · span {region.start}:{region.end}</span>"
        f"{escape(region.raw_text)}</button>{change}"
        f"<details><summary>Source evidence and holds</summary>"
        f'<a href="{escape(region.crop)}">Original crop</a>'
        f"<p>{escape(' · '.join(region.holds))}</p>"
        f'<p class="muted">{escape(" · ".join(region.scope_evidence))}</p>'
        "</details></div>"
    )


def tables_html(page):
    parts = []
    for table in page.tables:
        rows = []
        for number in range(table.rows):
            cells = []
            for cell in (c for c in table.cells if c.row == number):
                text = cell.raw_text
                label = (
                    "[unresolved / covered]"
                    if text is None
                    else "[blank candidate]"
                    if text == ""
                    else text
                )
                cells.append(
                    f"<td>{escape(label)}<small>span {escape(cell.row_span)} × "
                    f"{escape(cell.column_span)} · headers unverified</small></td>"
                )
            rows.append("<tr>" + "".join(cells) + "</tr>")
        parts.append(
            f"<table><caption>{escape(table.id)} — structure unverified</caption>"
            + "".join(rows)
            + "</table>"
        )
    return (
        "".join(parts)
        or "<p>No native table candidates supplied for this page. This does not establish the absence of tables.</p>"
    )


def write_content_view(preview, root):
    sections = []
    navigation = []
    for index, page in enumerate(preview.pages):
        navigation.append(
            f'<a href="#variant-{index}">{escape(page.title)} · {escape(page.variant)}</a>'
        )
        counts = Counter(r.scope for r in page.regions)
        groups = []
        for kind, label in LABELS.items():
            selected = sorted(
                (r for r in page.regions if r.scope == kind), key=lambda r: r.proposed_order
            )
            if selected:
                groups.append(
                    f"<details {'open' if kind == 'content_candidate' else ''}>"
                    f"<summary>{label} ({len(selected)})</summary>"
                    + "".join(region_html(r) for r in selected)
                    + "</details>"
                )
        fields = "".join(
            f"<p><strong>{escape(k.replace('_', ' ').capitalize())}:</strong> {escape(v)}</p>"
            for k, v in page.reviewed_fields.items()
        )
        changes = sum(bool(r.edits) for r in page.regions)
        missing = (
            f'<p class="notice">This document has {page.expected_pages} pages. Pages '
            f"{escape(', '.join(map(str, page.unrepresented_pages)))} are not represented here.</p>"
            if page.unrepresented_pages
            else ""
        )
        warnings = "".join(
            f"<li>{escape(w['raw'])} — {escape(', '.join(w['codes']))}</li>" for w in page.warnings
        )
        sections.append(
            f'<section class="page" id="variant-{index}" data-width="{page.image_width}" data-height="{page.image_height}">'
            f"<h2>{escape(page.title)} · page {page.page}</h2><p>{escape(page.variant)}</p>"
            f"<p>{len(page.source_lines)} provider lines → {len(page.regions)} completely accounted spans · "
            f"{counts['administrative_excluded']} administrative spans · {counts['signature_excluded']} signature artifacts · {changes} explicit header edit(s)</p>"
            f'{missing}<details class="metadata"><summary>Reviewed field values and unresolved issues</summary>'
            f"{fields}<p>These are printed header dates, not verified legal applicability dates. "
            "Field values are source-reviewed; only bound raw variants receive text edits.</p>"
            f"<p>{escape(' · '.join(page.holds))}</p><ul>{warnings}</ul></details>"
            f'<p><a href="{escape(page.original)}">Original PDF</a> · '
            f'<a href="{escape(page.raw)}">Unchanged raw OCR</a></p>'
            '<div class="columns"><div class="source">'
            f'<img loading="lazy" src="{escape(page.source_image)}" alt="Original source page">'
            '<div class="highlight"></div></div><div class="transcript">'
            '<p class="selection">Click a text region to highlight its original position.</p>'
            '<p class="notice">Geometric order is proposed. Content candidates still need transcription and order review. '
            "Reviewed signatures stay in excluded evidence; unknown marks are retained for review.</p>"
            + "".join(groups)
            + "<details><summary>Structured table candidates</summary>"
            + tables_html(page)
            + "</details></div></div></section>"
        )
    comparisons = sum(len(c["flags"]) for c in preview.comparisons)
    source_pages = len({(p.source_sha256, p.page) for p in preview.pages})
    (root / "index.html").write_text(
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src 'self'; "
        "style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'\">"
        '<title>Structured content review preview</title><link rel="stylesheet" href="content.css">'
        '<script defer src="content.js"></script></head><body><header>'
        '<span class="badge">DRAFT · NOT APPROVED FOR RAG</span><h1>What would enter retrieval?</h1>'
        "<p>Compare content candidates, source-bound administrative exclusions and reviewed metadata. "
        "Originals and raw OCR remain intact. No OCR engine has been selected.</p></header>"
        '<nav class="summary">' + "".join(navigation) + "</nav><main>"
        '<div class="summary"><p class="notice">This is a development preview, not an extraction quality pass. '
        f"{len(preview.pages)} variants cover {source_pages} source pages. Whole-page transcription, reading order and tax review remain incomplete.</p>"
        f"<p>{comparisons} prior date comparison flags are retained; reviewed header fields do not clear body-date disagreements.</p>"
        '<p><a href="content-preview.json">Structured draft</a>'
        '<a href="scope-review.json">Bound owner review</a>'
        '<a href="files.json">File checksums</a>'
        '<a href="evidence/index.html">Raw date warnings and comparisons</a></p></div>'
        + "".join(sections)
        + "<footer><h2>Limits of this preview</h2><ul>"
        + "".join(f"<li>{escape(note)}</li>" for note in preview.notes)
        + "</ul></footer></main></body></html>"
    )
    (root / "content.css").write_text(
        CSS
        + """
.summary a{display:inline-block;margin:5px 18px 5px 0}.metadata{padding:12px;background:#eaf2f5}
.transcript>details{margin:12px 0;border:1px solid #d7e2e6;padding:10px}
summary{cursor:pointer;font-weight:650}.region{border-bottom:1px solid #d7e2e6;padding:4px}
.region details{font-size:12px;padding:3px 6px;color:#526978;overflow-wrap:anywhere}
.reviewed{background:#e6f5ee;padding:10px;white-space:pre-wrap;margin:5px 0}
.selection{font-size:13px;color:#00715f}small{display:block;color:#516878}td{padding:8px}
"""
    )
    (root / "content.js").write_text(JS)

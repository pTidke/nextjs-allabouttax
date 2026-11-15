"""Static review package. Untrusted document content is text, never HTML/code."""

import html
import json
from pathlib import Path

from .models import Artifact

CSS = """
:root{font-family:system-ui,sans-serif;color:#192a39;background:#f2f5f7}*{box-sizing:border-box}
body{margin:0}header{padding:24px 32px;background:#102d40;color:white}h1{font-size:24px;margin:8px 0}
header p{max-width:1000px;margin:8px 0;color:#d1e3ed}.badge{display:inline-block;border-radius:5px;padding:5px 9px;font-size:13px;font-weight:700;background:#704116;color:white}
.summary{padding:18px 32px;background:white;border-bottom:1px solid #cdd7de}a{color:#00715f}
.summary a{margin-right:16px}.notice{padding:12px;background:#fff4d8;border-left:4px solid #b87c17}
.page{padding:24px 32px;border-bottom:1px solid #c5d2da}.page h2{font-size:20px;margin:0 0 12px}
.columns{display:grid;grid-template-columns:minmax(340px,1fr) minmax(340px,1fr);gap:24px;align-items:start}
.source{position:sticky;top:12px;background:white;border:1px solid #b8c8d3;box-shadow:0 2px 8px #0001}
.source img{display:block;width:100%;height:auto}.highlight{position:absolute;border:2px solid #00876b;background:#00b98525;pointer-events:none;display:none}
.transcript{background:white;padding:18px;border:1px solid #d6e0e6;max-height:950px;overflow:auto}
.block{display:block;width:100%;border:0;border-bottom:1px solid #e6edf1;background:white;text-align:left;padding:9px 6px;cursor:pointer;white-space:pre-wrap;font:14px/1.55 system-ui}
.block:hover,.block:focus{background:#e7f6f1;outline:2px solid #168770;outline-offset:-2px}.id{font:11px monospace;color:#637889;display:block}
.issues{padding:10px 16px;background:#fff6eb;margin:12px 0;font-size:13px}.issues li{margin:7px 0}.issues code{font-size:11px}
.table-wrap{overflow:auto;margin:15px 0;border:1px solid #c8d5dc}table{border-collapse:collapse;font-size:12px;width:100%}td{border:1px solid #c8d5dc;padding:0;min-width:65px}td button{width:100%;border:0;background:white;text-align:left;padding:8px;white-space:pre-wrap;color:#192a39;cursor:pointer}td button:hover{background:#e7f6f1}.unresolved{background:#fff0cc!important}caption{text-align:left;padding:10px;background:#edf3f6;font-weight:600}
.muted{color:#516878;font-size:13px}.empty{padding:30px;background:#fff5e8}footer{padding:24px 32px;color:#516878;font-size:13px}
@media(max-width:850px){.columns{grid-template-columns:1fr}.source{position:relative}.page,header,.summary{padding:18px}.transcript{max-height:600px}}
"""
JS = """
document.addEventListener('click',event=>{
 const item=event.target.closest('[data-box]');if(!item)return;
 const page=item.closest('.page'), marker=page.querySelector('.highlight');
 const box=JSON.parse(item.dataset.box),w=Number(page.dataset.width),h=Number(page.dataset.height);
 marker.style.left=(100*box.x0/w)+'%';marker.style.top=(100*box.top/h)+'%';
 marker.style.width=(100*(box.x1-box.x0)/w)+'%';marker.style.height=(100*(box.bottom-box.top)/h)+'%';marker.style.display='block';
 page.querySelector('.selection').textContent='Selected source region: '+item.dataset.region;
});
"""


def escape(value):
    return html.escape(str(value), quote=True)


def issues_list(issues):
    return (
        '<ul class="issues">'
        + "".join(
            f"<li><code>{escape(i.code)}</code> · {escape(i.severity)}<br>{escape(i.message)}</li>"
            for i in issues
        )
        + "</ul>"
        if issues
        else ""
    )


def attrs(box, region):
    return (
        f'data-box="{escape(json.dumps(box.model_dump()))}" data-region="{escape(region)}"'
        if box
        else ""
    )


def write_review(artifact: Artifact, root: Path):
    sections = []
    for page in artifact.pages:
        if page.render:
            source = f'<div class="source"><img loading="lazy" src="{escape(page.render)}" alt="Original source page {page.number}"><div class="highlight"></div></div>'
        else:
            source = '<div class="empty">Source image unavailable. This page remains blocked.</div>'
        blocks = "".join(
            f'<button class="block" {attrs(b.bbox, b.id)}><span class="id">{escape(b.id)} · {escape(b.source)}{(" · raw text inside table " + escape(b.table_id)) if b.table_id else ""}</span>{escape(b.raw_text)}</button>'
            for b in page.blocks
        )
        tables = []
        for table in page.tables:
            rows = []
            for r in range(table.rows):
                cells = []
                for cell in (c for c in table.cells if c.row == r):
                    text = (
                        cell.raw_text if cell.raw_text is not None else "[unresolved/covered cell]"
                    )
                    if text == "":
                        text = "[blank candidate]"
                    cells.append(
                        f'<td><button class="{"unresolved" if cell.raw_text is None else ""}" {attrs(cell.bbox, cell.id)}>{escape(text)}</button></td>'
                    )
                rows.append("<tr>" + "".join(cells) + "</tr>")
            tables.append(
                f'<div class="table-wrap"><table><caption>{escape(table.id)} · candidate grid; headers/spans unverified</caption>{"".join(rows)}</table></div>'
            )
        transcript = (
            blocks
            or '<p class="empty">No native transcription available. OCR or manual extraction is required.</p>'
        )
        zoom = (
            f'<a href="{escape(page.render)}" target="_blank" rel="noopener noreferrer">View full-size source image</a>'
            if page.render
            else ""
        )
        sections.append(
            f'<section class="page" id="page-{page.number}" data-width="{page.width}" data-height="{page.height}"><h2>Original page {page.number} · {escape(page.status.replace("_", " "))}</h2><p class="muted">{len(page.blocks)} text blocks · {len(page.tables)} table candidates · rotation {page.rotation}° · {zoom}</p>{issues_list(page.issues)}<div class="columns">{source}<div class="transcript"><p class="muted selection">Select text or a table cell to highlight its source.</p>{"".join(tables)}{transcript}</div></div></section>'
        )
    counts = sum(len(p.issues) for p in artifact.pages) + len(artifact.issues)
    nav = " ".join(f'<a href="#page-{p.number}">{p.number}</a>' for p in artifact.pages)
    document = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>PDF extraction review · {escape(artifact.source_title)}</title><link rel="stylesheet" href="review.css"></head><body><header><span class="badge">{escape(artifact.state.replace("_", " "))}</span><h1>{escape(artifact.source_title)}</h1><p>Extraction laboratory · unverified candidates · never approved tax knowledge</p></header><div class="summary"><p><strong>{len(artifact.pages)} / {artifact.expected_pages or "unknown"} pages accounted for</strong> · {counts} issues · publication disabled</p><p class="notice">This baseline has no OCR or verified reading order/table semantics. A clean-looking page still requires extraction acceptance and tax review.</p><p><a href="original.pdf" download>Download preserved original</a><a href="artifact.json" download>Structured artifact</a></p><p class="muted">Source SHA-256: {escape(artifact.source_sha256)}</p><p>Pages: {nav}</p>{issues_list(artifact.issues)}</div>{"".join(sections)}<footer>Original bytes preserved. Coordinates use displayed page points, top-left origin. Corrections and approvals are not implemented in this read-only lab.</footer><script src="review.js"></script></body></html>"""
    (root / "review.html").write_text(document, encoding="utf8")
    (root / "review.css").write_text(CSS, encoding="utf8")
    (root / "review.js").write_text(JS, encoding="utf8")

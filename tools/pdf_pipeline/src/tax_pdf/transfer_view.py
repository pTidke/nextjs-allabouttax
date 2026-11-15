"""Read-only transfer pilot report and a small source-first verification queue."""

import json

from .models import Box
from .review import CSS, JS, attrs, escape


def write_transfer_view(report, root):
    summary = report["summary"]
    cards = "".join(
        f"<article><strong>{summary[key]}</strong><span>{label}</span></article>"
        for key, label in [
            ("acquired_sources", f"of {summary['planned_sources']} source slots acquired"),
            ("original_pages", "pages in acquired originals"),
            ("rendered_selected_pages", "selected pages rendered"),
            ("candidate_attempts", "native / OCR attempts"),
            ("native_table_candidates", "unverified native table candidates"),
            ("failed_attempts", "failed extraction attempts"),
        ]
    )
    acquisition = []
    for doc in report["documents"]:
        attempts = [a for a in report["acquisition_attempts"] if a["id"] == doc["id"]]
        reason = "; ".join(a.get("reason", "Acquired") for a in attempts)
        acquisition.append(
            f"<tr><td>{escape(doc['title'])}<small>{escape(doc['family'])} · "
            f"{'Related family seen before' if doc['prior_family_exposure'] else 'New local family'}</small></td>"
            f"<td>{escape(doc['state'])}</td><td>{escape(reason)}</td>"
            f"<td>{doc.get('expected_pages', 'Unknown')} original; native {escape(doc.get('native_selected', []))}; "
            f"OCR {escape(doc.get('ocr_selected', []))}</td></tr>"
        )
    sections = []
    navigation = []
    for di, doc in enumerate(report["documents"]):
        for case in doc["cases"]:
            if not case.get("source_image"):
                continue
            identity = f"doc-{di}-p{case['page']}"
            navigation.append(f'<a href="#{identity}">{escape(doc["title"])} · p{case["page"]}</a>')
            variants = []
            for candidate in case["candidates"]:
                warnings = "".join(
                    f"<li>{escape(w['raw'])} — {escape(' · '.join(w['codes']))}</li>"
                    for w in candidate.get("date_warnings", [])
                )
                lines = []
                for line in candidate["lines"]:
                    box = Box.model_validate(line["image_bbox"])
                    confidence = line.get("confidence")
                    label = (
                        f"OCR confidence {confidence:.0f}"
                        if confidence is not None
                        else "Native text; no OCR confidence"
                    )
                    lines.append(
                        f'<button class="block" {attrs(box, line["id"])}><span class="id">'
                        f"{escape(line['id'])} · {label}</span>{escape(line['text'])}</button>"
                    )
                raw = (
                    f'<a href="{escape(candidate["raw"])}">Raw engine evidence</a>'
                    if candidate.get("raw")
                    else ""
                )
                variants.append(
                    f"<details {'open' if candidate['id'] == 'native' else ''}><summary>"
                    f"{escape(candidate['id'])} · {len(candidate['lines'])} lines · {escape(candidate['state'])}</summary>"
                    f"<p>{raw} · {len(candidate.get('table_candidates') or [])} native table grids; "
                    "OCR relationships are not reconstructed.</p>"
                    f'<ul class="issues">{warnings}</ul>' + "".join(lines) + "</details>"
                )
            diffs = sum(
                c["state"] == "LITERAL_INVENTORY_DIFFERS" for c in case.get("comparisons", [])
            )
            sections.append(
                f'<section class="page" id="{identity}" data-width="{case["image_width"]}" data-height="{case["image_height"]}">'
                f"<h2>{escape(doc['title'])} · page {case['page']}</h2>"
                f"<p>{escape(case['native_status'])} · {diffs} pairs have differing literal inventories. "
                "These are review hints, not confirmed errors or accuracy scores.</p>"
                f'<p><a href="{escape(doc["package"])}/review.html">Native page/table review package</a> · '
                f'<a href="{escape(doc["package"])}/original.pdf">Original PDF</a></p>'
                '<div class="columns"><div class="source">'
                f'<img loading="lazy" src="{escape(case["source_image"])}" alt="Unchanged original page">'
                '<div class="highlight"></div></div><div class="transcript">'
                '<p class="selection">Select extracted text to locate it on the source.</p>'
                + "".join(variants)
                + "</div></div></section>"
            )
    checks = []
    for check in report["source_checks"]:
        checks.append(
            f'<article id="{escape(check["id"])}"><h3>{escape(check["title"])} · page {check["page"]}</h3>'
            f"<p>{escape(check['focus'])} · source check, not whole-page approval</p>"
            f'<a href="{escape(check["source_image"])}">Full source page</a>'
            f'<img loading="lazy" src="{escape(check["crop"])}" alt="Unchanged source region for verification">'
            "<p>No reference text is filled from OCR. Identify the literal date, identifier or condition from the image; "
            "unreadable marks can remain uncertain. No tax interpretation is requested here.</p></article>"
        )
    (root / "source-checks.json").write_text(
        json.dumps(report["source_checks"], ensure_ascii=False, indent=2) + "\n"
    )
    (root / "index.html").write_text(
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src 'self'; style-src 'self'; "
        "script-src 'self'; base-uri 'none'; form-action 'none'\">"
        '<title>New-document extraction pilot</title><link rel="stylesheet" href="pilot.css">'
        '<script defer src="pilot.js"></script></head><body><header><span class="badge">UNVERIFIED · NO RAG PUBLICATION</span>'
        "<h1>New-document extraction pilot</h1><p>Frozen source choices · all failures retained · source-first verification</p></header>"
        '<main><div class="summary"><p class="notice">Accuracy is not yet measured: this cohort has no verified references. '
        'Candidate agreement, nonempty output and high OCR confidence cannot clear review.</p><div class="cards">'
        + cards
        + '</div><p><a href="#source-checks">Small source-check queue</a> · <a href="report.json">Full evidence report</a> · '
        '<a href="inputs/plan.json">Frozen plan</a> · <a href="files.json">File checksums</a></p>'
        '<h2>Every planned source</h2><div class="scroll"><table><thead><tr><th>Source / family</th><th>State</th><th>Acquisition</th>'
        "<th>Page denominators</th></tr></thead><tbody>"
        + "".join(acquisition)
        + "</tbody></table></div>"
        "<h2>What this pilot can establish</h2><p>Original/render integrity, page accounting, runtime, extraction failures, "
        "empty output and warning/disagreement evidence. Native table grids are retained for review.</p>"
        "<h2>Still unmeasured</h2><p>Full-page character/word accuracy, omissions, critical-field correctness, table relationships, "
        "reading order and false-clean rates. Real image-only scans, faint foreground and Hindi coverage need separately confirmed samples.</p>"
        '</div><nav class="summary">'
        + "".join(navigation)
        + "</nav>"
        + "".join(sections)
        + '<section id="source-checks" class="summary"><h2>Focused source-check queue</h2><p>Six or fewer source-only crops, '
        "kept separate from candidate readings. A response verifies only the stated region, not legal applicability or an entire page.</p>"
        + "".join(checks)
        + "</section><footer><ul>"
        + "".join(f"<li>{escape(n)}</li>" for n in report["notes"])
        + "</ul></footer></main></body></html>"
    )
    (root / "pilot.css").write_text(
        CSS
        + """
main{max-width:1500px;margin:auto}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.cards article{background:#eaf2f5;padding:14px}.cards strong{display:block;font-size:28px}.cards span{font-size:13px}
nav a{display:inline-block;margin:5px 16px 5px 0}table{font-size:13px}td,th{border:1px solid #cbd9df;text-align:left;padding:12px;vertical-align:top}
small{display:block;color:#526877}.scroll{overflow:auto}summary{cursor:pointer;font-weight:650}.transcript>details{margin:10px 0}
#source-checks article{padding:18px;margin:16px 0;border:1px solid #cbd9df;background:white}
#source-checks img{display:block;max-width:100%;max-height:600px;margin:16px 0;border:1px solid #cbd9df}
@media(max-width:750px){.cards{grid-template-columns:1fr 1fr}}
"""
    )
    (root / "pilot.js").write_text(JS)

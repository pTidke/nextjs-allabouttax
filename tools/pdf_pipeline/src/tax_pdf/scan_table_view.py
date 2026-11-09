"""Read-only source/table claims gallery. No review decisions or accepted grids."""

import html
import json


def grid_view(table):
    rows, cols = table["rows_claimed"], table["columns_claimed"]
    if (
        type(rows) is not int
        or type(cols) is not int
        or not 0 < rows * cols <= 2000
        or table["overlapping_positions"]
        or any(not c["span_in_bounds"] for c in table["cells"])
    ):
        return '<p class="hold">Grid schematic withheld: invalid, overlapping or oversized provider claims. Raw cells remain available.</p>'
    anchors, covered = {}, set()
    for cell in table["cells"]:
        anchors[(cell["row_start"], cell["column_start"])] = cell
        covered.update(
            (r, c)
            for r in range(cell["row_start"], cell["row_end"])
            for c in range(cell["column_start"], cell["column_end"])
        )
    body = []
    for row in range(rows):
        line = []
        for col in range(cols):
            cell = anchors.get((row, col))
            if cell:
                text = (
                    html.escape(cell["text"])
                    if isinstance(cell["text"], str) and cell["text"]
                    else "⟦empty candidate⟧"
                )
                line.append(
                    f'<td rowspan="{cell["row_end"] - row}" colspan="{cell["column_end"] - col}">{text}</td>'
                )
            elif (row, col) not in covered:
                line.append('<td class="unknown">Not emitted</td>')
        body.append("<tr>" + "".join(line) + "</tr>")
    return (
        "<p>Provider grid schematic: widths are illustrative. “Not emitted” marks an unrepresented position; "
        'it is not a reconstructed or confirmed blank cell.</p><div class="scroll"><table class="grid"><tbody>'
        + "".join(body)
        + "</tbody></table></div>"
    )


def write_view(report, root):
    esc = html.escape
    cards = []
    for i, case in enumerate(report["cases"], 1):
        sections = []
        if case.get("engineering_findings"):
            sections.append(
                '<div class="hold"><strong>Agent source comparison — not owner-verified</strong><ul>'
                + "".join(f"<li>{esc(x)}</li>" for x in case["engineering_findings"])
                + "</ul></div>"
            )
        if case.get("image"):
            sections.append(
                "<details><summary>Full source page</summary>"
                f'<a href="{esc(case["image"])}"><img src="{esc(case["image"])}" alt="Source page {case["page"]}"></a></details>'
            )
        for attempt in case["attempts"]:
            sections.append(f"<h3>{esc(attempt['provider'])}</h3><p>{esc(attempt['state'])}</p>")
            if attempt.get("raw"):
                sections.append(f'<p><a href="{esc(attempt["raw"])}">Complete raw output</a></p>')
            if attempt.get("inspection"):
                for table in attempt["inspection"]["tables"]:
                    sections.append(
                        f"<h4>{esc(table['id'])} · {table['rows_claimed']} × {table['columns_claimed']} claimed grid</h4>"
                    )
                    box = table["image_percent_box"]
                    if box:
                        sections.append(
                            f'<div class="crop" style="aspect-ratio:{box["width"] * case["source_page_width"]}/{box["height"] * case["source_page_height"]}">'
                            f'<img src="{esc(case["image"])}" alt="Provider-proposed table region on original page" '
                            f'style="width:{10000 / box["width"]}%;left:{-100 * box["x"] / box["width"]}%;top:{-100 * box["y"] / box["height"]}%;"></div>'
                        )
                    rows = "".join(
                        f"<tr><td>{c['row_start']}:{c['row_end']}</td><td>{c['column_start']}:{c['column_end']}</td>"
                        f"<td><pre>{esc(c['text']) if isinstance(c['text'], str) and c['text'] else '⟦empty/unresolved candidate; not a confirmed blank⟧'}</pre></td></tr>"
                        for c in table["cells"]
                    )
                    sections.append(
                        '<p class="hold">All rows, spans and header flags are provider claims awaiting source review.</p>'
                        f"<details><summary>Structure holds</summary><pre>{esc(json.dumps(table['holds'], indent=2))}</pre></details>"
                        + grid_view(table)
                        + "<details><summary>Literal cell inventory</summary>"
                        '<div class="scroll"><table><thead><tr><th>Rows [start,end)</th><th>Columns [start,end)</th><th>Raw cell text</th></tr></thead>'
                        f"<tbody>{rows}</tbody></table></div></details>"
                    )
            elif attempt.get("raw"):
                raw = json.loads((root / attempt["raw"]).read_text())
                sections.append(
                    "<p>Plain OCR supplies text lines, not cell relationships.</p>"
                    f"<details><summary>Plain OCR text</summary><pre>{esc(raw.get('text', ''))}</pre></details>"
                )
            else:
                sections.append(
                    f'<p class="hold">{esc(attempt.get("hold", "No provider output"))}</p>'
                )
        kind = (
            "Scanned original (embedded text excluded from both providers)"
            if case["image_kind"] == "genuine_scan_with_embedded_ocr"
            else "Clean PDF rendered as an image (comparison control)"
        )
        cards.append(
            f'<section id="case-{i}"><h2>{i}. {esc(case["title"])} · page {case["page"]}</h2>'
            f"<p>{kind}</p><details><summary>Document-level trial targets</summary><p>{esc('; '.join(case['checks']))}</p></details>"
            f'<a href="{esc(case["original"])}">Original PDF</a>' + "".join(sections) + "</section>"
        )
    navigation = "".join(f'<a href="#case-{i}">Case {i}</a> ' for i in range(1, len(cards) + 1))
    (root / "index.html").write_text(
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
        "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src 'self'; "
        "style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\">"
        "<title>Scanned tables — image-only provider trial</title><style>"
        "body{font:17px/1.5 system-ui;max-width:1180px;margin:25px auto;padding:20px;color:#182d38;background:#f3f6f8}"
        "a{color:#006b57}nav{display:flex;gap:20px}section{background:white;padding:22px;border:1px solid #ccd7df;border-radius:12px;margin:28px 0}"
        "img{display:block;max-width:100%;height:auto}.crop{position:relative;overflow:hidden;width:100%;border:1px solid #ccc}"
        ".crop img{position:absolute;max-width:none}.hold{padding:15px;background:#fff1d7;border-left:4px solid #ac6500}"
        "table{border-collapse:collapse;width:100%}.grid{font-size:14px}.unknown{background:#fff1d7;color:#725000}"
        "td,th{padding:8px;border:1px solid #ccd7df;text-align:left;vertical-align:top;overflow-wrap:anywhere}"
        ".scroll{max-height:640px;overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.5 ui-monospace,monospace}"
        "</style><h1>Scanned tables: image-input trial</h1>"
        '<p class="hold">Raw provider proposals — not accepted extraction. No source text, expected cells or reviewed corrections enter either image provider.</p>'
        f"<p>{report['summary']['genuine_scanned_pages']} genuine scanned pages and {report['summary']['rasterized_native_controls']} rasterized native controls. "
        "English table processing only; broader language and scan coverage remain gaps.</p>"
        f'<nav>{navigation}<a href="scan-tables.json">Report</a><a href="files.json">Evidence checksums</a></nav>'
        + "".join(cards)
        + "<p>Originals and every raw attempt remain available. Successful processing and plausible grids do not establish table accuracy or tax applicability.</p></html>"
    )

"""Validate explicit, source-bound layout hypotheses; never infer or accept a table.

Geometry checks constrain a proposal. They cannot establish its transcription,
conditional meaning, completeness or suitability for retrieval/form filling.
"""

import html
import json
import re
import shutil
import tempfile
from pathlib import Path
from typing import Literal

from PIL import Image
from pydantic import Field

from .benchmark import digest
from .models import Artifact, Model
from .table_review import Binding, source_table


class HeaderGroup(Model):
    table_id: str
    parent: str
    covered: list[str] = Field(min_length=1, max_length=100)
    children: list[str] = Field(min_length=2, max_length=100)


class ColumnFragment(Model):
    before: str
    after: str


class Continuation(Model):
    before: str
    after: str
    kind: Literal["data_rows", "split_header"]
    fragments: list[ColumnFragment] = Field(default_factory=list, max_length=100)


class Separation(Model):
    before: str
    after: str
    block_id: str


class StructurePlan(Model):
    schema_version: Literal["0.1.0"] = "0.1.0"
    state: Literal["AGENT_LAYOUT_PROPOSAL_NOT_ACCEPTED"] = "AGENT_LAYOUT_PROPOSAL_NOT_ACCEPTED"
    publication_eligible: Literal[False] = False
    owner_verified: Literal[False] = False
    tables: list[Binding] = Field(min_length=1, max_length=20)
    header_groups: list[HeaderGroup] = Field(default_factory=list, max_length=50)
    continuations: list[Continuation] = Field(default_factory=list, max_length=20)
    separations: list[Separation] = Field(default_factory=list, max_length=20)


def unique(values):
    if len(values) != len(set(values)):
        raise ValueError("Duplicate relationship or cell selection")


def validate_structure(package: Path, value):
    """Check source identity/limited geometry, preserving all native candidates."""
    if isinstance(value, Path):
        if value.stat().st_size > 1024**2:
            raise ValueError("Structure plan exceeds byte budget")
        value = json.loads(value.read_text())
    plan = StructurePlan.model_validate(value)
    unique([b.table_id for b in plan.tables])
    if (package / "artifact.json").stat().st_size > 20 * 1024**2:
        raise ValueError("Source artifact exceeds byte budget")
    artifact = Artifact.model_validate_json((package / "artifact.json").read_text())
    selected = {}
    for bound in plan.tables:
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", bound.table_id):
            raise ValueError("Unsafe table identifier")
        page = next((p for p in artifact.pages if p.number == bound.page), None)
        table = next((t for t in page.tables if t.id == bound.table_id), None) if page else None
        if table is None:
            raise ValueError("Unknown bound table")
        # Reuse exact source/artifact/render/table identity and original/render integrity checks.
        source_table(package, bound, table.cells)
        selected[table.id] = (page, table)
    if sum(len(t.cells) for _, t in selected.values()) > 10000:
        raise ValueError("Selected table cells exceed review budget")

    def get_table(key):
        if key not in selected:
            raise ValueError("Relationship references an unbound table")
        return selected[key]

    def cell(table, key):
        found = next((c for c in table.cells if c.id == key), None)
        if found is None or found.bbox is None or not (found.raw_text or "").strip():
            raise ValueError("Relationship needs a nonempty source cell with geometry")
        return found

    unique([(g.table_id, g.parent) for g in plan.header_groups])
    for group in plan.header_groups:
        _, table = get_table(group.table_id)
        parent = cell(table, group.parent)
        unique(group.covered + group.children + [group.parent])
        children = [cell(table, key) for key in group.children]
        if (
            len({c.row for c in children}) != 1
            or children[0].row <= parent.row
            or [c.column for c in children]
            != list(range(parent.column, parent.column + len(children)))
        ):
            raise ValueError("Header children must be ordered adjacent columns below their parent")
        expected = {
            c.id
            for c in table.cells
            if c.row == parent.row and parent.column < c.column < parent.column + len(children)
        }
        if set(group.covered) != expected:
            raise ValueError("Covered proposal must exactly match the parent's selected columns")
        if any(
            c.raw_text is not None or c.bbox is not None for c in table.cells if c.id in expected
        ):
            raise ValueError("Covered proposal cannot erase another native cell")
        boxes = [c.bbox for c in children]
        if (
            abs(boxes[0].x0 - parent.bbox.x0) > 1
            or abs(boxes[-1].x1 - parent.bbox.x1) > 1
            or any(abs(a.x1 - b.x0) > 1 for a, b in zip(boxes, boxes[1:], strict=False))
            or any(b.top < parent.bbox.bottom - 1 for b in boxes)
        ):
            raise ValueError("Header source geometry does not support the proposed coverage")

    unique([(c.before, c.after) for c in plan.continuations])
    fragment_offsets = []
    for link in plan.continuations:
        left, before = get_table(link.before)
        right, after = get_table(link.after)
        if (
            right.number != left.number + 1
            or max(left.tables, key=lambda t: t.bbox.bottom).id != before.id
            or min(right.tables, key=lambda t: t.bbox.top).id != after.id
        ):
            raise ValueError("Continuation must select boundary tables on adjacent source pages")
        if (link.kind == "split_header") != bool(link.fragments):
            raise ValueError("Only split-header proposals require explicit fragment associations")
        unique([f.before for f in link.fragments])
        unique([f.after for f in link.fragments])
        pairs = [(cell(before, f.before), cell(after, f.after)) for f in link.fragments]
        if any(
            a.column >= b.column or c.column >= d.column
            for (a, c), (b, d) in zip(pairs, pairs[1:], strict=False)
        ):
            raise ValueError("Header fragment associations must preserve horizontal order")
        for a, b in pairs:
            # Absolute displayed-page points, same page width. This is a bounded check,
            # not a scale-invariant registration algorithm or an automatic merge rule.
            offset = max(abs(a.bbox.x0 - b.bbox.x0), abs(a.bbox.x1 - b.bbox.x1))
            if abs(left.width - right.width) > 1 or offset > 3:
                raise ValueError(
                    "Split-header columns require source review of misaligned geometry"
                )
            fragment_offsets.append({"before": a.id, "after": b.id, "edge_offset_pt": offset})

    unique([(s.before, s.after) for s in plan.separations])
    for boundary in plan.separations:
        page, before = get_table(boundary.before)
        other_page, after = get_table(boundary.after)
        block = next((b for b in page.blocks if b.id == boundary.block_id), None)
        if (
            page.number != other_page.number
            or block is None
            or block.raw_text.strip() != "OR"
            or not before.bbox.bottom <= block.bbox.top < block.bbox.bottom <= after.bbox.top
        ):
            raise ValueError("Alternative-form boundary requires the literal intervening OR block")
    return plan, artifact, selected, fragment_offsets


def write_structure_review(package: Path, plan_path: Path, output: Path):
    """Write an immutable, read-only source comparison, separate from table drafts."""
    if output.exists():
        raise ValueError("Use a fresh output directory")
    plan, artifact, selected, offsets = validate_structure(package, plan_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".structure-review-", dir=output.parent))
    try:
        shutil.copy2(package / "original.pdf", staging / "original.pdf")
        shutil.copy2(package / "artifact.json", staging / "artifact.json")
        shutil.copy2(plan_path, staging / "plan.json")
        pages = {page.number: page for page, _ in selected.values()}
        rendered = [p for p in artifact.pages if p.render]
        if len(rendered) > 20:
            raise ValueError("Source render inventory exceeds twenty-page review budget")
        for page in rendered:
            target = staging / page.render
            target.parent.mkdir(exist_ok=True)
            shutil.copy2(package / page.render, target)
        copied_plan, _, _, _ = validate_structure(staging, staging / "plan.json")
        if copied_plan != plan:
            raise ValueError("Structure plan changed during packaging")
        report = {
            "proposal": plan.model_dump(),
            "plan_sha256": digest(staging / "plan.json"),
            "code_sha256": {
                name: digest(Path(__file__).with_name(name))
                for name in (
                    "table_structure.py",
                    "table_review.py",
                    "models.py",
                    "runner.py",
                    "benchmark.py",
                )
            },
            "fragment_geometry": offsets,
            "summary": {
                "pages": len(pages),
                "tables": len(selected),
                "source_cells_preserved": sum(len(t.cells) for _, t in selected.values()),
                "header_groups": len(plan.header_groups),
                "continuation_proposals": len(plan.continuations),
                "alternative_boundaries": len(plan.separations),
                "tables_joined": 0,
                "accepted_tables": 0,
            },
            "limits": [
                "Agent source comparison; owner confirmation is pending.",
                "All raw cells, nulls, blanks, text and geometry remain in artifact.json.",
                "Only the listed relationships are proposed; unlisted cells/headers are unreviewed.",
                "Geometry consistency is not transcription or semantic validation.",
                "Shaded form cells need review; no blank, zero or not-applicable value is inferred.",
                "No full-table, page-order, legal, retrieval or publication acceptance.",
            ],
        }
        (staging / "structure-review.json").write_text(json.dumps(report, indent=2) + "\n")
        (staging / "index.html").write_text(render_review(staging, artifact, selected, plan))
        ledger = {
            str(p.relative_to(staging)): digest(p)
            for p in sorted(staging.rglob("*"))
            if p.is_file()
        }
        (staging / "files.json").write_text(json.dumps(ledger, indent=2) + "\n")
        staging.rename(output)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return report


def render_review(root, artifact, selected, plan):
    esc = html.escape

    def panel(table_id, rows=None, context_bottom=None, highlight_ids=()):
        page, table = selected[table_id]
        cells = [c for c in table.cells if rows is None or c.row in rows]
        boxes = [c.bbox for c in cells if c.bbox]
        top, bottom = min(b.top for b in boxes), max(b.bottom for b in boxes)
        if context_bottom is not None:
            bottom = max(bottom, context_bottom)
        name = f"{table_id}-{'all' if rows is None else '-'.join(map(str, rows))}.png"
        with Image.open(root / page.render) as image:
            if image.width * image.height > 16_000_000:
                raise ValueError("Source render exceeds image budget")
            sx, sy = image.width / page.width, image.height / page.height
            box = (
                max(0, round((table.bbox.x0 - 8) * sx)),
                max(0, round((top - 8) * sy)),
                min(image.width, round((table.bbox.x1 + 8) * sx)),
                min(image.height, round((bottom + 8) * sy)),
            )
            image.crop(box).save(root / name)
        rectangles = "".join(
            f'<rect x="{c.bbox.x0 * sx - box[0]}" y="{c.bbox.top * sy - box[1]}" '
            f'width="{(c.bbox.x1 - c.bbox.x0) * sx}" height="{(c.bbox.bottom - c.bbox.top) * sy}"/>'
            for c in cells
            if c.id in highlight_ids and c.bbox
        )
        overlay = (
            f'<svg viewBox="0 0 {box[2] - box[0]} {box[3] - box[1]}" aria-hidden="true">'
            f"{rectangles}</svg>"
        )
        lines = "".join(
            f"<tr><td>{esc(c.id)}</td><td><pre>{esc(c.raw_text) if c.raw_text is not None else '⟦null: unresolved/covered⟧'}</pre></td></tr>"
            for c in cells
        )
        return (
            f"<figure><figcaption>Source page {page.number} · {esc(table.id)} · "
            f"{table.rows} rows × {table.columns} columns · "
            f'<a href="{page.render}">Full page</a></figcaption>'
            f'<a class="source" href="{name}"><img src="{name}" '
            f'alt="Original table crop on source page {page.number}">{overlay}</a>'
            f"<details><summary>Unchanged native cell inventory ({len(cells)} cells)</summary>"
            f"<table><thead><tr><th>Cell</th><th>Raw candidate</th></tr></thead><tbody>{lines}</tbody></table>"
            "</details></figure>"
        )

    sections = []
    if plan.header_groups:
        sections.append(
            '<section id="headers"><h2>1. Shared headings over two smaller columns</h2>'
            "<p>Check the original: each listed heading covers its Amount and Section columns. "
            "The null grid position is proposed as covered by that heading, never as an empty form field.</p>"
        )
        for table_id in dict.fromkeys(g.table_id for g in plan.header_groups):
            highlights = [
                key
                for g in plan.header_groups
                if g.table_id == table_id
                for key in [g.parent, *g.children]
            ]
            sections.append(panel(table_id, highlight_ids=highlights))
        for group in plan.header_groups:
            sections.append(
                f"<p><strong>{esc(group.parent)}</strong> → {esc(', '.join(group.children))}; "
                f"proposed covered slot: {esc(', '.join(group.covered))}.</p>"
            )
        sections.append(
            '<p class="hold">Grey/shaded areas remain visible. Their meaning and fillability are unreviewed.</p></section>'
        )
    for index, link in enumerate(plan.continuations, start=2 if plan.header_groups else 1):
        is_header = link.kind == "split_header"
        title = (
            "A heading continues across the page break"
            if is_header
            else "Rows continue onto the next page"
        )
        sections.append(f'<section id="case-{index}"><h2>{index}. {title}</h2>')
        if is_header:
            before_columns = selected[link.before][1].columns
            after_columns = selected[link.after][1].columns
            sections.append(
                f"<p>The previous page has a {before_columns}-column grid and the next has {after_columns}. "
                "Check the matching heading fragments below; no text or tables have been joined.</p>"
            )
        else:
            sections.append(
                "<p>Check that the next page continues the preceding rows, then ends above "
                "the visible OR. The table below OR starts a separate alternative form.</p>"
            )
        context_bottom = max(
            (
                selected[b.after][1].cells[0].bbox.bottom
                for b in plan.separations
                if b.before == link.after
            ),
            default=None,
        )
        sections.extend(
            [
                panel(
                    link.before,
                    None
                    if is_header
                    else list(
                        range(
                            max(0, selected[link.before][1].rows - 3), selected[link.before][1].rows
                        )
                    ),
                    highlight_ids=[f.before for f in link.fragments],
                ),
                panel(
                    link.after,
                    [0] if is_header else None,
                    context_bottom=context_bottom,
                    highlight_ids=[f.after for f in link.fragments],
                ),
            ]
        )
        for fragment in link.fragments:
            a = next(c for c in selected[link.before][1].cells if c.id == fragment.before)
            b = next(c for c in selected[link.after][1].cells if c.id == fragment.after)
            sections.append(
                f"<details><summary>{esc(a.id)} → {esc(b.id)} (proposed)</summary>"
                f"<pre>{esc(a.raw_text)}</pre><p>Page break — raw fragments remain separate</p>"
                f"<pre>{esc(b.raw_text)}</pre></details>"
            )
        if not is_header:
            for boundary in plan.separations:
                if boundary.before == link.after:
                    page, _ = selected[boundary.before]
                    sections.append(
                        f'<p class="hold">Separate alternatives: {esc(boundary.before)} / '
                        f"{esc(boundary.after)}. Literal OR: {esc(boundary.block_id)}.</p>"
                        f'<a href="{page.render}">View the OR and both alternatives on the full page</a>'
                    )
        sections.append("</section>")
    navigation = ['<a href="#headers">1. Shared headings</a>'] if plan.header_groups else []
    for index, link in enumerate(plan.continuations, start=2 if plan.header_groups else 1):
        label = "Continued rows / OR" if link.kind == "data_rows" else "Split headings"
        navigation.append(f'<a href="#case-{index}">{index}. {label}</a>')
    count = bool(plan.header_groups) + len(plan.continuations)
    return (
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
        "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src 'self'; "
        "style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\">"
        "<title>Table structure — source comparison</title><style>"
        "body{font:17px/1.55 system-ui;background:#f3f6f8;color:#152a38;margin:0 auto;max-width:1250px;padding:24px}"
        "h1{font-size:30px}h2{font-size:24px}a{color:#006854}section{background:white;border:1px solid #cbd7de;"
        "border-radius:12px;padding:24px;margin:28px 0}figure{margin:20px 0}figcaption{font-weight:600;padding:10px 0}"
        "img{display:block;width:100%;height:auto;border:1px solid #cbd7de}.source{display:block;position:relative}"
        "svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}"
        "rect{fill:#ffc857;fill-opacity:.12;stroke:#ac6500;stroke-width:2}pre{white-space:pre-wrap;overflow-wrap:anywhere;"
        "font:14px/1.5 ui-monospace,monospace}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px;"
        "text-align:left;vertical-align:top}details{margin:12px 0;padding:10px;border:1px solid #ddd}"
        ".hold{background:#fff2d5;padding:16px;border-left:4px solid #ac6500}nav{display:flex;flex-wrap:wrap;gap:18px}"
        f"</style><h1>Table structure: {count} source checks</h1>"
        '<p class="hold">Engineering proposal · awaiting your visual check · nothing accepted or published.</p>'
        f"<p>{esc(artifact.source_title)}</p>"
        "<p>Compare the highlighted relationships with the source pages. You do not need tax expertise for these layout checks. "
        "Reply in chat with the section number and any mismatch; this page does not save approvals.</p>"
        "<nav>" + "".join(navigation) + '<a href="original.pdf">Original PDF</a>'
        '<a href="structure-review.json">Proposal / checksums</a><a href="artifact.json">Complete raw extraction</a></nav>'
        + "".join(sections)
        + "<p>All raw cells remain unchanged. Geometry checks do not verify text, grey-cell meaning, "
        "complete headers, tax applicability or a whole table. No chunking or retrieval write occurs.</p></html>"
    )

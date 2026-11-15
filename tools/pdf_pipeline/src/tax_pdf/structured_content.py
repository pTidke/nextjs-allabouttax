"""Source-bound, non-publishing content preview. Does not chunk, index or choose OCR."""

import json
import shutil
import tempfile
import time
from pathlib import Path

from PIL import Image

from .content_classification import apply_region_classification
from .content_models import ContentPage, ContentPreview, ContentRegion, FieldEdit, SourceLine
from .content_scope import (
    crop_pixels,
    overlaps,
    partition_line,
    pixel_box,
    point_box,
    propose_order,
)
from .date_review import audit_dates
from .models import Artifact, Box
from .reference_eval import digest, safe_file


def raw_lines(raw):
    return [
        line
        for block in raw.get("blocks") or []
        for para in block.get("paragraphs") or []
        for line in para.get("lines") or []
    ]


def validate_snapshot(snapshot, rows, evidence_root):
    matches = [r for r in rows if r["id"] == snapshot["input_id"]]
    if len(matches) != 1:
        raise ValueError("Reviewed OCR variant is missing")
    row = matches[0]
    if any(snapshot[k] != row[k] for k in ("engine", "variant", "raw_sha256")):
        raise ValueError("Reviewed OCR identity changed")
    lines = raw_lines(json.loads(safe_file(evidence_root, row["raw"]).read_text()))
    for region in snapshot["regions"]:
        number = region["line_number"]
        if not isinstance(number, int) or not 1 <= number <= len(lines):
            raise ValueError("Reviewed line is missing")
        actual = lines[number - 1]
        if any(region[k] != actual[k] for k in ("text", "bbox", "confidence")):
            raise ValueError("Reviewed text, confidence or source geometry changed")
    return row


def validate_review(review, report, evidence_root):
    """Bind every cited snapshot, including administrative scope and metadata."""
    if review.get("publication_eligible") is not False or not 1 <= len(review["reviews"]) <= 20:
        raise ValueError("Scope review is not a non-publishing draft")
    seen = set()
    for entry in review["reviews"]:
        key = (entry["source_sha256"], entry["page"], entry["source_render_sha256"])
        if key in seen:
            raise ValueError("Duplicate source review")
        seen.add(key)
        matches = [
            r
            for r in report["inputs"]
            if (r["source_sha256"], r["page"], r["source_render_sha256"]) == key
        ]
        if not matches:
            raise ValueError("Scope review belongs to a different source/page/render")
        snapshots = [
            entry[k]
            for k in ("raw_evidence", "header_evidence", "independent_header_evidence")
            if k in entry
        ]
        classification = entry.get("structured_region_review")
        if classification:
            groups = classification["variants"]
            if (
                not 1 <= len(groups) <= 20
                or len({g["input_id"] for g in groups}) != len(groups)
                or any(not 1 <= len(g["decisions"]) <= 100 for g in groups)
            ):
                raise ValueError("Invalid region-classification inventory")
            for group in groups:
                cited = {r["line_number"] for r in group["regions"]}
                if any(d["source_line"] not in cited for d in group["decisions"]):
                    raise ValueError("Classified span lacks a complete raw-line snapshot")
            snapshots += groups
        scope = entry.get("retrieval_scope_draft")
        if scope:
            snapshots += [scope["reference_ocr_regions"], scope["issuer_name_and_designation"]]
            with Image.open(evidence_root / matches[0]["source_image"]) as image:
                if list(image.size) != scope["image_dimensions"]:
                    raise ValueError("Reviewed scope image dimensions changed")
                ids = set()
                for area in scope["source_image_regions"]:
                    b = pixel_box(area["bbox"])
                    if area["id"] in ids or b.x1 > image.width or b.bottom > image.height:
                        raise ValueError("Invalid reviewed exclusion area")
                    ids.add(area["id"])
            mixed = scope["mixed_region"]
            refs = scope["reference_ocr_regions"]["regions"]
            if not any(
                all(mixed[k] == r[k] for k in ("line_number", "text", "bbox")) for r in refs
            ):
                raise ValueError("Mixed-region boundary is not bound to a source line")
        for snapshot in snapshots:
            bound = validate_snapshot(snapshot, report["inputs"], evidence_root)
            if (bound["source_sha256"], bound["page"], bound["source_render_sha256"]) != key:
                raise ValueError("Reviewed snapshot crosses source/page/render")
        correction = entry["field_correction"]
        if correction["field"] != "printed_header_date" or not isinstance(
            correction["reviewed_value"], str
        ):
            raise ValueError("Only explicitly reviewed printed-header dates are supported")
        if not 1 <= len(correction["reviewed_value"]) <= 100:
            raise ValueError("Reviewed field exceeds budget")


def areas_for(entry, size):
    """Areas are page/render-bound by validate_review; never inferred from keywords."""
    if entry is None:
        return []
    areas = []
    for key in ("raw_evidence", "header_evidence", "independent_header_evidence"):
        for region in entry.get(key, {}).get("regions", []):
            areas.append(
                {
                    "id": f"printed-header:{key}:{region['line_number']}",
                    "scope": "metadata",
                    "box": pixel_box(region["bbox"]),
                }
            )
    # Header snapshots may overlap each other; union them into one field area.
    if areas:
        from .content_scope import union

        areas = [
            {
                "id": "reviewed-printed-header-date-area",
                "scope": "metadata",
                "box": union([a["box"] for a in areas]),
            }
        ]
    scope = entry.get("retrieval_scope_draft")
    if scope:
        areas += [
            {"id": a["id"], "scope": "administrative_excluded", "box": pixel_box(a["bbox"])}
            for a in scope["source_image_regions"]
        ]
        # Proposed geometric association only; padding never confirms transcription.
        for r in scope["issuer_name_and_designation"]["regions"]:
            b = pixel_box(r["bbox"])
            areas.append(
                {
                    "id": f"issuer-metadata-line-{r['line_number']}-padding-16px",
                    "scope": "metadata",
                    "box": Box(
                        x0=max(0, b.x0 - 16),
                        top=max(0, b.top - 16),
                        x1=min(size[0], b.x1 + 16),
                        bottom=min(size[1], b.bottom + 16),
                    ),
                }
            )
    return areas


def reviewed_edits(entry, row, lines, review_sha):
    """No correction transfer to an unbound engine/variant, even on the same scan."""
    if entry is None:
        return {}, False
    snapshots = [
        entry[k]
        for k in ("raw_evidence", "header_evidence", "independent_header_evidence")
        if k in entry
    ]
    bound = [
        s for s in snapshots if s["input_id"] == row["id"] and s["raw_sha256"] == row["raw_sha256"]
    ]
    if not bound:
        return {}, False
    field = entry["field_correction"]
    changes = {}
    for region in bound[0]["regions"]:
        text = lines[region["line_number"] - 1]["text"]
        if "raw_token" in field:
            before, after = field["raw_token"], field["reviewed_token"]
            if text.count(before) != 1:
                raise ValueError("Reviewed token is ambiguous")
            start, end = text.index(before), text.index(before) + len(before)
        elif "dated" in text:
            start, end = text.index("dated") + len("dated"), len(text.rstrip())
            before, after = text[start:end], " " + field["reviewed_value"]
            if not before.strip():
                continue  # EasyOCR split prefix, not the date value.
        else:
            start, end = len(text) - len(text.lstrip()), len(text.rstrip())
            before, after = text[start:end], field["reviewed_value"]
        changes[region["line_number"]] = FieldEdit(
            start=start,
            end=end,
            before=before,
            after=after,
            field="printed_header_date",
            review_sha256=review_sha,
        )
    if not changes:
        raise ValueError("Bound header review produces no explicit edit")
    return changes, True


def build_page(row, artifact, raw, entry, review_sha, evidence_root, staging, index, deadline):
    page = next(p for p in artifact.pages if p.number == row["page"])
    lines = raw_lines(raw)
    # audit_dates already validates the page/line/image protocol. Empty OCR cannot
    # masquerade as an empty accepted page, and stays outside this preview contract.
    if not lines:
        raise ValueError("Content preview requires a nonempty raw line inventory")
    original_name = f"originals/{artifact.source_sha256}.pdf"
    original = safe_file(staging, original_name)
    if digest(original) != artifact.source_sha256:
        raise ValueError("Copied original changed")
    if (
        digest(evidence_root / row["raw"]) != row["raw_sha256"]
        or digest(evidence_root / row["source_image"]) != row["source_render_sha256"]
        or digest(staging / "originals" / f"{artifact.source_sha256}-artifact.json")
        != row["artifact_sha256"]
    ):
        raise ValueError("Copied OCR, source render or artifact changed")
    source_name, raw_name = f"evidence/{row['source_image']}", f"evidence/{row['raw']}"
    source_path = evidence_root / row["source_image"]
    with Image.open(source_path) as image:
        size = image.size
        areas = areas_for(entry, size)
        edits, is_bound = reviewed_edits(entry, row, lines, review_sha)
        source_lines, regions = [], []
        for number, line in enumerate(lines, 1):
            if time.monotonic() > deadline:
                raise ValueError("Content preview wall budget exhausted")
            ib = pixel_box(line["bbox"])
            source_lines.append(
                SourceLine(
                    number=number,
                    raw_text=line["text"],
                    image_bbox=ib,
                    bbox=point_box(ib, page, size),
                    confidence=line["confidence"],
                )
            )
            parts = partition_line(line, areas)
            # A field edit must stay on the complete reviewed field line.
            if number in edits:
                parts = [
                    (0, len(line["text"]), ib, "metadata", ["reviewed-printed-header-date-area"])
                ]
            for part, (start, end, box, scope, proof) in enumerate(parts, 1):
                if len(regions) >= 6000:
                    raise ValueError("Content span budget exceeded")
                identity = f"v{index}-l{number}-s{part}"
                b = point_box(box, page, size)
                table_ids = [t.id for t in page.tables if overlaps(b, t.bbox)]
                holds = ["TRANSCRIPTION_UNVERIFIED", "READING_ORDER_UNVERIFIED"]
                if len(parts) > 1 and scope == "content_candidate":
                    scope = "mixed_review"
                    holds.append("REMAINDER_OF_MIXED_SOURCE_LINE")
                if table_ids:
                    scope = "table_review"
                    holds.append("TABLE_STRUCTURE_UNVERIFIED")
                if scope == "mixed_review":
                    holds.append("SCOPE_BOUNDARY_REVIEW")
                if line["confidence"] < 80:
                    holds.append("LOW_OCR_CONFIDENCE")
                crop_name = f"crops/{identity}.png"
                with image.crop(crop_pixels(box, size)) as crop:
                    crop.save(staging / crop_name)
                edit = edits.get(number)
                region_edits = [edit] if edit else []
                reviewed_text = None
                if edit:
                    reviewed_text = (
                        line["text"][: edit.start] + edit.after + line["text"][edit.end :]
                    )
                regions.append(
                    ContentRegion(
                        id=identity,
                        source_line=number,
                        start=start,
                        end=end,
                        raw_text=line["text"][start:end],
                        reviewed_text=reviewed_text,
                        edits=region_edits,
                        image_bbox=box,
                        bbox=b,
                        scope=scope,
                        scope_evidence=[f"{review_sha}:{p}" for p in proof],
                        proposed_order=len(regions) + 1,
                        holds=holds,
                        table_ids=table_ids,
                        crop=crop_name,
                        crop_sha256=digest(staging / crop_name),
                    )
                )
    regions = apply_region_classification(entry, row, regions, review_sha)
    holds = [
        "FULL_PAGE_TEXT_UNVERIFIED",
        "READING_ORDER_UNVERIFIED",
        "TAX_REVIEW_NOT_PERFORMED",
        "CRITICAL_FIELD_COVERAGE_NOT_ESTABLISHED",
    ]
    if entry and not is_bound:
        holds.append("HEADER_CORRECTION_NOT_BOUND_TO_THIS_VARIANT")
    if row["warnings"]:
        holds.append("RAW_DATE_WARNINGS_RETAINED")
    if artifact.expected_pages != 1:
        holds.append("OTHER_DOCUMENT_PAGES_NOT_REPRESENTED")
    if entry and entry.get("remaining_body_date_holds"):
        holds.append("BODY_DATES_UNRESOLVED")
    return ContentPage(
        input_id=row["id"],
        title=row["title"],
        variant=row["variant"],
        page=page.number,
        source_sha256=artifact.source_sha256,
        source_render_sha256=row["source_render_sha256"],
        raw_sha256=row["raw_sha256"],
        expected_pages=artifact.expected_pages,
        unrepresented_pages=[n for n in range(1, artifact.expected_pages + 1) if n != page.number],
        width=page.width,
        height=page.height,
        image_width=size[0],
        image_height=size[1],
        source_image=source_name,
        original=original_name,
        raw=raw_name,
        artifact=f"originals/{artifact.source_sha256}-artifact.json",
        artifact_sha256=row["artifact_sha256"],
        source_lines=source_lines,
        regions=propose_order(regions),
        tables=page.tables,
        reviewed_fields=(
            {"printed_header_date": entry["field_correction"]["reviewed_value"]} if entry else {}
        ),
        warnings=row["warnings"],
        holds=holds,
    )


def prepare_content(manifest_file, date_report, review_file, output):
    if output.exists():
        raise ValueError("Use a fresh structured preview output directory")
    if any(p.stat().st_size > 40 * 1024**2 for p in (manifest_file, date_report, review_file)):
        raise ValueError("Preview input budget exceeded")
    deadline = time.monotonic() + 120
    supplied_sha, review_sha = digest(date_report), digest(review_file)
    review = json.loads(review_file.read_text())
    if review.get("report_sha256") != supplied_sha:
        raise ValueError("Review is bound to a different date report")
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".content-preview-", dir=output.parent))
    try:
        evidence_root = staging / "evidence"
        # Recreate the exact bound report while revalidating originals, render
        # pixels, preprocessing and raw bytes. No OCR/model requests are made.
        report = audit_dates(manifest_file, evidence_root)
        if digest(evidence_root / "date-review.json") != supplied_sha:
            raise ValueError("Date report is stale or source evidence changed")
        validate_review(review, report, evidence_root)
        (staging / "crops").mkdir()
        (staging / "originals").mkdir()
        shutil.copyfile(review_file, staging / "scope-review.json")
        shutil.copyfile(manifest_file, staging / "input-manifest.json")
        pages = []
        for index, row in enumerate(report["inputs"]):
            if row["state"] in ("NOT_ASSESSED", "EMPTY_OCR_NOT_ASSESSED"):
                raise ValueError("Unavailable OCR requires a separate failed-input record")
            artifact_file = safe_file(manifest_file.parent, row["package"] + "/artifact.json")
            if digest(artifact_file) != row["artifact_sha256"]:
                raise ValueError("Source artifact changed during packaging")
            artifact = Artifact.model_validate_json(artifact_file.read_text())
            target = staging / "originals" / f"{artifact.source_sha256}.pdf"
            if not target.exists():
                shutil.copyfile(artifact_file.parent / "original.pdf", target)
            shutil.copyfile(
                artifact_file, staging / "originals" / f"{artifact.source_sha256}-artifact.json"
            )
            raw = json.loads((evidence_root / row["raw"]).read_text())
            entry = next(
                (
                    r
                    for r in review["reviews"]
                    if (r["source_sha256"], r["page"], r["source_render_sha256"])
                    == (row["source_sha256"], row["page"], row["source_render_sha256"])
                ),
                None,
            )
            pages.append(
                build_page(
                    row, artifact, raw, entry, review_sha, evidence_root, staging, index, deadline
                )
            )
        preview = ContentPreview(
            manifest_sha256=digest(manifest_file),
            date_report_sha256=supplied_sha,
            scope_review_sha256=review_sha,
            code_sha256={
                name: digest(Path(__file__).with_name(name))
                for name in (
                    "structured_content.py",
                    "content_models.py",
                    "content_classification.py",
                    "content_scope.py",
                    "content_view.py",
                    "review.py",
                )
            },
            pages=pages,
            comparisons=report["comparisons"],
            notes=[
                "Development preview only: alternative OCR attempts are not independent source documents or an accuracy score.",
                "Every character in each provider line inventory is retained in exactly one source span. Top-level raw OCR remains an unchanged byte copy; this is not proof that OCR captured every mark on the original.",
                "Only exact reviewed header evidence receives explicit edits. Source-reviewed field metadata on other variants does not alter their text. Printed header date is not a legal effective date.",
                "Administrative scope is limited to the reviewed source/page/render areas. Mixed or overlapping boundaries are held, never erased by a Copy keyword.",
                "Issuer association uses source geometry with 16-pixel padding and does not verify its transcription. Unclassified signatures/noise remain held.",
                "Geometric row ordering is a proposal, not verified reading order; columns, tables, superscripts, footnotes and missing text still need evaluation.",
                "Native table candidates retain the original grid, spans, null/blank/zero/dash distinctions and source boxes; no table semantics are approved.",
                "All date warnings and pairwise disagreements remain evidence. A reviewed header does not resolve body dates or certify a whole page.",
                "Explicit source-bound region feedback may classify mixed signature strokes as excluded non-text evidence and printed issuer text as metadata. No signature classifier or global deletion policy is inferred; raw characters, crops and all page-level holds remain preserved.",
                "No chunks, embeddings, index writes, tax approvals or production ingestion changes are produced.",
            ],
        )
        (staging / "content-preview.json").write_text(preview.model_dump_json(indent=2) + "\n")
        from .content_view import write_content_view

        write_content_view(preview, staging)
        if time.monotonic() > deadline:
            raise ValueError("Content preview wall budget exhausted")
        ledger = {
            str(p.relative_to(staging)): digest(p)
            for p in sorted(staging.rglob("*"))
            if p.is_file()
        }
        (staging / "files.json").write_text(json.dumps(ledger, indent=2) + "\n")
        # Recheck caller inputs and their copies before exposing the finished package.
        if (
            digest(staging / "scope-review.json") != review_sha
            or digest(staging / "input-manifest.json") != preview.manifest_sha256
            or digest(date_report) != supplied_sha
            or digest(review_file) != review_sha
            or digest(manifest_file) != preview.manifest_sha256
        ):
            raise ValueError("Input changed during packaging")
        staging.rename(output)
        return preview
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise

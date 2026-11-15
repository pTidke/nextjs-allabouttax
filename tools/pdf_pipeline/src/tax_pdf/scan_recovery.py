"""Image-only recovery trials. Labels are used after OCR, never as prompts/hints."""

import json
import math
import shutil
import tempfile
import time
from pathlib import Path

from PIL import Image, ImageOps

from .models import Box, Page
from .ocr_compare import mapped_lines, run_ocr, verify_models
from .reference_eval import Reference, digest, safe_file, score_text
from .review import escape
from .scan_feedback import bind_feedback


def ink_bands(image):
    """Candidate digit rows from a narrow crop; no expected row count or text."""
    if not 0 < image.width * image.height <= 16_000_000:
        raise ValueError("Segmentation image exceeds pixel budget")
    with image.convert("L") as gray:
        pixels = gray.load()
        active = [
            sum(pixels[x, y] < 180 for x in range(gray.width)) >= max(1, gray.width // 30)
            for y in range(gray.height)
        ]
    groups = []
    for y, value in enumerate(active):
        if value:
            if groups and y - groups[-1][1] <= max(2, image.width // 5):
                groups[-1][1] = y + 1
            else:
                groups.append([y, y + 1])
    minimum_height = max(2, image.width // 10)
    kept = [g for g in groups if g[1] - g[0] >= minimum_height]
    discarded = [g for g in groups if g[1] - g[0] < minimum_height]
    if len(kept) > 20:
        raise ValueError("More than twenty row candidates; keep column unresolved")
    return kept, discarded


def inverse_box(box, width, height, page, ccw):
    if ccw not in (0, 90, 180, 270):
        raise ValueError("Only quarter-turn source transforms are supported")
    original_w, original_h = (height, width) if ccw in (90, 270) else (width, height)
    points = []
    for x in (box["x0"], box["x1"]):
        for y in (box["y0"], box["y1"]):
            if not (0 <= x <= width and 0 <= y <= height):
                raise ValueError("OCR box exceeds recovery image")
            if ccw == 0:
                points.append((x, y))
            elif ccw == 90:
                points.append((original_w - y, x))
            elif ccw == 180:
                points.append((original_w - x, original_h - y))
            else:
                points.append((y, original_h - x))
    return Box(
        x0=min(p[0] for p in points) * page.width / original_w,
        top=min(p[1] for p in points) * page.height / original_h,
        x1=max(p[0] for p in points) * page.width / original_w,
        bottom=max(p[1] for p in points) * page.height / original_h,
    ).model_dump()


def ocr_trial(image, models, output, deadline, language, psm):
    result = {
        "image": image.name,
        "image_sha256": digest(image),
        "languages": language,
        "psm": psm,
        "state": "FAILED",
        "text": "",
        "publication_eligible": False,
    }
    start = time.perf_counter()
    try:
        raw = run_ocr(image, models, output, psm=psm, languages=language, deadline=deadline)
        with Image.open(image) as im:
            if (raw["width"], raw["height"]) != im.size:
                raise ValueError("OCR dimensions differ from recovery image")
        page = Page(number=1, width=raw["width"], height=raw["height"], status="ocr_required")
        mapped_lines(raw, page)  # Validate every provider box and confidence.
        result.update(
            state="EXPERIMENTAL_NOT_ACCEPTED",
            text=raw["text"],
            engine_versions=raw["engine_versions"],
            raw=output.name,
            raw_sha256=digest(output),
        )
    except (ValueError, OSError, TimeoutError):
        result["error"] = "OCR_FAILED_OR_BUDGET_EXHAUSTED"
    result["wall_seconds"] = round(time.perf_counter() - start, 3)
    return result


def recover_scans(report_file, feedback_file, models, reference_file, output):
    if output.exists():
        raise ValueError("Use a fresh recovery output directory")
    source, feedback = bind_feedback(report_file, feedback_file)
    model_sha = verify_models(models)
    reference = Reference.model_validate_json(reference_file.read_text())
    if reference.status != "AUTHORED_SYNTHETIC":
        raise ValueError("Orientation accuracy requires an authored synthetic reference")
    cases = {c["id"]: c for c in source["cases"]}
    columns = [f for f in feedback.findings if f.action == "reconstruct_column"]
    orientations = [f for f in feedback.findings if f.category == "orientation_failure"]
    if len(columns) > 2 or len(orientations) != 1:
        raise ValueError("Recovery permits two explicit columns and one orientation case")
    selected = cases[orientations[0].case_id]
    if (selected["source_sha256"], selected["page"], selected["kind"]) != (
        reference.source_sha256,
        reference.page,
        "synthetic",
    ):
        raise ValueError("Orientation source differs from authored reference")
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".recover-scans-", dir=output.parent))
    deadline = time.monotonic() + 300
    try:
        column_results = []
        for finding in columns:
            if len(finding.regions) != 1:
                raise ValueError("One exact narrow column region is required")
            case = cases[finding.case_id]
            if case["transform"] != "unchanged":
                raise ValueError("Column trial requires unchanged source geometry")
            region = finding.regions[0]
            image = safe_file(report_file.parent, case["image"])
            if digest(image) != case["image_sha256"]:
                raise ValueError("Changed source pixels")
            b = region["image_bbox"]
            with Image.open(image) as page_image:
                left, top = math.floor(b["x0"]), math.floor(b["y0"])
                right, bottom = math.ceil(b["x1"]), math.ceil(b["y1"])
                if not (
                    0 <= left < right <= page_image.width and 0 <= top < bottom <= page_image.height
                ):
                    raise ValueError("Column crop exceeds source image")
                if (bottom - top) / (right - left) < 4 or right - left > 200:
                    raise ValueError("Region is not a narrow column")
                with page_image.crop((left, top, right, bottom)) as crop:
                    crop_name = f"{finding.id}-source.png"
                    crop.save(staging / crop_name)
                    bands, discarded = ink_bands(crop)
                    rows = []
                    for i, (y0, y1) in enumerate(bands):
                        path = staging / f"{finding.id}-row-{i + 1}.png"
                        # White padding and 2x resize aid one-glyph recognition;
                        # segmentation threshold never erases the supplied pixels.
                        with crop.crop((0, y0, crop.width, y1)) as row:
                            padded = ImageOps.expand(row.convert("RGB"), border=16, fill="white")
                            with padded.resize(
                                (padded.width * 2, padded.height * 2), Image.Resampling.LANCZOS
                            ) as scaled:
                                scaled.save(path)
                            padded.close()
                        trial = ocr_trial(
                            path, models, path.with_suffix(".json"), deadline, "eng", 7
                        )
                        trial.update(
                            row_index=i,
                            source_image_bbox={
                                "x0": left,
                                "y0": top + y0,
                                "x1": right,
                                "y1": top + y1,
                            },
                            input_transform={
                                "crop": [left, top + y0, right, top + y1],
                                "white_border_pixels": 16,
                                "resize_factor": 2,
                            },
                        )
                        rows.append(trial)
            # Reviewer values are first read here, after every row OCR job ended.
            observed = [row["text"].strip() for row in rows]
            column_results.append(
                {
                    "finding_id": finding.id,
                    "case_id": case["id"],
                    "source_sha256": case["source_sha256"],
                    "source_image_sha256": case["image_sha256"],
                    "region": region,
                    "crop": crop_name,
                    "crop_sha256": digest(staging / crop_name),
                    "row_candidates": rows,
                    "segmentation_bands": bands,
                    "discarded_short_ink_runs": discarded,
                    "observed": observed,
                    "reviewer_expected_sequence": finding.expected_sequence,
                    "sequence_matches_review": observed == finding.expected_sequence,
                    "state": "EXPERIMENTAL_NOT_ACCEPTED",
                    "publication_eligible": False,
                    "holds": [
                        "ROW_GEOMETRY_AND_LIST_ASSOCIATION_UNVERIFIED",
                        "SEGMENTATION_MAY_MISS_FAINT_MARKS",
                    ],
                }
            )
        orientation_results = []
        image = safe_file(report_file.parent, selected["image"])
        document = next(
            d for d in source["documents"] if d["source_sha256"] == selected["source_sha256"]
        )
        artifact = json.loads(
            safe_file(report_file.parent, document["package"] + "/artifact.json").read_text()
        )
        page = Page.model_validate(
            next(p for p in artifact["pages"] if p["number"] == selected["page"])
        )
        for angle in (0, 90, 180, 270):
            path = staging / f"orientation-{angle}.png"
            with Image.open(image) as im:
                with im.rotate(angle, expand=True) as turned:
                    turned.save(path)
            for language in ("eng", "eng+hin"):
                raw_path = staging / f"orientation-{angle}-{language}.json"
                trial = ocr_trial(path, models, raw_path, deadline, language, 3)
                trial.update(rotation_ccw_from_supplied_image=angle, source_case_id=selected["id"])
                if trial["state"] != "FAILED":
                    raw = json.loads(raw_path.read_text())
                    total_rotation = (
                        angle + (90 if selected["transform"] == "rotated90" else 0)
                    ) % 360
                    trial["source_mapped_lines"] = [
                        {
                            "text": line["text"],
                            "source_bbox": inverse_box(
                                line["bbox"], raw["width"], raw["height"], page, total_rotation
                            ),
                        }
                        for block in raw.get("blocks") or []
                        for paragraph in block.get("paragraphs") or []
                        for line in paragraph.get("lines") or []
                    ]
                # Gold reference is read only after OCR returns, never in worker jobs.
                trial["diagnostic"] = score_text(
                    reference.expected_text, trial["text"], reference.critical_strings
                )
                orientation_results.append(trial)
        report = {
            "state": "EXPERIMENTAL_NOT_ACCEPTED",
            "publication_eligible": False,
            "scan_report_sha256": digest(report_file),
            "feedback_sha256": digest(feedback_file),
            "reference_sha256": digest(reference_file),
            "models_sha256": model_sha,
            "code_sha256": digest(Path(__file__)),
            "worker_sha256": digest(Path(__file__).resolve().parents[2] / "ocr/worker.mjs"),
            "columns": column_results,
            "orientation_attempts": orientation_results,
            "selected_orientation": None,
            "notes": [
                "Image-only local tuning trials. Reviewer values and reference text never enter OCR jobs.",
                "Every quarter-turn and language result is retained. A gold-based best angle is not a deployable orientation detector.",
                "Column rows come from image ink bands, not the expected sequence length; nothing is gap-filled.",
                "No corrected whole-page text, bleed-through mask, retrieval acceptance or production routing is generated.",
            ],
        }
        (staging / "recovery.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n"
        )
        write_recovery_html(report, staging)
        staging.rename(output)
        return report
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def write_recovery_html(report, root):
    columns = []
    for c in report["columns"]:
        rows = "".join(
            f'<li><img src="{escape(r["image"])}" alt="Candidate digit row"> <code>{escape(r["text"].strip() or "[empty]")}</code> · {escape(r["state"])}</li>'
            for r in c["row_candidates"]
        )
        columns.append(
            f'<article><h2>{escape(c["finding_id"])}</h2><p>Observed: {escape(" · ".join(c["observed"]))}</p><p>Reviewer sequence: {escape(" · ".join(c["reviewer_expected_sequence"]))}</p><p>Exact sequence match: {c["sequence_matches_review"]}. Row associations remain unverified.</p><details><summary>Original narrow crop and independently detected rows</summary><img src="{escape(c["crop"])}" alt="Original number column"><ol>{rows}</ol></details></article>'
        )
    attempts = []
    for a in report["orientation_attempts"]:
        d = a["diagnostic"]
        attempts.append(
            f'<tr><td>{a["rotation_ccw_from_supplied_image"]}° · {escape(a["languages"])}</td><td>{d["character_edits"]} / {d["reference_characters"]}</td><td>{escape(a["state"])}</td><td><details><summary>Candidate text and image</summary><a href="{escape(a["image"])}">Input image</a><pre>{escape(a["text"])}</pre></details></td></tr>'
        )
    (root / "index.html").write_text(
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'self\'; style-src \'self\'; base-uri \'none\'; form-action \'none\'"><title>Scan recovery trials</title><link rel="stylesheet" href="report.css"><header><h1>Number-column and orientation recovery</h1><p>Local engineering candidates · publication disabled</p></header><main><p class="notice">No angle is automatically selected. Exact synthetic matches do not establish general orientation detection. Recovered column labels still need their row relationships checked; no missing number is invented.</p><a href="recovery.json">Full raw evidence and diagnostics</a>'
        + "".join(columns)
        + "<h2>All orientation attempts</h2><table><thead><tr><th>Rotation from supplied image / language</th><th>Character edits</th><th>State</th><th>Evidence</th></tr></thead><tbody>"
        + "".join(attempts)
        + "</tbody></table></main></html>"
    )
    (root / "report.css").write_text(
        "body{margin:0;background:#f2f6f7;color:#173344;font:16px/1.6 system-ui}header{background:#102f40;color:white;padding:28px}main{max-width:1300px;margin:auto;padding:24px}article{background:white;border:1px solid #ccdce2;padding:20px;margin:20px 0}a{color:#00755e}.notice{padding:16px;background:#fff0d6}table{width:100%;border-collapse:collapse}td,th{border:1px solid #c8d5dc;padding:12px;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}li img{max-width:150px;vertical-align:middle}summary{cursor:pointer}code{font-size:18px}"
    )

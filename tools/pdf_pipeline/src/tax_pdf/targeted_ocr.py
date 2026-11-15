"""Bounded trials for reviewed digits and uneven scanned-paper backgrounds.

Never merges machine candidates into reference text or accepts a document.
"""

import json
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter, ImageOps

from .models import Box, Page
from .ocr_compare import mapped_lines, run_ocr, verify_models
from .reference_eval import digest, safe_file
from .review import escape
from .scan_feedback import bind_feedback


def numeric_label(text):
    match = re.fullmatch(r"([0-9]{1,3})([.]?)", text.strip())
    if not match:
        return None
    return {"digits": match[1], "delimiter": match[2], "raw": text}


def flatten_background(image):
    """Conservative shading trial, not a foreground/back-side classifier."""
    if not 0 < image.width * image.height <= 16_000_000:
        raise ValueError("Preprocessing pixel budget exceeded")
    gray = ImageOps.grayscale(image)
    reduced = gray.resize(
        (max(1, gray.width // 4), max(1, gray.height // 4)), Image.Resampling.BILINEAR
    )
    background = reduced.filter(ImageFilter.MaxFilter(31)).filter(ImageFilter.GaussianBlur(4))
    enlarged = background.resize(gray.size, Image.Resampling.BILINEAR)
    difference = ImageChops.subtract(enlarged, gray)
    flattened = ImageOps.invert(difference)
    reduced.close()
    background.close()
    enlarged.close()
    gray.close()
    difference.close()
    return flattened


def image_controls(image):
    flat = flatten_background(image)
    # Contrast variants are separate candidates. None is safe to use as an
    # automatic bleed-through mask; faint foreground can also disappear.
    return {
        "grayscale": ImageOps.grayscale(image),
        "flattened": flat,
        "ink-threshold": flat.point(lambda value: 0 if value < 230 else 255),
    }


def trial(image, models, raw_path, *, psm, profile, deadline, frame):
    result = {
        "image": image.name,
        "image_sha256": digest(image),
        "profile": profile,
        "psm": psm,
        "state": "FAILED",
        "text": "",
        "source_lines": [],
        "publication_eligible": False,
    }
    start = time.perf_counter()
    try:
        raw = run_ocr(
            image, models, raw_path, psm=psm, languages="eng", deadline=deadline, profile=profile
        )
        with Image.open(image) as im:
            if (raw.get("width"), raw.get("height")) != im.size:
                raise ValueError("OCR image dimensions differ")
        if not isinstance(raw.get("text"), str) or len(raw["text"]) > 100000:
            raise ValueError("Invalid OCR text payload")
        page = Page(number=1, width=frame["width"], height=frame["height"], status="ocr_required")
        lines = mapped_lines(raw, page)
        for line in lines:
            box = line["bbox"]
            line["bbox"] = Box(
                x0=box["x0"] + frame["x0"],
                top=box["top"] + frame["top"],
                x1=box["x1"] + frame["x0"],
                bottom=box["bottom"] + frame["top"],
            ).model_dump()
        result.update(
            state="EXPERIMENTAL_NOT_ACCEPTED",
            text=raw["text"],
            source_lines=lines,
            engine_versions=raw["engine_versions"],
            raw=raw_path.name,
            raw_sha256=digest(raw_path),
            profile_module_sha256=raw.get("profile_module_sha256"),
            applied_parameters=raw.get("applied_parameters"),
        )
    except (ValueError, OSError, TimeoutError, subprocess.TimeoutExpired):
        result["error"] = "OCR_FAILED_OR_BUDGET_EXHAUSTED"
    result["wall_seconds"] = round(time.perf_counter() - start, 3)
    return result


def foreground_trials(source, report_file, feedback, models, staging, deadline):
    rejected = [
        f
        for f in feedback.findings
        if f.category == "foreground_bleed_through_failure" and f.action == "reject_page"
    ]
    if len(rejected) != 1:
        raise ValueError("Select one explicitly rejected scan page")
    case = next(c for c in source["cases"] if c["id"] == rejected[0].case_id)
    if case["transform"] != "unchanged":
        raise ValueError("Foreground trial requires an unchanged source")
    image = safe_file(report_file.parent, case["image"])
    doc = next(d for d in source["documents"] if d["source_sha256"] == case["source_sha256"])
    artifact = json.loads(
        safe_file(report_file.parent, doc["package"] + "/artifact.json").read_text()
    )
    page = next(p for p in artifact["pages"] if p["number"] == case["page"])
    shutil.copyfile(image, staging / "foreground-source.png")
    attempts = []
    with Image.open(image) as im:
        controls = image_controls(im)
        try:
            for name, derived in controls.items():
                path = staging / f"foreground-{name}.png"
                derived.save(path)
                for psm in (3, 6):
                    result = trial(
                        path,
                        models,
                        staging / f"foreground-{name}-psm{psm}.json",
                        psm=psm,
                        profile="text",
                        deadline=deadline,
                        frame={"x0": 0, "top": 0, "width": page["width"], "height": page["height"]},
                    )
                    result.update(preprocessing=name, scope="full_page")
                    attempts.append(result)
            # Three overlapping source strips preserve their own coordinate maps.
            # No concatenation or deduplication can silently remove content.
            flat = controls["flattened"]
            overlap = min(80, im.height // 20)
            for i in range(3):
                top = max(0, i * im.height // 3 - overlap)
                bottom = min(im.height, (i + 1) * im.height // 3 + overlap)
                path = staging / f"foreground-strip-{i + 1}.png"
                with flat.crop((0, top, im.width, bottom)) as crop:
                    crop.save(path)
                result = trial(
                    path,
                    models,
                    path.with_suffix(".json"),
                    psm=6,
                    profile="text",
                    deadline=deadline,
                    frame={
                        "x0": 0,
                        "top": top * page["height"] / im.height,
                        "width": page["width"],
                        "height": (bottom - top) * page["height"] / im.height,
                    },
                )
                result.update(
                    preprocessing="flattened",
                    scope="overlapping_strip",
                    source_image_crop=[0, top, im.width, bottom],
                )
                attempts.append(result)
        finally:
            for derived in controls.values():
                derived.close()
    for a in attempts:
        # Geometric occupancy only, not foreground recall or text accuracy.
        a["candidate_y_bins"] = sorted(
            {min(7, int(line["bbox"]["top"] * 8 / page["height"])) for line in a["source_lines"]}
        )
        a["line_candidates"] = len(a["source_lines"])
        a["accuracy"] = None
        a["holds"] = [
            "COMPLETE_TRANSCRIPT_UNVERIFIED",
            "FAINT_FOREGROUND_LOSS_UNMEASURED",
            "READING_ORDER_UNVERIFIED",
        ]
    return {
        "case_id": case["id"],
        "source_sha256": case["source_sha256"],
        "source_image_sha256": case["image_sha256"],
        "source_image": "foreground-source.png",
        "attempts": attempts,
        "state": "BLOCKED",
        "selected_variant": None,
        "baseline_variants": [
            {
                "languages": v["languages"],
                "psm": v["psm"],
                "line_candidates": len(v["lines"]),
                "state": v["state"],
            }
            for v in case["variants"]
        ],
    }


def verified_row_pixels(source_image, column_region, old, image):
    transform = old["input_transform"]
    crop = transform["crop"]
    if transform.get("white_border_pixels") != 16 or transform.get("resize_factor") != 2:
        raise ValueError("Unsupported parent row transform")
    if len(crop) != 4 or any(type(v) is not int for v in crop):
        raise ValueError("Invalid source row crop")
    left, top, right, bottom = crop
    b = column_region["image_bbox"]
    if not (
        b["x0"] - 1 <= left < right <= b["x1"] + 1 and b["y0"] - 1 <= top < bottom <= b["y1"] + 1
    ):
        raise ValueError("Row crop exceeds the reviewed number column")
    expected_box = dict(zip(("x0", "y0", "x1", "y1"), crop, strict=True))
    if old["source_image_bbox"] != expected_box:
        raise ValueError("Row provenance box differs from its crop transform")
    with Image.open(source_image) as source, Image.open(image) as supplied:
        if not (0 <= left < right <= source.width and 0 <= top < bottom <= source.height):
            raise ValueError("Row crop exceeds the original page")
        with source.crop(tuple(crop)) as raw, raw.convert("RGB") as rgb:
            with ImageOps.expand(rgb, border=16, fill="white") as padded:
                with (
                    padded.resize(
                        (padded.width * 2, padded.height * 2), Image.Resampling.LANCZOS
                    ) as expected,
                    supplied.convert("RGB") as observed,
                ):
                    if expected.size != observed.size or expected.tobytes() != observed.tobytes():
                        raise ValueError("Row image pixels do not derive from the reviewed page")


def independent_rows(rows, models, staging, identity, deadline):
    if models is None:
        return {"state": "NOT_REQUESTED", "rows": [], "selected": False}
    from .refine_compare import run_probe

    requests = [
        {"id": f"glyph-{i}", "image": str((staging / r["image"]).resolve())}
        for i, r in enumerate(rows)
    ]
    if not 1 <= len(requests) <= 10:
        raise ValueError("Independent comparison permits at most ten rows per column")
    path = staging / f"{identity}-independent.json"
    try:
        remaining = deadline - time.monotonic()
        raw = run_probe(requests, models, path, timeout=min(180, remaining))
        records = {r["id"]: r for r in raw["records"]}
        output = []
        for request in requests:
            record = records[request["id"]]
            with Image.open(request["image"]) as im:
                if (record["width"], record["height"]) != im.size:
                    raise ValueError("Independent OCR image dimensions differ")
            page = Page(
                number=1, width=record["width"], height=record["height"], status="ocr_required"
            )
            mapped_lines(record, page)
            output.append(
                {
                    "id": record["id"],
                    "text": record["text"],
                    "parsed_label": numeric_label(record["text"]),
                    "image_sha256": record["image_sha256"],
                }
            )
        return {
            "state": "EXPERIMENTAL_NOT_ACCEPTED",
            "rows": output,
            "raw": path.name,
            "raw_sha256": digest(path),
            "models_sha256": raw["model_manifest_sha256"],
            "versions": raw["versions"],
            "selected": False,
        }
    except (ValueError, OSError, TimeoutError, subprocess.TimeoutExpired):
        return {
            "state": "FAILED",
            "rows": [{"id": r["id"], "text": "", "parsed_label": None} for r in requests],
            "selected": False,
            "error": "INDEPENDENT_OCR_FAILED_OR_BUDGET_EXHAUSTED",
        }


def targeted_trials(
    report_file, feedback_file, previous_file, models, output, *, easyocr_models=None
):
    if output.exists():
        raise ValueError("Use a fresh targeted-trial output")
    source, feedback = bind_feedback(report_file, feedback_file)
    model_hash = verify_models(models)
    if previous_file.stat().st_size > 20 * 1024**2:
        raise ValueError("Prior recovery report too large")
    previous = json.loads(previous_file.read_text())
    if previous["scan_report_sha256"] != digest(report_file) or previous[
        "feedback_sha256"
    ] != digest(feedback_file):
        raise ValueError("Prior recovery belongs to different source feedback")
    columns = previous["columns"]
    reviewed = {f.id: f for f in feedback.findings if f.action == "reconstruct_column"}
    if {c["finding_id"] for c in columns} != set(reviewed) or len(
        {c["finding_id"] for c in columns}
    ) != len(columns):
        raise ValueError("Parent columns differ from reviewed column inventory")
    for column in columns:
        finding = reviewed[column["finding_id"]]
        case = next(c for c in source["cases"] if c["id"] == finding.case_id)
        if (
            column["case_id"],
            column["source_sha256"],
            column["source_image_sha256"],
            column["region"],
        ) != (finding.case_id, case["source_sha256"], case["image_sha256"], finding.regions[0]):
            raise ValueError("Parent column differs from the exact source region")
    if not 1 <= len(columns) <= 2 or sum(len(c["row_candidates"]) for c in columns) > 40:
        raise ValueError("Column trial budget exceeded")
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".targeted-ocr-", dir=output.parent))
    deadline = time.monotonic() + 300
    try:
        numeric = []
        for column in columns:
            finding = reviewed[column["finding_id"]]
            case = next(c for c in source["cases"] if c["id"] == finding.case_id)
            source_image = safe_file(report_file.parent, case["image"])
            rows = []
            previous_bottom = -1
            for i, old in enumerate(column["row_candidates"]):
                image = safe_file(previous_file.parent, old["image"])
                if digest(image) != old["image_sha256"]:
                    raise ValueError("Changed row pixels")
                baseline_raw = safe_file(previous_file.parent, old["raw"])
                if (
                    baseline_raw.stat().st_size > 20 * 1024**2
                    or digest(baseline_raw) != old["raw_sha256"]
                ):
                    raise ValueError("Changed baseline row OCR")
                if json.loads(baseline_raw.read_text())["text"] != old["text"]:
                    raise ValueError("Baseline row text differs from raw OCR")
                verified_row_pixels(source_image, finding.regions[0], old, image)
                if old["source_image_bbox"]["y0"] < previous_bottom:
                    raise ValueError("Parent row crops overlap or are out of order")
                previous_bottom = old["source_image_bbox"]["y1"]
                path = staging / f"{column['finding_id']}-row-{i + 1}.png"
                shutil.copyfile(image, path)
                with Image.open(path) as im:
                    width, height = im.size
                item = trial(
                    path,
                    models,
                    path.with_suffix(".json"),
                    psm=7,
                    profile="numeric_label",
                    deadline=deadline,
                    frame={"x0": 0, "top": 0, "width": width, "height": height},
                )
                item.update(
                    baseline_text=old["text"],
                    source_image_bbox=old["source_image_bbox"],
                    crop_transform=old["input_transform"],
                    parsed_label=numeric_label(item["text"]),
                    coordinate_frame="padded_row_image_pixels",
                )
                rows.append(item)
            independent = independent_rows(
                rows, easyocr_models, staging, column["finding_id"], deadline
            )
            # Expected values appear only after all row jobs complete.
            if column["reviewer_expected_sequence"] != finding.expected_sequence:
                raise ValueError("Parent expected sequence differs from the reviewer record")
            independent_digits = [
                r["parsed_label"]["digits"] if r["parsed_label"] else None
                for r in independent["rows"]
            ]
            independent["parsed_digits"] = independent_digits
            independent["matches_reviewer_numbers"] = (
                independent["state"] == "EXPERIMENTAL_NOT_ACCEPTED"
                and independent_digits == finding.expected_sequence
            )
            observed = [
                row["parsed_label"]["digits"] if row["parsed_label"] else None for row in rows
            ]
            numeric.append(
                {
                    "case_id": column["case_id"],
                    "finding_id": column["finding_id"],
                    "rows": rows,
                    "source_title": case["title"].split(" : ", 1)[0],
                    "independent_ocr": independent,
                    "parsed_digits": observed,
                    "reviewer_expected_sequence": column["reviewer_expected_sequence"],
                    "matches_reviewer_numbers": observed == column["reviewer_expected_sequence"],
                    "accepted": False,
                    "holds": [
                        "NUMERIC_ALPHABET_CAN_FORCE_WRONG_DIGITS",
                        "LIST_ASSOCIATIONS_UNVERIFIED",
                    ],
                }
            )
        foreground = foreground_trials(source, report_file, feedback, models, staging, deadline)
        result = {
            "state": "EXPERIMENTAL_NOT_ACCEPTED",
            "publication_eligible": False,
            "scan_report_sha256": digest(report_file),
            "feedback_sha256": digest(feedback_file),
            "previous_recovery_sha256": digest(previous_file),
            "models_sha256": model_hash,
            "code_sha256": digest(Path(__file__)),
            "worker_sha256": digest(Path(__file__).resolve().parents[2] / "ocr/worker.mjs"),
            "profiles_sha256": digest(Path(__file__).resolve().parents[2] / "ocr/profiles.mjs"),
            "dependency_sha256": {
                name: digest(Path(__file__).with_name(name))
                for name in ("ocr_compare.py", "refine_compare.py", "easyocr_probe.py")
            },
            "numeric_columns": numeric,
            "foreground": foreground,
            "notes": [
                "The fixed numeric alphabet is a type prior, not an expected answer; missing rows/digits are never filled.",
                "Every raw output and input image is preserved; raw punctuation is separate from parsed digit values.",
                "Background flattening and thresholding are candidate transforms, not validated bleed-through removal.",
                "Independent OCR is kept separate; agreement and a matching sequence do not approve labels or row relationships.",
                "No automatic variant selection, publication, reference approval or RAG update.",
            ],
        }
        (staging / "trials.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        )
        write_html(result, staging)
        staging.rename(output)
        return result
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def write_html(report, root):
    columns = []
    for c in report["numeric_columns"]:
        independent = c["independent_ocr"]
        independent_rows_by_id = {r["id"]: r for r in independent["rows"]}
        rows = "".join(
            f'<tr><td><img src="{escape(r["image"])}" alt="Unchanged padded row crop"></td><td>{escape(r["baseline_text"])}</td><td>{escape(r["text"] or "[empty]")}</td><td>{escape(independent_rows_by_id.get(f"glyph-{i}", {}).get("text", "[not available]"))}</td><td>{escape(r["parsed_label"]["digits"] if r["parsed_label"] else "Unresolved")}</td></tr>'
            for i, r in enumerate(c["rows"])
        )
        columns.append(
            f"<article><h2>{escape(c['source_title'])} — number labels</h2><p>Parsed digits: {escape(' · '.join(v or '?' for v in c['parsed_digits']))}. Match to reviewer numbers: {c['matches_reviewer_numbers']}. Unaccepted; a restricted alphabet can force incorrect digits.</p><p>Independent OCR: {escape(' · '.join(v or '?' for v in independent.get('parsed_digits', [])) or independent['state'])}. Match to reviewer numbers: {independent.get('matches_reviewer_numbers', False)}. No engine is automatically selected.</p><details><summary>Inspect each crop and the separate OCR outputs</summary><table><thead><tr><th>Input crop</th><th>Unrestricted OCR</th><th>Numeric profile OCR</th><th>Independent OCR</th><th>Numeric profile parsed value</th></tr></thead><tbody>{rows}</tbody></table></details></article>"
        )
    foreground = report["foreground"]
    attempts = []
    for i, a in enumerate(foreground["attempts"]):
        attempts.append(
            f'<article id="foreground-{i}"><h3>{escape(a["preprocessing"])} · {escape(a["scope"])} · layout {a["psm"]}</h3><p>{a["line_candidates"]} line candidates · occupied vertical bins {escape(a["candidate_y_bins"])} / 0–7. These counts are not accuracy or recall.</p><div class="compare"><a href="{escape(a["image"])}"><img loading="lazy" src="{escape(a["image"])}" alt="Derived OCR input"></a><pre>{escape(a["text"] or "[No text returned]")}</pre></div></article>'
        )
    (root / "index.html").write_text(
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'self\'; style-src \'self\'; base-uri \'none\'; form-action \'none\'"><title>Targeted OCR recovery</title><link rel="stylesheet" href="report.css"><header><h1>Digit recognition and scanned-paper recovery</h1><p>Separate experimental candidates · publication disabled</p></header><main><p class="notice">Numbers are not completed from sequence. A matching list does not prove its row associations. Contrast and threshold transforms may remove faint foreground text; no processed page is automatically selected or approved.</p><a href="trials.json">Full diagnostics and hashes</a>'
        + "".join(columns)
        + '<h2>Circular 4 page 1: foreground trials</h2><p>Original source image: <a href="foreground-source.png">open unchanged image</a>. All nine attempts, including empty/failed outputs, remain below. Overlapping strips are not merged or deduplicated. Official character/word accuracy remains unmeasured.</p>'
        + "".join(attempts)
        + "</main></html>"
    )
    (root / "report.css").write_text(
        "body{margin:0;color:#183344;background:#f3f6f7;font:16px/1.6 system-ui}header{padding:28px;background:#102f40;color:white}main{max-width:1350px;margin:auto;padding:24px}article{padding:20px;border:1px solid #ccdce2;background:white;margin:22px 0}a{color:#00745d}.notice{padding:16px;background:#fff0d6}.compare{display:grid;grid-template-columns:1fr 1fr;gap:22px}.compare img{width:100%;border:1px solid #ccc}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd8df;padding:10px;text-align:left}td img{max-width:140px}summary{cursor:pointer;font-weight:600}@media(max-width:800px){.compare{grid-template-columns:1fr}main{padding:12px}}"
    )

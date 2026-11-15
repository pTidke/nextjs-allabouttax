"""Bounded scan stress comparison, with raw candidates and no accuracy claim."""

import json
import shutil
import tempfile
import time
from pathlib import Path

from PIL import Image, ImageFilter

from .benchmark import digest
from .corpus import load_sources
from .models import Artifact, Box
from .ocr_compare import mapped_lines, run_ocr, verify_models
from .review import CSS, JS, attrs, escape
from .runner import process


def source_box(box, width, height, page, rotation=0):
    """Inverse of a 90-degree counterclockwise image derivative, in page points."""
    if rotation == 90:
        original_width, original_height = height, width
        values = (original_width - box["y1"], box["x0"], original_width - box["y0"], box["x1"])
    elif rotation == 0:
        original_width, original_height = width, height
        values = (box["x0"], box["y0"], box["x1"], box["y1"])
    else:
        raise ValueError("Unsupported derivative transform")
    return Box(
        x0=values[0] * page.width / original_width,
        top=values[1] * page.height / original_height,
        x1=values[2] * page.width / original_width,
        bottom=values[3] * page.height / original_height,
    )


def scan_benchmark(manifest: Path, models: Path, output: Path):
    if output.exists():
        raise ValueError("Use a fresh scan comparison output")
    sources = list(load_sources(manifest))
    if not 1 <= len(sources) <= 6:
        raise ValueError("Scan comparison permits one to six sources")
    budget = sum(
        len(s.get("pages", [1])) * (3 if s.get("kind") == "synthetic" else 1) for s, _ in sources
    )
    if not 1 <= budget <= 10:
        raise ValueError("At most ten page/derivative cases")
    model_hash = verify_models(models)
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".scans-", dir=output.parent))
    deadline = time.monotonic() + 600
    cases, documents = [], []
    try:
        (staging / "cases").mkdir()
        for source, file in sources:
            selected = source.get("pages", [1])
            if len(selected) != len(set(selected)) or any(
                type(p) is not int or p < 1 for p in selected
            ):
                raise ValueError("Invalid selected scan pages")
            remaining = int(deadline - time.monotonic())
            if remaining <= 0:
                raise TimeoutError("Scan comparison deadline exhausted")
            package = process(
                file,
                staging / "packages",
                title=source["title"],
                dpi=300,
                pages=set(selected),
                max_processed_pages=10,
                total_timeout=min(120, remaining),
            )
            artifact = Artifact.model_validate_json((package / "artifact.json").read_text())
            documents.append(
                {
                    "title": source["title"],
                    "url": source.get("url"),
                    "source_sha256": artifact.source_sha256,
                    "kind": source.get("kind", "official"),
                    "acquisition": source.get("acquisition"),
                    "expected_pages": artifact.expected_pages,
                    "selected_pages": selected,
                    "accounted": artifact.page_accounting_complete,
                    "package": str(package.relative_to(staging)),
                    "artifact_sha256": digest(package / "artifact.json"),
                }
            )
            for page in artifact.pages:
                if page.number not in selected:
                    continue
                transforms = (
                    ["unchanged", "rotated90", "blurred"]
                    if source.get("kind") == "synthetic"
                    else ["unchanged"]
                )
                for transform in transforms:
                    case_id = f"{artifact.source_sha256[:12]}-p{page.number}-{transform}"
                    row = {
                        "id": case_id,
                        "title": source["title"],
                        "source_sha256": artifact.source_sha256,
                        "kind": source.get("kind", "official"),
                        "page": page.number,
                        "transform": transform,
                        "source_render_sha256": page.render_sha256,
                        "native_status": page.status,
                        "native_text": "\n".join(b.raw_text for b in page.blocks),
                        "native_metrics": page.metrics,
                        "variants": [],
                        "state": "BLOCKED",
                        "publication_eligible": False,
                    }
                    if not page.render:
                        row["error"] = "SOURCE_RENDER_UNAVAILABLE"
                        cases.append(row)
                        continue
                    image = staging / "cases" / (case_id + ".png")
                    if transform == "unchanged":
                        shutil.copyfile(package / page.render, image)
                    else:
                        with Image.open(package / page.render) as original:
                            derived = (
                                original.transpose(Image.Transpose.ROTATE_90)
                                if transform == "rotated90"
                                else original.convert("L").filter(ImageFilter.GaussianBlur(1.2))
                            )
                            derived.save(image)
                            derived.close()
                    with Image.open(image) as im:
                        row["width"], row["height"] = im.size
                    row["image"] = str(image.relative_to(staging))
                    row["image_sha256"] = digest(image)
                    jobs = [("eng", 3), ("eng+hin", 3)]
                    for language, psm in jobs:
                        raw_file = image.with_name(
                            case_id + "-" + language.replace("+", "-") + f"-psm{psm}.json"
                        )
                        start = time.perf_counter()
                        variant = {
                            "languages": language,
                            "psm": psm,
                            "state": "FAILED",
                            "lines": [],
                            "quality_issues": [],
                        }
                        try:
                            raw = run_ocr(
                                image,
                                models,
                                raw_file,
                                psm=psm,
                                languages=language,
                                deadline=deadline,
                            )
                            if raw["width"] != row["width"] or raw["height"] != row["height"]:
                                raise ValueError("OCR dimensions do not match the supplied image")
                            lines = mapped_lines(
                                raw, page
                            )  # Also enforces provider shape/confidence/box budgets.
                            raw_lines = [
                                line
                                for b in raw.get("blocks") or []
                                for para in b.get("paragraphs") or []
                                for line in para.get("lines") or []
                            ]
                            for mapped, provider in zip(lines, raw_lines, strict=True):
                                mapped["image_bbox"] = provider["bbox"]
                                mapped["bbox"] = source_box(
                                    provider["bbox"],
                                    raw["width"],
                                    raw["height"],
                                    page,
                                    90 if transform == "rotated90" else 0,
                                ).model_dump()
                            variant.update(
                                state="EXPERIMENTAL_NOT_ACCEPTED",
                                lines=lines,
                                engine_versions=raw["engine_versions"],
                                raw=str(raw_file.relative_to(staging)),
                                raw_sha256=digest(raw_file),
                                text=raw.get("text", ""),
                            )
                            if not lines:
                                variant["quality_issues"].append("OCR_RETURNED_NO_LINES")
                                if psm == 3:
                                    jobs.append((language, 6))
                            if psm == 6:
                                variant["quality_issues"].append("ALTERNATIVE_LAYOUT_UNVERIFIED")
                        except (ValueError, OSError, TimeoutError):
                            variant["error"] = "OCR_FAILED_OR_BUDGET_EXHAUSTED"
                        variant["wall_seconds"] = round(time.perf_counter() - start, 3)
                        row["variants"].append(variant)
                        print(
                            json.dumps(
                                {"case": case_id, "languages": language, "state": variant["state"]}
                            ),
                            flush=True,
                        )
                    cases.append(row)
        report = {
            "schema_version": "0.1.0",
            "state": "BLOCKED",
            "publication_eligible": False,
            "source_manifest_sha256": digest(manifest),
            "model_manifest_sha256": model_hash,
            "worker_sha256": digest(Path(__file__).resolve().parents[2] / "ocr/worker.mjs"),
            "comparison_code_sha256": digest(Path(__file__)),
            "selected_case_count": budget,
            "documents": documents,
            "cases": cases,
            "accuracy": {
                "status": "UNMEASURED_NO_ACCEPTED_LABELS",
                "cer": None,
                "wer": None,
                "table_accuracy": None,
            },
            "notes": [
                "Direct-fetched additions were selected by circular number before this run; legacy listing metadata still creates sampling bias.",
                "The cohort contains scans with embedded OCR and a native control; a separate real image-only cohort remains a gap.",
                "Previously tuned Circular 6 is a tuning/control case, never a held-out score.",
                "Only synthetic inputs receive rotation/blur transforms; originals remain unchanged.",
                "Provider confidence and candidate agreement are not accuracy or acceptance.",
                "Empty default-layout results trigger a separate PSM 6 experiment, never automatic replacement or acceptance.",
                "This bounded run is not a representative completed benchmark or a cost per accepted page.",
            ],
        }
        (staging / "scan-report.json").write_text(json.dumps(report, indent=2) + "\n")
        sections = []
        for c in cases:
            if not c.get("image"):
                sections.append(
                    f'<section class="page"><h2>{escape(c["title"])}</h2><p>Source render unavailable; remains blocked.</p></section>'
                )
                continue
            variants = []
            for v in c["variants"]:
                lines = "".join(
                    f'<button class="block" {attrs(Box(x0=line["image_bbox"]["x0"], top=line["image_bbox"]["y0"], x1=line["image_bbox"]["x1"], bottom=line["image_bbox"]["y1"]), line["id"])}><span class="id">{escape(line["id"])} · confidence {line["confidence"]:.0f}</span>{escape(line["text"])}</button>'
                    for line in v["lines"]
                )
                variants.append(
                    f'<details><summary>{escape(v["languages"])} · layout {v["psm"]} · {escape(v["state"])} · {v["wall_seconds"]:.1f}s</summary><p class="notice">{escape(", ".join(v["quality_issues"]) or "Reading order and text remain unverified")}</p>{lines or "No candidate lines; keep source for further review."}</details>'
                )
            sections.append(
                f'<section class="page" id="{c["id"]}" data-width="{c["width"]}" data-height="{c["height"]}"><h2>{escape(c["title"])} · p{c["page"]} · {c["transform"]}</h2><div class="columns"><div class="source"><img loading="lazy" src="{c["image"]}" alt="{escape(c["kind"])} source/derivative case"><div class="highlight"></div></div><div class="transcript"><p class="selection">Select an OCR line to highlight its image region.</p><p class="notice">Unaccepted candidates. Confidence is an engine signal, not an accuracy score. Source-coordinate inverse transforms are retained in JSON.</p>{"".join(variants)}<details><summary>Native candidate from the unchanged source</summary><pre>{escape(c["native_text"])}</pre></details></div></div></section>'
            )
        (staging / "index.html").write_text(
            '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'self\'; style-src \'self\'; script-src \'self\'; base-uri \'none\'; form-action \'none\'"><link rel="stylesheet" href="review.css"><title>Expanded scan comparison</title><header><span class="badge">BLOCKED · UNACCEPTED</span><h1>Expanded scanned-document comparison</h1><p>Direct-source additions, the existing tuning case and synthetic stress variants. Accuracy remains unmeasured; raw candidates stay separate.</p><a href="scan-report.json">Full experiment record</a></header>'
            + "".join(sections)
            + '<script src="review.js"></script></html>'
        )
        (staging / "review.css").write_text(
            CSS
            + " pre{white-space:pre-wrap}summary{padding:12px;cursor:pointer;font-weight:600}header a{color:#8fe1c5}"
        )
        (staging / "review.js").write_text(JS)
        staging.rename(output)
        return report
    except BaseException:
        shutil.rmtree(staging)
        raise

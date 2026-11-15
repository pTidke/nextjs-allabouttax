"""Fixed public-document transfer pilot. No reference text enters extraction jobs."""

import json
import re
import shutil
import tempfile
import time
from collections import Counter
from pathlib import Path

from PIL import Image

from .corpus import load_sources
from .date_regions import date_evidence
from .date_review import date_findings, date_matches
from .models import Artifact, Box
from .ocr_compare import mapped_lines, run_ocr, verify_models
from .reference_eval import digest
from .refine_compare import run_probe
from .runner import child, process, verify_package

TOKEN = re.compile(
    r"[0-9०-९]+(?:[.,/:-][0-9०-९]+)*(?:%|[A-Za-z]{1,3})?|\b(?:not|unless|except)\b|नहीं",
    re.IGNORECASE,
)


def selected_pages(count):
    if type(count) is not int or not 1 <= count <= 1000:
        raise ValueError("Source page count exceeds the pilot budget")
    return sorted({1, (count + 1) // 2, count}), sorted({1, count})


def critical_inventory(text):
    if not isinstance(text, str) or len(text) > 1000000:
        raise ValueError("Candidate text exceeds inventory budget")
    tokens = TOKEN.findall(text)
    if len(tokens) > 20000:
        raise ValueError("Critical inventory token budget exceeded")
    return dict(sorted(Counter(tokens).items()))


def compare_inventories(candidates):
    """Page-level lexical differences, never token matching/accuracy or a winner."""
    result = []
    for i, left in enumerate(candidates):
        for right in candidates[i + 1 :]:
            if left["state"] == "FAILED" or right["state"] == "FAILED":
                result.append(
                    {
                        "left": left["id"],
                        "right": right["id"],
                        "state": "NOT_COMPARABLE_FAILED_ATTEMPT",
                        "differences": [],
                    }
                )
                continue
            a, b = (critical_inventory(c["text"]) for c in (left, right))
            differences = [
                {"literal": k, "left_count": a.get(k, 0), "right_count": b.get(k, 0)}
                for k in sorted(a.keys() | b.keys())
                if a.get(k, 0) != b.get(k, 0)
            ]
            result.append(
                {
                    "left": left["id"],
                    "right": right["id"],
                    "state": "LITERAL_INVENTORY_DIFFERS"
                    if differences
                    else "SURFACE_INVENTORY_AGREEMENT_NOT_VERIFIED",
                    "differences": differences,
                    "selected_candidate": None,
                }
            )
    return result


def native_candidate(page, size):
    lines = []
    warnings = []
    for block in sorted(page.blocks, key=lambda b: b.order):
        box = block.bbox
        lines.append(
            {
                "id": block.id,
                "text": block.raw_text,
                "bbox": box.model_dump(),
                "image_bbox": {
                    "x0": box.x0 * size[0] / page.width,
                    "top": box.top * size[1] / page.height,
                    "x1": box.x1 * size[0] / page.width,
                    "bottom": box.bottom * size[1] / page.height,
                },
                "confidence": None,
            }
        )
        if len(block.raw_text) <= 20000:
            warnings += [{"line_id": block.id, **w} for w in date_findings(block.raw_text)]
    return {
        "id": "native",
        "engine": "native",
        "state": "UNVERIFIED_CANDIDATE",
        "text": "\n".join(line["text"] for line in lines),
        "lines": lines,
        "date_warnings": warnings,
        "table_candidates": [t.model_dump() for t in page.tables],
        "holds": [
            "TRANSCRIPTION_UNVERIFIED",
            "READING_ORDER_UNVERIFIED",
            "TABLE_RELATIONSHIPS_UNVERIFIED",
        ],
        "claims_clean": False,
        "publication_eligible": False,
    }


def ocr_candidate(raw, page, identity, *, size, source_sha):
    if (raw.get("width"), raw.get("height")) != size or raw.get("image_sha256") != source_sha:
        raise ValueError("OCR geometry/pixels differ from the original page")
    mapped = mapped_lines(raw, page)
    providers = [
        line
        for b in raw.get("blocks") or []
        for p in b.get("paragraphs") or []
        for line in p.get("lines") or []
    ]
    for line, provider in zip(mapped, providers, strict=True):
        b = provider["bbox"]
        line["image_bbox"] = Box(x0=b["x0"], top=b["y0"], x1=b["x1"], bottom=b["y1"]).model_dump()
    return {
        "id": identity,
        "engine": "EasyOCR" if raw.get("provider_regions") is not None else "Tesseract.js",
        "state": "UNVERIFIED_CANDIDATE",
        "text": raw.get("text", ""),
        "lines": mapped,
        "date_warnings": [d for d in date_evidence(raw, page) if d["codes"]],
        "table_candidates": None,
        "holds": [
            "TRANSCRIPTION_UNVERIFIED",
            "READING_ORDER_UNVERIFIED",
            "OCR_TABLE_STRUCTURE_NOT_EXTRACTED",
        ],
        "claims_clean": False,
        "publication_eligible": False,
    }


def checked_inputs(manifest_file, plan_file, prior_file):
    plan = json.loads(plan_file.read_text())
    manifest = json.loads(manifest_file.read_text())
    prior = json.loads(prior_file.read_text())
    slots = plan["documents"]
    ids = [s["id"] for s in slots]
    if (
        not 1 <= len(ids) <= 6
        or len(ids) != len(set(ids))
        or any(not re.fullmatch(r"[a-z0-9-]{1,80}", x) for x in ids)
    ):
        raise ValueError("Invalid frozen source inventory")
    if (
        plan.get("state") != "FROZEN_BEFORE_LOCAL_ACQUISITION_AND_EXTRACTION"
        or plan.get("publication_eligible") is not False
    ):
        raise ValueError("Use an explicit non-publishing frozen plan")
    if manifest.get("plan_sha256") != digest(plan_file):
        raise ValueError("Source acquisition is not bound to this plan")
    attempts = manifest["attempts"]
    if set(a["id"] for a in attempts) != set(ids) or any(
        a["state"] not in ("ACQUIRED", "FAILED") for a in attempts
    ):
        raise ValueError("All planned acquisition slots must remain accounted")
    settings = {
        "languages": ["eng", "eng+hin"],
        "psm": 3,
        "preprocessing": "unchanged",
        "empty_output_fallback_psm": 6,
    }
    if plan.get("ocr_settings") != settings:
        raise ValueError("Frozen OCR settings do not match this pilot runner")
    sources = list(load_sources(manifest_file))
    if len({s["id"] for s, _ in sources}) != len(sources) or len(
        {s["sha256"] for s, _ in sources}
    ) != len(sources):
        raise ValueError("Duplicate acquired source")
    if sum(f.stat().st_size for _, f in sources) > 80 * 1024**2:
        raise ValueError("Source cohort exceeds total byte budget")
    for source, file in sources:
        if (
            source["id"] not in ids
            or source["sha256"] in prior["source_sha256"]
            or file.stat().st_size > 25 * 1024**2
        ):
            raise ValueError("Source is unplanned, reused or exceeds byte budget")
        latest = next(a for a in reversed(attempts) if a["id"] == source["id"])
        if latest["state"] != "ACQUIRED" or latest["sha256"] != source["sha256"]:
            raise ValueError("Acquisition and source identities differ")
    if {a["id"] for a in attempts if a["state"] == "ACQUIRED"} != {s["id"] for s, _ in sources}:
        raise ValueError("Acquired source is missing from the manifest")
    return plan, manifest, {s["id"]: (s, f) for s, f in sources}


def run_transfer(manifest_file, plan_file, prior_file, models, easy_models, output):
    if output.exists():
        raise ValueError("Use a fresh transfer evaluation output")
    plan, manifest, sources = checked_inputs(manifest_file, plan_file, prior_file)
    hashes = {
        "plan": digest(plan_file),
        "manifest": digest(manifest_file),
        "prior": digest(prior_file),
    }
    model_hash = verify_models(models)
    from .easyocr_probe import verify_models as verify_easy

    easy_hash = verify_easy(easy_models)
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".transfer-", dir=output.parent))
    deadline = time.monotonic() + 900
    began = time.monotonic()
    try:
        (staging / "raw").mkdir()
        (staging / "inputs").mkdir()
        for file, name in (
            (manifest_file, "sources.json"),
            (plan_file, "plan.json"),
            (prior_file, "prior.json"),
        ):
            shutil.copyfile(file, staging / "inputs" / name)
        report = {
            "schema_version": "0.1.0",
            "state": "TRANSFER_PILOT_UNVERIFIED",
            "publication_eligible": False,
            "input_sha256": hashes,
            "tesseract_models_sha256": model_hash,
            "easyocr_models_sha256": easy_hash,
            "code_sha256": {
                n: digest(Path(__file__).with_name(n))
                for n in (
                    "transfer_evaluation.py",
                    "transfer_view.py",
                    "runner.py",
                    "worker.py",
                    "ocr_compare.py",
                    "date_regions.py",
                    "date_spatial.py",
                    "date_review.py",
                    "refine_compare.py",
                    "easyocr_probe.py",
                )
            },
            "plan": plan,
            "acquisition_attempts": manifest["attempts"],
            "documents": [],
            "accuracy": {
                "status": "UNMEASURED_NO_VERIFIED_COHORT_REFERENCES",
                "cer": None,
                "wer": None,
                "critical_field_accuracy": None,
                "table_relationship_accuracy": None,
                "false_clean_rate": None,
            },
            "verified_references": 0,
            "accepted_extractions": 0,
            "selected_engine": None,
            "notes": [
                "Documents are new to the recorded local source corpus; discovery snippets were seen and related families remain related. This is neither blind nor representative final evaluation.",
                "All extraction settings and source identifiers were frozen before local extraction. Failure slots and unprocessed original pages remain visible.",
                "Native runs select first/middle/last; OCR selects first/last; independent English OCR selects first only. These have different page denominators.",
                "Critical inventories compare literal numeric/ordinal/negation token counts on a whole page. Segmentation, formatting and noise can differ without a factual error. Agreement can hide an identical wrong reading; no token alignment or accuracy is established.",
                "English named-month date warnings do not cover all Hindi/numeric dates, amounts, rates, names, footnotes, legal applicability or omissions. Every page remains held regardless of warning count.",
                "Native table grids remain unverified. Plain OCR text supplies no table relationships. Neither is a verified structured-table result.",
                "Source-first spot checks contain no gold transcript or approval. Tax relevance and effective periods need separate qualified review.",
                "Uses only existing local OCR weights and bounded public PDFs. No model API, chunking, embeddings, database or production publication path. Reduced worker environments are not an OS sandbox.",
            ],
        }
        for slot in plan["documents"]:
            doc = {
                **slot,
                "state": "ACQUISITION_FAILED",
                "cases": [],
                "publication_eligible": False,
            }
            report["documents"].append(doc)
            if slot["id"] not in sources:
                continue
            source, file = sources[slot["id"]]
            doc.update(source_sha256=source["sha256"], url=source["url"])
            try:
                remaining = int(deadline - time.monotonic())
                if remaining <= 0:
                    raise TimeoutError("Pilot deadline")
                info = child("preflight", file, timeout=min(30, remaining))
                selected, ocr_pages = selected_pages(info.get("expected_pages"))
                doc.update(
                    expected_pages=info["expected_pages"],
                    native_selected=selected,
                    ocr_selected=ocr_pages,
                    unselected_pages=[
                        p for p in range(1, info["expected_pages"] + 1) if p not in selected
                    ],
                )
                package = process(
                    file,
                    staging / "packages",
                    title=slot["title"],
                    dpi=300,
                    pages=set(selected),
                    total_timeout=min(150, max(1, int(deadline - time.monotonic()))),
                    max_processed_pages=3,
                )
                artifact_file = package / "artifact.json"
                artifact = Artifact.model_validate_json(artifact_file.read_text())
                verified = verify_package(artifact.model_copy(deep=True), package)
                if (
                    artifact.source_sha256 != source["sha256"]
                    or artifact.expected_pages != info["expected_pages"]
                ):
                    raise ValueError("Source changed after cohort validation")
                if not verified.page_accounting_complete or any(
                    i.code.endswith("CHECKSUM_MISMATCH") or i.code == "RENDER_MISSING"
                    for i in verified.issues
                ):
                    raise ValueError("Source package integrity failed")
                doc.update(
                    state="UNVERIFIED_CANDIDATES",
                    package=str(package.relative_to(staging)),
                    artifact_sha256=digest(artifact_file),
                    page_accounting_complete=True,
                )
                for page in artifact.pages:
                    if page.number not in selected:
                        continue
                    case = {
                        "page": page.number,
                        "state": "RENDER_FAILED",
                        "candidates": [],
                        "publication_eligible": False,
                        "width": page.width,
                        "height": page.height,
                        "native_status": page.status,
                        "native_metrics": page.metrics,
                        "source_render_sha256": page.render_sha256,
                        "native_issues": [i.model_dump() for i in page.issues],
                    }
                    doc["cases"].append(case)
                    if not page.render:
                        continue
                    image = package / page.render
                    with Image.open(image) as im:
                        size = im.size
                    case.update(
                        state="UNVERIFIED_CANDIDATES",
                        source_image=str(image.relative_to(staging)),
                        image_width=size[0],
                        image_height=size[1],
                    )
                    case["candidates"].append(native_candidate(page, size))
                    if page.number in ocr_pages:
                        jobs = [("eng", 3), ("eng+hin", 3)]
                        for language, psm in jobs:
                            identity = f"tesseract-{language}-psm{psm}"
                            path = staging / "raw" / f"{slot['id']}-p{page.number}-{identity}.json"
                            candidate = {
                                "id": identity,
                                "engine": "Tesseract.js",
                                "state": "FAILED",
                                "text": "",
                                "lines": [],
                                "publication_eligible": False,
                                "claims_clean": False,
                                "psm": psm,
                                "languages": language.split("+"),
                            }
                            try:
                                raw = run_ocr(
                                    image,
                                    models,
                                    path,
                                    psm=psm,
                                    languages=language,
                                    deadline=deadline,
                                )
                                candidate.update(
                                    ocr_candidate(
                                        raw,
                                        page,
                                        identity,
                                        size=size,
                                        source_sha=page.render_sha256,
                                    ),
                                    raw=str(path.relative_to(staging)),
                                    raw_sha256=digest(path),
                                )
                                if not candidate["lines"] and psm == 3:
                                    jobs.append((language, 6))
                            except (ValueError, OSError, TimeoutError):
                                candidate["error"] = "OCR_FAILED_OR_BUDGET_EXHAUSTED"
                                if path.is_file() and path.stat().st_size <= 20 * 1024**2:
                                    candidate.update(
                                        raw=str(path.relative_to(staging)), raw_sha256=digest(path)
                                    )
                            case["candidates"].append(candidate)
                            print(
                                json.dumps(
                                    {
                                        "source": slot["id"],
                                        "page": page.number,
                                        "attempt": identity,
                                        "state": candidate["state"],
                                    }
                                ),
                                flush=True,
                            )
                    if page.number == 1:
                        identity = "easyocr-eng"
                        path = staging / "raw" / f"{slot['id']}-easyocr.json"
                        candidate = {
                            "id": identity,
                            "engine": "EasyOCR",
                            "state": "FAILED",
                            "text": "",
                            "lines": [],
                            "publication_eligible": False,
                            "claims_clean": False,
                        }
                        try:
                            remaining = deadline - time.monotonic()
                            if remaining <= 0:
                                raise TimeoutError("Pilot deadline")
                            result = run_probe(
                                [{"id": slot["id"], "image": str(image.resolve())}],
                                easy_models,
                                path,
                                timeout=min(90, remaining),
                            )
                            raw = result["records"][0]
                            candidate.update(
                                ocr_candidate(
                                    raw, page, identity, size=size, source_sha=page.render_sha256
                                ),
                                raw=str(path.relative_to(staging)),
                                raw_sha256=digest(path),
                                record_id=slot["id"],
                            )
                        except (ValueError, OSError, TimeoutError):
                            candidate["error"] = "INDEPENDENT_OCR_FAILED_OR_BUDGET_EXHAUSTED"
                            if path.is_file() and path.stat().st_size <= 20 * 1024**2:
                                candidate.update(
                                    raw=str(path.relative_to(staging)), raw_sha256=digest(path)
                                )
                        case["candidates"].append(candidate)
                    case["comparisons"] = compare_inventories(case["candidates"])
            except (ValueError, OSError, TimeoutError):
                doc["state"] = "PROCESSING_FAILED_OR_BUDGET_EXHAUSTED"
            print(
                json.dumps(
                    {
                        "source": slot["id"],
                        "state": doc["state"],
                        "selected_cases": len(doc["cases"]),
                    }
                ),
                flush=True,
            )
        if verify_models(models) != model_hash or verify_easy(easy_models) != easy_hash:
            raise ValueError("Frozen OCR weights changed during evaluation")
        report["source_checks"] = make_source_checks(report, staging)
        report["elapsed_seconds"] = round(time.monotonic() - began, 2)
        report["summary"] = summarize_transfer(report)
        (staging / "report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n"
        )
        from .transfer_view import write_transfer_view

        write_transfer_view(report, staging)
        (staging / "files.json").write_text(
            json.dumps(
                {
                    str(p.relative_to(staging)): digest(p)
                    for p in sorted(staging.rglob("*"))
                    if p.is_file()
                },
                indent=2,
            )
            + "\n"
        )
        if hashes != {
            "plan": digest(plan_file),
            "manifest": digest(manifest_file),
            "prior": digest(prior_file),
        }:
            raise ValueError("Pilot inputs changed during extraction")
        if any(
            digest(Path(__file__).with_name(n)) != sha for n, sha in report["code_sha256"].items()
        ):
            raise ValueError("Pilot code changed during evaluation")
        staging.rename(output)
        return report
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def summarize_transfer(report):
    docs = report["documents"]
    cases = [c for d in docs for c in d["cases"]]
    attempts = [a for c in cases for a in c["candidates"]]
    return {
        "planned_sources": len(docs),
        "acquired_sources": sum("source_sha256" in d for d in docs),
        "failed_acquisition_slots": sum(d["state"] == "ACQUISITION_FAILED" for d in docs),
        "failed_processing_sources": sum(
            d["state"] == "PROCESSING_FAILED_OR_BUDGET_EXHAUSTED" for d in docs
        ),
        "original_pages": sum(d.get("expected_pages", 0) for d in docs),
        "selected_native_pages": sum(len(d.get("native_selected", [])) for d in docs),
        "rendered_selected_pages": sum("source_image" in c for c in cases),
        "selected_ocr_pages": sum(len(d.get("ocr_selected", [])) for d in docs),
        "candidate_attempts": len(attempts),
        "failed_attempts": sum(a["state"] == "FAILED" for a in attempts),
        "empty_nonfailed_attempts": sum(
            a["state"] != "FAILED" and not a["text"].strip() for a in attempts
        ),
        "native_table_candidates": sum(len(a.get("table_candidates") or []) for a in attempts),
        "date_warning_count": sum(len(a.get("date_warnings", [])) for a in attempts),
        "literal_inventory_disagreements": sum(
            p["state"] == "LITERAL_INVENTORY_DIFFERS"
            for c in cases
            for p in c.get("comparisons", [])
        ),
        "zero_native_glyph_pages_with_images": sum(
            c["native_metrics"].get("characters", 0) == 0
            and c["native_metrics"].get("image_regions", 0) > 0
            for c in cases
        ),
        "verified_reference_pages": 0,
        "accepted_extractions": 0,
        "publication_eligible": False,
    }


def make_source_checks(report, root):
    """Bounded geometry-selected source crops; machine text is never a reference."""
    (root / "source-checks").mkdir()
    checks = []
    choices = []
    for doc in report["documents"]:
        usable = [c for c in doc["cases"] if c.get("source_image")]
        if not usable:
            continue
        choices.extend(
            [
                (0, doc, usable[0], (0.04, 0.05, 0.96, 0.38), "Header / identifier / printed date"),
                (
                    1,
                    doc,
                    usable[len(usable) // 2],
                    (0.04, 0.20, 0.96, 0.53),
                    "Body / table relationships / conditions",
                ),
            ]
        )
    # Cover each acquired document before adding a second crop, at most six.
    for index, doc, case, area, focus in sorted(choices, key=lambda c: c[0])[:6]:
        identity = f"{doc['id']}-{index + 1}"
        image = root / case["source_image"]
        with Image.open(image) as source:
            pixels = [
                round(area[0] * source.width),
                round(area[1] * source.height),
                round(area[2] * source.width),
                round(area[3] * source.height),
            ]
            native = case["candidates"][0]
            if index == 0:
                hints = [
                    line
                    for line in native["lines"]
                    if len(line["text"]) <= 20000
                    and (date_findings(line["text"]) or list(date_matches(line["text"])))
                ]
                if hints:
                    b = Box.model_validate(hints[0]["image_bbox"])
                    pixels = [
                        max(0, int(b.x0) - 20),
                        max(0, int(b.top) - 20),
                        min(source.width, int(b.x1) + 20),
                        min(source.height, int(b.bottom) + 20),
                    ]
                    focus = "Printed date candidate: read the original; machine geometry supplies no reference text"
            elif native.get("table_candidates"):
                b = Box.model_validate(native["table_candidates"][0]["bbox"])
                pixels = [
                    max(0, int(b.x0 * source.width / case["width"]) - 8),
                    max(0, int(b.top * source.height / case["height"]) - 8),
                    min(source.width, int(b.x1 * source.width / case["width"]) + 8),
                    min(
                        source.height,
                        int(min(b.bottom, b.top + 180) * source.height / case["height"]) + 8,
                    ),
                ]
                focus = (
                    "Partial table window: compare row/column associations against the full source"
                )
            path = root / "source-checks" / f"{identity}.png"
            with source.crop(pixels) as crop:
                crop.save(path)
        checks.append(
            {
                "id": identity,
                "source_id": doc["id"],
                "title": doc["title"],
                "source_sha256": doc["source_sha256"],
                "page": case["page"],
                "source_image": case["source_image"],
                "source_render_sha256": case["source_render_sha256"],
                "crop": str(path.relative_to(root)),
                "crop_sha256": digest(path),
                "crop_pixels": pixels,
                "focus": focus,
                "status": "UNLABELLED_SOURCE_CHECK",
                "expected_text": None,
                "critical_fields": [],
                "reviewer": None,
                "whole_page_verified": False,
                "publication_eligible": False,
            }
        )
    return checks

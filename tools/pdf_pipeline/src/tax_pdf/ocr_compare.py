"""Bounded local image OCR comparison. Reviewer proposals never enter OCR jobs.

This is a tuning experiment, not a canonical extraction or accepted benchmark.
"""

import argparse
import hashlib
import importlib.metadata
import json
import math
import os
import shutil
import subprocess
import tempfile
import time
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

from PIL import Image

from .models import Artifact, Box, Page
from .runner import child, verify_package

REVISION = "87416418657359cb625c412a48b6e1d6d41c29bd"
WEIGHTS = {
    "eng": "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2",
    "hin": "4c73ffc59d497c186b19d1e90f5d721d678ea6b2e277b719bee4e2af12271825",
}


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def prepare_models(root: Path):
    """Download pinned public weights only; never upload a document."""
    root.mkdir(parents=True, exist_ok=True)
    files = {}
    for language, expected in WEIGHTS.items():
        name = f"{language}.traineddata"
        url = f"https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/{REVISION}/{name}"
        target = root / name
        if not target.exists():
            with urllib.request.urlopen(url, timeout=60) as response:
                data = response.read(20 * 1024**2 + 1)
            if len(data) > 20 * 1024**2 or hashlib.sha256(data).hexdigest() != expected:
                raise ValueError("Downloaded weights do not match pinned revision")
            target.write_bytes(data)
        if target.is_symlink() or digest(target) != expected:
            raise ValueError("Existing weights differ from pinned revision")
        files[name] = {"sha256": expected, "bytes": target.stat().st_size, "url": url}
    manifest = {"repository": "tesseract-ocr/tessdata_fast", "revision": REVISION, "files": files}
    (root / "weights-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def verify_models(root):
    manifest = json.loads((root / "weights-manifest.json").read_text())
    if manifest.get("revision") != REVISION:
        raise ValueError("Unknown model revision")
    for language, expected in WEIGHTS.items():
        name = f"{language}.traineddata"
        file = root / name
        if file.is_symlink() or digest(file) != expected:
            raise ValueError("OCR weights changed")
        if manifest["files"][name]["sha256"] != expected:
            raise ValueError("Model manifest changed")
    return digest(root / "weights-manifest.json")


def bind_feedback(artifact: Artifact, artifact_path: Path, feedback: dict):
    """Only the exact immutable artifact revision can supply source regions."""
    if (
        feedback.get("source_sha256") != artifact.source_sha256
        or feedback.get("run_id") != artifact.run_id
        or feedback.get("artifact_sha256") != digest(artifact_path)
        or feedback.get("processing_fingerprint") != artifact.fingerprint
    ):
        raise ValueError("Feedback belongs to a different source/extraction revision")
    blocks = {b.id: b for p in artifact.pages for b in p.blocks}
    seen = set()
    findings = feedback.get("findings", [])
    if not 1 <= len(findings) <= 32:
        raise ValueError("Comparison requires 1–32 explicit region findings")
    for finding in findings:
        ids = finding.get("region_ids", [])
        if not ids or len(ids) > 32 or len(ids) != len(set(ids)):
            raise ValueError("Invalid reported region group")
        supplied = {r["id"]: r for r in finding["regions"]}
        if set(supplied) != set(ids) or len(supplied) != len(finding["regions"]):
            raise ValueError("Reported region geometry is incomplete")
        for region in ids:
            if region not in blocks or region in seen:
                raise ValueError("Unknown or duplicate reviewed region")
            if (
                Box(**supplied[region]["bbox"]) != blocks[region].bbox
                or supplied[region]["extracted_text"] != blocks[region].raw_text
            ):
                raise ValueError("Reported geometry/text does not match original artifact")
            seen.add(region)
        pages = {int(region.split("-")[0][1:]) for region in ids}
        if len(pages) != 1:
            raise ValueError("Region groups must belong to one source page")
    return findings


def crop_box(page: Page, regions, image_size, padding=6):
    """Return actual pixel crop and its source-point region; no guessed text."""
    selected = [b.bbox for b in page.blocks if b.id in regions]
    if len(selected) != len(regions):
        raise ValueError("Missing region geometry")
    w, h = image_size
    left = max(0, math.floor((min(b.x0 for b in selected) - padding) * w / page.width))
    top = max(0, math.floor((min(b.top for b in selected) - padding) * h / page.height))
    right = min(w, math.ceil((max(b.x1 for b in selected) + padding) * w / page.width))
    bottom = min(h, math.ceil((max(b.bottom for b in selected) + padding) * h / page.height))
    if right <= left or bottom <= top:
        raise ValueError("Empty crop")
    return (left, top, right, bottom), Box(
        x0=left * page.width / w,
        top=top * page.height / h,
        x1=right * page.width / w,
        bottom=bottom * page.height / h,
    )


def spatial_groups(page: Page, regions, gap=12):
    """Do not join disconnected source areas into a misleading large OCR crop."""
    boxes = {b.id: b.bbox for b in page.blocks if b.id in regions}
    if set(boxes) != set(regions):
        raise ValueError("Missing region geometry")
    remaining = list(regions)
    groups = []
    while remaining:
        group = [remaining.pop(0)]
        changed = True
        while changed:
            changed = False
            for candidate in remaining[:]:
                a = boxes[candidate]
                if any(
                    max(a.x0 - boxes[r].x1, boxes[r].x0 - a.x1, 0) <= gap
                    and max(a.top - boxes[r].bottom, boxes[r].top - a.bottom, 0) <= gap
                    for r in group
                ):
                    group.append(candidate)
                    remaining.remove(candidate)
                    changed = True
        groups.append(group)
    return groups


def mapped_lines(raw, page: Page):
    """Map OCR pixel boxes to the displayed source page without changing order."""
    w, h = raw["width"], raw["height"]
    if not 0 < w * h <= 16_000_000:
        raise ValueError("Invalid OCR image dimensions")
    lines = []
    for block in raw.get("blocks") or []:
        for para in block.get("paragraphs") or []:
            for line in para.get("lines") or []:
                b = line["bbox"]
                if not (0 <= b["x0"] < b["x1"] <= w and 0 <= b["y0"] < b["y1"] <= h):
                    raise ValueError("OCR box exceeds source image")
                confidence = float(line["confidence"])
                if not math.isfinite(confidence) or not 0 <= confidence <= 100:
                    raise ValueError("Invalid OCR confidence")
                lines.append(
                    {
                        "id": f"p{page.number}-ocr-{'-'.join(raw.get('languages', ['unknown']))}-{len(lines) + 1}",
                        "text": line["text"],
                        "confidence": confidence,
                        "low_confidence": confidence < 80,
                        "bbox": Box(
                            x0=b["x0"] * page.width / w,
                            top=b["y0"] * page.height / h,
                            x1=b["x1"] * page.width / w,
                            bottom=b["y1"] * page.height / h,
                        ).model_dump(),
                        "order_verified": False,
                    }
                )
                if len(lines) > 2000:
                    raise ValueError("OCR line budget exceeded")
    return lines


def run_ocr(image, models, output, *, psm, languages, deadline):
    """Only pixels/settings enter the worker; feedback/expected text is excluded."""
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("OCR comparison budget exhausted")
    job = {
        "image": str(image.resolve()),
        "models": str(models.resolve()),
        "psm": psm,
        "languages": languages,
    }
    job_path = output.with_suffix(".job.json")
    job_path.write_text(json.dumps(job))
    worker = Path(__file__).resolve().parents[2] / "ocr" / "worker.mjs"
    env = {k: v for k, v in os.environ.items() if k in {"PATH", "SYSTEMROOT", "TMPDIR", "LANG"}}
    try:
        with output.open("xb") as stream:
            result = subprocess.run(
                ["node", "--max-old-space-size=1024", str(worker), str(job_path)],
                stdout=stream,
                stderr=subprocess.DEVNULL,
                env=env,
                timeout=min(120, remaining),
                check=False,
            )
        if result.returncode or output.stat().st_size > 20 * 1024**2:
            raise ValueError("Local OCR failed or exceeded output budget")
        value = json.loads(output.read_text())
        if (
            value.get("image_sha256") != digest(image)
            or value.get("publication_eligible") is not False
            or value.get("state") != "EXPERIMENTAL_NOT_ACCEPTED"
            or value.get("languages") != languages.split("+")
            or value.get("psm") != psm
        ):
            raise ValueError("OCR worker protocol mismatch")
        return value
    finally:
        job_path.unlink(missing_ok=True)


def compare(baseline: Path, feedback_file: Path, models: Path, output: Path):
    if output.exists():
        raise ValueError("Use a fresh comparison output directory")
    baseline = baseline.resolve()
    model_hash = verify_models(models)
    artifact_path = baseline / "artifact.json"
    artifact = Artifact.model_validate_json(artifact_path.read_text())
    if not artifact.expected_pages or artifact.expected_pages > 10:
        raise ValueError("Comparison permits at most ten source pages")
    if (baseline / "original.pdf").stat().st_size > 100 * 1024**2:
        raise ValueError("Original exceeds byte budget")
    checked = verify_package(artifact.model_copy(deep=True), baseline)
    if not checked.page_accounting_complete or not checked.processed_pages_complete:
        raise ValueError("Baseline integrity/completeness verification failed")
    matches = [
        r
        for r in json.loads(feedback_file.read_text())["feedback"]
        if r.get("run_id") == artifact.run_id and r.get("feedback_type") == "region_defect_report"
    ]
    if len(matches) != 1:
        raise ValueError("Expected exactly one source-bound defect report")
    feedback = matches[0]
    findings = bind_feedback(artifact, artifact_path, feedback)
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".ocr-comparison-", dir=output.parent))
    deadline = time.monotonic() + 600
    began = time.monotonic()
    try:
        (staging / "pages").mkdir()
        (staging / "raw").mkdir()
        (staging / "regions").mkdir()
        shutil.copyfile(baseline / "original.pdf", staging / "original.pdf")
        (staging / "original.pdf").chmod(0o444)
        shutil.copyfile(artifact_path, staging / "baseline-artifact.json")
        shutil.copyfile(models / "weights-manifest.json", staging / "weights-manifest.json")
        (staging / "reviewer-feedback.json").write_text(
            json.dumps(feedback, ensure_ascii=False, indent=2)
        )
        report = {
            "schema_version": "0.1.0",
            "state": "BLOCKED",
            "publication_eligible": False,
            "acceptance": None,
            "created_at": datetime.now(UTC).isoformat(),
            "source_sha256": artifact.source_sha256,
            "source_title": artifact.source_title,
            "baseline_artifact_sha256": digest(artifact_path),
            "feedback_sha256": digest(staging / "reviewer-feedback.json"),
            "weights_manifest_sha256": model_hash,
            "comparison_code_sha256": digest(Path(__file__)),
            "review_code_sha256": digest(Path(__file__).with_name("compare_review.py")),
            "worker_sha256": digest(Path(__file__).resolve().parents[2] / "ocr" / "worker.mjs"),
            "ocr_lock_sha256": digest(
                Path(__file__).resolve().parents[2] / "ocr" / "package-lock.json"
            ),
            "renderer_versions": {
                p: importlib.metadata.version(p) for p in ("pypdfium2", "pdfplumber", "Pillow")
            },
            "config": {
                "dpi": 300,
                "ocr_seconds_per_job": 120,
                "total_seconds": 600,
                "render_pixel_limit": 16000000,
                "network_sandbox_enforced": False,
            },
            "pages": [],
            "findings": [],
            "limitations": [
                "Unaccepted local tuning sample, not held-out accuracy evaluation.",
                "Reviewer proposals never enter OCR input; signature labels are human-supplied.",
                "Reading order, Hindi fidelity, handwriting and table semantics remain unverified.",
                "Confidence is an engine signal, not probability of correct transcription.",
                "Local weights and reduced worker environment; no OS egress/filesystem sandbox.",
            ],
        }
        for page in artifact.pages:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("Comparison run exhausted")
            result = child(
                "page",
                staging / "original.pdf",
                page.number,
                staging,
                300,
                16000000,
                timeout=max(1, min(50, int(remaining))),
            )
            rendered = Page.model_validate(result)
            if (
                not rendered.render
                or abs(rendered.width - page.width) > 0.1
                or abs(rendered.height - page.height) > 0.1
            ):
                raise ValueError("Rendered geometry differs from baseline")
            image_path = staging / rendered.render
            entry = {
                "number": page.number,
                "width": page.width,
                "height": page.height,
                "render": rendered.render,
                "render_sha256": digest(image_path),
                "native_blocks": [b.model_dump() for b in page.blocks],
                "variants": [],
            }
            for languages in ("eng", "eng+hin"):
                raw_path = staging / "raw" / f"page-{page.number}-{languages}.json"
                raw = run_ocr(
                    image_path, models, raw_path, psm=3, languages=languages, deadline=deadline
                )
                entry["variants"].append(
                    {
                        "languages": languages,
                        "raw": str(raw_path.relative_to(staging)),
                        "lines": mapped_lines(raw, page),
                        "engine_versions": raw["engine_versions"],
                    }
                )
            report["pages"].append(entry)
        for index, finding in enumerate(findings, 1):
            number = int(finding["region_ids"][0].split("-")[0][1:])
            page = next(p for p in artifact.pages if p.number == number)
            page_entry = next(p for p in report["pages"] if p["number"] == number)
            case = {
                "id": f"case-{index}",
                "page": number,
                **finding,
                "attempts": [],
                "groups": [],
                "resolution": "UNRESOLVED_REVIEW_REQUIRED",
            }
            with Image.open(staging / page_entry["render"]) as image:
                signature = finding["category"] == "signature_misclassified_as_text"
                case["handling"] = (
                    "REVIEWER_MARKED_SIGNATURE_IMAGE_ONLY"
                    if signature
                    else "OCR_CANDIDATES_NOT_ACCEPTED"
                )
                for group_index, ids in enumerate(spatial_groups(page, finding["region_ids"]), 1):
                    group_id = f"case-{index}-group-{group_index}"
                    pixels, box = crop_box(page, ids, image.size)
                    crop = image.crop(pixels)
                    crop_name = f"regions/{group_id}.png"
                    crop.save(staging / crop_name)
                    case["groups"].append(
                        {
                            "id": group_id,
                            "region_ids": ids,
                            "crop": crop_name,
                            "crop_box": box.model_dump(),
                            "crop_pixels": pixels,
                        }
                    )
                    if signature:
                        crop.close()
                        continue
                    rotations = [0, 90, 270] if crop.height > 2 * crop.width else [0]
                    psm = 6 if len(ids) > 1 else 7
                    for rotation in rotations:
                        variant = crop.rotate(rotation, expand=True)
                        name = f"regions/{group_id}-rotation-{rotation}.png"
                        variant.save(staging / name)
                        variant.close()
                        languages = (
                            "eng+hin" if finding["category"] == "hindi_transcription" else "eng"
                        )
                        raw_path = staging / "raw" / f"{group_id}-{rotation}.json"
                        raw = run_ocr(
                            staging / name,
                            models,
                            raw_path,
                            psm=psm,
                            languages=languages,
                            deadline=deadline,
                        )
                        case["attempts"].append(
                            {
                                "group_id": group_id,
                                "rotation_ccw": rotation,
                                "input": name,
                                "languages": languages,
                                "psm": psm,
                                "text": raw["text"],
                                "confidence": raw["confidence"],
                                "raw": str(raw_path.relative_to(staging)),
                            }
                        )
                    crop.close()
            report["findings"].append(case)
        if (
            digest(staging / "original.pdf") != artifact.source_sha256
            or digest(artifact_path) != report["baseline_artifact_sha256"]
        ):
            raise ValueError("Original or baseline changed during comparison")
        report["elapsed_seconds"] = round(time.monotonic() - began, 2)
        # Keep hashes for every generated source/crop/raw file, not just the manifest.
        report["files"] = {
            str(p.relative_to(staging)): digest(p)
            for p in sorted(staging.rglob("*"))
            if p.is_file()
        }
        (staging / "comparison.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n"
        )
        from .compare_review import write_comparison

        write_comparison(report, staging)
        staging.rename(output)
        return {
            "state": "BLOCKED",
            "publication_eligible": False,
            "output": str(output),
            "pages": len(report["pages"]),
            "findings": len(findings),
            "elapsed_seconds": report["elapsed_seconds"],
        }
    except BaseException:
        shutil.rmtree(staging)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["prepare", "compare"])
    parser.add_argument("--models", type=Path, required=True)
    parser.add_argument("--baseline", type=Path)
    parser.add_argument("--feedback", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    try:
        if args.mode == "prepare":
            print(json.dumps(prepare_models(args.models), indent=2))
        else:
            if not args.baseline or not args.feedback or not args.out:
                raise ValueError("Compare requires baseline, feedback and fresh output")
            print(
                json.dumps(compare(args.baseline, args.feedback, args.models.resolve(), args.out))
            )
    except Exception as error:
        print(
            json.dumps(
                {
                    "state": "EXPERIMENT_FAILED",
                    "error_type": type(error).__name__,
                    "publication_eligible": False,
                }
            )
        )
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()

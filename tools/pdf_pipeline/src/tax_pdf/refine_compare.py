"""Add an independent local OCR candidate and apply revision-scoped reviewer exclusions."""

import argparse
import copy
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from .compare_review import write_comparison
from .easyocr_probe import verify_models
from .models import Page
from .ocr_compare import digest, mapped_lines


def safe_file(root, name):
    path = Path(name)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise ValueError("Invalid comparison artifact path")
    result = root / path
    if (
        result.is_symlink()
        or not result.resolve().is_relative_to(root.resolve())
        or not result.is_file()
    ):
        raise ValueError("Missing or unsafe comparison artifact")
    return result


def bind_review(previous, review_file):
    report_path = previous / "comparison.json"
    report = json.loads(report_path.read_text())
    if report.get("state") != "BLOCKED" or report.get("publication_eligible") is not False:
        raise ValueError("Expected an unaccepted comparison")
    expected = digest(report_path)
    matches = [
        r
        for r in json.loads(review_file.read_text())["feedback"]
        if r.get("feedback_type") == "comparison_review" and r.get("comparison_sha256") == expected
    ]
    if len(matches) != 1:
        raise ValueError("Expected one review bound to the exact comparison revision")
    review = matches[0]
    if (
        review["source_sha256"] != report["source_sha256"]
        or review["baseline_artifact_sha256"] != report["baseline_artifact_sha256"]
    ):
        raise ValueError("Review belongs to a different original/baseline")
    if not isinstance(report.get("files"), dict) or len(report["files"]) > 300:
        raise ValueError("Invalid comparison file inventory")
    for name, checksum in report["files"].items():
        if digest(safe_file(previous, name)) != checksum:
            raise ValueError("Previous comparison artifact changed")
    if digest(safe_file(previous, "original.pdf")) != report["source_sha256"]:
        raise ValueError("Source checksum mismatch")
    if digest(safe_file(previous, "baseline-artifact.json")) != report["baseline_artifact_sha256"]:
        raise ValueError("Baseline checksum mismatch")
    regions = {b["id"] for p in report["pages"] for b in p["native_blocks"]}
    excluded = review["scoped_exclusion_policy"]["requested_region_ids"]
    observations = {
        region
        for o in review["observations"]
        if o["outcome"] == "exclusion_requested"
        for region in o["region_ids"]
    }
    if (
        len(excluded) != len(set(excluded))
        or set(excluded) != observations
        or not set(excluded) <= regions
    ):
        raise ValueError("Exclusion policy has unknown, duplicate or inconsistent regions")
    return report, review


def annotate_scope(line, excluded):
    """Only wholly contained regions are excluded; partial overlaps stay unresolved."""
    box = line["bbox"]
    overlaps = []
    contained = []
    for region, candidate in excluded.items():
        intersection = (min(box["x1"], candidate["x1"]) - max(box["x0"], candidate["x0"])) * max(
            0, min(box["bottom"], candidate["bottom"]) - max(box["top"], candidate["top"])
        )
        if intersection <= 0 or min(box["x1"], candidate["x1"]) <= max(box["x0"], candidate["x0"]):
            continue
        overlaps.append(region)
        if (
            box["x0"] >= candidate["x0"]
            and box["x1"] <= candidate["x1"]
            and box["top"] >= candidate["top"]
            and box["bottom"] <= candidate["bottom"]
        ):
            contained.append(region)
    line["excluded_region_ids"] = overlaps
    line["text_scope"] = (
        "EXCLUDED_BY_REVIEWER"
        if contained
        else "MIXED_EXCLUSION_NEEDS_REVIEW"
        if overlaps
        else "INCLUDED_CANDIDATE"
    )
    return line


def numeric_items(records):
    """Recognised digit-only tokens, never completed or corrected from expected values."""
    return [r["text"] for r in records if re.fullmatch(r"[0-9]+", r["text"].strip())]


def run_probe(requests, models, output):
    job = output.with_suffix(".job.json")
    job.write_text(json.dumps(requests))
    env = {k: v for k, v in os.environ.items() if k in {"PATH", "LANG", "SYSTEMROOT", "TMPDIR"}}
    try:
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "tax_pdf.easyocr_probe",
                "probe",
                "--models",
                str(models.resolve()),
                "--job",
                str(job),
                "--out",
                str(output),
            ],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=180,
            check=False,
        )
        if result.returncode or not output.is_file() or output.stat().st_size > 20 * 1024**2:
            raise ValueError("Local EasyOCR worker did not complete")
        raw = json.loads(output.read_text())
        expected = {r["id"]: r for r in requests}
        records = raw.get("records", [])
        if (
            raw.get("state") != "EXPERIMENTAL_NOT_ACCEPTED"
            or raw.get("publication_eligible") is not False
            or len(records) != len(expected)
            or {r["id"] for r in records} != set(expected)
            or raw.get("model_manifest_sha256") != verify_models(models)
        ):
            raise ValueError("EasyOCR worker protocol mismatch")
        for record in records:
            if (
                record.get("publication_eligible") is not False
                or record.get("state") != "EXPERIMENTAL_NOT_ACCEPTED"
                or record["image_sha256"] != digest(expected[record["id"]]["image"])
                or record.get("languages") != ["eng"]
            ):
                raise ValueError("EasyOCR input/output mismatch")
        return raw
    finally:
        job.unlink(missing_ok=True)


def refine(previous, review_file, models, output):
    previous = previous.resolve()
    if output.exists():
        raise ValueError("Use a fresh refinement directory")
    original_report, review = bind_review(previous, review_file)
    model_hash = verify_models(models)
    if len(original_report["pages"]) > 2:
        raise ValueError("This bounded refinement permits at most two source pages")
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".ocr-refinement-", dir=output.parent))
    try:
        for name in original_report["files"]:
            dest = staging / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(safe_file(previous, name), dest)
        (staging / "original.pdf").chmod(0o444)
        shutil.copyfile(previous / "comparison.json", staging / "previous-comparison.json")
        shutil.copyfile(models / "weights-manifest.json", staging / "easyocr-weights-manifest.json")
        (staging / "applied-review.json").write_text(
            json.dumps(review, ensure_ascii=False, indent=2) + "\n"
        )
        report = copy.deepcopy(original_report)
        excluded_ids = set(review["scoped_exclusion_policy"]["requested_region_ids"])
        requests = []
        for page in report["pages"]:
            requests.append(
                {"id": f"page-{page['number']}", "image": str((staging / page["render"]).resolve())}
            )
        for case in report["findings"]:
            case["prior_attempts"] = copy.deepcopy(case["attempts"])
            case["latest_review"] = [
                o for o in review["observations"] if set(o["region_ids"]) & set(case["region_ids"])
            ]
            case["attempts"] = []
            case["applied_excluded_region_ids"] = sorted(set(case["region_ids"]) & excluded_ids)
            case["resolution"] = (
                "REVIEWER_EXCLUDED_FROM_TEXT"
                if set(case["region_ids"]) <= excluded_ids
                else "UNRESOLVED_REVIEW_REQUIRED"
            )
            for group in case["groups"]:
                group["excluded"] = set(group["region_ids"]) <= excluded_ids
                if not group["excluded"]:
                    requests.append(
                        {"id": group["id"], "image": str((staging / group["crop"]).resolve())}
                    )
        raw_path = staging / "raw" / "easyocr-probe.json"
        raw_path.parent.mkdir(exist_ok=True)
        raw = run_probe(requests, models, raw_path)
        results = {r["id"]: r for r in raw["records"]}
        for page in report["pages"]:
            result = results[f"page-{page['number']}"]
            mapped = mapped_lines(
                result,
                Page(
                    number=page["number"],
                    width=page["width"],
                    height=page["height"],
                    status="ocr_required",
                ),
            )
            for line in mapped:
                line["id"] = line["id"].replace("-ocr-", "-easyocr-")
            page["variants"].append(
                {
                    "engine": "EasyOCR",
                    "languages": "eng",
                    "raw": "raw/easyocr-probe.json",
                    "lines": mapped,
                    "engine_versions": raw["versions"],
                }
            )
            excluded = {
                b["id"]: b["bbox"] for b in page["native_blocks"] if b["id"] in excluded_ids
            }
            for variant in page["variants"]:
                variant.setdefault("engine", "Tesseract")
                for line in variant["lines"]:
                    annotate_scope(line, excluded)
            for block in page["native_blocks"]:
                annotate_scope(block, excluded)
        for case in report["findings"]:
            for group in case["groups"]:
                if group["excluded"]:
                    continue
                result = results[group["id"]]
                attempt = {
                    "engine": "EasyOCR",
                    "languages": "eng",
                    "rotation_ccw": 0,
                    "group_id": group["id"],
                    "input": group["crop"],
                    "text": result["text"],
                    "raw": "raw/easyocr-probe.json",
                    "confidence": min(
                        (r["confidence"] * 100 for r in result["provider_regions"]), default=0
                    ),
                    "confidence_aggregation": "minimum region score; not comparable to prior engine",
                    "provider_regions": result["provider_regions"],
                }
                if case["category"] == "garbled_or_misordered_regions":
                    attempt["numeric_items"] = numeric_items(result["provider_regions"])
                    attempt["non_numeric_items"] = [
                        r["text"]
                        for r in result["provider_regions"]
                        if not re.fullmatch(r"[0-9]+", r["text"].strip())
                    ]
                case["attempts"].append(attempt)
        report["created_at"] = datetime.now(UTC).isoformat()
        report["state"], report["publication_eligible"], report["acceptance"] = (
            "BLOCKED",
            False,
            None,
        )
        report["refinement"] = {
            "engine": "EasyOCR 1.7.2, English only",
            "previous_comparison_sha256": digest(previous / "comparison.json"),
            "applied_review_sha256": digest(staging / "applied-review.json"),
            "excluded_region_ids": sorted(excluded_ids),
            "policy_applied": True,
            "excluded_regions_count_as_correct": False,
            "model_manifest_sha256": model_hash,
            "engine_versions": raw["versions"],
            "code_sha256": digest(Path(__file__)),
            "worker_sha256": digest(Path(__file__).with_name("easyocr_probe.py")),
            "review_code_sha256": digest(Path(__file__).with_name("compare_review.py")),
            "ocr_requests": len(requests),
            "worker_wall_timeout_seconds": 180,
            "all_target_regions_still_require_review": True,
            "hindi": "Retained prior bilingual candidate; EasyOCR Hindi was not evaluated.",
        }
        report["limitations"].extend(
            [
                "English EasyOCR candidates only; no Hindi or handwriting accuracy claim.",
                "Scoped exclusions affect this text view; raw text/source remain intact.",
                "Partial-overlap lines are held for separation, never silently discarded.",
                "Digit-only tokens are shown separately; stray tokens remain visible, not scored correct.",
            ]
        )
        report["files"] = {
            str(p.relative_to(staging)): digest(p)
            for p in sorted(staging.rglob("*"))
            if p.is_file()
        }
        (staging / "comparison.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n"
        )
        write_comparison(report, staging)
        if digest(staging / "original.pdf") != report["source_sha256"]:
            raise ValueError("Original bytes changed")
        staging.rename(output)
        return {
            "state": "BLOCKED",
            "publication_eligible": False,
            "output": str(output),
            "ocr_requests": len(requests),
            "excluded_source_regions": len(excluded_ids),
        }
    except BaseException:
        shutil.rmtree(staging)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--previous", type=Path, required=True)
    parser.add_argument("--review", type=Path, required=True)
    parser.add_argument("--models", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(refine(args.previous, args.review, args.models, args.out)))
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

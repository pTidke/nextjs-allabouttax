"""Fixed image-input table trial. Raw alternatives stay outside canonical acceptance."""

import copy
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from PIL import Image

from .benchmark import digest, load_plan, summarize
from .models import Artifact
from .ocr_compare import mapped_lines, run_ocr, verify_models


def docling_image(image, models, output, deadline):
    """The child receives PNG pixels/settings only, never a source PDF or references."""
    remaining = min(180, int(deadline - time.monotonic()))
    if remaining < 1:
        raise TimeoutError("Image trial deadline exhausted")
    env = {k: v for k, v in os.environ.items() if k in {"PATH", "SYSTEMROOT", "TMPDIR", "LANG"}}
    output.mkdir()
    command = [
        sys.executable,
        "-m",
        "tax_pdf.docling_probe",
        "image-probe",
        "--file",
        str(image.resolve()),
        "--models",
        str(models.resolve()),
        "--out",
        str((output / "provider").resolve()),
        "--languages",
        "en",
    ]
    (output / "command.json").write_text(json.dumps(command, indent=2) + "\n")
    try:
        with (
            (output / "stdout.log").open("xb") as stdout,
            (output / "stderr.log").open("xb") as stderr,
        ):
            result = subprocess.run(
                command, env=env, stdout=stdout, stderr=stderr, timeout=remaining, check=False
            )
        if result.returncode:
            raise ValueError("Local image provider failed; logs retained")
    except subprocess.TimeoutExpired as error:
        raise TimeoutError("Local image provider timed out; partial output retained") from error
    report = json.loads((output / "provider/probe.json").read_text())
    with Image.open(image) as supplied:
        size = supplied.size
    raw_path = output / "provider/raw-docling.json"
    if raw_path.stat().st_size > 40 * 1024**2:
        raise ValueError("Provider output exceeds byte budget")
    if (
        report.get("image_sha256") != digest(image)
        or report.get("input_kind") != "PNG_PIXELS_ONLY"
        or report.get("state") != "EXPERIMENTAL_NOT_ACCEPTED"
        or report.get("publication_eligible") is not False
        or report.get("returned_pages") != [1]
        or report.get("language_config") != "en"
        or (report.get("width"), report.get("height")) != size
    ):
        raise ValueError("Image provider protocol mismatch")
    return report, json.loads(raw_path.read_text())


def run_trial(manifest: Path, plan_path: Path, models: Path, docling_models: Path, output: Path):
    if output.exists():
        raise ValueError("Use a fresh image-table trial output")
    selections = load_plan(manifest, plan_path)
    plan_sha = digest(plan_path)
    plan = json.loads(plan_path.read_text())
    if (
        plan.get("dpi") != 300
        or plan.get("preprocessing") != "none"
        or plan.get("providers") != ["docling-image-en", "tesseract-image-eng+hin-psm3"]
        or sum(len(p[0]["pages"]) for p in selections) > 4
        or any(
            p[0].get("image_kind")
            not in {"genuine_scan_with_embedded_ocr", "rasterized_native_control_not_a_real_scan"}
            for p in selections
        )
    ):
        raise ValueError("Unsupported fixed trial settings or page budget")
    weights = verify_models(models)
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".image-tables-", dir=output.parent))
    deadline = time.monotonic() + 1200
    cases, documents = [], []
    try:
        shutil.copy2(plan_path, staging / "plan.json")
        (staging / "cases").mkdir()
        for selection, source, original in selections:
            from .runner import process

            start = time.monotonic()
            package = process(
                original,
                staging / "packages",
                title=source["title"],
                dpi=300,
                pages=set(selection["pages"]),
                max_processed_pages=4,
                total_timeout=120,
            )
            artifact = Artifact.model_validate_json((package / "artifact.json").read_text())
            document = summarize(artifact, package, selection, time.monotonic() - start)
            document.update(title=source["title"], package=str(package.relative_to(staging)))
            documents.append(document)
            for number in selection["pages"]:
                page = next(p for p in artifact.pages if p.number == number)
                key = f"{artifact.source_sha256[:12]}-p{number}"
                folder = staging / "cases" / key
                folder.mkdir()
                case = {
                    "id": key,
                    "title": source["title"],
                    "source_sha256": artifact.source_sha256,
                    "artifact_sha256": document["artifact_sha256"],
                    "page": number,
                    "image_kind": selection["image_kind"],
                    "checks": selection["checks"],
                    "source_page_width": page.width,
                    "source_page_height": page.height,
                    "source_render_sha256": page.render_sha256,
                    "state": "BLOCKED",
                    "publication_eligible": False,
                    "attempts": [],
                    "original": str((package / "original.pdf").relative_to(staging)),
                }
                cases.append(case)
                image = folder / "input.png"
                if page.render:
                    shutil.copy2(package / page.render, image)
                    case["image"] = str(image.relative_to(staging))
                    case["image_sha256"] = digest(image)
                for provider in plan["providers"]:
                    attempt = {
                        "provider": provider,
                        "state": "FAILED",
                        "publication_eligible": False,
                    }
                    case["attempts"].append(attempt)
                    began = time.monotonic()
                    print(
                        json.dumps({"case": key, "provider": provider, "state": "STARTED"}),
                        flush=True,
                    )
                    try:
                        if (
                            not page.render
                            or not document["integrity_verified"]
                            or not document["page_count_matches_plan"]
                        ):
                            raise ValueError("Source rendering/integrity failed")
                        if time.monotonic() >= deadline:
                            raise TimeoutError("Trial deadline exhausted")
                        if provider == "docling-image-en":
                            dest = folder / "docling"
                            metadata, raw = docling_image(image, docling_models, dest, deadline)
                            from .table_inventory import table_inventory

                            inspection = table_inventory(raw)
                            (dest / "inspection.json").write_text(
                                json.dumps(inspection, indent=2) + "\n"
                            )
                            attempt.update(
                                metadata=metadata,
                                table_count=len(raw.get("tables", [])),
                                inspection=inspection,
                                raw=str((dest / "provider/raw-docling.json").relative_to(staging)),
                                raw_sha256=digest(dest / "provider/raw-docling.json"),
                                markdown=str((dest / "provider/candidate.md").relative_to(staging)),
                            )
                        else:
                            dest = folder / "tesseract.json"
                            raw = run_ocr(
                                image, models, dest, psm=3, languages="eng+hin", deadline=deadline
                            )
                            lines = mapped_lines(raw, page)
                            attempt.update(
                                raw=str(dest.relative_to(staging)),
                                raw_sha256=digest(dest),
                                line_count=len(lines),
                                table_count=None,
                                note="Plain OCR supplies lines, not a table-structure contract.",
                            )
                        attempt["state"] = "EXPERIMENTAL_NOT_ACCEPTED"
                    except (ValueError, OSError, TimeoutError, KeyError) as error:
                        attempt["error_type"] = type(error).__name__
                        attempt["hold"] = "PROVIDER_FAILED_OR_PROTOCOL_INCOMPLETE"
                    attempt["wall_seconds"] = round(time.monotonic() - began, 3)
                    print(
                        json.dumps({"case": key, "provider": provider, "state": attempt["state"]}),
                        flush=True,
                    )
        if digest(plan_path) != plan_sha:
            raise ValueError("Frozen plan changed during execution")
        report = {
            "schema_version": "0.1.0",
            "state": "BLOCKED",
            "publication_eligible": False,
            "plan_sha256": plan_sha,
            "source_manifest_sha256": digest(manifest),
            "tesseract_weights_sha256": weights,
            "docling_weights_sha256": digest(docling_models / "weights-manifest.json"),
            "code_sha256": {
                name: digest(Path(__file__).with_name(name))
                for name in [
                    "scan_tables.py",
                    "docling_probe.py",
                    "table_inventory.py",
                    "runner.py",
                    "worker.py",
                ]
            },
            "documents": documents,
            "cases": cases,
            "summary": {
                "selected_pages": len(cases),
                "genuine_scanned_pages": sum(
                    c["image_kind"] == "genuine_scan_with_embedded_ocr" for c in cases
                ),
                "rasterized_native_controls": sum(
                    c["image_kind"] != "genuine_scan_with_embedded_ocr" for c in cases
                ),
                "provider_attempts": sum(len(c["attempts"]) for c in cases),
                "completed_attempts": sum(
                    a["state"] == "EXPERIMENTAL_NOT_ACCEPTED" for c in cases for a in c["attempts"]
                ),
                "failed_attempts": sum(
                    a["state"] == "FAILED" for c in cases for a in c["attempts"]
                ),
                "accepted_tables": 0,
            },
            "coverage_gaps": plan["coverage_gaps"],
            "accuracy": {
                "status": "UNMEASURED_NO_ACCEPTED_TABLE_REFERENCES",
                "table_accuracy": None,
            },
        }
        (staging / "scan-tables.json").write_text(json.dumps(report, indent=2) + "\n")
        write_view(report, staging)
        ledger = {
            str(p.relative_to(staging)): digest(p)
            for p in sorted(staging.rglob("*"))
            if p.is_file()
        }
        (staging / "files.json").write_text(json.dumps(ledger, indent=2) + "\n")
        staging.rename(output)
    except BaseException:
        # Keep unsuccessful preparation separately for diagnosis, without exposing a finished trial.
        raise
    return report


def write_view(report, root):
    from .scan_table_view import write_view as render

    render(report, root)


def review_trial(trial: Path, output: Path, findings_path: Path | None = None):
    """Reinspect saved outputs without rerunning OCR; link to checksum-verified evidence."""
    from .table_inventory import number, table_inventory

    if output.exists():
        raise ValueError("Use a fresh saved-trial review directory")
    trial = trial.resolve()
    ledger_file = trial / "files.json"
    if ledger_file.stat().st_size > 1024**2:
        raise ValueError("Trial ledger exceeds budget")
    ledger = json.loads(ledger_file.read_text())
    if not isinstance(ledger, dict) or not 1 <= len(ledger) <= 500:
        raise ValueError("Invalid trial ledger")
    total = 0
    for name, expected in ledger.items():
        path = (trial / name).resolve()
        if not path.is_relative_to(trial) or not path.is_file():
            raise ValueError("Trial evidence outside its source directory")
        total += path.stat().st_size
        if total > 300 * 1024**2 or digest(path) != expected:
            raise ValueError("Trial evidence changed or exceeds budget")
    report = json.loads((trial / "scan-tables.json").read_text())
    if report.get("state") != "BLOCKED" or report.get("publication_eligible") is not False:
        raise ValueError("Only blocked trial evidence can supply this review")
    display = copy.deepcopy(report)
    findings = None
    if findings_path:
        if findings_path.stat().st_size > 1024**2:
            raise ValueError("Findings exceed byte budget")
        findings = json.loads(findings_path.read_text())
        if (
            findings.get("state") != "AGENT_SOURCE_COMPARISON_NOT_ACCEPTED"
            or findings.get("publication_eligible") is not False
            or findings.get("owner_verified") is not False
            or findings.get("trial_report_sha256") != digest(trial / "scan-tables.json")
            or len(findings.get("cases", [])) > 4
            or len({c["id"] for c in findings["cases"]}) != len(findings["cases"])
            or any(c["id"] not in {r["id"] for r in report["cases"]} for c in findings["cases"])
        ):
            raise ValueError("Findings must be unaccepted and bind this exact trial")

    def evidence(name):
        if name not in ledger:
            raise ValueError("Missing bound trial file")
        return trial / name

    def link(name):
        return Path(os.path.relpath(evidence(name), output.resolve())).as_posix()

    for case in display["cases"]:
        size = None
        document = next(
            d for d in display["documents"] if d["source_sha256"] == case["source_sha256"]
        )
        artifact_path = evidence(document["package"] + "/artifact.json")
        artifact = Artifact.model_validate_json(artifact_path.read_text())
        page = next(p for p in artifact.pages if p.number == case["page"])
        if (
            digest(evidence(case["original"])) != case["source_sha256"]
            or artifact.source_sha256 != case["source_sha256"]
            or digest(artifact_path) != case["artifact_sha256"]
            or (page.width, page.height) != (case["source_page_width"], case["source_page_height"])
            or page.render_sha256 != case["source_render_sha256"]
        ):
            raise ValueError("Case does not bind this source page revision")
        scoped = (
            next((c for c in findings["cases"] if c["id"] == case["id"]), None)
            if findings
            else None
        )
        if scoped:
            docling = next(a for a in case["attempts"] if a["provider"] == "docling-image-en")
            if (
                scoped.get("image_sha256") != case.get("image_sha256")
                or scoped.get("source_sha256") != case.get("source_sha256")
                or docling.get("state") != "EXPERIMENTAL_NOT_ACCEPTED"
                or not isinstance(docling.get("raw_sha256"), str)
                or scoped.get("docling_raw_sha256") != docling.get("raw_sha256")
                or not 1 <= len(scoped.get("notes", [])) <= 8
                or any(not isinstance(n, str) or not 1 <= len(n) <= 2000 for n in scoped["notes"])
            ):
                raise ValueError("Findings do not match this exact page/provider revision")
            case["engineering_findings"] = scoped["notes"]
        if case.get("image"):
            source = evidence(case["image"])
            if (
                digest(source) != case["image_sha256"]
                or case["image_sha256"] != case["source_render_sha256"]
            ):
                raise ValueError("Trial page image changed")
            with Image.open(source) as supplied:
                size = supplied.size
                if supplied.format != "PNG" or not 0 < size[0] * size[1] <= 16_000_000:
                    raise ValueError("Invalid trial source image")
            case["image"] = link(case["image"])
        case["original"] = link(case["original"])
        for attempt in case["attempts"]:
            if not attempt.get("raw"):
                continue
            raw_path = evidence(attempt["raw"])
            if digest(raw_path) != attempt["raw_sha256"]:
                raise ValueError("Raw provider revision changed")
            raw = json.loads(raw_path.read_text())
            if attempt["provider"] == "docling-image-en":
                if size is None:
                    raise ValueError("Table claims require a bound source image")
                attempt["inspection"] = table_inventory(raw)
                frame = attempt["inspection"]["provider_page_size"]
                w, h = frame.get("width"), frame.get("height")
                ratio = w / h if number(w) and number(h) and w > 0 and h > 0 else None
                if not ratio or abs(ratio / (size[0] / size[1]) - 1) > 0.01:
                    for table in attempt["inspection"]["tables"]:
                        table["holds"].append("SOURCE_FRAME_ASPECT_MISMATCH")
                        table["image_percent_box"] = None
                        for cell in table["cells"]:
                            cell["image_percent_box"] = None
            attempt["raw"] = link(attempt["raw"])
            if attempt.get("markdown"):
                attempt["markdown"] = link(attempt["markdown"])
    display["saved_trial_review"] = {
        "provider_rerun": False,
        "upstream_report_sha256": digest(evidence("scan-tables.json")),
        "upstream_file_ledger_sha256": digest(ledger_file),
        "file_ledger_entries_verified": len(ledger),
        "upstream_report": link("scan-tables.json"),
        "findings_sha256": digest(findings_path) if findings_path else None,
        "findings_snapshot": findings,
        "code_sha256": {
            name: digest(Path(__file__).with_name(name))
            for name in ["scan_tables.py", "scan_table_view.py", "table_inventory.py"]
        },
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".saved-table-review-", dir=output.parent))
    (staging / "scan-tables.json").write_text(json.dumps(display, indent=2) + "\n")
    write_view(display, staging)
    review_files = {name: digest(staging / name) for name in ["scan-tables.json", "index.html"]}
    (staging / "files.json").write_text(json.dumps(review_files, indent=2) + "\n")
    staging.rename(output)
    return display

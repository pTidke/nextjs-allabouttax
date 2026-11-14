"""Exact-revision scan feedback. Partial corrections never accept a whole page."""

import json
import re
import shutil
import tempfile
from pathlib import Path
from typing import Literal

from pydantic import Field

from .models import Box, Model
from .reference_eval import digest, safe_file
from .review import CSS, JS, attrs, escape


class Finding(Model):
    id: str = Field(pattern=r"^[a-z0-9_-]{1,80}$")
    case_id: str | None = None
    languages: Literal["eng", "eng+hin"] | None = None
    psm: Literal[3, 6] | None = None
    category: str = Field(min_length=1, max_length=80)
    action: Literal[
        "correction_proposed",
        "exclude_decoration",
        "exclude_signature",
        "split_mixed_region",
        "reconstruct_column",
        "reject_page",
        "keep_source_script",
        "qualitative_only",
    ]
    user_report: str = Field(min_length=1, max_length=3000)
    regions: list[dict] = Field(default_factory=list, max_length=50)
    expected_value: str | None = Field(default=None, max_length=3000)
    expected_sequence: list[str] = Field(default_factory=list, max_length=30)
    value_scope: str = Field(min_length=1, max_length=3000)
    full_page_reference_verified: Literal[False] = False


class ScanFeedback(Model):
    schema_version: Literal["0.1.0"] = "0.1.0"
    scan_report_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    recorded_date: str
    reviewer_role: Literal["product_owner"] = "product_owner"
    original_message: str = Field(min_length=1, max_length=15000)
    findings: list[Finding] = Field(min_length=1, max_length=64)
    publication_eligible: Literal[False] = False


def bind_feedback(report_file, feedback_file):
    if report_file.stat().st_size > 40 * 1024**2 or feedback_file.stat().st_size > 5 * 1024**2:
        raise ValueError("Review read budget exceeded")
    report = json.loads(report_file.read_text())
    feedback = ScanFeedback.model_validate_json(feedback_file.read_text())
    if feedback.scan_report_sha256 != digest(report_file):
        raise ValueError("Feedback belongs to another scan experiment")
    if not 1 <= len(report["cases"]) <= 10 or any(
        not re.fullmatch(r"[a-f0-9]{12}-p[1-9][0-9]{0,3}-(unchanged|rotated90|blurred)", c["id"])
        for c in report["cases"]
    ):
        raise ValueError("Invalid scan case inventory")
    cases = {c["id"]: c for c in report["cases"]}
    if len(cases) != len(report["cases"]) or len({f.id for f in feedback.findings}) != len(
        feedback.findings
    ):
        raise ValueError("Duplicate source case or finding")
    for finding in feedback.findings:
        if finding.case_id is None:
            if (
                finding.regions
                or finding.languages is not None
                or finding.psm is not None
                or finding.action != "qualitative_only"
            ):
                raise ValueError("Unassigned feedback cannot supply region corrections")
            continue
        if finding.case_id not in cases:
            raise ValueError("Unknown scan case")
        case = cases[finding.case_id]
        if case.get("image"):
            image = safe_file(report_file.parent, case["image"])
            if digest(image) != case["image_sha256"]:
                raise ValueError("Changed reviewed page image")
        docs = [d for d in report["documents"] if d["source_sha256"] == case["source_sha256"]]
        if len(docs) != 1:
            raise ValueError("Missing or duplicated source document")
        doc = docs[0]
        artifact_file = safe_file(report_file.parent, doc["package"] + "/artifact.json")
        if digest(artifact_file) != doc["artifact_sha256"]:
            raise ValueError("Changed source artifact")
        artifact = json.loads(artifact_file.read_text())
        original = safe_file(report_file.parent, doc["package"] + "/original.pdf")
        if (
            digest(original) != case["source_sha256"]
            or artifact["source_sha256"] != case["source_sha256"]
        ):
            raise ValueError("Changed original PDF")
        page = next(p for p in artifact["pages"] if p["number"] == case["page"])
        if page["render_sha256"] != case["source_render_sha256"]:
            raise ValueError("Source render binding mismatch")
        render = safe_file(report_file.parent, doc["package"] + "/" + page["render"])
        if digest(render) != case["source_render_sha256"]:
            raise ValueError("Changed source render")
        if finding.languages is None:
            if finding.regions or finding.psm is not None:
                raise ValueError("Region feedback must select an exact language/layout")
            continue
        variants = [
            v
            for v in case["variants"]
            if (v["languages"], v["psm"]) == (finding.languages, finding.psm)
        ]
        if len(variants) != 1:
            raise ValueError("Ambiguous OCR variant")
        variant = variants[0]
        raw = safe_file(report_file.parent, variant["raw"])
        if digest(raw) != variant["raw_sha256"]:
            raise ValueError("Changed raw OCR")
        by_id = {r["id"]: r for r in variant["lines"]}
        if len(by_id) != len(variant["lines"]):
            raise ValueError("Duplicate OCR region")
        seen = set()
        for region in finding.regions:
            identity = region.get("id")
            if identity in seen or identity not in by_id or region != by_id[identity]:
                raise ValueError("Feedback text/geometry differs from reviewed region")
            seen.add(identity)
        if (
            finding.action
            in {
                "exclude_signature",
                "exclude_decoration",
                "split_mixed_region",
                "reconstruct_column",
                "keep_source_script",
                "correction_proposed",
            }
            and not finding.regions
        ):
            raise ValueError("A scoped finding requires exact regions")
        if finding.action == "reconstruct_column" and not finding.expected_sequence:
            raise ValueError("Column review must preserve the supplied sequence")
    return report, feedback


def write_feedback_view(report_file: Path, feedback_file: Path, output: Path):
    if output.exists():
        raise ValueError("Use a fresh feedback output directory")
    report, feedback = bind_feedback(report_file, feedback_file)
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".review-scans-", dir=output.parent))
    try:
        shutil.copyfile(report_file, staging / "scan-report.json")
        shutil.copyfile(feedback_file, staging / "feedback.json")
        (staging / "images").mkdir()
        sections = []
        for case in report["cases"]:
            findings = [f for f in feedback.findings if f.case_id == case["id"]]
            if not findings:
                continue
            image = safe_file(report_file.parent, case["image"])
            name = "images/" + case["id"] + ".png"
            shutil.copyfile(image, staging / name)
            notes = []
            for f in findings:
                raw = "".join(
                    f'<button class="block" {attrs(Box(x0=r["image_bbox"]["x0"], top=r["image_bbox"]["y0"], x1=r["image_bbox"]["x1"], bottom=r["image_bbox"]["y1"]), r["id"])}><span class="id">{escape(r["id"])}</span>{escape(r["text"])}</button>'
                    for r in f.regions
                )
                proposal = ""
                if f.expected_value is not None:
                    proposal = f"<p><strong>Proposed value:</strong> {escape(f.expected_value)}</p>"
                if f.expected_sequence:
                    proposal += f"<p><strong>Reviewer-provided column:</strong> {escape(' · '.join(f.expected_sequence))}</p>"
                notes.append(
                    f'<article id="{f.id}"><h3>{escape(f.category.replace("_", " "))}</h3><p class="notice">{escape(f.action.replace("_", " "))}</p><p>{escape(f.user_report)}</p>{proposal}<p>{escape(f.value_scope)}</p>{raw}</article>'
                )
            sections.append(
                f'<section class="page" id="{case["id"]}" data-width="{case["width"]}" data-height="{case["height"]}"><h2>{escape(case["title"])} · p{case["page"]} · {escape(case["transform"])}</h2><div class="columns"><div class="source"><img loading="lazy" src="{name}" alt="Reviewed source page"><div class="highlight"></div></div><div class="transcript"><p class="selection">Select the raw region to highlight the source.</p>{"".join(notes)}</div></div></section>'
            )
        unmatched = "".join(
            f"<p>{escape(f.user_report)} {escape(f.value_scope)}</p>"
            for f in feedback.findings
            if f.case_id is None
        )
        (staging / "index.html").write_text(
            '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'self\'; style-src \'self\'; script-src \'self\'; base-uri \'none\'; form-action \'none\'"><title>Reviewed scan defects</title><link rel="stylesheet" href="review.css"><header><span class="badge">REVIEW NOTES · PUBLICATION DISABLED</span><h1>Your scan corrections and the remaining failures</h1><p>Exact experiment, language/layout and source regions retained. Human notes do not overwrite raw OCR.</p></header>'
            + f'<div class="summary"><p>{len(feedback.findings)} findings · no full-page references accepted by this review</p><p>Mixed text/signature regions must be split before any exclusion. Names under signatures remain useful printed text. Page-wide bleed-through reports do not authorize deleting faint foreground text. Number-column sequences are reviewer proposals; row positions are not invented.</p><a href="feedback.json">Recorded feedback</a><a href="scan-report.json">Original experiment snapshot</a>{unmatched}</div>'
            + "".join(sections)
            + '<script src="review.js"></script></html>'
        )
        (staging / "review.css").write_text(
            CSS + "article{border-bottom:1px solid #ccd8df;padding:14px 0}h3{font-size:16px}"
        )
        (staging / "review.js").write_text(JS)
        staging.rename(output)
        return {"findings": len(feedback.findings), "publication_eligible": False}
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise

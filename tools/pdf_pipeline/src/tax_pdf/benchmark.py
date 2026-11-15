"""Reproducible engineering coverage report. No inferred accuracy or acceptance."""

import hashlib
import json
import shutil
import tempfile
import time
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

from .corpus import load_sources
from .models import Artifact
from .review import escape
from .runner import process, verify_package


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def load_plan(manifest, plan_file):
    sources = list(load_sources(manifest))
    index = {s["sha256"]: (s, p) for s, p in sources}
    plan = json.loads(plan_file.read_text())
    rows = plan["documents"]
    if len(index) != len(sources) or not 1 <= len(rows) <= 20:
        raise ValueError("Duplicate sources or invalid benchmark size")
    seen = set()
    selected = 0
    for row in rows:
        sha = row["sha256"]
        pages = row["pages"]
        count = row["expected_pages"]
        if (
            sha not in index
            or sha in seen
            or row["kind"] not in {"official", "synthetic"}
            or row["split"] != "engineering"
            or not row["template_group"]
            or type(count) is not int
            or not 1 <= count <= 1000
            or not pages
            or len(pages) != len(set(pages))
            or any(type(p) is not int or not 1 <= p <= count for p in pages)
        ):
            raise ValueError("Invalid benchmark selection; no held-out accuracy claim is supported")
        seen.add(sha)
        selected += len(pages)
    if selected > 80:
        raise ValueError("Benchmark exceeds eighty selected pages")
    return [(row, *index[row["sha256"]]) for row in rows]


def summarize(artifact, package, selection, elapsed):
    checked = verify_package(artifact.model_copy(deep=True), package)
    codes = {i.code for i in checked.issues} | {i.code for p in checked.pages for i in p.issues}
    integrity_codes = {"ORIGINAL_CHECKSUM_MISMATCH", "RENDER_CHECKSUM_MISMATCH", "RENDER_MISSING"}
    statuses = Counter(p.status for p in checked.pages)
    observed = checked.expected_pages
    matches = observed == selection["expected_pages"]
    return {
        "source_sha256": checked.source_sha256,
        "artifact_sha256": digest(package / "artifact.json"),
        "fingerprint": checked.fingerprint,
        "engine_versions": checked.engine_versions,
        "config": checked.config,
        "expected_pages": selection["expected_pages"],
        "observed_pages": observed,
        "page_count_matches_plan": matches,
        "selected_pages": selection["pages"],
        "manifest_entries": len(checked.pages),
        "page_accounting_complete": checked.page_accounting_complete and matches,
        "integrity_verified": not bool(codes & integrity_codes),
        "rendered_pages": sum(bool(p.render) for p in checked.pages),
        "processed_pages": sum(
            p.status not in {"failed", "not_processed"} and bool(p.render) for p in checked.pages
        ),
        "status_counts": dict(statuses),
        "table_candidates": sum(len(p.tables) for p in checked.pages),
        "text_blocks": sum(len(p.blocks) for p in checked.pages),
        "fully_processed": checked.processed_pages_complete and matches,
        "state": checked.state if matches else "BLOCKED",
        "issues": sorted(codes | ({"PLAN_PAGE_COUNT_MISMATCH"} if not matches else set())),
        "wall_seconds": round(elapsed, 3),
        "publication_eligible": False,
    }


def totals(rows):
    # Planned originals stay in the denominator even if parsing fails.
    return {
        "documents": len(rows),
        "expected_pages": sum(r["expected_pages"] for r in rows),
        "selected_pages": sum(len(r["selected_pages"]) for r in rows),
        "processed_pages": sum(r["processed_pages"] for r in rows),
        "accounted_documents": sum(r["page_accounting_complete"] for r in rows),
        "integrity_verified_documents": sum(r["integrity_verified"] for r in rows),
        "fully_processed_documents": sum(r["fully_processed"] for r in rows),
        "failed_runs": sum(r["state"] == "RUN_FAILED" for r in rows),
        "table_candidates": sum(r["table_candidates"] for r in rows),
        "wall_seconds": round(sum(r["wall_seconds"] for r in rows), 3),
    }


def write_report(report, root):
    groups = []
    for kind, values in report["cohorts"].items():
        groups.append(
            f"<article><h2>{escape(kind.title())}</h2><p><strong>{values['processed_pages']} / {values['expected_pages']}</strong> source pages processed</p><p>{values['selected_pages']} selected · {values['documents']} documents · {values['accounted_documents']} fully accounted manifests · {values['table_candidates']} table candidates</p><p>{values['integrity_verified_documents']} sources and persisted render sets verified · {values['fully_processed_documents']} full documents processed · {values['failed_runs']} failed runs</p></article>"
        )
    rows = []
    for r in report["documents"]:
        link = (
            f'<a href="{escape(r["package"])}/review.html">Inspect pages</a>'
            if r.get("package")
            else "No package"
        )
        rows.append(
            f"<tr><td>{escape(r['title'])}<br><small>{escape(r['kind'])} · {escape(r['template_group'])}</small></td><td>{r['processed_pages']} / {r['expected_pages']}<br><small>{len(r['selected_pages'])} selected</small></td><td>{escape(r['state'])}<br>{escape(', '.join(r['issues']))}</td><td>{r['wall_seconds']:.2f}s<br>{link}</td></tr>"
        )
    (root / "index.html").write_text(
        """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'"><title>PDF laboratory · Engineering benchmark</title><link rel="stylesheet" href="report.css"></head><body><header><span>ALL ABOUT TAX · PDF LABORATORY</span><h1>Coverage measured. Accuracy still unlabelled.</h1><p>Bounded native-extraction experiment · publication disabled</p></header><main><p class="notice">These are engineering checks, not an OCR accuracy score. Official documents have no accepted transcription/table labels. Synthetic fixtures test failure handling; they do not prove real-world accuracy.</p><nav><a href="tables/index.html">Open table review workspace →</a><a href="report.json">Download full report</a><a href="plan.json">Exact sample plan</a></nav><div class="cards">"""
        + "".join(groups)
        + """</div><article><h2>What remains unmeasured</h2><p>Character/word error, critical-token correctness, table relationships, reading order, false-clean output and cost per accepted page: <strong>not measured</strong>. No accepted ground truth or accepted pages exist in this experiment.</p><p>All groups are engineering samples. Prior tuning samples and related forms are kept together; none is claimed as held-out evaluation. Stored originals are biased toward the old pipeline's successful extractions. Real image-only scans and damaged files still need independent collection.</p><p>Runtime is measured on this machine for each bounded native run, including parsing, rendering, verification and package writing. OCR comparison runs, reviewer time and provider billing are excluded. Unprocessed pages remain in the denominator.</p></article><h2>Document results</h2><div class="scroll"><table><thead><tr><th>Source</th><th>Processed / full source</th><th>Quality holds</th><th>Measured runtime</th></tr></thead><tbody>"""
        + "".join(rows)
        + "</tbody></table></div></main></body></html>",
        encoding="utf8",
    )
    (root / "report.css").write_text(
        """*{box-sizing:border-box}body{margin:0;font:16px/1.6 system-ui;color:#173344;background:#f2f6f7}header{background:#102f40;color:white;padding:32px 5vw}header span{font-size:12px;letter-spacing:2px}h1{font-size:30px;margin:12px 0}main{max-width:1400px;margin:auto;padding:28px}h2{font-size:20px}article{background:white;border:1px solid #ccdce2;border-radius:10px;padding:20px;margin:20px 0}.cards{display:grid;grid-template-columns:1fr 1fr;gap:20px}.notice{border-left:4px solid #b27717;background:#fff2d7;padding:18px}nav{display:flex;gap:24px;flex-wrap:wrap}a{color:#00755e}table{width:100%;border-collapse:collapse;background:white;font-size:14px}td,th{text-align:left;vertical-align:top;border:1px solid #cbd9df;padding:14px;overflow-wrap:anywhere}td:first-child{width:38%}td:nth-child(3){width:30%}small{color:#5d7483}.scroll{overflow:auto}@media(max-width:750px){.cards{grid-template-columns:1fr}main{padding:16px}table{min-width:800px}}"""
    )


def benchmark(manifest: Path, plan_file: Path, output: Path):
    if output.exists():
        raise ValueError("Use a fresh benchmark output directory")
    selections = load_plan(manifest, plan_file)
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".benchmark-", dir=output.parent))
    try:
        rows = []
        for selection, source, file in selections:
            start = time.perf_counter()
            base = {
                "title": source["title"],
                "source_url": source.get("url"),
                "kind": selection["kind"],
                "template_group": selection["template_group"],
                "split": "engineering",
            }
            try:
                package = process(
                    file,
                    staging / "packages",
                    title=source["title"],
                    pages=set(selection["pages"]),
                    total_timeout=180,
                    max_processed_pages=20,
                )
                artifact = Artifact.model_validate_json((package / "artifact.json").read_text())
                result = summarize(artifact, package, selection, time.perf_counter() - start)
                result["package"] = str(package.relative_to(staging))
            except (ValueError, OSError):
                result = {
                    "source_sha256": selection["sha256"],
                    "expected_pages": selection["expected_pages"],
                    "selected_pages": selection["pages"],
                    "processed_pages": 0,
                    "page_accounting_complete": False,
                    "integrity_verified": False,
                    "fully_processed": False,
                    "table_candidates": 0,
                    "state": "RUN_FAILED",
                    "wall_seconds": round(time.perf_counter() - start, 3),
                    "issues": ["BENCHMARK_RUN_FAILED"],
                    "publication_eligible": False,
                }
            rows.append({**base, **result})
            print(
                json.dumps(
                    {
                        k: rows[-1][k]
                        for k in (
                            "source_sha256",
                            "processed_pages",
                            "expected_pages",
                            "state",
                            "wall_seconds",
                        )
                    }
                ),
                flush=True,
            )
        report = {
            "schema_version": "0.1.0",
            "created_at": datetime.now(UTC).isoformat(),
            "state": "ENGINEERING_ONLY",
            "publication_eligible": False,
            "plan_sha256": digest(plan_file),
            "source_manifest_sha256": digest(manifest),
            "accuracy": {
                "status": "NOT_MEASURED_NO_ACCEPTED_LABELS",
                "cer": None,
                "wer": None,
                "critical_token_accuracy": None,
                "table_relationship_accuracy": None,
                "accepted_pages": 0,
            },
            "cohorts": {
                k: totals([r for r in rows if r["kind"] == k]) for k in ("official", "synthetic")
            },
            "documents": rows,
        }
        shutil.copyfile(plan_file, staging / "plan.json")
        (staging / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        from .table_review import write_workspace

        write_workspace(staging, rows)
        write_report(report, staging)
        staging.rename(output)
        return report
    except BaseException:
        shutil.rmtree(staging)
        raise

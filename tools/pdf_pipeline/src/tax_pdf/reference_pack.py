"""Build a frozen development sample and reproduce scores from local evidence."""

import json
import shutil
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from .models import Artifact
from .reference_eval import (
    Candidate,
    ExpectedTable,
    Reference,
    aggregate,
    digest,
    safe_file,
    score_candidate,
    sha_json,
)
from .review import escape

TEXT = "\n".join(
    [
        "SYNTHETIC TEST - NOT TAX LAW",
        "Fixture identity: TEST-001",
        "Do not change 1.5% into 15%.",
        "Illustrative deadline: 31 March 2030.",
        "This statement is not an exemption or filing instruction.",
    ]
)
TABLE_TEXT = "\n".join(
    [
        "SYNTHETIC TABLE - NOT TAX LAW",
        "Category Illustrative values (merged header)",
        "Item Rate (%) Amount (INR)",
        "Example A 1.5 1,00,000",
        "Example B 0 -",
        "Example C 0.5",
        "Footnote 1: blank, zero and dash have distinct source meanings.",
    ]
)


def synthetic_table():
    values = [
        ["Category", "Illustrative values (merged header)", None],
        ["Item", "Rate (%)", "Amount (INR)"],
        ["Example A", "1.5", "1,00,000"],
        ["Example B", "0", "-"],
        ["Example C", "0.5", ""],
    ]
    cells = []
    for r, row in enumerate(values):
        for c, value in enumerate(row):
            cell = {
                "row": r,
                "column": c,
                "meaning": "covered" if value is None else "blank" if value == "" else "text",
                "text": value,
            }
            if (r, c) == (0, 1):
                cell["column_span"] = 2
            if value is None:
                cell["covered_by"] = (0, 1)
            cells.append(cell)
    return ExpectedTable(rows=5, columns=3, header_rows=[0, 1], cells=cells)


def read_json(path):
    if path.stat().st_size > 40 * 1024 * 1024:
        raise ValueError("Reference evidence exceeds the local read budget")
    return json.loads(path.read_text())


def bound_page(root, artifact_relative, artifact_sha, page_number):
    file = safe_file(root, artifact_relative)
    if digest(file) != artifact_sha:
        raise ValueError("Changed source artifact")
    artifact = Artifact.model_validate(read_json(file))
    pages = [p for p in artifact.pages if p.number == page_number]
    if len(pages) != 1 or not pages[0].render:
        raise ValueError("Reference requires exactly one rendered source page")
    page = pages[0]
    original = safe_file(root, str(file.parent.relative_to(root) / "original.pdf"))
    render = safe_file(root, str(file.parent.relative_to(root) / page.render))
    if digest(original) != artifact.source_sha256 or digest(render) != page.render_sha256:
        raise ValueError("Original or selected page render checksum mismatch")
    return artifact, page, render


def binding(artifact, page):
    return {
        "source_sha256": artifact.source_sha256,
        "render_sha256": page.render_sha256,
        "page": page.number,
    }


def relative(root, file):
    return str(file.resolve().relative_to(root.resolve()))


def checked_synthetic(reference, fixture_name):
    # References come from authored fixture text/geometry, never extractor output.
    # Hash equality prevents accidentally applying them to another synthetic PDF.
    from .fixtures import mixed_bytes, native_bytes, scan_bytes, table_bytes

    factories = {
        "native": native_bytes,
        "scan": scan_bytes,
        "mixed": mixed_bytes,
        "table": table_bytes,
    }
    import hashlib

    if hashlib.sha256(factories[fixture_name]()).hexdigest() != reference.source_sha256:
        raise ValueError("Authored reference does not match this exact fixture version")
    is_table = fixture_name == "table"
    reference.expected_text = TABLE_TEXT if is_table else TEXT
    reference.critical_strings = (
        ["1.5", "1,00,000", "0.5"]
        if is_table
        else ["TEST-001", "1.5%", "15%", "31 March 2030", "not an exemption"]
    )
    reference.tables = [synthetic_table()] if is_table else []
    reference.notes = "Authored synthetic contract; no claim about official tax documents."
    data = reference.model_dump(mode="json")
    data["status"] = "AUTHORED_SYNTHETIC"
    data["verification"] = {
        "reviewer": "Deterministic fixture authoring contract",
        "method": "fixture_authoring_contract",
        "checked_at": datetime.now(UTC).isoformat(),
        "annotation_sha256": sha_json(reference.annotation()),
    }
    return Reference.model_validate(data)


def native_candidate(artifact, page):
    return {
        "binding": binding(artifact, page),
        "engine": "native",
        "transform": "unchanged",
        "text": "\n".join(b.raw_text for b in sorted(page.blocks, key=lambda b: b.order)),
        "tables": [t.model_dump() for t in page.tables],
        "failed": page.status in {"failed", "not_processed"},
        "claims_clean": False,
        "holds": [i.code for i in page.issues],
        "fingerprint": artifact.fingerprint,
        "engine_versions": artifact.engine_versions,
    }


def build_pack(root, native_report, scan_report, plan_file, output):
    root = root.resolve()
    output = output.resolve()
    if output.exists() or not output.is_relative_to(root):
        raise ValueError("Use a fresh reference directory inside the laboratory root")
    plan = read_json(plan_file)
    native = read_json(native_report)
    scans = read_json(scan_report)
    entries = []
    index = {}
    for report_file, report in ((native_report, native), (scan_report, scans)):
        for doc in report["documents"]:
            file = report_file.parent / doc["package"] / "artifact.json"
            index.setdefault(doc["source_sha256"], file)
    selections = plan["documents"]
    if not 1 <= len(selections) <= 30:
        raise ValueError("Reference selection exceeds the local budget")
    seen = set()
    total = 0
    for selection in selections:
        sha, pages = selection["sha256"], selection["pages"]
        if (
            sha not in index
            or sha in seen
            or not pages
            or len(pages) != len(set(pages))
            or any(type(p) is not int or not 1 <= p <= 1000 for p in pages)
            or selection["split"] != "development"
            or selection["kind"] not in {"official", "synthetic"}
            or not selection["template_group"]
        ):
            raise ValueError("Invalid or duplicated development reference selection")
        seen.add(sha)
        total += len(pages)
    if total > 40:
        raise ValueError("Reference selection exceeds forty pages")
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".references-", dir=output.parent))
    try:
        (staging / "references").mkdir()
        (staging / "candidates").mkdir()
        for selection in selections:
            sha = selection["sha256"]
            artifact_file = index[sha]
            for number in selection["pages"]:
                artifact, page, _ = bound_page(
                    root, relative(root, artifact_file), digest(artifact_file), number
                )
                identity = f"{sha[:12]}-p{number}"
                ref = Reference(
                    id=identity,
                    **binding(artifact, page),
                    kind=selection["kind"],
                    template_group=selection["template_group"],
                    notes=selection["focus"],
                )
                if ref.kind == "synthetic":
                    ref = checked_synthetic(ref, selection["fixture"])
                candidates = [(native_candidate(artifact, page), [artifact_file])]
                for case in scans["cases"]:
                    if case["source_sha256"] != sha or case["page"] != number:
                        continue
                    # Synthetic derivatives can use the same authored transcription;
                    # official page references bind the exact render used in this run.
                    source_doc = next(d for d in scans["documents"] if d["source_sha256"] == sha)
                    scan_artifact = scan_report.parent / source_doc["package"] / "artifact.json"
                    scan_a, scan_p, _ = bound_page(
                        root, relative(root, scan_artifact), digest(scan_artifact), number
                    )
                    if case["source_render_sha256"] != scan_p.render_sha256:
                        raise ValueError("Scan case source render differs from its package")
                    if scan_p.render_sha256 != ref.render_sha256:
                        # Different DPI render of same immutable PDF: bind candidate
                        # to the reference render while recording both in evidence.
                        # Transcription metrics do not compare pixel coordinates.
                        if scan_a.source_sha256 != ref.source_sha256:
                            raise ValueError("Scan source differs from reference")
                    for variant in case["variants"]:
                        evidence = [scan_report, scan_artifact]
                        if case.get("image"):
                            image = safe_file(
                                root, relative(root, scan_report.parent / case["image"])
                            )
                            if digest(image) != case["image_sha256"]:
                                raise ValueError("Changed OCR input image")
                            evidence.append(image)
                        if variant.get("raw"):
                            raw = safe_file(
                                root, relative(root, scan_report.parent / variant["raw"])
                            )
                            if digest(raw) != variant["raw_sha256"]:
                                raise ValueError("Changed raw OCR output")
                            evidence.append(raw)
                        candidates.append(
                            (
                                {
                                    "binding": binding(artifact, page),
                                    "ocr_source_render_sha256": scan_p.render_sha256,
                                    "engine": f"tesseract-{variant['languages']}-psm{variant['psm']}",
                                    "transform": case["transform"],
                                    "text": variant.get("text", ""),
                                    "tables": [],
                                    "failed": variant["state"] != "EXPERIMENTAL_NOT_ACCEPTED",
                                    "claims_clean": False,
                                    "holds": variant["quality_issues"],
                                    "engine_versions": variant.get("engine_versions", {}),
                                },
                                evidence,
                            )
                        )
                reference_file = staging / "references" / f"{identity}.json"
                reference_file.write_text(ref.model_dump_json(indent=2) + "\n")
                row = {
                    "id": identity,
                    "title": artifact.source_title,
                    "kind": ref.kind,
                    "template_group": ref.template_group,
                    "reference": f"references/{identity}.json",
                    "artifact": relative(root, artifact_file),
                    "artifact_sha256": digest(artifact_file),
                    "page": number,
                    "candidates": [],
                }
                for i, (candidate, evidence) in enumerate(candidates):
                    name = f"candidates/{identity}-{i}.json"
                    (staging / name).write_text(
                        json.dumps(candidate, indent=2, ensure_ascii=False) + "\n"
                    )
                    row["candidates"].append(
                        {
                            "path": name,
                            "sha256": digest(staging / name),
                            "evidence": [
                                {"path": relative(root, f), "sha256": digest(f)} for f in evidence
                            ],
                        }
                    )
                entries.append(row)
        dataset = {
            "schema_version": "0.1.0",
            "publication_eligible": False,
            "split": "development",
            "plan_sha256": digest(plan_file),
            "inputs": [
                {"path": relative(root, p), "sha256": digest(p)}
                for p in (native_report, scan_report)
            ],
            "pages": entries,
        }
        (staging / "dataset.json").write_text(json.dumps(dataset, indent=2) + "\n")
        staging.rename(output)
        return evaluate_pack(root, output / "dataset.json", output / "results-v1")
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def evaluate_pack(root, dataset_file, output):
    root, dataset_file, output = root.resolve(), dataset_file.resolve(), output.resolve()
    if output.exists() or not output.is_relative_to(root):
        raise ValueError("Use a fresh results directory inside the laboratory root")
    dataset = read_json(dataset_file)
    entries = dataset["pages"]
    if not 1 <= len(entries) <= 40 or len({e["id"] for e in entries}) != len(entries):
        raise ValueError("Invalid reference page inventory")
    for evidence in dataset["inputs"]:
        if digest(safe_file(root, evidence["path"])) != evidence["sha256"]:
            raise ValueError("Changed experiment evidence")
    results, pages, seen = [], [], set()
    for entry in entries:
        ref_file = safe_file(dataset_file.parent, entry["reference"])
        ref = Reference.model_validate(read_json(ref_file))
        artifact, page, render = bound_page(
            root, entry["artifact"], entry["artifact_sha256"], entry["page"]
        )
        expected_binding = binding(artifact, page)
        if (
            ref.kind != entry["kind"]
            or ref.template_group != entry["template_group"]
            or ref.id != entry["id"]
        ) or any(getattr(ref, k) != v for k, v in expected_binding.items()):
            raise ValueError("Reference differs from selected immutable source page")
        key = (ref.source_sha256, ref.page)
        if key in seen:
            raise ValueError("Duplicate original page in reference inventory")
        seen.add(key)
        if not 1 <= len(entry["candidates"]) <= 20:
            raise ValueError("Missing or excessive candidate attempts")
        page_row = {
            "id": ref.id,
            "kind": ref.kind,
            "title": entry["title"],
            "status": ref.status,
            "template_group": ref.template_group,
            "reference_sha256": digest(ref_file),
            "reference": relative(root, ref_file),
            "render": relative(root, render),
            "notes": ref.notes,
        }
        pages.append(page_row)
        candidate_files, variants = set(), set()
        for source in entry["candidates"]:
            file = safe_file(dataset_file.parent, source["path"])
            if file in candidate_files:
                raise ValueError("Duplicate candidate attempt")
            candidate_files.add(file)
            if digest(file) != source["sha256"]:
                raise ValueError("Changed candidate snapshot")
            for evidence in source["evidence"]:
                if digest(safe_file(root, evidence["path"])) != evidence["sha256"]:
                    raise ValueError("Changed candidate evidence")
            candidate = Candidate.model_validate(read_json(file)).model_dump()
            variant_key = (candidate["engine"], candidate["transform"])
            if variant_key in variants:
                raise ValueError("Duplicate engine/transform attempt")
            variants.add(variant_key)
            results.append(
                {
                    "reference_id": ref.id,
                    "kind": ref.kind,
                    "engine": candidate["engine"],
                    "transform": candidate["transform"],
                    "candidate_sha256": digest(file),
                    "candidate": relative(root, file),
                    "output_empty": not candidate["text"].strip(),
                    "holds": candidate["holds"],
                    "score": score_candidate(ref, candidate),
                }
            )
    report = {
        "schema_version": "0.1.0",
        "created_at": datetime.now(UTC).isoformat(),
        "state": "DEVELOPMENT_ONLY_NOT_ACCEPTED",
        "publication_eligible": False,
        "dataset_sha256": digest(dataset_file),
        "scorer_sha256": digest(Path(__file__).with_name("reference_eval.py")),
        "adapter_sha256": digest(Path(__file__)),
        "reference_pages": len(pages),
        "official_verified_pages": sum(
            p["kind"] == "official" and p["status"] == "HUMAN_VERIFIED" for p in pages
        ),
        "by_kind": {
            kind: aggregate([r for r in results if r["kind"] == kind])
            for kind in ("official", "synthetic")
        },
        "by_engine": {
            f"{kind}/{engine}": aggregate(
                [r for r in results if r["kind"] == kind and r["engine"] == engine]
            )
            for kind, engine in sorted({(r["kind"], r["engine"]) for r in results})
        },
        "by_variant": {
            f"{kind}/{engine}/{transform}": aggregate(
                [
                    r
                    for r in results
                    if (r["kind"], r["engine"], r["transform"]) == (kind, engine, transform)
                ]
            )
            for kind, engine, transform in sorted(
                {(r["kind"], r["engine"], r["transform"]) for r in results}
            )
        },
        "pages": pages,
        "attempts": results,
    }
    output.mkdir(parents=True)
    (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    write_html(root, output, report)
    return report


def write_html(root, output, report):
    import os

    def link(relative_file):
        return escape(os.path.relpath(root / relative_file, output))

    engine_rows = []
    for name, score in report["by_variant"].items():
        cer = "Not measured" if score["cer"] is None else f"{100 * score['cer']:.2f}%"
        wer = "Not measured" if score["wer"] is None else f"{100 * score['wer']:.2f}%"
        engine_rows.append(
            f"<tr><td>{escape(name)}</td><td>{score['scored_attempts']} / {score['candidate_attempts']}</td><td>{cer}</td><td>{wer}</td><td>{score['observed_empty_attempts']}</td></tr>"
        )
    sections = []
    for page in report["pages"]:
        attempts = [a for a in report["attempts"] if a["reference_id"] == page["id"]]
        proposed = read_json(root / attempts[0]["candidate"])["text"]
        ref = read_json(root / page["reference"])
        scores = []
        for a in attempts:
            score = a["score"]
            detail = "Unscored: reference not verified"
            if score["text"] is not None:
                t = score["text"]
                detail = f"{t['character_edits']} character edits / {t['reference_characters']} characters; {t['word_edits']} word edits / {t['reference_words']} words"
                if score["tables"] is not None and (
                    score["tables"]["reference_tables"] or score["tables"]["observed_tables"]
                ):
                    table = score["tables"]
                    detail += (
                        f"; table values {table['exact_cell_values']} / {table['reference_value_cells']} exact; "
                        f"anchor spans {table['exact_anchor_spans']} / {table['reference_anchors']} resolved; "
                        f"{table['unresolved_covered_cells']} covered positions unverified"
                    )
            scores.append(
                f'<li>{escape(a["engine"])} · {escape(a["transform"])}: {escape(detail)}{"; EMPTY OUTPUT" if a["output_empty"] else ""} <a href="{link(a["candidate"])}">candidate evidence</a></li>'
            )
        sections.append(
            f'<article id="{page["id"]}"><h2>{escape(page["title"])} · {page["id"]}</h2><p><strong>{escape(page["status"])}</strong> · {escape(page["kind"])} · {escape(page["template_group"])}</p><p>{escape(page["notes"])}</p><p><a href="{link(page["reference"])}">Reference JSON</a></p><ul>{"".join(scores)}</ul><details><summary>Source page and proposed transcription</summary><div class="compare"><a href="{link(page["render"])}"><img loading="lazy" src="{link(page["render"])}" alt="Original selected page render"></a><div><h3>{"Authored synthetic reference" if ref["status"] == "AUTHORED_SYNTHETIC" else "Human-verified reference" if ref["status"] == "HUMAN_VERIFIED" else "Unverified native candidate — not ground truth"}</h3><pre>{escape(ref["expected_text"] if ref["expected_text"] is not None else proposed)}</pre></div></div></details></article>'
        )
    (output / "index.html").write_text(
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'self\'; style-src \'self\'; base-uri \'none\'; form-action \'none\'"><title>PDF reference dataset and scoring</title><link rel="stylesheet" href="report.css"><header><span>ALL ABOUT TAX · PDF LABORATORY</span><h1>Reference dataset and extraction scores</h1><p>Development diagnostics · all publication disabled</p></header><main>'
        + f'<p class="notice">{report["reference_pages"]} selected source pages. {report["official_verified_pages"]} official pages have complete human-verified references. Synthetic scores validate the scoring/extraction machinery; they do not estimate official-document accuracy.</p>'
        + '<p><a href="report.json">Full report and provenance</a></p><h2>Measured text errors</h2><p>Lower CER/WER is better. Unicode code-point edits after NFC and whitespace folding only; case, punctuation, numbers and negation stay significant. Every listed attempt is retained, including failure/empty output. Rates can exceed 100% with insertions. Attempt totals include repeated/derived synthetic pages and are not independent samples.</p><div class="scroll"><table><thead><tr><th>Sample / engine</th><th>Scored / attempts</th><th>Character error rate</th><th>Word error rate</th><th>Empty outputs</th></tr></thead><tbody>'
        + "".join(engine_rows)
        + "</tbody></table></div><article><h2>What these results do not prove</h2><p>This is a development set, with previously inspected documents and related forms kept together. No held-out accuracy claim, production acceptance or tax review is made. A new unseen document/template cohort and real image-only scans are still required.</p><p>Critical-string checks compare occurrence counts only; they do not establish location or meaning. Table checks use supplied table order and count exact values/spans, with null treated as unresolved. Header relationships, reading-order accuracy, semantic table accuracy and cost per accepted page remain unmeasured.</p><p>Unverified official transcripts start as empty reference templates. Match every printed line against the original image, including figures, names, dates, Hindi and list labels. Signatures, show-through and unreadable regions need a separate region-scoped reference contract before those pages can receive a clean full-page score. Do not substitute expected sequence numbers or legal knowledge for what is visible. Prior partial table choices remain review progress.</p></article><h2>Reference pages and candidate evidence</h2>"
        + "".join(sections)
        + "</main></html>"
    )
    (output / "report.css").write_text(
        "body{margin:0;background:#f3f6f7;color:#183344;font:16px/1.6 system-ui}header{background:#102f40;color:white;padding:28px 5vw}main{max-width:1350px;margin:auto;padding:24px}h1{font-size:30px}h2{font-size:20px}article{background:white;border:1px solid #ccdce2;border-radius:10px;padding:22px;margin:24px 0}a{color:#00745d}table{border-collapse:collapse;background:white;width:100%}td,th{padding:12px;border:1px solid #cbd9df;text-align:left}.notice{background:#fff0d6;padding:18px;border-left:4px solid #b27717}.scroll{overflow:auto}.compare{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:20px}.compare img{width:100%;border:1px solid #ccc}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}summary{cursor:pointer;font-weight:600}li{overflow-wrap:anywhere;margin:8px 0}@media(max-width:800px){.compare{grid-template-columns:1fr}main{padding:12px}table{min-width:750px}}"
    )

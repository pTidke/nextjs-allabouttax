import argparse
import json
from pathlib import Path

from .models import Artifact
from .runner import process, verify_package


def main():
    parser = argparse.ArgumentParser(
        description="Local PDF laboratory. Never publishes or changes tax approvals."
    )
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("process")
    run.add_argument("file", type=Path)
    run.add_argument("--out", type=Path, default=Path("work/pdf-lab"))
    run.add_argument("--title")
    run.add_argument("--dpi", type=int, default=120)
    run.add_argument("--page-limit", type=int, default=1000)
    run.add_argument(
        "--pages", help="Explicit page subset, e.g. 1,2,5. Other pages remain blocked in manifest."
    )
    check = sub.add_parser("verify")
    check.add_argument("package", type=Path)
    reference_schema = sub.add_parser("reference-schema")
    reference_schema.add_argument("--out", type=Path, required=True)
    schema = sub.add_parser("schema")
    schema.add_argument("--out", type=Path, required=True)
    profile = sub.add_parser("triage")
    profile.add_argument("manifest", type=Path)
    profile.add_argument("--out", type=Path, default=Path("work/pdf-triage"))
    batch = sub.add_parser("batch")
    batch.add_argument("manifest", type=Path)
    batch.add_argument("--out", type=Path, default=Path("work/pdf-lab/demo"))
    batch.add_argument("--ids", required=True, help="Comma-separated original SHA-256 prefixes")
    bench = sub.add_parser("benchmark")
    bench.add_argument("manifest", type=Path)
    bench.add_argument("--plan", type=Path, required=True)
    bench.add_argument("--out", type=Path, required=True)
    draft = sub.add_parser("check-table-draft")
    draft.add_argument("package", type=Path)
    draft.add_argument("draft", type=Path)
    progress = sub.add_parser("check-table-progress")
    progress.add_argument("package", type=Path)
    progress.add_argument("progress", type=Path)
    serve = sub.add_parser("serve-review")
    serve.add_argument("--root", type=Path, required=True)
    serve.add_argument("--store", type=Path, required=True)
    serve.add_argument("--port", type=int, default=8788)
    backup = sub.add_parser("review-backup")
    backup.add_argument("--root", type=Path, required=True)
    backup.add_argument("--store", type=Path, required=True)
    backup.add_argument("--out", type=Path, required=True)
    scans = sub.add_parser("compare-scans")
    scans.add_argument("manifest", type=Path)
    scans.add_argument("--models", type=Path, required=True)
    scans.add_argument("--out", type=Path, required=True)
    refs = sub.add_parser("reference-pack")
    refs.add_argument("--root", type=Path, required=True)
    refs.add_argument("--native-report", type=Path, required=True)
    refs.add_argument("--scan-report", type=Path, required=True)
    refs.add_argument("--plan", type=Path, required=True)
    refs.add_argument("--out", type=Path, required=True)
    scores = sub.add_parser("score-references")
    scores.add_argument("dataset", type=Path)
    scores.add_argument("--root", type=Path, required=True)
    scores.add_argument("--out", type=Path, required=True)
    scan_review = sub.add_parser("review-scans")
    scan_review.add_argument("report", type=Path)
    scan_review.add_argument("feedback", type=Path)
    scan_review.add_argument("--out", type=Path, required=True)
    recovery = sub.add_parser("recover-scans")
    recovery.add_argument("report", type=Path)
    recovery.add_argument("feedback", type=Path)
    recovery.add_argument("--models", type=Path, required=True)
    recovery.add_argument("--reference", type=Path, required=True)
    recovery.add_argument("--out", type=Path, required=True)
    targeted = sub.add_parser("targeted-ocr")
    targeted.add_argument("report", type=Path)
    targeted.add_argument("feedback", type=Path)
    targeted.add_argument("previous", type=Path)
    targeted.add_argument("--models", type=Path, required=True)
    targeted.add_argument("--out", type=Path, required=True)
    targeted.add_argument("--easyocr-models", type=Path)
    dates = sub.add_parser("review-dates")
    dates.add_argument("manifest", type=Path)
    dates.add_argument("--out", type=Path, required=True)
    structure = sub.add_parser("review-table-structure")
    structure.add_argument("package", type=Path)
    structure.add_argument("plan", type=Path)
    structure.add_argument("--out", type=Path, required=True)
    scan_tables = sub.add_parser("trial-scan-tables")
    scan_tables.add_argument("manifest", type=Path)
    scan_tables.add_argument("--plan", type=Path, required=True)
    scan_tables.add_argument("--models", type=Path, required=True)
    scan_tables.add_argument("--docling-models", type=Path, required=True)
    scan_tables.add_argument("--out", type=Path, required=True)
    saved_tables = sub.add_parser("review-scan-tables")
    saved_tables.add_argument("trial", type=Path)
    saved_tables.add_argument("--findings", type=Path)
    saved_tables.add_argument("--out", type=Path, required=True)
    content = sub.add_parser("prepare-content")
    content.add_argument("manifest", type=Path)
    content.add_argument("--date-report", type=Path, required=True)
    content.add_argument("--review", type=Path, required=True)
    content.add_argument("--out", type=Path, required=True)
    content_schema = sub.add_parser("content-schema")
    content_schema.add_argument("--out", type=Path, required=True)
    transfer = sub.add_parser("evaluate-transfer")
    transfer.add_argument("manifest", type=Path)
    transfer.add_argument("--plan", type=Path, required=True)
    transfer.add_argument("--prior", type=Path, required=True)
    transfer.add_argument("--models", type=Path, required=True)
    transfer.add_argument("--easyocr-models", type=Path, required=True)
    transfer.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "trial-scan-tables":
            from .scan_tables import run_trial

            report = run_trial(args.manifest, args.plan, args.models, args.docling_models, args.out)
            print(json.dumps(report["summary"]))
        elif args.command == "review-scan-tables":
            from .scan_tables import review_trial

            report = review_trial(args.trial, args.out, args.findings)
            print(json.dumps(report["summary"]))
        elif args.command == "review-table-structure":
            from .table_structure import write_structure_review

            report = write_structure_review(args.package, args.plan, args.out)
            print(json.dumps(report["summary"]))
        elif args.command == "evaluate-transfer":
            from .transfer_evaluation import run_transfer

            report = run_transfer(
                args.manifest, args.plan, args.prior, args.models, args.easyocr_models, args.out
            )
            print(json.dumps(report["summary"]))
        elif args.command == "prepare-content":
            from .structured_content import prepare_content

            report = prepare_content(args.manifest, args.date_report, args.review, args.out)
            print(
                json.dumps(
                    {
                        "variants": len(report.pages),
                        "state": report.state,
                        "publication_eligible": False,
                    }
                )
            )
        elif args.command == "content-schema":
            from .content_models import ContentPreview

            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(json.dumps(ContentPreview.model_json_schema(), indent=2) + "\n")
        elif args.command == "review-dates":
            from .date_review import audit_dates

            report = audit_dates(args.manifest, args.out)
            print(
                json.dumps(
                    {
                        "inputs": len(report["inputs"]),
                        "warnings": report["warning_count"],
                        "publication_eligible": False,
                    }
                )
            )
        elif args.command == "targeted-ocr":
            from .targeted_ocr import targeted_trials

            report = targeted_trials(
                args.report,
                args.feedback,
                args.previous,
                args.models,
                args.out,
                easyocr_models=args.easyocr_models,
            )
            print(
                json.dumps(
                    {
                        "numeric_columns": len(report["numeric_columns"]),
                        "foreground_attempts": len(report["foreground"]["attempts"]),
                        "publication_eligible": False,
                    }
                )
            )
        elif args.command == "review-scans":
            from .scan_feedback import write_feedback_view

            print(json.dumps(write_feedback_view(args.report, args.feedback, args.out)))
        elif args.command == "recover-scans":
            from .scan_recovery import recover_scans

            report = recover_scans(
                args.report, args.feedback, args.models, args.reference, args.out
            )
            print(
                json.dumps(
                    {
                        "columns": len(report["columns"]),
                        "orientation_attempts": len(report["orientation_attempts"]),
                        "publication_eligible": False,
                    }
                )
            )
        elif args.command == "reference-schema":
            from .reference_eval import Reference

            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(json.dumps(Reference.model_json_schema(), indent=2) + "\n")
        elif args.command == "reference-pack":
            from .reference_pack import build_pack

            report = build_pack(
                args.root, args.native_report, args.scan_report, args.plan, args.out
            )
            print(
                json.dumps(
                    {"reference_pages": report["reference_pages"], "publication_eligible": False}
                )
            )
        elif args.command == "score-references":
            from .reference_pack import evaluate_pack

            report = evaluate_pack(args.root, args.dataset, args.out)
            print(
                json.dumps(
                    {"reference_pages": report["reference_pages"], "publication_eligible": False}
                )
            )
        elif args.command == "compare-scans":
            from .scan_benchmark import scan_benchmark

            scan_benchmark(args.manifest, args.models, args.out)
        elif args.command == "serve-review":
            from .review_server import make_server

            server = make_server(args.root, args.store, args.port)
            print(
                json.dumps(
                    {
                        "url": f"http://127.0.0.1:{server.server_port}/",
                        "publication_eligible": False,
                    }
                ),
                flush=True,
            )
            try:
                server.serve_forever()
            finally:
                server.server_close()
        elif args.command == "review-backup":
            from .review_store import ReviewStore

            print(json.dumps(ReviewStore(args.store, args.root).backup(args.out)))
        elif args.command == "benchmark":
            from .benchmark import benchmark

            benchmark(args.manifest, args.plan, args.out)
        elif args.command == "check-table-progress":
            from .table_review import validate_progress

            _, strict_valid = validate_progress(args.package, args.progress)
            print(
                json.dumps(
                    {
                        "state": "UNFINISHED_TABLE_REVIEW",
                        "source_binding_valid": True,
                        "strict_draft_valid": strict_valid,
                        "publication_eligible": False,
                    }
                )
            )
        elif args.command == "check-table-draft":
            from .table_review import validate_draft

            validate_draft(args.package, args.draft)
            print(
                json.dumps(
                    {
                        "state": "DRAFT_NOT_ACCEPTED",
                        "provenance_valid": True,
                        "publication_eligible": False,
                    }
                )
            )
        elif args.command == "triage":
            from .corpus import triage

            triage(args.manifest, args.out)
        elif args.command == "batch":
            from .corpus import batch

            rows = batch(args.manifest, args.out, args.ids.split(","))
            raise SystemExit(2 if any(r["state"] == "BLOCKED" for r in rows) else 0)
        elif args.command == "schema":
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(json.dumps(Artifact.model_json_schema(), indent=2) + "\n")
        elif args.command == "verify":
            artifact = Artifact.model_validate_json((args.package / "artifact.json").read_text())
            artifact = verify_package(artifact, args.package)
            print(
                json.dumps(
                    {
                        "state": artifact.state,
                        "accounted": artifact.page_accounting_complete,
                        "processed": artifact.processed_pages_complete,
                        "publication_eligible": False,
                    }
                )
            )
            raise SystemExit(2 if artifact.state == "BLOCKED" else 0)
        else:
            pages = {int(p.strip()) for p in args.pages.split(",")} if args.pages else None
            target = process(
                args.file,
                args.out,
                title=args.title,
                dpi=args.dpi,
                page_limit=args.page_limit,
                pages=pages,
            )
            artifact = Artifact.model_validate_json((target / "artifact.json").read_text())
            print(
                json.dumps(
                    {
                        "package": str(target),
                        "state": artifact.state,
                        "expected_pages": artifact.expected_pages,
                        "publication_eligible": False,
                    }
                )
            )
            # Successful packaging is not a quality pass. Holds have a distinct exit code.
            raise SystemExit(2 if artifact.state == "BLOCKED" else 0)
    except (ValueError, OSError) as error:
        # Never print document content, environment variables or parser error objects.
        print(
            json.dumps(
                {
                    "error": type(error).__name__,
                    "message": "Lab operation failed; no approval or publication occurred.",
                }
            )
        )
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()

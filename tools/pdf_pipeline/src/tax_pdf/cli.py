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
    args = parser.parse_args()
    try:
        if args.command == "benchmark":
            from .benchmark import benchmark

            benchmark(args.manifest, args.plan, args.out)
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

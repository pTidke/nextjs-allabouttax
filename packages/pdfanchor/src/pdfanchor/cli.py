"""Command line: `pdfanchor convert file.pdf --out dir`.

Exit codes: 0 everything accepted by rule; 2 files were written but something needs a
person; 1 the file could not be processed.
"""

import argparse
import json
import sys
from dataclasses import replace

from . import __version__
from .config import Config, Policy
from .model import Document
from .ocr import EngineUnavailable, available
from .pipeline import ConversionError, convert, write
from .policy import needs_review


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pdfanchor", description=__doc__.splitlines()[0])
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("convert", help="Convert a PDF into document.json, document.md and chunks.jsonl")
    run.add_argument("pdf")
    run.add_argument("--out", required=True)
    run.add_argument("--ocr", choices=["auto", "none"], default="auto")
    run.add_argument("--lang", default="eng", help="OCR languages joined by +, for example eng+hin")
    run.add_argument("--dpi", type=int, default=200)
    run.add_argument("--exclude-script", action="append", default=[], help="For example Deva")
    run.add_argument("--chunk-chars", type=int, default=1200)
    run.add_argument("--trust-native", action="store_true", help="Accept clean text-layer lines with no OCR cross-check")
    sub.add_parser("schema", help="Print the JSON schema of document.json")
    sub.add_parser("engines", help="List the OCR engines that can run here")
    args = parser.parse_args(argv)

    if args.command == "schema":
        print(json.dumps(Document.model_json_schema(), indent=2))
        return 0
    if args.command == "engines":
        for engine in available():
            print(engine.name, engine.version())
        return 0
    config = Config(
        dpi=args.dpi,
        languages=tuple(args.lang.split("+")),
        exclude_scripts=tuple(args.exclude_script),
        chunk_chars=args.chunk_chars,
    )
    if args.trust_native:
        config = replace(config, policy=Policy(accept_native_without_crosscheck=True))
    try:
        document = convert(args.pdf, config=config, engines=None if args.ocr == "auto" else [])
    except (ConversionError, EngineUnavailable, OSError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 1
    files = write(document, args.out, config)
    print(json.dumps({"summary": document.summary, "files": {k: str(v) for k, v in files.items()}}))
    return 2 if needs_review(document) else 0


if __name__ == "__main__":
    raise SystemExit(main())

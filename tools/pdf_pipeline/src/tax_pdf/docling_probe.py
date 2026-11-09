"""Optional CPU experiment, separate from the native lab and all publication.

Prepare downloads public model weights. Probe uses local weights and a byte
snapshot; raw provider output is NOT an accepted canonical document.
"""

import argparse
import hashlib
import importlib.metadata
import io
import json
import os
import time
from pathlib import Path


def hash_file(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def model_manifest(root):
    return {
        str(p.relative_to(root)): hash_file(p)
        for p in sorted(root.rglob("*"))
        if p.is_file()
        and not p.is_symlink()
        and p.name != "weights-manifest.json"
        and ".cache" not in p.parts
    }


def prepare(root: Path, languages: list[str]):
    from docling.utils.model_downloader import download_models

    root.mkdir(parents=True, exist_ok=True)
    download_models(
        output_dir=root,
        with_layout=True,
        with_tableformer=True,
        with_code_formula=False,
        with_picture_classifier=False,
        with_rapidocr=True,
        rapidocr_models=[f"onnxruntime:{language}" for language in languages],
        progress=False,
    )
    manifest = model_manifest(root)
    (root / "weights-manifest.json").write_text(
        json.dumps(
            {
                "docling_version": importlib.metadata.version("docling"),
                "languages": languages,
                "files": manifest,
            },
            indent=2,
        )
    )
    return {"model_files": len(manifest), "languages": languages, "download_only": True}


def probe(file: Path, models: Path, out: Path, start: int, end: int, language: str):
    if not 1 <= start <= end or end - start + 1 > 10 or file.stat().st_size > 100 * 1024**2:
        raise ValueError("Probe permits at most ten selected pages and a 100 MiB file")
    if out.exists():
        raise ValueError("Use a new output directory for each provider experiment")
    manifest = json.loads((models / "weights-manifest.json").read_text())
    if language not in manifest["languages"] or manifest["files"] != model_manifest(models):
        raise ValueError("Model weights or language differ from prepared manifest")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    import onnxruntime

    onnxruntime.disable_telemetry_events()
    from docling.datamodel.accelerator_options import AcceleratorOptions
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import OcrMode, PdfPipelineOptions, RapidOcrOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling_core.types.io import DocumentStream

    data = file.read_bytes()
    from .worker import preflight

    info = preflight(file)
    if info.get("error") or end > info["expected_pages"]:
        raise ValueError("Original page range could not be established")
    options = PdfPipelineOptions(
        artifacts_path=models,
        enable_remote_services=False,
        allow_external_plugins=False,
        do_ocr=True,
        do_table_structure=True,
        document_timeout=180,
        accelerator_options=AcceleratorOptions(device="cpu", num_threads=2),
        ocr_options=RapidOcrOptions(lang=[language], backend="onnxruntime", mode=OcrMode.FULL_PAGE),
    )
    converter = DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)}
    )
    began = time.monotonic()
    result = converter.convert(
        DocumentStream(name="source.pdf", stream=io.BytesIO(data)),
        page_range=(start, end),
        max_file_size=100 * 1024**2,
        max_num_pages=1000,
        raises_on_error=False,
    )
    raw = result.document.export_to_dict()
    returned = sorted(int(p) for p in raw.get("pages", {}))
    expected = list(range(start, end + 1))
    report = {
        "schema_version": "0.1.0",
        "state": "EXPERIMENTAL_NOT_ACCEPTED",
        "publication_eligible": False,
        "source_sha256": hashlib.sha256(data).hexdigest(),
        "source_pages": info["expected_pages"],
        "requested_pages": expected,
        "returned_pages": returned,
        "requested_pages_complete": returned == expected,
        "whole_document_processed": returned == list(range(1, info["expected_pages"] + 1)),
        "provider_status": str(result.status.value),
        "language_config": language,
        "ocr_mode": "full_page",
        "elapsed_seconds": round(time.monotonic() - began, 2),
        "engine_versions": {
            p: importlib.metadata.version(p)
            for p in [
                "docling",
                "docling-core",
                "docling-parse",
                "rapidocr",
                "onnxruntime",
                "torch",
            ]
        },
        "weights_manifest_sha256": hash_file(models / "weights-manifest.json"),
        "limitations": [
            "Raw provider output is not mapped into the canonical contract yet.",
            "No legal or extraction acceptance; accuracy needs labelled comparison.",
            "Only the configured OCR language is under test.",
            "Application remote services disabled; OS network sandbox not enforced.",
        ],
    }
    out.mkdir(parents=True)
    (out / "raw-docling.json").write_text(
        json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf8"
    )
    (out / "candidate.md").write_text(result.document.export_to_markdown(), encoding="utf8")
    (out / "probe.json").write_text(json.dumps(report, indent=2))
    return report


def probe_image(file: Path, models: Path, out: Path, language: str):
    """Image-only input: no PDF, embedded text, source cells or reference enters Docling."""
    from PIL import Image

    if out.exists() or file.stat().st_size > 40 * 1024**2:
        raise ValueError("Fresh output and a bounded PNG are required")
    data = file.read_bytes()
    with Image.open(io.BytesIO(data)) as image:
        width, height = image.size
        if (
            image.format != "PNG"
            or getattr(image, "n_frames", 1) != 1
            or not 0 < width * height <= 16_000_000
        ):
            raise ValueError("Only a single bounded PNG may enter the image probe")
        image.verify()
    manifest = json.loads((models / "weights-manifest.json").read_text())
    if (
        language not in manifest["languages"]
        or manifest["files"] != model_manifest(models)
        or manifest["docling_version"] != importlib.metadata.version("docling")
    ):
        raise ValueError("Prepared image models/language/version do not match")
    os.environ.update(
        HF_HUB_OFFLINE="1",
        HF_HUB_DISABLE_IMPLICIT_TOKEN="1",
        TOKENIZERS_PARALLELISM="false",
    )
    import onnxruntime

    onnxruntime.disable_telemetry_events()
    from docling.datamodel.accelerator_options import AcceleratorOptions
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import OcrMode, PdfPipelineOptions, RapidOcrOptions
    from docling.document_converter import DocumentConverter, ImageFormatOption
    from docling_core.types.io import DocumentStream

    options = PdfPipelineOptions(
        artifacts_path=models,
        enable_remote_services=False,
        allow_external_plugins=False,
        do_ocr=True,
        do_table_structure=True,
        document_timeout=180,
        accelerator_options=AcceleratorOptions(device="cpu", num_threads=2),
        ocr_options=RapidOcrOptions(lang=[language], backend="onnxruntime", mode=OcrMode.FULL_PAGE),
    )
    converter = DocumentConverter(
        allowed_formats=[InputFormat.IMAGE],
        format_options={InputFormat.IMAGE: ImageFormatOption(pipeline_options=options)},
    )
    began = time.monotonic()
    result = converter.convert(
        DocumentStream(name="pixels.png", stream=io.BytesIO(data)),
        max_file_size=40 * 1024**2,
        max_num_pages=1,
        raises_on_error=False,
    )
    raw = result.document.export_to_dict()
    report = {
        "state": "EXPERIMENTAL_NOT_ACCEPTED",
        "publication_eligible": False,
        "input_kind": "PNG_PIXELS_ONLY",
        "image_sha256": hashlib.sha256(data).hexdigest(),
        "width": width,
        "height": height,
        "returned_pages": sorted(int(p) for p in raw.get("pages", {})),
        "provider_status": str(result.status.value),
        "language_config": language,
        "ocr_mode": "full_page",
        "elapsed_seconds": round(time.monotonic() - began, 2),
        "engine_versions": {
            p: importlib.metadata.version(p)
            for p in ["docling", "docling-core", "rapidocr", "onnxruntime", "torch"]
        },
        "weights_manifest_sha256": hash_file(models / "weights-manifest.json"),
        "limitations": [
            "Only the configured English image OCR/table pipeline is under test.",
            "Raw provider cells, headers, spans and order are not accepted structure.",
            "Application remote services disabled; OS network sandbox not enforced.",
        ],
    }
    out.mkdir(parents=True)
    (out / "raw-docling.json").write_text(json.dumps(raw, ensure_ascii=False, indent=2) + "\n")
    (out / "candidate.md").write_text(result.document.export_to_markdown(), encoding="utf8")
    (out / "probe.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(
        description="Optional Docling CPU experiment. Never accepts or publishes documents."
    )
    parser.add_argument("mode", choices=["prepare", "probe", "image-probe"])
    parser.add_argument("--models", type=Path, required=True)
    parser.add_argument("--languages", default="en")
    parser.add_argument("--file", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--start", type=int, default=1)
    parser.add_argument("--end", type=int, default=1)
    args = parser.parse_args()
    cache = args.models.resolve().parent / "model-cache"
    os.environ["HF_HOME"] = str(cache)
    os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ.pop("HF_TOKEN", None)
    os.environ.pop("HUGGING_FACE_HUB_TOKEN", None)
    try:
        if args.mode == "prepare":
            result = prepare(args.models.resolve(), args.languages.split(","))
        elif args.mode == "image-probe":
            if not args.file or not args.out:
                raise ValueError("Image probe requires file and output directory")
            result = probe_image(args.file, args.models.resolve(), args.out, args.languages)
        else:
            if not args.file or not args.out:
                raise ValueError("Probe requires file and output directory")
            result = probe(
                args.file, args.models.resolve(), args.out, args.start, args.end, args.languages
            )
        print(json.dumps(result, indent=2))
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

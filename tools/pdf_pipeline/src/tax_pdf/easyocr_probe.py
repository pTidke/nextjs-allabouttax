"""Optional English EasyOCR experiment. Local weights, no reviewer text input."""

import argparse
import hashlib
import importlib.metadata
import io
import json
import math
import os
import time
import urllib.request
import zipfile
from pathlib import Path

from PIL import Image

from .ocr_compare import digest

MODELS = {
    "craft_mlt_25k.pth": {
        "url": "https://github.com/JaidedAI/EasyOCR/releases/download/pre-v1.1.6/craft_mlt_25k.zip",
        "sha256": "4a5efbfb48b4081100544e75e1e2b57f8de3d84f213004b14b85fd4b3748db17",
    },
    "english_g2.pth": {
        "url": "https://github.com/JaidedAI/EasyOCR/releases/download/v1.3/english_g2.zip",
        "sha256": "e2272681d9d67a04e2dff396b6e95077bc19001f8f6d3593c307b9852e1c29e8",
    },
}


def prepare(root):
    root.mkdir(parents=True, exist_ok=True)
    files = {}
    for name, spec in MODELS.items():
        target = root / name
        if not target.exists():
            with urllib.request.urlopen(spec["url"], timeout=60) as response:
                data = response.read(120 * 1024**2 + 1)
            if len(data) > 120 * 1024**2:
                raise ValueError("Model download exceeds budget")
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                info = archive.getinfo(name)
                if info.file_size > 100 * 1024**2:
                    raise ValueError("Model exceeds decompression budget")
                weights = archive.read(name)  # Never extract arbitrary archive paths.
            if hashlib.sha256(weights).hexdigest() != spec["sha256"]:
                raise ValueError("Downloaded model differs from pinned weights")
            target.write_bytes(weights)
        if target.is_symlink() or digest(target) != spec["sha256"]:
            raise ValueError("Model differs from pinned weights")
        files[name] = {**spec, "bytes": target.stat().st_size}
    manifest = {"easyocr_version": "1.7.2", "languages": ["en"], "files": files}
    (root / "weights-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def verify_models(root):
    manifest = json.loads((root / "weights-manifest.json").read_text())
    if manifest.get("easyocr_version") != "1.7.2" or manifest.get("languages") != ["en"]:
        raise ValueError("Unexpected EasyOCR model configuration")
    for name, spec in MODELS.items():
        path = root / name
        if path.is_symlink() or digest(path) != spec["sha256"]:
            raise ValueError("EasyOCR weights changed")
        if manifest["files"][name]["sha256"] != spec["sha256"]:
            raise ValueError("EasyOCR weight manifest changed")
    return digest(root / "weights-manifest.json")


def convert_rows(rows, width, height):
    """Retain provider polygons and order; expose boxes for source highlighting."""
    if len(rows) > 3000:
        raise ValueError("OCR region budget exceeded")
    blocks, preserved = [], []
    for polygon, text, confidence in rows:
        points = [[float(x), float(y)] for x, y in polygon]
        confidence = float(confidence)
        if (
            len(points) != 4
            or not all(math.isfinite(v) for p in points for v in p)
            or not all(0 <= x <= width and 0 <= y <= height for x, y in points)
            or not math.isfinite(confidence)
            or not 0 <= confidence <= 1
            or not isinstance(text, str)
        ):
            raise ValueError("Invalid EasyOCR result geometry/confidence")
        box = {
            "x0": min(p[0] for p in points),
            "y0": min(p[1] for p in points),
            "x1": max(p[0] for p in points),
            "y1": max(p[1] for p in points),
        }
        if box["x1"] <= box["x0"] or box["y1"] <= box["y0"]:
            raise ValueError("Empty EasyOCR region")
        preserved.append({"polygon": points, "text": text, "confidence": confidence})
        blocks.append(
            {
                "paragraphs": [
                    {"lines": [{"text": text, "bbox": box, "confidence": confidence * 100}]}
                ]
            }
        )
    return preserved, blocks


def probe(models, job, out):
    if out.exists():
        raise ValueError("Use a fresh output file")
    model_hash = verify_models(models)
    requests = json.loads(job.read_text())
    if not isinstance(requests, list) or not 1 <= len(requests) <= 10:
        raise ValueError("Probe permits 1–10 local image requests")
    images = []
    for request in requests:
        if set(request) != {"id", "image"} or not isinstance(request["id"], str):
            raise ValueError("Only image paths and request IDs may enter the OCR worker")
        path = Path(request["image"])
        if not path.is_absolute() or path.stat().st_size > 40 * 1024**2:
            raise ValueError("Invalid image path/byte budget")
        data = path.read_bytes()
        with Image.open(io.BytesIO(data)) as im:
            if im.format != "PNG" or not 0 < im.width * im.height <= 16000000:
                raise ValueError("PNG pixel budget exceeded")
            im.verify()
        images.append((request["id"], data))
    if len({r[0] for r in images}) != len(images):
        raise ValueError("Duplicate request IDs")
    os.environ["EASYOCR_MODULE_PATH"] = str(models)
    os.environ["TORCH_HOME"] = str(models / "torch-cache")
    import easyocr
    import torch

    if importlib.metadata.version("easyocr") != "1.7.2":
        raise ValueError("Unexpected EasyOCR version")
    torch.set_num_threads(2)
    network_dir = models / "empty-user-network"
    network_dir.mkdir(exist_ok=True)
    if list(network_dir.iterdir()):
        raise ValueError("Custom network code is not permitted")
    reader = easyocr.Reader(
        ["en"],
        gpu=False,
        model_storage_directory=str(models),
        user_network_directory=str(network_dir),
        download_enabled=False,
        verbose=False,
    )
    records = []
    for request_id, data in images:
        began = time.monotonic()
        with Image.open(io.BytesIO(data)) as im:
            width, height = im.size
        rows = reader.readtext(
            data,
            detail=1,
            paragraph=False,
            workers=0,
            batch_size=1,
            canvas_size=2560,
            decoder="greedy",
        )
        preserved, blocks = convert_rows(rows, width, height)
        records.append(
            {
                "id": request_id,
                "image_sha256": hashlib.sha256(data).hexdigest(),
                "width": width,
                "height": height,
                "languages": ["eng"],
                "text": "\n".join(r["text"] for r in preserved),
                "blocks": blocks,
                "provider_regions": preserved,
                "elapsed_seconds": round(time.monotonic() - began, 2),
                "state": "EXPERIMENTAL_NOT_ACCEPTED",
                "publication_eligible": False,
            }
        )
    report = {
        "state": "EXPERIMENTAL_NOT_ACCEPTED",
        "publication_eligible": False,
        "engine": "EasyOCR",
        "languages": ["en"],
        "device": "cpu",
        "threads": 2,
        "download_enabled": False,
        "custom_networks_enabled": False,
        "model_manifest_sha256": model_hash,
        "versions": {
            p: importlib.metadata.version(p)
            for p in [
                "easyocr",
                "torch",
                "torchvision",
                "opencv-python-headless",
                "numpy",
                "Pillow",
            ]
        },
        "records": records,
    }
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    return {"state": report["state"], "images": len(records), "publication_eligible": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["prepare", "probe"])
    parser.add_argument("--models", type=Path, required=True)
    parser.add_argument("--job", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    try:
        if args.mode == "prepare":
            prepare(args.models.resolve())
            result = {"downloaded_or_verified_models": 2, "languages": ["en"]}
        else:
            if not args.job or not args.out:
                raise ValueError("Probe requires job and output paths")
            result = probe(args.models.resolve(), args.job, args.out)
        print(json.dumps(result))
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

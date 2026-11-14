"""Bounded local orchestration. The generated package is never published to RAG."""

import hashlib
import importlib.metadata
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path

from . import __version__
from .models import Artifact, Issue, Page, assess


def child(mode: str, original: Path, *args, timeout: int) -> dict:
    env = {
        k: v
        for k, v in os.environ.items()
        if k in {"PATH", "SYSTEMROOT", "TMPDIR", "LANG", "PYTHONPATH", "VIRTUAL_ENV"}
    }
    env.update({"PYTHONNOUSERSITE": "1", "PYTHONUNBUFFERED": "1"})
    try:
        result = subprocess.run(
            [sys.executable, "-m", "tax_pdf.worker", mode, str(original), *(str(a) for a in args)],
            capture_output=True,
            timeout=timeout,
            env=env,
            check=False,
        )
        if result.returncode:
            return {"error": "PARSER_PROCESS_FAILED"}
        if len(result.stdout) > 40 * 1024 * 1024:
            return {"error": "PARSER_OUTPUT_LIMIT_EXCEEDED"}
        value = json.loads(result.stdout)
        return value if isinstance(value, dict) else {"error": "PARSER_PROTOCOL_FAILED"}
    except subprocess.TimeoutExpired:
        return {"error": "PARSER_TIMEOUT"}
    except (ValueError, OSError):
        return {"error": "PARSER_PROTOCOL_FAILED"}


def verify_package(artifact: Artifact, root: Path) -> Artifact:
    """Check the persisted source/render files, not just declared model fields."""
    artifact = assess(artifact)
    original = root / artifact.original
    checksum_ok = False
    if original.is_file():
        with original.open("rb") as stream:
            checksum_ok = (
                hashlib.file_digest(stream, "sha256").hexdigest() == artifact.source_sha256
            )
    if not checksum_ok:
        artifact.processed_pages_complete = False
        artifact.issues.append(
            Issue(
                code="ORIGINAL_CHECKSUM_MISMATCH",
                severity="blocking",
                message="Original bytes do not match the source manifest.",
            )
        )
    for page in artifact.pages:
        expected = f"pages/{page.number:04d}.png"
        if page.render and (page.render != expected or not (root / expected).is_file()):
            artifact.processed_pages_complete = False
            artifact.issues.append(
                Issue(
                    code="RENDER_MISSING",
                    severity="blocking",
                    message="Page image is missing or has an invalid artifact path.",
                    page=page.number,
                )
            )
        elif page.render:
            with (root / expected).open("rb") as stream:
                checksum = hashlib.file_digest(stream, "sha256").hexdigest()
            if checksum != page.render_sha256:
                artifact.processed_pages_complete = False
                artifact.issues.append(
                    Issue(
                        code="RENDER_CHECKSUM_MISMATCH",
                        severity="blocking",
                        message="Page image does not match the extraction revision.",
                        page=page.number,
                    )
                )
    if any(i.severity == "blocking" for i in artifact.issues):
        artifact.state = "BLOCKED"
    return artifact


def process(
    file: Path,
    output: Path,
    *,
    title: str | None = None,
    dpi: int = 120,
    page_limit: int = 1000,
    timeout: int = 50,
    total_timeout: int = 600,
    max_bytes: int = 100 * 1024**2,
    max_pixels: int = 16_000_000,
    max_processed_pages: int = 50,
    max_glyphs: int = 250000,
    pages: set[int] | None = None,
) -> Path:
    if (
        not 72 <= dpi <= 300
        or not 1 <= page_limit <= 1000
        or not 1 <= timeout <= 120
        or not 1 <= total_timeout <= 1800
        or not 1 <= max_processed_pages <= 100
        or not 1 <= max_glyphs <= 500000
    ):
        raise ValueError("Invalid lab processing limits")
    if not file.is_file() or file.stat().st_size > max_bytes:
        raise ValueError("Input is missing or exceeds the byte budget")
    output.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".processing-", dir=output))
    try:
        digest = hashlib.sha256()
        size = 0
        with file.open("rb") as src, (staging / "original.pdf").open("xb") as dst:
            while data := src.read(1024 * 1024):
                size += len(data)
                if size > max_bytes:
                    raise ValueError("Input grew beyond byte budget")
                digest.update(data)
                dst.write(data)
        (staging / "original.pdf").chmod(0o444)
        with (staging / "original.pdf").open("rb") as f:
            if f.read(5) != b"%PDF-":
                raise ValueError("Input does not have a PDF signature")
        (staging / "pages").mkdir()
        versions = {
            name: importlib.metadata.version(name)
            for name in ("pypdf", "pdfplumber", "pdfminer-six", "pypdfium2", "pydantic", "Pillow")
        }
        versions["python"] = platform.python_version()
        versions["platform"] = f"{platform.system()}-{platform.machine()}"
        code = hashlib.sha256()
        for source in sorted(Path(__file__).parent.glob("*.py")):
            code.update(source.name.encode())
            code.update(source.read_bytes())
        config = {
            "dpi": dpi,
            "page_limit": page_limit,
            "page_timeout_seconds": timeout,
            "total_timeout_seconds": total_timeout,
            "max_bytes": max_bytes,
            "max_render_pixels": max_pixels,
            "max_processed_pages": max_processed_pages,
            "max_glyphs": max_glyphs,
            "engine": "native-baseline",
            "pipeline_code_sha256": code.hexdigest(),
            "os_memory_limit_enforced": sys.platform.startswith("linux"),
            "network_sandbox_enforced": False,
            "selected_pages": ",".join(map(str, sorted(pages))) if pages is not None else "all",
        }
        fingerprint = hashlib.sha256(
            json.dumps(
                {
                    "source": digest.hexdigest(),
                    "versions": versions,
                    "config": config,
                    "pipeline": __version__,
                },
                sort_keys=True,
            ).encode()
        ).hexdigest()
        artifact = Artifact(
            pipeline_version=__version__,
            run_id=f"{digest.hexdigest()[:12]}-{time.time_ns()}",
            created_at=datetime.now(UTC).isoformat(),
            source_sha256=digest.hexdigest(),
            source_bytes=size,
            source_title=title or file.name,
            engine_versions=versions,
            config=config,
            fingerprint=fingerprint,
        )
        deadline = time.monotonic() + total_timeout
        info = child("preflight", staging / "original.pdf", timeout=min(timeout, total_timeout))
        if error := info.get("error"):
            artifact.issues.append(
                Issue(
                    code=error,
                    severity="blocking",
                    message="Preflight did not complete; do not infer document completeness.",
                )
            )
        else:
            artifact.expected_pages = info["expected_pages"]
            artifact.issues.extend(Issue(**i) for i in info["issues"])
            selected = pages if pages is not None else set(range(1, artifact.expected_pages + 1))
            if not selected or any(p < 1 or p > artifact.expected_pages for p in selected):
                raise ValueError("Selected pages must exist in the source")
            if artifact.expected_pages > page_limit:
                selected = set()
                artifact.issues.append(
                    Issue(
                        code="DOCUMENT_PAGE_BUDGET_EXCEEDED",
                        severity="blocking",
                        message="Document exceeds configured page budget; all original pages remain accounted for.",
                    )
                )
            attempted = 0
            glyphs_seen = 0
            for meta in info["pages"]:
                number = meta["number"]
                if (
                    number not in selected
                    or time.monotonic() >= deadline
                    or attempted >= max_processed_pages
                    or glyphs_seen >= max_glyphs
                ):
                    artifact.pages.append(
                        Page(
                            **meta,
                            status="not_processed",
                            issues=[
                                Issue(
                                    code="PAGE_NOT_PROCESSED",
                                    severity="blocking",
                                    message="This page was not included in this bounded lab run.",
                                    page=number,
                                )
                            ],
                        )
                    )
                    continue
                attempted += 1
                data = child(
                    "page",
                    staging / "original.pdf",
                    number,
                    staging,
                    dpi,
                    max_pixels,
                    timeout=max(1, min(timeout, int(deadline - time.monotonic()))),
                )
                if error := data.get("error"):
                    artifact.pages.append(
                        Page(
                            **meta,
                            status="failed",
                            issues=[
                                Issue(
                                    code=error,
                                    severity="blocking",
                                    message="Page processing failed; the original page remains in the manifest.",
                                    page=number,
                                )
                            ],
                        )
                    )
                else:
                    try:
                        page = Page.model_validate(data)
                        count = sum(len(b.glyphs) for b in page.blocks)
                        if glyphs_seen + count > max_glyphs:
                            glyphs_seen = max_glyphs
                            artifact.pages.append(
                                Page(
                                    **meta,
                                    status="not_processed",
                                    issues=[
                                        Issue(
                                            code="GLYPH_BUDGET_EXCEEDED",
                                            severity="blocking",
                                            message="Candidate exceeds the bounded lab memory budget; use smaller page groups.",
                                            page=number,
                                        )
                                    ],
                                )
                            )
                        else:
                            glyphs_seen += count
                            artifact.pages.append(page)
                    except ValueError:
                        artifact.pages.append(
                            Page(
                                **meta,
                                status="failed",
                                issues=[
                                    Issue(
                                        code="INVALID_PAGE_ARTIFACT",
                                        severity="blocking",
                                        message="Parser output failed the source geometry/schema contract.",
                                        page=number,
                                    )
                                ],
                            )
                        )
        artifact = verify_package(artifact, staging)
        (staging / "artifact.json").write_text(artifact.model_dump_json(indent=2), encoding="utf8")
        from .review import write_review

        write_review(artifact, staging)
        target = output / artifact.run_id
        staging.rename(target)
        return target
    except BaseException:
        shutil.rmtree(staging)
        raise

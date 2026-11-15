import hashlib
import html
import json
from pathlib import Path

from .models import Artifact
from .runner import child, process


def load_sources(manifest: Path):
    root = manifest.resolve().parent
    documents = json.loads(manifest.read_text())["documents"]
    for document in documents:
        file = (root / document["path"]).resolve()
        if not file.is_relative_to(root) or not file.is_file():
            raise ValueError("Corpus source path is outside the manifest directory")
        if file.stat().st_size > 100 * 1024**2:
            raise ValueError("Corpus original exceeds lab byte budget")
        with file.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != document["sha256"]:
                raise ValueError("Corpus source checksum mismatch")
        yield document, file


def triage(manifest: Path, output: Path):
    output.mkdir(parents=True, exist_ok=True)
    rows = []
    for source, file in load_sources(manifest):
        result = child("profile", file, timeout=50)
        row = {
            **source,
            "profile": result,
            "label_status": "UNLABELLED",
            "evaluation_split": "UNASSIGNED",
            "template_group": None,
        }
        rows.append(row)
        print(
            json.dumps(
                {
                    "sha256": source["sha256"],
                    "pages": result.get("expected_pages"),
                    "profile_error": result.get("error"),
                }
            ),
            flush=True,
        )
    result = {
        "schema_version": "0.1.0",
        "label_status": "PROVISIONAL_TRIAGE_ONLY",
        "documents": rows,
    }
    (output / "triage.json").write_text(json.dumps(result, indent=2))
    labels = []
    for row in rows:
        for page in row["profile"].get("pages", []):
            labels.append(
                {
                    "source_sha256": row["sha256"],
                    "page": page["page"],
                    "verified_by": None,
                    "expected_text": None,
                    "critical_tokens": [],
                    "reading_order": [],
                    "tables": [],
                    "source_regions": [],
                    "notes": "Unlabelled; machine profile is not ground truth.",
                }
            )
    (output / "annotation-template.jsonl").write_text("".join(json.dumps(x) + "\n" for x in labels))
    return result


def batch(manifest: Path, output: Path, prefixes: list[str]):
    documents = list(load_sources(manifest))
    selected = []
    for prefix in prefixes:
        if not prefix or len(prefix) < 8:
            raise ValueError("Choose source SHA-256 prefixes of at least eight characters")
        matches = [(s, p) for s, p in documents if s["sha256"].startswith(prefix)]
        if len(matches) != 1:
            raise ValueError("Source hash prefix must identify exactly one document")
        if matches[0][0]["sha256"] not in {s["sha256"] for s, _ in selected}:
            selected.append(matches[0])
    if not 1 <= len(selected) <= 15:
        raise ValueError("A lab batch contains one to fifteen documents")
    reports = []
    for source, file in selected:
        package = process(file, output / "packages", title=source["title"])
        a = Artifact.model_validate_json((package / "artifact.json").read_text())
        reports.append(
            {
                "title": source["title"],
                "source_sha256": source["sha256"],
                "source_url": source["url"],
                "package": str(package.relative_to(output)),
                "pages": a.expected_pages,
                "state": a.state,
                "accounted": a.page_accounting_complete,
                "processed_complete": a.processed_pages_complete,
                "tables": sum(len(p.tables) for p in a.pages),
                "issues": sorted(
                    {i.code for i in a.issues} | {i.code for p in a.pages for i in p.issues}
                ),
            }
        )
        print(json.dumps(reports[-1]), flush=True)
    (output / "batch.json").write_text(json.dumps(reports, indent=2))
    cards = []
    for r in reports:
        cards.append(
            f'<article><h2>{html.escape(r["title"])}</h2><p>{r["pages"]} pages · {r["tables"]} table candidates · <strong>{r["state"]}</strong></p><p>{html.escape(", ".join(r["issues"]))}</p><a href="{html.escape(r["package"], quote=True)}/review.html">Inspect extraction and original page regions →</a></article>'
        )
    (output / "index.html").write_text(
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><title>All About Tax · PDF processing laboratory</title><style>body{font:16px/1.6 system-ui;background:#f1f5f7;color:#183247;margin:0}header{background:#102d40;color:white;padding:30px}main{max-width:1100px;margin:auto;padding:24px}h1{margin:0;font-size:28px}article{background:white;border:1px solid #cfdae2;border-radius:10px;padding:24px;margin:18px 0}h2{font-size:19px;margin:0}a{color:#00735e}p{overflow-wrap:anywhere}.note{padding:16px;background:#fff3d6;border-left:4px solid #bc7a10}</style><header><h1>PDF processing laboratory</h1><p>First review packages · official public documents · production publication disabled</p></header><main><p class="note">Native extraction baseline. Scans, table structures and uncertain characters remain flagged. This is a technical review package, not approved tax knowledge.</p>'
        + "".join(cards)
        + "</main></html>",
        encoding="utf8",
    )
    return reports

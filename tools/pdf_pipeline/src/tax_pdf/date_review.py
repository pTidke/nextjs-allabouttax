"""Date/superscript review hints. Never repairs OCR or declares text clean."""

import calendar
import json
import re
import shutil
import tempfile
import time
from pathlib import Path

from PIL import Image

from .models import Artifact
from .ocr_compare import mapped_lines
from .reference_eval import digest, safe_file
from .review import escape
from .runner import verify_package
from .targeted_ocr import flatten_background

MONTHS = {name.lower(): i for i, name in enumerate(calendar.month_name) if name}
MONTHS.update({name.lower(): i for i, name in enumerate(calendar.month_abbr) if name})
MONTHS["sept"] = 9
MONTH_PATTERN = "|".join(sorted(MONTHS, key=len, reverse=True))
DATE = re.compile(
    rf"(?<![\w.])(?P<day>[0-9]{{1,6}})(?P<suffix>[^\s0-9,;:]{{0,4}})"
    rf"[ \t]+(?P<month>{MONTH_PATTERN})\.?[ \t]*,?[ \t]+"
    r"(?P<year>[12][0-9]{3})(?![0-9])",
    re.IGNORECASE,
)
SUPERSCRIPT = set("ˢᵗⁿᵈʳ¹²³⁴⁵⁶⁷⁸⁹⁰")


def date_matches(text):
    for match in DATE.finditer(text):
        # A numbered section followed by a month/year is not a day field.
        if len(match["day"]) > 2 and re.search(
            r"\b(section|clause|rule|para|paragraph|no\.)\s+$", text[: match.start()], re.IGNORECASE
        ):
            continue
        yield match


def date_findings(text):
    if not isinstance(text, str) or len(text) > 20000:
        raise ValueError("Date line text budget exceeded")
    findings = []
    dates = list(date_matches(text))
    for match in dates:
        day, month, year = int(match["day"]), MONTHS[match["month"].lower()], int(match["year"])
        suffix = match["suffix"]
        codes = []
        if len(match["day"]) > 2:
            codes.append("DAY_DIGIT_COUNT_REVIEW")
        if not 1 <= day <= calendar.monthrange(year, month)[1]:
            codes.append("CALENDAR_DATE_REVIEW")
        if suffix and suffix.lower() not in ("st", "nd", "rd", "th"):
            codes.append("DATE_SUFFIX_MARK_REVIEW")
        elif suffix:
            ordinal = (
                "th" if 10 <= day % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(day % 10, "th")
            )
            if suffix.lower() != ordinal:
                codes.append("ORDINAL_FORM_REVIEW")
        if any(c in SUPERSCRIPT for c in suffix):
            codes.append("DATE_SUPERSCRIPT_REVIEW")
        if codes:
            findings.append(
                {"start": match.start(), "end": match.end(), "raw": match[0], "codes": codes}
            )
        if len(findings) > 100:
            raise ValueError("Date warning budget exceeded")
    # A corrupted day/month can defeat the named-month parser entirely.
    # This cue deliberately abstains on numeric dates too; it never guesses
    # handwriting or interprets whether a date is legally applicable.
    cue = re.search(r"\bdated|\bdate\s*:", text, re.IGNORECASE)
    year = re.search(r"(?<![0-9])[12][0-9]{3}(?![0-9])", text[cue.end() :]) if cue else None
    if cue and year and not dates:
        end = cue.end() + year.end()
        findings.append(
            {
                "start": cue.start(),
                "end": end,
                "raw": text[cue.start() : end],
                "codes": ["DATE_CUE_UNPARSED_REVIEW"],
            }
        )
    return findings


def warnings(raw, page):
    from .date_regions import date_evidence

    return [r for r in date_evidence(raw, page) if r["codes"]]


def audit_dates(manifest_file, output):
    from .date_disagreement import compare_inputs
    from .date_regions import date_evidence

    if output.exists() or manifest_file.stat().st_size > 2 * 1024**2:
        raise ValueError("Use a fresh output and a bounded manifest")
    manifest = json.loads(manifest_file.read_text())
    inputs = manifest["inputs"]
    if not 1 <= len(inputs) <= 20 or len({x["id"] for x in inputs}) != len(inputs):
        raise ValueError("Invalid date input inventory")
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".date-review-", dir=output.parent))
    rows = []
    deadline = time.monotonic() + 60
    try:
        for i, item in enumerate(inputs):
            if time.monotonic() > deadline:
                raise ValueError("Date review wall budget exhausted")
            if item["preprocessing"] not in ("unchanged", "flattened"):
                raise ValueError("Only unrotated full-page date inputs are supported")
            artifact_file = safe_file(manifest_file.parent, item["package"] + "/artifact.json")
            if (
                artifact_file.stat().st_size > 40 * 1024**2
                or digest(artifact_file) != item["artifact_sha256"]
            ):
                raise ValueError("Date source artifact changed")
            artifact = Artifact.model_validate_json(artifact_file.read_text())
            verified = verify_package(artifact, artifact_file.parent)
            if verified.source_sha256 != item["source_sha256"] or any(
                x.code.endswith("CHECKSUM_MISMATCH") or x.code == "RENDER_MISSING"
                for x in verified.issues
            ):
                raise ValueError("Date original/render binding failed")
            pages = [p for p in artifact.pages if p.number == item["page"]]
            if len(pages) != 1 or not pages[0].render:
                raise ValueError("Date source page has no verified render")
            page = pages[0]
            render = safe_file(artifact_file.parent, page.render)
            image = safe_file(manifest_file.parent, item["image"])
            if image.stat().st_size > 40 * 1024**2 or digest(image) != item["image_sha256"]:
                raise ValueError("Date input pixels changed")
            with Image.open(image) as supplied, Image.open(render) as source:
                if supplied.size != source.size or not 0 < source.width * source.height <= 16000000:
                    raise ValueError("Date image dimensions do not map to source")
                if item["preprocessing"] == "flattened":
                    with flatten_background(source) as expected, supplied.convert("L") as observed:
                        if (
                            supplied.mode != expected.mode
                            or expected.tobytes() != observed.tobytes()
                        ):
                            raise ValueError("Flattened pixels do not derive from the source")
            if item["preprocessing"] == "unchanged" and digest(image) != page.render_sha256:
                raise ValueError("Unchanged input is not the source render")
            image_name, source_name = f"input-{i}.png", f"source-{i}.png"
            shutil.copyfile(image, staging / image_name)
            shutil.copyfile(render, staging / source_name)
            row = {
                **item,
                "image": image_name,
                "source_image": source_name,
                "source_render_sha256": page.render_sha256,
                "state": "NOT_ASSESSED",
                "warnings": [],
                "date_evidence": [],
                "clean": None,
                "publication_eligible": False,
            }
            if item["state"] == "FAILED":
                row["error"] = "OCR_FAILED_NOT_ASSESSED"
            elif item["state"] == "EXPERIMENTAL_NOT_ACCEPTED":
                raw_file = safe_file(manifest_file.parent, item["raw"])
                if raw_file.stat().st_size > 20 * 1024**2 or digest(raw_file) != item["raw_sha256"]:
                    raise ValueError("Date raw OCR changed")
                raw = json.loads(raw_file.read_text())
                if not isinstance(raw.get("text"), str) or len(raw["text"]) > 1000000:
                    raise ValueError("Date raw text budget exceeded")
                if (
                    raw.get("image_sha256") != item["image_sha256"]
                    or raw.get("state") != "EXPERIMENTAL_NOT_ACCEPTED"
                    or raw.get("publication_eligible") is not False
                ):
                    raise ValueError("Date OCR is not bound to the candidate image")
                with Image.open(image) as supplied:
                    if (raw.get("width"), raw.get("height")) != supplied.size:
                        raise ValueError("Date OCR dimensions changed")
                row["date_evidence"] = date_evidence(raw, page)
                row["warnings"] = [r for r in row["date_evidence"] if r["codes"]]
                if len(row["warnings"]) > 100:
                    raise ValueError("Date warning budget exceeded")
                with Image.open(render) as source:
                    for j, warning in enumerate(row["date_evidence"]):
                        b = warning["image_bbox"]
                        crop = [
                            max(0, int(b["x0"]) - 8),
                            max(0, int(b["y0"]) - 8),
                            min(source.width, int(b["x1"]) + 8),
                            min(source.height, int(b["y1"]) + 8),
                        ]
                        name = f"warning-{i}-{j}.png"
                        with source.crop(crop) as region:
                            region.save(staging / name)
                        warning.update(
                            source_crop=name,
                            source_image_crop=crop,
                            source_crop_sha256=digest(staging / name),
                        )
                row["text"] = raw["text"]
                row["state"] = "REVIEW_REQUIRED" if row["warnings"] else "NO_RULE_HITS_NOT_CLEAN"
                if not mapped_lines(raw, page):
                    row["state"] = "EMPTY_OCR_NOT_ASSESSED"
                raw_name = f"raw-{i}.json"
                shutil.copyfile(raw_file, staging / raw_name)
                row["raw"] = raw_name
            else:
                raise ValueError("Unknown date OCR attempt state")
            rows.append(row)
        report = {
            "schema_version": "0.1.0",
            "state": "EXPERIMENTAL_NOT_ACCEPTED",
            "publication_eligible": False,
            "manifest_sha256": digest(manifest_file),
            "code_sha256": digest(Path(__file__)),
            "inputs": rows,
            "warning_count": sum(len(r["warnings"]) for r in rows),
            "comparisons": compare_inputs(rows),
            "dependency_sha256": {
                name: digest(Path(__file__).with_name(name))
                for name in (
                    "date_regions.py",
                    "date_disagreement.py",
                    "targeted_ocr.py",
                    "ocr_compare.py",
                )
            },
            "cohort": manifest.get("cohort", {}),
            "accuracy": None,
            "notes": [
                "Warnings are independent of confidence. Literal date spans and source geometry are preserved; no replacements are supplied.",
                "An asterisk may be a real footnote. Nonstandard ordinals may exist in the source. Verify the original rather than automatically repairing text.",
                "No warning is not a clean verdict. Plausible wrong digits/names, Hindi dates, numeric date order, other symbols and legal date roles are not covered. Up to three nearby lines in one provider paragraph may form a search window; exact source fragments are retained and reading order stays unverified. Unparsed dated/date: cues are held for source review, including valid numeric dates.",
                "Spatial comparisons preserve disagreements, missing candidates and ambiguous alignment. Identical surface text and multiple variants do not prove correctness or engine independence. No candidate is selected.",
                "This is a limited English named-month date checker, not a complete quality gate, accuracy score or publication approval.",
            ],
        }
        (staging / "date-review.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n"
        )
        write_html(report, staging)
        staging.rename(output)
        return report
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def write_html(report, output):
    messages = {
        "DAY_DIGIT_COUNT_REVIEW": "The extracted day has too many digits.",
        "DATE_SUFFIX_MARK_REVIEW": "A mark may have replaced a date ending, or may be a real footnote.",
        "ORDINAL_FORM_REVIEW": "The date ending looks unusual.",
        "CALENDAR_DATE_REVIEW": "This day and month do not form a valid calendar date.",
        "DATE_SUPERSCRIPT_REVIEW": "Check the raised letters or digits against the scan.",
        "DATE_CUE_UNPARSED_REVIEW": "This line refers to a date that the checker cannot read reliably.",
    }
    states = {
        "REVIEW_REQUIRED": "Needs source review",
        "NO_RULE_HITS_NOT_CLEAN": "No rule matched; extraction remains unverified",
        "EMPTY_OCR_NOT_ASSESSED": "No text returned; not assessed",
        "NOT_ASSESSED": "OCR unavailable; not assessed",
    }
    sections = []
    for i, row in enumerate(report["inputs"]):
        notes = "".join(
            f'<li><strong>{escape(w["raw"])}</strong> — {escape(" ".join(messages[c] for c in w["codes"]))} OCR line confidence {w["line_confidence"]:.0f}. Compare with the original; no correction suggested.<img class="date-crop" src="{w["source_crop"]}" alt="Unchanged source date line"></li>'
            for w in row["warnings"]
        )
        sections.append(
            f'<article id="case-{i}"><h2>{escape(row["title"])}</h2><p>{escape(row["variant"])} · {states[row["state"]]}</p><ul>{notes}</ul><div class="compare"><a href="{row["source_image"]}"><img loading="lazy" src="{row["source_image"]}" alt="Original source page"></a><pre>{escape(row.get("text", "OCR unavailable; not assessed"))}</pre></div></article>'
        )
    comparison_html = []
    inputs = {r["id"]: r for r in report["inputs"]}
    explanations = {
        "DATE_OCR_DISAGREEMENT": "The OCR readings differ at overlapping source locations.",
        "UNMATCHED_DATE_REGION": "A date region has no matching candidate. This may reflect missing OCR or a parsing/layout limitation.",
        "AMBIGUOUS_DATE_ALIGNMENT": "More than one date could match this location; the association needs review.",
    }
    for comparison in report["comparisons"]:
        left, right = (inputs[comparison[k]] for k in ("left_input", "right_input"))
        items = []
        for flag in comparison["flags"]:
            sides = []
            for key, row in (("left", left), ("right", right)):
                dates = {d["id"]: d for d in row["date_evidence"]}
                sides.append(
                    "<div>"
                    + (
                        "".join(
                            f'<p>{escape(dates[identity]["raw"])}</p><img loading="lazy" src="{dates[identity]["source_crop"]}" class="date-crop" alt="Original date region">'
                            for identity in flag[key]
                        )
                        or "<p>No matching date candidate</p>"
                    )
                    + "</div>"
                )
            items.append(
                f'<p>{explanations[flag["kind"]]} Neither reading is selected.</p><div class="compare">{sides[0]}{sides[1]}</div>'
            )
        comparison_html.append(
            f"<details><summary>{escape(left['variant'])} / {escape(right['variant'])} — {len(comparison['flags'])} review flags</summary><p>{escape(comparison['state'])}. Identical text is not proof of correctness or engine independence.</p>{''.join(items)}</details>"
        )
    (output / "index.html").write_text(
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'self\'; style-src \'self\'; base-uri \'none\'; form-action \'none\'"><title>Date review warnings</title><link rel="stylesheet" href="review.css"><header><h1>Date and superscript review warnings</h1><p>Raw text preserved · no automatic corrections · publication disabled</p></header><main><p class="notice">'
        + str(report["warning_count"])
        + ' warnings. A warning asks for source comparison. No warnings does not mean the extraction is correct. All variants remain separate.</p><p><a href="date-review.json">Evidence and diagnostics</a></p>'
        + '<article id="differences"><h2>Compare OCR readings</h2><p>Spatial matches are review hints. Missing or ambiguous candidates remain unresolved.</p>'
        + "".join(comparison_html)
        + "</article>"
        + "".join(sections)
        + "</main></html>"
    )
    (output / "review.css").write_text(
        "body{margin:0;background:#f3f6f7;color:#183344;font:16px/1.6 system-ui}header{background:#102f40;color:white;padding:28px}main{max-width:1350px;margin:auto;padding:24px}article{background:white;border:1px solid #ccdce2;margin:20px 0;padding:20px}.notice{background:#fff0d6;padding:16px}.compare{display:grid;grid-template-columns:1fr 1fr;gap:22px}img{width:100%;border:1px solid #ccdce2}img.date-crop{display:block;width:auto;max-width:100%;max-height:180px;object-fit:contain}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}a{color:#00745d}@media(max-width:800px){.compare{grid-template-columns:1fr}}"
    )

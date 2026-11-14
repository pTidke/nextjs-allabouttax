import json
from copy import deepcopy

import pytest
from PIL import Image

from tax_pdf import date_review as module
from tax_pdf.fixtures import native_bytes
from tax_pdf.models import Page
from tax_pdf.reference_eval import digest
from tax_pdf.runner import process


@pytest.mark.parametrize(
    "text,codes",
    [
        ("New Delhi, dated the 31* March, 2026", ["DATE_SUFFIX_MARK_REVIEW"]),
        ("31st March, 2026", []),
        ("New Delhi, datedgq Detober, 2025", ["DATE_CUE_UNPARSED_REVIEW"]),
        ("Circular dated 29.10.2025", ["DATE_CUE_UNPARSED_REVIEW"]),
        ("New Delhi, dated the 31st March, 2026", []),
        ("This was updated in 2025", []),
        ("21th March 2026", ["ORDINAL_FORM_REVIEW"]),
        ("11st March 2026", ["ORDINAL_FORM_REVIEW"]),
        ("13rd March 2026", ["ORDINAL_FORM_REVIEW"]),
        ("22nd March 2026", []),
        ("23rd March 2026", []),
        ("30th September, 2025", []),
        ("29 Feb. 2024", []),
        ("29 February 2025", ["CALENDAR_DATE_REVIEW"]),
        ("31 April, 2026", ["CALENDAR_DATE_REVIEW"]),
        ("0 March 2026", ["CALENDAR_DATE_REVIEW"]),
        ("31ˢᵗ March, 2026", ["DATE_SUFFIX_MARK_REVIEW", "DATE_SUPERSCRIPT_REVIEW"]),
        ("31* October 2025 (asterisk denotes a genuine footnote)", ["DATE_SUFFIX_MARK_REVIEW"]),
        ("31 October 2025", []),
        ("Section 119. March, 2026", []),
        ("31/04/2026", []),  # numeric order deliberately outside the first rules
        ("३१ मार्च २०२६", []),  # Hindi grammar is outside the first rules
        ("31\nst March 2026", []),  # cross-line date fragments remain uncovered
    ],
)
def test_literal_date_rules(text, codes):
    found = module.date_findings(text)
    assert [c for issue in found for c in issue["codes"]] == codes
    for issue in found:
        assert text[issue["start"] : issue["end"]] == issue["raw"]
        assert "replacement" not in issue


def raw_candidate(width, height, checksum, text="New Delhi, dated the 31* March, 2026"):
    return {
        "state": "EXPERIMENTAL_NOT_ACCEPTED",
        "publication_eligible": False,
        "image_sha256": checksum,
        "width": width,
        "height": height,
        "languages": ["eng"],
        "text": text,
        "blocks": [
            {
                "paragraphs": [
                    {
                        "lines": [
                            {
                                "text": text,
                                "confidence": 99,
                                "bbox": {"x0": 1, "y0": 2, "x1": width - 1, "y1": 20},
                            }
                        ]
                    }
                ]
            }
        ],
    }


def fixture(tmp_path):
    pdf = tmp_path / "input.pdf"
    pdf.write_bytes(native_bytes())
    package = process(pdf, tmp_path / "packages", dpi=72)
    artifact_file = package / "artifact.json"
    artifact = json.loads(artifact_file.read_text())
    image = package / artifact["pages"][0]["render"]
    with Image.open(image) as im:
        raw = raw_candidate(im.width, im.height, digest(image))
    raw_file = tmp_path / "raw.json"
    raw_file.write_text(json.dumps(raw))
    item = {
        "id": "control",
        "title": "<script>title</script>",
        "variant": "unchanged English",
        "package": str(package.relative_to(tmp_path)),
        "artifact_sha256": digest(artifact_file),
        "source_sha256": digest(pdf),
        "page": 1,
        "preprocessing": "unchanged",
        "image": str(image.relative_to(tmp_path)),
        "image_sha256": digest(image),
        "state": "EXPERIMENTAL_NOT_ACCEPTED",
        "raw": "raw.json",
        "raw_sha256": digest(raw_file),
    }
    manifest = tmp_path / "inputs.json"
    manifest.write_text(json.dumps({"inputs": [item]}))
    return manifest, item, raw


def test_high_confidence_error_preserves_text_span_and_source_coordinates():
    raw = raw_candidate(400, 200, "unused")
    before = deepcopy(raw)
    findings = module.warnings(raw, Page(number=1, width=200, height=100, status="ocr_required"))
    assert len(findings) == 1 and findings[0]["line_confidence"] == 99
    assert findings[0]["source_bbox"] == {"x0": 0.5, "top": 1, "x1": 199.5, "bottom": 10}
    assert findings[0]["suggested_replacement"] is None
    assert raw == before
    raw["blocks"][0]["paragraphs"][0]["lines"][0]["confidence"] = float("nan")
    with pytest.raises(ValueError):
        module.warnings(raw, Page(number=1, width=200, height=100, status="ocr_required"))


def test_audit_keeps_every_state_and_separates_no_hits_from_clean(tmp_path):
    manifest, item, raw = fixture(tmp_path)
    inputs = [item]
    for identity, text, blocks in [("ordinary", "31st March 2026", None), ("empty", "", [])]:
        candidate = deepcopy(raw)
        candidate["text"] = text
        if blocks is not None:
            candidate["blocks"] = blocks
        else:
            candidate["blocks"][0]["paragraphs"][0]["lines"][0]["text"] = text
        path = tmp_path / (identity + ".json")
        path.write_text(json.dumps(candidate))
        inputs.append({**item, "id": identity, "raw": path.name, "raw_sha256": digest(path)})
    inputs.append({**item, "id": "failed", "state": "FAILED", "raw": None, "raw_sha256": None})
    manifest.write_text(json.dumps({"inputs": inputs}))
    out = tmp_path / "review"
    result = module.audit_dates(manifest, out)
    assert [r["state"] for r in result["inputs"]] == [
        "REVIEW_REQUIRED",
        "NO_RULE_HITS_NOT_CLEAN",
        "EMPTY_OCR_NOT_ASSESSED",
        "NOT_ASSESSED",
    ]
    assert all(r["clean"] is None and r["publication_eligible"] is False for r in result["inputs"])
    assert result["accuracy"] is None and result["warning_count"] == 1
    assert (out / "raw-0.json").read_text() == (tmp_path / "raw.json").read_text()
    assert (out / "warning-0-0.png").is_file()
    html = (out / "index.html").read_text()
    assert "<script>title</script>" not in html and "&lt;script&gt;" in html
    with pytest.raises(ValueError):
        module.audit_dates(manifest, out)


@pytest.mark.parametrize("change", ["source", "raw", "image", "flattened", "escape", "ocr_binding"])
def test_changed_or_unbound_evidence_is_rejected(tmp_path, change):
    manifest, item, raw = fixture(tmp_path)
    if change == "source":
        item["source_sha256"] = "0" * 64
    elif change == "raw":
        (tmp_path / "raw.json").write_text("{}")
    elif change == "image":
        item["image_sha256"] = "0" * 64
    elif change == "flattened":
        item["preprocessing"] = "flattened"  # source pixels are not the deterministic derivative
    elif change == "escape":
        item["raw"] = "../outside.json"
    else:
        raw["image_sha256"] = "0" * 64
        (tmp_path / "raw.json").write_text(json.dumps(raw))
        item["raw_sha256"] = digest(tmp_path / "raw.json")
    manifest.write_text(json.dumps({"inputs": [item]}))
    with pytest.raises(ValueError):
        module.audit_dates(manifest, tmp_path / "review")
    assert not (tmp_path / "review").exists()


def test_warning_and_text_budgets_are_enforced():
    with pytest.raises(ValueError):
        module.date_findings("x" * 20001)
    with pytest.raises(ValueError):
        module.date_findings("31* March 2026; " * 101)


def test_flattened_input_is_recreated_from_original_pixels(tmp_path):
    manifest, item, raw = fixture(tmp_path)
    with Image.open(tmp_path / item["image"]) as source:
        with module.flatten_background(source) as flattened:
            flattened.save(tmp_path / "flat.png")
    item.update(
        preprocessing="flattened", image="flat.png", image_sha256=digest(tmp_path / "flat.png")
    )
    raw["image_sha256"] = item["image_sha256"]
    (tmp_path / "raw.json").write_text(json.dumps(raw))
    item["raw_sha256"] = digest(tmp_path / "raw.json")
    manifest.write_text(json.dumps({"inputs": [item]}))
    result = module.audit_dates(manifest, tmp_path / "review")
    assert result["warning_count"] == 1

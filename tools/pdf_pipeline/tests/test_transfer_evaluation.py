import json
from copy import deepcopy

import pytest
from PIL import Image

from tax_pdf import easyocr_probe
from tax_pdf import transfer_evaluation as module
from tax_pdf.fixtures import native_bytes
from tax_pdf.models import Page
from tax_pdf.reference_eval import digest

SHA = "a" * 64


@pytest.mark.parametrize(
    "count,native,ocr",
    [(1, [1], [1]), (2, [1, 2], [1, 2]), (3, [1, 2, 3], [1, 3]), (41, [1, 21, 41], [1, 41])],
)
def test_page_selection_is_fixed_before_observing_extraction(count, native, ocr):
    assert module.selected_pages(count) == (native, ocr)
    for invalid in [True, 0, 1001, 1.5, None]:
        with pytest.raises(ValueError):
            module.selected_pages(invalid)


def test_literal_inventories_do_not_repair_digits_rates_negation_or_claim_accuracy():
    counts = module.critical_inventory("1.5% 15% 1,00,000 ० not not unless 31st 31*")
    assert counts["1.5%"] == 1 and counts["15%"] == 1 and counts["1,00,000"] == 1
    assert counts["not"] == 2 and counts["०"] == 1 and counts["31st"] == 1
    candidates = [
        {"id": "a", "text": "wrong 31* 1.5%", "state": "UNVERIFIED_CANDIDATE"},
        {"id": "b", "text": "wrong 31* 1.5%", "state": "UNVERIFIED_CANDIDATE"},
        {"id": "c", "text": "wrong 31* 15%", "state": "UNVERIFIED_CANDIDATE"},
        {"id": "failed", "text": "", "state": "FAILED"},
    ]
    results = module.compare_inventories(candidates)
    assert results[0]["state"] == "SURFACE_INVENTORY_AGREEMENT_NOT_VERIFIED"
    assert results[0]["selected_candidate"] is None
    assert results[1]["state"] == "LITERAL_INVENTORY_DIFFERS"
    assert results[2]["state"] == "NOT_COMPARABLE_FAILED_ATTEMPT"
    assert all("accuracy" not in r for r in results)


def fixture(tmp_path):
    original = tmp_path / "original.pdf"
    original.write_bytes(native_bytes())
    plan = {
        "documents": [
            {
                "id": "new-fixture",
                "title": "<script>fixture</script>",
                "family": "authored-test-only",
                "prior_family_exposure": False,
            },
            {
                "id": "failed-slot",
                "title": "Unavailable source",
                "family": "test-only",
                "prior_family_exposure": True,
            },
        ],
        "state": "FROZEN_BEFORE_LOCAL_ACQUISITION_AND_EXTRACTION",
        "publication_eligible": False,
        "ocr_settings": {
            "languages": ["eng", "eng+hin"],
            "psm": 3,
            "preprocessing": "unchanged",
            "empty_output_fallback_psm": 6,
        },
    }
    plan_file = tmp_path / "plan.json"
    plan_file.write_text(json.dumps(plan))
    manifest = {
        "plan_sha256": digest(plan_file),
        "documents": [
            {
                "id": "new-fixture",
                "title": "SYNTHETIC TEST ONLY",
                "sha256": digest(original),
                "url": "https://www.incometax.gov.in/test-fixture.pdf",
                "path": "original.pdf",
            }
        ],
        "attempts": [
            {"id": "new-fixture", "state": "ACQUIRED", "sha256": digest(original)},
            {"id": "failed-slot", "state": "FAILED", "reason": "HTTP 404"},
        ],
    }
    manifest_file = tmp_path / "sources.json"
    manifest_file.write_text(json.dumps(manifest))
    prior_file = tmp_path / "prior.json"
    prior_file.write_text(json.dumps({"source_sha256": []}))
    return manifest_file, plan_file, prior_file


@pytest.mark.parametrize(
    "change", ["prior", "plan", "missing-slot", "duplicate", "path", "settings"]
)
def test_cohort_rejects_reuse_drift_omitted_failures_and_unsafe_sources(tmp_path, change):
    manifest, plan, prior = fixture(tmp_path)
    value = json.loads(manifest.read_text())
    if change == "prior":
        prior.write_text(json.dumps({"source_sha256": [value["documents"][0]["sha256"]]}))
    elif change == "plan":
        value["plan_sha256"] = "0" * 64
    elif change == "missing-slot":
        value["attempts"].pop()
    elif change == "duplicate":
        value["documents"] *= 2
    elif change == "path":
        value["documents"][0]["path"] = "../outside.pdf"
    else:
        data = json.loads(plan.read_text())
        data["ocr_settings"]["psm"] = 6
        plan.write_text(json.dumps(data))
        value["plan_sha256"] = digest(plan)
    manifest.write_text(json.dumps(value))
    with pytest.raises(ValueError):
        module.checked_inputs(manifest, plan, prior)


def raw_result(image, text="31* March 2030", empty=False):
    with Image.open(image) as source:
        width, height = source.size
    lines = (
        []
        if empty
        else [{"text": text, "confidence": 99, "bbox": {"x0": 10, "y0": 10, "x1": 300, "y1": 50}}]
    )
    return {
        "state": "EXPERIMENTAL_NOT_ACCEPTED",
        "publication_eligible": False,
        "width": width,
        "height": height,
        "image_sha256": digest(image),
        "languages": ["eng"],
        "text": "" if empty else text,
        "blocks": [{"paragraphs": [{"lines": lines}]}],
    }


def test_full_pilot_keeps_empty_failed_fallback_and_source_checks_without_gold_leakage(
    tmp_path, monkeypatch
):
    manifest, plan, prior = fixture(tmp_path)
    monkeypatch.setattr(module, "verify_models", lambda _: SHA)
    monkeypatch.setattr(easyocr_probe, "verify_models", lambda _: SHA)
    calls = []

    def ocr(image, models, out, **kwargs):
        assert set(kwargs) == {"psm", "languages", "deadline"}
        calls.append((kwargs["languages"], kwargs["psm"]))
        raw = raw_result(image, empty=kwargs["languages"] == "eng" and kwargs["psm"] == 3)
        out.write_text(json.dumps(raw))
        return raw

    def independent(requests, models, out, **kwargs):
        assert set(requests[0]) == {"id", "image"}
        out.write_text('{"failure_evidence":true}')
        raise ValueError("Mocked independent failure")

    monkeypatch.setattr(module, "run_ocr", ocr)
    monkeypatch.setattr(module, "run_probe", independent)
    out = tmp_path / "pilot"
    report = module.run_transfer(manifest, plan, prior, tmp_path / "models", tmp_path / "easy", out)
    assert calls == [("eng", 3), ("eng+hin", 3), ("eng", 6)]
    assert report["summary"]["candidate_attempts"] == 5
    assert report["summary"]["empty_nonfailed_attempts"] == 1
    assert report["summary"]["failed_attempts"] == 1
    assert report["summary"]["failed_acquisition_slots"] == 1
    assert report["documents"][1]["state"] == "ACQUISITION_FAILED"
    assert report["accuracy"]["cer"] is None and report["accepted_extractions"] == 0
    assert report["selected_engine"] is None and report["publication_eligible"] is False
    assert all(
        a["claims_clean"] is False
        for d in report["documents"]
        for c in d["cases"]
        for a in c["candidates"]
    )
    assert all(
        c["expected_text"] is None and c["reviewer"] is None for c in report["source_checks"]
    )
    failed = report["documents"][0]["cases"][0]["candidates"][-1]
    assert failed["state"] == "FAILED" and (out / failed["raw"]).is_file()
    ledger = json.loads((out / "files.json").read_text())
    assert all(digest(out / name) == sha for name, sha in ledger.items())
    html = (out / "index.html").read_text()
    assert "<script>fixture</script>" not in html and "&lt;script&gt;" in html
    for check in report["source_checks"]:
        with (
            Image.open(out / check["source_image"]) as source,
            Image.open(out / check["crop"]) as crop,
        ):
            with source.crop(check["crop_pixels"]) as expected:
                assert crop.tobytes() == expected.tobytes()
    with pytest.raises(ValueError):
        module.run_transfer(manifest, plan, prior, tmp_path / "models", tmp_path / "easy", out)


def test_candidate_geometry_must_match_actual_source_pixels(tmp_path):
    image = tmp_path / "source.png"
    Image.new("RGB", (800, 600), "white").save(image)
    raw = raw_result(image)
    page = Page(number=1, width=400, height=300, status="ocr_required")
    before = deepcopy(raw)
    candidate = module.ocr_candidate(raw, page, "ocr", size=(800, 600), source_sha=digest(image))
    assert candidate["lines"][0]["bbox"] == {"x0": 5.0, "top": 5.0, "x1": 150.0, "bottom": 25.0}
    assert raw == before
    raw["width"] = 799
    with pytest.raises(ValueError):
        module.ocr_candidate(raw, page, "ocr", size=(800, 600), source_sha=digest(image))
    raw = before
    raw["image_sha256"] = "0" * 64
    with pytest.raises(ValueError):
        module.ocr_candidate(raw, page, "ocr", size=(800, 600), source_sha=digest(image))


def test_summary_does_not_call_a_scanned_text_layer_an_image_only_page():
    doc = {
        "state": "UNVERIFIED_CANDIDATES",
        "source_sha256": SHA,
        "cases": [
            {"native_metrics": {"characters": 22, "image_regions": 1}, "candidates": []},
            {"native_metrics": {"characters": 0, "image_regions": 1}, "candidates": []},
        ],
    }
    assert (
        module.summarize_transfer({"documents": [doc]})["zero_native_glyph_pages_with_images"] == 1
    )

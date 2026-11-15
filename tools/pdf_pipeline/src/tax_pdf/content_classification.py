"""Explicit source-bound scope decisions. Never recognize signatures from OCR text."""

from .models import Box


def apply_region_classification(entry, row, regions, review_sha):
    review = (entry or {}).get("structured_region_review")
    if not review:
        return regions
    groups = [g for g in review["variants"] if g["input_id"] == row["id"]]
    if not groups:
        return regions
    if len(groups) != 1 or groups[0]["raw_sha256"] != row["raw_sha256"]:
        raise ValueError("Region classification belongs to another OCR variant")
    by_id = {r.id: r for r in regions}
    seen = set()
    # Validate the entire decision set before changing any candidate.
    decisions = []
    for decision in groups[0]["decisions"]:
        identity = decision["region_id"]
        if identity in seen or identity not in by_id:
            raise ValueError("Duplicate or missing classified source span")
        seen.add(identity)
        region = by_id[identity]
        if (
            any(
                decision[k] != getattr(region, k)
                for k in ("source_line", "start", "end", "raw_text", "crop_sha256")
            )
            or Box.model_validate(decision["image_bbox"]) != region.image_bbox
            or decision["prior_scope"] != region.scope
        ):
            raise ValueError("Classified source span, text, crop or geometry changed")
        if region.scope != "mixed_review" or region.table_ids or region.edits:
            raise ValueError("Scope feedback can only resolve unedited mixed non-table spans")
        if decision["scope"] not in ("signature_excluded", "metadata"):
            raise ValueError("Unsupported source-region classification")
        if not isinstance(decision.get("basis"), str) or not decision["basis"].strip():
            raise ValueError("Source-region classification requires an explicit review basis")
        decisions.append((region, decision))
    for region, decision in decisions:
        region.scope = decision["scope"]
        region.scope_evidence.append(f"{review_sha}:structured-region:{region.id}")
        resolved = {"SCOPE_BOUNDARY_REVIEW", "REMAINDER_OF_MIXED_SOURCE_LINE"}
        if region.scope == "signature_excluded":
            # Non-text strokes need no transcription; their raw OCR remains evidence.
            resolved.add("TRANSCRIPTION_UNVERIFIED")
        region.holds = [h for h in region.holds if h not in resolved]
    return regions

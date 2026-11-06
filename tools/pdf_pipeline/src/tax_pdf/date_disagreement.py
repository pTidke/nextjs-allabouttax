"""Spatial date comparison hints; agreement never establishes correct extraction."""

from itertools import combinations

from .reference_eval import normalize


def overlaps(a, b):
    x = max(0, min(a["x1"], b["x1"]) - max(a["x0"], b["x0"]))
    y = max(0, min(a["y1"], b["y1"]) - max(a["y0"], b["y0"]))
    return x >= 0.5 * min(a["x1"] - a["x0"], b["x1"] - b["x0"]) and y >= 0.5 * min(
        a["y1"] - a["y0"], b["y1"] - b["y0"]
    )


def compare_regions(left, right):
    if len(left) > 100 or len(right) > 100:
        raise ValueError("Date comparison region budget exceeded")
    edges = {
        (i, j)
        for i, a in enumerate(left)
        for j, b in enumerate(right)
        if any(
            overlaps(f["image_bbox"], g["image_bbox"])
            for f in a["fragments"]
            for g in b["fragments"]
        )
    }
    flags = []
    same = 0
    for i, a in enumerate(left):
        matches = [j for ai, j in sorted(edges) if ai == i]
        if not matches:
            flags.append({"kind": "UNMATCHED_DATE_REGION", "left": [a["id"]], "right": []})
        elif len(matches) != 1 or sum(j == matches[0] for _, j in edges) != 1:
            flags.append(
                {
                    "kind": "AMBIGUOUS_DATE_ALIGNMENT",
                    "left": [a["id"]],
                    "right": [right[j]["id"] for j in matches],
                }
            )
        elif normalize(a["raw"]) != normalize(right[matches[0]]["raw"]):
            flags.append(
                {
                    "kind": "DATE_OCR_DISAGREEMENT",
                    "left": [a["id"]],
                    "right": [right[matches[0]]["id"]],
                }
            )
        else:
            same += 1
    for j, b in enumerate(right):
        if not any(bj == j for _, bj in edges):
            flags.append({"kind": "UNMATCHED_DATE_REGION", "left": [], "right": [b["id"]]})
    return {
        "flags": flags,
        "same_surface_text_unverified": same,
        "selected_candidate": None,
        "accuracy": None,
    }


def compare_inputs(rows):
    if len(rows) > 20:
        raise ValueError("Date comparison input budget exceeded")

    def key(row):
        return (row["source_sha256"], row["page"], row["source_render_sha256"])

    result = []
    for a, b in combinations(rows, 2):
        if key(a) != key(b):
            continue
        common = {"left_input": a["id"], "right_input": b["id"], "selected_candidate": None}
        comparable = {"REVIEW_REQUIRED", "NO_RULE_HITS_NOT_CLEAN"}
        if a["state"] not in comparable or b["state"] not in comparable:
            result.append({**common, "state": "NOT_COMPARABLE", "flags": []})
        elif a.get("raw_sha256") == b.get("raw_sha256"):
            result.append({**common, "state": "DUPLICATE_EVIDENCE_NOT_INDEPENDENT", "flags": []})
        else:
            result.append(
                {
                    **common,
                    "state": "REVIEW_HINTS_ONLY",
                    **compare_regions(a["date_evidence"], b["date_evidence"]),
                }
            )
        if sum(len(r["flags"]) for r in result) > 1000:
            raise ValueError("Date disagreement flag budget exceeded")
    return result

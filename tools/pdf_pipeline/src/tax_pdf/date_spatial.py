"""Bounded same-row date search hints; provider text/order are never rewritten."""

import re

from .date_review import MONTH_PATTERN, date_findings, date_matches

ANCHOR = re.compile(
    rf"^\s*(?:{MONTH_PATTERN})\.?[ \t]*,?[ \t]+[12][0-9]{{3}}(?![0-9])", re.IGNORECASE
)
CUE = re.compile(r"(?:dated(?:\s+the)?|date\s*:)", re.IGNORECASE)
DAY = re.compile(r"(?:[0-9][0-9a-z*\"'’′.]{0,7}|[oiligq]{1,3}(?:st|nd|rd|th)?)", re.IGNORECASE)
SUFFIX = re.compile(r"st|nd|rd|th", re.IGNORECASE)
EXPLICIT_ENDING = re.compile(r"[0-9]{1,2}(?:st|nd|rd|th|[*\"'’′])", re.IGNORECASE)


def adjacent(left, right):
    a, b = left[1]["bbox"], right[1]["bbox"]
    ah, bh = a["y1"] - a["y0"], b["y1"] - b["y0"]
    aw, bw = a["x1"] - a["x0"], b["x1"] - b["x0"]
    overlap = min(a["y1"], b["y1"]) - max(a["y0"], b["y0"])
    return (
        a["x0"] < b["x0"]
        and -0.25 * min(aw, bw) <= b["x0"] - a["x1"] <= 1.5 * max(ah, bh)
        and overlap >= 0.5 * min(ah, bh)
    )


def roles(text):
    text = text.strip()
    if CUE.fullmatch(text):
        return "cue"
    if SUFFIX.fullmatch(text):
        return "suffix"
    if DAY.fullmatch(text):
        return "day"
    return None


def eligible(path):
    kinds = [roles(r[1]["text"]) for r in path]
    # Plain numbers need an explicit date cue: do not attach nearby row labels
    # or amounts to a month/year heading. A separate ordinal ending also anchors
    # the search. This intentionally leaves uncued split numeric dates uncovered.
    return kinds in (["cue"], ["cue", "day"], ["cue", "day", "suffix"], ["day", "suffix"]) or (
        kinds == ["day"] and EXPLICIT_ENDING.fullmatch(path[0][1]["text"].strip())
    )


def in_table(row, page, raw):
    b = row[1]["bbox"]
    x0, x1 = b["x0"] * page.width / raw["width"], b["x1"] * page.width / raw["width"]
    y0, y1 = b["y0"] * page.height / raw["height"], b["y1"] * page.height / raw["height"]
    return any(
        min(x1, t.bbox.x1) > max(x0, t.bbox.x0) and min(y1, t.bbox.bottom) > max(y0, t.bbox.top)
        for t in page.tables
    )


def nearby_paths(anchor, short):
    paths = []
    traversed = 0

    def search(current, tail):
        nonlocal traversed
        if len(tail) == 3:
            return
        previous = [r for r in short if adjacent(r, current)]
        if len(previous) > 8:
            raise ValueError("Spatial date neighbor budget exceeded")
        for row in previous:
            traversed += 1
            if traversed > 64:
                raise ValueError("Spatial date path budget exceeded")
            path = [row, *tail]
            if eligible(path):
                paths.append(path)
            search(row, path)

    search(anchor, [])
    return paths


def spatial_date_evidence(rows, raw, page):
    from .date_regions import region_box, union

    if len(rows) > 2000:
        raise ValueError("Spatial date line budget exceeded")
    anchors = [(r, ANCHOR.match(r[1]["text"])) for r in rows]
    anchors = [(r, m) for r, m in anchors if m and not in_table(r, page, raw)]
    if len(anchors) > 100:
        raise ValueError("Spatial date anchor budget exceeded")
    short = [r for r in rows if roles(r[1]["text"]) and not in_table(r, page, raw)]
    found = []
    for anchor, match in anchors:
        paths = nearby_paths(anchor, short)
        # Keep optional cue context without duplicating the same day/suffix
        # evidence. Competing day fragments remain separate alternatives.
        paths = [
            p
            for p in paths
            if not any(
                len(q) > len(p) and [r[0] for r in q[-len(p) :]] == [r[0] for r in p] for q in paths
            )
        ]
        paths = [
            p
            for p in paths
            if not (
                len(p) == 1
                and roles(p[0][1]["text"]) == "cue"
                and any(len(q) > 1 and q[0][0] == p[0][0] for q in paths)
            )
        ]
        for path in paths:
            fragments = []
            for index, line, display in [*path, anchor]:
                start = len(line["text"]) - len(line["text"].lstrip())
                end = match.end() if index == anchor[0] else len(line["text"].rstrip())
                box, precision = region_box(line, start, end, raw["width"], raw["height"])
                fragments.append(
                    {
                        "line_number": index + 1,
                        "start": start,
                        "end": end,
                        "text": line["text"][start:end],
                        "line_text": line["text"],
                        "image_bbox": box,
                        "geometry_precision": precision,
                        "line_confidence": display["confidence"],
                    }
                )
            text = " ".join(f["text"] for f in fragments)
            codes = ["DATE_SPATIAL_FRAGMENTS_REVIEW"]
            codes += list(dict.fromkeys(c for issue in date_findings(text) for c in issue["codes"]))
            if not list(date_matches(text)):
                codes.append("DATE_FRAGMENT_UNPARSED_REVIEW")
            if len(paths) > 1:
                codes.append("DATE_FRAGMENT_AMBIGUITY_REVIEW")
            box = union([f["image_bbox"] for f in fragments])
            numbers = [f["line_number"] for f in fragments]
            found.append(
                {
                    "start": 0,
                    "end": len(text),
                    "raw": text,
                    "codes": codes,
                    "fragments": fragments,
                    "line_number": numbers[0],
                    "line_text": "\n".join(f["line_text"].rstrip("\n") for f in fragments),
                    "line_confidence": min(f["line_confidence"] for f in fragments),
                    "image_bbox": box,
                    "source_bbox": {
                        "x0": box["x0"] * page.width / raw["width"],
                        "top": box["y0"] * page.height / raw["height"],
                        "x1": box["x1"] * page.width / raw["width"],
                        "bottom": box["y1"] * page.height / raw["height"],
                    },
                    "cross_line": True,
                    "association": "SAME_VISUAL_ROW_HINT",
                    "fragment_order": "PROPOSED_LEFT_TO_RIGHT_SOURCE_POSITION",
                    "provider_order_differs": numbers != sorted(numbers),
                    "search_view": text,
                    "search_separator": " ",
                    "reading_order_verified": False,
                    "action": "COMPARE_WITH_ORIGINAL",
                    "suggested_replacement": None,
                }
            )
            if len(found) > 100:
                raise ValueError("Spatial date region budget exceeded")
    return found

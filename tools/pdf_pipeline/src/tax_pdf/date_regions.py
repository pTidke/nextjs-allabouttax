"""Conservative date search windows with exact source fragments, never merged text."""

import math

from .date_review import date_findings, date_matches
from .ocr_compare import mapped_lines


def union(boxes):
    return {
        "x0": min(b["x0"] for b in boxes),
        "y0": min(b["y0"] for b in boxes),
        "x1": max(b["x1"] for b in boxes),
        "y1": max(b["y1"] for b in boxes),
    }


def continuation(a, b):
    ah, bh = a["y1"] - a["y0"], b["y1"] - b["y0"]
    overlap = max(0, min(a["x1"], b["x1"]) - max(a["x0"], b["x0"]))
    return (
        b["y0"] >= a["y1"]
        and b["y0"] - a["y1"] <= 1.5 * max(ah, bh)
        and abs(a["x0"] - b["x0"]) <= 1.5 * max(ah, bh)
        and overlap >= 0.5 * min(a["x1"] - a["x0"], b["x1"] - b["x0"])
    )


def region_box(line, start, end, width, height):
    """Use exact word offsets only when the complete word inventory aligns."""
    words = line.get("words") or []
    if len(words) > 2000:
        raise ValueError("Date word budget exceeded")
    cursor = 0
    matched = []
    for word in words:
        text = word.get("text")
        if not isinstance(text, str) or not text:
            return line["bbox"], "line"
        pos = line["text"].find(text, cursor)
        if pos < 0 or line["text"][cursor:pos].strip():
            return line["bbox"], "line"
        box = word["bbox"]
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in box.values()) or not (
            0 <= box["x0"] < box["x1"] <= width and 0 <= box["y0"] < box["y1"] <= height
        ):
            raise ValueError("Invalid date word geometry")
        if pos < end and pos + len(text) > start:
            matched.append(box)
        cursor = pos + len(text)
    if not words or line["text"][cursor:].strip() or not matched:
        return line["bbox"], "line"
    return union(matched), "word"


def date_evidence(raw, page):
    mapped = mapped_lines(raw, page)
    groups = []
    ordinal = 0
    for block in raw.get("blocks") or []:
        for paragraph in block.get("paragraphs") or []:
            group = []
            for line in paragraph.get("lines") or []:
                text = line["text"]
                if not isinstance(text, str) or len(text) > 20000:
                    raise ValueError("Date line text budget exceeded")
                group.append((ordinal, line, mapped[ordinal]))
                ordinal += 1
            groups.append(group)
    found = []
    seen = set()
    for group in groups:
        for offset in range(len(group)):
            for size in (1, 2, 3):
                rows = group[offset : offset + size]
                if len(rows) != size or any(
                    not continuation(a[1]["bbox"], b[1]["bbox"])
                    for a, b in zip(rows[:-1], rows[1:], strict=True)
                ):
                    continue
                parts = []
                cursor = 0
                for index, line, display in rows:
                    left = len(line["text"]) - len(line["text"].lstrip())
                    content = line["text"].strip()
                    parts.append((cursor, cursor + len(content), index, line, display, left))
                    cursor += len(content) + 1
                text = " ".join(r[1]["text"].strip() for r in rows)
                issues = date_findings(text)
                candidates = [
                    {"start": m.start(), "end": m.end(), "raw": m[0], "codes": []}
                    for m in date_matches(text)
                ]
                for issue in issues:
                    candidates = [
                        c
                        for c in candidates
                        if (c["start"], c["end"]) != (issue["start"], issue["end"])
                    ]
                    candidates.append(issue)
                for candidate in candidates:
                    # A multi-line window may only emit a date crossing every
                    # included boundary, never repeat dates contained in one line.
                    if size > 1 and not (
                        candidate["start"] < parts[0][1] and candidate["end"] > parts[-1][0]
                    ):
                        continue
                    if size > 1 and candidate["codes"] == ["DATE_CUE_UNPARSED_REVIEW"]:
                        continue
                    fragments = []
                    for begin, finish, index, line, display, left in parts:
                        start, end = max(begin, candidate["start"]), min(finish, candidate["end"])
                        if start >= end:
                            continue
                        start, end = start - begin + left, end - begin + left
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
                    key = tuple((f["line_number"], f["start"], f["end"]) for f in fragments)
                    if not fragments or key in seen:
                        continue
                    seen.add(key)
                    box = union([f["image_bbox"] for f in fragments])
                    source = {
                        "x0": box["x0"] * page.width / raw["width"],
                        "top": box["y0"] * page.height / raw["height"],
                        "x1": box["x1"] * page.width / raw["width"],
                        "bottom": box["y1"] * page.height / raw["height"],
                    }
                    found.append(
                        {
                            **candidate,
                            "id": f"date-{len(found) + 1}",
                            "fragments": fragments,
                            "line_number": fragments[0]["line_number"],
                            "line_text": "\n".join(f["line_text"].rstrip("\n") for f in fragments),
                            "line_confidence": min(f["line_confidence"] for f in fragments),
                            "image_bbox": box,
                            "source_bbox": source,
                            "cross_line": len(fragments) > 1,
                            "search_view": text,
                            "search_separator": " ",
                            "reading_order_verified": False,
                            "action": "COMPARE_WITH_ORIGINAL",
                            "suggested_replacement": None,
                        }
                    )
                    if len(found) > 100:
                        raise ValueError("Date region budget exceeded")
    return found

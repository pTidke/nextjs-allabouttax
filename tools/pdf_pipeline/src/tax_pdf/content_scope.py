"""Literal source-region classification. No semantic deletion or inferred text."""

import math

from .models import Box


def pixel_box(value):
    return Box(x0=value["x0"], top=value["y0"], x1=value["x1"], bottom=value["y1"])


def contains(a, b):
    return a.x0 <= b.x0 <= b.x1 <= a.x1 and a.top <= b.top <= b.bottom <= a.bottom


def overlaps(a, b):
    return min(a.x1, b.x1) > max(a.x0, b.x0) and min(a.bottom, b.bottom) > max(a.top, b.top)


def union(boxes):
    return Box(
        x0=min(b.x0 for b in boxes),
        top=min(b.top for b in boxes),
        x1=max(b.x1 for b in boxes),
        bottom=max(b.bottom for b in boxes),
    )


def point_box(box, page, size):
    w, h = size
    return Box(
        x0=box.x0 * page.width / w,
        top=box.top * page.height / h,
        x1=box.x1 * page.width / w,
        bottom=box.bottom * page.height / h,
    )


def classify(box, areas):
    touching = [a for a in areas if overlaps(a["box"], box)]
    covering = [a for a in touching if contains(a["box"], box)]
    if touching and (len(covering) != len(touching) or len({a["scope"] for a in covering}) != 1):
        return "mixed_review", [a["id"] for a in touching]
    if covering:
        return covering[0]["scope"], [a["id"] for a in covering]
    return "content_candidate", []


def partition_line(line, areas):
    """Split only complete, literal word inventories; every character retains an owner."""
    text, box = line["text"], pixel_box(line["bbox"])
    scope, evidence = classify(box, areas)
    whole = [(0, len(text), box, scope, evidence)]
    if scope != "mixed_review":
        return whole
    words = line.get("words") or []
    if not 1 <= len(words) <= 500:
        return whole
    cursor, pieces = 0, []
    for word in words:
        if not isinstance(word, dict):
            return whole
        token = word.get("text")
        if not isinstance(token, str) or not token or token.isspace():
            return whole
        start = text.find(token, cursor)
        if start < 0 or text[cursor:start].strip():
            return whole
        end = start + len(token)
        try:
            b = pixel_box(word["bbox"])
        except (KeyError, TypeError, ValueError):
            return whole
        if not contains(box, b) or b.x0 == b.x1 or b.top == b.bottom:
            return whole
        kind, proof = classify(b, areas)
        pieces.append((cursor, end, b, kind, proof))
        cursor = end
    if text[cursor:].strip():
        return whole
    pieces[-1] = (*pieces[-1][:1], len(text), *pieces[-1][2:])
    groups = []
    for start, end, b, kind, proof in pieces:
        if groups and groups[-1][3:] == (kind, proof):
            prev = groups.pop()
            groups.append((prev[0], end, union([prev[2], b]), kind, proof))
        else:
            groups.append((start, end, b, kind, proof))
    return groups


def propose_order(regions):
    """Row-band proposal only. Multicolumn/overlap associations remain explicit holds."""
    rows = []
    for region in sorted(regions, key=lambda r: (r.image_bbox.top, r.image_bbox.x0, r.id)):
        b = region.image_bbox
        matches = []
        for row in rows:
            # Compare every member, never a transitive bounding-box chain.
            if all(
                min(b.bottom, x.image_bbox.bottom) - max(b.top, x.image_bbox.top)
                >= 0.5 * min(b.bottom - b.top, x.image_bbox.bottom - x.image_bbox.top)
                for x in row
            ):
                matches.append(row)
        if len(matches) == 1:
            matches[0].append(region)
        else:
            if matches:
                region.holds.append("AMBIGUOUS_ROW_ASSOCIATION")
                for row in matches:
                    for other in row:
                        other.holds.append("AMBIGUOUS_ROW_ASSOCIATION")
            rows.append([region])
    order = 0
    for row in sorted(rows, key=lambda rs: min(r.image_bbox.top for r in rs)):
        row.sort(key=lambda r: (r.image_bbox.x0, r.image_bbox.top, r.id))
        for a, b in zip(row[:-1], row[1:], strict=True):
            gap = b.image_bbox.x0 - a.image_bbox.x1
            if gap < 0 or gap > 4 * min(
                a.image_bbox.bottom - a.image_bbox.top, b.image_bbox.bottom - b.image_bbox.top
            ):
                a.holds.append("ROW_OR_COLUMN_ASSOCIATION_UNVERIFIED")
                b.holds.append("ROW_OR_COLUMN_ASSOCIATION_UNVERIFIED")
        for region in row:
            order += 1
            region.proposed_order = order
    # A separate tall region can overlap multiple rows even without row matching.
    for i, a in enumerate(regions):
        for b in regions[i + 1 :]:
            if overlaps(a.image_bbox, b.image_bbox):
                a.holds.append("SOURCE_BOX_OVERLAP_REVIEW")
                b.holds.append("SOURCE_BOX_OVERLAP_REVIEW")
    for r in regions:
        r.holds = sorted(set(r.holds))
    return regions


def crop_pixels(box, size):
    return (
        max(0, math.floor(box.x0) - 4),
        max(0, math.floor(box.top) - 4),
        min(size[0], math.ceil(box.x1) + 4),
        min(size[1], math.ceil(box.bottom) + 4),
    )

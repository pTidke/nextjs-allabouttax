"""The decision policy. This is the one place that decides what a person must look at.

Each line ends as:
  accepted  every rule passed; no person needed (audit a sample)
  flagged   a rule wants a person to compare it with the page
  blocked   unusable until something is fixed

Every outcome other than "accepted" carries the rule that caused it.
"""

from . import validators
from .config import Policy
from .crosscheck import compare
from .model import Document, Flag, Line


def _flag(line: Line, rule: str, message: str, severity="review") -> None:
    line.flags.append(Flag(rule=rule, severity=severity, message=message))


def decide_line(line: Line, policy: Policy, image_backed: bool) -> None:
    line.flags.extend(validators.run(line.text))
    others = [r for r in line.readings if r.source != line.source]
    if line.role == "table":
        _flag(line, "table.member", "Part of a table; table structure is never accepted by rule.")
    if others:
        for other in others:
            result = compare(line.text, other.text)
            if not result.agrees(policy.min_similarity):
                detail = (
                    f"differs on {', '.join(result.only_first + result.only_second)}"
                    if not result.critical_equal
                    else f"similarity {result.similarity}"
                )
                _flag(
                    line,
                    "crosscheck.disagreement",
                    f'{other.source} reads "{other.text}" ({detail}).',
                )
    elif line.source == "native":
        if image_backed or not policy.accept_native_without_crosscheck:
            _flag(line, "crosscheck.not-run", "No independent reading was available to confirm it.")
    elif not policy.accept_single_ocr_reading:
        _flag(line, "ocr.single-reading", "Read by one OCR engine only.")
    if any(flag.severity == "blocking" for flag in line.flags):
        line.status = "blocked"
    else:
        line.status = "flagged" if line.flags else "accepted"


def decide(document: Document, policy: Policy) -> None:
    for page in document.pages:
        image_backed = any(flag.rule == "native.image-backed" for flag in page.flags)
        for table in page.tables:
            table.flags.append(
                Flag(
                    rule="table.structure-unverified",
                    severity="review",
                    message="Check headers, merged cells, units and footnotes against the page.",
                )
            )
            table.status = "flagged"
        for line in page.lines:
            if line.excluded:
                line.status = "accepted"
                continue
            decide_line(line, policy, image_backed)
    counted = [line for line in document.lines() if not line.excluded]
    document.summary = {
        "pages": len(document.pages),
        "pages_failed": sum(page.kind == "failed" for page in document.pages),
        "pages_scanned": sum(page.kind == "scanned" for page in document.pages),
        "lines": len(counted),
        "accepted": sum(line.status == "accepted" for line in counted),
        "flagged": sum(line.status == "flagged" for line in counted),
        "blocked": sum(line.status == "blocked" for line in counted),
        "excluded": sum(1 for line in document.lines() if line.excluded),
        "tables": sum(len(page.tables) for page in document.pages),
    }


def needs_review(document: Document) -> bool:
    return bool(
        document.summary.get("flagged")
        or document.summary.get("blocked")
        or document.summary.get("tables")
        or any(flag.severity == "blocking" for flag in document.flags)
        or any(flag.severity == "blocking" for page in document.pages for flag in page.flags)
    )

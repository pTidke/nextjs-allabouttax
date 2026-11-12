import type { Candidate, Region } from "./contract";

type IssueKind = "unresolved" | "changed" | "key_text";
const reasons: Record<IssueKind, string> = {
  unresolved: "No usable transcription was proposed for this region.",
  changed: "The proposed transcription differs from the raw reading.",
  key_text:
    "Check this date, amount, identifier, or operative phrase against the source.",
};
const priority: Record<IssueKind, number> = {
  unresolved: 0,
  changed: 1,
  key_text: 2,
};
const months =
  "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
const namedDate = new RegExp(
  String.raw`\b(?:\d{1,2}(?:st|nd|rd|th|\*)?\s+(?:day\s+of\s+)?(?:${months})|(?:${months})\s+\d{1,2}(?:st|nd|rd|th)?)\b`,
  "i",
);
const keyText =
  /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\d\s*%|₹\s*\d|\b(?:INR|Rs\.?)[\s.]+\d|\b(?:notification|circular)\s+no\.?\s*\d|\bS\s*\.\s*O\s*\.\s*\d|\b(?:shall come into force|date of publication|on or before|shall not)\b/i;

const comparable = (text: string) =>
  text.normalize("NFC").replace(/\s+/gu, " ").trim();

function kindOf(region: Region): IssueKind | null {
  if (region.state === "blank") return null;
  if (region.state === "unresolved" || !region.proposed?.trim())
    return "unresolved";
  if (
    region.raw !== null &&
    comparable(region.raw) !== comparable(region.proposed)
  )
    return "changed";
  return namedDate.test(region.proposed) || keyText.test(region.proposed)
    ? "key_text"
    : null;
}

export function reviewQueue(candidate: Candidate) {
  const issues = candidate.regions
    .flatMap((region) => {
      const kind = kindOf(region);
      return kind ? [{ region, kind, reason: reasons[kind] }] : [];
    })
    .sort((a, b) => priority[a.kind] - priority[b.kind]);
  // Existing importer flags do not identify a region. Keep them at scope level.
  const blockingHolds = [...new Set(candidate.blockingHolds)];
  const documentChecks = [...new Set(candidate.reviewHolds)].filter(
    (check) => !blockingHolds.includes(check),
  );
  return { issues, documentChecks, blockingHolds };
}

export function summarizeReview(candidate: Candidate) {
  const queue = reviewQueue(candidate);
  const blocked =
    candidate.state === "BLOCKED" || queue.blockingHolds.length > 0;
  return {
    id: candidate.id,
    title: candidate.title,
    state: candidate.state,
    scopeNote: candidate.scopeNote,
    revision: candidate.revisionHash.slice(0, 8),
    status: blocked
      ? ("blocked" as const)
      : queue.issues.length || queue.documentChecks.length
        ? ("needs_review" as const)
        : ("no_flags" as const),
    issueCount: queue.issues.length,
    documentCheckCount: queue.documentChecks.length,
    holdCount: queue.blockingHolds.length,
  };
}

export function recordedTableRow(candidate: Candidate, selected: Region) {
  const row = /^(r\d+)c\d+$/.exec(selected.id)?.[1];
  if (candidate.kind !== "image_table_band" || !row) return [];
  return candidate.regions.filter(
    (region) =>
      region.page === selected.page &&
      /^(r\d+)c\d+$/.exec(region.id)?.[1] === row,
  );
}

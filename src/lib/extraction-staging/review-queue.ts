import type { Candidate, Command, Region, ReportedIssue } from "./contract";

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

export function summarizeReview(
  candidate: Candidate,
  action?: Command["action"],
) {
  const queue = reviewQueue(candidate);
  const blocked =
    candidate.state === "BLOCKED" || queue.blockingHolds.length > 0;
  return {
    id: candidate.id,
    title: candidate.title,
    state: candidate.state,
    scopeNote: candidate.scopeNote,
    revision: candidate.revisionHash.slice(0, 8),
    status:
      action === "ACCEPT_EXTRACTION"
        ? ("accepted" as const)
        : action === "REQUEST_CHANGES"
          ? ("blocked" as const)
          : candidate.repair
            ? ("recheck" as const)
            : blocked
              ? ("blocked" as const)
              : ("needs_review" as const),
    issueCount: queue.issues.length,
    documentCheckCount: queue.documentChecks.length,
    holdCount: queue.blockingHolds.length,
  };
}

export function repairReview(
  candidate: Candidate,
  previous: Candidate,
  request: Command,
) {
  const previousById = new Map(
    previous.regions.map((region) => [region.id, region]),
  );
  const currentIds = new Set(candidate.regions.map((region) => region.id));
  const changedPages = new Set(
    previous.regions
      .filter((region) => !currentIds.has(region.id))
      .map((region) => region.page),
  );
  const reports: ReportedIssue[] = request.issues ?? [];
  const reportedRegions = new Set([
    ...reports.map((report) => report.regionId),
    ...request.checks
      .filter((check) => check.state !== "checked")
      .map((check) => check.regionId),
  ]);
  for (const report of reports) {
    if (
      report.page !== null &&
      (report.regionId === null || !currentIds.has(report.regionId))
    )
      changedPages.add(report.page);
  }
  for (const region of previous.regions) {
    if (
      reportedRegions.has(region.id) &&
      (previous.kind === "image_table_band" || !currentIds.has(region.id))
    )
      changedPages.add(region.page);
  }
  const documentIssue =
    reports.some((report) => report.page === null) ||
    (reports.length === 0 && reportedRegions.size === 0);
  const regionIds = candidate.regions
    .filter((region) => {
      const old = previousById.get(region.id);
      return (
        documentIssue ||
        changedPages.has(region.page) ||
        reportedRegions.has(region.id) ||
        !old ||
        old.page !== region.page ||
        old.proposed !== region.proposed ||
        old.state !== region.state ||
        old.box.x0 !== region.box.x0 ||
        old.box.x1 !== region.box.x1 ||
        old.box.top !== region.box.top ||
        old.box.bottom !== region.box.bottom
      );
    })
    .map((region) => region.id);
  return {
    regionIds,
    previousRegions: candidate.regions.flatMap((region) => {
      const old = previousById.get(region.id);
      return old &&
        old.page === region.page &&
        (old.proposed !== region.proposed || old.state !== region.state)
        ? [{ id: old.id, text: old.proposed, state: old.state }]
        : [];
    }),
    reports,
    note: request.note,
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

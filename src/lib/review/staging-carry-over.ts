import type { EngineDocument } from "./extraction-runs";

// R3: carrying the staging review work (the separate "Extraction Staging"
// database) into the live review records. This file holds the parts that do not
// touch a database, so they can be tested on their own.
//
// Staging keeps each document as a candidate: regions (lines, or table cells)
// with a page, a box in the page render's pixels, the text read (raw) and any
// repaired text (proposed). Each review step is an immutable revision whose
// command lists a finding per region: checked, needs_changes or unreadable.

export type StagingRegion = {
  id: string;
  page: number;
  raw: string | null;
  proposed: string | null;
  state: string;
  box: { x0: number; top: number; x1: number; bottom: number };
  tableCell?: { tableId: string; row: number; column: number };
};
export type StagingCandidate = {
  id: string;
  sourceHash: string;
  title: string;
  officialUrl: string;
  kind: string;
  state: string;
  blockingHolds: string[];
  reviewHolds: string[];
  regions: StagingRegion[];
  renders: { page: number; width: number; height: number }[];
  repair?: { replacesCandidateId: string };
};
export type StagingRevision = {
  action: string;
  createdAt: Date;
  checks: { regionId: string; state: string }[];
  issues: number;
  hasNote: boolean;
};

export const normalized = (text: string | null | undefined) =>
  (text ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

// The text a staging reviewer settled on for a region.
export const settledText = (region: StagingRegion) =>
  normalized(region.proposed ?? region.raw);

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return (
    Math.round(
      (sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) *
        10,
    ) / 10
  );
};

// How the live engine's lines for the same PDF line up with the staging regions:
// lines with the same text on the same page, and how far apart their boxes are
// once the staging box is scaled from render pixels to page points. Counts only.
export function compareWithEngine(
  candidate: StagingCandidate,
  document: EngineDocument,
  requiredIds: Set<string>,
) {
  const regionsByPage = new Map<number, StagingRegion[]>();
  for (const region of candidate.regions)
    regionsByPage.set(region.page, [
      ...(regionsByPage.get(region.page) ?? []),
      region,
    ]);
  const lines = document.pages.flatMap((page) =>
    page.lines
      .filter((line) => !line.excluded && normalized(line.text))
      .map((line) => ({ line, page })),
  );
  let sameText = 0,
    sameAsSettled = 0,
    requiredMatched = 0;
  const dx: number[] = [],
    dy: number[] = [];
  const used = new Set<string>();
  for (const { line, page } of lines) {
    const text = normalized(line.text);
    const candidates = (regionsByPage.get(line.page) ?? []).filter(
      (region) => !used.has(region.id),
    );
    const match =
      candidates.find((region) => settledText(region) === text) ??
      candidates.find((region) => normalized(region.raw) === text);
    if (!match) continue;
    used.add(match.id);
    sameText++;
    if (settledText(match) === text) sameAsSettled++;
    if (requiredIds.has(line.id)) requiredMatched++;
    const render = candidate.renders.find((r) => r.page === line.page);
    if (render) {
      const scale = page.width / render.width;
      dx.push(match.box.x0 * scale - line.box.x0);
      dy.push(match.box.top * scale - line.box.top);
    }
  }
  return {
    engineLines: lines.length,
    engineRequired: requiredIds.size,
    regions: candidate.regions.length,
    matchedByText: sameText,
    matchedToSettledText: sameAsSettled,
    requiredMatched,
    regionsUnmatched: candidate.regions.length - used.size,
    medianBoxOffsetPoints: { x: median(dx), y: median(dy) },
  };
}

// A revision's findings in counts, without notes or text.
export function revisionSummary(revision: StagingRevision) {
  const counts: Record<string, number> = {};
  for (const check of revision.checks)
    counts[check.state] = (counts[check.state] ?? 0) + 1;
  return {
    action: revision.action,
    at: revision.createdAt.toISOString().slice(0, 16).replace("T", " "),
    findings: counts,
    issues: revision.issues,
    note: revision.hasNote,
  };
}

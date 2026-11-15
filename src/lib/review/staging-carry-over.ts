import type { EngineDocument, EngineLine } from "./extraction-runs";
import { validPeriod } from "../tax/registry";

// R3: carrying the staging review work (the separate "Extraction Staging"
// database) into the live review records. This file holds the parts that do not
// touch a database, so they can be tested on their own.
//
// Staging keeps each document as a candidate: regions (lines, or table cells)
// with a page, a box in the page render's pixels, the text read (raw) and any
// repaired text (proposed). Each review step is an immutable revision whose
// payload is the reviewer's command: an action, a note, and a finding per region
// (checked, needs_changes or unreadable). A repair makes a new candidate that
// replaces the old one, so a document's history runs across a lineage.

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
export type StagingCommand = {
  action: string;
  note?: string;
  checks?: { regionId: string; state: string }[];
  issues?: unknown[];
};
export type StagingRevision = {
  action: string;
  createdAt: Date;
  checks: { regionId: string; state: string }[];
  issues: number;
  hasNote: boolean;
};
export type StagingTaxFields = {
  classification?: string;
  appliesTo?: string;
  period?: string;
  notes?: string;
  evidenceIds?: string[];
};

// Who line decisions and text checks carried over from staging are recorded as.
// Staging accounts are separate from live ones, so the reviewer is not named.
export const STAGING_REVIEWER = "staging-review";
export const STAGING_REVIEWER_NAME = "Staging review (carried over)";

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

// Pairs each engine line with the staging region on the same page that has the
// same text: the settled text first, else the text staging first read. Each
// region pairs once. Hindi evidence lines and empty lines are left out.
export function matchLines(
  candidate: StagingCandidate,
  document: EngineDocument,
) {
  const regionsByPage = new Map<number, StagingRegion[]>();
  for (const region of candidate.regions)
    regionsByPage.set(region.page, [
      ...(regionsByPage.get(region.page) ?? []),
      region,
    ]);
  const used = new Set<string>();
  const pairs: { line: EngineLine; region: StagingRegion; scale: number }[] =
    [];
  let engineLines = 0;
  for (const page of document.pages)
    for (const line of page.lines) {
      const text = normalized(line.text);
      if (line.excluded || !text) continue;
      engineLines++;
      const open = (regionsByPage.get(line.page) ?? []).filter(
        (region) => !used.has(region.id),
      );
      const region =
        open.find((r) => settledText(r) === text) ??
        open.find((r) => normalized(r.raw) === text);
      if (!region) continue;
      used.add(region.id);
      const render = candidate.renders.find((r) => r.page === line.page);
      pairs.push({
        line,
        region,
        scale: render ? page.width / render.width : 0,
      });
    }
  return {
    pairs,
    engineLines,
    unmatchedRegions: candidate.regions.length - used.size,
  };
}

// How the live engine's lines for the same PDF line up with the staging regions.
// Counts only.
export function compareWithEngine(
  candidate: StagingCandidate,
  document: EngineDocument,
  requiredIds: Set<string>,
) {
  const { pairs, engineLines, unmatchedRegions } = matchLines(
    candidate,
    document,
  );
  const scaled = pairs.filter((p) => p.scale);
  return {
    engineLines,
    engineRequired: requiredIds.size,
    regions: candidate.regions.length,
    matchedByText: pairs.length,
    matchedToSettledText: pairs.filter(
      (p) => settledText(p.region) === normalized(p.line.text),
    ).length,
    requiredMatched: pairs.filter((p) => requiredIds.has(p.line.id)).length,
    regionsUnmatched: unmatchedRegions,
    medianBoxOffsetPoints: {
      x: median(scaled.map((p) => p.region.box.x0 * p.scale - p.line.box.x0)),
      y: median(scaled.map((p) => p.region.box.top * p.scale - p.line.box.top)),
    },
  };
}

export type PlannedDecision = {
  lineId: string;
  decision: "CONFIRMED" | "CORRECTED" | "UNREADABLE";
  text: string | null;
};

// The live line decisions a staging review implies. A checked region confirms
// its line when staging settled on the engine's text, and corrects it when
// staging settled on other text; an unreadable region marks its line unreadable.
// "Needs changes" and unchecked regions decide nothing. Confirmations are kept
// only for lines live review asks about; corrections and unreadable lines are
// kept for any line, because they change the passages or block acceptance.
// Lines that already have a live decision are left alone.
export function plannedDecisions(
  pairs: ReturnType<typeof matchLines>["pairs"],
  checks: { regionId: string; state: string }[],
  required: Set<string>,
  alreadyDecided: Set<string>,
): PlannedDecision[] {
  const finding = new Map(checks.map((c) => [c.regionId, c.state]));
  const planned: PlannedDecision[] = [];
  for (const { line, region } of pairs) {
    if (alreadyDecided.has(line.id)) continue;
    const state = finding.get(region.id);
    if (state === "unreadable") {
      planned.push({ lineId: line.id, decision: "UNREADABLE", text: null });
      continue;
    }
    if (state !== "checked") continue;
    const settled = settledText(region);
    if (settled && settled !== normalized(line.text))
      planned.push({ lineId: line.id, decision: "CORRECTED", text: settled });
    else if (required.has(line.id))
      planned.push({ lineId: line.id, decision: "CONFIRMED", text: null });
  }
  return planned;
}

// A live tax-review draft from a staging tax review. The live form takes fixed
// values; a staging value fills a field only when it is one of them, and
// everything staging recorded is also kept, word for word, in the draft's note.
export function draftFromStaging(
  fields: StagingTaxFields,
  decision: string,
  decidedAt: Date,
) {
  const text = (value: unknown) =>
    typeof value === "string" ? value.trim() : "";
  const type = text(fields.classification).toUpperCase();
  const period = text(fields.period).toUpperCase().replace(/\s+/g, " ");
  const lines = [
    `Carried over from the staging tax review (${decision === "ACCEPT" ? "accepted" : "draft"}, ${decidedAt.toISOString().slice(0, 10)}). Check it against the source before approving.`,
    text(fields.classification) &&
      `Classification: ${text(fields.classification)}`,
    text(fields.appliesTo) && `Applies to: ${text(fields.appliesTo)}`,
    text(fields.period) && `Period: ${text(fields.period)}`,
    text(fields.notes) && `Notes: ${text(fields.notes)}`,
  ].filter(Boolean);
  const draft: Record<string, string> = {
    note: lines.join("\n").slice(0, 4000),
  };
  if (["ACT", "RULE", "NOTIFICATION", "CIRCULAR", "GUIDANCE"].includes(type))
    draft.documentType = type;
  if (validPeriod(period)) {
    draft.periodMode = "SINGLE_PERIOD";
    draft.period = period;
  }
  if (text(fields.appliesTo))
    draft.applicabilityNote = text(fields.appliesTo).slice(0, 4000);
  return draft;
}

// A revision's findings in counts, without notes or text: for the public log.
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

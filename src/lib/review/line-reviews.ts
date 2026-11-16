import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../http";
import {
  latestRun,
  overviewOf,
  pageLines,
  type EngineDocument,
  type EngineLine,
  type LineForReview,
} from "./extraction-runs";
import { requireReviewer } from "./roles";
import { mostlyDevanagari, needsOneByOne } from "./line-rules";
import { closingLines, type ClosingReason } from "./closing-lines";
import { incomeYears } from "../tax/years";
import { documentFacts } from "./document-facts";
import { STAGING_REVIEWER, STAGING_REVIEWER_NAME } from "./staging-carry-over";

// Line-by-line text check on top of an engine run.
//
// Every line is checked (AD-48): a page's lines can be confirmed together, but
// the lines the rules did not trust (see line-rules) and a small fixed sample of
// the ones they did (to keep the rules honest) are decided one at a time. Hindi
// lines kept as evidence, and the signature and "Copy to" list at the end of an
// order (closing-lines), need nothing. When the text is accepted, the chatbot's
// passages are rebuilt from the run's lines with the reviewers' corrections
// applied, and again whenever a line changes after that.

export const LINE_DECISIONS = [
  "CONFIRMED",
  "CORRECTED",
  "UNREADABLE",
  "LEFT_OUT",
] as const;
export type LineDecision = (typeof LINE_DECISIONS)[number];
// The spot check: about one rule-accepted line in twenty, from one to five.
export const AUDIT_SAMPLE_SIZE = 5;
const AUDIT_SAMPLE_EVERY = 20;
const MAX_PASSAGE_CHARS = 2000;

const lines = (document: EngineDocument) =>
  document.pages.flatMap((page) => page.lines);

// The same lines every time for the same run, so reviewers can share the work.
export function auditSample(
  runId: string,
  checkable: EngineLine[],
  size = AUDIT_SAMPLE_SIZE,
) {
  const key = (line: EngineLine) =>
    createHash("sha256").update(`${runId}:${line.id}`).digest("hex");
  const accepted = checkable.filter((line) => line.status === "accepted");
  return accepted
    .sort((a, b) => key(a).localeCompare(key(b)))
    .slice(
      0,
      Math.min(
        size,
        Math.max(1, Math.ceil(accepted.length / AUDIT_SAMPLE_EVERY)),
      ),
    );
}

// all: every line a person checks; attention: those the rules did not accept;
// sample: the spot check; leftOut: the signature and "Copy to" lines.
export function requiredLines(runId: string, document: EngineDocument) {
  const leftOut = closingLines(document);
  const all = lines(document).filter(
    (line) => !line.excluded && line.text.trim() && !leftOut.has(line.id),
  );
  return {
    all,
    attention: all.filter((line) => line.status !== "accepted"),
    sample: auditSample(runId, all),
    leftOut,
  };
}

export type Decided = {
  decision: LineDecision;
  text: string | null;
  reviewer: string;
  at: Date;
};

export async function lineDecisions(runId: string) {
  const rows = await prisma.lineReview.findMany({
    where: { runId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      lineId: true,
      decision: true,
      text: true,
      reviewerId: true,
      createdAt: true,
    },
  });
  const latest = new Map<string, Decided>();
  for (const row of rows)
    latest.set(row.lineId, {
      decision: row.decision as LineDecision,
      text: row.text,
      reviewer: row.reviewerId,
      at: row.createdAt,
    });
  return latest;
}

export function progress(
  required: { all: EngineLine[] },
  decisions: Map<string, Decided>,
) {
  const all = required.all;
  const undecided = all.filter((line) => !decisions.has(line.id));
  const unreadable = all.filter(
    (line) => decisions.get(line.id)?.decision === "UNREADABLE",
  );
  return {
    required: all.length,
    decided: all.length - undecided.length,
    undecided: undecided.length,
    unreadable: unreadable.length,
    complete: !undecided.length && !unreadable.length,
  };
}

function cleanCorrection(value: unknown) {
  if (typeof value !== "string")
    throw new HttpError(400, "Type the corrected text.");
  const text = value.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!text || text.length > 2000)
    throw new HttpError(
      400,
      "A correction must be between 1 and 2,000 characters.",
    );
  if (/[\u0000-\u001f\u007f‪-‮⁦-⁩]/u.test(text))
    throw new HttpError(400, "The correction contains control characters.");
  return text;
}

// The document must still await review, and the decision must be for the
// engine run the reviewer saw.
async function openRun(versionId: string, runId: unknown) {
  const version = await prisma.taxVersion.findUnique({
    where: { id: versionId },
    select: { status: true, document: { select: { latestVersionId: true } } },
  });
  if (
    !version ||
    version.document.latestVersionId !== versionId ||
    version.status !== "PENDING"
  )
    throw new HttpError(
      409,
      "This document is no longer awaiting review. Reload the page.",
    );
  const run = await latestRun(versionId);
  if (!run || run.status !== "OK" || !run.document || run.id !== runId)
    throw new HttpError(
      409,
      "The engine has read this document again. Reload the page.",
    );
  return { run, document: run.document as unknown as EngineDocument };
}

export async function recordLineDecision(
  userId: string,
  versionId: string,
  input: { runId: unknown; lineId: unknown; decision: unknown; text?: unknown },
) {
  await requireReviewer(userId, "EXTRACTION");
  if (!LINE_DECISIONS.includes(input.decision as LineDecision))
    throw new HttpError(400, "Unknown line decision.");
  const decision = input.decision as LineDecision;
  const { run, document } = await openRun(versionId, input.runId);
  const line = lines(document).find((l) => l.id === input.lineId);
  if (!line || line.excluded)
    throw new HttpError(400, "That line is not part of the review.");
  const text = decision === "CORRECTED" ? cleanCorrection(input.text) : null;
  return prisma.$transaction(
    async (tx) => {
      const saved = await tx.lineReview.create({
        data: {
          versionId,
          runId: run.id,
          lineId: line.id,
          decision,
          text,
          reviewerId: userId,
        },
        select: { lineId: true, decision: true, text: true, createdAt: true },
      });
      const acceptedText = await followAcceptedText(
        tx,
        userId,
        versionId,
        decision === "UNREADABLE",
      );
      return { ...saved, acceptedText };
    },
    { timeout: 30_000 },
  );
}

// When the text is already accepted and a line then changes, the chatbot's
// passages follow at once: they are rebuilt and the acceptance recorded again,
// so nobody has to remember to accept the text a second time. A line marked
// unreadable withdraws the acceptance instead, which stops publication until it
// is resolved.
async function followAcceptedText(
  tx: Prisma.TransactionClient,
  userId: string,
  versionId: string,
  unreadable: boolean,
): Promise<"rebuilt" | "withdrawn" | "incomplete" | null> {
  const latest = await tx.extractionReview.findFirst({
    where: { versionId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { decision: true },
  });
  if (latest?.decision !== "ACCEPTED") return null;
  if (unreadable) {
    await tx.extractionReview.create({
      data: {
        versionId,
        reviewerId: userId,
        decision: "NEEDS_CHANGES",
        note: "A line was marked unreadable after the text was accepted.",
      },
    });
    return "withdrawn";
  }
  try {
    await applyReviewedLines(tx, versionId);
  } catch (error) {
    // Accepted under the older rule, when only some lines needed a decision:
    // the rest must be checked before the passages can be rebuilt.
    if (error instanceof HttpError && error.status === 409) return "incomplete";
    throw error;
  }
  await tx.extractionReview.create({
    data: {
      versionId,
      reviewerId: userId,
      decision: "ACCEPTED",
      note: "Passages rebuilt after a line was changed.",
    },
  });
  return "rebuilt";
}

export const MAX_LINES_AT_ONCE = 500;

// "Text is right" for many lines at once: the rest of a page after looking at
// it. Refuses lines that must be decided one at a time.
export async function confirmLines(
  userId: string,
  versionId: string,
  input: { runId: unknown; lineIds: unknown },
) {
  await requireReviewer(userId, "EXTRACTION");
  const ids = input.lineIds;
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > MAX_LINES_AT_ONCE ||
    ids.some((id) => typeof id !== "string") ||
    new Set(ids).size !== ids.length
  )
    throw new HttpError(400, "Choose the lines to confirm.");
  const { run, document } = await openRun(versionId, input.runId);
  const byId = new Map(lines(document).map((line) => [line.id, line]));
  const chosen = (ids as string[]).map((id) => byId.get(id));
  if (chosen.some((line) => !line || line.excluded))
    throw new HttpError(400, "A chosen line is not part of the review.");
  const spot = new Set(
    requiredLines(run.id, document).sample.map((line) => line.id),
  );
  const oneByOne = chosen.filter(
    (line) => needsOneByOne(line!) || spot.has(line!.id),
  ).length;
  if (oneByOne)
    throw new HttpError(
      400,
      `${oneByOne} of the chosen line${oneByOne === 1 ? "" : "s"} must be looked at one at a time.`,
    );
  return prisma.$transaction(
    async (tx) => {
      await tx.lineReview.createMany({
        data: chosen.map((line) => ({
          versionId,
          runId: run.id,
          lineId: line!.id,
          decision: "CONFIRMED",
          text: null,
          reviewerId: userId,
        })),
      });
      const acceptedText = await followAcceptedText(
        tx,
        userId,
        versionId,
        false,
      );
      return { confirmed: chosen.length, acceptedText };
    },
    { timeout: 30_000 },
  );
}

export type ReviewLine = LineForReview & {
  decision: {
    decision: LineDecision;
    text: string | null;
    reviewer: string;
    at: string;
  } | null;
};

// One entry per line a person checks, in reading order: every line with text
// except Hindi evidence and the closing lines. "spotCheck" marks the sample that
// is looked at one at a time although the rules accepted it. Kept small, because
// a long scan can have thousands; the lines themselves load page by page.
export type QueueEntry = {
  id: string;
  page: number;
  spotCheck: boolean;
  decision: LineDecision | null;
};
// Lines left out of the passages, shown greyed on the page with the reason.
export type LeftOut = { id: string; reason: ClosingReason };

async function reviewerNames(decisions: Map<string, Decided>) {
  const ids = [...new Set([...decisions.values()].map((d) => d.reviewer))];
  if (!ids.length) return new Map<string, string>();
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true },
  });
  return new Map(users.map((user) => [user.id, user.name ?? user.email]));
}

// What the review page shows up front: the engine overview, the queue of lines
// that need a decision, and how far along the check is.
export async function lineReviewOverview(versionId: string) {
  // The run's document can be several megabytes, so it is read once.
  const run = await latestRun(versionId);
  const overview = overviewOf(run);
  if (overview?.status !== "OK") return overview;
  const document = run!.document as unknown as EngineDocument;
  const required = requiredLines(run!.id, document);
  const decisions = await lineDecisions(run!.id);
  const spot = new Set(required.sample.map((line) => line.id));
  const queue: QueueEntry[] = required.all.map((line) => ({
    id: line.id,
    page: line.page,
    spotCheck: spot.has(line.id),
    decision: decisions.get(line.id)?.decision ?? null,
  }));
  return {
    ...overview,
    runId: run!.id,
    queue,
    leftOut: [...required.leftOut].map(([id, reason]): LeftOut => ({
      id,
      reason,
    })),
    sampleSize: required.sample.length,
    // Facts come from the reviewed text: corrections in, left-out lines out.
    facts: documentFacts(
      document,
      new Map(
        [...decisions]
          .filter(
            ([, d]) =>
              (d.decision === "CORRECTED" && d.text) ||
              d.decision === "LEFT_OUT",
          )
          .map(([id, d]) => [id, d.decision === "LEFT_OUT" ? "" : d.text!]),
      ),
    ),
    progress: progress(required, decisions),
  };
}

// One page's lines for the review screen, each with its latest decision. Which
// lines need one is in the overview's queue.
export async function pageForReview(
  userId: string,
  versionId: string,
  page: number,
) {
  const found = await pageLines(userId, versionId, page);
  const decisions = await lineDecisions(found.runId);
  const names = await reviewerNames(decisions);
  return {
    ...found,
    lines: found.lines.map((line): ReviewLine => {
      const decided = decisions.get(line.id);
      return {
        ...line,
        decision: decided
          ? {
              decision: decided.decision,
              text: decided.text,
              reviewer:
                names.get(decided.reviewer) ??
                (decided.reviewer === STAGING_REVIEWER
                  ? STAGING_REVIEWER_NAME
                  : "Former reviewer"),
              at: decided.at.toISOString(),
            }
          : null,
      };
    }),
  };
}

// ---- Rebuilding the chatbot's passages -------------------------------------

export type Passage = {
  anchor: string;
  text: string;
  page: number;
  // The headings the passage sits under: the document's opening heading block,
  // then the latest heading after it (a schedule, chapter, annexure...).
  headings: string[];
  // Income years named in the passage or its headings ("2026-27").
  incomeYears: string[];
};

// Lines become paragraphs (joined with spaces), tables stay together (one row per
// line), and paragraphs are packed into passages of up to 2,000 characters on one
// page, under one heading path, without ever splitting a paragraph. Hindi
// evidence lines, the signature and the "Copy to" list are left out. Headings are the lines the engine marked as such
// (larger or bold short lines, or CHAPTER, SCHEDULE, ANNEXURE...); consecutive
// heading lines form one heading.
export function passagesFrom(
  document: EngineDocument,
  decisions: Map<string, Decided>,
): Passage[] {
  const passages: Passage[] = [];
  const closing = closingLines(document);
  let header: string | null = null;
  let current: string | null = null;
  for (const page of document.pages) {
    const units: { text: string; heading: boolean }[] = [];
    let unit: {
      key: string;
      parts: string[];
      table: boolean;
      heading: boolean;
    } | null = null;
    for (const line of page.lines) {
      // Hindi evidence, and the signature and "Copy to" list (closing-lines).
      if (line.excluded || closing.has(line.id)) continue;
      const decided = decisions.get(line.id);
      // A reviewer said it is not part of the text.
      if (decided?.decision === "LEFT_OUT") continue;
      const text = (
        decided?.decision === "CORRECTED" ? decided.text! : line.text
      ).trim();
      // Hindi stays evidence only (AD decision of 15 November): the engine
      // leaves out lines that are wholly Devanagari, and this also leaves out
      // mixed ones that are mostly Devanagari, such as a Gazette header with
      // Roman numerals ("[भाग II—खण्ड 3(ii)] भारत का राजपत्र").
      if (!text || mostlyDevanagari(text)) continue;
      const key = line.table_id ? `t:${line.table_id}` : `p:${line.paragraph}`;
      if (!unit || unit.key !== key) {
        if (unit)
          units.push({
            text: unit.parts.join(unit.table ? "\n" : " "),
            heading: unit.heading,
          });
        unit = {
          key,
          parts: [],
          table: !!line.table_id,
          heading: line.role === "heading" && !line.table_id,
        };
      }
      unit.parts.push(text);
    }
    if (unit)
      units.push({
        text: unit.parts.join(unit.table ? "\n" : " "),
        heading: unit.heading,
      });

    let packed = "";
    let packedPath: string[] = [];
    const flush = () => {
      if (packed)
        passages.push({
          anchor: `Page ${page.number}, passage ${passages.filter((p) => p.anchor.startsWith(`Page ${page.number},`)).length + 1}`,
          text: packed,
          page: page.number,
          headings: packedPath,
          incomeYears: incomeYears(`${packedPath.join("\n")}\n${packed}`),
        });
      packed = "";
    };
    for (let i = 0; i < units.length; i++) {
      const { text, heading } = units[i];
      // A run of heading lines is one heading: set it once, at the run's start.
      if (heading && !units[i - 1]?.heading) {
        let block = text;
        for (let j = i + 1; j < units.length && units[j].heading; j++)
          block = `${block} ${units[j].text}`;
        if (header === null) header = block;
        else current = block;
      }
      const path = [header, current].filter((h): h is string => !!h);
      if (packed && path.join("\n") !== packedPath.join("\n")) flush();
      packedPath = path;
      for (let k = 0; k < text.length; k += MAX_PASSAGE_CHARS) {
        const part = text.slice(k, k + MAX_PASSAGE_CHARS);
        if (packed && packed.length + part.length + 2 > MAX_PASSAGE_CHARS)
          flush();
        packed = packed ? `${packed}\n\n${part}` : part;
      }
    }
    flush();
  }
  return passages;
}

// Called inside the text-check transaction. Returns the number of passages, or
// null when the version has no usable engine run (the existing passages stay).
export async function applyReviewedLines(
  tx: Prisma.TransactionClient,
  versionId: string,
) {
  const run = await tx.extractionRun.findFirst({
    where: { versionId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (!run || run.status !== "OK" || !run.document) return null;
  const document = run.document as unknown as EngineDocument;
  const rows = await tx.lineReview.findMany({
    where: { runId: run.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const decisions = new Map<string, Decided>();
  for (const row of rows)
    decisions.set(row.lineId, {
      decision: row.decision as LineDecision,
      text: row.text,
      reviewer: row.reviewerId,
      at: row.createdAt,
    });
  const state = progress(requiredLines(run.id, document), decisions);
  if (!state.complete)
    throw new HttpError(
      409,
      state.unreadable
        ? `${state.unreadable} line${state.unreadable === 1 ? " is" : "s are"} marked unreadable. Report the problem instead of accepting.`
        : `${state.undecided} line${state.undecided === 1 ? " still needs" : "s still need"} a decision before the text can be accepted.`,
    );
  const passages = passagesFrom(document, decisions);
  if (!passages.length)
    throw new HttpError(409, "The reviewed lines contain no text to publish.");
  await tx.taxChunk.deleteMany({ where: { versionId } });
  await tx.taxChunk.createMany({
    data: passages.map((p) => ({ versionId, ...p })),
  });
  return passages.length;
}

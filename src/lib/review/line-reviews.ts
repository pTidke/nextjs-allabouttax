import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../http";
import {
  forReview,
  latestRun,
  overviewOf,
  type EngineDocument,
  type EngineLine,
  type LineForReview,
} from "./extraction-runs";
import { requireReviewer } from "./roles";

// Line-by-line text check on top of an engine run.
//
// A person must decide every line the engine did not accept, plus a small fixed
// sample of the lines it did accept (to keep the rules honest). Hindi lines kept as
// evidence need nothing. When the text check is accepted, the chatbot's passages
// are rebuilt from the run's lines with the reviewers' corrections applied.

export const LINE_DECISIONS = ["CONFIRMED", "CORRECTED", "UNREADABLE"] as const;
export type LineDecision = (typeof LINE_DECISIONS)[number];
export const AUDIT_SAMPLE_SIZE = 5;
const MAX_PASSAGE_CHARS = 2000;

const lines = (document: EngineDocument) =>
  document.pages.flatMap((page) => page.lines);

// The same lines every time for the same run, so reviewers can share the work.
export function auditSample(
  runId: string,
  document: EngineDocument,
  size = AUDIT_SAMPLE_SIZE,
) {
  const key = (line: EngineLine) =>
    createHash("sha256").update(`${runId}:${line.id}`).digest("hex");
  return lines(document)
    .filter(
      (line) =>
        !line.excluded && line.status === "accepted" && line.text.trim(),
    )
    .sort((a, b) => key(a).localeCompare(key(b)))
    .slice(0, size);
}

export function requiredLines(runId: string, document: EngineDocument) {
  const attention = lines(document).filter(
    (line) => !line.excluded && line.status !== "accepted",
  );
  return { attention, sample: auditSample(runId, document) };
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
  required: { attention: EngineLine[]; sample: EngineLine[] },
  decisions: Map<string, Decided>,
) {
  const all = [...required.attention, ...required.sample];
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

export async function recordLineDecision(
  userId: string,
  versionId: string,
  input: { runId: unknown; lineId: unknown; decision: unknown; text?: unknown },
) {
  await requireReviewer(userId, "EXTRACTION");
  if (!LINE_DECISIONS.includes(input.decision as LineDecision))
    throw new HttpError(400, "Unknown line decision.");
  const decision = input.decision as LineDecision;
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
  if (!run || run.status !== "OK" || !run.document || run.id !== input.runId)
    throw new HttpError(
      409,
      "The engine has read this document again. Reload the page.",
    );
  const line = lines(run.document as unknown as EngineDocument).find(
    (l) => l.id === input.lineId,
  );
  if (!line || line.excluded)
    throw new HttpError(400, "That line is not part of the review.");
  return prisma.lineReview.create({
    data: {
      versionId,
      runId: run.id,
      lineId: line.id,
      decision,
      text: decision === "CORRECTED" ? cleanCorrection(input.text) : null,
      reviewerId: userId,
    },
    select: { lineId: true, decision: true, text: true, createdAt: true },
  });
}

export type ReviewLine = LineForReview & {
  // Where the line falls in reading order across the whole document.
  position: number;
  decision: {
    decision: LineDecision;
    text: string | null;
    reviewer: string;
    at: string;
  } | null;
};

// What the review page shows: the engine overview, every line that needs a
// decision with its current decision, and how far along the check is.
export async function lineReviewOverview(versionId: string) {
  // The run's document can be several megabytes, so it is read once.
  const run = await latestRun(versionId);
  const overview = overviewOf(run);
  if (overview?.status !== "OK") return overview;
  const document = run!.document as unknown as EngineDocument;
  const required = requiredLines(run!.id, document);
  const decisions = await lineDecisions(run!.id);
  const names = new Map(
    (
      await prisma.user.findMany({
        where: {
          id: {
            in: [...new Set([...decisions.values()].map((d) => d.reviewer))],
          },
        },
        select: { id: true, name: true, email: true },
      })
    ).map((user) => [user.id, user.name ?? user.email]),
  );
  const position = new Map(lines(document).map((line, i) => [line.id, i]));
  const withDecision = (line: EngineLine): ReviewLine => {
    const found = decisions.get(line.id);
    return {
      ...forReview(line),
      position: position.get(line.id) ?? 0,
      decision: found
        ? {
            decision: found.decision,
            text: found.text,
            reviewer: names.get(found.reviewer) ?? "Former reviewer",
            at: found.at.toISOString(),
          }
        : null,
    };
  };
  return {
    ...overview,
    runId: run!.id,
    attention: required.attention.slice(0, 500).map(withDecision),
    sample: required.sample.map(withDecision),
    progress: progress(required, decisions),
  };
}

// ---- Rebuilding the chatbot's passages -------------------------------------

// Lines become paragraphs (joined with spaces), tables stay together (one row per
// line), and paragraphs are packed into passages of up to 2,000 characters on one
// page without ever splitting a paragraph. Hindi evidence lines are left out.
export function passagesFrom(
  document: EngineDocument,
  decisions: Map<string, Decided>,
) {
  const passages: { anchor: string; text: string }[] = [];
  for (const page of document.pages) {
    const units: string[] = [];
    let current: { key: string; parts: string[]; table: boolean } | null = null;
    for (const line of page.lines) {
      if (line.excluded) continue;
      const decided = decisions.get(line.id);
      const text = (
        decided?.decision === "CORRECTED" ? decided.text! : line.text
      ).trim();
      if (!text) continue;
      const key = line.table_id ? `t:${line.table_id}` : `p:${line.paragraph}`;
      if (!current || current.key !== key) {
        if (current) units.push(current.parts.join(current.table ? "\n" : " "));
        current = { key, parts: [], table: !!line.table_id };
      }
      current.parts.push(text);
    }
    if (current) units.push(current.parts.join(current.table ? "\n" : " "));
    let packed = "";
    const flush = () => {
      if (packed)
        passages.push({
          anchor: `Page ${page.number}, passage ${passages.filter((p) => p.anchor.startsWith(`Page ${page.number},`)).length + 1}`,
          text: packed,
        });
      packed = "";
    };
    for (const unit of units) {
      for (let i = 0; i < unit.length; i += MAX_PASSAGE_CHARS) {
        const part = unit.slice(i, i + MAX_PASSAGE_CHARS);
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

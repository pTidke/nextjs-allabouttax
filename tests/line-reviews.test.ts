import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@prisma/client";
import type {
  EngineDocument,
  EngineLine,
} from "../src/lib/review/extraction-runs";

const database = new PGlite();
const db = new PrismaClient({ adapter: new PrismaPGlite(database) });
const bin = fileURLToPath(
  new URL("./fixtures/fake-pdfanchor.mjs", import.meta.url),
);
let lines: typeof import("../src/lib/review/line-reviews");
let runs: typeof import("../src/lib/review/extraction-runs");
let upload: typeof import("../src/lib/tax/upload");
let workflow: typeof import("../src/lib/review/workflow");
before(async () => {
  for (const name of (await readdir("prisma/migrations")).sort())
    if (!name.endsWith(".toml"))
      await database.exec(
        await readFile(`prisma/migrations/${name}/migration.sql`, "utf8"),
      );
  (globalThis as unknown as { prisma: PrismaClient }).prisma = db;
  lines = await import("../src/lib/review/line-reviews");
  runs = await import("../src/lib/review/extraction-runs");
  upload = await import("../src/lib/tax/upload");
  workflow = await import("../src/lib/review/workflow");
});
after(async () => {
  await db.$disconnect();
  await database.close();
});

function line(
  id: string,
  text: string,
  extra: Partial<EngineLine> = {},
): EngineLine {
  return {
    id,
    page: 1,
    order: 0,
    box: { x0: 0, top: 0, x1: 1, bottom: 1 },
    text,
    source: "native",
    readings: [],
    status: "accepted",
    flags: [],
    excluded: null,
    role: "body",
    paragraph: 0,
    table_id: null,
    ...extra,
  };
}

test("passages keep paragraphs whole, tables together, corrections in and Hindi out, with headings and years", () => {
  const document = {
    source: { sha256: "x", pages: 2 },
    pages: [
      {
        number: 1,
        width: 1,
        height: 1,
        rotation: 0,
        kind: "native",
        flags: [],
        lines: [
          line("a", "भारत का राजपत्र", { excluded: "script:Deva" }),
          // Mixed, but mostly Hindi: a Gazette header with Roman numerals.
          line("a2", "[भाग II—खण्ड 3(ii)] भारत का राजपत्र : असाधारण 3"),
          line("b", "nnnnMINISTRY OF FINANCE", {
            paragraph: 0,
            status: "flagged",
            role: "heading",
          }),
          line("b2", "(Department of Revenue)", {
            paragraph: 1,
            role: "heading",
          }),
          line("c", "The due date for the assessment year", { paragraph: 2 }),
          line("d", "2026-27 is extended to 31st October 2026.", {
            paragraph: 2,
          }),
          line("e", "Class | Limit", { table_id: "t1", role: "table" }),
          line("f", "Individual | 1,50,000", { table_id: "t1", role: "table" }),
        ],
      },
      {
        number: 2,
        width: 1,
        height: 1,
        rotation: 0,
        kind: "scanned",
        flags: [],
        lines: [
          line("g", "Annexure A", { page: 2, role: "heading" }),
          line("h", "Applies to tax years 2026-27 to 2027-28.", {
            page: 2,
            paragraph: 1,
          }),
        ],
      },
    ],
  } as unknown as EngineDocument;
  const decided = new Map([
    [
      "b",
      {
        decision: "CORRECTED" as const,
        text: "MINISTRY OF FINANCE",
        reviewer: "r",
        at: new Date(),
      },
    ],
  ]);
  assert.deepEqual(lines.passagesFrom(document, decided), [
    {
      anchor: "Page 1, passage 1",
      text: "MINISTRY OF FINANCE\n\n(Department of Revenue)\n\nThe due date for the assessment year 2026-27 is extended to 31st October 2026.\n\nClass | Limit\nIndividual | 1,50,000",
      page: 1,
      pageEnd: 1,
      // Consecutive heading lines are one heading, corrected text included.
      headings: ["MINISTRY OF FINANCE (Department of Revenue)"],
      context: "MINISTRY OF FINANCE (Department of Revenue)",
      kind: "text",
      // Assessment year 2026-27 assesses the income of 2025-26.
      incomeYears: ["2025-26"],
      provisions: [],
    },
    {
      anchor: "Page 2, passage 1",
      text: "Annexure A\n\nApplies to tax years 2026-27 to 2027-28.",
      page: 2,
      pageEnd: 2,
      headings: ["MINISTRY OF FINANCE (Department of Revenue)", "Annexure A"],
      context: "MINISTRY OF FINANCE (Department of Revenue) › Annexure A",
      kind: "text",
      incomeYears: ["2026-27", "2027-28"],
      provisions: [],
    },
  ]);
  // Long pages split between paragraphs, never inside one.
  const long = {
    ...document,
    pages: [
      {
        ...document.pages[0],
        lines: [0, 1, 2].map((n) =>
          line(`p${n}`, `${"x".repeat(899)}.`, { paragraph: n }),
        ),
      },
    ],
  } as EngineDocument;
  assert.deepEqual(
    lines.passagesFrom(long, new Map()).map((p) => [p.anchor, p.text.length]),
    [
      ["Page 1, passage 1", 1802],
      ["Page 1, passage 2", 900],
    ],
  );
});

let versionId: string, reviewer: string, runId: string;
test("every flagged line and the spot check must be decided before the text is accepted", async () => {
  reviewer = (
    await db.user.create({
      data: { email: "r@example.test", name: "Reviewer" },
    })
  ).id;
  await db.reviewerGrant.create({
    data: { userId: reviewer, role: "EXTRACTION", grantedBy: reviewer },
  });
  // A scan: no text layer, so it starts with no passages and a "needs OCR" note.
  const uploaded = await upload.uploadDocument({
    bytes: Buffer.from("%PDF-1.4\n% scan\n%%EOF"),
    title: "Scanned notification",
    officialUrl: "https://egazette.nic.in/scan-1.pdf",
  });
  versionId = uploaded.versionId;
  assert.equal(uploaded.needsOcr, true);
  await runs.extractPending({
    bin,
    engine: "pdfanchor test",
    limit: 5,
    budgetMs: 60_000,
  });
  // Once the engine has read it, it moves from "Needs OCR" to "Needs text check".
  const queue = await workflow.reviewQueue("all", 0);
  assert.equal(queue.counts.ocr, 0);
  assert.equal(queue.counts.text, 1);

  const overview = await lines.lineReviewOverview(versionId);
  assert.equal(overview?.status, "OK");
  if (overview?.status !== "OK") return;
  runId = overview.runId;
  // The queue lists every line in reading order; the one rule-accepted line is
  // the spot check.
  assert.deepEqual(overview.queue, [
    { id: "p1-l1", page: 1, spotCheck: false, decision: null },
    { id: "p1-l2", page: 1, spotCheck: true, decision: null },
    { id: "p2-l1", page: 2, spotCheck: false, decision: null },
  ]);
  assert.deepEqual(overview.leftOut, []);
  assert.equal(overview.sampleSize, 1);
  assert.deepEqual(overview.progress, {
    required: 3,
    decided: 0,
    undecided: 3,
    unreadable: 0,
    complete: false,
  });
  await assert.rejects(
    workflow.recordTextCheck(reviewer, versionId, "ACCEPTED", ""),
    {
      status: 409,
    },
  );

  const decide = (
    lineId: string,
    decision: string,
    text?: string,
    run = runId,
  ) =>
    lines.recordLineDecision(reviewer, versionId, {
      runId: run,
      lineId,
      decision,
      text,
    });
  const outsider = (await db.user.create({ data: { email: "o@example.test" } }))
    .id;
  await assert.rejects(
    lines.recordLineDecision(outsider, versionId, {
      runId,
      lineId: "p1-l1",
      decision: "CONFIRMED",
    }),
    { status: 403 },
  );
  await assert.rejects(decide("nope", "CONFIRMED"), { status: 400 });
  await assert.rejects(decide("p1-l1", "MAYBE"), { status: 400 });
  await assert.rejects(decide("p1-l1", "CORRECTED", "   "), { status: 400 });
  await assert.rejects(decide("p1-l1", "CONFIRMED", undefined, "old-run"), {
    status: 409,
  });

  await decide("p1-l1", "CORRECTED", "  MINISTRY   OF FINANCE ");
  await decide("p2-l1", "UNREADABLE");
  await decide("p1-l2", "CONFIRMED");
  await assert.rejects(
    workflow.recordTextCheck(reviewer, versionId, "ACCEPTED", ""),
    { status: 409, message: /unreadable/ },
  );
  // Problems can always be reported, decided or not.
  await workflow.recordTextCheck(
    reviewer,
    versionId,
    "NEEDS_CHANGES",
    "Page 2 is too faint.",
  );
  // A later decision replaces an earlier one.
  await decide("p2-l1", "CORRECTED", "Annexure A");
  const ready = await lines.lineReviewOverview(versionId);
  assert.equal(ready?.status === "OK" && ready.progress.complete, true);
  assert.deepEqual(
    ready?.status === "OK" && ready.queue.map((e) => e.decision),
    ["CORRECTED", "CONFIRMED", "CORRECTED"],
  );
  const pageOne = await lines.pageForReview(reviewer, versionId, 1);
  assert.equal(
    pageOne.lines[0].decision?.text,
    "MINISTRY OF FINANCE",
    "corrections are tidied",
  );
  assert.equal(pageOne.lines[0].decision?.reviewer, "Reviewer");
});

test("accepting rebuilds the chatbot's passages from the reviewed lines", async () => {
  await workflow.recordTextCheck(reviewer, versionId, "ACCEPTED", "");
  const chunks = await db.taxChunk.findMany({
    where: { versionId },
    orderBy: { anchor: "asc" },
    select: { anchor: true, text: true },
  });
  // Short pages pack into one passage across the page break; it records both.
  assert.deepEqual(chunks, [
    {
      anchor: "Page 1, passage 1",
      text: "MINISTRY OF FINANCE NOTIFICATION\n\nAnnexure A",
    },
  ]);
  const document = await db.taxDocument.findFirstOrThrow({
    where: { latestVersionId: versionId },
  });
  assert.equal(
    document.lastError,
    null,
    "the upload is no longer held back as needing OCR",
  );
  const queue = await workflow.reviewQueue("tax", 0);
  assert.equal(queue.items[0].versionId, versionId);
  // A newer engine does not reopen text that a person has accepted.
  assert.deepEqual(await runs.versionsToExtract("pdfanchor newer", 10), []);
});

test("a line changed after acceptance rebuilds the passages at once; an unreadable one withdraws the acceptance", async () => {
  await db.reviewerGrant.create({
    data: { userId: reviewer, role: "TAX", grantedBy: reviewer },
  });
  const accepted = await workflow.latestTextCheck(versionId);
  assert.equal(await workflow.linesChangedSince(versionId, accepted), 0);
  // Unreadable after acceptance: the acceptance is withdrawn.
  const unreadable = await lines.recordLineDecision(reviewer, versionId, {
    runId,
    lineId: "p1-l2",
    decision: "UNREADABLE",
  });
  assert.equal(unreadable.acceptedText, "withdrawn");
  assert.equal(
    (await workflow.latestTextCheck(versionId))?.decision,
    "NEEDS_CHANGES",
  );
  await lines.recordLineDecision(reviewer, versionId, {
    runId,
    lineId: "p1-l2",
    decision: "CONFIRMED",
  });
  await workflow.recordTextCheck(reviewer, versionId, "ACCEPTED", "");
  // A correction after acceptance: the passages follow without a second accept.
  const corrected = await lines.recordLineDecision(reviewer, versionId, {
    runId,
    lineId: "p1-l2",
    decision: "CORRECTED",
    text: "NOTIFICATION No. 1",
  });
  assert.equal(corrected.acceptedText, "rebuilt");
  const latest = await workflow.latestTextCheck(versionId);
  assert.equal(latest?.decision, "ACCEPTED");
  assert.equal(await workflow.linesChangedSince(versionId, latest), 0);
  const review = {
    versionId,
    action: "approve" as const,
    sectionIds: ["full-document"],
    documentType: "NOTIFICATION",
    legalStatus: "EFFECTIVE",
    period: "TY 2026-27",
    effectiveFrom: "2026-04-01",
    note: "Synthetic reviewed test only.",
  };
  const page = await workflow.reviewDocument(reviewer, versionId);
  assert.equal(page.changedSinceAcceptance, 0);
  const chunks = await db.taxChunk.findMany({
    where: { versionId },
    orderBy: { anchor: "asc" },
    select: { text: true },
  });
  assert.equal(
    chunks[0].text,
    // No full stop before the page break: read as running on.
    "MINISTRY OF FINANCE NOTIFICATION No. 1 Annexure A",
  );

  // Approval stores the document facts the reviewer confirmed.
  await workflow.recordTaxDecision(reviewer, {
    ...review,
    documentNumber: " 1/2026 ",
    gazetteNumber: "S.O. 44(E)",
    issuingAuthority: "Ministry of Finance",
    issuedOn: "2026-01-05",
  });
  const approved = await db.taxVersion.findUniqueOrThrow({
    where: { id: versionId },
  });
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.documentNumber, "1/2026");
  assert.equal(approved.gazetteNumber, "S.O. 44(E)");
  assert.equal(approved.issuedOn?.toISOString().slice(0, 10), "2026-01-05");
  await assert.rejects(
    workflow.recordTaxDecision(reviewer, { ...review, issuedOn: "5 Jan" }),
    { status: 400 },
  );
});

test("a whole page can be confirmed at once, except lines that need a look on their own", async () => {
  const fresh = await upload.uploadDocument({
    bytes: Buffer.from("%PDF-1.4\n% another scan\n%%EOF"),
    title: "Another notification",
    officialUrl: "https://egazette.nic.in/scan-2.pdf",
  });
  await runs.extractPending({
    bin,
    engine: "pdfanchor test",
    limit: 5,
    budgetMs: 60_000,
  });
  const overview = await lines.lineReviewOverview(fresh.versionId);
  assert.equal(overview?.status, "OK");
  if (overview?.status !== "OK") return;
  const confirm = (lineIds: unknown) =>
    lines.confirmLines(reviewer, fresh.versionId, {
      runId: overview.runId,
      lineIds,
    });
  // p1-l1's OCR reading differs from its text, and p1-l2 is the spot check:
  // both must be looked at on their own.
  for (const id of ["p1-l1", "p1-l2"])
    await assert.rejects(confirm([id, "p2-l1"]), {
      status: 400,
      message: /one at a time/,
    });
  await assert.rejects(confirm([]), { status: 400 });
  await assert.rejects(confirm(["p2-l1", "p2-l1"]), { status: 400 });
  await assert.rejects(confirm(["nope"]), { status: 400 });
  // The single-reader scan line without a number can go with its page.
  assert.deepEqual(await confirm(["p2-l1"]), {
    confirmed: 1,
    acceptedText: null,
  });
  const after = await lines.lineReviewOverview(fresh.versionId);
  assert.equal(after?.status === "OK" && after.progress.undecided, 2);
});

test("a newer engine's reading keeps the decisions on lines that read the same", async () => {
  // The fresh document of the test above has p2-l1 confirmed and nothing else.
  const before = await db.taxVersion.findFirstOrThrow({
    where: { document: { title: "Another notification" } },
    select: { id: true },
  });
  const old = await lines.lineReviewOverview(before.id);
  assert.equal(old?.status === "OK" && old.progress.decided, 1);
  const result = await runs.extractPending({
    bin,
    engine: "pdfanchor newer",
    limit: 5,
    budgetMs: 60_000,
  });
  assert.ok(result.decisionsCarried >= 1);
  const now = await lines.lineReviewOverview(before.id);
  assert.equal(now?.status, "OK");
  if (now?.status !== "OK" || old?.status !== "OK") return;
  assert.notEqual(now.runId, old.runId, "a new reading");
  assert.equal(now.progress.decided, 1, "the confirmed line carried over");
  assert.equal(now.queue.find((e) => e.id === "p2-l1")?.decision, "CONFIRMED");
  // The accepted document is not read again, so its decisions stay where they were.
  const accepted = await db.extractionRun.count({
    where: { versionId, engine: "pdfanchor newer" },
  });
  assert.equal(accepted, 0);
});

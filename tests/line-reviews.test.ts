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
      // Consecutive heading lines are one heading, corrected text included.
      headings: ["MINISTRY OF FINANCE (Department of Revenue)"],
      // Assessment year 2026-27 assesses the income of 2025-26.
      incomeYears: ["2025-26"],
    },
    {
      anchor: "Page 2, passage 1",
      text: "Annexure A\n\nApplies to tax years 2026-27 to 2027-28.",
      page: 2,
      headings: ["MINISTRY OF FINANCE (Department of Revenue)", "Annexure A"],
      incomeYears: ["2026-27", "2027-28"],
    },
  ]);
  // Long pages split between paragraphs, never inside one.
  const long = {
    ...document,
    pages: [
      {
        ...document.pages[0],
        lines: [0, 1, 2].map((n) =>
          line(`p${n}`, "x".repeat(900), { paragraph: n }),
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
  // The queue lists every line that needs a decision in reading order; the one
  // rule-accepted line is the spot check.
  assert.deepEqual(overview.queue, [
    { id: "p1-l1", page: 1, required: true, spotCheck: false, decision: null },
    { id: "p1-l2", page: 1, required: true, spotCheck: true, decision: null },
    { id: "p2-l1", page: 2, required: true, spotCheck: false, decision: null },
  ]);
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
  assert.deepEqual(chunks, [
    { anchor: "Page 1, passage 1", text: "MINISTRY OF FINANCE NOTIFICATION" },
    { anchor: "Page 2, passage 1", text: "Annexure A" },
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

test("lines checked after acceptance need the text accepted again before publishing", async () => {
  await db.reviewerGrant.create({
    data: { userId: reviewer, role: "TAX", grantedBy: reviewer },
  });
  const accepted = await workflow.latestTextCheck(versionId);
  assert.equal(await workflow.linesChangedSince(versionId, accepted), 0);
  // Any line can be checked, not only those the engine asked about, and the
  // text check stays open for it.
  await lines.recordLineDecision(reviewer, versionId, {
    runId,
    lineId: "p1-l2",
    decision: "CORRECTED",
    text: "NOTIFICATION No. 1",
  });
  assert.equal(await workflow.linesChangedSince(versionId, accepted), 1);
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
  await assert.rejects(workflow.recordTaxDecision(reviewer, review), {
    status: 409,
    message: /Accept the text again/,
  });
  const page = await workflow.reviewDocument(reviewer, versionId);
  assert.equal(page.changedSinceAcceptance, 1);

  await workflow.recordTextCheck(reviewer, versionId, "ACCEPTED", "");
  assert.equal(
    await workflow.linesChangedSince(
      versionId,
      await workflow.latestTextCheck(versionId),
    ),
    0,
  );
  const chunks = await db.taxChunk.findMany({
    where: { versionId },
    orderBy: { anchor: "asc" },
    select: { text: true },
  });
  assert.equal(chunks[0].text, "MINISTRY OF FINANCE NOTIFICATION No. 1");

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

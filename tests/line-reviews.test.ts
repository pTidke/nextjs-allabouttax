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

test("passages keep paragraphs whole, tables together, corrections in and Hindi out", () => {
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
          }),
          line("c", "The due date is extended", { paragraph: 1 }),
          line("d", "to 31st October 2026.", { paragraph: 1 }),
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
        lines: [line("g", "Annexure A", { page: 2 })],
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
      text: "MINISTRY OF FINANCE\n\nThe due date is extended to 31st October 2026.\n\nClass | Limit\nIndividual | 1,50,000",
    },
    { anchor: "Page 2, passage 1", text: "Annexure A" },
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
  assert.deepEqual(
    overview.attention.map((l) => l.id),
    ["p1-l1", "p2-l1"],
  );
  assert.deepEqual(
    overview.sample.map((l) => l.id),
    ["p1-l2"],
    "the one rule-accepted line is the spot check",
  );
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
  assert.equal(
    ready?.status === "OK" && ready.attention[0].decision?.text,
    "MINISTRY OF FINANCE",
    "corrections are tidied",
  );
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

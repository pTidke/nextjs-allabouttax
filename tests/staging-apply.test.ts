import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@prisma/client";
import type { StagingData } from "../src/lib/review/staging-apply";

const database = new PGlite();
const db = new PrismaClient({ adapter: new PrismaPGlite(database) });
const bin = fileURLToPath(
  new URL("./fixtures/fake-pdfanchor.mjs", import.meta.url),
);
let apply: typeof import("../src/lib/review/staging-apply");
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
  apply = await import("../src/lib/review/staging-apply");
  runs = await import("../src/lib/review/extraction-runs");
  upload = await import("../src/lib/tax/upload");
  workflow = await import("../src/lib/review/workflow");
});
after(async () => {
  await db.$disconnect();
  await database.close();
});

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const box = { x0: 144, top: 200, x1: 800, bottom: 224 };
// The engine (tests/fixtures/fake-pdfanchor.mjs) reads three lines:
// p1-l1 "nnnnMINISTRY OF FINANCE" (flagged), p1-l2 "NOTIFICATION" (accepted, the
// spot check) and p2-l1 "Annexure A" (flagged).
function stagingFor(sourceHash: string): StagingData {
  const renders = [1, 2].map((page) => ({ page, width: 1190, height: 1684 }));
  const candidate = (id: string, extra: object = {}) => ({
    id,
    sourceHash,
    title: "Notification No. 1/2026",
    officialUrl: "https://www.incometaxindia.gov.in/n1.pdf",
    kind: "native_full_pages",
    state: "AWAITING_EXTRACTION_REVIEW",
    blockingHolds: [],
    reviewHolds: [],
    renders,
    regions: [
      {
        id: "r1",
        page: 1,
        raw: "nnnnMINISTRY OF FINANCE",
        proposed: "MINISTRY OF FINANCE",
        state: "pending",
        box,
      },
      {
        id: "r2",
        page: 1,
        raw: "NOTIFICATION",
        proposed: null,
        state: "pending",
        box,
      },
      {
        id: "r3",
        page: 2,
        raw: "Annexure A",
        proposed: null,
        state: "pending",
        box,
      },
    ],
    ...extra,
  });
  const first = sha("first"),
    repaired = sha("repaired");
  const checks = ["r1", "r2", "r3"].map((regionId) => ({
    regionId,
    state: "checked",
  }));
  return {
    candidates: [
      { id: first, payload: candidate(first), head: sha("rev-1") },
      {
        id: repaired,
        payload: candidate(repaired, {
          repair: { replacesCandidateId: first },
        }),
        head: sha("rev-3"),
      },
      {
        id: sha("elsewhere"),
        payload: candidate(sha("elsewhere"), { sourceHash: sha("other file") }),
        head: null,
      },
    ],
    revisions: [
      {
        id: sha("rev-1"),
        candidate_id: first,
        action: "REQUEST_CHANGES",
        created_at: new Date("2026-11-12T10:00:00Z"),
        payload: {
          action: "REQUEST_CHANGES",
          note: "Header is garbled",
          checks: [],
          issues: [{}],
        },
      },
      {
        id: sha("rev-2"),
        candidate_id: repaired,
        action: "SAVE_DRAFT",
        created_at: new Date("2026-11-13T10:00:00Z"),
        payload: { action: "SAVE_DRAFT", note: "", checks: checks.slice(0, 1) },
      },
      {
        id: sha("rev-3"),
        candidate_id: repaired,
        action: "ACCEPT_EXTRACTION",
        created_at: new Date("2026-11-14T10:00:00Z"),
        payload: { action: "ACCEPT_EXTRACTION", note: "", checks },
      },
    ],
    taxReviews: [
      {
        candidate_id: repaired,
        extraction_revision: sha("rev-3"),
        decision: "ACCEPT",
        created_at: new Date("2026-11-15T01:50:00Z"),
        fields: {
          classification: "Notification",
          appliesTo: "Inbar Holding RSC Limited",
          period: "FY 2026-27",
          notes: "Exemption under section 10(23FE).",
          evidenceIds: ["r1"],
        },
      },
    ],
  };
}

let versionId: string, tax: string;
test("an accepted staging extraction becomes accepted live text, with its history, once", async () => {
  const owner = (
    await db.user.create({ data: { email: "owner@example.test" } })
  ).id;
  tax = (await db.user.create({ data: { email: "ca@example.test" } })).id;
  await db.reviewerGrant.createMany({
    data: [
      { userId: owner, role: "EXTRACTION", grantedBy: owner },
      { userId: tax, role: "TAX", grantedBy: owner },
    ],
  });
  const uploaded = await upload.uploadDocument({
    bytes: Buffer.from("%PDF-1.4\n% notification\n%%EOF"),
    title: "Notification No. 1/2026",
    officialUrl: "https://www.incometaxindia.gov.in/n1.pdf",
  });
  versionId = uploaded.versionId;
  const { originalHash } = await db.taxVersion.findUniqueOrThrow({
    where: { id: versionId },
  });
  const data = stagingFor(originalHash);

  // Before the engine has read it: only the history is kept.
  const early = await apply.carryOver(data, { write: true });
  assert.deepEqual(
    early.map((r) => r.outcome),
    ["written", "no pending live copy of this file"],
    "one document per repair lineage; the other file is not in the library",
  );
  assert.equal(await db.lineReview.count(), 0);
  assert.equal("taxDrafts" in early[0] && early[0].taxDrafts, 1);

  await runs.extractPending({
    bin,
    engine: "pdfanchor test",
    limit: 5,
    budgetMs: 60_000,
  });
  const plan = await apply.carryOver(data, { write: false });
  assert.deepEqual(
    { ...plan[0], version: undefined, engineRun: undefined },
    {
      candidate: data.candidates[1].id.slice(0, 12),
      title: "Notification No. 1/2026",
      lineage: 2,
      head: "ACCEPT_EXTRACTION",
      version: undefined,
      engineRun: undefined,
      // The corrected header, the spot-checked line and the flagged annexure.
      lineDecisions: { CORRECTED: 1, CONFIRMED: 2 },
      stillUndecided: 0,
      unreadable: 0,
      acceptText: true,
      // Filled in by the first run already; a draft is never written twice.
      taxDrafts: 0,
      outcome: "would write",
    },
  );
  assert.equal(await db.lineReview.count(), 0, "plan writes nothing");

  const written = await apply.carryOver(data, { write: true });
  assert.equal(written[0].outcome, "written");
  const page = await workflow.reviewDocument(owner, versionId);
  assert.equal(page.version.textChecks[0].decision, "ACCEPTED");
  assert.equal(
    page.version.textChecks[0].reviewer,
    "Staging review (carried over)",
  );
  assert.match(page.version.textChecks[0].note, /accepted on 2026-11-14/);
  // The chatbot's passages are rebuilt from the reviewed lines, correction included.
  assert.deepEqual(
    page.version.chunks.map((c) => c.text),
    ["MINISTRY OF FINANCE NOTIFICATION", "Annexure A"],
  );
  // The history covers the whole lineage, with notes, and the tax review.
  const history = page.carriedOver[0].history as {
    revisions: { action: string; note: string | null }[];
    taxReviews: unknown[];
  };
  assert.deepEqual(
    history.revisions.map((r) => [r.action, r.note]),
    [
      ["REQUEST_CHANGES", "Header is garbled"],
      ["SAVE_DRAFT", null],
      ["ACCEPT_EXTRACTION", null],
    ],
  );
  assert.equal(history.taxReviews.length, 1);

  // Running it again changes nothing.
  const again = await apply.carryOver(data, { write: true });
  assert.equal(again[0].outcome, "already carried over onto this engine run");
  assert.equal(await db.lineReview.count(), 3);
  assert.equal(await db.extractionReview.count(), 1);
});

test("the staging tax review becomes a draft for the tax reviewer, never a publication", async () => {
  const draft = await db.taxReviewDraft.findUniqueOrThrow({
    where: { versionId_userId: { versionId, userId: tax } },
  });
  const fields = draft.fields as Record<string, string>;
  assert.equal(fields.documentType, "NOTIFICATION");
  assert.equal(fields.period, "FY 2026-27");
  assert.equal(fields.periodMode, "SINGLE_PERIOD");
  assert.equal(fields.applicabilityNote, "Inbar Holding RSC Limited");
  assert.match(fields.note, /accepted, 2026-11-15/);
  assert.match(fields.note, /Exemption under section 10\(23FE\)/);
  const version = await db.taxVersion.findUniqueOrThrow({
    where: { id: versionId },
  });
  assert.equal(version.status, "PENDING", "nothing is published");
});

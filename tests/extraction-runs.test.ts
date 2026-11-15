import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@prisma/client";

const database = new PGlite();
const db = new PrismaClient({ adapter: new PrismaPGlite(database) });
const bin = fileURLToPath(
  new URL("./fixtures/fake-pdfanchor.mjs", import.meta.url),
);
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
  runs = await import("../src/lib/review/extraction-runs");
  upload = await import("../src/lib/tax/upload");
  workflow = await import("../src/lib/review/workflow");
});
after(async () => {
  await db.$disconnect();
  await database.close();
});

// The smallest valid-looking PDF; the stand-in engine never parses it.
const pdf = (marker: string) => Buffer.from(`%PDF-1.4\n% ${marker}\n%%EOF`);

let first: string, second: string, reviewer: string;
test("the engine reads each pending PDF once per engine version", async () => {
  reviewer = (await db.user.create({ data: { email: "r@example.test" } })).id;
  await db.reviewerGrant.create({
    data: { userId: reviewer, role: "EXTRACTION", grantedBy: reviewer },
  });
  first = (
    await upload.uploadDocument({
      bytes: pdf("one"),
      title: "One",
      officialUrl: "https://www.incometax.gov.in/one.pdf",
    })
  ).versionId;
  second = (
    await upload.uploadDocument({
      bytes: pdf("two"),
      title: "Two",
      officialUrl: "https://www.incometax.gov.in/two.pdf",
    })
  ).versionId;
  // Web pages and decided versions are not read.
  const source = await db.taxSource.create({
    data: {
      id: "web",
      name: "web",
      url: "https://www.incometax.gov.in/w",
      kind: "DOCUMENT",
    },
  });
  const page = await db.taxDocument.create({
    data: {
      sourceId: source.id,
      url: "https://www.incometax.gov.in/faq",
      title: "FAQ",
    },
  });
  const html = await db.taxVersion.create({
    data: {
      documentId: page.id,
      hash: "h",
      originalHash: "h",
      original: Buffer.from("<html></html>"),
      contentType: "text/html",
      text: "",
    },
  });
  await db.taxDocument.update({
    where: { id: page.id },
    data: { latestVersionId: html.id },
  });

  const engine = await runs.engineIdentity(bin, "abcdef1234567890");
  assert.equal(engine, "pdfanchor 9.9.9-test@abcdef123456");
  const queued = await runs.versionsToExtract(engine, 10);
  assert.deepEqual(new Set(queued.map((v) => v.id)), new Set([first, second]));

  const result = await runs.extractPending({
    bin,
    engine,
    limit: 10,
    budgetMs: 60_000,
  });
  assert.deepEqual(result, { ok: 2, failed: 0, skippedForTime: 0 });
  assert.deepEqual(
    await runs.versionsToExtract(engine, 10),
    [],
    "not read twice",
  );
  const stored = await db.extractionRun.findFirstOrThrow({
    where: { versionId: first },
  });
  assert.equal(stored.status, "OK");
  assert.equal(stored.policyVersion, "0.1");
  assert.equal((stored.summary as { flagged: number }).flagged, 2);
  // A newer engine reads everything again; older runs stay.
  assert.equal(
    (await runs.versionsToExtract("pdfanchor 10.0.0", 10)).length,
    2,
  );
});

test("a failed or mismatched result is stored as a failure, without document text", async () => {
  const third = (
    await upload.uploadDocument({
      bytes: pdf("three"),
      title: "Three",
      officialUrl: "https://www.incometax.gov.in/three.pdf",
    })
  ).versionId;
  process.env.FAKE_PDFANCHOR = "fail";
  const failed = await runs.extractVersion(third, { bin, engine: "e-fail" });
  assert.equal(failed.status, "FAILED");
  const row = await db.extractionRun.findUniqueOrThrow({
    where: { id: failed.id },
  });
  assert.equal(row.document, null);
  assert.ok(row.error && !row.error.includes("\n"), "one short line");
  process.env.FAKE_PDFANCHOR = "mismatch";
  const mismatched = await runs.extractVersion(third, {
    bin,
    engine: "e-mismatch",
  });
  const other = await db.extractionRun.findUniqueOrThrow({
    where: { id: mismatched.id },
  });
  assert.equal(other.status, "FAILED");
  assert.match(other.error!, /different file/);
  delete process.env.FAKE_PDFANCHOR;
  assert.equal((await runs.runOverview(third))?.status, "FAILED");
});

test("the review page gets the lines that need a look, and boxes page by page", async () => {
  const overview = await runs.runOverview(first);
  assert.equal(overview?.status, "OK");
  if (overview?.status !== "OK") return;
  assert.equal(overview.attentionTotal, 2);
  // Each line comes with every reading of it; only that page is read.
  const flagged = await Promise.all(
    [1, 2].map(async (n) => {
      const found = await runs.pageLines(reviewer, first, n);
      return found.lines
        .filter((line) => line.status !== "accepted")
        .map((line) => [line.page, line.text, line.other[0]?.text ?? null]);
    }),
  );
  assert.deepEqual(flagged.flat(), [
    [1, "nnnnMINISTRY OF FINANCE", "MINISTRY OF FINANCE"],
    [2, "Annexure A", null],
  ]);
  assert.deepEqual(
    overview.pages.map((p) => [p.number, p.kind]),
    [
      [1, "native"],
      [2, "scanned"],
    ],
  );
  const pageOne = await runs.pageLines(reviewer, first, 1);
  assert.deepEqual(
    pageOne.lines.map((line) => [line.id, line.status]),
    [
      ["p1-l1", "flagged"],
      ["p1-l2", "accepted"],
    ],
  );
  assert.equal(pageOne.lines[0].box.x0, 72);
  await assert.rejects(runs.pageLines(reviewer, first, 3), { status: 404 });
  const outsider = (await db.user.create({ data: { email: "x@example.test" } }))
    .id;
  await assert.rejects(runs.pageLines(outsider, first, 1), { status: 403 });
  const page = await workflow.reviewDocument(reviewer, second);
  assert.equal(page.engine?.status, "OK");
});

test("documents the engine refuses are rejected by the validator", () => {
  const sha = "a".repeat(64);
  const good = {
    source: { sha256: sha, pages: 1 },
    pages: [
      {
        number: 1,
        width: 100,
        height: 100,
        lines: [
          {
            id: "l",
            text: "t",
            status: "flagged",
            box: { x0: 1, top: 1, x1: 2, bottom: 2 },
          },
        ],
      },
    ],
  };
  runs.validEngineDocument(good, sha);
  for (const bad of [
    { ...good, source: { sha256: "b".repeat(64) } },
    { ...good, pages: [{ ...good.pages[0], width: 0 }] },
    {
      ...good,
      pages: [
        {
          ...good.pages[0],
          lines: [{ ...good.pages[0].lines[0], status: "maybe" }],
        },
      ],
    },
    {
      ...good,
      pages: [
        {
          ...good.pages[0],
          lines: [{ ...good.pages[0].lines[0], box: { x0: "1" } }],
        },
      ],
    },
    null,
  ])
    assert.throws(() => runs.validEngineDocument(bad, sha));
});

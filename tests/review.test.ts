import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@prisma/client";

const database = new PGlite();
const db = new PrismaClient({ adapter: new PrismaPGlite(database) });
let roles: typeof import("../src/lib/review/roles");
let workflow: typeof import("../src/lib/review/workflow");
let upload: typeof import("../src/lib/tax/upload");
let retrieval: typeof import("../src/lib/tax/retrieval");
let scheduler: typeof import("../src/lib/tax/scheduler");
let ingestion: typeof import("../src/lib/tax/ingestion");
before(async () => {
  for (const name of (await readdir("prisma/migrations")).sort())
    if (!name.endsWith(".toml"))
      await database.exec(
        await readFile(`prisma/migrations/${name}/migration.sql`, "utf8"),
      );
  (globalThis as unknown as { prisma: PrismaClient }).prisma = db;
  roles = await import("../src/lib/review/roles");
  workflow = await import("../src/lib/review/workflow");
  upload = await import("../src/lib/tax/upload");
  retrieval = await import("../src/lib/tax/retrieval");
  scheduler = await import("../src/lib/tax/scheduler");
  ingestion = await import("../src/lib/tax/ingestion");
});
after(async () => {
  await db.$disconnect();
  await database.close();
});

// A one-page PDF with a real text layer; empty text gives a scan-like PDF.
function pdf(text: string) {
  const lines = text.match(/.{1,70}/g) ?? [];
  const stream = `BT /F1 10 Tf 30 700 Td ${lines.map((line) => `(${line}) Tj 0 -14 Td`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let value = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(value));
    value += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(value);
  value += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(value);
}
const BODY =
  "The standard deduction for salaried taxpayers is explained in this circular for the tax year. ".repeat(
    6,
  );

let admin: string, owner: string, ca: string, outsider: string;
test("only an administrator manages reviewers, and admin rights grant no review", async () => {
  admin = (
    await db.user.create({
      data: { email: "admin@example.test", role: "ADMIN" },
    })
  ).id;
  owner = (await db.user.create({ data: { email: "owner@example.test" } })).id;
  ca = (
    await db.user.create({ data: { email: "CA@Example.test", name: "The CA" } })
  ).id;
  outsider = (await db.user.create({ data: { email: "someone@example.test" } }))
    .id;
  assert.deepEqual(await roles.reviewerAccess(admin), {
    userId: admin,
    admin: true,
    extraction: false,
    tax: false,
  });
  await assert.rejects(roles.grantRole(owner, "ca@example.test", "TAX"), {
    status: 403,
  });
  await assert.rejects(roles.grantRole(admin, "nobody@example.test", "TAX"), {
    status: 404,
  });
  await roles.grantRole(admin, "owner@example.test", "EXTRACTION");
  await roles.grantRole(admin, "ca@example.test", "EXTRACTION"); // email match ignores case
  await roles.grantRole(admin, "ca@example.test", "TAX");
  assert.equal((await roles.reviewerAccess(ca)).tax, true);
  assert.equal((await roles.reviewerAccess(owner)).tax, false);
  const team = await roles.reviewTeam();
  assert.deepEqual(
    team.map((p) => [p.email, p.roles.sort()]),
    [
      ["owner@example.test", ["EXTRACTION"]],
      ["CA@Example.test", ["EXTRACTION", "TAX"]],
    ],
  );
  // Revoking takes effect at once and can be undone by granting again.
  await roles.revokeRole(admin, ca, "TAX");
  assert.equal((await roles.reviewerAccess(ca)).tax, false);
  await roles.grantRole(admin, "ca@example.test", "TAX");
  assert.equal((await roles.reviewerAccess(ca)).tax, true);
  await assert.rejects(roles.requireReviewer(outsider), { status: 403 });
  await roles.requireReviewer(admin); // may open the workspace, cannot decide
  await assert.rejects(roles.requireReviewer(admin, "TAX"), { status: 403 });
});

let uploaded: string;
test("an uploaded PDF is stored, extracted and joins the queue", async () => {
  const url =
    "https://www.incometaxindia.gov.in/documents/circular-uploaded.pdf";
  for (const [input, status] of [
    [{ bytes: Buffer.from("hello"), title: "x", officialUrl: url }, 415],
    [
      {
        bytes: pdf(BODY),
        title: "x",
        officialUrl: "https://example.com/a.pdf",
      },
      400,
    ],
    [
      {
        bytes: pdf(BODY),
        title: "x",
        officialUrl: "http://www.incometax.gov.in/a.pdf",
      },
      400,
    ],
    [{ bytes: pdf(BODY), title: " ", officialUrl: url }, 400],
    [
      {
        bytes: Buffer.alloc(upload.MAX_UPLOAD_BYTES + 1, 37),
        title: "x",
        officialUrl: url,
      },
      413,
    ],
  ] as const)
    await assert.rejects(
      upload.uploadDocument({ ...input }),
      { status },
      JSON.stringify(status),
    );
  const result = await upload.uploadDocument({
    bytes: pdf(BODY),
    title: "Uploaded circular",
    officialUrl: url,
    issuedAt: "2026-05-01",
  });
  uploaded = result.versionId;
  assert.equal(result.needsOcr, false);
  assert.ok(result.passages > 0);
  await assert.rejects(
    upload.uploadDocument({
      bytes: pdf(BODY + "x"),
      title: "again",
      officialUrl: url,
    }),
    { status: 409 },
    "one document per official address",
  );
  const scan = await upload.uploadDocument({
    bytes: pdf(""),
    title: "Scanned notice",
    officialUrl: "https://egazette.nic.in/scan.pdf",
  });
  assert.equal(scan.needsOcr, true);
  assert.equal(scan.passages, 0);
  const queue = await workflow.reviewQueue("all", 0);
  assert.equal(queue.counts.uploads, 2);
  assert.equal(queue.counts.ocr, 1);
  assert.equal(queue.counts.text, 1);
  assert.equal(queue.counts.tax, 0);
  assert.deepEqual(
    (await workflow.reviewQueue("ocr", 0)).items.map((i) => i.title),
    ["Scanned notice"],
  );
  // A scan has nothing to accept yet.
  await assert.rejects(
    workflow.recordTextCheck(owner, scan.versionId, "ACCEPTED", ""),
    { status: 409 },
  );
});

test("the worker never re-fetches uploads, and they stay fresh", async () => {
  const before = await db.ingestionJob.count();
  await scheduler.scheduleRefreshes(new Date("2026-11-15T00:00:00Z"));
  const queued = await db.ingestionJob.findMany({ select: { sourceId: true } });
  assert.ok(queued.length > before, "registered sources were scheduled");
  assert.ok(!queued.some((job) => job.sourceId === upload.UPLOAD_SOURCE.id));
  // Even a job for the upload source does nothing and marks nothing failed.
  await ingestion.enqueueRefresh(upload.UPLOAD_SOURCE.id, "manual-test");
  await db.ingestionJob.updateMany({
    where: { sourceId: { not: upload.UPLOAD_SOURCE.id } },
    data: { status: "SUCCEEDED" },
  });
  assert.equal(
    await ingestion.runNextJob(async () => assert.fail("must not fetch")),
    true,
  );
  const source = await db.taxSource.findUniqueOrThrow({
    where: { id: upload.UPLOAD_SOURCE.id },
  });
  assert.equal(source.lastError, null);
});

test("a tax decision needs the tax role and an accepted text check first", async () => {
  const review = {
    versionId: uploaded,
    action: "approve" as const,
    sectionIds: ["full-document"],
    documentType: "CIRCULAR",
    legalStatus: "GUIDANCE",
    period: "TY 2026-27",
    effectiveFrom: "2026-04-01",
    note: "Synthetic reviewed test only.",
  };
  await assert.rejects(workflow.recordTaxDecision(owner, review), {
    status: 403,
  });
  await assert.rejects(
    workflow.recordTaxDecision(ca, review),
    { status: 409 },
    "no text check yet",
  );
  await assert.rejects(
    workflow.recordTextCheck(outsider, uploaded, "ACCEPTED", ""),
    {
      status: 403,
    },
  );
  await assert.rejects(
    workflow.recordTextCheck(owner, uploaded, "NEEDS_CHANGES", " "),
    {
      status: 400,
    },
  );
  await workflow.recordTextCheck(
    owner,
    uploaded,
    "NEEDS_CHANGES",
    "Page 1: a date is wrong.",
  );
  await assert.rejects(workflow.recordTaxDecision(ca, review), { status: 409 });
  assert.equal(
    (await workflow.reviewQueue("text", 0)).items[0].textNote,
    "Page 1: a date is wrong.",
  );
  await workflow.recordTextCheck(ca, uploaded, "ACCEPTED", "");
  assert.equal(
    (await workflow.reviewQueue("tax", 0)).items[0].versionId,
    uploaded,
  );
  // Drafts need the tax role too.
  await assert.rejects(
    workflow.saveTaxDraft(owner, uploaded, { note: "x" }, 0),
    { status: 403 },
  );
  await workflow.saveTaxDraft(ca, uploaded, { note: "draft" }, 0);
  const document = await workflow.reviewDocument(ca, uploaded);
  assert.equal(document.version.textChecks[0].reviewer, "The CA");
  assert.equal(document.version.draft?.revision, 1);
  const release = await workflow.recordTaxDecision(ca, review);
  assert.ok(release.id);
  const stored = await db.taxVersion.findUniqueOrThrow({
    where: { id: uploaded },
  });
  assert.equal(stored.status, "APPROVED");
  assert.equal(stored.reviewedBy, ca);
  // Once decided, the version cannot be decided or checked again.
  await assert.rejects(
    workflow.recordTextCheck(owner, uploaded, "ACCEPTED", ""),
    { status: 409 },
  );
  await assert.rejects(workflow.recordTaxDecision(ca, review), { status: 409 });
});

test("an approved upload is answerable long after it was uploaded", async () => {
  // Make the upload look old: the 48-hour freshness rule must not apply to it.
  await db.taxDocument.updateMany({
    where: { sourceId: upload.UPLOAD_SOURCE.id },
    data: { verifiedAt: new Date("2026-01-01") },
  });
  const { evidence } = await retrieval.retrieveEvidence(
    "standard deduction salaried",
    null,
  );
  assert.ok(evidence.some((e) => e.versionId === uploaded));
  assert.equal(
    evidence.find((e) => e.versionId === uploaded)!.url,
    "https://www.incometaxindia.gov.in/documents/circular-uploaded.pdf",
    "the chatbot cites the official address",
  );
});

test("rejecting does not need a text check", async () => {
  const other = await upload.uploadDocument({
    bytes: pdf("An unrelated draft that should not be published. ".repeat(10)),
    title: "Not tax material",
    officialUrl: "https://www.incometax.gov.in/not-tax.pdf",
  });
  await workflow.recordTaxDecision(ca, {
    versionId: other.versionId,
    action: "reject",
    note: "Not relevant to income tax.",
    period: "",
    effectiveFrom: "",
  });
  assert.equal(
    (await db.taxVersion.findUniqueOrThrow({ where: { id: other.versionId } }))
      .status,
    "REJECTED",
  );
});

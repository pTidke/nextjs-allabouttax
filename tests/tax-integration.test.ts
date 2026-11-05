import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@prisma/client";
import type { fetchOfficial } from "../src/lib/tax/fetch";

const database = new PGlite();
const db = new PrismaClient({ adapter: new PrismaPGlite(database) });
let ingestion: typeof import("../src/lib/tax/ingestion");
let review: typeof import("../src/lib/tax/review");
let retrieval: typeof import("../src/lib/tax/retrieval");
let access: typeof import("../src/lib/chat/access");
before(async () => {
  for (const name of [
    "202609270001_baseline",
    "202609270002_tax_foundation",
    "202609280001_tax_worker",
    "202609290001_tax_applicability",
    "202611040001_review_drafts",
  ])
    await database.exec(
      await readFile(`prisma/migrations/${name}/migration.sql`, "utf8"),
    );
  (globalThis as unknown as { prisma: PrismaClient }).prisma = db;
  ingestion = await import("../src/lib/tax/ingestion");
  review = await import("../src/lib/tax/review");
  retrieval = await import("../src/lib/tax/retrieval");
  access = await import("../src/lib/chat/access");
});
after(async () => {
  await db.$disconnect();
  await database.close();
});
const fixture =
  (text: string): typeof fetchOfficial =>
  async (url) => ({
    bytes: Buffer.from(
      `<html><title>Tax circular fixture</title><article><h1>Tax circular</h1><p>${text.repeat(10)}</p></article></html>`,
    ),
    contentType: "text/html",
    url,
  });

test("full lifecycle: fetch, deduplicate, approve, retrieve, correct, and reject", async () => {
  await ingestion.registerSources();
  await db.taxSource.updateMany({
    where: { kind: "LISTING" },
    data: { enabled: false },
  });
  const source = "income-tax-transition";
  await ingestion.enqueueRefresh(source, "run-1");
  await ingestion.enqueueRefresh(source, "run-1");
  assert.equal(await db.ingestionJob.count(), 1);
  assert.equal(
    await ingestion.runNextJob(
      fixture(
        "The transitional income tax legislation explanation applies to the selected assessment period. ",
      ),
    ),
    true,
  );
  const firstJob = await db.ingestionJob.findFirstOrThrow();
  assert.equal(
    firstJob.status,
    "SUCCEEDED",
    firstJob.error || "Initial ingestion failed",
  );
  const first = await db.taxVersion.findFirstOrThrow();
  assert.equal(first.status, "PENDING");
  assert.equal(
    (await retrieval.retrieveEvidence("income tax legislation", "AY 2026-27"))
      .evidence.length,
    0,
  );
  const release = await review.reviewVersion(
    {
      action: "approve",
      sectionIds: ["full-document"],
      documentType: "GUIDANCE",
      legalStatus: "GUIDANCE",
      versionId: first.id,
      period: "AY 2026-27",
      effectiveFrom: "2025-04-01",
      effectiveTo: "2026-04-01",
      note: "Synthetic reviewed test only.",
    },
    "reviewer",
  );
  const answer = await retrieval.retrieveEvidence(
    "income tax legislation",
    "AY 2026-27",
  );
  assert.equal(answer.releaseId, release.id);
  assert.ok(
    answer.evidence.length > 0,
    "historical period remains retrievable",
  );
  assert.equal(
    (await retrieval.retrieveEvidence("income tax legislation", "TY 2026-27"))
      .evidence.length,
    0,
  );
  await assert.rejects(
    review.reviewVersion(
      {
        action: "approve",
        sectionIds: ["full-document"],
        documentType: "GUIDANCE",
        legalStatus: "GUIDANCE",
        versionId: first.id,
        period: "AY 2026-27",
        effectiveFrom: "2025-04-01",
        note: "Again",
      },
      "reviewer",
    ),
  );
  await ingestion.enqueueRefresh(source, "run-2");
  await ingestion.runNextJob(
    fixture(
      "The transitional income tax legislation explanation applies to the selected assessment period. ",
    ),
  );
  assert.equal(
    await db.taxVersion.count(),
    1,
    "identical bytes do not create a new version",
  );
  await ingestion.enqueueRefresh(source, "run-3");
  await ingestion.runNextJob(
    fixture(
      "Corrected income tax legislation applies with a reviewed exception and different commencement date. ",
    ),
  );
  assert.equal(await db.taxVersion.count(), 2);
  assert.equal(
    (await retrieval.retrieveEvidence("income tax legislation", "AY 2026-27"))
      .evidence.length,
    0,
    "changed source blocks old answer while review is pending",
  );
  const changed = await db.taxVersion.findFirstOrThrow({
    where: { status: "PENDING" },
  });
  await review.reviewVersion(
    {
      action: "reject",
      versionId: changed.id,
      period: "",
      effectiveFrom: "",
      note: "Synthetic correction needs additional review.",
    },
    "reviewer",
  );
  assert.equal(
    (
      await db.knowledgeRelease.findFirstOrThrow({
        orderBy: { sequence: "desc" },
      })
    ).versionIds.length,
    0,
  );
});

test("failed source jobs retry and eventually fail without claiming a successful check", async () => {
  await db.taxSource.create({
    data: {
      id: "failed",
      name: "Failure fixture",
      url: "https://www.incometax.gov.in/failure",
      kind: "DOCUMENT",
    },
  });
  await ingestion.enqueueRefresh("failed", "failed-run");
  const fail: typeof fetchOfficial = async () => {
    throw new Error("HTTP 503 fixture");
  };
  for (let i = 0; i < 3; i++) {
    await db.ingestionJob.updateMany({
      where: { sourceId: "failed" },
      data: { availableAt: new Date(0) },
    });
    await ingestion.runNextJob(fail);
  }
  const job = await db.ingestionJob.findFirstOrThrow({
    where: { sourceId: "failed" },
  });
  assert.equal(job.status, "FAILED");
  assert.equal(job.attempts, 3);
  const source = await db.taxSource.findUniqueOrThrow({
    where: { id: "failed" },
  });
  assert.equal(source.checkedAt, null);
  assert.match(source.lastError!, /503/);
});

test("conversation ownership and atomic quota boundaries are enforced", async () => {
  const alice = await db.user.create({ data: { email: "alice@example.test" } });
  const bob = await db.user.create({ data: { email: "bob@example.test" } });
  const conversation = await db.taxConversation.create({
    data: { userId: alice.id, period: "AY 2026-27" },
  });
  await assert.rejects(
    access.ownedConversation(conversation.id, bob.id, "AY 2026-27"),
    { status: 404 },
  );
  await assert.rejects(
    access.ownedConversation(conversation.id, alice.id, "TY 2026-27"),
    { status: 400 },
  );
  assert.equal(
    (await access.ownedConversation(conversation.id, alice.id, "AY 2026-27"))
      ?.id,
    conversation.id,
  );
  const attempts = await Promise.allSettled(
    Array.from({ length: 15 }, () =>
      access.reserveQuestion(alice.id, "2026-09-27", 10),
    ),
  );
  assert.equal(attempts.filter((x) => x.status === "fulfilled").length, 10);
  assert.equal(
    (
      await db.dailyUsage.findUniqueOrThrow({
        where: { userId_day: { userId: alice.id, day: "2026-09-27" } },
      })
    ).count,
    10,
  );
  await access.reserveQuestion(alice.id, "2026-09-28", 10);
  await db.user.delete({ where: { id: alice.id } });
  assert.equal(
    await db.taxConversation.count({ where: { userId: alice.id } }),
    0,
  );
});

test("freshness and source health block answers, and proposals never become applicable law", async () => {
  await db.taxSource.create({
    data: {
      id: "freshness",
      name: "Freshness fixture",
      url: "https://www.incometax.gov.in/freshness",
      kind: "DOCUMENT",
    },
  });
  await ingestion.enqueueRefresh("freshness", "freshness-1");
  await ingestion.runNextJob(
    fixture(
      "Residential eligibility is explained in this official guidance for the applicable financial year. ",
    ),
  );
  const document = await db.taxDocument.findUniqueOrThrow({
    where: { url: "https://www.incometax.gov.in/freshness" },
  });
  await review.reviewVersion(
    {
      action: "approve",
      sectionIds: ["full-document"],
      documentType: "GUIDANCE",
      legalStatus: "GUIDANCE",
      versionId: document.latestVersionId!,
      period: "FY 2026-27",
      effectiveFrom: "2026-04-01",
      note: "Synthetic reviewed guidance.",
    },
    "reviewer",
  );
  assert.ok(
    (await retrieval.retrieveEvidence("Residential eligibility", "FY 2026-27"))
      .evidence.length,
  );
  await db.taxDocument.update({
    where: { id: document.id },
    data: { verifiedAt: new Date(0) },
  });
  assert.equal(
    (await retrieval.retrieveEvidence("Residential eligibility", "FY 2026-27"))
      .evidence.length,
    0,
  );
  await db.taxDocument.update({
    where: { id: document.id },
    data: { verifiedAt: new Date() },
  });
  await db.taxSource.update({
    where: { id: "freshness" },
    data: { lastError: "Source is offline" },
  });
  assert.equal(
    (await retrieval.retrieveEvidence("Residential eligibility", "FY 2026-27"))
      .evidence.length,
    0,
  );
  await db.taxSource.update({
    where: { id: "freshness" },
    data: { lastError: null },
  });
  await ingestion.enqueueRefresh("freshness", "proposal");
  await ingestion.runNextJob(
    fixture(
      "Proposed residential eligibility changes are under consultation and have not been enacted. ",
    ),
  );
  const proposal = await db.taxVersion.findFirstOrThrow({
    where: { documentId: document.id, status: "PENDING" },
  });
  await review.reviewVersion(
    {
      action: "approve",
      sectionIds: ["full-document"],
      documentType: "RULE",
      legalStatus: "PROPOSED",
      versionId: proposal.id,
      period: "FY 2026-27",
      effectiveFrom: "2026-04-01",
      note: "Reviewed proposal, not in force.",
    },
    "reviewer",
  );
  assert.equal(
    (await retrieval.retrieveEvidence("Residential eligibility", "FY 2026-27"))
      .evidence.length,
    0,
  );
});

test("expired worker leases recover and volatile HTML chrome does not create legal updates", async () => {
  await db.taxSource.create({
    data: {
      id: "lease",
      name: "Lease fixture",
      url: "https://www.incometax.gov.in/lease",
      kind: "DOCUMENT",
    },
  });
  const job = await ingestion.enqueueRefresh("lease", "lease-1");
  await db.ingestionJob.update({
    where: { id: job.id },
    data: {
      status: "RUNNING",
      leaseToken: "lost-worker",
      leaseUntil: new Date(0),
    },
  });
  await ingestion.runNextJob(
    fixture(
      "A taxpayer should establish the relevant income period before considering applicable rules. ",
    ),
  );
  assert.equal(
    (await db.ingestionJob.findUniqueOrThrow({ where: { id: job.id } })).status,
    "SUCCEEDED",
  );
  const document = await db.taxDocument.findUniqueOrThrow({
    where: { url: "https://www.incometax.gov.in/lease" },
  });
  await ingestion.enqueueRefresh("lease", "lease-2");
  const original = fixture(
    "A taxpayer should establish the relevant income period before considering applicable rules. ",
  );
  await ingestion.runNextJob(async (url) => {
    const result = await original(url);
    return {
      ...result,
      bytes: Buffer.from(
        result.bytes
          .toString()
          .replace("<html>", '<html data-token="rotated">'),
      ),
    };
  });
  assert.equal(
    await db.taxVersion.count({ where: { documentId: document.id } }),
    1,
  );
});

test("FAQ approval publishes only selected answers and preserves the full source", async () => {
  const originalText =
    "1. What is the tax year?\nThe selected concept applies from April 2026.\n2. What about old appeals?\nHistorical zebraappeal applies to previous years.";
  const source = await db.taxSource.create({
    data: {
      id: "scoped-faq",
      name: "FAQ scope fixture",
      kind: "DOCUMENT",
      url: "https://www.incometax.gov.in/scoped-faq",
      checkedAt: new Date(),
    },
  });
  const doc = await db.taxDocument.create({
    data: {
      sourceId: source.id,
      url: source.url,
      title: "Mixed-period FAQ",
      verifiedAt: new Date(),
    },
  });
  const version = await db.taxVersion.create({
    data: {
      documentId: doc.id,
      hash: "scope-hash",
      originalHash: "original-hash",
      original: Buffer.from(originalText),
      contentType: "text/html",
      text: originalText,
      chunks: {
        create: { anchor: "HTML text, passage 1", text: originalText },
      },
    },
  });
  await db.taxDocument.update({
    where: { id: doc.id },
    data: { latestVersionId: version.id },
  });
  const input = {
    versionId: version.id,
    action: "approve" as const,
    sectionIds: ["faq-1"],
    period: "TY 2026-27",
    effectiveFrom: "2026-04-01",
    documentType: "GUIDANCE",
    legalStatus: "GUIDANCE",
    note: "Reviewed first FAQ only.",
  };
  await assert.rejects(
    review.reviewVersion({ ...input, sectionIds: ["faq-999"] }, "reviewer"),
    /Selected source section/,
  );
  await assert.rejects(
    review.reviewVersion({ ...input, sectionIds: [] }, "reviewer"),
    /Select the source sections/,
  );
  await assert.rejects(
    review.reviewVersion({ ...input, period: "AY 2026-27" }, "reviewer"),
    /do not overlap/,
  );
  assert.equal(
    await db.taxChunk.count({ where: { versionId: version.id } }),
    1,
  );
  await review.reviewVersion(input, "reviewer");
  const stored = await db.taxVersion.findUniqueOrThrow({
    where: { id: version.id },
    include: { chunks: true },
  });
  assert.equal(stored.text, originalText);
  assert.equal(Buffer.from(stored.original).toString(), originalText);
  assert.equal(stored.chunks.length, 1);
  assert.equal(stored.chunks[0].anchor, "FAQ 1");
  assert.doesNotMatch(stored.chunks[0].text, /zebraappeal/);
  assert.match(stored.reviewNote!, /faq-1/);
  assert.equal(
    (await retrieval.retrieveEvidence("zebraappeal", "TY 2026-27")).evidence
      .length,
    0,
  );
  const retrieved = await retrieval.retrieveEvidence(
    "selected concept",
    "TY 2026-27",
  );
  assert.ok(
    retrieved.evidence.some(
      (e) => e.versionId === version.id && e.anchor === "FAQ 1",
    ),
  );
  assert.equal(
    (await retrieval.retrieveEvidence("selected concept", "AY 2026-27"))
      .evidence.length,
    0,
  );
});

test("listing discovery queues independent downloads and a bad PDF cannot poison a healthy document", async () => {
  await db.taxSource.update({
    where: { id: "cbdt-circulars" },
    data: { enabled: true },
  });
  const url =
    "https://www.incometaxindia.gov.in/documents/d/guest/synthetic-good";
  const bad =
    "https://www.incometaxindia.gov.in/documents/d/guest/synthetic-scanned";
  const discovered = async () => [
    { url, title: "Official circular title", issuedAt: new Date("2026-01-01") },
    { url: bad, title: "Scanned document", issuedAt: new Date("2026-01-02") },
  ];
  const source = "cbdt-circulars";
  const parent = await ingestion.enqueueRefresh(source, "manual:fixture");
  await ingestion.runNextJob(
    fixture(
      "Residential income eligibility guidance for this financial period. ",
    ),
    discovered,
  );
  assert.equal(
    (await db.ingestionJob.findUniqueOrThrow({ where: { id: parent.id } }))
      .status,
    "SUCCEEDED",
  );
  assert.equal(
    await db.ingestionJob.count({
      where: { sourceId: source, documentUrl: { not: null } },
    }),
    2,
  );
  const fetcher: typeof fetchOfficial = async (input) => {
    if (input === bad) throw new Error("Scanned PDF requires OCR.");
    return fixture(
      "Residential income eligibility guidance for this financial period. ",
    )(input);
  };
  await ingestion.runNextJob(fetcher);
  await ingestion.runNextJob(fetcher);
  const document = await db.taxDocument.findUniqueOrThrow({ where: { url } });
  assert.equal(document.title, "Official circular title");
  assert.ok(document.latestVersionId);
  assert.match(
    (await db.taxDocument.findUniqueOrThrow({ where: { url: bad } }))
      .lastError!,
    /OCR/,
  );
  assert.equal(
    (await db.taxSource.findUniqueOrThrow({ where: { id: source } })).lastError,
    null,
  );
  await review.reviewVersion(
    {
      action: "approve",
      versionId: document.latestVersionId!,
      sectionIds: ["full-document"],
      documentType: "CIRCULAR",
      legalStatus: "EFFECTIVE",
      period: "FY 2026-27",
      effectiveFrom: "2026-04-01",
      note: "Synthetic isolated document review.",
    },
    "reviewer",
  );
  assert.ok(
    (
      await retrieval.retrieveEvidence(
        "Residential income eligibility",
        "FY 2026-27",
      )
    ).evidence.some((e) => e.url === url),
  );
  await ingestion.enqueueDocument(
    source,
    { url, title: document.title, issuedAt: document.issuedAt },
    "correction-failure",
  );
  await ingestion.runNextJob(async () => {
    throw new Error("HTTP 503 synthetic correction fetch");
  });
  assert.equal(
    (
      await retrieval.retrieveEvidence(
        "Residential income eligibility",
        "FY 2026-27",
      )
    ).evidence.filter((e) => e.url === url).length,
    0,
  );
  // Keep later tests independent of scheduled retries.
  await db.ingestionJob.updateMany({
    where: { sourceId: source, status: "QUEUED" },
    data: { status: "FAILED" },
  });
});

test("original storage budget prevents new versions without deleting prior evidence", async () => {
  const source = await db.taxSource.create({
    data: {
      id: "budget",
      name: "Budget fixture",
      url: "https://www.incometax.gov.in/budget",
      kind: "DOCUMENT",
    },
  });
  const job = await ingestion.enqueueRefresh(source.id, "budget");
  const previous = process.env.TAX_MAX_ORIGINAL_BYTES;
  process.env.TAX_MAX_ORIGINAL_BYTES = "1";
  try {
    await ingestion.runNextJob(
      fixture(
        "This synthetic tax document exceeds the deliberately minimal test storage budget. ",
      ),
    );
  } finally {
    if (previous === undefined) delete process.env.TAX_MAX_ORIGINAL_BYTES;
    else process.env.TAX_MAX_ORIGINAL_BYTES = previous;
  }
  assert.match(
    (await db.ingestionJob.findUniqueOrThrow({ where: { id: job.id } })).error!,
    /storage budget reached/,
  );
  assert.equal(
    await db.taxVersion.count({ where: { document: { sourceId: source.id } } }),
    0,
  );
  assert.ok(await db.taxVersion.count({ where: { status: "APPROVED" } }));
});

test("daily discovery recovers unfinished documents and weekly refresh includes pending content", async () => {
  const source = "cbdt-notifications";
  await db.taxSource.update({ where: { id: source }, data: { enabled: true } });
  const document = await db.taxDocument.create({
    data: {
      sourceId: source,
      url: "https://www.incometaxindia.gov.in/documents/d/guest/unfinished",
      title: "Unfinished document",
      issuedAt: new Date("2026-01-01"),
    },
  });
  const discover = async () => [
    { url: document.url, title: document.title, issuedAt: document.issuedAt },
  ];
  const fetcher = fixture(
    "Synthetic notification content requiring a tax review before publication. ",
  );
  await ingestion.enqueueRefresh(source, "daily:fixture-one");
  await ingestion.runNextJob(fetcher, discover);
  assert.equal(
    await db.ingestionJob.count({
      where: { sourceId: source, documentUrl: document.url },
    }),
    1,
  );
  await ingestion.runNextJob(fetcher);
  assert.equal(
    await db.taxVersion.count({
      where: { documentId: document.id, status: "PENDING" },
    }),
    1,
  );
  await ingestion.enqueueRefresh(source, "daily:fixture-two");
  await ingestion.runNextJob(fetcher, discover);
  assert.equal(
    await db.ingestionJob.count({
      where: { sourceId: source, documentUrl: document.url },
    }),
    1,
    "unchanged pending originals wait for reconciliation",
  );
  await ingestion.enqueueRefresh(source, "weekly:fixture");
  await ingestion.runNextJob(fetcher, discover);
  assert.equal(
    await db.ingestionJob.count({
      where: { sourceId: source, documentUrl: document.url },
    }),
    2,
  );
  await ingestion.runNextJob(fetcher);
  assert.equal(
    await db.taxVersion.count({ where: { documentId: document.id } }),
    1,
  );
});

test("review pagination exposes all current pending versions without obsolete drafts", async () => {
  const { pendingReviewPage } = await import("../src/lib/tax/review-queue");
  const documents = [];
  for (let i = 0; i < 12; i++) {
    const document = await db.taxDocument.create({
      data: {
        sourceId: "income-tax-transition",
        url: `https://www.incometax.gov.in/page-fixture-${i}`,
        title: `Page fixture ${i}`,
      },
    });
    const version = await db.taxVersion.create({
      data: {
        documentId: document.id,
        hash: "current",
        originalHash: "original",
        original: Buffer.from("synthetic"),
        contentType: "text/html",
        text: "Pending synthetic review",
      },
    });
    await db.taxDocument.update({
      where: { id: document.id },
      data: { latestVersionId: version.id },
    });
    documents.push(version.id);
    await db.taxVersion.create({
      data: {
        documentId: document.id,
        hash: "obsolete",
        originalHash: "original",
        original: Buffer.from("obsolete"),
        contentType: "text/html",
        text: "Obsolete synthetic review",
      },
    });
  }
  const seen = new Set<string>();
  for (let page = 0; page < 10; page++) {
    const result = await pendingReviewPage(page);
    assert.ok(result.versions.length <= 10);
    for (const version of result.versions) {
      assert.equal(version.id, version.document.latestVersionId);
      assert.ok(!seen.has(version.id));
      seen.add(version.id);
    }
    if (!result.hasMore) break;
  }
  for (const id of documents) assert.ok(seen.has(id));
  await assert.rejects(pendingReviewPage(-1), /Invalid review page/);
});

test("manual refresh reuses active work across minute boundaries and throttles recent completed scans", async () => {
  const source = "manual-dedupe";
  await db.taxSource.create({
    data: {
      id: source,
      name: "Manual refresh fixture",
      url: "https://www.incometax.gov.in/manual-dedupe",
      kind: "DOCUMENT",
    },
  });
  const now = new Date();
  const first = await ingestion.requestManualRefresh(source, now);
  assert.equal(first.outcome, "queued");
  const again = await ingestion.requestManualRefresh(
    source,
    new Date(now.getTime() + 61000),
  );
  assert.equal(again.outcome, "active");
  assert.equal(again.job.id, first.job.id);
  await db.ingestionJob.update({
    where: { id: first.job.id },
    data: { status: "SUCCEEDED", finishedAt: now },
  });
  assert.equal(
    (
      await ingestion.requestManualRefresh(
        source,
        new Date(now.getTime() + 120000),
      )
    ).outcome,
    "recent",
  );
  const later = await ingestion.requestManualRefresh(
    source,
    new Date(now.getTime() + 360000),
  );
  assert.equal(later.outcome, "queued");
  assert.notEqual(later.job.id, first.job.id);
  await db.ingestionJob.update({
    where: { id: later.job.id },
    data: { status: "SUCCEEDED", finishedAt: new Date(0) },
  });
  const child = await db.ingestionJob.create({
    data: {
      sourceId: source,
      dedupeKey: "manual-child",
      documentUrl: "https://www.incometax.gov.in/manual-child",
      availableAt: new Date(Date.now() + 600000),
    },
  });
  const reused = await ingestion.requestManualRefresh(
    source,
    new Date(now.getTime() + 420000),
  );
  assert.equal(reused.outcome, "active");
  assert.equal(reused.job.id, child.id);
  assert.equal(await db.ingestionJob.count({ where: { sourceId: source } }), 3);
});

test("multi-period entity reviews preserve continuing obligations beyond the investment cutoff", async () => {
  const source = await db.taxSource.create({
    data: {
      id: "scope-fixture",
      name: "Synthetic scope",
      kind: "DOCUMENT",
      url: "https://www.incometax.gov.in/scope-fixture",
    },
  });
  const document = await db.taxDocument.create({
    data: {
      sourceId: source.id,
      title: "Synthetic pension notification",
      url: source.url,
      verifiedAt: new Date(),
    },
  });
  const text =
    "Example Pension Fund Limited has conditional eligible investments and continuing filing obligations through liquidation.";
  const version = await db.taxVersion.create({
    data: {
      documentId: document.id,
      hash: "scope-v1",
      originalHash: "scope-v1",
      original: Buffer.from(text),
      text,
      contentType: "text/plain",
      chunks: { create: { anchor: "Paragraph 1", text } },
    },
  });
  await db.taxDocument.update({
    where: { id: document.id },
    data: { latestVersionId: version.id },
  });
  const input = {
    versionId: version.id,
    action: "approve" as const,
    sectionIds: ["full-document"],
    documentType: "NOTIFICATION",
    legalStatus: "EFFECTIVE",
    periodMode: "MULTI_PERIOD" as const,
    period: "",
    effectiveFrom: "2026-01-05",
    entityName: "Example Pension Fund Limited",
    investmentFrom: "2026-01-05",
    investmentThrough: "2030-03-31",
    applicabilityNote:
      "Synthetic investment-to-liquidation obligations across periods.",
    note: "Synthetic test, not a legal review.",
  };
  for (const change of [
    { applicabilityNote: " " },
    { period: "TY 2026-27" },
    { investmentFrom: "" },
    { investmentThrough: "2025-12-31" },
    { effectiveFrom: "2026-02-30" },
    { publishedAt: "2026-99-99" },
    { investmentThrough: "2030-02-30" },
    { entityName: "!!!" },
  ])
    assert.throws(() => review.validateReview({ ...input, ...change }));
  await review.reviewVersion(input, "synthetic-reviewer");
  const stored = await db.taxVersion.findUniqueOrThrow({
    where: { id: version.id },
  });
  assert.equal(stored.period, null);
  assert.equal(
    stored.effectiveTo,
    null,
    "investment cutoff does not become rule expiry",
  );
  assert.equal(
    stored.investmentThrough?.toISOString().slice(0, 10),
    "2030-03-31",
  );
  const find = async (q: string, p: string) =>
    (await retrieval.retrieveEvidence(q, p)).evidence.filter(
      (e) => e.versionId === version.id,
    );
  for (const period of [
    "FY 2025-26",
    "AY 2026-27",
    "TY 2026-27",
    "TY 2031-32",
  ]) {
    const evidence = await find(
      "EXAMPLE PENSION FUND LIMITED: filing obligations?",
      period,
    );
    assert.equal(evidence.length, 1, period);
    assert.equal(
      evidence[0].period,
      period,
      "citation uses the selected period",
    );
    assert.equal(evidence[0].entityName, input.entityName);
    assert.equal(evidence[0].applicabilityNote, input.applicabilityNote);
    assert.equal(
      evidence[0].investmentThrough?.toISOString().slice(0, 10),
      "2030-03-31",
    );
  }
  for (const q of [
    "pension filing obligations",
    "Other Pension Fund Limited filing",
    "Example Pension filing",
    "NotExample Pension Fund Limited filing",
    "Example Pension Fund Limitedness filing",
  ])
    assert.equal((await find(q, "TY 2026-27")).length, 0, q);
  assert.equal(
    (await find("Example-Pension Fund Limited filing", "TY 2026-27")).length,
    1,
  );
  assert.equal(
    (await find("Example Pension Fund Limited filing", "FY 2024-25")).length,
    0,
  );
  await db.taxVersion.update({
    where: { id: version.id },
    data: { effectiveTo: new Date("2032-04-01") },
  });
  assert.equal(
    (await find("Example Pension Fund Limited filing", "TY 2032-33")).length,
    0,
    "exclusive real expiry filters future periods",
  );
  await db.taxDocument.update({
    where: { id: document.id },
    data: { verifiedAt: new Date("2020-01-01") },
  });
  assert.equal(
    (await find("Example Pension Fund Limited filing", "TY 2026-27")).length,
    0,
    "multi-period evidence still requires freshness",
  );
});

test("saved review drafts accept incomplete metadata, isolate reviewers and prevent conflicting writes", async () => {
  const { saveReviewDraft } = await import("../src/lib/tax/review-drafts");
  const a = await db.user.create({
    data: { email: "review-draft-a@example.test", role: "ADMIN" },
  });
  const b = await db.user.create({
    data: { email: "review-draft-b@example.test", role: "ADMIN" },
  });
  const source = await db.taxSource.create({
    data: {
      id: "draft-source",
      kind: "DOCUMENT",
      url: "https://www.incometax.gov.in/draft-fixture",
      name: "Draft fixture",
    },
  });
  const document = await db.taxDocument.create({
    data: { sourceId: source.id, url: source.url, title: "Draft fixture" },
  });
  const version = await db.taxVersion.create({
    data: {
      documentId: document.id,
      hash: "draft",
      originalHash: "draft",
      original: Buffer.from("original"),
      contentType: "text/plain",
      text: "Whole synthetic text",
    },
  });
  await db.taxDocument.update({
    where: { id: document.id },
    data: { latestVersionId: version.id },
  });
  const releaseCount = await db.knowledgeRelease.count();
  const first = await saveReviewDraft(
    version.id,
    a.id,
    {
      documentType: "NOTIFICATION",
      effectiveFrom: "",
      sectionIds: ["full-document"],
    },
    0,
  );
  assert.equal(first.revision, 1);
  await saveReviewDraft(
    version.id,
    b.id,
    { note: "Other reviewer's draft" },
    0,
  );
  assert.equal(
    await db.taxReviewDraft.count({ where: { versionId: version.id } }),
    2,
  );
  const concurrent = await Promise.allSettled([
    saveReviewDraft(version.id, a.id, { note: "First tab" }, 1),
    saveReviewDraft(version.id, a.id, { note: "Second tab" }, 1),
  ]);
  assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (await db.taxVersion.findUniqueOrThrow({ where: { id: version.id } }))
      .status,
    "PENDING",
  );
  assert.equal(
    await db.knowledgeRelease.count(),
    releaseCount,
    "drafts never publish",
  );
  await assert.rejects(
    saveReviewDraft(version.id, a.id, { unexpected: "value" }, 2),
    /Invalid draft field/,
  );
  await assert.rejects(
    saveReviewDraft(version.id, a.id, { sectionIds: ["faq-999"] }, 2),
    /unavailable/,
  );
  await db.taxDocument.update({
    where: { id: document.id },
    data: { latestVersionId: "replaced" },
  });
  await assert.rejects(
    saveReviewDraft(version.id, a.id, {}, 2),
    /no longer awaiting/,
  );
});

test("conversation history, complete export and deletion respect ownership and stable pagination", async () => {
  const {
    conversationList,
    conversationHistory,
    exportConversation,
    deleteConversation,
  } = await import("../src/lib/chat/history");
  const a = await db.user.create({
    data: { email: "history-owner@example.test" },
  });
  const b = await db.user.create({
    data: { email: "history-other@example.test" },
  });
  for (let i = 0; i < 27; i++)
    await db.taxConversation.create({
      data: {
        id: `history-${String(i).padStart(2, "0")}`,
        userId: a.id,
        period: "TY 2026-27",
        createdAt: new Date("2026-01-01"),
      },
    });
  const first = await conversationList(a.id);
  const second = await conversationList(a.id, first.nextBefore!);
  assert.equal(first.conversations.length, 25);
  assert.equal(second.conversations.length, 2);
  assert.equal(
    new Set([...first.conversations, ...second.conversations].map((r) => r.id))
      .size,
    27,
    "timestamp ties do not skip history",
  );
  assert.equal((await conversationList(b.id)).conversations.length, 0);
  const id = "history-26";
  await db.taxMessage.createMany({
    data: Array.from({ length: 125 }, (_, i) => ({
      id: `history-message-${String(i).padStart(3, "0")}`,
      conversationId: id,
      role: "user",
      content: `Synthetic question ${i}`,
      citations: [],
      createdAt: new Date("2026-01-01"),
    })),
  });
  await assert.rejects(conversationHistory(id, b.id), /not found/);
  await assert.rejects(exportConversation(id, b.id), /not found/);
  await assert.rejects(deleteConversation(id, b.id), /not found/);
  await assert.rejects(
    conversationList(a.id, "broken"),
    /Invalid history cursor/,
  );
  const history = await conversationHistory(id, a.id);
  assert.equal(history.messages.length, 100);
  assert.equal(history.truncated, true);
  const exported = await new Response(
    await exportConversation(id, a.id),
  ).json();
  assert.equal(
    exported.messages.length,
    125,
    "export includes messages before visible history",
  );
  assert.equal(exported.messages[0].content, "Synthetic question 0");
  assert.equal(exported.messages[124].content, "Synthetic question 124");
  await deleteConversation(id, a.id);
  assert.equal(await db.taxMessage.count({ where: { conversationId: id } }), 0);
  await assert.rejects(conversationHistory(id, a.id), /not found/);
});

test("public coverage exposes only fresh approved released scope and tracks unavailable evidence", async () => {
  const { knowledgeCoverage } = await import("../src/lib/tax/coverage");
  const source = await db.taxSource.create({
    data: {
      id: "coverage-fixture",
      kind: "DOCUMENT",
      url: "https://www.incometax.gov.in/coverage-fixture",
      name: "Coverage fixture",
    },
  });
  const document = await db.taxDocument.create({
    data: {
      sourceId: source.id,
      url: source.url,
      title: "Coverage fixture",
      verifiedAt: new Date(),
    },
  });
  const version = await db.taxVersion.create({
    data: {
      documentId: document.id,
      hash: "coverage",
      originalHash: "coverage",
      original: Buffer.from("original"),
      contentType: "text/plain",
      text: "Synthetic reviewed coverage",
      chunks: {
        create: { anchor: "Paragraph 1", text: "Synthetic reviewed coverage" },
      },
    },
  });
  await db.taxDocument.update({
    where: { id: document.id },
    data: { latestVersionId: version.id },
  });
  assert.equal(
    (await knowledgeCoverage("TY 2034-35")).availableDocuments,
    0,
    "pending documents stay private",
  );
  await review.reviewVersion(
    {
      versionId: version.id,
      action: "approve",
      documentType: "GUIDANCE",
      legalStatus: "GUIDANCE",
      period: "TY 2034-35",
      effectiveFrom: "2034-04-01",
      note: "Synthetic future-period test",
      sectionIds: ["full-document"],
    },
    "synthetic-reviewer",
  );
  const available = await knowledgeCoverage("TY 2034-35");
  assert.equal(available.generalDocuments, 1);
  assert.equal(available.documents[0].url, source.url);
  await db.taxSource.update({
    where: { id: source.id },
    data: { lastError: "Synthetic failure" },
  });
  const unavailable = await knowledgeCoverage("TY 2034-35");
  assert.equal(unavailable.availableDocuments, 0);
  assert.equal(unavailable.unavailableDocuments, 1);
  assert.equal(unavailable.documents.length, 0);
  await db.taxDocument.update({
    where: { id: document.id },
    data: { latestVersionId: "changed" },
  });
  assert.equal(
    (await knowledgeCoverage("TY 2034-35")).unavailableDocuments,
    0,
    "obsolete approvals do not describe current coverage",
  );
});

test("legacy account import preserves canonical users, administrator roles and session ownership", async () => {
  const { importLegacyAuth } =
    await import("../src/lib/operations/auth-import");
  const target = await db.user.create({
    data: { email: "canonical-import@example.test", role: "ADMIN" },
  });
  const sourceUser = {
    ...target,
    id: "legacy-import-user",
    role: "USER" as const,
    createdAt: new Date("2020-01-01"),
  };
  const other = {
    ...sourceUser,
    id: "legacy-import-other",
    email: "other-import@example.test",
  };
  const source = {
    users: [sourceUser, other],
    accounts: [
      {
        userId: sourceUser.id,
        provider: "google",
        providerAccountId: "synthetic-import-provider",
        type: "oauth",
        refresh_token: null,
        access_token: null,
        expires_at: null,
        token_type: null,
        scope: null,
        id_token: null,
        session_state: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    sessions: [
      {
        sessionToken: "synthetic-import-session",
        userId: sourceUser.id,
        expires: new Date("2090-01-01"),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    verificationTokens: [],
  };
  const result = await db.$transaction((tx) => importLegacyAuth(tx, source));
  assert.equal(result.createdUsers, 1);
  assert.equal(result.matchedUsers, 1);
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: target.id } })).role,
    "ADMIN",
  );
  assert.equal(
    (
      await db.session.findUniqueOrThrow({
        where: { sessionToken: "synthetic-import-session" },
      })
    ).userId,
    target.id,
  );
  const again = await db.$transaction((tx) => importLegacyAuth(tx, source));
  assert.equal(again.createdUsers, 0);
  assert.equal(again.createdAccounts, 0);
  assert.equal(again.createdSessions, 0);
  const conflict = {
    ...source,
    users: [other],
    accounts: [{ ...source.accounts[0], userId: other.id }],
    sessions: [],
  };
  await assert.rejects(
    db.$transaction((tx) => importLegacyAuth(tx, conflict)),
    /identity conflict/,
  );
});

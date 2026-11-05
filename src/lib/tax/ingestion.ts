import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import { contentHash, discoverDocuments, extractDocument } from "./documents";
import { fetchOfficial } from "./fetch";
import { discoverCbdt, type DiscoveredDocument } from "./cbdt";
import { sources } from "./registry";

export async function registerSources() {
  for (const source of sources) {
    await prisma.taxSource.upsert({
      where: { id: source.id },
      create: source,
      update: { name: source.name, url: source.url, kind: source.kind },
    });
  }
}
export async function enqueueRefresh(
  sourceId: string,
  bucket: string = randomUUID(),
) {
  const source = await prisma.taxSource.findUnique({ where: { id: sourceId } });
  if (!source?.enabled) throw new Error("Source is unavailable.");
  return prisma.ingestionJob.upsert({
    where: { dedupeKey: `${sourceId}:${bucket}` },
    create: {
      sourceId,
      dedupeKey: `${sourceId}:${bucket}`,
      availableAt: new Date(0),
    },
    update: {},
  });
}

// Manual requests are coalesced across browser tabs and request-minute boundaries.
export async function requestManualRefresh(sourceId: string, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(740127, hashtext(${sourceId}))::text`;
    const source = await tx.taxSource.findUnique({ where: { id: sourceId } });
    if (!source?.enabled) throw new Error("Source is unavailable.");
    const active = await tx.ingestionJob.findFirst({
      where: { sourceId, status: { in: ["QUEUED", "RUNNING"] } },
      orderBy: { createdAt: "desc" },
    });
    if (active) return { job: active, outcome: "active" as const };
    const recent = await tx.ingestionJob.findFirst({
      where: {
        sourceId,
        documentUrl: null,
        status: "SUCCEEDED",
        finishedAt: { gte: new Date(now.getTime() - 5 * 60 * 1000) },
      },
      orderBy: { finishedAt: "desc" },
    });
    if (recent) return { job: recent, outcome: "recent" as const };
    const dedupeKey = `${sourceId}:manual:${Math.floor(now.getTime() / 60000)}`;
    const previous = await tx.ingestionJob.findUnique({ where: { dedupeKey } });
    if (previous) return { job: previous, outcome: "recent" as const };
    const job = await tx.ingestionJob.create({
      data: { sourceId, dedupeKey, availableAt: new Date(0) },
    });
    return { job, outcome: "queued" as const };
  });
}

export async function enqueueDocument(
  sourceId: string,
  document: DiscoveredDocument,
  bucket: string,
) {
  const active = await prisma.ingestionJob.findFirst({
    where: {
      sourceId,
      documentUrl: document.url,
      status: { in: ["QUEUED", "RUNNING"] },
    },
  });
  if (active) return active;
  const dedupeKey = `${sourceId}:document:${contentHash(Buffer.from(document.url))}:${bucket}`;
  await prisma.taxDocument.upsert({
    where: { url: document.url },
    create: { sourceId, ...document },
    update: { title: document.title, issuedAt: document.issuedAt },
  });
  return prisma.ingestionJob.upsert({
    where: { dedupeKey },
    create: {
      sourceId,
      dedupeKey,
      documentUrl: document.url,
      documentTitle: document.title,
      issuedAt: document.issuedAt,
      availableAt: new Date(0),
    },
    update: {},
  });
}

async function ingestDocument(
  sourceId: string,
  url: string,
  fetcher: typeof fetchOfficial,
  job: { id: string; documentTitle: string | null; issuedAt: Date | null },
  leaseToken: string,
) {
  const fetched = await fetcher(url);
  const extracted = await extractDocument(fetched.bytes, fetched.contentType);
  const originalHash = contentHash(fetched.bytes);
  const hash = fetched.contentType.includes("html")
    ? contentHash(Buffer.from(extracted.text))
    : originalHash;
  await prisma.$transaction(
    async (tx) => {
      // Serialize the corpus byte budget, including across different source workers.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(74329018)::text`;
      const owned =
        await tx.$executeRaw`UPDATE "IngestionJob" SET "leaseUntil" = now() + interval '10 minutes'
      WHERE id = ${job.id} AND "leaseToken" = ${leaseToken} AND status = 'RUNNING' AND "leaseUntil" > now()`;
      if (!owned) throw new Error("Worker lease was lost.");
      const document = await tx.taxDocument.upsert({
        where: { url },
        create: {
          sourceId,
          url,
          title: job.documentTitle || extracted.title,
          issuedAt: job.issuedAt,
        },
        update: { title: job.documentTitle || extracted.title },
      });
      const existing = await tx.taxVersion.findUnique({
        where: { documentId_hash: { documentId: document.id, hash } },
      });
      if (!existing) {
        const maxBytes = Number(
          process.env.TAX_MAX_ORIGINAL_BYTES || 134217728,
        );
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
          throw new Error("Invalid TAX_MAX_ORIGINAL_BYTES.");
        const [usage] = await tx.$queryRaw<
          { bytes: bigint }[]
        >`SELECT COALESCE(sum(octet_length(original)), 0)::bigint AS bytes FROM "TaxVersion"`;
        if (Number(usage.bytes) + fetched.bytes.length > maxBytes)
          throw new Error(
            "Original-document storage budget reached. Configure object storage or raise TAX_MAX_ORIGINAL_BYTES after checking database capacity.",
          );
      }
      const version =
        existing ||
        (await tx.taxVersion.create({
          data: {
            documentId: document.id,
            hash,
            originalHash,
            original: fetched.bytes,
            contentType: fetched.contentType,
            text: extracted.text,
            chunks: { create: extracted.chunks },
          },
        }));
      // Identical content preserves review metadata and the selected FAQ chunks.
      await tx.taxDocument.update({
        where: { id: document.id },
        data: {
          latestVersionId: version.id,
          verifiedAt: new Date(),
          lastError: null,
        },
      });
    },
    { timeout: 20000 },
  );
}

export async function runNextJob(
  fetcher: typeof fetchOfficial = fetchOfficial,
  discover: typeof discoverCbdt = discoverCbdt,
) {
  const leaseToken = randomUUID();
  type Job = {
    id: string;
    sourceId: string;
    attempts: number;
    documentUrl: string | null;
    documentTitle: string | null;
    issuedAt: Date | null;
    dedupeKey: string;
  };
  let jobs: Job[];
  try {
    jobs = await prisma.$queryRaw<Job[]>`
    UPDATE "IngestionJob" SET status = 'RUNNING', attempts = attempts + 1,
      "leaseUntil" = now() + interval '10 minutes', "leaseToken" = ${leaseToken}
    WHERE id = (SELECT id FROM "IngestionJob" WHERE
      (status = 'QUEUED' AND "availableAt" <= now() AND NOT EXISTS (SELECT 1 FROM "IngestionJob" active WHERE active."sourceId" = "IngestionJob"."sourceId" AND active.status = 'RUNNING')) OR
      (status = 'RUNNING' AND "leaseUntil" < now())
      ORDER BY "createdAt", id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id, "sourceId", attempts, "documentUrl", "documentTitle", "issuedAt", "dedupeKey"`;
  } catch (error) {
    if (
      error instanceof Error &&
      "meta" in error &&
      (error.meta as { code?: string })?.code === "23505"
    )
      return false;
    throw error;
  }
  const job = jobs[0];
  if (!job) return false;
  try {
    const source = await prisma.taxSource.findUniqueOrThrow({
      where: { id: job.sourceId },
    });
    if (!source.enabled) throw new Error("Source was disabled.");
    let result: string;
    if (job.documentUrl || source.kind === "DOCUMENT") {
      await ingestDocument(
        source.id,
        job.documentUrl || source.url,
        fetcher,
        job,
        leaseToken,
      );
      result = "Document verified; new content awaits tax review.";
    } else {
      const discovered = ["cbdt-circulars", "cbdt-notifications"].includes(
        source.id,
      )
        ? await discover(source.url, fetcher)
        : discoverDocuments(
            (await fetcher(source.url)).bytes.toString("utf8"),
            source.url,
          ).map((url) => ({
            url,
            title: "Official tax document",
            issuedAt: null,
          }));
      const daily = job.dedupeKey.includes(":daily:");
      const known = await prisma.taxDocument.findMany({
        where: { sourceId: source.id },
        include: {
          versions: { where: { status: "APPROVED" }, select: { id: true } },
        },
      });
      const byUrl = new Map(known.map((document) => [document.url, document]));
      const checks = new Map<string, DiscoveredDocument>();
      for (const document of discovered) {
        const previous = byUrl.get(document.url);
        if (
          !daily ||
          !previous ||
          !previous.latestVersionId ||
          previous.lastError ||
          previous.versions.some((v) => v.id === previous.latestVersionId)
        )
          checks.set(document.url, document);
      }
      // Daily: new/failed and approved content. Weekly/manual: every known original.
      for (const document of known) {
        if (
          !daily ||
          document.lastError ||
          document.versions.some((v) => v.id === document.latestVersionId)
        )
          checks.set(document.url, checks.get(document.url) || document);
      }
      for (const document of checks.values()) {
        const owned =
          await prisma.$executeRaw`UPDATE "IngestionJob" SET "leaseUntil" = now() + interval '10 minutes'
          WHERE id = ${job.id} AND "leaseToken" = ${leaseToken} AND status = 'RUNNING' AND "leaseUntil" > now()`;
        if (!owned) throw new Error("Worker lease was lost.");
        await enqueueDocument(source.id, document, job.id);
      }
      result = `${discovered.length} records discovered; ${checks.size} document checks queued.`;
    }
    await prisma.$transaction(async (tx) => {
      const owned = await tx.ingestionJob.updateMany({
        where: { id: job.id, leaseToken },
        data: {
          status: "SUCCEEDED",
          finishedAt: new Date(),
          leaseUntil: null,
          leaseToken: null,
          error: null,
          result,
        },
      });
      if (owned.count && !job.documentUrl)
        await tx.taxSource.update({
          where: { id: source.id },
          data: { checkedAt: new Date(), lastError: null },
        });
    });
  } catch (error) {
    // Do not store raw response bodies, headers, tokens, or credential-bearing URLs.
    const message =
      error instanceof Error
        ? error.message.slice(0, 500)
        : "Source refresh failed.";
    await prisma.$transaction(async (tx) => {
      const owned = await tx.ingestionJob.updateMany({
        where: { id: job.id, leaseToken },
        data: {
          status: job.attempts >= 3 ? "FAILED" : "QUEUED",
          error: message,
          finishedAt: job.attempts >= 3 ? new Date() : null,
          availableAt: new Date(
            Date.now() + Math.min(3600, 60 * 2 ** job.attempts) * 1000,
          ),
          leaseUntil: null,
          leaseToken: null,
        },
      });
      if (owned.count) {
        if (job.documentUrl)
          await tx.taxDocument.updateMany({
            where: { url: job.documentUrl },
            data: { lastError: message },
          });
        else
          await tx.taxSource.update({
            where: { id: job.sourceId },
            data: { lastError: message },
          });
      }
    });
  }
  return true;
}

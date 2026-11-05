import { prisma } from "../db";
import { MAX_FRESHNESS_MS } from "../tax/registry";
export async function knowledgeHealth(now = new Date()) {
  const release = await prisma.knowledgeRelease.findFirst({
    orderBy: { sequence: "desc" },
    select: { id: true, versionIds: true },
  });
  const [worker, queued, running, failures, pending] = await Promise.all([
    prisma.taxWorkerState.findUnique({ where: { id: "ingestion" } }),
    prisma.ingestionJob.count({ where: { status: "QUEUED" } }),
    prisma.ingestionJob.count({ where: { status: "RUNNING" } }),
    prisma.taxDocument.count({ where: { lastError: { not: null } } }),
    prisma.taxDocument.count({
      where: { versions: { some: { status: "PENDING" } } },
    }),
  ]);
  const approved = await prisma.taxVersion.findMany({
    where: {
      id: { in: release?.versionIds ?? [] },
      status: "APPROVED",
      legalStatus: { in: ["EFFECTIVE", "GUIDANCE"] },
    },
    select: {
      id: true,
      document: {
        select: {
          latestVersionId: true,
          verifiedAt: true,
          lastError: true,
          source: { select: { enabled: true, lastError: true } },
        },
      },
    },
  });
  const fresh = approved.filter(
    (v) =>
      v.document.latestVersionId === v.id &&
      v.document.verifiedAt &&
      now.getTime() - v.document.verifiedAt.getTime() <= MAX_FRESHNESS_MS &&
      !v.document.lastError &&
      v.document.source.enabled &&
      !v.document.source.lastError,
  );
  const workerRecent =
    !!worker &&
    now.getTime() - worker.heartbeatAt.getTime() <= 12 * 60 * 60 * 1000;
  return {
    checkedAt: now.toISOString(),
    releaseId: release?.id ?? null,
    approved: approved.length,
    freshApproved: fresh.length,
    pendingDocuments: pending,
    failedDocuments: failures,
    queued,
    running,
    workerRecent,
    workerLastSeen: worker?.heartbeatAt ?? null,
    readyForAnswers: fresh.length > 0,
  };
}

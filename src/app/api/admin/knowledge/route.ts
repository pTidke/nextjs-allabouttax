import { createHash } from "node:crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { errorResponse, HttpError, readJson, sameOrigin } from "@/lib/http";
import {
  enqueueRefresh,
  registerSources,
  requestManualRefresh,
} from "@/lib/tax/ingestion";
import { discoveryStartYear } from "@/lib/tax/cbdt";
import { officialUrl } from "@/lib/tax/registry";

async function admin() {
  const session = await auth();
  if (!session?.user?.id) throw new HttpError(401, "Sign in first.");
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (user?.role !== "ADMIN")
    throw new HttpError(403, "Administrator access is required.");
  return user;
}
export async function GET() {
  try {
    await admin();
    const [
      sources,
      jobs,
      release,
      worker,
      failedDocuments,
      jobCounts,
      nextRetry,
    ] = await Promise.all([
      prisma.taxSource.findMany({ orderBy: { name: "asc" } }),
      prisma.ingestionJob.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.knowledgeRelease.findFirst({ orderBy: { sequence: "desc" } }),
      prisma.taxWorkerState.findUnique({ where: { id: "ingestion" } }),
      prisma.taxDocument.findMany({
        where: { lastError: { not: null } },
        select: { id: true, title: true, url: true, lastError: true },
        take: 30,
      }),
      prisma.ingestionJob.groupBy({
        by: ["status", "sourceId"],
        _count: { _all: true },
      }),
      prisma.ingestionJob.aggregate({
        where: { status: "QUEUED", availableAt: { gt: new Date() } },
        _min: { availableAt: true },
      }),
    ]);
    return Response.json(
      {
        sources: sources.map((source) => ({
          ...source,
          activeJobs: jobCounts
            .filter(
              (row) =>
                row.sourceId === source.id &&
                ["QUEUED", "RUNNING"].includes(row.status),
            )
            .reduce((sum, row) => sum + row._count._all, 0),
        })),
        worker,
        nextRetryAt: nextRetry._min.availableAt,
        failedDocuments,
        jobCounts: jobCounts.reduce<Record<string, number>>((counts, row) => {
          counts[row.status] = (counts[row.status] || 0) + row._count._all;
          return counts;
        }, {}),
        discoveryStartYear: discoveryStartYear(),
        jobs,
        release,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    await admin();
    const input = await readJson(req);
    // Reviews moved to /review, where tax approval needs a checked text first.
    if (["saveDraft", "approve", "reject"].includes(String(input.action)))
      throw new HttpError(
        410,
        "Document review has moved to the Review workspace at /review.",
      );
    if (input.action === "initialize") {
      await registerSources();
      return Response.json({ ok: true });
    }
    if (input.action === "add") {
      let url: string;
      try {
        url = officialUrl(String(input.url)).href;
      } catch {
        throw new HttpError(
          400,
          "Enter a URL on a registered official income-tax host.",
        );
      }
      const id = `manual-${createHash("sha256").update(url).digest("hex").slice(0, 24)}`;
      await prisma.taxSource.upsert({
        where: { url },
        create: {
          id,
          name: "Manually registered official document",
          url,
          kind: "DOCUMENT",
        },
        update: {},
      });
      const source = await prisma.taxSource.findUniqueOrThrow({
        where: { url },
      });
      await enqueueRefresh(source.id);
      return Response.json({ ok: true });
    }
    if (input.action === "refresh") {
      const sources = await prisma.taxSource.findMany({
        where: {
          enabled: true,
          kind: { not: "UPLOAD" },
          ...(typeof input.sourceId === "string" ? { id: input.sourceId } : {}),
        },
      });
      const results = { queued: 0, active: 0, recent: 0 };
      for (const source of sources) {
        const result = await requestManualRefresh(source.id);
        results[result.outcome]++;
      }
      return Response.json(results);
    }
    throw new HttpError(400, "Unknown action.");
  } catch (error) {
    return errorResponse(error);
  }
}

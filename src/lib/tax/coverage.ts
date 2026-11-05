import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { MAX_FRESHNESS_MS, periodRange } from "./registry";

export async function knowledgeCoverage(period: string) {
  const range = periodRange(period);
  const release = await prisma.knowledgeRelease.findFirst({
    orderBy: { sequence: "desc" },
    select: { id: true, versionIds: true },
  });
  type Row = {
    title: string;
    url: string;
    checkedAt: Date | null;
    entityName: string | null;
    available: boolean;
  };
  const documents = !release?.versionIds.length
    ? []
    : await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT d.title, d.url, d."verifiedAt" AS "checkedAt", v."entityName",
      (d."verifiedAt" >= ${new Date(Date.now() - MAX_FRESHNESS_MS)}
       AND d."lastError" IS NULL AND s."lastError" IS NULL) AS available
    FROM "TaxVersion" v JOIN "TaxDocument" d ON d.id = v."documentId"
    JOIN "TaxSource" s ON s.id = d."sourceId"
    WHERE v.id IN (${Prisma.join(release.versionIds)}) AND v.status = 'APPROVED'
      AND v."legalStatus" IN ('EFFECTIVE', 'GUIDANCE') AND v.jurisdiction = 'IN-CENTRAL'
      AND ((v."periodMode" = 'SINGLE_PERIOD' AND v.period = ${period})
        OR (v."periodMode" = 'MULTI_PERIOD' AND v.period IS NULL AND length(trim(v."applicabilityNote")) > 0))
      AND v."effectiveFrom" < ${range.end} AND (v."effectiveTo" IS NULL OR v."effectiveTo" > ${range.start})
      AND d."latestVersionId" = v.id AND s.enabled = true
    ORDER BY d.title, d.id`);
  const available = documents.filter((d) => d.available === true);
  return {
    period,
    scope: "Central income tax",
    checkedAt: new Date().toISOString(),
    releaseId: release?.id ?? null,
    availableDocuments: available.length,
    generalDocuments: available.filter((d) => !d.entityName).length,
    entitySpecificDocuments: available.filter((d) => d.entityName).length,
    unavailableDocuments: documents.length - available.length,
    // Only fresh, published evidence is displayed. Pending documents are private to reviewers.
    documents: available.map(({ title, url, checkedAt, entityName }) => ({
      title,
      url,
      checkedAt,
      entityName,
    })),
  };
}

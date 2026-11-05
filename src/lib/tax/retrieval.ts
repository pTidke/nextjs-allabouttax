import { normalizeEntity } from "./applicability";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { MAX_FRESHNESS_MS, periodRange } from "./registry";

export type Evidence = {
  id: string;
  versionId: string;
  title: string;
  url: string;
  anchor: string;
  text: string;
  checkedAt: Date;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  documentType: string;
  legalStatus: string;
  period: string;
  periodMode: string;
  applicabilityNote: string | null;
  entityName: string | null;
  investmentFrom: Date | null;
  investmentThrough: Date | null;
};
export function searchTerms(question: string) {
  const words = question.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
  const ignored = new Set([
    "the",
    "and",
    "for",
    "what",
    "how",
    "are",
    "can",
    "does",
    "with",
    "from",
    "this",
    "that",
    "which",
    "about",
    "have",
    "please",
    "tell",
  ]);
  return [...new Set(words.filter((w) => !ignored.has(w)))]
    .slice(0, 24)
    .join(" | ");
}
export async function retrieveEvidence(question: string, period: string) {
  const release = await prisma.knowledgeRelease.findFirst({
    orderBy: { sequence: "desc" },
  });
  const query = searchTerms(question);
  if (!release?.versionIds.length || !query)
    return { releaseId: release?.id ?? null, evidence: [] as Evidence[] };
  const periodDates = periodRange(period);
  const freshSince = new Date(Date.now() - MAX_FRESHNESS_MS);
  const evidence = await prisma.$queryRaw<Evidence[]>(Prisma.sql`
    SELECT c.id, v.id AS "versionId", d.title, d.url, c.anchor, c.text,
      d."verifiedAt" AS "checkedAt", v."effectiveFrom", v."effectiveTo", v."documentType", v."legalStatus", ${period}::text AS period,
      v."periodMode", v."applicabilityNote", v."entityName", v."investmentFrom", v."investmentThrough"
    FROM "TaxChunk" c JOIN "TaxVersion" v ON v.id = c."versionId"
    JOIN "TaxDocument" d ON d.id = v."documentId" JOIN "TaxSource" s ON s.id = d."sourceId"
    WHERE v.id IN (${Prisma.join(release.versionIds)}) AND v.status = 'APPROVED' AND v."legalStatus" IN ('EFFECTIVE', 'GUIDANCE')
      AND ((v."periodMode" = 'SINGLE_PERIOD' AND v.period = ${period})
        OR (v."periodMode" = 'MULTI_PERIOD' AND v.period IS NULL AND length(trim(v."applicabilityNote")) > 0))
      AND (v."entityName" IS NULL OR position(
        ' ' || trim(regexp_replace(lower(v."entityName"), '[^a-z0-9]+', ' ', 'g')) || ' '
        in ${` ${normalizeEntity(question)} `}
      ) > 0)
      AND v.jurisdiction = 'IN-CENTRAL' 
      AND v."effectiveFrom" < ${periodDates.end} AND (v."effectiveTo" IS NULL OR v."effectiveTo" > ${periodDates.start})
      AND d."latestVersionId" = v.id AND d."verifiedAt" >= ${freshSince}
      AND d."lastError" IS NULL
      AND s.enabled = true AND s."lastError" IS NULL
      AND to_tsvector('english', c.text) @@ to_tsquery('english', ${query})
    ORDER BY ts_rank_cd(to_tsvector('english', c.text), to_tsquery('english', ${query})) DESC, c.id LIMIT 6`);
  return { releaseId: release.id, evidence };
}

import { normalizeEntity } from "./applicability";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { MAX_FRESHNESS_MS, equivalentPeriods, periodRange } from "./registry";

export type Evidence = {
  id: string;
  versionId: string;
  title: string;
  url: string;
  anchor: string;
  text: string;
  // Where the passage sits: heading path and paragraph ("Annexure A › para 2").
  context: string | null;
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
export function searchTerms(question: string, exclude = "") {
  const skip = new Set(exclude ? exclude.split(" | ") : []);
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
  return [...new Set(words.filter((w) => !ignored.has(w) && !skip.has(w)))]
    .slice(0, 24)
    .join(" | ");
}
// `earlier` holds the previous questions of the same chat, newest first. A short
// follow-up such as "and how long is it?" has no subject of its own, so their
// terms also match, at half the weight of the current question.
//
// `period` null means the user named no tax year: every year is searched, and each
// passage carries the period it applies to so the model can say which year its
// answer is for.
export async function retrieveEvidence(
  question: string,
  period: string | null,
  earlier: string[] = [],
) {
  const release = await prisma.knowledgeRelease.findFirst({
    orderBy: { sequence: "desc" },
  });
  const current = searchTerms(question);
  const context = searchTerms(earlier.join(" "), current);
  if (!release?.versionIds.length || (!current && !context))
    return { releaseId: release?.id ?? null, evidence: [] as Evidence[] };
  // The context line is searched with the text (index TaxChunk_context_search_idx).
  const text = Prisma.sql`to_tsvector('english', coalesce(c."context", '') || ' ' || c.text)`;
  const now = Prisma.sql`to_tsquery('english', ${current})`;
  const before = Prisma.sql`to_tsquery('english', ${context})`;
  const match =
    current && context
      ? Prisma.sql`(${now} || ${before})`
      : current
        ? now
        : before;
  const rank =
    current && context
      ? Prisma.sql`2 * ts_rank_cd(${text}, ${now}) + ts_rank_cd(${text}, ${before})`
      : Prisma.sql`ts_rank_cd(${text}, ${match})`;
  const periodDates = period ? periodRange(period) : null;
  const scope = period
    ? Prisma.sql`((v."periodMode" = 'SINGLE_PERIOD' AND v.period IN (${Prisma.join(equivalentPeriods(period))}))
        OR (v."periodMode" = 'MULTI_PERIOD' AND v.period IS NULL AND length(trim(v."applicabilityNote")) > 0))
      AND v."effectiveFrom" < ${periodDates!.end} AND (v."effectiveTo" IS NULL OR v."effectiveTo" > ${periodDates!.start})`
    : Prisma.sql`((v."periodMode" = 'SINGLE_PERIOD' AND v.period IS NOT NULL)
        OR (v."periodMode" = 'MULTI_PERIOD' AND v.period IS NULL AND length(trim(v."applicabilityNote")) > 0))`;
  const shownPeriod = period
    ? Prisma.sql`${period}::text`
    : Prisma.sql`COALESCE(v.period, 'Across tax years')`;
  const freshSince = new Date(Date.now() - MAX_FRESHNESS_MS);
  const evidence = await prisma.$queryRaw<Evidence[]>(Prisma.sql`
    SELECT c.id, v.id AS "versionId", d.title, d.url, c.anchor, c.text, c."context",
      d."verifiedAt" AS "checkedAt", v."effectiveFrom", v."effectiveTo", v."documentType", v."legalStatus", ${shownPeriod} AS period,
      v."periodMode", v."applicabilityNote", v."entityName", v."investmentFrom", v."investmentThrough"
    FROM "TaxChunk" c JOIN "TaxVersion" v ON v.id = c."versionId"
    JOIN "TaxDocument" d ON d.id = v."documentId" JOIN "TaxSource" s ON s.id = d."sourceId"
    WHERE v.id IN (${Prisma.join(release.versionIds)}) AND v.status = 'APPROVED' AND v."legalStatus" IN ('EFFECTIVE', 'GUIDANCE')
      AND ${scope}
      AND (v."entityName" IS NULL OR position(
        ' ' || trim(regexp_replace(lower(v."entityName"), '[^a-z0-9]+', ' ', 'g')) || ' '
        in ${` ${normalizeEntity(question)} `}
      ) > 0)
      AND v.jurisdiction = 'IN-CENTRAL' 
      AND d."latestVersionId" = v.id
      AND (d."verifiedAt" >= ${freshSince} OR s.kind = 'UPLOAD')
      AND d."lastError" IS NULL
      AND s.enabled = true AND s."lastError" IS NULL
      AND ${text} @@ ${match}
    ORDER BY ${rank} DESC, v."effectiveFrom" DESC, c.id LIMIT 6`);
  return { releaseId: release.id, evidence };
}

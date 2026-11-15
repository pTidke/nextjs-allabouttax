import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../http";
import { reviewSections } from "../tax/review-sections";
import { suggestedReview } from "../tax/review-suggestions";
import { reviewVersion, validateReview, type ReviewInput } from "../tax/review";
import { saveReviewDraft } from "../tax/review-drafts";
import { requireReviewer } from "./roles";
import { applyReviewedLines, lineReviewOverview } from "./line-reviews";

// Two gates before anything reaches the chatbot:
//   1. text check: someone with EXTRACTION access confirms the extracted text
//      matches the original;
//   2. tax review: someone with TAX access records applicability and publishes.
// Tax approval is refused until the latest text check on that version is ACCEPTED.

export type TextDecision = "ACCEPTED" | "NEEDS_CHANGES";

export async function reviewableVersion(versionId: string) {
  const version = await prisma.taxVersion.findUnique({
    where: { id: versionId },
    select: {
      id: true,
      status: true,
      document: { select: { latestVersionId: true } },
      _count: { select: { chunks: true } },
    },
  });
  if (!version || version.document.latestVersionId !== version.id)
    throw new HttpError(
      409,
      "This is not the current version of the document. Reload the queue.",
    );
  if (version.status !== "PENDING")
    throw new HttpError(409, "This version has already been reviewed.");
  return version;
}

export async function latestTextCheck(versionId: string) {
  return prisma.extractionReview.findFirst({
    where: { versionId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

export async function recordTextCheck(
  userId: string,
  versionId: string,
  decision: TextDecision,
  note: string,
) {
  await requireReviewer(userId, "EXTRACTION");
  if (!["ACCEPTED", "NEEDS_CHANGES"].includes(decision))
    throw new HttpError(400, "Choose whether the text matches.");
  const text = typeof note === "string" ? note.trim() : "";
  if (text.length > 4000) throw new HttpError(400, "The note is too long.");
  if (decision === "NEEDS_CHANGES" && !text)
    throw new HttpError(400, "Describe what does not match.");
  const version = await reviewableVersion(versionId);
  if (decision === "NEEDS_CHANGES")
    return prisma.extractionReview.create({
      data: { versionId, reviewerId: userId, decision, note: text },
    });
  return prisma.$transaction(async (tx) => {
    // With an engine run, the reviewed lines become the passages the chatbot
    // uses. Without one, the existing passages are accepted as they are.
    const rebuilt = await applyReviewedLines(tx, versionId);
    if (rebuilt === null && !version._count.chunks)
      throw new HttpError(
        409,
        "There is no extracted text to accept yet. The engine reads new documents every two hours.",
      );
    if (rebuilt !== null) {
      // An uploaded scan was held back as "needs OCR"; its text now exists.
      const document = await tx.taxDocument.findFirstOrThrow({
        where: { latestVersionId: versionId },
        select: { id: true, source: { select: { kind: true } } },
      });
      if (document.source.kind === "UPLOAD")
        await tx.taxDocument.update({
          where: { id: document.id },
          data: { lastError: null },
        });
    }
    return tx.extractionReview.create({
      data: { versionId, reviewerId: userId, decision, note: text },
    });
  });
}

export async function saveTaxDraft(
  userId: string,
  versionId: string,
  draft: unknown,
  revision: number,
) {
  await requireReviewer(userId, "TAX");
  return saveReviewDraft(versionId, userId, draft, revision);
}

export async function recordTaxDecision(userId: string, input: ReviewInput) {
  await requireReviewer(userId, "TAX");
  try {
    validateReview(input);
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  await reviewableVersion(input.versionId);
  if (input.action === "approve") {
    const check = await latestTextCheck(input.versionId);
    if (check?.decision !== "ACCEPTED")
      throw new HttpError(
        409,
        "The extracted text has not been checked yet. A text check must accept it before it can be published.",
      );
  }
  try {
    return await reviewVersion(input, userId);
  } catch (error) {
    if (error instanceof Error && /Selected source section/.test(error.message))
      throw new HttpError(400, error.message);
    if (
      error instanceof Error &&
      /newer version|already been reviewed/.test(error.message)
    )
      throw new HttpError(409, error.message);
    throw error;
  }
}

export const QUEUE_FILTERS = ["all", "text", "tax", "ocr", "uploads"] as const;
export type QueueFilter = (typeof QUEUE_FILTERS)[number];
export type QueueItem = {
  versionId: string;
  title: string;
  url: string;
  sourceKind: string;
  sourceName: string;
  fetchedAt: Date;
  issuedAt: Date | null;
  lastError: string | null;
  chunks: number;
  textDecision: TextDecision | null;
  textNote: string | null;
  hasRun: boolean;
};

// Current pending versions with their review state, newest first, ten a page.
//   text:    waiting for a text check (none yet, or problems reported)
//   tax:     text accepted, waiting for tax review
//   ocr:     no extracted text at all (scanned documents)
//   uploads: added by hand
export async function reviewQueue(filter: QueueFilter, page: number) {
  if (!QUEUE_FILTERS.includes(filter))
    throw new HttpError(400, "Unknown filter.");
  if (!Number.isSafeInteger(page) || page < 0 || page > 10000)
    throw new HttpError(400, "Invalid page.");
  const where = {
    all: Prisma.sql`TRUE`,
    text: Prisma.sql`(chunks > 0 OR "hasRun") AND "textDecision" IS DISTINCT FROM 'ACCEPTED'`,
    tax: Prisma.sql`"textDecision" = 'ACCEPTED'`,
    ocr: Prisma.sql`chunks = 0 AND NOT "hasRun"`,
    uploads: Prisma.sql`"sourceKind" = 'UPLOAD'`,
  }[filter];
  const rows = await prisma.$queryRaw<QueueItem[]>(Prisma.sql`
    SELECT * FROM (
      SELECT v.id AS "versionId", d.title, d.url, s.kind AS "sourceKind",
        s.name AS "sourceName", v."fetchedAt", d."issuedAt", d."lastError",
        (SELECT count(*)::int FROM "TaxChunk" c WHERE c."versionId" = v.id) AS chunks,
        r.decision AS "textDecision", r.note AS "textNote",
        EXISTS (SELECT 1 FROM "ExtractionRun" x WHERE x."versionId" = v.id AND x.status = 'OK') AS "hasRun"
      FROM "TaxVersion" v
      JOIN "TaxDocument" d ON d."latestVersionId" = v.id
      JOIN "TaxSource" s ON s.id = d."sourceId"
      LEFT JOIN LATERAL (
        SELECT e.decision, e.note FROM "ExtractionReview" e
        WHERE e."versionId" = v.id ORDER BY e."createdAt" DESC, e.id DESC LIMIT 1
      ) r ON true
      WHERE v.status = 'PENDING'
    ) q
    WHERE ${where}
    ORDER BY "fetchedAt" DESC, "versionId" DESC
    LIMIT 11 OFFSET ${page * 10}`);
  const counts = await prisma.$queryRaw<
    { text: number; tax: number; ocr: number; uploads: number; all: number }[]
  >(Prisma.sql`
    SELECT count(*)::int AS all,
      count(*) FILTER (WHERE (chunks > 0 OR "hasRun") AND decision IS DISTINCT FROM 'ACCEPTED')::int AS text,
      count(*) FILTER (WHERE decision = 'ACCEPTED')::int AS tax,
      count(*) FILTER (WHERE chunks = 0 AND NOT "hasRun")::int AS ocr,
      count(*) FILTER (WHERE kind = 'UPLOAD')::int AS uploads
    FROM (
      SELECT s.kind,
        (SELECT count(*) FROM "TaxChunk" c WHERE c."versionId" = v.id) AS chunks,
        (SELECT e.decision FROM "ExtractionReview" e WHERE e."versionId" = v.id
          ORDER BY e."createdAt" DESC, e.id DESC LIMIT 1) AS decision,
        EXISTS (SELECT 1 FROM "ExtractionRun" x WHERE x."versionId" = v.id AND x.status = 'OK') AS "hasRun"
      FROM "TaxVersion" v
      JOIN "TaxDocument" d ON d."latestVersionId" = v.id
      JOIN "TaxSource" s ON s.id = d."sourceId"
      WHERE v.status = 'PENDING'
    ) q`);
  return {
    items: rows.slice(0, 10),
    hasMore: rows.length > 10,
    page,
    filter,
    counts: counts[0],
  };
}

// "Page 3, passage 2" sorts after "Page 3, passage 1" and before "Page 10".
function anchorKey(anchor: string) {
  return (anchor.match(/\d+/g) ?? []).map(Number);
}
function byAnchor(a: { anchor: string }, b: { anchor: string }) {
  const x = anchorKey(a.anchor),
    y = anchorKey(b.anchor);
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) - (y[i] ?? -1);
  return a.anchor.localeCompare(b.anchor);
}

export async function reviewDocument(userId: string, versionId: string) {
  const access = await requireReviewer(userId);
  const version = await prisma.taxVersion.findUnique({
    where: { id: versionId },
    select: {
      id: true,
      hash: true,
      text: true,
      status: true,
      contentType: true,
      fetchedAt: true,
      reviewNote: true,
      reviewedAt: true,
      document: {
        select: {
          title: true,
          url: true,
          issuedAt: true,
          lastError: true,
          latestVersionId: true,
          source: { select: { kind: true, name: true } },
        },
      },
      chunks: { select: { id: true, anchor: true, text: true } },
      extractionReviews: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 20,
        select: {
          id: true,
          decision: true,
          note: true,
          createdAt: true,
          reviewerId: true,
        },
      },
    },
  });
  if (!version) throw new HttpError(404, "Document version not found.");
  const [reviewers, engine, draft] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: version.extractionReviews.map((r) => r.reviewerId) } },
      select: { id: true, name: true, email: true },
    }),
    lineReviewOverview(versionId),
    access.tax
      ? prisma.taxReviewDraft.findUnique({
          where: { versionId_userId: { versionId, userId } },
          select: { fields: true, revision: true, updatedAt: true },
        })
      : null,
  ]);
  return {
    access,
    engine,
    version: {
      ...version,
      current: version.document.latestVersionId === version.id,
      isPdf: version.contentType.includes("pdf"),
      chunks: [...version.chunks].sort(byAnchor),
      sections: reviewSections(version.text),
      suggestion: suggestedReview(version.document.url, version.text),
      draft,
      textChecks: version.extractionReviews.map(({ reviewerId, ...check }) => ({
        ...check,
        reviewer:
          reviewers.find((r) => r.id === reviewerId)?.name ??
          reviewers.find((r) => r.id === reviewerId)?.email ??
          "Former reviewer",
      })),
    },
  };
}

// The stored original's size and type, without reading the file itself.
export async function originalInfo(userId: string, versionId: string) {
  await requireReviewer(userId);
  const [found] = await prisma.$queryRaw<
    { size: number; contentType: string }[]
  >`SELECT octet_length(original)::int AS size, "contentType" FROM "TaxVersion" WHERE id = ${versionId}`;
  if (!found) throw new HttpError(404, "Document version not found.");
  return found;
}

// Bytes [start, start + length) of a stored original. Files can be larger than
// a Vercel response may be, so they are served in slices; see the original route.
export async function originalSlice(
  versionId: string,
  start: number,
  length: number,
) {
  const [found] = await prisma.$queryRaw<{ data: Uint8Array }[]>`
    SELECT substring(original FROM ${start + 1}::int FOR ${length}::int) AS data
    FROM "TaxVersion" WHERE id = ${versionId}`;
  if (!found) throw new HttpError(404, "Document version not found.");
  return new Uint8Array(found.data);
}

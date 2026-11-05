import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../http";
import { selectedSections } from "./review-sections";

const names = [
  "documentType",
  "legalStatus",
  "publishedAt",
  "period",
  "periodMode",
  "effectiveFrom",
  "effectiveTo",
  "entityName",
  "investmentFrom",
  "investmentThrough",
  "applicabilityNote",
  "note",
];
export function draftFields(value: unknown): Prisma.InputJsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "Invalid draft.");
  const result: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, field] of Object.entries(value)) {
    if (key === "sectionIds") {
      if (
        !Array.isArray(field) ||
        field.length > 1000 ||
        field.some((id) => typeof id !== "string" || id.length > 100)
      )
        throw new HttpError(400, "Invalid draft sections.");
      result.sectionIds = field;
    } else {
      if (
        !names.includes(key) ||
        typeof field !== "string" ||
        field.length >
          (["note", "applicabilityNote"].includes(key) ? 4000 : 300)
      )
        throw new HttpError(400, "Invalid draft field.");
      result[key] = field;
    }
  }
  return result;
}
export async function saveReviewDraft(
  versionId: string,
  userId: string,
  value: unknown,
  revision: number,
) {
  if (
    typeof versionId !== "string" ||
    !versionId ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  )
    throw new HttpError(400, "Invalid draft version or revision.");
  const fields = draftFields(value);
  return prisma.$transaction(async (tx) => {
    // Same lock as publication: a save cannot race an approval of this version.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(740126)::text`;
    const version = await tx.taxVersion.findUnique({
      where: { id: versionId },
      include: { document: true },
    });
    if (
      !version ||
      version.status !== "PENDING" ||
      version.document.latestVersionId !== version.id
    )
      throw new HttpError(
        409,
        "This version is no longer awaiting review. Reload the review queue.",
      );
    if (Array.isArray(fields.sectionIds) && fields.sectionIds.length) {
      try {
        selectedSections(version.text, fields.sectionIds as string[]);
      } catch {
        throw new HttpError(400, "A selected source section is unavailable.");
      }
    }
    const existing = await tx.taxReviewDraft.findUnique({
      where: { versionId_userId: { versionId, userId } },
    });
    if ((existing?.revision ?? 0) !== revision)
      throw new HttpError(
        409,
        "This draft was saved in another tab. Reload before editing again.",
      );
    return tx.taxReviewDraft.upsert({
      where: { versionId_userId: { versionId, userId } },
      create: { versionId, userId, fields },
      update: { fields, revision: { increment: 1 } },
    });
  });
}

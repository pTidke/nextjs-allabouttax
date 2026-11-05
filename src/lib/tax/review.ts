import { prisma } from "../db";
import { periodRange, validPeriod } from "./registry";
import { normalizeEntity } from "./applicability";
import { selectedSections } from "./review-sections";

export type ReviewInput = {
  versionId: string;
  action: "approve" | "reject";
  period: string;
  periodMode?: "SINGLE_PERIOD" | "MULTI_PERIOD";
  applicabilityNote?: string;
  entityName?: string;
  investmentFrom?: string;
  investmentThrough?: string;
  effectiveFrom: string;
  effectiveTo?: string;
  documentType?: string;
  legalStatus?: string;
  publishedAt?: string;
  note: string;
  sectionIds?: string[];
};
function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function validateReview(input: ReviewInput) {
  if (
    !input.versionId ||
    !["approve", "reject"].includes(input.action) ||
    !input.note?.trim()
  )
    throw new Error("Version, action, and review note are required.");
  if (input.action === "reject") return;
  if (
    !Array.isArray(input.sectionIds) ||
    !input.sectionIds.length ||
    input.sectionIds.length > 1000 ||
    input.sectionIds.some((id) => typeof id !== "string" || id.length > 100)
  )
    throw new Error("Select the source sections you have reviewed.");
  if (
    !["ACT", "RULE", "NOTIFICATION", "CIRCULAR", "GUIDANCE"].includes(
      input.documentType ?? "",
    )
  )
    throw new Error("Select a document type.");
  if (!["EFFECTIVE", "GUIDANCE", "PROPOSED"].includes(input.legalStatus ?? ""))
    throw new Error("Select a legal status.");
  const mode = input.periodMode ?? "SINGLE_PERIOD";
  if (!["SINGLE_PERIOD", "MULTI_PERIOD"].includes(mode))
    throw new Error("Choose one period or across tax periods.");
  for (const key of ["applicabilityNote", "entityName"] as const) {
    if (
      input[key] !== undefined &&
      (typeof input[key] !== "string" ||
        input[key]!.length > (key === "entityName" ? 300 : 4000))
    )
      throw new Error(`Invalid ${key}.`);
  }
  if (input.entityName?.trim() && normalizeEntity(input.entityName).length < 3)
    throw new Error("Enter the full named entity from the source.");
  if (mode === "MULTI_PERIOD" && !input.applicabilityNote?.trim())
    throw new Error(
      "Explain applicability across tax periods, including any continuing obligations.",
    );
  if (mode === "MULTI_PERIOD" && input.period?.trim())
    throw new Error("Across tax periods cannot also specify a single period.");
  if (mode === "SINGLE_PERIOD" && !validPeriod(input.period))
    throw new Error("Select an explicit FY, AY, or TY period.");
  if (input.publishedAt && !validDate(input.publishedAt))
    throw new Error("Invalid publication date.");
  if (!validDate(input.effectiveFrom))
    throw new Error("A valid effective date is required.");
  if (
    input.effectiveTo &&
    (!validDate(input.effectiveTo) || input.effectiveTo <= input.effectiveFrom)
  )
    throw new Error("End date must follow the start date.");
  if (input.investmentFrom || input.investmentThrough) {
    if (
      !validDate(input.investmentFrom) ||
      !validDate(input.investmentThrough) ||
      input.investmentThrough! < input.investmentFrom!
    )
      throw new Error(
        "Enter both investment dates; the inclusive deadline must be on or after the start.",
      );
    if (input.investmentFrom! < input.effectiveFrom)
      throw new Error(
        "The investment window cannot start before this reviewed scope takes effect.",
      );
    if (!input.applicabilityNote?.trim())
      throw new Error(
        "Explain the investment conditions and any obligations continuing after the deadline.",
      );
  }
  if (mode === "SINGLE_PERIOD") {
    const range = periodRange(input.period);
    if (
      new Date(input.effectiveFrom) >= range.end ||
      (input.effectiveTo && new Date(input.effectiveTo) <= range.start)
    )
      throw new Error(
        "Effective dates do not overlap the selected tax period. AY refers to the preceding income year.",
      );
  }
}

export async function reviewVersion(input: ReviewInput, userId: string) {
  validateReview(input);
  return prisma.$transaction(async (tx) => {
    // Serialize publication: every release is a complete immutable manifest.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(740126)::text`;
    const version = await tx.taxVersion.findUniqueOrThrow({
      where: { id: input.versionId },
      include: { document: true },
    });
    if (version.document.latestVersionId !== version.id)
      throw new Error(
        "A newer version exists. Review the latest version instead.",
      );
    if (version.status !== "PENDING")
      throw new Error("This version has already been reviewed.");
    const selected =
      input.action === "approve"
        ? selectedSections(version.text, input.sectionIds!)
        : [];
    if (selected.length && selected[0].id !== "full-document") {
      // The version is still pending: no published answer can reference these
      // chunks. Keep the immutable original/text and index only reviewed FAQs.
      await tx.taxChunk.deleteMany({ where: { versionId: version.id } });
      await tx.taxChunk.createMany({
        data: selected.map((section) => ({
          versionId: version.id,
          anchor: `FAQ ${section.id.slice(4)}`,
          text: section.text,
        })),
      });
    }
    const previous = await tx.knowledgeRelease.findFirst({
      orderBy: { sequence: "desc" },
    });
    const oldVersions = await tx.taxVersion.findMany({
      where: { documentId: version.documentId },
      select: { id: true },
    });
    const oldIds = new Set(oldVersions.map((v) => v.id));
    const versionIds = (previous?.versionIds ?? []).filter(
      (id) => !oldIds.has(id),
    );
    await tx.taxVersion.update({
      where: { id: version.id },
      data: {
        status: input.action === "approve" ? "APPROVED" : "REJECTED",
        reviewedBy: userId,
        reviewedAt: new Date(),
        reviewNote:
          input.note.trim() +
          (selected.length
            ? `\nReviewed scope: ${selected.map((section) => section.id).join(", ")}. Only this selection is published.`
            : ""),
        ...(input.action === "approve"
          ? {
              documentType: input.documentType,
              legalStatus: input.legalStatus,
              publishedAt: input.publishedAt
                ? new Date(input.publishedAt)
                : null,
              period: input.periodMode === "MULTI_PERIOD" ? null : input.period,
              periodMode: input.periodMode ?? "SINGLE_PERIOD",
              applicabilityNote: input.applicabilityNote?.trim() || null,
              entityName: input.entityName?.trim() || null,
              investmentFrom: input.investmentFrom
                ? new Date(input.investmentFrom)
                : null,
              investmentThrough: input.investmentThrough
                ? new Date(input.investmentThrough)
                : null,
              jurisdiction: "IN-CENTRAL",
              effectiveFrom: new Date(input.effectiveFrom),
              effectiveTo: input.effectiveTo
                ? new Date(input.effectiveTo)
                : null,
            }
          : {}),
      },
    });
    await tx.taxReviewDraft.deleteMany({ where: { versionId: version.id } });
    if (input.action === "approve") versionIds.push(version.id);
    return tx.knowledgeRelease.create({
      data: { versionIds, createdBy: userId },
    });
  });
}

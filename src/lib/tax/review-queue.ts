import { prisma } from "../db";

export async function pendingReviewPage(page: number) {
  if (!Number.isSafeInteger(page) || page < 0 || page > 10000)
    throw new Error("Invalid review page.");
  // Filter obsolete versions before pagination so they cannot hide current work.
  const ids = await prisma.$queryRaw<
    { id: string }[]
  >`SELECT v.id FROM "TaxVersion" v
    JOIN "TaxDocument" d ON d."latestVersionId" = v.id
    WHERE v.status = 'PENDING'
    ORDER BY v."fetchedAt" DESC, v.id DESC LIMIT 11 OFFSET ${page * 10}`;
  const versions = await prisma.taxVersion.findMany({
    where: { id: { in: ids.slice(0, 10).map((v) => v.id) } },
    select: {
      id: true,
      hash: true,
      text: true,
      fetchedAt: true,
      document: {
        select: {
          title: true,
          url: true,
          latestVersionId: true,
          issuedAt: true,
        },
      },
    },
    orderBy: [{ fetchedAt: "desc" }, { id: "desc" }],
  });
  return { versions, hasMore: ids.length > 10, page };
}

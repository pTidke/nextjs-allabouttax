import { prisma } from "../db";
import { knowledgeCoverage } from "./coverage";

// The numbers on the home page: official documents collected, by kind, and how
// many of them are checked and ready to answer from. Uploads are private to
// reviewers, so they are not counted.
export async function libraryStats() {
  const rows = await prisma.$queryRaw<{ kind: string; n: number }[]>`
    SELECT CASE WHEN s.id = 'cbdt-notifications' THEN 'notifications'
      WHEN s.id = 'cbdt-circulars' THEN 'circulars' ELSE 'guidance' END AS kind,
      count(*)::int AS n
    FROM "TaxDocument" d JOIN "TaxSource" s ON s.id = d."sourceId"
    WHERE s.kind <> 'UPLOAD'
    GROUP BY 1`;
  const count = (kind: string) => rows.find((r) => r.kind === kind)?.n ?? 0;
  const coverage = await knowledgeCoverage(null);
  return {
    notifications: count("notifications"),
    circulars: count("circulars"),
    guidance: count("guidance"),
    ready: coverage.availableDocuments,
  };
}

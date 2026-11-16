import "./env";
import { prisma } from "../src/lib/db";

// Every document in the library, as a numbered Markdown table, for deciding
// with the tax reviewer which ones are needed. Read-only, run by the manual
// `library-list` workflow. The documents are public official publications, so
// their titles and addresses may appear in the public log; nothing about
// reviewers or users is printed.

const status = (d: {
  versionStatus: string;
  textDecision: string | null;
  chunks: number;
  hasRun: boolean;
}) =>
  d.versionStatus === "APPROVED"
    ? "Published"
    : d.versionStatus === "REJECTED"
      ? "Not published"
      : d.textDecision === "ACCEPTED"
        ? "Words checked, details next"
        : d.textDecision === "NEEDS_CHANGES"
          ? "Sent back"
          : d.chunks || d.hasRun
            ? "Words to check"
            : "Waiting to be read";

const cell = (text: string) =>
  text.replace(/\|/g, "/").replace(/\s+/g, " ").trim();

async function main() {
  const rows = await prisma.$queryRaw<
    {
      title: string;
      url: string;
      source: string;
      issuedAt: Date | null;
      versionStatus: string;
      textDecision: string | null;
      chunks: number;
      hasRun: boolean;
    }[]
  >`
    SELECT d.title, d.url, s.name AS source, d."issuedAt", v.status AS "versionStatus",
      (SELECT e.decision FROM "ExtractionReview" e WHERE e."versionId" = v.id
        ORDER BY e."createdAt" DESC, e.id DESC LIMIT 1) AS "textDecision",
      (SELECT count(*)::int FROM "TaxChunk" c WHERE c."versionId" = v.id) AS chunks,
      EXISTS (SELECT 1 FROM "ExtractionRun" x WHERE x."versionId" = v.id AND x.status = 'OK') AS "hasRun"
    FROM "TaxDocument" d
    JOIN "TaxSource" s ON s.id = d."sourceId"
    JOIN "TaxVersion" v ON v.id = d."latestVersionId"
    ORDER BY s.name, d."issuedAt" DESC NULLS LAST, d.title`;

  const counts = new Map<string, number>();
  for (const row of rows)
    counts.set(status(row), (counts.get(status(row)) ?? 0) + 1);
  console.log(
    `${rows.length} documents: ${[...counts].map(([s, n]) => `${n} ${s.toLowerCase()}`).join(", ")}.\n`,
  );
  console.log("| # | Document | Source | Issued | Status | Link |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  rows.forEach((row, i) =>
    console.log(
      `| ${i + 1} | ${cell(row.title).slice(0, 200)} | ${cell(row.source)} | ${row.issuedAt?.toISOString().slice(0, 10) ?? ""} | ${status(row)} | ${row.url} |`,
    ),
  );
}

main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message.split("\n")[0] : "Failed.",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

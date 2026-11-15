import "./env";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { prisma } from "../src/lib/db";

type Entry = {
  id: string;
  versionId: string;
  title: string;
  url: string;
  sourceId: string;
  sha256: string;
  contentType: string;
  bytes: number;
  reviewStatus: string;
};

async function main() {
  const args = process.argv.slice(2);
  const value = (name: string) => args[args.indexOf(name) + 1];
  const allowed = new Set(["--out", "--export-count"]);
  for (let i = 0; i < args.length; i += 2)
    if (!allowed.has(args[i]) || !args[i + 1])
      throw new Error(
        "Usage: tax:corpus [--out directory] [--export-count 0..15]",
      );
  const count = args.includes("--export-count")
    ? Number(value("--export-count"))
    : 0;
  if (!Number.isInteger(count) || count < 0 || count > 15)
    throw new Error("Export count must be between 0 and 15.");
  const out = resolve(
    args.includes("--out") ? value("--out") : "work/pdf-corpus",
  );
  await mkdir(join(out, "originals"), { recursive: true });
  // Only public knowledge tables are queried; this transaction cannot write.
  const snapshot = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const documents = await tx.$queryRaw<Entry[]>`
      SELECT d.id, v.id AS "versionId", d.title, d.url, d."sourceId",
        v."originalHash" AS sha256, v."contentType",
        octet_length(v.original)::int AS bytes, v.status AS "reviewStatus"
      FROM "TaxDocument" d JOIN "TaxVersion" v ON v.id = d."latestVersionId"
      ORDER BY d.url`;
      const attention = await tx.taxDocument.findMany({
        where: { lastError: { not: null } },
        select: { id: true, title: true, url: true, lastError: true },
        orderBy: { url: "asc" },
      });
      const pdfs = documents.filter((d) => /pdf/i.test(d.contentType));
      // Provisional sampling, not a labelled benchmark: include the known pension
      // notification and cover file-size extremes; visual triage decides classes.
      const ordered = [
        ...pdfs.filter((d) =>
          /notification-1-2026-pdf\/?$/i.test(new URL(d.url).pathname),
        ),
        ...[...pdfs].sort((a, b) => b.bytes - a.bytes),
        ...pdfs,
      ];
      const chosen: Entry[] = [];
      const seen = new Set<string>();
      let exportedBytes = 0;
      for (const d of ordered) {
        if (chosen.length >= count) break;
        if (seen.has(d.sha256) || exportedBytes + d.bytes > 80 * 1024 * 1024)
          continue;
        seen.add(d.sha256);
        const row = await tx.taxVersion.findUniqueOrThrow({
          where: { id: d.versionId },
          select: { original: true },
        });
        const bytes = Buffer.from(row.original);
        if (createHash("sha256").update(bytes).digest("hex") !== d.sha256)
          throw new Error("Stored original checksum mismatch; export stopped.");
        if (!/^[a-f0-9]{64}$/.test(d.sha256))
          throw new Error("Invalid original hash.");
        await writeFile(join(out, "originals", `${d.sha256}.pdf`), bytes, {
          flag: "w",
        });
        exportedBytes += bytes.length;
        chosen.push(d);
      }
      return { documents, attention, chosen, exportedBytes };
    },
    { timeout: 120000 },
  );
  const inventory = {
    schemaVersion: "0.1.0",
    capturedAt: new Date().toISOString(),
    scope:
      "Public official knowledge only; no accounts, chats or approvals modified.",
    documents: snapshot.documents,
    attention: snapshot.attention,
  };
  await writeFile(
    join(out, "inventory.json"),
    JSON.stringify(inventory, null, 2),
  );
  await writeFile(
    join(out, "sources.json"),
    JSON.stringify(
      {
        schemaVersion: "0.1.0",
        labelStatus: "UNLABELLED_PROVISIONAL_SAMPLE",
        documents: snapshot.chosen.map((d) => ({
          ...d,
          path: `originals/${d.sha256}.pdf`,
        })),
      },
      null,
      2,
    ),
  );
  console.log({
    documents: snapshot.documents.length,
    pdfs: snapshot.documents.filter((d) => /pdf/i.test(d.contentType)).length,
    attention: snapshot.attention.length,
    exported: snapshot.chosen.length,
    exportedBytes: snapshot.exportedBytes,
    out,
    readOnly: true,
  });
}
main()
  .catch(() => {
    console.error(
      "Public corpus inventory failed; no credentials or private records printed.",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

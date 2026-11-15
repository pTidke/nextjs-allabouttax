import "./env";
import { Pool } from "pg";
import { prisma } from "../src/lib/db";
import type { EngineDocument } from "../src/lib/review/extraction-runs";
import { requiredLines } from "../src/lib/review/line-reviews";
import {
  compareWithEngine,
  revisionSummary,
  type StagingCandidate,
} from "../src/lib/review/staging-carry-over";

// R3, step 1: a read-only look at the staging review work and how it lines up
// with the live library. Run by .github/workflows/carry-over.yml.
//
// Actions logs on a public repository are public, so this prints only what is
// already public (document titles and official addresses) and counts: no
// document text, no reviewer identities and no notes.

const short = (id: string) => id.slice(0, 12);

async function readStaging(url: string) {
  const pool = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
  });
  pool.on("error", () => console.error("Staging connection interrupted."));
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const candidates = (
      await client.query(
        "SELECT c.id, c.payload, c.created_at, h.revision_id AS head FROM extraction_staging.candidates c LEFT JOIN extraction_staging.heads h ON h.candidate_id = c.id ORDER BY c.created_at",
      )
    ).rows as {
      id: string;
      payload: StagingCandidate;
      created_at: Date;
      head: string | null;
    }[];
    const revisions = (
      await client.query(
        "SELECT id, candidate_id, action, created_at, payload->'command' AS command FROM extraction_staging.revisions ORDER BY created_at, id",
      )
    ).rows as {
      id: string;
      candidate_id: string;
      action: string;
      created_at: Date;
      command: {
        note?: string;
        checks?: { regionId: string; state: string }[];
        issues?: unknown[];
      } | null;
    }[];
    // Tables the web role may not be allowed to read are reported, not fatal.
    const optional = async <T>(sql: string) => {
      await client.query("SAVEPOINT optional");
      try {
        const rows = (await client.query(sql)).rows as T[];
        await client.query("RELEASE SAVEPOINT optional");
        return rows;
      } catch {
        await client.query("ROLLBACK TO SAVEPOINT optional");
        return null;
      }
    };
    const taxReviews = await optional<{
      candidate_id: string;
      extraction_revision: string;
      decision: string;
      created_at: Date;
      fields: Record<string, unknown>;
    }>(
      "SELECT candidate_id, extraction_revision, decision, created_at, fields FROM extraction_staging.tax_reviews ORDER BY id",
    );
    const repairJobs = await optional<{ candidate_id: string; status: string }>(
      "SELECT candidate_id, status FROM extraction_staging.ocr_repair_jobs",
    );
    await client.query("COMMIT");
    return { candidates, revisions, taxReviews, repairJobs };
  } finally {
    client.release();
    await pool.end();
  }
}

async function inspect() {
  const url = process.env.STAGING_DATABASE_URL;
  if (!url) throw new Error("STAGING_DATABASE_URL is not set.");
  const staging = await readStaging(url);
  const replaced = new Set(
    staging.candidates
      .map((c) => c.payload.repair?.replacesCandidateId)
      .filter(Boolean),
  );
  const report = [];
  for (const row of staging.candidates) {
    const c = row.payload;
    const chain = staging.revisions.filter((r) => r.candidate_id === row.id);
    const head = chain.find((r) => r.id === row.head);
    const versions = await prisma.taxVersion.findMany({
      where: { originalHash: c.sourceHash },
      select: {
        id: true,
        status: true,
        document: {
          select: { url: true, title: true, latestVersionId: true },
        },
        extractionReviews: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { decision: true },
        },
        extractionRuns: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { id: true, engine: true, status: true, document: true },
        },
      },
    });
    const byUrl = await prisma.taxDocument.findUnique({
      where: { url: c.officialUrl },
      select: { latestVersionId: true },
    });
    const liveHash = byUrl?.latestVersionId
      ? (
          await prisma.taxVersion.findUnique({
            where: { id: byUrl.latestVersionId },
            select: { originalHash: true },
          })
        )?.originalHash
      : null;
    const live = versions.map((v) => {
      const run = v.extractionRuns[0];
      const document = run?.document as unknown as EngineDocument | null;
      const required =
        run?.status === "OK" && document
          ? requiredLines(run.id, document)
          : null;
      return {
        version: v.id,
        current: v.document.latestVersionId === v.id,
        status: v.status,
        liveTitle: v.document.title,
        sameUrl: v.document.url === c.officialUrl,
        textCheck: v.extractionReviews[0]?.decision ?? null,
        engine: run ? `${run.engine} (${run.status})` : null,
        comparison:
          required && document
            ? compareWithEngine(
                c,
                document,
                new Set(
                  [...required.attention, ...required.sample].map((l) => l.id),
                ),
              )
            : null,
      };
    });
    report.push({
      candidate: short(row.id),
      title: c.title,
      officialUrl: c.officialUrl,
      kind: c.kind,
      state: c.state,
      replacedByRepair: replaced.has(row.id),
      repairOf: c.repair ? short(c.repair.replacesCandidateId) : null,
      regions: c.regions.length,
      tableCells: c.regions.filter((r) => r.tableCell).length,
      pages: [...new Set(c.regions.map((r) => r.page))].sort((a, b) => a - b),
      holds: {
        blocking: c.blockingHolds.length,
        review: c.reviewHolds.length,
      },
      head: head?.action ?? null,
      revisions: chain.map((r) =>
        revisionSummary({
          action: r.action,
          createdAt: new Date(r.created_at),
          checks: r.command?.checks ?? [],
          issues: r.command?.issues?.length ?? 0,
          hasNote: !!r.command?.note?.trim(),
        }),
      ),
      taxReviews:
        staging.taxReviews === null
          ? "not readable with this database role"
          : staging.taxReviews
              .filter((t) => t.candidate_id === row.id)
              .map((t) => ({
                decision: t.decision,
                at: new Date(t.created_at).toISOString().slice(0, 16),
                onHead: t.extraction_revision === row.head,
                filled: Object.entries(t.fields ?? {})
                  .filter(([, v]) =>
                    Array.isArray(v) ? v.length : String(v ?? "").trim(),
                  )
                  .map(([k]) => k),
              })),
      repairJobs:
        staging.repairJobs === null
          ? "not readable with this database role"
          : staging.repairJobs
              .filter((j) => j.candidate_id === row.id)
              .map((j) => j.status),
      live: live.length
        ? live
        : byUrl
          ? `same address in the live library, but a different file (live ${short(liveHash ?? "")}, staging ${short(c.sourceHash)})`
          : "not in the live library",
    });
  }
  console.log(JSON.stringify(report, null, 2));
}

const mode = process.argv[2];
(mode === "inspect"
  ? inspect()
  : Promise.reject(new Error("Usage: staging-carry-over inspect"))
)
  .catch((error) => {
    // Short and free of connection details.
    console.error(
      error instanceof Error ? error.message.split("\n")[0] : "Failed.",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

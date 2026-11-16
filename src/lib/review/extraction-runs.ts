import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../http";
import { requireReviewer } from "./roles";

// The extraction engine (pdfanchor, github.com/pTidke/benzeneblack) reads each
// pending PDF and returns every line with its place on the page, the text the
// reader found, any other reading of the same place, and a rule-based status:
// accepted, flagged or blocked. Runs are stored as they come back and never
// edited; a newer engine version simply adds a newer run.

const run = promisify(execFile);
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

export type EngineBox = { x0: number; top: number; x1: number; bottom: number };
export type EngineFlag = { rule: string; severity: string; message: string };
export type EngineLine = {
  id: string;
  page: number;
  order: number;
  box: EngineBox;
  text: string;
  source: string;
  readings: { source: string; text: string; confidence: number | null }[];
  status: "accepted" | "flagged" | "blocked";
  flags: EngineFlag[];
  excluded: string | null;
  role: string;
  paragraph: number;
  table_id: string | null;
};
export type EnginePage = {
  number: number;
  width: number;
  height: number;
  rotation: number;
  kind: "native" | "scanned" | "blank" | "failed";
  lines: EngineLine[];
  flags: EngineFlag[];
};
export type EngineDocument = {
  schema_version: string;
  source: { sha256: string; pages: number };
  engine: {
    name: string;
    version: string;
    policy_version: string;
    config_sha256: string;
  };
  pages: EnginePage[];
  flags: EngineFlag[];
  summary: Record<string, number>;
};

// Checks the parts the review screens rely on, so a malformed or mismatched
// result is stored as a failure rather than shown.
export function validEngineDocument(
  value: unknown,
  sha256: string,
): EngineDocument {
  const doc = value as EngineDocument;
  if (
    !doc ||
    typeof doc !== "object" ||
    doc.source?.sha256 !== sha256 ||
    !Array.isArray(doc.pages) ||
    !doc.pages.every(
      (page) =>
        Number.isInteger(page.number) &&
        page.width > 0 &&
        page.height > 0 &&
        Array.isArray(page.lines) &&
        page.lines.every(
          (line) =>
            typeof line.id === "string" &&
            typeof line.text === "string" &&
            ["accepted", "flagged", "blocked"].includes(line.status) &&
            [line.box?.x0, line.box?.top, line.box?.x1, line.box?.bottom].every(
              (n) => typeof n === "number" && Number.isFinite(n),
            ),
        ),
    )
  )
    throw new Error(
      "The engine returned a result for a different file or in an unexpected shape.",
    );
  return doc;
}

export async function engineIdentity(bin: string, ref?: string) {
  const { stdout } = await run(bin, ["--version"], { timeout: 30_000 });
  return `pdfanchor ${stdout.trim()}${ref ? `@${ref.slice(0, 12)}` : ""}`;
}

// Current PDF versions awaiting review that this engine has not read yet, and
// whose text nobody has accepted.
export async function versionsToExtract(engine: string, limit: number) {
  return prisma.$queryRaw<{ id: string; originalHash: string }[]>(Prisma.sql`
    SELECT v.id, v."originalHash" FROM "TaxVersion" v
    JOIN "TaxDocument" d ON d."latestVersionId" = v.id
    WHERE v.status = 'PENDING' AND v."contentType" LIKE '%pdf%'
      AND NOT EXISTS (SELECT 1 FROM "ExtractionRun" r WHERE r."versionId" = v.id AND r.engine = ${engine})
      -- Once a person has accepted the text, a newer engine does not reopen it.
      AND COALESCE((SELECT e.decision FROM "ExtractionReview" e WHERE e."versionId" = v.id
        ORDER BY e."createdAt" DESC, e.id DESC LIMIT 1), '') <> 'ACCEPTED'
    ORDER BY v."fetchedAt" DESC, v.id DESC
    LIMIT ${limit}`);
}

// Where the engine finds EasyOCR's model files, the second reader for scanned
// pages; without it the engine reads scans with Tesseract alone.
type EngineOptions = {
  bin: string;
  engine: string;
  timeoutMs?: number;
  easyocrModels?: string;
};

export async function extractVersion(
  versionId: string,
  options: EngineOptions,
) {
  const version = await prisma.taxVersion.findUniqueOrThrow({
    where: { id: versionId },
    select: { original: true, originalHash: true },
  });
  const dir = await mkdtemp(join(tmpdir(), "extract-"));
  try {
    const file = join(dir, "original.pdf");
    await writeFile(file, version.original);
    try {
      await run(
        options.bin,
        [
          "convert",
          file,
          "--out",
          join(dir, "out"),
          "--lang",
          "eng+hin",
          "--exclude-script",
          "Deva",
          ...(options.easyocrModels
            ? ["--easyocr-models", options.easyocrModels]
            : []),
        ],
        // A long scan is read by OCR page by page: about 2 to 5 seconds a page
        // with Tesseract, about 20 with the second reader as well.
        { timeout: options.timeoutMs ?? 15 * 60_000, maxBuffer: 1024 * 1024 },
      );
    } catch (error) {
      // Exit code 2 means "written, but something needs a person": a normal result.
      if ((error as { code?: number }).code !== 2) throw error;
    }
    const raw = await readFile(join(dir, "out", "document.json"));
    if (raw.length > MAX_DOCUMENT_BYTES)
      throw new Error("The engine's result is larger than the 8 MB limit.");
    const document = validEngineDocument(
      JSON.parse(raw.toString("utf8")),
      version.originalHash,
    );
    return prisma.$transaction(async (tx) => {
      const run = await tx.extractionRun.create({
        data: {
          versionId,
          engine: options.engine,
          policyVersion: document.engine.policy_version,
          configSha: document.engine.config_sha256,
          status: "OK",
          summary: document.summary as Prisma.InputJsonValue,
          document: document as unknown as Prisma.InputJsonValue,
        },
        select: { id: true, status: true, summary: true },
      });
      const carried = await carryLineDecisions(tx, versionId, run.id, document);
      return { ...run, carried };
    });
  } catch (error) {
    // Keep the reason short and free of document text.
    const message =
      error instanceof Error
        ? error.message.split("\n")[0].slice(0, 300)
        : "Extraction failed.";
    const run = await prisma.extractionRun.create({
      data: {
        versionId,
        engine: options.engine,
        status: "FAILED",
        error: message,
      },
      select: { id: true, status: true, summary: true },
    });
    return { ...run, carried: 0 };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// A newer engine reads a pending document again, with new line ids. The
// decisions people made on the previous reading carry over to the new one
// wherever a line on the same page reads exactly the same, once on each side:
// nobody has to check those lines twice. A line the new engine reads
// differently comes back for a decision, since its text changed.
const lineKey = (line: { page: number; text: string }) =>
  `${line.page}|${line.text.normalize("NFC").replace(/\s+/g, " ").trim()}`;

async function carryLineDecisions(
  tx: Prisma.TransactionClient,
  versionId: string,
  runId: string,
  document: EngineDocument,
) {
  const previous = await tx.extractionRun.findFirst({
    where: { versionId, status: "OK", id: { not: runId } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, document: true },
  });
  if (!previous?.document) return 0;
  const rows = await tx.lineReview.findMany({
    where: { runId: previous.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!rows.length) return 0;
  const latest = new Map(rows.map((row) => [row.lineId, row]));
  const unique = (lines: EngineLine[]) => {
    const seen = new Map<string, EngineLine | null>();
    for (const line of lines) {
      if (line.excluded || !line.text.trim()) continue;
      const key = lineKey(line);
      seen.set(key, seen.has(key) ? null : line);
    }
    return seen;
  };
  const before = unique(
    (previous.document as unknown as EngineDocument).pages.flatMap(
      (page) => page.lines,
    ),
  );
  const after = unique(document.pages.flatMap((page) => page.lines));
  const carried = [];
  for (const [key, old] of before) {
    const row = old && latest.get(old.id);
    const now = after.get(key);
    if (row && now)
      carried.push({
        versionId,
        runId,
        lineId: now.id,
        decision: row.decision,
        text: row.text,
        reviewerId: row.reviewerId,
      });
  }
  if (carried.length) await tx.lineReview.createMany({ data: carried });
  return carried.length;
}

export async function extractPending(options: {
  bin: string;
  engine: string;
  limit: number;
  budgetMs: number;
  easyocrModels?: string;
  log?: (line: string) => void;
}) {
  const started = Date.now();
  const results = { ok: 0, failed: 0, skippedForTime: 0, decisionsCarried: 0 };
  const versions = await versionsToExtract(options.engine, options.limit);
  for (const [index, version] of versions.entries()) {
    if (Date.now() - started > options.budgetMs) {
      results.skippedForTime = versions.length - index;
      break;
    }
    const stored = await extractVersion(version.id, options);
    results[stored.status === "OK" ? "ok" : "failed"]++;
    const carried = stored.carried;
    results.decisionsCarried += carried;
    options.log?.(
      `${version.id}: ${stored.status}${carried ? `, ${carried} line decisions carried over` : ""}`,
    );
  }
  return results;
}

// ---- Reading runs for the review screens -----------------------------------

export async function latestRun(versionId: string) {
  return prisma.extractionRun.findFirst({
    where: { versionId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

export type LineForReview = Pick<
  EngineLine,
  | "id"
  | "page"
  | "box"
  | "text"
  | "source"
  | "status"
  | "flags"
  | "excluded"
  | "role"
> & {
  other: { source: string; text: string }[];
  // The confidence the line's own reader gave it, when it reports one.
  confidence: number | null;
};

export function forReview(line: EngineLine): LineForReview {
  return {
    id: line.id,
    page: line.page,
    box: line.box,
    text: line.text,
    source: line.source,
    status: line.status,
    flags: line.flags,
    excluded: line.excluded,
    role: line.role,
    other: line.readings
      .filter((reading) => reading.source !== line.source)
      .map(({ source, text }) => ({ source, text })),
    confidence:
      line.readings.find((reading) => reading.source === line.source)
        ?.confidence ?? null,
  };
}

// What the document page needs up front: the run's state and page sizes. The
// lines themselves come page by page from pageLines.
export async function runOverview(versionId: string) {
  return overviewOf(await latestRun(versionId));
}

export function overviewOf(latest: Awaited<ReturnType<typeof latestRun>>) {
  if (!latest) return null;
  if (latest.status !== "OK" || !latest.document)
    return {
      status: "FAILED" as const,
      engine: latest.engine,
      createdAt: latest.createdAt,
      error: latest.error,
    };
  const document = latest.document as unknown as EngineDocument;
  const attentionTotal = document.pages
    .flatMap((page) => page.lines)
    .filter((line) => !line.excluded && line.status !== "accepted").length;
  return {
    status: "OK" as const,
    engine: latest.engine,
    createdAt: latest.createdAt,
    summary: document.summary,
    pages: document.pages.map(
      ({ number, width, height, rotation, kind, flags }) => ({
        number,
        width,
        height,
        rotation,
        kind,
        flags,
      }),
    ),
    documentFlags: document.flags,
    attentionTotal,
  };
}

// One page of the latest run. Only that page is read out of the stored result,
// which for a long scan can be several megabytes.
export async function pageLines(
  userId: string,
  versionId: string,
  page: number,
) {
  await requireReviewer(userId);
  if (!Number.isSafeInteger(page) || page < 1)
    throw new HttpError(400, "Invalid page.");
  const [latest] = await prisma.$queryRaw<
    { id: string; status: string; page: EnginePage | null }[]
  >`
    SELECT id, status, jsonb_path_query_first(document,
      '$.pages[*] ? (@.number == $n)', jsonb_build_object('n', ${page}::int)) AS page
    FROM "ExtractionRun" WHERE "versionId" = ${versionId}
    ORDER BY "createdAt" DESC, id DESC LIMIT 1`;
  if (latest?.status !== "OK")
    throw new HttpError(404, "No engine result for this document yet.");
  if (!latest.page)
    throw new HttpError(404, "That page is not in the engine result.");
  return {
    runId: latest.id,
    page,
    lines: latest.page.lines.map(forReview),
  };
}

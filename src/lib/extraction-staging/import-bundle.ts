// Operator-only. The web process never invokes Python or accepts an import registry.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { lstat, readFile } from "node:fs/promises";
import { readObject } from "./evidence";
import {
  validateCandidate,
  type Candidate,
  type ObjectRef,
  type Region,
} from "./contract";
type MapValue = Record<string, unknown>;
async function json(file: string) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024)
    throw new Error("Invalid operator bundle file.");
  return JSON.parse(await readFile(file, "utf8"));
}
export async function candidateFromBundle(
  bundle: string,
  envelopeName: string,
  python: string,
): Promise<Candidate> {
  if (!/^[A-Za-z0-9_-]+-envelope\.json$/.test(envelopeName))
    throw new Error("Invalid operator envelope name.");
  const registryRoot = path.resolve(bundle, "registry"),
    objectRoot = path.join(registryRoot, "objects");
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const key of ["PATH", "LANG", "LC_ALL", "TMPDIR", "SYSTEMROOT"])
    if (process.env[key]) env[key] = process.env[key];
  env.PYTHONPATH = path.resolve("tools/pdf_pipeline/src");
  const result = spawnSync(
    python,
    [
      "-m",
      "tax_pdf.cli",
      "validate-staging-import",
      "--registry",
      registryRoot,
      path.resolve(bundle, envelopeName),
    ],
    { encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024, env },
  );
  if (result.error || ![0, 2].includes(result.status ?? -1))
    throw new Error(
      "Independent staging validation failed; no import occurred.",
    );
  const receipt = JSON.parse(result.stdout);
  if (
    !["BLOCKED", "AWAITING_EXTRACTION_REVIEW"].includes(receipt.state) ||
    receipt.publication_eligible !== false ||
    receipt.extraction_accepted !== false ||
    receipt.tax_approved !== false ||
    receipt.retrieval_items_created !== 0
  )
    throw new Error("Unexpected validation authority.");
  const envelope = await json(path.resolve(bundle, envelopeName)),
    index = await json(path.join(registryRoot, "registry.json"));
  const source = index.sources[envelope.source_id],
    run = index.runs[envelope.run_id];
  const artifact = JSON.parse(
      (await readObject(objectRoot, envelope.artifact)).toString("utf8"),
    ),
    revision = JSON.parse(
      (await readObject(objectRoot, envelope.revision)).toString("utf8"),
    );
  const refs: ObjectRef[] = [
    envelope.original,
    envelope.artifact,
    envelope.revision,
    ...envelope.renders.map((r: { object: ObjectRef }) => r.object),
    ...envelope.raw_outputs,
    ...run.context_objects,
    ...run.prior_feedback,
  ];
  const evidence = [...new Map(refs.map((r) => [r.object_id, r])).values()];
  const pages = new Map<number, MapValue>(
    artifact.pages.map((p: MapValue) => [p.number, p]),
  );
  let regions: Region[] = [];
  if (revision.kind === "native_full_pages") {
    const blocks = new Map<string, MapValue>();
    for (const p of artifact.pages)
      for (const b of p.blocks) blocks.set(b.id, { ...b, page: p.number });
    regions = revision.text.map((p: MapValue) => {
      const block = blocks.get(p.block_id as string)!;
      return {
        id: p.block_id,
        page: block.page,
        raw: block.raw_text,
        proposed: p.text,
        note: p.note,
        state: "transcribed",
        box: block.bbox,
      };
    });
  } else {
    const repair = revision.reconstruction,
      ref = run.raw_outputs.find(
        (r: ObjectRef) => r.sha256 === repair.binding.raw_sha256,
      );
    const raw = JSON.parse((await readObject(objectRoot, ref)).toString("utf8"))
      .tables[repair.binding.table_index].data.table_cells;
    regions = repair.cells.map(
      (c: {
        id: string;
        row: number;
        column: number;
        row_span: number;
        column_span: number;
        state: string;
        text: string | null;
        note: string;
        source_refs: { cell: number; start: number; end: number }[];
      }) => ({
        id: c.id,
        page: repair.binding.page,
        raw: c.source_refs.length
          ? c.source_refs
              .map((ref) =>
                Array.from(raw[ref.cell].text)
                  .slice(ref.start, ref.end)
                  .join(""),
              )
              .join("")
          : null,
        proposed: c.text,
        note: c.note,
        state: c.state,
        box: {
          x0: repair.x[c.column],
          x1: repair.x[c.column + c.column_span],
          top: repair.y[c.row],
          bottom: repair.y[c.row + c.row_span],
        },
      }),
    );
  }
  return validateCandidate({
    id: receipt.import_key,
    sourceId: source.source_id,
    sourceHash: source.original.sha256,
    runId: run.run_id,
    revisionHash: run.revision.sha256,
    title: artifact.source_title,
    officialUrl: source.official_url,
    scopeNote: revision.scope_note,
    kind: revision.kind,
    state: receipt.state,
    blockingHolds: receipt.blocking_holds,
    reviewHolds: receipt.review_holds,
    regions,
    evidence,
    original: source.original,
    renders: run.renders.map((r: { page: number; object: ObjectRef }) => ({
      page: r.page,
      object: r.object,
      width: pages.get(r.page)!.width as number,
      height: pages.get(r.page)!.height as number,
    })),
  });
}

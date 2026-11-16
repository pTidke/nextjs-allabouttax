import "./env";
import { prisma } from "../src/lib/db";
import {
  engineIdentity,
  extractPending,
} from "../src/lib/review/extraction-runs";

// Runs the extraction engine over pending PDFs that this engine version has not
// read yet. Scheduled in GitHub Actions (.github/workflows/extract.yml); safe to
// re-run, because each version is read once per engine version.
async function main() {
  const bin = process.env.PDFANCHOR_BIN || "pdfanchor";
  const engine = await engineIdentity(bin, process.env.PDFANCHOR_REF);
  const limit = Number(process.env.EXTRACT_MAX || 60);
  const budgetMs = Number(process.env.EXTRACT_BUDGET_MINUTES || 20) * 60_000;
  console.log(
    `Engine: ${engine}. Up to ${limit} documents in ${budgetMs / 60_000} minutes.`,
  );
  const results = await extractPending({
    bin,
    engine,
    limit,
    budgetMs,
    // The second reader's models (EasyOCR), when the workflow installed them.
    easyocrModels: process.env.EASYOCR_MODELS || undefined,
    log: console.log,
  });
  console.log(JSON.stringify(results));
}
main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Extraction run failed.",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

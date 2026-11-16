import "./env";
import { prisma } from "../src/lib/db";
import type { EngineDocument } from "../src/lib/review/extraction-runs";
import {
  lineDecisions,
  progress,
  requiredLines,
} from "../src/lib/review/line-reviews";
import { linesChangedSince } from "../src/lib/review/workflow";

// A read-only look at where review stands, run by .github/workflows/
// review-status.yml. For every pending document someone has started reviewing
// (a line decision or a text check), it prints how many lines are decided and
// whether the text is accepted and current. Actions logs on a public repository
// are public, so it prints titles and counts only: no text, no reviewers.

async function main() {
  const versions = await prisma.taxVersion.findMany({
    where: {
      status: "PENDING",
      OR: [{ lineReviews: { some: {} } }, { extractionReviews: { some: {} } }],
    },
    select: {
      id: true,
      document: { select: { title: true, latestVersionId: true } },
      extractionReviews: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { decision: true, createdAt: true },
      },
      extractionRuns: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { id: true, status: true, document: true },
      },
      _count: { select: { chunks: true } },
    },
  });
  const report = [];
  for (const version of versions) {
    if (version.document.latestVersionId !== version.id) continue;
    const run = version.extractionRuns[0];
    const document =
      run?.status === "OK" ? (run.document as unknown as EngineDocument) : null;
    let lines = null;
    if (document) {
      const required = requiredLines(run.id, document);
      const decisions = await lineDecisions(run.id);
      const checkable = document.pages
        .flatMap((page) => page.lines)
        .filter((line) => !line.excluded && line.text.trim());
      const state = progress(required, decisions);
      lines = {
        checkable: checkable.length,
        decided: checkable.filter((line) => decisions.has(line.id)).length,
        required: state.required,
        requiredUndecided: state.undecided,
        unreadable: [...decisions.values()].filter(
          (d) => d.decision === "UNREADABLE",
        ).length,
        corrected: [...decisions.values()].filter(
          (d) => d.decision === "CORRECTED",
        ).length,
      };
    }
    const check = version.extractionReviews[0];
    report.push({
      version: version.id,
      title: version.document.title.slice(0, 160),
      lines: lines ?? "no engine result",
      textCheck: check?.decision ?? null,
      checkedSinceAcceptance: await linesChangedSince(version.id, check),
      passages: version._count.chunks,
    });
  }
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message.split("\n")[0] : "Failed.",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

import "./env";
import { readFile } from "node:fs/promises";
import { prisma } from "../src/lib/db";
import { retrieveEvidence } from "../src/lib/tax/retrieval";
import { generateAnswer } from "../src/lib/chat/generate";
import { resolvePeriod } from "../src/lib/tax/registry";
import {
  scoreAnswer,
  scoreSearch,
  summary,
  type AnswerResult,
  type EvaluationCase,
  type SearchResult,
} from "../src/lib/tax/evaluation";

// The answer yardstick (lib/tax/evaluation.ts) against the live library, run by
// `npm run tax:evaluate` or the manual `evaluate` workflow.
//   default: search only, free, and what a chunking or search change affects;
//   --live:  also asks the model (Azure settings needed; costs a little).
// Prints case ids, pass or fail, ranks and counts. Answers are printed only
// with --show-answers: the workflow's log is public.

async function main() {
  const live = process.argv.includes("--live");
  const showAnswers = process.argv.includes("--show-answers");
  const cases = JSON.parse(
    await readFile(
      new URL("../evaluations/income-tax.json", import.meta.url),
      "utf8",
    ),
  ) as EvaluationCase[];

  // What is published: the documents of the newest release.
  const release = await prisma.knowledgeRelease.findFirst({
    orderBy: { sequence: "desc" },
    select: { versionIds: true },
  });
  const urls = (
    await prisma.taxVersion.findMany({
      where: { id: { in: release?.versionIds ?? [] }, status: "APPROVED" },
      select: { document: { select: { url: true } } },
    })
  ).map((v) => v.document.url);
  const published = (source: string) => urls.some((u) => u.includes(source));
  console.log(
    `${live ? "Search and answers" : "Search only (add --live for answers)"}; ${cases.length} cases; ${urls.length} published documents.`,
  );

  const searched: SearchResult[] = [];
  const answered: AnswerResult[] = [];
  for (const item of cases) {
    try {
      // The year is resolved the same way the chat does.
      const earlier = [...(item.context ?? [])].reverse();
      const period = resolvePeriod(item.period, item.question, earlier);
      const { evidence } = await retrieveEvidence(
        item.question,
        period,
        earlier,
      );
      const search = scoreSearch(item, evidence, published);
      searched.push(search);
      let answer: AnswerResult | null = null;
      if (live) {
        const result = await generateAnswer({
          question: item.question,
          period,
          history: (item.context ?? []).map((content) => ({
            role: "user" as const,
            content,
          })),
          evidence,
        });
        answer = scoreAnswer(
          item,
          {
            supported: result.answer.supported,
            text: result.answer.answer,
            citedUrls: result.citations.map((c) => c.url),
          },
          published,
        );
        answered.push(answer);
        if (showAnswers) console.log(`  ${item.id}: ${result.answer.answer}`);
      }
      console.log(JSON.stringify({ search, ...(answer ? { answer } : {}) }));
    } catch (e) {
      // Never print provider response objects, keys or database errors.
      const message =
        e instanceof Error && /Azure model configuration/.test(e.message)
          ? "the Azure settings are not available here"
          : "the evaluation request failed";
      searched.push({ id: item.id, status: "fail", found: 0, reason: message });
      console.log(
        JSON.stringify({ id: item.id, status: "fail", reason: message }),
      );
    }
  }
  for (const line of summary(searched, answered)) console.log(line);
  const failed =
    searched.filter((r) => r.status === "fail").length +
    answered.filter((r) => r.status === "fail").length;
  console.log(
    failed
      ? `${failed} failed checks.`
      : "No failed checks. A small set does not establish broad tax accuracy; keep adding reviewed cases.",
  );
  if (failed) process.exitCode = 1;
}

main()
  .catch(() => {
    console.error("Evaluation setup failed.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

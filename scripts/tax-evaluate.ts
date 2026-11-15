import "./env";
import { readFile } from "node:fs/promises";
import { prisma } from "../src/lib/db";
import { retrieveEvidence } from "../src/lib/tax/retrieval";
import { generateAnswer } from "../src/lib/chat/generate";
import { resolvePeriod } from "../src/lib/tax/registry";

async function main() {
  const live = process.argv.includes("--live");
  const cases = JSON.parse(
    await readFile(
      new URL("../evaluations/income-tax.json", import.meta.url),
      "utf8",
    ),
  ) as {
    id: string;
    // Omit to ask without naming a year, as the chat now does.
    period?: string;
    question: string;
    // Earlier questions of the same chat, oldest first, for follow-up cases.
    context?: string[];
    supported: boolean;
    mustMatch?: string;
  }[];
  console.log(
    live
      ? "Live Azure evaluation; public test questions only, no chat records created."
      : "Retrieval preflight only. Use --live for model behaviour checks.",
  );
  let failures = 0;
  for (const item of cases) {
    try {
      // Resolve the year the same way the chat route does.
      const earlier = [...(item.context ?? [])].reverse();
      const period = resolvePeriod(item.period, item.question, earlier);
      const { evidence } = await retrieveEvidence(
        item.question,
        period,
        earlier,
      );
      if (!live) {
        if (item.supported && !evidence.length)
          throw new Error("Missing reviewed evidence");
        console.log(
          `${item.id}: ${evidence.length} passages; ${evidence.length ? "model check required" : "evidence limitation"}`,
        );
        continue;
      }
      const result = await generateAnswer({
        question: item.question,
        period,
        history: (item.context ?? []).map((content) => ({
          role: "user",
          content,
        })),
        evidence,
      });
      const pass =
        result.answer.supported === item.supported &&
        (!item.mustMatch ||
          new RegExp(item.mustMatch, "i").test(result.answer.answer));
      if (!pass) failures++;
      console.log(
        JSON.stringify({
          id: item.id,
          pass,
          supported: result.answer.supported,
          citations: result.citations.length,
          answer: result.answer.answer,
        }),
      );
    } catch (e) {
      failures++;
      // Do not print provider response objects, keys or database errors.
      console.log(
        JSON.stringify({
          id: item.id,
          pass: false,
          error:
            e instanceof Error && e.message === "Missing reviewed evidence"
              ? e.message
              : "Evaluation request failed",
        }),
      );
    }
  }
  console.log(
    `${failures} failed checks. This small suite does not establish broad tax accuracy; expand and tax-review the dataset before launch.`,
  );
  if (failures) process.exitCode = 1;
}
main()
  .catch(() => {
    console.error("Evaluation setup failed.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

import "./env";
import { prisma } from "../src/lib/db";
import { knowledgeHealth } from "../src/lib/operations/health";
knowledgeHealth()
  .then((report) => {
    console.log(JSON.stringify(report, null, 2));
    if (
      !report.readyForAnswers ||
      !report.workerRecent ||
      report.failedDocuments
    )
      process.exitCode = 1;
  })
  .catch(() => {
    console.error(
      "Knowledge health check failed. Check database connectivity and migrations.",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

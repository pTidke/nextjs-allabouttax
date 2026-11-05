import "./env";
import { setTimeout as delay } from "node:timers/promises";
import { prisma } from "../src/lib/db";
import {
  enqueueRefresh,
  registerSources,
  runNextJob,
} from "../src/lib/tax/ingestion";
import { scheduleRefreshes, workerHeartbeat } from "../src/lib/tax/scheduler";

let stopping = false;
const stop = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopping = true;
    stop.abort();
  });
async function drain(maxJobs: number) {
  let processed = 0;
  const deadline = Date.now() + 8 * 60 * 1000;
  while (
    !stopping &&
    processed < maxJobs &&
    Date.now() < deadline &&
    (await runNextJob())
  ) {
    processed++;
    await workerHeartbeat("processing");
    console.log(
      `Processed job ${processed}; results are recorded in the admin page.`,
    );
  }
  return processed;
}
async function main() {
  const command = process.argv[2];
  if (command === "init") {
    await registerSources();
    return;
  }
  if (command === "enqueue") {
    const mode = process.argv[3] || "daily";
    if (!["daily", "weekly"].includes(mode))
      throw new Error("Expected daily or weekly.");
    const sources = await prisma.taxSource.findMany({
      where: { enabled: true },
    });
    for (const source of sources)
      await enqueueRefresh(
        source.id,
        `${mode}:${new Date().toISOString().slice(0, 10)}`,
      );
    console.log(`Queued refresh for ${sources.length} sources.`);
    return;
  }
  if (!["once", "drain", "tick", "run"].includes(command))
    throw new Error(
      "Usage: npm run tax:worker -- init|enqueue [daily|weekly]|once|drain|tick|run",
    );
  let mode = "processing";
  await workerHeartbeat(mode);
  const heartbeat = setInterval(() => {
    void workerHeartbeat(mode).catch(() => {
      console.error("Worker heartbeat failed; check database connectivity.");
    });
  }, 30000);
  try {
    do {
      mode = "processing";
      await workerHeartbeat(mode);
      if (command === "tick" || command === "run") await scheduleRefreshes();
      const processed = await drain(command === "once" ? 1 : 150);
      console.log(
        `Processed ${processed} jobs this cycle; failed jobs keep their retry schedule.`,
      );
      if (command !== "run" || stopping) break;
      mode = "idle";
      await workerHeartbeat(mode);
      await delay(60000, undefined, { signal: stop.signal }).catch(() => {});
    } while (!stopping);
  } finally {
    clearInterval(heartbeat);
    await workerHeartbeat("stopped");
  }
}
main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Worker failed");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

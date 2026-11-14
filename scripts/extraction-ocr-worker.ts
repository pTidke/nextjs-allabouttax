import "./env";
import { setTimeout } from "node:timers/promises";
import { Pool } from "pg";
import { stagingConfig } from "../src/lib/extraction-staging/config";
import { database } from "../src/lib/extraction-staging/runtime";
import { ExtractionStore } from "../src/lib/extraction-staging/store";
import { evidenceReader } from "../src/lib/extraction-staging/objects";
import { azureOcrRepair } from "../src/lib/extraction-staging/azure-ocr-repair";
import { runRepairJob } from "../src/lib/extraction-staging/ocr-repair-worker";

async function main() {
  const command = process.argv[2] ?? "once";
  if (process.argv.length > 3 || !["once", "run"].includes(command))
    throw new Error("Choose once or run.");
  const config = stagingConfig();
  if (!config || process.env.EXTRACTION_OCR_REPAIR_ENABLED !== "true")
    throw new Error("Staging OCR repair must be explicitly enabled.");
  const provider = azureOcrRepair();
  const reader = evidenceReader(config.objects);
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 1,
    connectionTimeoutMillis: 5000,
    query_timeout: 12000,
  });
  pool.on("error", () =>
    console.error("OCR worker database connection interrupted."),
  );
  const store = new ExtractionStore(
    database(pool),
    config.environmentId,
    (c) => reader.verify(c),
    true,
  );
  const stop = new AbortController();
  process.once("SIGTERM", () => stop.abort());
  process.once("SIGINT", () => stop.abort());
  try {
    do {
      try {
        const status = await runRepairJob(
          store,
          (ref) => reader.read(ref),
          provider,
        );
        if (status || command === "once")
          console.log(status ?? "No OCR repair job ready.");
      } catch (error) {
        if (command === "once") throw error;
        console.error("Could not process the OCR repair queue. Retrying.");
      }
      if (command === "run" && !stop.signal.aborted)
        await setTimeout(15_000, undefined, { signal: stop.signal }).catch(
          () => {},
        );
    } while (command === "run" && !stop.signal.aborted);
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error(
    "OCR repair worker could not run. Check staging and Azure worker configuration.",
  );
  process.exitCode = 1;
});

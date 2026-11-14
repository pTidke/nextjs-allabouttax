import { Pool } from "pg";
import { SHA } from "@/lib/extraction-staging/contract";
import { azureOcrRepair } from "@/lib/extraction-staging/azure-ocr-repair";
import { stagingConfig } from "@/lib/extraction-staging/config";
import {
  hostedOcrEnabled,
  ocrQueue,
  ocrTopic,
} from "@/lib/extraction-staging/hosted-ocr-queue";
import { evidenceReader } from "@/lib/extraction-staging/objects";
import { runRepairJob } from "@/lib/extraction-staging/ocr-repair-worker";
import { database } from "@/lib/extraction-staging/runtime";
import { ExtractionStore } from "@/lib/extraction-staging/store";

export const runtime = "nodejs";
export const maxDuration = 240;

const consume = ocrQueue.handleCallback<{ requestId: string }>(
  async (message, metadata) => {
    if (
      metadata.topicName !== ocrTopic ||
      typeof message?.requestId !== "string" ||
      !SHA.test(message.requestId)
    )
      return;
    const config = stagingConfig({
      ...process.env,
      EXTRACTION_STAGING_DATABASE_URL:
        process.env.EXTRACTION_OCR_WORKER_DATABASE_URL,
    });
    if (!config) throw new Error("Staging OCR worker is disabled.");
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
    try {
      const store = new ExtractionStore(
        database(pool),
        config.environmentId,
        (c) => reader.verify(c),
        true,
      );
      await runRepairJob(
        store,
        (ref) => reader.read(ref),
        provider,
        message.requestId,
      );
      if (await store.repairPending(message.requestId))
        throw new Error("OCR repair is awaiting retry.");
    } finally {
      await pool.end();
    }
  },
  { retry: () => ({ afterSeconds: 135 }) },
);

export function POST(request: Request) {
  if (!hostedOcrEnabled()) return new Response(null, { status: 404 });
  return consume(request);
}

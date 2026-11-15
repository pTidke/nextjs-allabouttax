import { QueueClient } from "@vercel/queue";

export const ocrTopic = "extraction-ocr-repair-preview";
export const ocrQueue = new QueueClient({ region: "cle1" });

export function hostedOcrEnabled() {
  return (
    process.env.VERCEL_ENV === "preview" &&
    process.env.VERCEL_GIT_COMMIT_REF === "codex/pdf-processing-lab" &&
    process.env.EXTRACTION_STAGING_ENABLED === "true" &&
    process.env.EXTRACTION_OCR_REPAIR_ENABLED === "true"
  );
}

export async function startHostedOcr(requestId: string) {
  if (!hostedOcrEnabled()) return;
  await ocrQueue.send(ocrTopic, { requestId }, { idempotencyKey: requestId });
}

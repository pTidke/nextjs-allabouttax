import { createHandlers } from "@/lib/extraction-staging/handlers";
import { stagingRuntime } from "@/lib/extraction-staging/runtime";
import { stagingReviewer } from "@/lib/extraction-staging/principal";
import { startHostedOcr } from "@/lib/extraction-staging/hosted-ocr-queue";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createHandlers({
  enabled: () => process.env.EXTRACTION_STAGING_ENABLED === "true",
  principal: stagingReviewer,
  store: () => stagingRuntime().store,
  startRepair: startHostedOcr,
});
export const GET = handlers.GET;
export const POST = handlers.POST;

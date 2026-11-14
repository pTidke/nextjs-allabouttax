import { createAssetHandler } from "@/lib/extraction-staging/assets";
import { stagingRuntime } from "@/lib/extraction-staging/runtime";
import { stagingReviewer } from "@/lib/extraction-staging/principal";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const get = createAssetHandler({
  enabled: () => process.env.EXTRACTION_STAGING_ENABLED === "true",
  principal: stagingReviewer,
  store: () => stagingRuntime().store,
  readEvidence: (ref) => stagingRuntime().readEvidence(ref),
});
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ candidateId: string; objectId: string }> },
) {
  const { candidateId, objectId } = await params;
  return get(candidateId, objectId);
}

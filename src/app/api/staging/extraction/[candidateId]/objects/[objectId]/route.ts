import { createAssetHandler } from "@/lib/extraction-staging/assets";
import { stagingRuntime } from "@/lib/extraction-staging/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const get = createAssetHandler({
  enabled: () => process.env.EXTRACTION_STAGING_ENABLED === "true",
  principal: async () => {
    const { auth } = await import("@/auth");
    const session = await auth();
    return session?.user?.id ? { id: session.user.id } : null;
  },
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

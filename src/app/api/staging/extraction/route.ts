import { createHandlers } from "@/lib/extraction-staging/handlers";
import { stagingRuntime } from "@/lib/extraction-staging/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createHandlers({
  enabled: () => process.env.EXTRACTION_STAGING_ENABLED === "true",
  principal: async () => {
    const { auth } = await import("@/auth");
    const session = await auth();
    return session?.user?.id ? { id: session.user.id } : null;
  },
  store: () => stagingRuntime().store,
});
export const GET = handlers.GET;
export const POST = handlers.POST;

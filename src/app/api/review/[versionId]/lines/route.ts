import { signedInUserId } from "@/lib/chat/session";
import { errorResponse } from "@/lib/http";
import { pageLines } from "@/lib/review/extraction-runs";

export const runtime = "nodejs";

// The engine's lines for one page, with their boxes, for the page viewer.
export async function GET(
  req: Request,
  ctx: RouteContext<"/api/review/[versionId]/lines">,
) {
  try {
    const userId = await signedInUserId();
    const { versionId } = await ctx.params;
    const page = Number(new URL(req.url).searchParams.get("page") || "1");
    return Response.json(await pageLines(userId, versionId, page), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

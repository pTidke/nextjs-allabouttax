import { signedInUserId } from "@/lib/chat/session";
import { errorResponse } from "@/lib/http";
import { pageForReview } from "@/lib/review/line-reviews";

export const runtime = "nodejs";

// The engine's lines for one page, with their boxes and the latest decision on
// each, for the line review and the page viewer.
export async function GET(
  req: Request,
  ctx: RouteContext<"/api/review/[versionId]/lines">,
) {
  try {
    const userId = await signedInUserId();
    const { versionId } = await ctx.params;
    const page = Number(new URL(req.url).searchParams.get("page") || "1");
    return Response.json(await pageForReview(userId, versionId, page), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

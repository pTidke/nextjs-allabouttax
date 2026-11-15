import { signedInUserId } from "@/lib/chat/session";
import { errorResponse, sameOrigin } from "@/lib/http";
import { completeUpload } from "@/lib/tax/upload";

export const runtime = "nodejs";
export const maxDuration = 60;

// Joins the parts, checks them, and adds the PDF to the library.
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/review/upload/[uploadId]">,
) {
  try {
    sameOrigin(req);
    const userId = await signedInUserId();
    const { uploadId } = await ctx.params;
    return Response.json(await completeUpload(userId, uploadId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

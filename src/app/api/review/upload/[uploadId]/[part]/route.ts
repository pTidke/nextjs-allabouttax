import { signedInUserId } from "@/lib/chat/session";
import { errorResponse, HttpError, sameOrigin } from "@/lib/http";
import { PART_BYTES, putUploadPart } from "@/lib/tax/upload";

export const runtime = "nodejs";

// One part of an upload, as the raw bytes of the request body.
export async function PUT(
  req: Request,
  ctx: RouteContext<"/api/review/upload/[uploadId]/[part]">,
) {
  try {
    sameOrigin(req);
    const userId = await signedInUserId();
    const { uploadId, part } = await ctx.params;
    if (Number(req.headers.get("content-length") || 0) > PART_BYTES)
      throw new HttpError(413, "That part is too large.");
    const data = new Uint8Array(await req.arrayBuffer());
    if (data.length > PART_BYTES)
      throw new HttpError(413, "That part is too large.");
    return Response.json(
      await putUploadPart(userId, uploadId, Number(part), data),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

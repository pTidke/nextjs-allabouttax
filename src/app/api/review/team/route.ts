import { signedInUserId } from "@/lib/chat/session";
import { errorResponse, HttpError, readJson, sameOrigin } from "@/lib/http";
import { grantRole, isReviewRole, revokeRole } from "@/lib/review/roles";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const userId = await signedInUserId();
    const input = await readJson(req);
    if (!isReviewRole(input.role))
      throw new HttpError(400, "Unknown review role.");
    if (input.action === "grant" && typeof input.email === "string") {
      await grantRole(userId, input.email, input.role);
      return Response.json({ ok: true });
    }
    if (input.action === "revoke" && typeof input.userId === "string") {
      await revokeRole(userId, input.userId, input.role);
      return Response.json({ ok: true });
    }
    throw new HttpError(400, "Unknown action.");
  } catch (error) {
    return errorResponse(error);
  }
}

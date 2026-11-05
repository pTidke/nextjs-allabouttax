import { signedInUserId } from "@/lib/chat/session";
import { conversationHistory, deleteConversation } from "@/lib/chat/history";
import { errorResponse, sameOrigin } from "@/lib/http";
export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/conversations/[id]">,
) {
  try {
    const userId = await signedInUserId();
    const { id } = await ctx.params;
    return Response.json(await conversationHistory(id, userId), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function DELETE(
  req: Request,
  ctx: RouteContext<"/api/conversations/[id]">,
) {
  try {
    sameOrigin(req);
    const userId = await signedInUserId();
    const { id } = await ctx.params;
    await deleteConversation(id, userId);
    return Response.json(
      { deleted: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

import { signedInUserId } from "@/lib/chat/session";
import { exportConversation } from "@/lib/chat/history";
import { errorResponse } from "@/lib/http";
export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/conversations/[id]/export">,
) {
  try {
    const userId = await signedInUserId();
    const { id } = await ctx.params;
    const stream = await exportConversation(id, userId);
    return new Response(stream, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Content-Disposition":
          'attachment; filename="allabouttax-conversation.json"',
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

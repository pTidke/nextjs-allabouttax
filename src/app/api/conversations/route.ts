import { signedInUserId } from "@/lib/chat/session";
import { conversationList } from "@/lib/chat/history";
import { errorResponse } from "@/lib/http";
export async function GET(req: Request) {
  try {
    const id = await signedInUserId();
    const before = new URL(req.url).searchParams.get("before") || undefined;
    return Response.json(await conversationList(id, before), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

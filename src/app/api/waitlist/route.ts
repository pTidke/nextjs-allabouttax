import { joinWaitlist } from "@/lib/contact";
import { errorResponse, readJson, sameOrigin } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    await joinWaitlist(await readJson(req, 2000));
    // The same reply whether the address was new, already listed or a bot's.
    return Response.json(
      { received: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

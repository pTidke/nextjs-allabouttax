import { submitContact } from "@/lib/contact";
import { errorResponse, readJson, sameOrigin } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    await submitContact(await readJson(req, 8000));
    // The same reply whether or not the spam trap fired.
    return Response.json(
      { received: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

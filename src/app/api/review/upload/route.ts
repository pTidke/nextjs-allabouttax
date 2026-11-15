import { signedInUserId } from "@/lib/chat/session";
import { errorResponse, readJson, sameOrigin } from "@/lib/http";
import { startUpload } from "@/lib/tax/upload";

export const runtime = "nodejs";

// Starts an upload. The browser then sends the file in parts and completes it;
// see lib/tax/upload.ts.
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const userId = await signedInUserId();
    const input = await readJson(req, 4000);
    return Response.json(
      await startUpload(userId, {
        title: String(input.title ?? ""),
        officialUrl: String(input.officialUrl ?? ""),
        issuedAt: String(input.issuedAt ?? "") || undefined,
        size: input.size,
        sha256: input.sha256,
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

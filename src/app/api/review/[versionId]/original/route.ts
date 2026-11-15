import { signedInUserId } from "@/lib/chat/session";
import { errorResponse } from "@/lib/http";
import { originalDocument } from "@/lib/review/workflow";

export const runtime = "nodejs";

// The stored original, for reviewers to read beside the extracted text. Shown
// inline so the browser's own PDF viewer opens it, and never cached.
export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/review/[versionId]/original">,
) {
  try {
    const userId = await signedInUserId();
    const { versionId } = await ctx.params;
    const { original, contentType } = await originalDocument(userId, versionId);
    const pdf = contentType.includes("pdf");
    return new Response(new Uint8Array(original), {
      headers: {
        // HTML originals are shown as text, never run as a page on this site.
        "Content-Type": pdf ? "application/pdf" : "text/plain; charset=utf-8",
        "Content-Disposition": `inline; filename="document-${versionId}.${pdf ? "pdf" : "txt"}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

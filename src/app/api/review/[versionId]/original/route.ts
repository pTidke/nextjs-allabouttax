import { signedInUserId } from "@/lib/chat/session";
import { errorResponse, parseRange } from "@/lib/http";
import { originalInfo, originalSlice } from "@/lib/review/workflow";

export const runtime = "nodejs";
export const maxDuration = 60;

// The stored original, for reviewers to read beside the extracted text. Shown
// inline so the browser's own PDF viewer opens it. A version's original never
// changes, so the reviewer's own browser may keep it (never a shared cache).
//
// Vercel limits a response to 4.5 MB unless it is streamed, and uploads can be up
// to 32 MB. Up to 4 MB the body is read in one query; above that it is streamed
// in 1 MB slices read from the database. Next.js may send either without a
// Content-Length, so pdf.js downloads the whole file rather than byte ranges;
// the browser then keeps it. Ranges are still served for viewers that ask.
const SLICE = 1024 * 1024;
const WHOLE = 4 * 1024 * 1024;

function stream(versionId: string, start: number, end: number) {
  let at = start;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (at > end) return controller.close();
      const length = Math.min(SLICE, end - at + 1);
      const chunk = await originalSlice(versionId, at, length);
      at += length;
      controller.enqueue(chunk);
    },
  });
}

export async function GET(
  req: Request,
  ctx: RouteContext<"/api/review/[versionId]/original">,
) {
  try {
    const userId = await signedInUserId();
    const { versionId } = await ctx.params;
    const { size, contentType } = await originalInfo(userId, versionId);
    const pdf = contentType.includes("pdf");
    const headers: Record<string, string> = {
      // HTML originals are shown as text, never run as a page on this site.
      "Content-Type": pdf ? "application/pdf" : "text/plain; charset=utf-8",
      "Content-Disposition": `inline; filename="document-${versionId}.${pdf ? "pdf" : "txt"}"`,
      "Cache-Control": "private, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "bytes",
    };
    const range = parseRange(req.headers.get("range"), size);
    if (range === "unsatisfiable")
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${size}` },
      });
    const { start, end } = range ?? { start: 0, end: size - 1 };
    const length = end - start + 1;
    const body = !size
      ? null
      : length <= WHOLE
        ? await originalSlice(versionId, start, length)
        : stream(versionId, start, end);
    return new Response(body, {
      status: range ? 206 : 200,
      headers: {
        ...headers,
        "Content-Length": String(length),
        ...(range && { "Content-Range": `bytes ${start}-${end}/${size}` }),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

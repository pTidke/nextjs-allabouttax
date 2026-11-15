import { signedInUserId } from "@/lib/chat/session";
import { errorResponse, HttpError, sameOrigin } from "@/lib/http";
import { requireReviewer } from "@/lib/review/roles";
import { MAX_UPLOAD_BYTES, uploadDocument } from "@/lib/tax/upload";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const userId = await signedInUserId();
    const access = await requireReviewer(userId);
    if (!access.admin && !access.extraction)
      throw new HttpError(
        403,
        "Text review or administrator access is required.",
      );
    const declared = Number(req.headers.get("content-length") || 0);
    if (declared > MAX_UPLOAD_BYTES + 64 * 1024)
      throw new HttpError(413, "Upload a PDF of up to 4 MB.");
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new HttpError(400, "Choose a PDF to upload.");
    }
    const file = form.get("file");
    if (!(file instanceof File))
      throw new HttpError(400, "Choose a PDF to upload.");
    if (file.size > MAX_UPLOAD_BYTES)
      throw new HttpError(413, "Upload a PDF of up to 4 MB.");
    const result = await uploadDocument({
      bytes: new Uint8Array(await file.arrayBuffer()),
      title: String(form.get("title") ?? ""),
      officialUrl: String(form.get("officialUrl") ?? ""),
      issuedAt: String(form.get("issuedAt") ?? "") || undefined,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

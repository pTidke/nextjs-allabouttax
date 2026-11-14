import { HttpError, errorResponse } from "../http";
import type { ObjectRef } from "./contract";
import { validAssetIds, type Dependencies } from "./handlers";

export function createAssetHandler(
  deps: Dependencies & {
    readEvidence: (ref: ObjectRef) => Promise<Buffer>;
  },
) {
  return async (candidateId: string, objectId: string) => {
    try {
      if (!deps.enabled()) throw new HttpError(404, "Not found.");
      const user = await deps.principal();
      if (!user?.id) throw new HttpError(401, "Sign in first.");
      validAssetIds(candidateId, objectId);
      const { ref, pdf } = await deps
        .store()
        .sourceObject(user.id, candidateId, objectId);
      const bytes = await deps.readEvidence(ref);
      if (
        pdf
          ? !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
          : !bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        throw new Error("Invalid source object type.");
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": pdf ? "application/pdf" : "image/png",
          "Content-Disposition": pdf
            ? 'attachment; filename="official-source.pdf"'
            : "inline",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "X-Robots-Tag": "noindex, nofollow",
        },
      });
    } catch (error) {
      const response = errorResponse(error);
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("X-Content-Type-Options", "nosniff");
      return response;
    }
  };
}

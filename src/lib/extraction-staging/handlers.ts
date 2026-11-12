import { HttpError, errorResponse, readJson, sameOrigin } from "../http";
import { SHA, identifier } from "./contract";
import type { ExtractionStore } from "./store";
export type Dependencies = {
  enabled: () => boolean;
  principal: () => Promise<{ id: string } | null>;
  store: () => ExtractionStore;
};
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};
export function createHandlers(deps: Dependencies) {
  async function user() {
    if (!deps.enabled()) throw new HttpError(404, "Not found.");
    const u = await deps.principal();
    if (!u?.id) throw new HttpError(401, "Sign in first.");
    return u.id;
  }
  async function respond(fn: () => Promise<unknown>) {
    try {
      return Response.json(await fn(), { headers });
    } catch (error) {
      const response = errorResponse(error);
      for (const [key, value] of Object.entries(headers))
        response.headers.set(key, value);
      return response;
    }
  }
  return {
    GET: (request: Request) =>
      respond(async () => {
        const id = await user(),
          candidate = new URL(request.url).searchParams.get("candidateId");
        if (candidate && !SHA.test(candidate))
          throw new HttpError(400, "Invalid draft identifier.");
        return candidate
          ? deps.store().get(id, candidate)
          : {
              candidates: await deps.store().list(id),
              publicationEligible: false,
              taxApproved: false,
            };
      }),
    POST: (request: Request) =>
      respond(async () => {
        if (!deps.enabled()) throw new HttpError(404, "Not found.");
        sameOrigin(request);
        const id = await user(),
          body = await readJson(request, 128 * 1024);
        return deps.store().save(id, body);
      }),
  };
}
export function validAssetIds(candidateId: string, objectId: string) {
  if (!SHA.test(candidateId) || !identifier.test(objectId))
    throw new HttpError(400, "Invalid evidence reference.");
}

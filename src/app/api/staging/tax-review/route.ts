import { stagingReviewer } from "@/lib/extraction-staging/principal";
import { stagingRuntime } from "@/lib/extraction-staging/runtime";
import { saveTaxReview } from "@/lib/extraction-staging/tax-review";
import { errorResponse, HttpError, readJson, sameOrigin } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let response: Response;
  try {
    if (process.env.EXTRACTION_STAGING_ENABLED !== "true")
      throw new HttpError(404, "Not found.");
    sameOrigin(request);
    const viewer = await stagingReviewer();
    if (!viewer) throw new HttpError(401, "Sign in first.");
    response = Response.json(
      await saveTaxReview(
        stagingRuntime().store,
        viewer,
        await readJson(request, 32768),
      ),
    );
  } catch (error) {
    response = errorResponse(error);
  }
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

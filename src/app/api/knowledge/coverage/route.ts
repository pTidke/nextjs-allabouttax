import { knowledgeCoverage } from "@/lib/tax/coverage";
import { validPeriod } from "@/lib/tax/registry";
import { errorResponse, HttpError } from "@/lib/http";
export async function GET(req: Request) {
  try {
    const period = new URL(req.url).searchParams.get("period");
    if (!validPeriod(period))
      throw new HttpError(400, "Select a valid FY, AY or TY period.");
    return Response.json(await knowledgeCoverage(period), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

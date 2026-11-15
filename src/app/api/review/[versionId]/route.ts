import { signedInUserId } from "@/lib/chat/session";
import { errorResponse, HttpError, readJson, sameOrigin } from "@/lib/http";
import type { ReviewInput } from "@/lib/tax/review";
import {
  recordTaxDecision,
  recordTextCheck,
  saveTaxDraft,
  type TextDecision,
} from "@/lib/review/workflow";
import { recordLineDecision } from "@/lib/review/line-reviews";

export const runtime = "nodejs";

// One endpoint for every decision on a document version. Each action checks the
// reviewer's role itself, so the browser cannot skip a gate.
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/review/[versionId]">,
) {
  try {
    sameOrigin(req);
    const userId = await signedInUserId();
    const { versionId } = await ctx.params;
    const input = await readJson(req);
    if (input.versionId !== undefined && input.versionId !== versionId)
      throw new HttpError(400, "The request is for a different document.");
    const reply = (value: unknown) =>
      Response.json(value, { headers: { "Cache-Control": "no-store" } });
    switch (input.action) {
      case "textCheck":
        return reply(
          await recordTextCheck(
            userId,
            versionId,
            input.decision as TextDecision,
            String(input.note ?? ""),
          ),
        );
      case "line":
        return reply(
          await recordLineDecision(userId, versionId, {
            runId: input.runId,
            lineId: input.lineId,
            decision: input.decision,
            text: input.text,
          }),
        );
      case "saveDraft":
        return reply(
          await saveTaxDraft(
            userId,
            versionId,
            input.draft,
            input.revision as number,
          ),
        );
      case "approve":
      case "reject":
        return reply(
          await recordTaxDecision(userId, {
            ...(input as unknown as ReviewInput),
            versionId,
          }),
        );
      default:
        throw new HttpError(400, "Unknown action.");
    }
  } catch (error) {
    return errorResponse(error);
  }
}

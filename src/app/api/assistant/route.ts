import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { HttpError, errorResponse, readJson, sameOrigin } from "@/lib/http";
import { ownedConversation, reserveQuestion } from "@/lib/chat/access";
import { generateAnswer } from "@/lib/chat/generate";
import { validPeriod } from "@/lib/tax/registry";
import { retrieveEvidence } from "@/lib/tax/retrieval";
import { NO_EVIDENCE_MESSAGE, PROMPT_VERSION } from "@/lib/chat/answer";
import { DAILY_LIMIT, indiaDay, saveTurn } from "@/lib/chat/turn";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const session = await auth();
    if (!session?.user?.id)
      throw new HttpError(401, "Please log in to ask questions.");
    const input = await readJson(req);
    if (
      typeof input.message !== "string" ||
      !input.message.trim() ||
      input.message.length > 6000 ||
      !validPeriod(input.period)
    )
      throw new HttpError(
        400,
        "Enter a question (up to 6,000 characters) and select its tax period.",
      );
    if (
      input.conversationId !== undefined &&
      (typeof input.conversationId !== "string" ||
        input.conversationId.length > 100)
    )
      throw new HttpError(400, "Invalid conversation.");
    // No client-supplied provider thread or response identifiers are ever accepted.
    if (
      "threadId" in input ||
      "data" in input ||
      "previous_response_id" in input
    )
      throw new HttpError(400, "Please reload the updated chat interface.");
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });
    if (!user) throw new HttpError(401, "Please sign in again.");
    const question = input.message.trim();
    const period = input.period;
    const existing = await ownedConversation(
      input.conversationId as string | undefined,
      user.id,
      period,
    );
    // Earlier questions give a short follow-up something to search with.
    const earlier = existing
      ? await prisma.taxMessage.findMany({
          where: { conversationId: existing.id, role: "user" },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 3,
          select: { content: true },
        })
      : [];
    const { evidence, releaseId } = await retrieveEvidence(
      question,
      period,
      earlier.map((message) => message.content),
    );
    const day = indiaDay();
    const limit = DAILY_LIMIT[user.role];
    const turn = {
      userId: user.id,
      conversationId: existing?.id ?? null,
      period,
      question,
      releaseId,
      day,
      limit,
    };
    // An empty corpus is an explicit limitation; never silently answer from model
    // memory. No model call is made, so no question is used.
    if (!evidence.length) {
      const saved = await saveTurn({
        ...turn,
        answer: NO_EVIDENCE_MESSAGE,
        citations: [],
        outcome: "NO_EVIDENCE",
        charged: false,
      });
      return Response.json({ ...saved, suggestions: [] });
    }
    await reserveQuestion(user.id, day, limit);
    try {
      const history = existing
        ? await prisma.taxMessage.findMany({
            where: { conversationId: existing.id },
            orderBy: { createdAt: "desc" },
            take: 8,
            select: { role: true, content: true },
          })
        : [];
      const { answer, citations, model, outcome } = await generateAnswer({
        question,
        period,
        history: history.reverse(),
        evidence,
      });
      const saved = await saveTurn({
        ...turn,
        answer: answer.answer,
        citations,
        outcome,
        model,
        promptVersion: PROMPT_VERSION,
        charged: true,
      });
      return Response.json({ ...saved, suggestions: answer.suggestions });
    } catch (error) {
      await prisma.dailyUsage.updateMany({
        where: { userId: user.id, day, count: { gt: 0 } },
        data: { count: { decrement: 1 } },
      });
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}

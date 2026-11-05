import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { HttpError, errorResponse, readJson, sameOrigin } from "@/lib/http";
import { ownedConversation, reserveQuestion } from "@/lib/chat/access";
import { generateAnswer } from "@/lib/chat/generate";
import { validPeriod } from "@/lib/tax/registry";
import { retrieveEvidence } from "@/lib/tax/retrieval";
import { PROMPT_VERSION } from "@/lib/chat/answer";

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
    const existing = await ownedConversation(
      input.conversationId as string | undefined,
      user.id,
      input.period,
    );
    const { evidence, releaseId } = await retrieveEvidence(
      input.message,
      input.period,
    );
    // An empty corpus is an explicit limitation; never silently answer from model memory.
    if (!evidence.length)
      return Response.json({
        conversationId: existing?.id ?? null,
        message: {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "I do not have a current, approved source matching this question and tax period yet. The knowledge library may be awaiting review or refresh. For an entity-specific notification, include the full entity name in your question. Otherwise, narrow the question or consult a tax professional.",
          citations: [],
          releaseId,
        },
        suggestions: [],
      });
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const limit = user.role === "ADMIN" ? 1000 : 10;
    await reserveQuestion(user.id, day, limit);
    try {
      const conversation =
        existing ??
        (await prisma.taxConversation.create({
          data: { userId: user.id, period: input.period },
        }));
      const history = await prisma.taxMessage.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { role: true, content: true },
      });
      const { answer, citations, model } = await generateAnswer({
        question: input.message.trim(),
        period: input.period,
        history: history.reverse(),
        evidence,
      });
      const message = await prisma.$transaction(async (tx) => {
        await tx.taxMessage.create({
          data: {
            conversationId: conversation.id,
            role: "user",
            content: input.message as string,
            citations: [],
          },
        });
        return tx.taxMessage.create({
          data: {
            conversationId: conversation.id,
            role: "assistant",
            content: answer.answer,
            citations: citations as unknown as Prisma.InputJsonValue,
            releaseId,
            model,
            promptVersion: PROMPT_VERSION,
          },
        });
      });
      return Response.json({
        conversationId: conversation.id,
        message,
        suggestions: answer.suggestions,
      });
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

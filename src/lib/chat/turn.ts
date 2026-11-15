import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import type { Citation, Outcome } from "./answer";

export const DAILY_LIMIT = { USER: 10, ADMIN: 1000 } as const;

export function indiaDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export async function remainingQuestions(
  userId: string,
  day: string,
  limit: number,
  tx: Prisma.TransactionClient = prisma,
) {
  const usage = await tx.dailyUsage.findUnique({
    where: { userId_day: { userId, day } },
    select: { count: true },
  });
  return Math.max(0, limit - (usage?.count ?? 0));
}

// Saves both sides of one exchange. Everything happens in one transaction, so a
// failed answer never leaves an empty conversation behind:
// - the conversation is created here if this is the first question;
// - a question the library could not answer is logged as a content gap;
// - a refusal gives the question back to the user's daily quota.
export async function saveTurn(input: {
  userId: string;
  conversationId: string | null;
  period: string;
  question: string;
  answer: string;
  citations: Citation[];
  outcome: Outcome;
  releaseId: string | null;
  model?: string | null;
  promptVersion?: string | null;
  day: string;
  limit: number;
  // Whether this question used one of today's questions.
  charged: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const conversationId =
      input.conversationId ??
      (
        await tx.taxConversation.create({
          data: { userId: input.userId, period: input.period },
        })
      ).id;
    const asked = await tx.taxMessage.create({
      data: {
        conversationId,
        role: "user",
        content: input.question,
        citations: [],
      },
    });
    const message = await tx.taxMessage.create({
      data: {
        conversationId,
        role: "assistant",
        content: input.answer,
        citations: input.citations as unknown as Prisma.InputJsonValue,
        releaseId: input.releaseId,
        model: input.model ?? null,
        promptVersion: input.promptVersion ?? null,
        outcome: input.outcome,
      },
      select: {
        id: true,
        role: true,
        content: true,
        citations: true,
        releaseId: true,
        outcome: true,
        createdAt: true,
      },
    });
    if (input.outcome === "NO_EVIDENCE" || input.outcome === "UNSUPPORTED")
      await tx.taxContentGap.create({
        data: {
          messageId: asked.id,
          period: input.period,
          reason: input.outcome,
          releaseId: input.releaseId,
        },
      });
    if (input.charged && input.outcome === "UNSUPPORTED")
      await tx.dailyUsage.updateMany({
        where: { userId: input.userId, day: input.day, count: { gt: 0 } },
        data: { count: { decrement: 1 } },
      });
    return {
      conversationId,
      message,
      remaining: await remainingQuestions(
        input.userId,
        input.day,
        input.limit,
        tx,
      ),
    };
  });
}

// For the administrator: questions the library could not answer, newest first.
// Deliberately carries no name, email or user id.
export async function recentContentGaps(take = 100) {
  const rows = await prisma.taxContentGap.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: {
      id: true,
      period: true,
      reason: true,
      createdAt: true,
      message: { select: { content: true } },
    },
  });
  return rows.map(({ message, ...gap }) => ({
    ...gap,
    question: message.content,
  }));
}

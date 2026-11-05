import { prisma } from "../db";
import { HttpError } from "../http";

export async function ownedConversation(
  id: string | undefined,
  userId: string,
  period: string,
) {
  if (!id) return null;
  const conversation = await prisma.taxConversation.findFirst({
    where: { id, userId },
  });
  if (!conversation) throw new HttpError(404, "Conversation not found.");
  if (conversation.period !== period)
    throw new HttpError(400, "Start a new chat to change the tax period.");
  return conversation;
}
export async function reserveQuestion(
  userId: string,
  day: string,
  limit: number,
) {
  const result = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "DailyUsage" ("userId", day, count) VALUES (${userId}, ${day}, 1)
    ON CONFLICT ("userId", day) DO UPDATE SET count = "DailyUsage".count + 1
    WHERE "DailyUsage".count < ${limit} RETURNING count`;
  if (!result.length)
    throw new HttpError(
      429,
      "You have reached today’s question limit. It resets at midnight India time.",
    );
}

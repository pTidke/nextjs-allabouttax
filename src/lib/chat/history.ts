import { prisma } from "../db";
import { HttpError } from "../http";

export async function conversationList(userId: string, before?: string) {
  let cursor: { at: string; id: string } | undefined;
  if (before) {
    try {
      cursor = JSON.parse(Buffer.from(before, "base64url").toString("utf8"));
      if (
        !cursor ||
        typeof cursor.id !== "string" ||
        cursor.id.length > 100 ||
        typeof cursor.at !== "string" ||
        !Number.isFinite(Date.parse(cursor.at))
      )
        throw new Error();
    } catch {
      throw new HttpError(400, "Invalid history cursor.");
    }
  }
  const rows = await prisma.taxConversation.findMany({
    where: {
      userId,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(cursor.at) } },
              { createdAt: new Date(cursor.at), id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 26,
    select: {
      id: true,
      period: true,
      createdAt: true,
      _count: { select: { messages: true } },
    },
  });
  return {
    conversations: rows.slice(0, 25),
    nextBefore:
      rows.length > 25
        ? Buffer.from(
            JSON.stringify({
              at: rows[24].createdAt.toISOString(),
              id: rows[24].id,
            }),
          ).toString("base64url")
        : null,
  };
}

export async function conversationHistory(id: string, userId: string) {
  const conversation = await prisma.taxConversation.findFirst({
    where: { id, userId },
    select: { id: true, period: true, createdAt: true },
  });
  if (!conversation) throw new HttpError(404, "Conversation not found.");
  const rows = await prisma.taxMessage.findMany({
    where: { conversationId: id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 101,
    select: {
      id: true,
      role: true,
      content: true,
      citations: true,
      releaseId: true,
      createdAt: true,
    },
  });
  return {
    ...conversation,
    messages: rows.slice(0, 100).reverse(),
    truncated: rows.length > 100,
  };
}

export async function deleteConversation(id: string, userId: string) {
  const result = await prisma.taxConversation.deleteMany({
    where: { id, userId },
  });
  if (!result.count) throw new HttpError(404, "Conversation not found.");
}

export async function exportConversation(id: string, userId: string) {
  const conversation = await prisma.taxConversation.findFirst({
    where: { id, userId },
    select: { id: true, period: true, createdAt: true },
  });
  if (!conversation) throw new HttpError(404, "Conversation not found.");
  const snapshot = new Date();
  let cursor: string | undefined;
  let started = false;
  let first = true;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        if (!started) {
          started = true;
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ exportedAt: snapshot, conversation }).slice(
                0,
                -1,
              ) + ',"messages":[',
            ),
          );
          return;
        }
        const rows = await prisma.taxMessage.findMany({
          where: { conversationId: id, createdAt: { lte: snapshot } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 100,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: {
            id: true,
            role: true,
            content: true,
            citations: true,
            releaseId: true,
            createdAt: true,
          },
        });
        if (!rows.length) {
          controller.enqueue(encoder.encode("]}"));
          controller.close();
          return;
        }
        cursor = rows[rows.length - 1].id;
        controller.enqueue(
          encoder.encode(
            (first ? "" : ",") +
              rows.map((row) => JSON.stringify(row)).join(","),
          ),
        );
        first = false;
      } catch {
        controller.error(new Error("Could not complete conversation export."));
      }
    },
  });
  return stream;
}

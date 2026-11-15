import { prisma } from "./db";
import { HttpError } from "./http";

export const CONTACT_LIMITS = {
  // Per e-mail address, per hour.
  perSender: 3,
  // Across the whole site, per hour. Protects the free database from a flood.
  perHour: 100,
  name: 200,
  email: 254,
  message: 5000,
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Stores a message from the public contact form. `website` is a hidden field that
// people never see; a bot that fills it gets a normal-looking reply and nothing is
// stored.
export async function submitContact(
  input: Record<string, unknown>,
  now = new Date(),
) {
  const field = (key: string, max: number) => {
    const value = input[key];
    if (typeof value !== "string" || !value.trim() || value.length > max)
      throw new HttpError(
        400,
        "Enter your name, a valid email address and a message.",
      );
    return value.trim();
  };
  if (input.website) return { stored: false };
  const name = field("name", CONTACT_LIMITS.name);
  const email = field("email", CONTACT_LIMITS.email).toLowerCase();
  const message = field("message", CONTACT_LIMITS.message);
  if (!EMAIL.test(email))
    throw new HttpError(
      400,
      "Enter your name, a valid email address and a message.",
    );
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  return prisma.$transaction(async (tx) => {
    // One writer at a time, so the limits below cannot be raced past.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(740130)::text`;
    const [fromSender, total] = await Promise.all([
      tx.contactMessage.count({
        where: { email, createdAt: { gte: hourAgo } },
      }),
      tx.contactMessage.count({ where: { createdAt: { gte: hourAgo } } }),
    ]);
    if (
      fromSender >= CONTACT_LIMITS.perSender ||
      total >= CONTACT_LIMITS.perHour
    )
      throw new HttpError(
        429,
        "We have received several messages already. Please try again in an hour.",
      );
    await tx.contactMessage.create({
      data: { name, email, message, createdAt: now },
    });
    return { stored: true };
  });
}

export function recentContactMessages(take = 100) {
  return prisma.contactMessage.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
  });
}

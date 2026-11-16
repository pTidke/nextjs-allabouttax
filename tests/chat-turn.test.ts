import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@prisma/client";
import type { Evidence } from "../src/lib/tax/retrieval";
import { validateAnswer, safeClarification } from "../src/lib/chat/answer";

const database = new PGlite();
const db = new PrismaClient({ adapter: new PrismaPGlite(database) });
let turn: typeof import("../src/lib/chat/turn");
let access: typeof import("../src/lib/chat/access");
let contact: typeof import("../src/lib/contact");
before(async () => {
  for (const name of (await readdir("prisma/migrations")).sort())
    if (!name.endsWith(".toml"))
      await database.exec(
        await readFile(`prisma/migrations/${name}/migration.sql`, "utf8"),
      );
  (globalThis as unknown as { prisma: PrismaClient }).prisma = db;
  turn = await import("../src/lib/chat/turn");
  access = await import("../src/lib/chat/access");
  contact = await import("../src/lib/contact");
});
after(async () => {
  await db.$disconnect();
  await database.close();
});

const evidence = [
  {
    id: "c1",
    versionId: "v1",
    title: "Tax year guidance",
    url: "https://www.incometax.gov.in/guidance",
    anchor: "FAQ 9",
    context: null,
    text: "A tax year is the twelve month period beginning on the first of April.",
    checkedAt: new Date(),
    effectiveFrom: new Date("2026-04-01"),
    effectiveTo: null,
    documentType: "GUIDANCE",
    legalStatus: "GUIDANCE",
    period: "TY 2026-27",
    periodMode: "SINGLE_PERIOD",
    applicabilityNote: null,
    entityName: null,
    investmentFrom: null,
    investmentThrough: null,
  },
] satisfies Evidence[];
const reply = (fields: Record<string, unknown>) => ({
  answer: "",
  supported: false,
  needsClarification: false,
  sourceIds: [],
  suggestions: [],
  ...fields,
});

test("a clarifying question is shown only when it carries no tax content", () => {
  const asked = validateAnswer(
    reply({
      answer: "Are you asking about income earned in India or abroad?",
      needsClarification: true,
    }),
    evidence,
  );
  assert.equal(asked.outcome, "CLARIFICATION");
  assert.equal(
    asked.answer.answer,
    "Are you asking about income earned in India or abroad?",
  );
  assert.deepEqual(asked.citations, []);
  // Anything that could be a rule from model memory falls back to the refusal.
  for (const text of [
    "Is your income above 7 lakh rupees?",
    "Did you invest before 31 March?",
    "Does [S1] apply to you?",
    "Please tell me where you live.",
    "x".repeat(401) + "?",
  ]) {
    assert.equal(safeClarification(text), false, text);
    const fallback = validateAnswer(
      reply({ answer: text, needsClarification: true }),
      evidence,
    );
    assert.equal(fallback.outcome, "UNSUPPORTED", text);
    assert.notEqual(fallback.answer.answer, text);
  }
  assert.equal(
    validateAnswer(reply({ answer: "Not covered." }), evidence).outcome,
    "UNSUPPORTED",
  );
  const answered = validateAnswer(
    reply({
      answer: "It is twelve months [S1].",
      supported: true,
      sourceIds: ["S1"],
    }),
    evidence,
  );
  assert.equal(answered.outcome, "ANSWERED");
  assert.equal(answered.answer.needsClarification, false);
});

test("an unanswered first question is saved, logged as a gap and costs nothing", async () => {
  const user = await db.user.create({ data: { email: "gap@example.test" } });
  const saved = await turn.saveTurn({
    userId: user.id,
    conversationId: null,
    period: "FY 2026-27",
    question: "Which forms do freelancers file?",
    answer: "No source.",
    citations: [],
    outcome: "NO_EVIDENCE",
    releaseId: null,
    day: "2026-11-15",
    limit: 10,
    charged: false,
  });
  assert.equal(saved.remaining, 10);
  assert.equal(saved.message.outcome, "NO_EVIDENCE");
  const messages = await db.taxMessage.findMany({
    where: { conversationId: saved.conversationId },
    orderBy: { createdAt: "asc" },
  });
  assert.deepEqual(
    messages.map((m) => m.role),
    ["user", "assistant"],
    "both sides are kept, so they survive a reload and appear in history",
  );
  const gaps = await turn.recentContentGaps();
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].question, "Which forms do freelancers file?");
  assert.equal(gaps[0].reason, "NO_EVIDENCE");
  assert.equal(gaps[0].period, "FY 2026-27");
  assert.deepEqual(
    Object.keys(gaps[0]).sort(),
    ["createdAt", "id", "period", "question", "reason"],
    "the administrator's view carries nobody's identity",
  );
  // Deleting the conversation removes the logged question too.
  await db.taxConversation.delete({ where: { id: saved.conversationId } });
  assert.equal(await db.taxContentGap.count(), 0);
});

test("a refusal is refunded, a clarifying question and an answer are charged", async () => {
  const user = await db.user.create({ data: { email: "quota@example.test" } });
  const day = "2026-11-16";
  const ask = async (
    outcome: "UNSUPPORTED" | "CLARIFICATION" | "ANSWERED",
    id: string | null,
  ) => {
    await access.reserveQuestion(user.id, day, 10);
    return turn.saveTurn({
      userId: user.id,
      conversationId: id,
      period: "TY 2026-27",
      question: `question ${outcome}`,
      answer: `reply ${outcome}`,
      citations: [],
      outcome,
      releaseId: "release-1",
      model: "test-model",
      promptVersion: "test",
      day,
      limit: 10,
      charged: true,
    });
  };
  const refused = await ask("UNSUPPORTED", null);
  assert.equal(refused.remaining, 10);
  const clarified = await ask("CLARIFICATION", refused.conversationId);
  assert.equal(clarified.remaining, 9);
  const answered = await ask("ANSWERED", refused.conversationId);
  assert.equal(answered.remaining, 8);
  assert.equal(answered.conversationId, refused.conversationId);
  assert.equal(
    await db.taxContentGap.count({ where: { reason: "UNSUPPORTED" } }),
    1,
    "only the refusal is logged as a gap",
  );
  assert.equal(await turn.remainingQuestions(user.id, day, 10), 8);
  assert.equal(await turn.remainingQuestions(user.id, "2026-11-17", 10), 10);
});

test("a failed save leaves no empty conversation behind", async () => {
  const user = await db.user.create({ data: { email: "empty@example.test" } });
  await assert.rejects(
    turn.saveTurn({
      userId: user.id,
      conversationId: null,
      period: "TY 2026-27",
      question: null as unknown as string,
      answer: "reply",
      citations: [],
      outcome: "ANSWERED",
      releaseId: null,
      day: "2026-11-15",
      limit: 10,
      charged: true,
    }),
  );
  assert.equal(
    await db.taxConversation.count({ where: { userId: user.id } }),
    0,
  );
});

test("contact messages are stored, validated, trapped and rate limited", async () => {
  const now = new Date("2026-11-15T10:00:00Z");
  const message = {
    name: "  Asha  ",
    email: "Asha@Example.TEST",
    message: "When will GST be covered?",
  };
  assert.deepEqual(await contact.submitContact(message, now), { stored: true });
  const [saved] = await contact.recentContactMessages();
  assert.equal(saved.name, "Asha");
  assert.equal(saved.email, "asha@example.test");
  // A bot that fills the hidden field gets the same reply and nothing is stored.
  assert.deepEqual(
    await contact.submitContact(
      { ...message, website: "http://spam.test" },
      now,
    ),
    { stored: false },
  );
  assert.equal(await db.contactMessage.count(), 1);
  for (const bad of [
    { ...message, email: "not-an-email" },
    { ...message, name: " " },
    { ...message, message: "x".repeat(5001) },
    { name: "Asha", email: "a@b.test" },
  ])
    await assert.rejects(contact.submitContact(bad, now), { status: 400 });
  await contact.submitContact(message, now);
  await contact.submitContact(message, now);
  await assert.rejects(contact.submitContact(message, now), { status: 429 });
  // The limit is per hour.
  const later = new Date(now.getTime() + 61 * 60 * 1000);
  assert.deepEqual(await contact.submitContact(message, later), {
    stored: true,
  });
  // And a site-wide cap protects the free database from a flood.
  await db.contactMessage.createMany({
    data: Array.from({ length: 100 }, (_, i) => ({
      name: "n",
      email: `s${i}@example.test`,
      message: "m",
      createdAt: later,
    })),
  });
  await assert.rejects(
    contact.submitContact({ ...message, email: "new@example.test" }, later),
    { status: 429 },
  );
});

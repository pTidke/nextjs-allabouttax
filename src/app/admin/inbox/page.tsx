import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { recentContactMessages } from "@/lib/contact";
import { recentContentGaps } from "@/lib/chat/turn";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Inbox",
  robots: { index: false, follow: false },
};

const reasons: Record<string, string> = {
  NO_EVIDENCE: "No matching source",
  UNSUPPORTED: "Sources did not answer it",
};
const when = (date: Date) =>
  date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });

export default async function InboxPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (user?.role !== "ADMIN") redirect("/");
  const [gaps, messages] = await Promise.all([
    recentContentGaps(),
    recentContactMessages(),
  ]);
  return (
    <main className="mx-auto w-full max-w-4xl space-y-12 px-6 pb-20 pt-10">
      <header className="space-y-2">
        <h1 className="border-b-[3px] border-double border-ink pb-5 font-serif text-4xl font-bold">
          Inbox
        </h1>
        <p className="text-ink-soft">
          The latest 100 of each. Use unanswered questions to decide which
          official sources to review next.{" "}
          <Link href="/admin/knowledge" className="underline">
            Knowledge administration
          </Link>
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-bold">Unanswered questions</h2>
        <p className="text-sm text-ink-soft">
          Shown without names or email addresses. A question disappears from
          here when its author deletes the conversation.
        </p>
        {!gaps.length && <p>No unanswered questions yet.</p>}
        {gaps.map((gap) => (
          <article
            key={gap.id}
            className="border border-ink bg-paper p-4 space-y-1"
          >
            <p className="whitespace-pre-wrap">{gap.question}</p>
            <p className="text-xs text-ink-soft">
              {gap.period === "AUTO" ? "No year named" : gap.period} ·{" "}
              {reasons[gap.reason] ?? gap.reason} · {when(gap.createdAt)}
            </p>
          </article>
        ))}
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-bold">Contact messages</h2>
        {!messages.length && <p>No messages yet.</p>}
        {messages.map((message) => (
          <article
            key={message.id}
            className="border border-ink bg-paper p-4 space-y-2"
          >
            <p className="text-sm">
              <strong>{message.name}</strong> ·{" "}
              <a
                href={`mailto:${encodeURIComponent(message.email)}?subject=${encodeURIComponent("Re: your message to All About Tax")}`}
                className="underline"
              >
                {message.email}
              </a>{" "}
              · <span className="text-ink-soft">{when(message.createdAt)}</span>
            </p>
            <p className="whitespace-pre-wrap">{message.message}</p>
          </article>
        ))}
      </section>
    </main>
  );
}

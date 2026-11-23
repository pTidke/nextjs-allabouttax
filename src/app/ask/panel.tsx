"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import LoginModal from "@/components/auth/LoginModal";
import { useChat, type ChatMessage } from "@/components/chat/ChatContext";

const EXAMPLES = [
  "What does Circular No. 3/2026 cover?",
  "What changed in the Income-tax Act, 2025?",
  "Who is covered by Notification No. 1/2026?",
];

export default function AskPanel({
  question,
  ready,
}: {
  question: string;
  ready: number | null;
}) {
  const {
    status,
    messages,
    input,
    setInput,
    suggestions,
    user,
    handleSubmit,
    ask,
    clearChat,
    error,
    remaining,
  } = useChat();
  const router = useRouter();
  const session = useSession();
  const busy = status === "in_progress";
  const bottom = useRef<HTMLDivElement>(null);
  const asked = useRef(false);

  // A question from the home page (/ask?q=…) is asked once, then dropped from
  // the address so a reload does not ask it again.
  // Wait for the session, so a signed-in visitor's question is asked rather
  // than only typed in.
  useEffect(() => {
    if (asked.current || !question || session.status === "loading") return;
    asked.current = true;
    router.replace("/ask", { scroll: false });
    if (user) void ask(question);
    else setInput(question);
  }, [question, session.status, user, ask, setInput, router]);

  useEffect(() => {
    if (messages.length || busy)
      bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-6 pt-6 text-[15px]">
        {user && (
          <Link
            href="/chats"
            className="flex min-h-11 items-center border border-ink px-4 no-underline hover:bg-paper"
          >
            Your chats
          </Link>
        )}
        {!!messages.length && (
          <button
            type="button"
            onClick={clearChat}
            className="ml-auto min-h-11 cursor-pointer bg-ink px-4 text-paper hover:bg-brand-strong"
          >
            + New chat
          </button>
        )}
      </div>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 pb-10 pt-10">
        {!messages.length && !busy && (
          <div className="flex flex-col items-center gap-5 py-10 text-center">
            <h1 className="font-serif text-4xl font-bold leading-tight md:text-5xl">
              Ask a tax question
            </h1>
            <p className="max-w-xl text-lg text-ink-soft">
              {ready
                ? `Answers come from ${ready} checked official ${ready === 1 ? "document" : "documents"}. `
                : "Answers come only from official documents that have been checked. "}
              Name the tax year if it matters.
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-2.5 text-[15px]">
              {EXAMPLES.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => (user ? void ask(q) : setInput(q))}
                  className="min-h-11 cursor-pointer border border-dashed border-ink px-3.5 hover:bg-paper"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap bg-ink px-5 py-3.5 text-paper">
                {message.content}
              </p>
            </div>
          ) : (
            <Answer key={message.id} message={message} />
          ),
        )}

        {busy && (
          <p role="status" className="label-mono text-ink-soft">
            Reading the checked sources…
          </p>
        )}

        {error && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-4 border-2 border-ink bg-paper px-5 py-4"
          >
            <span className="flex-1">{error}</span>
            {!user && <LoginModal />}
          </div>
        )}

        {!busy && !!suggestions.length && (
          <div className="flex flex-wrap gap-2.5 text-[15px]">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setInput(s)}
                className="min-h-11 cursor-pointer border border-dashed border-ink px-3.5 text-left hover:bg-paper"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div ref={bottom} />
      </main>

      <div className="sticky bottom-0 border-t border-ink bg-paper">
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-3xl flex-col gap-2.5 px-6 pb-5 pt-4"
        >
          <div className="flex border-2 border-ink bg-paper">
            <label htmlFor="ask-input" className="sr-only">
              Your question
            </label>
            <textarea
              id="ask-input"
              value={input}
              maxLength={6000}
              rows={1}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
              placeholder={
                messages.length ? "Ask a follow-up…" : "Ask anything about income tax…"
              }
              className="max-h-48 min-h-14 min-w-0 flex-1 resize-none bg-transparent px-4 py-3.5 text-[17px] outline-none [field-sizing:content]"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="cursor-pointer bg-ink px-7 font-semibold text-paper hover:bg-brand-strong disabled:cursor-default disabled:opacity-40"
            >
              Ask
            </button>
          </div>
          <p className="text-center text-[13px] text-ink-soft">
            {remaining !== null &&
              `${remaining} ${remaining === 1 ? "question" : "questions"} left today · `}
            Please don&apos;t share PAN, Aadhaar or bank details.
          </p>
        </form>
      </div>
    </div>
  );
}

function Answer({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  const citations = message.citations ?? [];
  return (
    <article className="flex flex-col gap-5">
      <div className="answer-text text-[17px] leading-[1.7]">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {message.content}
        </ReactMarkdown>
      </div>
      {(message.outcome === "NO_EVIDENCE" ||
        message.outcome === "UNSUPPORTED") && (
        <p className="text-sm text-ink-soft">
          This question did not count toward your daily limit.
        </p>
      )}
      {!!citations.length && (
        <div className="flex flex-col gap-2">
          <p className="label-mono text-ink-soft">
            {citations.length === 1 ? "Source" : "Sources"}
          </p>
          {citations.map((c) => (
            <a
              key={c.id}
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-wrap items-center gap-x-4 gap-y-1 border border-ink bg-paper px-4 py-3.5 no-underline hover:bg-shade"
            >
              <span className="border border-ink px-2 font-mono font-semibold">
                {c.id}
              </span>
              <span className="min-w-0 flex-[1_1_16rem]">
                <span className="font-semibold">{c.title}</span>
                {c.anchor && (
                  <span className="text-ink-soft"> · {c.anchor}</span>
                )}
              </span>
              <span className="text-[15px]">
                Open the original <span aria-hidden="true">↗</span>
              </span>
            </a>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(
            message.content +
              citations.map((c) => `\n[${c.id}] ${c.title}: ${c.url}`).join(""),
          );
          setCopied(true);
        }}
        className="self-start cursor-pointer text-sm text-ink-soft underline"
      >
        {copied ? "Copied" : "Copy answer and sources"}
      </button>
    </article>
  );
}

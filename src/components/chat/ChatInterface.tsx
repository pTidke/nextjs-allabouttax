"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import CoverageNotice from "./CoverageNotice";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Send,
  Sparkles,
  X,
  Copy,
  Check,
  Trash2,
  ExternalLink,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useChat } from "./ChatContext";

export default function ChatInterface({ trigger }: { trigger: ReactNode }) {
  const {
    status,
    messages,
    input,
    setInput,
    isOpen,
    setIsOpen,
    period,
    changePeriod,
    suggestions,
    handleSubmit,
    clearChat,
    error,
  } = useChat();
  const [copied, setCopied] = useState<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const busy = status === "in_progress";
  useEffect(() => {
    scroll.current?.scrollTo({
      top: scroll.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy, isOpen]);
  const years = Array.from(
    { length: 5 },
    (_, i) => new Date().getFullYear() - 3 + i,
  );
  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        aria-describedby="tax-chat-description"
        className="[&>button]:hidden w-full h-[100dvh] md:max-w-[100dvw] p-0 border-none bg-white flex flex-col rounded-none"
      >
        <DialogDescription id="tax-chat-description" className="sr-only">
          Ask income-tax questions using reviewed official evidence for your
          selected period.
        </DialogDescription>
        <header className="flex items-center justify-between p-4 md:px-8 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <Sparkles className="text-emerald-600" />
            <div>
              <DialogTitle>Indian Tax Assistant</DialogTitle>
              <p className="text-xs text-slate-500 mt-1">
                Answers from reviewed official sources · early access
              </p>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <Link
              href="/chats"
              onClick={() => setIsOpen(false)}
              className="text-xs underline mr-2"
            >
              Your conversations
            </Link>
            <button
              aria-label="Start a new chat"
              onClick={clearChat}
              className="p-2 hover:bg-slate-100 rounded-lg"
            >
              <Trash2 size={18} />
            </button>
            <button
              aria-label="Close chat"
              onClick={() => setIsOpen(false)}
              className="p-2 hover:bg-slate-100 rounded-lg"
            >
              <X size={20} />
            </button>
          </div>
        </header>
        <div className="px-4 md:px-8 py-3 bg-slate-50 flex flex-wrap items-center gap-3">
          <label htmlFor="tax-period" className="text-sm font-medium">
            Tax period
          </label>
          <select
            id="tax-period"
            value={period}
            onChange={(e) => changePeriod(e.target.value)}
            className="border rounded-lg px-3 py-2 bg-white text-sm"
          >
            <option value="">Choose FY, AY, or Tax Year</option>
            {["FY", "AY", "TY"].map((kind) => (
              <optgroup
                key={kind}
                label={
                  kind === "FY"
                    ? "Financial year"
                    : kind === "AY"
                      ? "Assessment year"
                      : "Tax year"
                }
              >
                {years.map((year) => {
                  const value = `${kind} ${year}-${String((year + 1) % 100).padStart(2, "0")}`;
                  return (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
          <span className="text-xs text-slate-500">
            Changing the period starts a new chat. Coverage depends on approved
            sources.
          </span>
        </div>
        <CoverageNotice period={period} />
        <div ref={scroll} className="flex-1 overflow-y-auto px-4 py-6 md:p-8">
          <div className="max-w-3xl mx-auto space-y-5">
            {error && (
              <p
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
              >
                {error}
              </p>
            )}
            {!messages.length && (
              <div className="py-12 text-center">
                <Sparkles className="mx-auto text-emerald-600 mb-4" size={36} />
                <h2 className="text-2xl font-semibold mb-3">
                  Ask with the right tax period in view.
                </h2>
                <p className="text-slate-500 max-w-md mx-auto">
                  I can explain material in our reviewed income-tax library and
                  show the official sources. Questions without enough evidence
                  will be flagged.
                </p>
                <p className="text-xs text-slate-400 mt-5">
                  Document uploads, tax calculations, and draft returns are not
                  available in this release.
                </p>
              </div>
            )}
            {messages.map((message) => (
              <article
                key={message.id}
                className={`rounded-2xl p-5 ${message.role === "user" ? "bg-emerald-50 ml-8" : "border border-slate-200 bg-white"}`}
              >
                <p className="text-xs uppercase tracking-wide text-slate-500 mb-3">
                  {message.role === "user" ? "You" : "Tax assistant"}
                </p>
                <div className="prose prose-sm max-w-none whitespace-pre-wrap">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {message.content}
                  </ReactMarkdown>
                </div>
                {!!message.citations?.length && (
                  <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                    <p className="text-xs font-semibold text-slate-600">
                      Official evidence
                    </p>
                    {message.citations.map((citation) => (
                      <a
                        key={citation.id}
                        href={citation.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block rounded-lg bg-slate-50 p-3 hover:bg-emerald-50"
                      >
                        <span className="text-sm text-emerald-800 font-medium">
                          [{citation.id}] {citation.title}{" "}
                          <ExternalLink size={12} className="inline" />
                        </span>
                        <span className="block text-xs text-slate-500 mt-1">
                          {citation.anchor} · {citation.period} · checked{" "}
                          {new Date(citation.checkedAt).toLocaleString(
                            "en-IN",
                            { timeZone: "Asia/Kolkata" },
                          )}{" "}
                          IST
                        </span>
                      </a>
                    ))}
                    <p className="text-[10px] text-slate-400">
                      Knowledge release: {message.releaseId}
                    </p>
                  </div>
                )}
                {message.role === "assistant" && (
                  <button
                    className="mt-3 text-xs text-slate-500 flex gap-1 items-center"
                    onClick={async () => {
                      await navigator.clipboard.writeText(
                        message.content +
                          (message.citations ?? [])
                            .map((c) => `\n[${c.id}] ${c.title}: ${c.url}`)
                            .join(""),
                      );
                      setCopied(message.id);
                    }}
                  >
                    {copied === message.id ? (
                      <Check size={13} />
                    ) : (
                      <Copy size={13} />
                    )}{" "}
                    Copy answer and sources
                  </button>
                )}
              </article>
            ))}
            {busy && (
              <p
                role="status"
                className="text-sm text-emerald-700 animate-pulse"
              >
                Checking approved sources and preparing a cited answer…
              </p>
            )}
            {!busy && (
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => setInput(s)}
                    className="text-xs border rounded-full px-3 py-2 hover:bg-emerald-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <form onSubmit={handleSubmit} className="border-t p-4 md:p-6">
          <div className="max-w-3xl mx-auto">
            <div className="flex gap-3">
              <textarea
                aria-label="Your tax question"
                value={input}
                maxLength={6000}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask an income-tax question…"
                rows={2}
                className="flex-1 resize-none rounded-2xl border border-slate-200 p-3 focus:outline-emerald-500"
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
              />
              <button
                aria-label="Send question"
                type="submit"
                disabled={busy || !input.trim() || !period}
                className="self-end rounded-full p-3 bg-emerald-600 text-white disabled:opacity-40"
              >
                <Send size={20} />
              </button>
            </div>
            <p className="text-center text-[11px] text-slate-400 mt-3">
              Check the cited sources before acting. New chat clears this view;
              it does not delete server records.
            </p>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

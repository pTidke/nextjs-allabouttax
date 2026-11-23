"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useChat } from "@/components/chat/ChatContext";

type Entry = {
  id: string;
  period: string;
  createdAt: string;
  _count: { messages: number };
};
export default function HistoryPanel() {
  const [rows, setRows] = useState<Entry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const { openConversation, clearChat } = useChat();
  const router = useRouter();
  const load = useCallback(async (before?: string, signal?: AbortSignal) => {
    const response = await fetch(
      `/api/conversations${before ? `?before=${encodeURIComponent(before)}` : ""}`,
      { cache: "no-store", signal },
    );
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    setRows((old) =>
      before ? [...old, ...body.conversations] : body.conversations,
    );
    setNext(body.nextBefore);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/conversations", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        return body;
      })
      .then((body) => {
        if (!controller.signal.aborted) {
          setRows(body.conversations);
          setNext(body.nextBefore);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [load]);
  async function remove(id: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/conversations/${id}`, {
        method: "DELETE",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      clearChat();
      setToDelete(null);
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not delete conversation.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 pb-24 pt-16">
      <header className="flex flex-wrap items-end gap-4 border-b-[3px] border-double border-ink pb-6">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h1 className="font-serif text-4xl font-bold">Your chats</h1>
          <p className="text-ink-soft">
            Open a chat to carry on, download it with its sources, or delete it
            for good.
          </p>
        </div>
        <Link
          href="/ask"
          onClick={clearChat}
          className="flex min-h-11 items-center bg-ink px-5 text-paper no-underline hover:bg-brand-strong"
        >
          + New chat
        </Link>
      </header>
      {error && (
        <p role="alert" className="border-2 border-ink bg-paper px-5 py-4">
          {error}
        </p>
      )}
      {busy && (
        <p role="status" className="label-mono text-ink-soft">
          Loading…
        </p>
      )}
      {!busy && !rows.length && !error && (
        <p className="border border-dashed border-ink bg-paper px-5 py-6 text-ink-soft">
          No chats yet. <Link href="/ask">Ask your first question →</Link>
        </p>
      )}
      <ul className="flex flex-col">
        {rows.map((row) => (
          <li key={row.id} className="border-b border-rule py-5">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void openConversation(row.id);
                  router.push("/ask");
                }}
                className="flex min-w-0 flex-[1_1_16rem] cursor-pointer flex-col text-left"
              >
                <span className="font-semibold underline">
                  {new Date(row.createdAt).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                  {row.period === "AUTO" ? "" : ` · ${row.period}`}
                </span>
                <span className="text-[15px] text-ink-soft">
                  {row._count.messages}{" "}
                  {row._count.messages === 1 ? "message" : "messages"}
                </span>
              </button>
              <a
                href={`/api/conversations/${row.id}/export`}
                className="text-[15px]"
              >
                Download
              </a>
              <button
                type="button"
                disabled={busy}
                onClick={() => setToDelete(row.id)}
                className="cursor-pointer text-[15px] text-[#b3261e] underline"
              >
                Delete
              </button>
            </div>
            {toDelete === row.id && (
              <div className="mt-4 flex flex-col gap-3 border-2 border-ink bg-paper p-5">
                <p>
                  This deletes the chat and its messages from our database for
                  good.
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void remove(row.id)}
                    className="min-h-11 cursor-pointer bg-[#b3261e] px-5 font-semibold text-paper"
                  >
                    Delete for good
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setToDelete(null)}
                    className="min-h-11 cursor-pointer border border-ink px-5"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {next && (
        <button
          type="button"
          disabled={busy}
          className="min-h-11 cursor-pointer self-start border border-ink px-5"
          onClick={() => {
            setBusy(true);
            void load(next)
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          Show older chats
        </button>
      )}
    </main>
  );
}

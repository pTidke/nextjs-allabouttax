"use client";
import { useCallback, useEffect, useState } from "react";
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
    <main className="max-w-4xl mx-auto px-6 py-12 space-y-6">
      <h1 className="text-3xl font-semibold">Your conversations</h1>
      <p className="text-slate-600">
        Open a saved conversation to continue, download its messages and
        citations, or permanently delete it. Starting a new chat clears the chat
        window; it does not delete saved messages.
      </p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {busy && <p role="status">Updating conversations…</p>}
      {!busy && !rows.length && <p>No saved conversations yet.</p>}
      {rows.map((row) => (
        <article key={row.id} className="border rounded-xl p-5 space-y-3">
          <h2 className="font-semibold">
            {row.period} · {new Date(row.createdAt).toLocaleDateString()}
          </h2>
          <p className="text-sm text-slate-500">
            {row._count.messages} messages
          </p>
          <div className="flex flex-wrap gap-5 text-sm">
            <button
              disabled={busy}
              onClick={() => void openConversation(row.id)}
              className="text-emerald-700 underline"
            >
              Open conversation
            </button>
            <a
              href={`/api/conversations/${row.id}/export`}
              className="underline"
            >
              Download JSON with citations
            </a>
            <button
              disabled={busy}
              onClick={() => setToDelete(row.id)}
              className="text-red-700 underline"
            >
              Delete
            </button>
          </div>
          {toDelete === row.id && (
            <div className="bg-red-50 rounded-lg p-4 space-y-3">
              <p>
                This permanently deletes this conversation and its messages from
                the app database. Provider or backup retention is separate.
              </p>
              <button
                disabled={busy}
                onClick={() => void remove(row.id)}
                className="rounded-lg px-4 py-2 bg-red-700 text-white mr-4"
              >
                Permanently delete
              </button>
              <button disabled={busy} onClick={() => setToDelete(null)}>
                Cancel
              </button>
            </div>
          )}
        </article>
      ))}
      {next && (
        <button
          disabled={busy}
          className="underline"
          onClick={() => {
            setBusy(true);
            void load(next)
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          Load older conversations
        </button>
      )}
    </main>
  );
}

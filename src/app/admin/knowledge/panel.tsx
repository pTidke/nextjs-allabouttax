"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type State = {
  nextRetryAt: string | null;
  worker: { heartbeatAt: string; mode: string } | null;
  failedDocuments: {
    id: string;
    title: string;
    url: string;
    lastError: string;
  }[];
  jobCounts: Record<string, number>;
  discoveryStartYear: number;
  sources: {
    id: string;
    name: string;
    url: string;
    kind: string;
    activeJobs: number;
    checkedAt: string | null;
    lastError: string | null;
  }[];
  jobs: {
    id: string;
    sourceId: string;
    status: string;
    attempts: number;
    error: string | null;
    result: string | null;
    documentTitle: string | null;
  }[];
  release: { id: string; createdAt: string; versionIds: string[] } | null;
};
export default function KnowledgeAdmin() {
  const [state, setState] = useState<State | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const response = await fetch("/api/admin/knowledge", {
      cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    setState(body);
    setLoadedAt(new Date().toLocaleTimeString());
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/knowledge", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        if (!controller.signal.aborted) setState(body);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setMessage(error.message);
      });
    return () => controller.abort();
  }, []);
  async function refreshStatus() {
    setReloading(true);
    setBusy(true);
    setMessage("");
    try {
      await reload();
      setMessage("Status updated. No new downloads were requested.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not update status.",
      );
    } finally {
      setReloading(false);
      setBusy(false);
    }
  }
  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage(
        body.action === "refresh"
          ? `${result.queued} new source checks queued. ${result.active} already queued or running. ${result.recent} checked/requested recently (five-minute cooldown). Use Reload status to see progress.`
          : body.action === "add"
            ? "Fetch requested. The worker will process it."
            : "Saved.",
      );
      await reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  const button =
    "min-h-10 cursor-pointer bg-ink px-4 text-sm text-paper hover:bg-brand-strong disabled:opacity-40";
  const field = "min-h-10 border border-ink bg-paper p-2 text-sm";
  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 px-6 pb-20 pt-10">
      <div>
        <p className="label-mono text-brand">Administration</p>
        <h1 className="mt-2 font-serif text-4xl font-bold">
          Official tax knowledge
        </h1>
        <p className="text-ink-soft mt-3">
          Fetch, inspect, and publish a reviewed source version. Only approved,
          fresh material is available to chat.
        </p>
      </div>
      {message && (
        <p
          role="status"
          className="border border-amber-700 bg-amber-50 p-4 text-sm"
        >
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={button}
          disabled={busy}
          onClick={() => act({ action: "initialize" })}
        >
          Register starter sources
        </button>
        <button
          type="button"
          className={button}
          disabled={
            busy || !!state?.sources.some((source) => source.activeJobs > 0)
          }
          onClick={() => act({ action: "refresh" })}
        >
          Refresh all sources
        </button>
        <button
          type="button"
          className={button}
          disabled={busy}
          onClick={() => void refreshStatus()}
        >
          {reloading ? "Updating status…" : "Reload status"}
        </button>
        <span role="status" className="self-center text-sm text-ink-soft">
          {loadedAt
            ? `Status loaded at ${loadedAt}`
            : "Reload status checks progress without requesting downloads."}
        </span>
      </div>
      <p className="text-sm text-ink-soft">
        Current release: {state?.release?.id ?? "None published"} ·{" "}
        {state?.release?.versionIds.length ?? 0} approved documents. Refreshes
        require the background worker; registering a source does not approve it.
      </p>
      <section className="space-y-2 border border-ink bg-paper p-4 text-sm">
        <p>
          Worker:{" "}
          {state?.worker
            ? `${state.worker.mode} · last seen ${new Date(state.worker.heartbeatAt).toLocaleString()}`
            : "Not started"}
          .
        </p>
        <p>
          {state?.jobCounts.QUEUED ?? 0} queued ·{" "}
          {state?.jobCounts.RUNNING ?? 0} running ·{" "}
          {state?.jobCounts.FAILED ?? 0} failed jobs.
        </p>
        {state?.nextRetryAt && (
          <p>
            Some failed downloads are waiting for their next retry, starting{" "}
            {new Date(state.nextRetryAt).toLocaleString()}.
          </p>
        )}
        <p>
          CBDT discovery covers documents issued from{" "}
          {state?.discoveryStartYear ?? "the configured year"}. Older documents
          need to be added separately. Issue year does not determine the
          applicable tax period.
        </p>
      </section>
      <form
        className="flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          void act({ action: "add", url: form.get("url") });
        }}
      >
        <input
          name="url"
          type="url"
          required
          aria-label="Official document URL"
          placeholder="https://www.incometax.gov.in/…"
          className={`${field} flex-1 min-w-64`}
        />
        <button type="submit" className={button} disabled={busy}>
          Fetch official document
        </button>
      </form>
      <section>
        <h2 className="mb-4 font-serif text-2xl font-bold">Source health</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {state?.sources.map((s) => (
            <div key={s.id} className="border border-ink bg-paper p-4">
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-brand underline"
              >
                {s.name}
              </a>
              <p className="text-xs text-ink-soft mt-2">
                {s.kind} · Last successful check:{" "}
                {s.checkedAt ? new Date(s.checkedAt).toLocaleString() : "Never"}
              </p>
              {s.lastError && (
                <p className="text-sm text-red-700 mt-2">{s.lastError}</p>
              )}
              <button
                type="button"
                disabled={busy || s.activeJobs > 0}
                onClick={() => act({ action: "refresh", sourceId: s.id })}
                className="mt-3 text-sm underline"
              >
                {s.activeJobs
                  ? `${s.activeJobs} checks queued/running`
                  : "Refresh source"}
              </button>
            </div>
          ))}
        </div>
      </section>
      {!!state?.failedDocuments.length && (
        <section>
          <h2 className="mb-4 font-serif text-2xl font-bold">
            Documents needing attention
          </h2>
          <p className="text-sm text-ink-soft mb-3">
            These documents are unavailable to chat. Scanned PDFs may need OCR
            before review.
          </p>
          {state.failedDocuments.map((document) => (
            <div
              key={document.id}
              className="mb-2 border border-rule bg-paper p-3 text-sm"
            >
              <a
                href={document.url}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {document.title}
              </a>
              <p className="text-red-700 mt-1">{document.lastError}</p>
            </div>
          ))}
        </section>
      )}
      <section className="space-y-2 border-2 border-ink bg-paper p-5">
        <h2 className="font-serif text-2xl font-bold">Document review</h2>
        <p className="text-sm text-ink-soft">
          Checking extracted text and tax review now happen in the Review
          workspace, together with uploaded documents.
        </p>
        <Link href="/review" className="underline text-brand">
          Open the Review workspace
        </Link>
      </section>
      <section>
        <h2 className="mb-4 font-serif text-2xl font-bold">
          Recent refresh jobs
        </h2>
        <p className="text-sm text-ink-soft mb-3">
          Waiting means the download has not started. Retry scheduled means a
          fetch failed and will be retried when the worker runs. These jobs do
          not approve documents. During local setup, run{" "}
          <code>npm run tax:worker -- run</code> in a separate project terminal.
          Keep it running for daily discovery, Sunday reconciliation, and manual
          requests. Automatic updates require this worker or a deployed
          scheduler.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-ink">
                <th className="p-2">Source</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {state?.jobs.map((j) => (
                <tr key={j.id} className="border-b border-rule">
                  <td className="p-2">{j.documentTitle || j.sourceId}</td>
                  <td>
                    {j.status === "QUEUED"
                      ? j.attempts
                        ? "Retry scheduled"
                        : "Waiting for worker"
                      : j.status}
                  </td>
                  <td>{j.attempts}</td>
                  <td className={j.error ? "text-red-700" : "text-ink-soft"}>
                    {j.error || j.result}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

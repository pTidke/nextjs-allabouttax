"use client";
import { useCallback, useEffect, useState } from "react";
import ReviewCard, { type PendingReview } from "./review-card";

type State = {
  reviewPage: number;
  nextRetryAt: string | null;
  hasMoreReviews: boolean;
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
  pending: PendingReview[];
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
  const reload = useCallback(async (page = 0) => {
    const response = await fetch(`/api/admin/knowledge?reviewPage=${page}`, {
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
      await reload(state?.reviewPage ?? 0);
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
            : body.action === "approve"
              ? `Selected sections published. ${body.periodMode === "MULTI_PERIOD" ? "Choose a period within the reviewed effective dates." : `In chat, choose ${body.period}.`} Ask a question addressed by the approved sections.`
              : body.action === "saveDraft"
                ? "Draft saved. It remains outside chat until approved."
                : "Saved.",
      );
      await reload(body.action === "saveDraft" ? (state?.reviewPage ?? 0) : 0);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  const button =
    "rounded-lg bg-slate-900 text-white px-4 py-2 text-sm disabled:opacity-40";
  const field = "border border-slate-300 rounded-lg p-2 text-sm";
  return (
    <main className="max-w-6xl mx-auto px-6 pt-28 pb-16 space-y-8">
      <div>
        <p className="text-xs uppercase tracking-widest text-emerald-700">
          Administration
        </p>
        <h1 className="text-3xl font-semibold mt-2">Official tax knowledge</h1>
        <p className="text-slate-500 mt-3">
          Fetch, inspect, and publish a reviewed source version. Only approved,
          fresh material is available to chat.
        </p>
      </div>
      {message && (
        <p
          role="status"
          className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm"
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
        <span role="status" className="self-center text-sm text-slate-500">
          {loadedAt
            ? `Status loaded at ${loadedAt}`
            : "Reload status checks progress without requesting downloads."}
        </span>
      </div>
      <p className="text-sm text-slate-500">
        Current release: {state?.release?.id ?? "None published"} ·{" "}
        {state?.release?.versionIds.length ?? 0} approved documents. Refreshes
        require the background worker; registering a source does not approve it.
      </p>
      <section className="border rounded-xl p-4 text-sm space-y-2">
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
        <h2 className="text-xl font-semibold mb-4">Source health</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {state?.sources.map((s) => (
            <div key={s.id} className="border rounded-xl p-4">
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-emerald-700 underline"
              >
                {s.name}
              </a>
              <p className="text-xs text-slate-500 mt-2">
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
          <h2 className="text-xl font-semibold mb-4">
            Documents needing attention
          </h2>
          <p className="text-sm text-slate-500 mb-3">
            These documents are unavailable to chat. Scanned PDFs may need OCR
            before review.
          </p>
          {state.failedDocuments.map((document) => (
            <div
              key={document.id}
              className="border rounded-lg p-3 mb-2 text-sm"
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
      <section>
        <h2 className="text-xl font-semibold mb-4">Awaiting tax review</h2>
        <p className="text-sm text-slate-500 mb-4">
          Select the sections you have reviewed, then specify one tax period or
          coverage across periods. Draft suggestions fill known details for you
          to check; they do not publish anything until you approve.
        </p>
        <div className="flex items-center gap-4 mb-4 text-sm">
          <button
            type="button"
            className={button}
            disabled={busy || !state?.reviewPage}
            onClick={() => {
              setBusy(true);
              void reload((state?.reviewPage ?? 0) - 1)
                .catch((e) => setMessage(e.message))
                .finally(() => setBusy(false));
            }}
          >
            Previous page
          </button>
          <span>Review page {(state?.reviewPage ?? 0) + 1}</span>
          <button
            type="button"
            className={button}
            disabled={busy || !state?.hasMoreReviews}
            onClick={() => {
              setBusy(true);
              void reload((state?.reviewPage ?? 0) + 1)
                .catch((e) => setMessage(e.message))
                .finally(() => setBusy(false));
            }}
          >
            Next page
          </button>
        </div>
        {!state?.pending.length && (
          <p className="text-slate-500">No pending documents.</p>
        )}
        <div className="space-y-5">
          {state?.pending.map((version) => (
            <ReviewCard
              key={`${version.id}:${version.draft?.revision ?? 0}`}
              version={version}
              busy={busy}
              act={act}
            />
          ))}
        </div>
      </section>
      <section>
        <h2 className="text-xl font-semibold mb-4">Recent refresh jobs</h2>
        <p className="text-sm text-slate-500 mb-3">
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
              <tr className="border-b">
                <th className="p-2">Source</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {state?.jobs.map((j) => (
                <tr key={j.id} className="border-b">
                  <td className="p-2">{j.documentTitle || j.sourceId}</td>
                  <td>
                    {j.status === "QUEUED"
                      ? j.attempts
                        ? "Retry scheduled"
                        : "Waiting for worker"
                      : j.status}
                  </td>
                  <td>{j.attempts}</td>
                  <td className={j.error ? "text-red-700" : "text-slate-600"}>
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

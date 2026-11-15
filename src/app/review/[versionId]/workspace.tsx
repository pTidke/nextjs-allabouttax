"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import TaxReviewForm, {
  type PendingReview,
} from "@/components/review/TaxReviewForm";
import LineReviewer from "@/components/review/LineReviewer";
import PageViewer from "@/components/review/PageViewer";
import type { QueueEntry } from "@/lib/review/line-reviews";
import type { DocumentFact } from "@/lib/review/document-facts";

type Check = {
  id: string;
  decision: string;
  note: string;
  createdAt: string;
  reviewer: string;
};
type Version = Omit<PendingReview, "document" | "draft" | "suggestion"> & {
  status: string;
  current: boolean;
  isPdf: boolean;
  fetchedAt: string;
  reviewNote: string | null;
  document: {
    title: string;
    url: string;
    issuedAt: string | null;
    lastError: string | null;
    uploaded: boolean;
    sourceName: string;
  };
  chunks: {
    id: string;
    anchor: string;
    text: string;
    page: number | null;
    headings: string[];
    incomeYears: string[];
  }[];
  draft: PendingReview["draft"];
  suggestion: PendingReview["suggestion"];
  textChecks: Check[];
};

const pageOf = (anchor: string) =>
  Number(anchor.match(/^Page (\d+)/)?.[1] ?? 1);

export type EngineOverview =
  | {
      status: "OK";
      engine: string;
      createdAt: string;
      summary: Record<string, number>;
      pages: {
        number: number;
        width: number;
        height: number;
        rotation: number;
        kind: string;
      }[];
      runId: string;
      queue: QueueEntry[];
      attentionTotal: number;
      sampleSize: number;
      facts: DocumentFact[];
      progress: {
        required: number;
        decided: number;
        undecided: number;
        unreadable: number;
        complete: boolean;
      };
    }
  | {
      status: "FAILED";
      engine: string;
      createdAt: string;
      error: string | null;
    };

export type CarriedHistory = {
  officialUrl: string;
  lineage: string[];
  revisions: {
    candidate: string;
    action: string;
    at: string;
    findings: Record<string, number>;
    issues: number;
    note: string | null;
  }[];
  taxReviews: {
    decision: string;
    at: string;
    fields: Record<string, unknown>;
  }[];
};
type CarriedOver = {
  candidateId: string;
  title: string;
  headAction: string | null;
  history: CarriedHistory;
  lineDecisions: number;
  textAccepted: boolean;
  taxDrafts: number;
  createdAt: string;
};

export default function Workspace({
  access,
  carriedOver,
  changedSinceAcceptance,
  engine,
  version,
}: {
  access: { extraction: boolean; tax: boolean };
  carriedOver: CarriedOver[];
  // Line decisions made after the text was last accepted.
  changedSinceAcceptance: number;
  engine: EngineOverview | null;
  version: Version;
}) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const [problem, setProblem] = useState("");
  const [note, setNote] = useState("");
  const latest = version.textChecks[0];
  const textAccepted = latest?.decision === "ACCEPTED";
  // Accepted, and nothing checked since: the passages include every decision.
  const textCurrent = textAccepted && !changedSinceAcceptance;
  const open = version.current && version.status === "PENDING";
  const linesReady = engine?.status !== "OK" || engine.progress.complete;
  const canAcceptText = version.chunks.length > 0 || engine?.status === "OK";

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/review/${version.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "That did not work.");
      if (body.action === "approve" || body.action === "reject") {
        router.push(`/review?filter=tax`);
        router.refresh();
        return;
      }
      setMessage({
        text:
          body.action === "saveDraft"
            ? "Draft saved. Nothing is published until you approve."
            : body.decision === "ACCEPTED"
              ? "Text check recorded. The document is ready for tax review."
              : "Problems recorded. The document stays out of tax review until the text is accepted.",
      });
      setProblem("");
      setNote("");
      router.refresh();
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "That did not work.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{version.document.title}</h1>
        <p className="text-sm text-slate-500">
          {version.document.uploaded
            ? "Uploaded copy"
            : version.document.sourceName}
          {version.document.issuedAt &&
            ` · issued ${version.document.issuedAt.slice(0, 10)}`}
          {" · "}
          <a
            href={version.document.url}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Official source
          </a>
        </p>
        {!open && (
          <p className="rounded-lg bg-slate-100 p-3 text-sm">
            {version.current
              ? `This version has been ${version.status === "APPROVED" ? "approved" : "rejected"}.`
              : "A newer version of this document exists. This one is kept for the record only."}
            {version.reviewNote && ` ${version.reviewNote}`}
          </p>
        )}
        {/* An upload's "needs OCR" note is out of date once the engine has read it. */}
        {version.document.lastError &&
          !(engine?.status === "OK" && version.document.uploaded) && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              {version.document.lastError}
            </p>
          )}
        {message && (
          <p
            role={message.error ? "alert" : "status"}
            className={`rounded-lg p-3 text-sm ${message.error ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-900"}`}
          >
            {message.text}
          </p>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <section className="lg:sticky lg:top-20 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <h2 className="font-semibold">Original</h2>
            <a
              href={`/api/review/${version.id}/original`}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Open in a new tab
            </a>
          </div>
          {version.isPdf && engine?.status === "OK" ? (
            <LineReviewer
              key={engine.runId}
              src={`/api/review/${version.id}/original`}
              linesUrl={`/api/review/${version.id}/lines`}
              pages={engine.pages}
              runId={engine.runId}
              lines={engine.queue}
              canDecide={open && access.extraction}
              versionId={version.id}
              onChanged={() => router.refresh()}
            />
          ) : version.isPdf ? (
            <PageViewer
              src={`/api/review/${version.id}/original`}
              linesUrl={null}
              pages={null}
              page={page}
              onPage={setPage}
              current={null}
              onSelect={() => {}}
            />
          ) : (
            <p className="border rounded-xl p-4 text-sm text-slate-600">
              The original is a web page. Compare the passages with the{" "}
              <a
                href={version.document.url}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                official page
              </a>
              .
            </p>
          )}
        </section>

        <section className="space-y-6">
          <EngineSummary engine={engine} isPdf={version.isPdf} />

          <div className="space-y-2">
            <h2 className="font-semibold">
              Passages the chatbot will use ({version.chunks.length})
            </h2>
            {version.isPdf && (
              <p className="text-xs text-slate-500">
                When the text is accepted, these are rebuilt from the checked
                lines, with your corrections.
              </p>
            )}
            {!version.chunks.length && (
              <p className="text-sm text-slate-500">
                {engine?.status === "OK"
                  ? "This file has no text layer; the engine read it with OCR. The passages are made from the checked lines when the text is accepted."
                  : "No text could be read from this file. The extraction engine reads it with OCR on its next run, within two hours."}
              </p>
            )}
            <ol className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
              {version.chunks.map((chunk) => (
                <li
                  key={chunk.id}
                  className="border rounded-lg p-3 text-sm space-y-1"
                >
                  <button
                    type="button"
                    disabled={!version.isPdf || engine?.status === "OK"}
                    onClick={() => setPage(pageOf(chunk.anchor))}
                    className="text-xs text-emerald-800 underline disabled:no-underline disabled:text-slate-500"
                  >
                    {chunk.anchor}
                  </button>
                  {(!!chunk.headings.length || !!chunk.incomeYears.length) && (
                    <p className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
                      {chunk.headings.join(" › ")}
                      {chunk.incomeYears.map((year) => (
                        <span
                          key={year}
                          className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-800"
                        >
                          {year}
                        </span>
                      ))}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap">{chunk.text}</p>
                </li>
              ))}
            </ol>
          </div>

          <div
            id="text-check"
            className="border rounded-xl p-4 space-y-3 scroll-mt-20"
          >
            <h2 className="font-semibold">1. Text check</h2>
            <p className="text-sm text-slate-600">
              Does the extracted text match the original? Look closely at dates,
              amounts, section numbers and words like &ldquo;not&rdquo;.
            </p>
            {latest ? (
              <p
                className={`text-sm ${textAccepted ? "text-emerald-800" : "text-red-800"}`}
              >
                {textAccepted ? "Accepted" : "Problems reported"} by{" "}
                {latest.reviewer} on{" "}
                {new Date(latest.createdAt).toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata",
                })}
                {latest.note && `: ${latest.note}`}
              </p>
            ) : (
              <p className="text-sm text-slate-500">Not checked yet.</p>
            )}
            {open && access.extraction ? (
              <div className="space-y-3">
                {textAccepted && !textCurrent && (
                  <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
                    {changedSinceAcceptance} line
                    {changedSinceAcceptance === 1 ? " was" : "s were"} checked
                    after the text was accepted. Accept it again, so the
                    chatbot&rsquo;s passages include{" "}
                    {changedSinceAcceptance === 1 ? "it" : "them"}; tax review
                    waits until then.
                  </p>
                )}
                {!textCurrent && engine?.status === "OK" && !linesReady && (
                  <p className="text-sm text-amber-800">
                    {engine.progress.unreadable
                      ? `${engine.progress.unreadable} line(s) are marked unreadable. Report the problem below instead of accepting.`
                      : `Decide the ${engine.progress.undecided} remaining line(s) beside the original before accepting.`}
                  </p>
                )}
                {!textCurrent && (
                  <>
                    <label className="block text-sm">
                      Note (optional when the text matches)
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        maxLength={4000}
                        rows={2}
                        className="block w-full border rounded-lg p-2 mt-1"
                      />
                    </label>
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        disabled={busy || !canAcceptText || !linesReady}
                        onClick={() =>
                          void act({
                            action: "textCheck",
                            decision: "ACCEPTED",
                            note,
                          })
                        }
                        className="rounded-lg bg-emerald-700 text-white px-4 py-2 text-sm disabled:opacity-40"
                      >
                        {textAccepted
                          ? "Accept the text again"
                          : "Text matches the original"}
                      </button>
                    </div>
                  </>
                )}
                <label className="block text-sm">
                  {textAccepted
                    ? "Found a problem after all? Describe it"
                    : "Or describe what does not match"}
                  <textarea
                    value={problem}
                    onChange={(e) => setProblem(e.target.value)}
                    maxLength={4000}
                    rows={2}
                    placeholder="For example: page 2, the date reads 31* March instead of 31st March."
                    className="block w-full border rounded-lg p-2 mt-1"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || !problem.trim()}
                  onClick={() =>
                    void act({
                      action: "textCheck",
                      decision: "NEEDS_CHANGES",
                      note: problem,
                    })
                  }
                  className="text-sm text-red-700 underline disabled:opacity-40"
                >
                  Report problems
                </button>
              </div>
            ) : (
              open && (
                <p className="text-xs text-slate-500">
                  You do not have text check access.
                </p>
              )
            )}
            <StagingHistory carriedOver={carriedOver} />
            {version.textChecks.length > 1 && (
              <details className="text-xs text-slate-500">
                <summary className="cursor-pointer">Earlier checks</summary>
                <ul className="mt-2 space-y-1">
                  {version.textChecks.slice(1).map((check) => (
                    <li key={check.id}>
                      {check.decision === "ACCEPTED" ? "Accepted" : "Problems"}{" "}
                      · {check.reviewer} ·{" "}
                      {new Date(check.createdAt).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                      })}
                      {check.note && ` · ${check.note}`}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <div className="space-y-3">
            <h2 className="font-semibold">2. Tax review</h2>
            {!open ? null : !access.tax ? (
              <p className="text-sm text-slate-500">
                A tax reviewer decides this part.
              </p>
            ) : !textCurrent ? (
              <p className="text-sm text-slate-500">
                {textAccepted
                  ? "Lines were checked after the text was accepted. Waiting for the text to be accepted again."
                  : "Waiting for the text check. You can do it above if you have text check access."}
              </p>
            ) : (
              <TaxReviewForm
                proposals={engine?.status === "OK" ? engine.facts : []}
                key={version.draft?.revision ?? 0}
                version={version}
                busy={busy}
                act={act}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function EngineSummary({
  engine,
  isPdf,
}: {
  engine: EngineOverview | null;
  isPdf: boolean;
}) {
  if (!isPdf) return null;
  if (!engine)
    return (
      <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
        The extraction engine has not read this document yet. It runs every two
        hours. Until then, check the passages below against the page.
      </p>
    );
  if (engine.status === "FAILED")
    return (
      <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
        The extraction engine could not read this document:{" "}
        {engine.error ?? "unknown error"}
      </p>
    );
  const s = engine.summary;
  const p = engine.progress;
  return (
    <div className="border rounded-xl p-4 space-y-1">
      <h2 className="font-semibold">Line check</h2>
      <p
        className={`text-sm ${p.complete ? "text-emerald-800" : "text-slate-700"}`}
      >
        {p.decided} of {p.required} lines decided
        {p.unreadable ? ` · ${p.unreadable} unreadable` : ""}
        {p.complete ? " · ready to accept below" : ""}
      </p>
      <p className="text-xs text-slate-500">
        Read by {engine.engine} on{" "}
        {new Date(engine.createdAt).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
        })}
        . {s.accepted ?? 0} of {s.lines ?? 0} lines passed every rule
        {s.excluded ? `; ${s.excluded} Hindi lines kept as evidence only` : ""}
        {s.tables ? `; ${s.tables} tables to check` : ""}
        {s.pages_scanned
          ? `; ${s.pages_scanned} scanned pages read by OCR`
          : ""}
        . You are asked about {engine.attentionTotal} line
        {engine.attentionTotal === 1 ? "" : "s"} the rules did not accept
        {engine.sampleSize
          ? ` and a fixed spot check of ${engine.sampleSize} they did`
          : ""}
        .
      </p>
    </div>
  );
}

const stagingAction: Record<string, string> = {
  SAVE_DRAFT: "Draft saved",
  ACCEPT_EXTRACTION: "Extraction accepted",
  REQUEST_CHANGES: "Changes requested",
};
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

// The review this document had in the old staging inbox, carried over (R3).
function StagingHistory({ carriedOver }: { carriedOver: CarriedOver[] }) {
  // One entry per staging document; the newest carry-over of each.
  const latest = carriedOver.filter(
    (c, i) =>
      carriedOver.findIndex((o) => o.candidateId === c.candidateId) === i,
  );
  if (!latest.length) return null;
  return (
    <details className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
      <summary className="cursor-pointer text-sm text-slate-700">
        Carried over from the staging review ({latest.length})
      </summary>
      <ul className="mt-2 space-y-3">
        {latest.map((c) => (
          <li key={c.candidateId} className="space-y-1">
            <p className="font-medium text-slate-700">{c.title}</p>
            <p>
              {c.lineDecisions} line decision
              {c.lineDecisions === 1 ? "" : "s"} carried over
              {c.textAccepted ? "; the extraction was accepted" : ""}
              {c.taxDrafts ? "; a tax-review draft was filled in" : ""} on{" "}
              {when(c.createdAt)}.
            </p>
            <ol className="space-y-0.5 border-l pl-2">
              {c.history.revisions.map((r, i) => (
                <li key={i}>
                  {stagingAction[r.action] ?? r.action} · {when(r.at)}
                  {Object.keys(r.findings).length
                    ? ` · ${Object.entries(r.findings)
                        .map(([state, n]) => `${n} ${state.replace("_", " ")}`)
                        .join(", ")}`
                    : ""}
                  {r.issues ? ` · ${r.issues} issue(s)` : ""}
                  {r.note && (
                    <span className="block text-slate-500">
                      &ldquo;{r.note}&rdquo;
                    </span>
                  )}
                </li>
              ))}
              {c.history.taxReviews.map((t, i) => (
                <li key={`t${i}`}>
                  Tax review{" "}
                  {t.decision === "ACCEPT"
                    ? "accepted"
                    : t.decision.toLowerCase()}{" "}
                  · {when(t.at)}
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </details>
  );
}

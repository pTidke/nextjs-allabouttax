"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import TaxReviewForm, {
  type PendingReview,
} from "@/components/review/TaxReviewForm";
import PageViewer from "@/components/review/PageViewer";
import type { LineForReview } from "@/lib/review/extraction-runs";
import type { ReviewLine } from "@/lib/review/line-reviews";

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
  chunks: { id: string; anchor: string; text: string }[];
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
      attention: ReviewLine[];
      attentionTotal: number;
      sample: ReviewLine[];
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

const readers: Record<string, string> = {
  native: "PDF text layer",
  "ocr:tesseract": "OCR",
  "ocr:easyocr": "Second OCR",
};

export default function Workspace({
  access,
  engine,
  version,
}: {
  access: { extraction: boolean; tax: boolean };
  engine: EngineOverview | null;
  version: Version;
}) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const focus = (line: LineForReview) => {
    setPage(line.page);
    setSelected(line.id);
  };
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const [problem, setProblem] = useState("");
  const [note, setNote] = useState("");
  const latest = version.textChecks[0];
  const textAccepted = latest?.decision === "ACCEPTED";
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
        {version.document.lastError && (
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
          {version.isPdf ? (
            <PageViewer
              src={`/api/review/${version.id}/original`}
              linesUrl={
                engine?.status === "OK"
                  ? `/api/review/${version.id}/lines`
                  : null
              }
              pages={engine?.status === "OK" ? engine.pages : null}
              page={page}
              onPage={(next) => {
                setPage(next);
                setSelected(null);
              }}
              selected={selected}
              onSelect={(line) => setSelected(line.id)}
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
          <EngineSummary
            engine={engine}
            isPdf={version.isPdf}
            selected={selected}
            onFocus={focus}
            canDecide={open && access.extraction}
            versionId={version.id}
            onChanged={() => router.refresh()}
          />

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
                No text could be read from this file. It needs OCR before it can
                be checked.
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
                    disabled={!version.isPdf}
                    onClick={() => setPage(pageOf(chunk.anchor))}
                    className="text-xs text-emerald-800 underline disabled:no-underline disabled:text-slate-500"
                  >
                    {chunk.anchor}
                  </button>
                  <p className="whitespace-pre-wrap">{chunk.text}</p>
                </li>
              ))}
            </ol>
          </div>

          <div className="border rounded-xl p-4 space-y-3">
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
                {!textAccepted && engine?.status === "OK" && !linesReady && (
                  <p className="text-sm text-amber-800">
                    {engine.progress.unreadable
                      ? `${engine.progress.unreadable} line(s) are marked unreadable. Report the problem below instead of accepting.`
                      : `Decide the ${engine.progress.undecided} remaining line(s) above before accepting.`}
                  </p>
                )}
                {!textAccepted && (
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
                        Text matches the original
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
            ) : !textAccepted ? (
              <p className="text-sm text-slate-500">
                Waiting for the text check. You can do it above if you have text
                check access.
              </p>
            ) : (
              <TaxReviewForm
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
  selected,
  onFocus,
  canDecide,
  versionId,
  onChanged,
}: {
  engine: EngineOverview | null;
  isPdf: boolean;
  selected: string | null;
  onFocus: (line: LineForReview) => void;
  canDecide: boolean;
  versionId: string;
  onChanged: () => void;
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
  const card = (line: ReviewLine) => (
    <LineCard
      key={line.id}
      line={line}
      runId={engine.runId}
      versionId={versionId}
      selected={line.id === selected}
      canDecide={canDecide}
      onFocus={onFocus}
      onChanged={onChanged}
    />
  );
  return (
    <div className="border rounded-xl p-4 space-y-4">
      <div className="space-y-1">
        <h2 className="font-semibold">Check the lines</h2>
        <p className="text-xs text-slate-500">
          Read by {engine.engine} on{" "}
          {new Date(engine.createdAt).toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata",
          })}
          . {s.accepted ?? 0} of {s.lines ?? 0} lines passed every rule
          {s.excluded
            ? `; ${s.excluded} Hindi lines kept as evidence only`
            : ""}
          {s.tables ? `; ${s.tables} tables to check` : ""}
          {s.pages_scanned
            ? `; ${s.pages_scanned} scanned pages read by OCR`
            : ""}
          .
        </p>
        <p
          className={`text-sm ${p.complete ? "text-emerald-800" : "text-slate-700"}`}
        >
          {p.decided} of {p.required} lines decided
          {p.unreadable ? ` · ${p.unreadable} unreadable` : ""}
          {p.complete ? " · ready to accept below" : ""}
        </p>
      </div>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">
          Lines that need a look ({engine.attentionTotal})
        </h3>
        {!engine.attentionTotal ? (
          <p className="text-sm text-emerald-800">
            Every line passed the engine&rsquo;s checks.
          </p>
        ) : (
          <ol className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
            {engine.attention.map(card)}
          </ol>
        )}
        {engine.attentionTotal > engine.attention.length && (
          <p className="text-xs text-slate-500">
            Showing the first {engine.attention.length}.
          </p>
        )}
      </section>
      {!!engine.sample.length && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">
            Spot check ({engine.sample.length} lines the engine accepted)
          </h3>
          <p className="text-xs text-slate-500">
            A fixed sample, so a mistake in the rules gets noticed.
          </p>
          <ol className="space-y-2">{engine.sample.map(card)}</ol>
        </section>
      )}
    </div>
  );
}

const decisionText: Record<string, string> = {
  CONFIRMED: "Confirmed",
  CORRECTED: "Corrected",
  UNREADABLE: "Marked unreadable",
};

function LineCard({
  line,
  runId,
  versionId,
  selected,
  canDecide,
  onFocus,
  onChanged,
}: {
  line: ReviewLine;
  runId: string;
  versionId: string;
  selected: boolean;
  canDecide: boolean;
  onFocus: (line: LineForReview) => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [changing, setChanging] = useState(false);
  const [draft, setDraft] = useState(line.decision?.text ?? line.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ocr = line.other.find(
    (reading) => reading.text.trim() && reading.text !== line.text,
  );
  async function decide(decision: string, text?: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/review/${versionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "line",
          runId,
          lineId: line.id,
          decision,
          text,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "That did not save.");
      setEditing(false);
      setChanging(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }
  const tone = line.decision
    ? line.decision.decision === "UNREADABLE"
      ? "border-red-300 bg-red-50/40"
      : "border-emerald-300 bg-emerald-50/40"
    : line.status === "blocked"
      ? "border-red-300"
      : "border-amber-300";
  const small =
    "rounded-md border px-2 py-1 text-xs bg-white disabled:opacity-40";
  return (
    <li
      className={`rounded-lg border p-3 text-sm space-y-2 ${tone} ${selected ? "ring-2 ring-sky-500" : ""}`}
    >
      <button
        type="button"
        onClick={() => onFocus(line)}
        className="w-full text-left space-y-1"
      >
        <span className="block text-xs text-slate-500">
          Page {line.page}
          {line.flags.length
            ? ` · ${line.flags.map((flag) => flag.message).join(" ")}`
            : ""}
        </span>
        <span className="block">
          <span className="text-xs text-slate-500">
            {readers[line.source] ?? line.source}:{" "}
          </span>
          {line.text || <em className="text-slate-400">nothing</em>}
        </span>
        {line.other.map((reading) => (
          <span key={reading.source} className="block">
            <span className="text-xs text-slate-500">
              {readers[reading.source] ?? reading.source}:{" "}
            </span>
            {reading.text || <em className="text-slate-400">nothing</em>}
          </span>
        ))}
      </button>
      {line.decision && (
        <p className="text-xs text-slate-600">
          {decisionText[line.decision.decision]}
          {line.decision.decision === "CORRECTED" && (
            <> to &ldquo;{line.decision.text}&rdquo;</>
          )}{" "}
          by {line.decision.reviewer}
        </p>
      )}
      {canDecide && !editing && line.decision && !changing && (
        <button
          type="button"
          className="text-xs underline text-slate-600"
          onClick={() => setChanging(true)}
        >
          Change
        </button>
      )}
      {canDecide && !editing && (!line.decision || changing) && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            className={small}
            onClick={() => void decide("CONFIRMED")}
          >
            Text is right
          </button>
          {ocr && (
            <button
              type="button"
              disabled={busy}
              className={small}
              onClick={() => void decide("CORRECTED", ocr.text)}
            >
              Use the {readers[ocr.source] ?? ocr.source} reading
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            className={small}
            onClick={() => setEditing(true)}
          >
            Type a correction
          </button>
          <button
            type="button"
            disabled={busy}
            className={`${small} text-red-700`}
            onClick={() => void decide("UNREADABLE")}
          >
            Can&rsquo;t read
          </button>
        </div>
      )}
      {canDecide && editing && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void decide("CORRECTED", draft);
          }}
        >
          <label className="block text-xs text-slate-600">
            What the page says
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={2000}
              rows={2}
              autoFocus
              className="block w-full border rounded-md p-2 mt-1 text-sm"
            />
          </label>
          <div className="flex gap-2">
            <button
              disabled={busy || !draft.trim()}
              className={`${small} bg-emerald-700 text-white`}
            >
              Save correction
            </button>
            <button
              type="button"
              className={small}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </li>
  );
}

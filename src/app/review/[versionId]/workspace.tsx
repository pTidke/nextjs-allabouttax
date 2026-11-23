"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import DetailsCheck, {
  type PendingReview,
} from "@/components/review/TaxReviewForm";
import WordCheck from "@/components/review/WordCheck";
import PageViewer from "@/components/review/PageViewer";
import type { LeftOut, QueueEntry } from "@/lib/review/line-reviews";
import type { DocumentFact } from "@/lib/review/document-facts";

// A document's review in three steps (AD-48), one shown at a time:
//   1. Check the words  (text check access): every line against the original;
//   2. Check the details (tax access): what the document is and when it applies;
//   3. Published.
// Someone with both kinds of access goes straight from one to the next. All the
// technical detail (engine, passages, history) is in one closed drawer.

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
    pageEnd: number | null;
    kind: string | null;
    provisions: string[];
    context: string | null;
  }[];
  draft: PendingReview["draft"];
  suggestion: PendingReview["suggestion"];
  textChecks: Check[];
};

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
      leftOut: LeftOut[];
      // The reviewed document, block by block, for reading whole.
      blocks: {
        kind: "heading" | "text" | "table";
        text: string;
        page: number;
        pageEnd: number;
      }[];
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

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });

export default function Workspace({
  access,
  carriedOver,
  changedSinceAcceptance,
  engine,
  version,
}: {
  access: { extraction: boolean; tax: boolean };
  carriedOver: CarriedOver[];
  // Line decisions made after the text was last accepted (only when the
  // passages could not follow them: see line-reviews followAcceptedText).
  changedSinceAcceptance: number;
  engine: EngineOverview | null;
  version: Version;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const [problem, setProblem] = useState("");
  const [reporting, setReporting] = useState(false);
  // Going back to the words from the details step, to change a line.
  const [rechecking, setRechecking] = useState(false);
  const [page, setPage] = useState(1);

  const latest = version.textChecks[0];
  const open = version.current && version.status === "PENDING";
  const wordsDone = latest?.decision === "ACCEPTED" && !changedSinceAcceptance;
  const sentBack = latest?.decision === "NEEDS_CHANGES";
  const lines = engine?.status === "OK" ? engine : null;
  const progress = lines?.progress;
  const step = !open ? 3 : wordsDone ? 2 : 1;

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
        router.push("/review");
        router.refresh();
        return;
      }
      setMessage(
        body.decision === "ACCEPTED"
          ? {
              text: access.tax
                ? "The words are checked. Now the details."
                : "The words are checked and the document is with the tax reviewer.",
            }
          : {
              text: "Sent back. It stays out of the chatbot until it is fixed.",
            },
      );
      setProblem("");
      setReporting(false);
      setRechecking(false);
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

  const original = `/api/review/${version.id}/original`;
  const canCheckWords = open && access.extraction;
  const showWords = step === 1 || rechecking;

  return (
    <div className="space-y-6">
      <header className="space-y-4 border-b-[3px] border-double border-ink pb-5">
        <h1 className="font-serif text-3xl font-bold leading-tight">
          {version.document.title}
        </h1>
        <p className="text-[15px] text-ink-soft">
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
          {version.isPdf && (
            <>
              {" · "}
              <a
                href={original}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Open the PDF in a new tab
              </a>
            </>
          )}
        </p>
        <Steps step={step} approved={version.status === "APPROVED"} />
        {message && (
          <p
            role={message.error ? "alert" : "status"}
            className={`border px-4 py-3 text-[15px] ${message.error ? "border-red-800 bg-red-50 text-red-800" : "border-brand bg-brand-soft text-brand-strong"}`}
          >
            {message.text}
          </p>
        )}
      </header>

      {!open && (
        <p className="border border-ink bg-paper p-4">
          {version.current
            ? version.status === "APPROVED"
              ? "Published: the chatbot can use this document."
              : "Not published."
            : "A newer version of this document exists. This one is kept for the record only."}
          {version.reviewNote && ` ${version.reviewNote}`}
        </p>
      )}

      {open && showWords && (
        <section className="space-y-4">
          {rechecking && (
            <button
              type="button"
              className="text-sm underline"
              onClick={() => setRechecking(false)}
            >
              ← Back to the details
            </button>
          )}
          {sentBack && (
            <p className="bg-red-50 p-3 text-sm text-red-800">
              Sent back by {latest.reviewer} on {when(latest.createdAt)}
              {latest.note && `: ${latest.note}`}
            </p>
          )}
          {/* An upload's "needs OCR" note is out of date once the engine has read it. */}
          {version.document.lastError &&
            !(lines && version.document.uploaded) && (
              <p className="bg-amber-50 p-3 text-sm text-amber-900">
                {version.document.lastError}
              </p>
            )}
          {version.isPdf && lines ? (
            <WordCheck
              key={lines.runId}
              src={original}
              linesUrl={`/api/review/${version.id}/lines`}
              pages={lines.pages}
              runId={lines.runId}
              queue={lines.queue}
              leftOut={lines.leftOut}
              canDecide={canCheckWords}
              versionId={version.id}
              onChanged={() => router.refresh()}
            />
          ) : (
            <NoEngine
              engine={engine}
              version={version}
              original={original}
              page={page}
              onPage={setPage}
            />
          )}

          {canCheckWords && step === 1 && (
            <div className="space-y-3 border border-ink bg-paper p-4">
              {progress && !progress.complete && !progress.unreadable ? (
                <p className="text-sm text-ink-soft">
                  {progress.undecided} line
                  {progress.undecided === 1 ? "" : "s"} left to check. When
                  every line is checked, press Done.
                </p>
              ) : progress?.unreadable ? (
                <div className="space-y-2">
                  <p className="text-sm text-red-800">
                    {progress.unreadable} line
                    {progress.unreadable === 1 ? " can’t" : "s can’t"} be read,
                    so this copy can’t be published. If you can read{" "}
                    {progress.unreadable === 1 ? "it" : "them"} after all, click
                    the line and choose again. Otherwise send it back.
                  </p>
                  <button
                    type="button"
                    disabled={busy || sentBack}
                    onClick={() =>
                      void act({
                        action: "textCheck",
                        decision: "NEEDS_CHANGES",
                        note: `${progress.unreadable} line(s) cannot be read in this copy.`,
                      })
                    }
                    className="min-h-10 cursor-pointer bg-red-700 px-4 text-sm text-paper disabled:opacity-40"
                  >
                    {sentBack ? "Sent back" : "Send it back: it can’t be read"}
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm text-brand-strong">
                    {progress
                      ? `All ${progress.required} lines are checked.`
                      : "Compare the text with the original."}
                  </p>
                  <button
                    type="button"
                    disabled={
                      busy || (!progress?.complete && !version.chunks.length)
                    }
                    onClick={() =>
                      void act({
                        action: "textCheck",
                        decision: "ACCEPTED",
                        note: "",
                      })
                    }
                    className="ml-auto min-h-12 cursor-pointer bg-brand px-7 font-semibold text-paper hover:bg-brand-strong disabled:cursor-default disabled:opacity-40"
                  >
                    {access.tax
                      ? "Done: on to the details →"
                      : "Done: send for tax review"}
                  </button>
                </div>
              )}
              {!reporting ? (
                <button
                  type="button"
                  className="text-sm text-ink-soft underline"
                  onClick={() => setReporting(true)}
                >
                  Something else is wrong with this document?
                </button>
              ) : (
                <div className="space-y-2">
                  <label className="block text-sm">
                    What is wrong?
                    <textarea
                      value={problem}
                      onChange={(e) => setProblem(e.target.value)}
                      maxLength={4000}
                      rows={2}
                      placeholder="For example: page 2 is missing, or this is the wrong document."
                      className="mt-1 block w-full border border-ink bg-paper p-2"
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
                    className="min-h-10 cursor-pointer bg-red-700 px-4 text-sm text-paper disabled:opacity-40"
                  >
                    Send it back
                  </button>
                </div>
              )}
            </div>
          )}
          {open && step === 1 && !access.extraction && (
            <p className="text-sm text-ink-soft">
              The words are checked by a text reviewer first.
            </p>
          )}
        </section>
      )}

      {open && step === 2 && !rechecking && (
        <section className="space-y-4">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-brand-strong">
            <span>
              ✓ Words checked by {latest.reviewer} on {when(latest.createdAt)}.
            </span>
            {access.extraction && version.isPdf && lines && (
              <button
                type="button"
                className="text-ink-soft underline"
                onClick={() => setRechecking(true)}
              >
                Change a line
              </button>
            )}
          </p>
          {access.tax ? (
            <div className="grid items-start gap-4 lg:grid-cols-2">
              <div className="lg:sticky lg:top-20">
                {version.isPdf ? (
                  <PageViewer
                    src={original}
                    linesUrl={null}
                    pages={lines?.pages ?? null}
                    page={page}
                    onPage={setPage}
                    current={null}
                    onSelect={() => {}}
                  />
                ) : (
                  <Passages chunks={version.chunks} />
                )}
              </div>
              <div className="border border-ink bg-paper p-5">
                <h2 className="mb-4 font-serif text-2xl font-bold">
                  Check the details
                </h2>
                <DetailsCheck
                  proposals={lines?.facts ?? []}
                  key={version.draft?.revision ?? 0}
                  version={version}
                  busy={busy}
                  act={act}
                />
              </div>
            </div>
          ) : (
            <p className="border border-ink bg-paper p-4 text-ink-soft">
              Now a tax reviewer checks the details and publishes it. Nothing
              more is needed from you.
            </p>
          )}
        </section>
      )}

      <BehindTheScenes
        engine={engine}
        version={version}
        carriedOver={carriedOver}
      />
    </div>
  );
}

function Steps({ step, approved }: { step: number; approved: boolean }) {
  const names = [
    "Check the words",
    "Check the details",
    approved || step < 3 ? "Published" : "Not published",
  ];
  return (
    <ol className="grid max-w-3xl grid-cols-3 gap-px border border-ink bg-ink text-[15px]">
      {names.map((name, i) => {
        const n = i + 1;
        const done = n < step || (n === 3 && step === 3);
        const now = n === step && step < 3;
        return (
          <li
            key={name}
            aria-current={now ? "step" : undefined}
            className={`flex items-center gap-2 px-3 py-2 ${now ? "bg-ink font-semibold text-paper" : done ? "bg-brand-soft text-brand-strong" : "bg-paper text-ink-soft"}`}
          >
            <span className="font-mono font-semibold">{done ? "✓" : n}</span>
            {name}
          </li>
        );
      })}
    </ol>
  );
}

// Documents the engine has not read (web pages, or a PDF still waiting): the
// text to check is the passages themselves, beside the original.
function NoEngine({
  engine,
  version,
  original,
  page,
  onPage,
}: {
  engine: EngineOverview | null;
  version: Version;
  original: string;
  page: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <div className="space-y-2 lg:sticky lg:top-20">
        {version.isPdf ? (
          <PageViewer
            src={original}
            linesUrl={null}
            pages={null}
            page={page}
            onPage={onPage}
            current={null}
            onSelect={() => {}}
          />
        ) : (
          <p className="border border-ink bg-paper p-4 text-sm text-ink-soft">
            The original is a web page. Compare the text with the{" "}
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
      </div>
      <div className="space-y-2">
        {version.isPdf && (
          <p className="bg-shade p-3 text-sm text-ink-soft">
            {engine?.status === "FAILED"
              ? "The engine could not read this document. Send it back below if the text is wrong."
              : "The engine has not read this document yet (it runs every two hours). Until then, compare the text below with the page."}
          </p>
        )}
        {version.chunks.length ? (
          <Passages chunks={version.chunks} />
        ) : (
          <p className="text-sm text-ink-soft">
            No text could be read from this file yet.
          </p>
        )}
      </div>
    </div>
  );
}

const kindName: Record<string, string> = {
  text: "Text",
  proviso: "Proviso",
  explanation: "Explanation",
  table: "Table",
  heading: "Heading",
};

// The chatbot's chunks as cards: where each comes from and what it is about,
// then its text.
function Passages({ chunks }: { chunks: Version["chunks"] }) {
  return (
    <ol className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
      {chunks.map((chunk) => (
        <li
          key={chunk.id}
          className="space-y-2 border border-rule bg-paper p-3 text-sm"
        >
          <div className="space-y-1 bg-shade p-2 text-xs text-ink-soft">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium text-ink">{chunk.anchor}</span>
              {chunk.page !== null && (
                <span>
                  {chunk.pageEnd && chunk.pageEnd !== chunk.page
                    ? `pages ${chunk.page}–${chunk.pageEnd}`
                    : `page ${chunk.page}`}
                </span>
              )}
              {chunk.kind && (
                <span className="bg-paper px-1.5 py-0.5 ring-1 ring-rule">
                  {kindName[chunk.kind] ?? chunk.kind}
                </span>
              )}
              <span>
                {chunk.text.length.toLocaleString("en-IN")} characters
              </span>
            </p>
            {(chunk.context || !!chunk.headings.length) && (
              <p>
                <span className="text-ink-soft">Where: </span>
                {chunk.context || chunk.headings.join(" › ")}
              </p>
            )}
            {(!!chunk.incomeYears.length || !!chunk.provisions.length) && (
              <p className="flex flex-wrap items-center gap-1">
                {chunk.incomeYears.map((year) => (
                  <span
                    key={year}
                    className="bg-sky-50 px-1.5 py-0.5 text-sky-800"
                  >
                    Tax year {year}
                  </span>
                ))}
                {chunk.provisions.map((provision) => (
                  <span
                    key={provision}
                    className="bg-violet-50 px-1.5 py-0.5 text-violet-800"
                  >
                    {provision}
                  </span>
                ))}
              </p>
            )}
          </div>
          <p className="whitespace-pre-wrap">{chunk.text}</p>
        </li>
      ))}
    </ol>
  );
}

// The checked document read straight through, with page breaks marked.
function WholeDocument({
  blocks,
  fallback,
}: {
  blocks: Extract<EngineOverview, { status: "OK" }>["blocks"] | null;
  fallback: string;
}) {
  if (!blocks)
    return (
      <pre className="max-h-[70vh] overflow-y-auto whitespace-pre-wrap border border-ink bg-paper p-4 font-sans text-sm leading-relaxed">
        {fallback}
      </pre>
    );
  return (
    <div className="max-h-[70vh] space-y-3 overflow-y-auto border border-ink bg-paper p-4 leading-relaxed">
      {blocks.map((block, i) => (
        <div key={i}>
          {(i === 0 || block.page !== blocks[i - 1].pageEnd) && (
            <p className="mb-2 mt-1 border-t pt-1 text-xs text-ink-soft">
              Page {block.page}
            </p>
          )}
          {block.kind === "heading" ? (
            <p className="font-semibold">{block.text}</p>
          ) : block.kind === "table" ? (
            <pre className="overflow-x-auto whitespace-pre font-mono text-xs">
              {block.text}
            </pre>
          ) : (
            <p>{block.text}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// Everything a reviewer does not need to finish a review, for when something
// looks off: what the engine did, the passages the chatbot gets, the history.
function BehindTheScenes({
  engine,
  version,
  carriedOver,
}: {
  engine: EngineOverview | null;
  version: Version;
  carriedOver: CarriedOver[];
}) {
  const s = engine?.status === "OK" ? engine.summary : null;
  return (
    <details className="border border-ink bg-paper p-4 text-sm">
      <summary className="cursor-pointer font-medium text-ink">
        Behind the scenes
      </summary>
      <div className="mt-3 space-y-5">
        <div className="space-y-1 text-ink-soft">
          <h3 className="font-medium text-ink">How it was read</h3>
          {!engine ? (
            <p>The extraction engine has not read this document yet.</p>
          ) : engine.status === "FAILED" ? (
            <p>
              The engine could not read it: {engine.error ?? "unknown error"}.
            </p>
          ) : (
            <p>
              Read by {engine.engine} on {when(engine.createdAt)}.{" "}
              {s?.accepted ?? 0} of {s?.lines ?? 0} lines passed every rule
              {s?.excluded
                ? `; ${s.excluded} Hindi lines kept as evidence only`
                : ""}
              {s?.pages_scanned
                ? `; ${s.pages_scanned} scanned pages read by OCR`
                : ""}
              {engine.leftOut.length
                ? `; ${engine.leftOut.length} signature, “Copy to” and page-header lines left out of the chatbot’s text`
                : ""}
              . {engine.attentionTotal} line
              {engine.attentionTotal === 1 ? "" : "s"} the rules did not trust
              and {engine.sampleSize} spot check
              {engine.sampleSize === 1 ? "" : "s"} are looked at one at a time.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <h3 className="font-medium text-ink">The whole document</h3>
          <p className="text-xs text-ink-soft">
            {engine?.status === "OK"
              ? "The checked text as one document, with corrections. Hindi, the signature, the “Copy to” list, page headers and lines left out are not in it."
              : "The text as read from the source."}
          </p>
          <WholeDocument
            blocks={engine?.status === "OK" ? engine.blocks : null}
            fallback={version.text}
          />
        </div>
        <div className="space-y-2">
          <h3 className="font-medium text-ink">
            What the chatbot gets ({version.chunks.length} chunk
            {version.chunks.length === 1 ? "" : "s"})
          </h3>
          <p className="text-xs text-ink-soft">
            The document cut into chunks along its own paragraphs, never inside
            a sentence, each with where it comes from and what it names. Rebuilt
            whenever the words are checked or a line changes.
          </p>
          <Passages chunks={version.chunks} />
        </div>
        {version.textChecks.length > 0 && (
          <div className="space-y-1">
            <h3 className="font-medium text-ink">History</h3>
            <ul className="space-y-1 text-xs text-ink-soft">
              {version.textChecks.map((check) => (
                <li key={check.id}>
                  {when(check.createdAt)} · {check.reviewer} ·{" "}
                  {check.decision === "ACCEPTED"
                    ? "words checked"
                    : "sent back"}
                  {check.note && ` · ${check.note}`}
                </li>
              ))}
            </ul>
          </div>
        )}
        <StagingHistory carriedOver={carriedOver} />
        <p className="break-all text-xs text-ink-soft">
          Version {version.id} · SHA-256 {version.hash}
        </p>
      </div>
    </details>
  );
}

const stagingAction: Record<string, string> = {
  SAVE_DRAFT: "Draft saved",
  ACCEPT_EXTRACTION: "Extraction accepted",
  REQUEST_CHANGES: "Changes requested",
};

// The review this document had in the old staging inbox, carried over (R3).
function StagingHistory({ carriedOver }: { carriedOver: CarriedOver[] }) {
  // One entry per staging document; the newest carry-over of each.
  const latest = carriedOver.filter(
    (c, i) =>
      carriedOver.findIndex((o) => o.candidateId === c.candidateId) === i,
  );
  if (!latest.length) return null;
  return (
    <div className="space-y-1 text-xs text-ink-soft">
      <h3 className="text-sm font-medium text-ink">
        Carried over from the staging review
      </h3>
      <ul className="space-y-3">
        {latest.map((c) => (
          <li key={c.candidateId} className="space-y-1">
            <p className="font-medium text-ink">{c.title}</p>
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
                    <span className="block text-ink-soft">
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
    </div>
  );
}

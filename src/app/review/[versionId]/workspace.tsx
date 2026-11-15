"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import TaxReviewForm, {
  type PendingReview,
} from "@/components/review/TaxReviewForm";

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

export default function Workspace({
  access,
  version,
}: {
  access: { extraction: boolean; tax: boolean };
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
  const open = version.current && version.status === "PENDING";

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
            <iframe
              key={page}
              title="Original document"
              src={`/api/review/${version.id}/original#page=${page}`}
              className="w-full h-[75vh] border rounded-xl bg-slate-50"
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
          <div className="space-y-2">
            <h2 className="font-semibold">
              Extracted text ({version.chunks.length}{" "}
              {version.chunks.length === 1 ? "passage" : "passages"})
            </h2>
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
                        disabled={busy || !version.chunks.length}
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

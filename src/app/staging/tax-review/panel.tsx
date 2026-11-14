"use client";

import { useState } from "react";
import type { Candidate } from "@/lib/extraction-staging/contract";
import type {
  TaxDecision,
  TaxFields,
  TaxReview,
} from "@/lib/extraction-staging/tax-review";

const empty: TaxFields = {
  classification: "",
  appliesTo: "",
  period: "",
  notes: "",
  evidenceIds: [],
};
const labels = {
  DRAFT: "Draft saved",
  ACCEPT: "Tax review accepted in staging",
  NEEDS_CHANGES: "Changes requested",
};
const inputs = [
  {
    name: "classification",
    label: "Document type and legal status",
    hint: "Identify the instrument and its status.",
    max: 400,
  },
  {
    name: "appliesTo",
    label: "Who and what it applies to",
    hint: "Name the taxpayer or group and any qualifying conditions.",
    max: 1200,
  },
  {
    name: "period",
    label: "Applicable periods and dates",
    hint: "Distinguish commencement, eligibility deadlines, and how long obligations continue.",
    max: 1200,
  },
  {
    name: "notes",
    label: "Decision notes",
    hint: "Explain your decision or tell the operator what to fix.",
    max: 2200,
  },
] as const;

export default function TaxReviewPanel({
  candidate,
  extractionRevision,
  latest,
  canWrite,
}: {
  candidate: Candidate;
  extractionRevision: string;
  latest: TaxReview | null;
  canWrite: boolean;
}) {
  const [fields, setFields] = useState(latest?.fields ?? empty);
  const [saved, setSaved] = useState(latest);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(candidate.renders[0]?.page);
  const render = candidate.renders.find((item) => item.page === page);
  const asset = (id: string) =>
    "/api/staging/extraction/" + candidate.id + "/objects/" + id;
  const marked = new Set(fields.evidenceIds);
  const complete =
    inputs.every(({ name }) => fields[name].trim()) && marked.size > 0;
  const dirty =
    JSON.stringify(fields) !== JSON.stringify(saved?.fields ?? empty);
  async function save(decision: TaxDecision) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/staging/tax-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...fields,
          candidateId: candidate.id,
          extractionRevision,
          previousId: saved?.id ?? null,
          decision,
        }),
      });
      const result = await res.json();
      if (!res.ok)
        throw new Error(result.error || "Could not save the review.");
      setSaved(result);
      setFields(result.fields);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save the review.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{candidate.title}</h2>
        <p className="mt-1 text-sm text-slate-600">
          Accepted extraction scope: {candidate.scopeNote}
        </p>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <div className="space-y-4 rounded-xl border p-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <h3 className="font-semibold">Official source</h3>
            <a
              className="text-sm underline"
              href={candidate.officialUrl}
              target="_blank"
              rel="noreferrer"
            >
              Official website
            </a>
            <a
              className="text-sm underline"
              href={asset(candidate.original.object_id)}
            >
              Download PDF
            </a>
          </div>
          {candidate.renders.length > 1 && (
            <label className="block text-sm">
              Page{" "}
              <select
                className="rounded border p-1"
                value={page}
                onChange={(event) => setPage(Number(event.target.value))}
              >
                {candidate.renders.map(({ page }) => (
                  <option key={page} value={page}>
                    {page}
                  </option>
                ))}
              </select>
            </label>
          )}
          {render && (
            <details className="rounded border p-2">
              <summary className="cursor-pointer text-sm">
                Show original page {render.page}
              </summary>
              {/* Protected evidence is streamed directly with the reviewer session. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="mt-2 h-auto w-full"
                loading="lazy"
                src={asset(render.object.object_id)}
                width={render.width}
                height={render.height}
                alt={"Original page " + render.page}
              />
            </details>
          )}
          <div>
            <h3 className="font-semibold">Extracted text</h3>
            <p className="my-2 text-sm text-slate-600">
              {canWrite ? "Mark the lines that support your decision. " : ""}
              {marked.size} marked.
            </p>
            <div className="max-h-[55vh] space-y-1 overflow-y-auto rounded border p-2">
              {candidate.regions
                .filter((item) => item.page === page && item.proposed?.trim())
                .map((item) => (
                  <label
                    key={item.id}
                    className="flex items-start gap-2 rounded p-1 text-sm has-[:checked]:bg-emerald-50"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={marked.has(item.id)}
                      disabled={
                        !canWrite ||
                        busy ||
                        (!marked.has(item.id) && marked.size >= 12)
                      }
                      onChange={() =>
                        setFields({
                          ...fields,
                          evidenceIds: marked.has(item.id)
                            ? fields.evidenceIds.filter((id) => id !== item.id)
                            : [...fields.evidenceIds, item.id],
                        })
                      }
                    />
                    <span>{item.proposed}</span>
                  </label>
                ))}
            </div>
          </div>
        </div>
        <div className="space-y-4 rounded-xl border p-4">
          <h3 className="font-semibold">Applicability and decision</h3>
          {!canWrite && (
            <p className="text-sm text-slate-600">
              Read-only. Only the assigned tax reviewer can record a decision.
            </p>
          )}
          {inputs.map(({ name, label, hint, max }) => (
            <label className="block text-sm" key={name}>
              <span className="font-medium">{label}</span>
              <span className="block text-slate-600">{hint}</span>
              <textarea
                maxLength={max}
                readOnly={!canWrite}
                disabled={busy}
                rows={name === "classification" ? 2 : 3}
                className="mt-1 w-full rounded border p-2"
                value={fields[name]}
                onChange={(event) =>
                  setFields({ ...fields, [name]: event.target.value })
                }
              />
            </label>
          ))}
          <p aria-live="polite" className="text-sm text-slate-600">
            {busy
              ? "Saving…"
              : dirty
                ? "Unsaved changes"
                : saved
                  ? labels[saved.decision]
                  : "No decision recorded yet."}
          </p>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          {canWrite && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                disabled={busy || !dirty}
                onClick={() => save("DRAFT")}
              >
                Save draft
              </button>
              <button
                type="button"
                className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                disabled={
                  busy ||
                  !fields.notes.trim() ||
                  (!dirty && saved?.decision === "NEEDS_CHANGES")
                }
                onClick={() => save("NEEDS_CHANGES")}
              >
                Request changes
              </button>
              <button
                type="button"
                className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
                disabled={
                  busy || !complete || (!dirty && saved?.decision === "ACCEPT")
                }
                onClick={() => save("ACCEPT")}
              >
                Accept tax review
              </button>
              {!complete && (
                <p className="w-full text-sm text-slate-600">
                  To accept, fill in the four fields and mark at least one
                  source line.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

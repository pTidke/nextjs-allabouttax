"use client";
import type { DocumentFact } from "@/lib/review/document-facts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReviewSection } from "@/lib/tax/review-sections";

// Step 2 of a review, "Check the details" (AD-48). Everything the chatbot needs
// to tell documents apart and to know when one applies, filled in from the
// document's own lines and from any draft, and read back as one sentence. The
// reviewer corrects what is wrong and presses Publish. Rarely needed details are
// folded away. The draft saves itself.

type Fields = {
  documentType: string;
  legalStatus: string;
  publishedAt: string;
  period: string;
  periodMode: string;
  applicabilityNote: string;
  entityName: string;
  investmentFrom: string;
  investmentThrough: string;
  effectiveFrom: string;
  effectiveTo: string;
  note: string;
  documentNumber: string;
  gazetteNumber: string;
  issuingAuthority: string;
  issuedOn: string;
};
export type PendingReview = {
  id: string;
  hash: string;
  text: string;
  document: { title: string; url: string; issuedAt?: string | null };
  sections: ReviewSection[];
  draft: {
    fields: Partial<Fields> & { sectionIds?: string[] };
    revision: number;
    updatedAt: string;
  } | null;
  suggestion:
    | (Partial<Fields> & {
        label: string;
        description: string;
        sectionIds: string[];
      })
    | null;
};
const empty: Fields = {
  documentType: "",
  legalStatus: "",
  publishedAt: "",
  period: "",
  periodMode: "SINGLE_PERIOD",
  applicabilityNote: "",
  entityName: "",
  investmentFrom: "",
  investmentThrough: "",
  effectiveFrom: "",
  effectiveTo: "",
  note: "",
  documentNumber: "",
  gazetteNumber: "",
  issuingAuthority: "",
  issuedOn: "",
};
const TYPES: [string, string][] = [
  ["NOTIFICATION", "Notification"],
  ["CIRCULAR", "Circular"],
  ["ACT", "Act"],
  ["RULE", "Rules"],
  ["GUIDANCE", "Guidance (FAQ, explainer)"],
];
const typeName = (value: string) =>
  TYPES.find(([v]) => v === value)?.[1] ?? "Document";

const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
const validPeriod = (value: string) => {
  const m = value.match(/^(FY|AY|TY) (20\d{2})-(\d{2})$/);
  return !!m && Number(m[3]) === (Number(m[2]) + 1) % 100;
};
const longDate = (value: string) =>
  validDate(value)
    ? new Date(value).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";
// Tax years to choose from: TY 2018-19 to five years ahead.
const taxYears = () => {
  const now = new Date().getUTCFullYear();
  const years = [];
  for (let start = now + 5; start >= 2018; start--)
    years.push(`${start}-${String((start + 1) % 100).padStart(2, "0")}`);
  return years;
};
const nextYear = (year: string) => {
  const start = Number(year.slice(0, 4)) + 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
};

// The starting values: what was read from the document, then a checked preset
// for that document if there is one, then the reviewer's own draft on top;
// plain defaults fill what is still empty.
function startingFields(
  version: PendingReview,
  proposals: DocumentFact[],
): Fields {
  const fields = { ...empty };
  for (const fact of proposals)
    if (fact.field in fields) fields[fact.field as keyof Fields] = fact.value;
  for (const layer of [version.suggestion, version.draft?.fields])
    if (layer)
      for (const key of Object.keys(empty) as (keyof Fields)[])
        if (layer[key]) fields[key] = layer[key]!;
  if (!fields.legalStatus && fields.documentType)
    fields.legalStatus = ["CIRCULAR", "GUIDANCE"].includes(fields.documentType)
      ? "GUIDANCE"
      : "EFFECTIVE";
  if (!fields.effectiveFrom && fields.issuedOn)
    fields.effectiveFrom = fields.issuedOn;
  return fields;
}

// What would stop publication, in the reviewer's words. The server checks the
// same and more (lib/tax/review.ts).
function missing(fields: Fields, sections: string[], named: boolean) {
  const out: string[] = [];
  if (!fields.documentType) out.push("what kind of document it is");
  if (!fields.legalStatus) out.push("whether it is in force");
  if (!validDate(fields.effectiveFrom)) out.push("the date it applies from");
  if (fields.periodMode === "SINGLE_PERIOD" && !validPeriod(fields.period))
    out.push("the tax year");
  if (
    (fields.periodMode === "MULTI_PERIOD" ||
      fields.investmentFrom ||
      fields.investmentThrough) &&
    !fields.applicabilityNote.trim()
  )
    out.push("a note for the chatbot on when it applies");
  if (named && fields.entityName.trim().length < 3)
    out.push("the name of the person or company");
  if (!!fields.investmentFrom !== !!fields.investmentThrough)
    out.push("both investment dates");
  if (!sections.length) out.push("the parts to publish");
  return out;
}

function sentence(fields: Fields) {
  const parts: string[] = [];
  const name = [
    typeName(fields.documentType),
    fields.documentNumber && `${fields.documentNumber}`,
  ]
    .filter(Boolean)
    .join(" ");
  parts.push(
    `${name}${fields.gazetteNumber ? ` (${fields.gazetteNumber})` : ""}${fields.issuingAuthority ? ` from the ${fields.issuingAuthority}` : ""}${fields.issuedOn ? `, issued on ${longDate(fields.issuedOn)}` : ""}.`,
  );
  const status =
    fields.legalStatus === "GUIDANCE"
      ? "It is guidance"
      : fields.legalStatus === "PROPOSED"
        ? "It is only proposed, so the chatbot will not use it"
        : "It is in force";
  const from = validDate(fields.effectiveFrom)
    ? ` from ${longDate(fields.effectiveFrom)}`
    : "";
  const until = validDate(fields.effectiveTo)
    ? ` until ${longDate(fields.effectiveTo)}`
    : "";
  const years =
    fields.periodMode === "MULTI_PERIOD"
      ? "covers several tax years"
      : validPeriod(fields.period)
        ? `covers tax year ${fields.period.slice(3)}`
        : "covers one tax year (not chosen yet)";
  parts.push(`${status}${from}${until}, and ${years}.`);
  parts.push(
    fields.entityName.trim()
      ? `It applies only to ${fields.entityName.trim()}.`
      : "It applies to everyone it describes.",
  );
  return parts.join(" ");
}

export default function DetailsCheck({
  version,
  busy,
  act,
  proposals = [],
}: {
  // Facts read from the document's lines by rules, each with its line.
  proposals?: DocumentFact[];
  version: PendingReview;
  busy: boolean;
  act: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [fields, setFields] = useState<Fields>(() =>
    startingFields(version, proposals),
  );
  const single = version.sections.length === 1;
  const [selected, setSelected] = useState<string[]>(
    () =>
      version.draft?.fields.sectionIds ??
      version.suggestion?.sectionIds ??
      version.sections.map((section) => section.id),
  );
  const [named, setNamed] = useState(() => !!fields.entityName);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const set = (name: keyof Fields, value: string) =>
    setFields((old) => ({ ...old, [name]: value }));
  const source = useMemo(
    () => new Map(proposals.map((fact) => [fact.field, fact.source])),
    [proposals],
  );

  // The draft saves itself a moment after each change.
  const revision = useRef(version.draft?.revision ?? 0);
  const [saveState, setSaveState] = useState<
    "saved" | "saving" | "unsaved" | "conflict" | null
  >(version.draft ? "saved" : null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSaveState("unsaved");
    const timer = setTimeout(async () => {
      setSaveState("saving");
      try {
        const response = await fetch(`/api/review/${version.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "saveDraft",
            versionId: version.id,
            revision: revision.current,
            draft: { ...fields, sectionIds: selected },
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (response.status === 409) return setSaveState("conflict");
        if (!response.ok) throw new Error();
        revision.current = result.revision ?? revision.current + 1;
        setSaveState("saved");
      } catch {
        setSaveState("unsaved");
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [fields, selected, version.id]);

  const blockers = missing(fields, selected, named);
  const label = "block min-w-0 text-sm font-medium text-slate-700";
  const input =
    "mt-1 block w-full rounded-lg border border-slate-300 p-2 text-sm";
  const hint = (field: string) => {
    const s = source.get(field as DocumentFact["field"]);
    return s ? (
      <span
        className="mt-1 block truncate text-xs text-slate-500"
        title={s.text}
      >
        Read from page {s.page}: “{s.text}”
      </span>
    ) : null;
  };
  const choice = (active: boolean) =>
    `rounded-lg border px-3 py-1.5 text-sm ${active ? "border-emerald-700 bg-emerald-50 font-medium text-emerald-900" : "bg-white hover:bg-slate-50"}`;
  const years = taxYears();

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (blockers.length) return;
        void act({
          action: "approve",
          versionId: version.id,
          sectionIds: selected,
          ...fields,
          entityName: named ? fields.entityName : "",
          period: fields.periodMode === "MULTI_PERIOD" ? "" : fields.period,
          note: fields.note.trim() || "Checked against the original.",
        });
      }}
    >
      <div className="rounded-xl bg-slate-50 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          What the chatbot will be told
        </p>
        <p className="mt-1 text-base leading-relaxed">
          {sentence({ ...fields, entityName: named ? fields.entityName : "" })}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Filled in from the document. Correct anything that is wrong below.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className={label}>
          What it is
          <select
            className={input}
            value={fields.documentType}
            onChange={(e) => set("documentType", e.target.value)}
          >
            <option value="">Choose…</option>
            {TYPES.map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
          {hint("documentType")}
        </label>
        <label className={label}>
          Number
          <input
            className={input}
            maxLength={300}
            placeholder="1/2026"
            value={fields.documentNumber}
            onChange={(e) => set("documentNumber", e.target.value)}
          />
          {hint("documentNumber")}
        </label>
        <label className={label}>
          Gazette number
          <input
            className={input}
            maxLength={300}
            placeholder="S.O. 44(E)"
            value={fields.gazetteNumber}
            onChange={(e) => set("gazetteNumber", e.target.value)}
          />
          {hint("gazetteNumber")}
        </label>
        <label className={`${label} sm:col-span-2`}>
          Issued by
          <input
            className={input}
            maxLength={300}
            placeholder="Ministry of Finance, Department of Revenue"
            value={fields.issuingAuthority}
            onChange={(e) => set("issuingAuthority", e.target.value)}
          />
          {hint("issuingAuthority")}
        </label>
        <label className={label}>
          Issued on
          <input
            type="date"
            className={input}
            value={fields.issuedOn}
            onChange={(e) => set("issuedOn", e.target.value)}
          />
          {hint("issuedOn")}
        </label>
      </div>

      <fieldset className="min-w-0 space-y-2">
        <legend className={label}>Is it in force?</legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["EFFECTIVE", "Yes, it is law"],
              ["GUIDANCE", "It is guidance"],
              ["PROPOSED", "Only proposed"],
            ] as const
          ).map(([value, name]) => (
            <button
              key={value}
              type="button"
              aria-pressed={fields.legalStatus === value}
              className={choice(fields.legalStatus === value)}
              onClick={() => set("legalStatus", value)}
            >
              {name}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className={label}>
          Applies from
          <input
            type="date"
            className={input}
            value={fields.effectiveFrom}
            onChange={(e) => set("effectiveFrom", e.target.value)}
          />
          {hint("effectiveFrom") ?? (
            <span className="mt-1 block text-xs text-slate-500">
              Usually the issue date, unless it says otherwise.
            </span>
          )}
        </label>
        <fieldset className="min-w-0 space-y-1 sm:col-span-2">
          <legend className={label}>Which tax year?</legend>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={fields.periodMode === "SINGLE_PERIOD"}
              className={choice(fields.periodMode === "SINGLE_PERIOD")}
              onClick={() => set("periodMode", "SINGLE_PERIOD")}
            >
              One tax year
            </button>
            <button
              type="button"
              aria-pressed={fields.periodMode === "MULTI_PERIOD"}
              className={choice(fields.periodMode === "MULTI_PERIOD")}
              onClick={() => set("periodMode", "MULTI_PERIOD")}
            >
              Several tax years
            </button>
            {fields.periodMode === "SINGLE_PERIOD" && (
              <select
                aria-label="Tax year"
                className="rounded-lg border border-slate-300 p-1.5 text-sm"
                value={fields.period}
                onChange={(e) => set("period", e.target.value)}
              >
                <option value="">Choose the year…</option>
                {fields.period &&
                  !years.some((y) => `TY ${y}` === fields.period) && (
                    <option value={fields.period}>{fields.period}</option>
                  )}
                {years.map((year) => (
                  <option key={year} value={`TY ${year}`}>
                    {year} (income of April {year.slice(0, 4)}–March{" "}
                    {Number(year.slice(0, 4)) + 1}; AY {nextYear(year)})
                  </option>
                ))}
              </select>
            )}
          </div>
          {hint(
            fields.periodMode === "MULTI_PERIOD"
              ? "applicabilityNote"
              : "period",
          )}
        </fieldset>
      </div>

      <fieldset className="min-w-0 space-y-2">
        <legend className={label}>Who does it apply to?</legend>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={!named}
            className={choice(!named)}
            onClick={() => setNamed(false)}
          >
            Everyone it describes
          </button>
          <button
            type="button"
            aria-pressed={named}
            className={choice(named)}
            onClick={() => setNamed(true)}
          >
            One named person or company
          </button>
        </div>
        {named && (
          <label className="block text-sm">
            <span className="text-slate-600">Their full name</span>
            <input
              className={input}
              maxLength={300}
              value={fields.entityName}
              onChange={(e) => set("entityName", e.target.value)}
              placeholder="As written in the document"
            />
            <span className="mt-1 block text-xs text-slate-500">
              The chatbot then uses this document only when a question names
              them.
            </span>
            {hint("entityName")}
          </label>
        )}
      </fieldset>

      {(fields.periodMode === "MULTI_PERIOD" ||
        fields.investmentFrom ||
        fields.investmentThrough) && (
        <label className={label}>
          When does it apply? (a note for the chatbot)
          <textarea
            maxLength={4000}
            className={`${input} min-h-24`}
            value={fields.applicabilityNote}
            onChange={(e) => set("applicabilityNote", e.target.value)}
            placeholder="For example: applies to tax years 2026-27 to 2030-31, subject to the conditions in paragraph 2."
          />
        </label>
      )}

      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-700">
          More details (rarely needed)
        </summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <label className={label}>
            Stops applying on
            <input
              type="date"
              className={input}
              value={fields.effectiveTo}
              onChange={(e) => set("effectiveTo", e.target.value)}
            />
            <span className="mt-1 block text-xs text-slate-500">
              Only if the rule itself ends. Not a filing or investment deadline.
            </span>
          </label>
          <label className={label}>
            Investments allowed from
            <input
              type="date"
              className={input}
              value={fields.investmentFrom}
              onChange={(e) => set("investmentFrom", e.target.value)}
            />
          </label>
          <label className={label}>
            Investments allowed until
            <input
              type="date"
              className={input}
              value={fields.investmentThrough}
              onChange={(e) => set("investmentThrough", e.target.value)}
            />
            <span className="mt-1 block text-xs text-slate-500">
              Including this day.
            </span>
          </label>
          <label className={label}>
            Published in the Gazette on
            <input
              type="date"
              className={input}
              value={fields.publishedAt}
              onChange={(e) => set("publishedAt", e.target.value)}
            />
          </label>
          <label className={`${label} sm:col-span-2`}>
            Note for the record
            <textarea
              maxLength={4000}
              className={`${input} min-h-16`}
              value={fields.note}
              onChange={(e) => set("note", e.target.value)}
              placeholder="Anything another reviewer should know."
            />
          </label>
        </div>
        {!single && (
          <div className="mt-4 space-y-2">
            <p className={label}>
              Parts to publish ({selected.length} of {version.sections.length})
            </p>
            <div className="max-h-64 divide-y overflow-y-auto rounded-lg border">
              {version.sections.map((section) => (
                <label
                  key={section.id}
                  className="flex items-start gap-3 p-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(section.id)}
                    onChange={(event) =>
                      setSelected((old) =>
                        event.target.checked
                          ? [...old, section.id]
                          : old.filter((id) => id !== section.id),
                      )
                    }
                  />
                  {section.title}
                </label>
              ))}
            </div>
          </div>
        )}
      </details>

      <div className="space-y-2 border-t pt-4">
        {blockers.length > 0 && (
          <p className="text-sm text-amber-900">
            Before publishing, add {blockers.join(", ")}.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-4">
          <button
            disabled={busy || blockers.length > 0}
            className="rounded-lg bg-emerald-700 px-6 py-2.5 font-medium text-white disabled:opacity-40"
          >
            {busy ? "Publishing…" : "Publish"}
          </button>
          <button
            type="button"
            className="text-sm text-slate-600 underline"
            onClick={() => setRejecting((r) => !r)}
          >
            Don’t publish this document
          </button>
          <span className="ml-auto text-xs text-slate-500" aria-live="polite">
            {saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? "Saved"
                : saveState === "conflict"
                  ? "Changed in another tab: reload the page before editing."
                  : saveState === "unsaved"
                    ? "Not saved yet"
                    : ""}
          </span>
        </div>
        {rejecting && (
          <div className="space-y-2 rounded-lg border border-red-200 bg-red-50/50 p-3">
            <label className="block text-sm">
              Why not? It is kept for the record.
              <textarea
                className={`${input} min-h-16 bg-white`}
                maxLength={4000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="For example: superseded by Circular 5/2026."
              />
            </label>
            <button
              type="button"
              disabled={busy || !reason.trim()}
              className="rounded-lg bg-red-700 px-4 py-2 text-sm text-white disabled:opacity-40"
              onClick={() =>
                void act({
                  action: "reject",
                  versionId: version.id,
                  note: reason,
                })
              }
            >
              Don’t publish
            </button>
          </div>
        )}
      </div>
    </form>
  );
}

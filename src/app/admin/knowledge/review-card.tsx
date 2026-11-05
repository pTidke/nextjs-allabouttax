"use client";
import { useState } from "react";
import type { ReviewSection } from "@/lib/tax/review-sections";

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
};

export default function ReviewCard({
  version,
  busy,
  act,
}: {
  version: PendingReview;
  busy: boolean;
  act: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [fields, setFields] = useState<Fields>(
    () =>
      Object.fromEntries(
        Object.entries(empty).map(([key, value]) => [
          key,
          version.draft?.fields[key as keyof Fields] ?? value,
        ]),
      ) as Fields,
  );
  const [selected, setSelected] = useState<string[]>(
    version.draft?.fields.sectionIds ?? [],
  );
  const selectedSections = version.sections.filter((section) =>
    selected.includes(section.id),
  );
  const field =
    "border border-slate-300 rounded-lg p-2 text-sm block mt-1 w-full";
  const set = (name: keyof Fields, value: string) =>
    setFields((old) => ({ ...old, [name]: value }));
  return (
    <form
      className="border rounded-xl p-5 space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void act({
          action: "approve",
          versionId: version.id,
          sectionIds: selected,
          ...fields,
          period: fields.periodMode === "MULTI_PERIOD" ? "" : fields.period,
        });
      }}
    >
      <div>
        <a
          href={version.document.url}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-emerald-700 underline"
        >
          {version.document.title}
        </a>
        {version.document.issuedAt && (
          <p className="text-sm text-slate-500 mt-1">
            Issue date shown on the official listing:{" "}
            {version.document.issuedAt.slice(0, 10)}. Confirm the publication
            and applicability dates in the document.
          </p>
        )}
        <p className="text-sm text-slate-500 mt-1">
          Choose the answers to publish, check their details, then approve your
          selection.
        </p>
      </div>
      {version.suggestion && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-2">
          <p className="font-medium">Prepare a draft review</p>
          <p className="text-sm">{version.suggestion.description}</p>
          <button
            type="button"
            disabled={busy}
            className="rounded-lg bg-emerald-700 text-white px-4 py-2 text-sm disabled:opacity-40"
            onClick={() => {
              const suggestion = version.suggestion!;
              setFields(
                Object.fromEntries(
                  Object.entries(empty).map(([key, value]) => [
                    key,
                    suggestion[key as keyof Fields] ?? value,
                  ]),
                ) as Fields,
              );
              setSelected(suggestion.sectionIds);
            }}
          >
            {version.suggestion.label}
          </button>
        </div>
      )}
      <details open={!selected.length && !version.suggestion}>
        <summary className="cursor-pointer font-medium">
          Choose source sections ({selected.length} selected)
        </summary>
        <div className="max-h-80 overflow-y-auto border rounded-lg mt-3 divide-y">
          {version.sections.map((section) => (
            <label
              key={section.id}
              className="flex gap-3 p-3 text-sm items-start"
            >
              <input
                type="checkbox"
                disabled={busy}
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
      </details>
      {!!selected.length && (
        <div className="space-y-3">
          <p className="font-medium">Selected source text</p>
          {selectedSections.map((section) => (
            <pre
              key={section.id}
              className="whitespace-pre-wrap font-sans text-sm leading-relaxed max-h-80 overflow-auto bg-slate-50 p-4 rounded-lg"
            >
              {section.text}
            </pre>
          ))}
          <p className="text-sm text-slate-600">
            Only these sections will be available to chat within the
            applicability you review below. Split selections if their dates or
            scope differ.
          </p>
        </div>
      )}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <label className="text-sm">
          Document type
          <select
            required
            className={field}
            value={fields.documentType}
            onChange={(e) => set("documentType", e.target.value)}
          >
            <option value="">Choose type</option>
            {["ACT", "RULE", "NOTIFICATION", "CIRCULAR", "GUIDANCE"].map(
              (value) => (
                <option key={value}>{value}</option>
              ),
            )}
          </select>
        </label>
        <label className="text-sm">
          Legal status
          <select
            required
            className={field}
            value={fields.legalStatus}
            onChange={(e) => set("legalStatus", e.target.value)}
          >
            <option value="">Choose status</option>
            {["EFFECTIVE", "GUIDANCE", "PROPOSED"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Publication date (optional)
          <input
            type="date"
            className={field}
            value={fields.publishedAt}
            onChange={(e) => set("publishedAt", e.target.value)}
          />
          <span className="text-xs text-slate-500">
            Leave blank if the source does not establish it.
          </span>
        </label>
        <label className="text-sm">
          Period coverage
          <select
            className={field}
            value={fields.periodMode}
            onChange={(e) => set("periodMode", e.target.value)}
          >
            <option value="SINGLE_PERIOD">One specified tax period</option>
            <option value="MULTI_PERIOD">Across tax periods</option>
          </select>
          <span className="text-xs text-slate-500">
            Across periods uses the effective dates below. Explain conditions
            and continuing obligations in the applicability note.
          </span>
        </label>
        {fields.periodMode === "SINGLE_PERIOD" && (
          <label className="text-sm">
            Applicable tax period
            <input
              required
              className={field}
              placeholder="TY 2026-27"
              value={fields.period}
              onChange={(e) => set("period", e.target.value)}
            />
            <span className="text-xs text-slate-500">
              TY 2026-27 covers April 2026–March 2027. AY 2026-27 relates to
              April 2025–March 2026.
            </span>
          </label>
        )}
        <label className="text-sm">
          Effective from
          <input
            type="date"
            required
            className={field}
            value={fields.effectiveFrom}
            onChange={(e) => set("effectiveFrom", e.target.value)}
          />
          <span className="text-xs text-slate-500">
            When the selected rule or concept starts applying.
          </span>
        </label>
        <label className="text-sm">
          Rule expiry (optional, exclusive)
          <input
            type="date"
            className={field}
            value={fields.effectiveTo}
            onChange={(e) => set("effectiveTo", e.target.value)}
          />
          <span className="text-xs text-slate-500">
            Leave blank unless the rule itself expires. Do not put an investment
            deadline here.
          </span>
        </label>
      </div>
      <fieldset className="border rounded-lg p-4 space-y-4">
        <legend className="px-2 font-medium">
          Who and what does this apply to?
        </legend>
        <label className="block text-sm">
          Named entity (optional)
          <input
            className={field}
            maxLength={300}
            value={fields.entityName}
            onChange={(e) => set("entityName", e.target.value)}
            placeholder="Full legal name, if the document applies only to that entity"
          />
          <span className="text-xs text-slate-500">
            When supplied, chat uses this document only if the question includes
            this full name. Leave blank for general rules.
          </span>
        </label>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="text-sm">
            Eligible investments from (optional)
            <input
              type="date"
              required={!!fields.investmentThrough}
              className={field}
              value={fields.investmentFrom}
              onChange={(e) => set("investmentFrom", e.target.value)}
            />
          </label>
          <label className="text-sm">
            Eligible investments through (inclusive)
            <input
              type="date"
              required={!!fields.investmentFrom}
              className={field}
              value={fields.investmentThrough}
              onChange={(e) => set("investmentThrough", e.target.value)}
            />
          </label>
        </div>
        <p className="text-xs text-slate-500">
          These dates describe when investments can be made. Filing and other
          obligations may continue after the deadline.
        </p>
        <label className="block text-sm">
          Applicability and continuing obligations
          <textarea
            required={
              fields.periodMode === "MULTI_PERIOD" ||
              !!fields.investmentFrom ||
              !!fields.investmentThrough
            }
            maxLength={4000}
            className={`${field} min-h-28`}
            value={fields.applicabilityNote}
            onChange={(e) => set("applicabilityNote", e.target.value)}
            placeholder="Explain the reviewed scope, conditions and obligations that continue into later periods."
          />
        </label>
      </fieldset>
      <label className="block text-sm">
        Review note
        <textarea
          required
          className={`${field} min-h-28`}
          value={fields.note}
          onChange={(e) => set("note", e.target.value)}
          placeholder="Explain what you reviewed and why these dates and this period apply."
        />
      </label>
      <div className="flex flex-wrap gap-4 items-center">
        <button
          type="button"
          disabled={busy}
          className="border rounded-lg px-4 py-2 text-sm disabled:opacity-40"
          onClick={() =>
            void act({
              action: "saveDraft",
              versionId: version.id,
              revision: version.draft?.revision ?? 0,
              draft: { ...fields, sectionIds: selected },
            })
          }
        >
          Save draft
        </button>
        {version.draft && (
          <span className="text-xs text-slate-500">
            Draft saved {new Date(version.draft.updatedAt).toLocaleString()}.
            Saving does not publish.
          </span>
        )}
        <button
          disabled={busy || !selected.length}
          className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm disabled:opacity-40"
        >
          Approve selected sections and publish
        </button>
        <button
          type="button"
          disabled={busy || !fields.note.trim()}
          className="text-sm text-red-700 underline disabled:opacity-40"
          onClick={() =>
            void act({
              action: "reject",
              versionId: version.id,
              note: fields.note,
            })
          }
        >
          Reject document
        </button>
      </div>
      <details className="text-xs text-slate-500">
        <summary className="cursor-pointer">
          Original document and version details
        </summary>
        <p className="break-all mt-2">
          Version {version.id} · SHA-256 {version.hash}
        </p>
        <pre className="whitespace-pre-wrap max-h-80 overflow-auto bg-slate-50 p-3 mt-2">
          {version.text}
        </pre>
      </details>
    </form>
  );
}

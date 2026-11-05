import Link from "next/link";
import { knowledgeCoverage } from "@/lib/tax/coverage";
import { validPeriod } from "@/lib/tax/registry";
export const metadata = { title: "Reviewed source library" };
export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const params = await searchParams;
  const indiaYear = Number(
    new Intl.DateTimeFormat("en", {
      year: "numeric",
      timeZone: "Asia/Kolkata",
    }).format(new Date()),
  );
  const period = validPeriod(params.period)
    ? params.period
    : `TY ${indiaYear}-${String((indiaYear + 1) % 100).padStart(2, "0")}`;
  const coverage = await knowledgeCoverage(period);
  return (
    <main className="max-w-4xl mx-auto px-6 py-12 space-y-6">
      <h1 className="text-3xl font-semibold">Reviewed source library</h1>
      <p className="text-slate-600">
        The assistant answers from selected, reviewed passages in these official
        central income-tax documents. Listing a document does not mean every
        section is covered. GST, tax calculations and filing are outside the
        current release.
      </p>
      <form className="flex flex-wrap gap-3 items-end">
        <label className="text-sm">
          Tax period
          <input
            name="period"
            defaultValue={period}
            placeholder="TY 2026-27"
            pattern="(FY|AY|TY) 20[0-9]{2}-[0-9]{2}"
            required
            className="block border rounded-lg p-2 mt-1"
          />
        </label>
        <button className="rounded-lg bg-slate-900 text-white px-4 py-2">
          Check coverage
        </button>
      </form>
      <p className="font-medium">
        {coverage.availableDocuments} documents currently available for {period}
      </p>
      {!!coverage.unavailableDocuments && (
        <p className="text-amber-800">
          {coverage.unavailableDocuments} additional reviewed documents are
          unavailable because a source check is overdue or failed.
        </p>
      )}
      {!coverage.documents.length && (
        <p>
          No matching fresh approved sources. The assistant will explain the
          evidence limitation.
        </p>
      )}
      {coverage.documents.map((doc) => (
        <article key={doc.url} className="border rounded-xl p-5 space-y-2">
          <a
            href={doc.url}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-emerald-700 underline"
          >
            {doc.title}
          </a>
          <p className="text-sm text-slate-500">
            Last source verification:{" "}
            {doc.checkedAt?.toISOString().slice(0, 10)}
          </p>
          {doc.entityName && (
            <p className="text-sm">
              Restricted to {doc.entityName}. Include the full name in your
              question.
            </p>
          )}
        </article>
      ))}
      <p className="text-sm text-slate-500">
        Source availability is checked at request time. New or changed documents
        require review before publication.{" "}
        <Link href="/" className="underline">
          Return to the assistant
        </Link>
        .
      </p>
    </main>
  );
}

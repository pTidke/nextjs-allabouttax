import Link from "next/link";
import { knowledgeCoverage } from "@/lib/tax/coverage";
import { validPeriod } from "@/lib/tax/registry";

export const metadata = { title: "The library" };

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const params = await searchParams;
  const period = validPeriod(params.period) ? params.period : null;
  const coverage = await knowledgeCoverage(period);
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 pb-24 pt-16">
      <header className="flex flex-col gap-4 border-b-[3px] border-double border-ink pb-8">
        <h1 className="font-serif text-4xl font-bold tracking-tight md:text-5xl">
          The library
        </h1>
        <p className="max-w-2xl text-lg text-ink-soft">
          The official central income-tax documents the assistant answers from.
          Each one has been checked word for word and by a chartered accountant.
          A document being listed doesn&apos;t mean every part of it is covered.
        </p>
      </header>

      <form className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-[1_1_16rem] flex-col gap-1.5">
          <span className="font-medium">Tax year</span>
          <input
            name="period"
            defaultValue={period ?? ""}
            placeholder="All years, or e.g. FY 2026-27"
            pattern="(FY|AY|TY) 20[0-9]{2}-[0-9]{2}"
            className="min-h-12 border border-ink bg-paper px-4"
          />
        </label>
        <button className="min-h-12 cursor-pointer bg-ink px-6 font-semibold text-paper hover:bg-brand-strong">
          Show
        </button>
        {period && (
          <Link href="/library" className="flex min-h-12 items-center px-2">
            Clear
          </Link>
        )}
      </form>

      <section aria-labelledby="count" className="flex flex-col gap-4">
        <h2 id="count" className="text-xl font-semibold">
          {coverage.availableDocuments}{" "}
          {coverage.availableDocuments === 1 ? "document" : "documents"} ready
          {period ? ` for ${period}` : " across all tax years"}
        </h2>
        {!!coverage.unavailableDocuments && (
          <p className="border-l-4 border-ink bg-paper px-4 py-3">
            {coverage.unavailableDocuments} more checked{" "}
            {coverage.unavailableDocuments === 1 ? "document is" : "documents are"}{" "}
            paused while their source is checked again.
          </p>
        )}
        {!coverage.documents.length ? (
          <p className="border border-dashed border-ink bg-paper px-5 py-6 text-ink-soft">
            Nothing is ready for this tax year yet. The assistant will say so
            rather than guess.
          </p>
        ) : (
          <ul className="border-t border-ink">
            {coverage.documents.map((doc) => (
              <li
                key={doc.url}
                className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-rule py-4"
              >
                <span className="flex min-w-0 flex-[1_1_20rem] flex-col gap-1">
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold"
                  >
                    {doc.title} <span aria-hidden="true">↗</span>
                  </a>
                  {doc.entityName && (
                    <span className="text-[15px] text-ink-soft">
                      Only for {doc.entityName}. Use the full name in your
                      question.
                    </span>
                  )}
                </span>
                {doc.checkedAt && (
                  <span className="font-mono text-[13px] text-ink-soft">
                    source checked {doc.checkedAt.toISOString().slice(0, 10)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-ink-soft">
        New and changed documents are checked before they appear here.{" "}
        <Link href="/ask">Ask a question →</Link>
      </p>
    </main>
  );
}

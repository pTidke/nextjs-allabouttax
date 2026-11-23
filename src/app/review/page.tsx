import Link from "next/link";
import {
  QUEUE_CATEGORIES,
  QUEUE_FILTERS,
  reviewQueue,
  type QueueCategory,
  type QueueFilter,
} from "@/lib/review/workflow";
import { pageAccess } from "./guard";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Review",
  robots: { index: false, follow: false },
};

// The same three steps as a document's page (AD-48).
const labels: Record<QueueFilter, string> = {
  text: "1. Check the words",
  tax: "2. Check the details",
  ocr: "Waiting to be read",
  uploads: "Uploaded",
  all: "Everything waiting",
};

const categoryLabels: Record<QueueCategory, string> = {
  all: "All kinds",
  circulars: "Circulars",
  notifications: "Notifications",
  guidance: "Guidance pages",
  uploads: "Uploads",
};

function status(
  item: Awaited<ReturnType<typeof reviewQueue>>["items"][number],
) {
  if (!item.chunks && !item.hasRun)
    return {
      text: "Waiting to be read (within two hours)",
      tone: "border-rule bg-shade text-ink-soft",
    };
  if (item.textDecision === "ACCEPTED")
    return {
      text: "Words checked · details next",
      tone: "border-brand bg-brand-soft text-brand-strong",
    };
  if (item.textDecision === "NEEDS_CHANGES")
    return { text: "Sent back", tone: "border-red-800 bg-red-50 text-red-900" };
  return { text: "Words to check", tone: "border-ink bg-paper text-ink" };
}

export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{
    filter?: string;
    page?: string;
    category?: string;
    q?: string;
  }>;
}) {
  const access = await pageAccess();
  const params = await searchParams;
  // Your own steps first: the details (closest to publishing), then the words.
  const yours: QueueFilter[] = [
    ...(access.tax ? (["tax"] as const) : []),
    ...(access.extraction ? (["text"] as const) : []),
  ];
  const order: QueueFilter[] = ["text", "tax", "ocr", "all"];
  const requested = QUEUE_FILTERS.includes(params.filter as QueueFilter)
    ? (params.filter as QueueFilter)
    : null;
  const page = Math.max(0, Math.min(10000, Number(params.page) || 0));
  const category = QUEUE_CATEGORIES.includes(params.category as QueueCategory)
    ? (params.category as QueueCategory)
    : "all";
  const search = (params.q ?? "").slice(0, 100);
  const options = { category, query: search };
  let filter = requested ?? yours[0] ?? "all";
  let queue = await reviewQueue(filter, page, options);
  // With nothing in your first step, open the next step that has something.
  if (!requested && !queue.items.length)
    for (const f of yours.slice(1))
      if (queue.counts[f]) {
        filter = f;
        queue = await reviewQueue(f, 0, options);
        break;
      }
  const next =
    yours.includes(filter) && category === "all" && !search
      ? queue.items[0]
      : undefined;
  // Links keep the step, the kind and the search unless they change them.
  const href = (change: {
    filter?: QueueFilter;
    category?: QueueCategory;
    page?: number;
  }) => {
    const query = new URLSearchParams({ filter: change.filter ?? filter });
    const c = change.category ?? category;
    if (c !== "all") query.set("category", c);
    if (search) query.set("q", search);
    if (change.page) query.set("page", String(change.page));
    return `/review?${query}`;
  };
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 pb-20 pt-10">
      <header className="flex flex-wrap items-end gap-4 border-b-[3px] border-double border-ink pb-6">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="label-mono text-brand">Review desk</p>
          <h1 className="font-serif text-4xl font-bold">Documents to check</h1>
          <p className="text-ink-soft">
            Each document is checked in two steps, the words and then the
            details, before the chatbot can use it.
          </p>
        </div>
        <nav className="flex flex-wrap gap-2 text-[15px]">
          {(access.extraction || access.admin) && (
            <Link
              href="/review/upload"
              className="flex min-h-11 items-center bg-ink px-4 text-paper no-underline hover:bg-brand-strong"
            >
              Upload a PDF
            </Link>
          )}
          {access.admin && (
            <Link
              href="/review/team"
              className="flex min-h-11 items-center border border-ink bg-paper px-4 no-underline hover:bg-shade"
            >
              Reviewers
            </Link>
          )}
        </nav>
      </header>

      {next && (
        <Link
          href={`/review/${next.versionId}`}
          className="flex flex-wrap items-center gap-x-4 gap-y-1 border-2 border-ink bg-ink px-5 py-4 text-paper no-underline hover:bg-brand-strong"
        >
          <span className="bg-brand-soft px-2 py-0.5 font-mono text-xs font-semibold text-ink">
            NEXT FOR YOU
          </span>
          <span className="min-w-0 flex-[1_1_18rem]">
            <span className="text-rule">
              {labels[filter].replace(/^\d\. /, "")} ·{" "}
            </span>
            <strong className="font-semibold">{next.title}</strong>
          </span>
          <span className="font-semibold">Start →</span>
        </Link>
      )}

      <section className="border border-ink bg-paper">
        <nav
          aria-label="Step"
          className="grid grid-cols-2 gap-px border-b border-ink bg-rule md:grid-cols-4"
        >
          {order.map((f) => (
            <Link
              key={f}
              href={href({ filter: f })}
              aria-current={f === filter ? "page" : undefined}
              className={`flex min-h-14 flex-col justify-center px-4 py-2 no-underline ${f === filter ? "bg-ink text-paper" : "bg-paper hover:bg-shade"}`}
            >
              <span className="font-semibold">
                {labels[f].replace(/^\d\. /, "")}
              </span>
              <span
                className={`font-mono text-xs ${f === filter ? "text-rule" : "text-ink-soft"}`}
              >
                {f === "text" ? "STEP 1 · " : f === "tax" ? "STEP 2 · " : ""}
                {queue.counts[f]} waiting
              </span>
            </Link>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-rule bg-shade px-4 py-3 text-[15px]">
          <nav aria-label="Kind of document" className="flex flex-wrap">
            {QUEUE_CATEGORIES.filter(
              (c) => c === "all" || c === category || queue.categories[c] > 0,
            ).map((c, i) => (
              <Link
                key={c}
                href={href({ category: c })}
                aria-current={c === category ? "page" : undefined}
                className={`flex min-h-10 items-center border border-ink px-3 no-underline ${i ? "-ml-px" : ""} ${c === category ? "bg-ink text-paper" : "bg-paper hover:bg-shade"}`}
              >
                {categoryLabels[c]} ({queue.categories[c]})
              </Link>
            ))}
          </nav>
          <form
            action="/review"
            className="flex min-w-0 flex-[1_1_18rem] items-center gap-2"
          >
            <input type="hidden" name="filter" value={filter} />
            {category !== "all" && (
              <input type="hidden" name="category" value={category} />
            )}
            <input
              type="search"
              name="q"
              defaultValue={search}
              maxLength={100}
              placeholder="Find by title or number, e.g. 3/2026 or 10(46)"
              aria-label="Find a document"
              className="min-h-10 min-w-0 flex-1 border border-ink bg-paper px-3"
            />
            <button className="min-h-10 cursor-pointer border border-ink bg-paper px-4 hover:bg-shade">
              Find
            </button>
            {search && (
              <Link
                href={`/review?filter=${filter}${category !== "all" ? `&category=${category}` : ""}`}
              >
                Clear
              </Link>
            )}
          </form>
        </div>

        {!queue.items.length && (
          <p className="px-5 py-8 text-ink-soft">
            {search || category !== "all"
              ? "No documents match. Try another kind, step or search."
              : "Nothing here right now."}
          </p>
        )}
        <ul>
          {queue.items.map((item) => {
            const state = status(item);
            return (
              <li
                key={item.versionId}
                className="border-b border-rule last:border-b-0"
              >
                <Link
                  href={`/review/${item.versionId}`}
                  className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-4 no-underline hover:bg-shade"
                >
                  <span className="flex min-w-0 flex-[1_1_22rem] flex-col gap-1">
                    <span className="font-semibold">{item.title}</span>
                    <span className="text-sm text-ink-soft">
                      {item.sourceKind === "UPLOAD"
                        ? "Uploaded"
                        : item.sourceName}
                      {item.issuedAt &&
                        ` · issued ${item.issuedAt.toISOString().slice(0, 10)}`}
                      {` · added ${item.fetchedAt.toISOString().slice(0, 10)}`}
                    </span>
                    {item.textDecision === "NEEDS_CHANGES" && item.textNote && (
                      <span className="text-sm text-red-800">
                        {item.textNote}
                      </span>
                    )}
                  </span>
                  <span
                    className={`border px-2.5 py-0.5 font-mono text-xs ${state.tone}`}
                  >
                    {state.text}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        <nav className="flex items-center gap-3 border-t border-ink px-4 py-3 text-[15px]">
          <span className="text-ink-soft">Page {page + 1}</span>
          <span className="ml-auto flex">
            {page > 0 && (
              <Link
                href={href({ page: page - 1 })}
                className="flex min-h-10 items-center border border-ink bg-paper px-3 no-underline hover:bg-shade"
              >
                ← Previous
              </Link>
            )}
            {queue.hasMore && (
              <Link
                href={href({ page: page + 1 })}
                className="-ml-px flex min-h-10 items-center border border-ink bg-paper px-3 no-underline hover:bg-shade"
              >
                Next →
              </Link>
            )}
          </span>
        </nav>
      </section>
    </main>
  );
}

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
      tone: "bg-slate-100 text-slate-600",
    };
  if (item.textDecision === "ACCEPTED")
    return {
      text: "Words checked · details next",
      tone: "bg-emerald-100 text-emerald-900",
    };
  if (item.textDecision === "NEEDS_CHANGES")
    return { text: "Sent back", tone: "bg-red-100 text-red-900" };
  return { text: "Words to check", tone: "bg-amber-100 text-amber-900" };
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
    <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Review</h1>
          <p className="text-slate-600 mt-1">
            Each document is checked in two steps, the words and then the
            details, before the chatbot can use it.
          </p>
        </div>
        <nav className="flex gap-4 text-sm">
          {(access.extraction || access.admin) && (
            <Link
              href="/review/upload"
              className="rounded-lg bg-emerald-700 text-white px-4 py-2"
            >
              Upload a PDF
            </Link>
          )}
          {access.admin && (
            <Link href="/review/team" className="rounded-lg border px-4 py-2">
              Reviewers
            </Link>
          )}
        </nav>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="Filter the queue">
        {order.map((f) => (
          <Link
            key={f}
            href={href({ filter: f })}
            aria-current={f === filter ? "page" : undefined}
            className={`rounded-full border px-4 py-1.5 text-sm ${f === filter ? "bg-slate-900 text-white border-slate-900" : "bg-white"}`}
          >
            {labels[f]} ({queue.counts[f]})
          </Link>
        ))}
      </nav>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <nav
          className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1"
          aria-label="Kind of document"
        >
          {QUEUE_CATEGORIES.filter(
            (c) => c === "all" || c === category || queue.categories[c] > 0,
          ).map((c) => (
            <Link
              key={c}
              href={href({ category: c })}
              aria-current={c === category ? "page" : undefined}
              className={`rounded-md px-3 py-1 text-sm ${c === category ? "bg-white font-medium shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
            >
              {categoryLabels[c]} ({queue.categories[c]})
            </Link>
          ))}
        </nav>
        <form action="/review" className="flex flex-1 items-center gap-2">
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
            className="min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm"
          />
          <button className="rounded-lg border px-3 py-1.5 text-sm">
            Find
          </button>
          {search && (
            <Link
              href={`/review?filter=${filter}${category !== "all" ? `&category=${category}` : ""}`}
              className="text-sm underline"
            >
              Clear
            </Link>
          )}
        </form>
      </div>

      {next && (
        <Link
          href={`/review/${next.versionId}`}
          className="flex items-center justify-between gap-4 rounded-xl bg-slate-900 p-4 text-white hover:bg-slate-800"
        >
          <span>
            <span className="block text-sm text-slate-300">
              Next for you · {labels[filter].replace(/^\d\. /, "")}
            </span>
            <span className="font-medium">{next.title}</span>
          </span>
          <span className="shrink-0 font-medium">Start →</span>
        </Link>
      )}
      {!queue.items.length && (
        <p className="text-slate-500">
          {search || category !== "all"
            ? "No documents match. Try another kind, step or search."
            : "Nothing here right now."}
        </p>
      )}
      <ul className="space-y-3">
        {queue.items.map((item) => {
          const state = status(item);
          return (
            <li key={item.versionId}>
              <Link
                href={`/review/${item.versionId}`}
                className="block border rounded-xl p-4 hover:bg-slate-50 space-y-2"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <span className="font-medium">{item.title}</span>
                  <span
                    className={`text-xs rounded-full px-3 py-1 ${state.tone}`}
                  >
                    {state.text}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  {item.sourceKind === "UPLOAD" ? "Uploaded" : item.sourceName}
                  {item.issuedAt &&
                    ` · issued ${item.issuedAt.toISOString().slice(0, 10)}`}
                  {` · added ${item.fetchedAt.toISOString().slice(0, 10)}`}
                </p>
                {item.textDecision === "NEEDS_CHANGES" && item.textNote && (
                  <p className="text-xs text-red-800">{item.textNote}</p>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <nav className="flex gap-4 text-sm">
        {page > 0 && (
          <Link href={href({ page: page - 1 })} className="underline">
            Previous
          </Link>
        )}
        <span>Page {page + 1}</span>
        {queue.hasMore && (
          <Link href={href({ page: page + 1 })} className="underline">
            Next
          </Link>
        )}
      </nav>
    </main>
  );
}

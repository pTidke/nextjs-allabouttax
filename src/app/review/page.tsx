import Link from "next/link";
import {
  QUEUE_FILTERS,
  reviewQueue,
  type QueueFilter,
} from "@/lib/review/workflow";
import { pageAccess } from "./guard";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Review",
  robots: { index: false, follow: false },
};

const labels: Record<QueueFilter, string> = {
  text: "Needs text check",
  tax: "Ready for tax review",
  ocr: "Needs OCR",
  uploads: "Uploaded",
  all: "All pending",
};
const order: QueueFilter[] = ["text", "tax", "ocr", "uploads", "all"];

function status(
  item: Awaited<ReturnType<typeof reviewQueue>>["items"][number],
) {
  if (!item.chunks && !item.hasRun)
    return { text: "Needs OCR", tone: "bg-amber-100 text-amber-900" };
  if (item.textDecision === "ACCEPTED")
    return {
      text: "Text checked · ready for tax review",
      tone: "bg-emerald-100 text-emerald-900",
    };
  if (item.textDecision === "NEEDS_CHANGES")
    return { text: "Text problems reported", tone: "bg-red-100 text-red-900" };
  return { text: "Needs text check", tone: "bg-slate-100 text-slate-800" };
}

export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  const access = await pageAccess();
  const params = await searchParams;
  const fallback: QueueFilter =
    access.tax && !access.extraction ? "tax" : "text";
  const filter = QUEUE_FILTERS.includes(params.filter as QueueFilter)
    ? (params.filter as QueueFilter)
    : fallback;
  const page = Math.max(0, Math.min(10000, Number(params.page) || 0));
  const queue = await reviewQueue(filter, page);
  const href = (f: QueueFilter, p = 0) =>
    `/review?filter=${f}${p ? `&page=${p}` : ""}`;
  return (
    <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Review</h1>
          <p className="text-slate-600 mt-1">
            Check that the extracted text matches each original, then review its
            tax applicability. Nothing reaches the chatbot until both are done.
          </p>
          <p className="text-xs text-slate-500 mt-2">
            Your access:{" "}
            {[
              access.extraction && "text check",
              access.tax && "tax review",
              access.admin && "administrator",
            ]
              .filter(Boolean)
              .join(", ")}
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
            href={href(f)}
            aria-current={f === filter ? "page" : undefined}
            className={`rounded-full border px-4 py-1.5 text-sm ${f === filter ? "bg-slate-900 text-white border-slate-900" : "bg-white"}`}
          >
            {labels[f]} ({queue.counts[f]})
          </Link>
        ))}
      </nav>

      {!queue.items.length && (
        <p className="text-slate-500">Nothing here right now.</p>
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
                  {` · fetched ${item.fetchedAt.toISOString().slice(0, 10)}`}
                  {` · ${item.chunks} ${item.chunks === 1 ? "passage" : "passages"}`}
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
          <Link href={href(filter, page - 1)} className="underline">
            Previous
          </Link>
        )}
        <span>Page {page + 1}</span>
        {queue.hasMore && (
          <Link href={href(filter, page + 1)} className="underline">
            Next
          </Link>
        )}
      </nav>
    </main>
  );
}

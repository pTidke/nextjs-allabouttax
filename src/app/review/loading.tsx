// Shown at once while the server reads the queue or a document and its engine
// result, which can take a few seconds on the free database tier.
export default function Loading() {
  return (
    <main className="max-w-7xl mx-auto px-4 md:px-6 py-8 space-y-4">
      <div role="status" className="flex items-center gap-3 text-slate-600">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-600" />
        Loading…
      </div>
      <div className="grid gap-4 lg:grid-cols-2" aria-hidden>
        <div className="h-[60vh] animate-pulse rounded-xl bg-slate-100" />
        <div className="space-y-3">
          <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
          <div className="h-40 animate-pulse rounded-xl bg-slate-100" />
        </div>
      </div>
    </main>
  );
}

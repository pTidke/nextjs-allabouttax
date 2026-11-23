// Shown at once while the server reads the queue or a document and its engine
// result, which can take a few seconds on the free database tier.
export default function Loading() {
  return (
    <main className="max-w-7xl mx-auto px-4 md:px-6 py-8 space-y-4">
      <div role="status" className="flex items-center gap-3 text-ink-soft">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-rule border-t-brand" />
        Loading…
      </div>
      <div className="grid gap-4 lg:grid-cols-2" aria-hidden>
        <div className="h-[60vh] animate-pulse bg-shade" />
        <div className="space-y-3">
          <div className="h-24 animate-pulse bg-shade" />
          <div className="h-40 animate-pulse bg-shade" />
        </div>
      </div>
    </main>
  );
}

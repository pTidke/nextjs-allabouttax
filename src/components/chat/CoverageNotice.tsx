"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
type Coverage = {
  availableDocuments: number;
  generalDocuments: number;
  entitySpecificDocuments: number;
  unavailableDocuments: number;
};
// What the assistant can currently answer from, across all tax years.
export default function CoverageNotice() {
  const [state, setState] = useState<{
    coverage?: Coverage;
    error?: boolean;
  } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void fetch("/api/knowledge/coverage", {
      cache: "no-store",
      signal: abort.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((coverage) => {
        if (!abort.signal.aborted) setState({ coverage });
      })
      .catch(() => {
        if (!abort.signal.aborted) setState({ error: true });
      });
    return () => abort.abort();
  }, []);
  return (
    <div
      role="status"
      className="px-4 md:px-8 py-2 bg-amber-50 text-xs text-slate-700 border-b border-amber-100"
    >
      {!state
        ? "Checking reviewed coverage…"
        : state.error
          ? "Coverage could not be checked. Answers still require fresh approved sources."
          : state.coverage!.availableDocuments === 0
            ? "No fresh approved sources are available yet. Questions may receive an evidence limitation."
            : `Answers come from ${state.coverage!.generalDocuments} general and ${state.coverage!.entitySpecificDocuments} entity-specific reviewed documents. Name the tax year if your question is about a particular one.`}{" "}
      <Link href="/library" className="underline">
        View source coverage
      </Link>
    </div>
  );
}

"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
type Coverage = {
  availableDocuments: number;
  generalDocuments: number;
  entitySpecificDocuments: number;
  unavailableDocuments: number;
};
export default function CoverageNotice({ period }: { period: string }) {
  const [state, setState] = useState<{
    period: string;
    coverage?: Coverage;
    error?: boolean;
  } | null>(null);
  useEffect(() => {
    if (!period) return;
    const abort = new AbortController();
    void fetch(`/api/knowledge/coverage?period=${encodeURIComponent(period)}`, {
      cache: "no-store",
      signal: abort.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((coverage) => {
        if (!abort.signal.aborted) setState({ period, coverage });
      })
      .catch(() => {
        if (!abort.signal.aborted) setState({ period, error: true });
      });
    return () => abort.abort();
  }, [period]);
  if (!period) return null;
  const current = state?.period === period ? state : null;
  return (
    <div
      role="status"
      className="px-4 md:px-8 py-2 bg-amber-50 text-xs text-slate-700 border-b border-amber-100"
    >
      {!current
        ? "Checking reviewed coverage…"
        : current.error
          ? "Coverage could not be checked. Answers still require fresh approved sources."
          : current.coverage!.availableDocuments === 0
            ? `No fresh approved sources are available for ${period}. Questions may receive an evidence limitation.`
            : `${current.coverage!.generalDocuments} general and ${current.coverage!.entitySpecificDocuments} entity-specific reviewed documents available for ${period}. Coverage is limited to those documents.`}{" "}
      <Link
        href={`/library?period=${encodeURIComponent(period)}`}
        className="underline"
      >
        View source coverage
      </Link>
    </div>
  );
}

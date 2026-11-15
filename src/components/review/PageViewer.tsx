"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist";
import type { LineForReview } from "@/lib/review/extraction-runs";

// Draws one page of the original with pdf.js and lays the engine's line boxes
// over it. Boxes are in PDF points from the top-left of the page, as the engine
// reports them, so they are scaled by (drawn width / page width).

type PageSize = {
  number: number;
  width: number;
  height: number;
  rotation: number;
};

let workerReady = false;
async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");
  if (!workerReady) {
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(
      new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
      { type: "module" },
    );
    workerReady = true;
  }
  return pdfjs;
}

const tone: Record<string, string> = {
  flagged: "bg-amber-300/35 border-amber-500",
  blocked: "bg-red-300/40 border-red-600",
  accepted:
    "border-emerald-600/40 hover:border-emerald-600 hover:bg-emerald-200/20",
  excluded: "border-slate-400 border-dashed hover:bg-slate-200/30",
};

export default function PageViewer({
  src,
  linesUrl,
  pages,
  page,
  onPage,
  selected,
  onSelect,
}: {
  src: string;
  // Null when the engine has not read this document: the page is shown without boxes.
  linesUrl: string | null;
  pages: PageSize[] | null;
  page: number;
  onPage: (page: number) => void;
  selected: string | null;
  onSelect: (line: LineForReview) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // State, not a ref: drawing must run again once the document has loaded.
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(pages?.length ?? 0);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [drawn, setDrawn] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [lines, setLines] = useState<LineForReview[]>([]);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let loading: PDFDocumentLoadingTask | null = null;
    void loadPdfJs()
      .then((pdfjs) => {
        if (cancelled) return null;
        loading = pdfjs.getDocument({ url: src, withCredentials: true });
        return loading.promise;
      })
      .then((doc) => {
        if (!doc || cancelled) return;
        setDoc(doc);
        setPageCount(doc.numPages);
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "The original could not be displayed here. Open it in a new tab instead.",
          );
      });
    return () => {
      cancelled = true;
      setDoc(null);
      void (loading as PDFDocumentLoadingTask | null)?.destroy();
    };
  }, [src]);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.floor(entry.contentRect.width)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let task: RenderTask | null = null;
    let cancelled = false;
    async function draw() {
      const target = canvas.current;
      if (!doc || !target || !width || page > doc.numPages) return;
      const pdfPage = await doc.getPage(page);
      const natural = pdfPage.getViewport({ scale: 1 });
      const scale = (width / natural.width) * zoom;
      const viewport = pdfPage.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      target.width = Math.floor(viewport.width * ratio);
      target.height = Math.floor(viewport.height * ratio);
      target.style.width = `${viewport.width}px`;
      target.style.height = `${viewport.height}px`;
      task = pdfPage.render({
        canvas: target,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      await task.promise;
      if (!cancelled)
        setDrawn({ width: viewport.width, height: viewport.height });
    }
    void draw().catch((e) => {
      if (!cancelled && (e as Error)?.name !== "RenderingCancelledException")
        setError("This page could not be drawn.");
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page, width, zoom]);

  useEffect(() => {
    if (!linesUrl) return;
    const abort = new AbortController();
    void fetch(`${linesUrl}?page=${page}`, {
      cache: "no-store",
      signal: abort.signal,
    })
      .then((r) => (r.ok ? r.json() : { lines: [] }))
      .then((body) => setLines(body.lines ?? []))
      .catch(() => {});
    return () => abort.abort();
  }, [linesUrl, page]);

  const size = pages?.find((p) => p.number === page);
  const rotated = !!size?.rotation;
  const factor = size && drawn ? drawn.width / size.width : 0;
  const box = useCallback(
    (line: LineForReview) => ({
      left: line.box.x0 * factor - 4,
      top: line.box.top * factor - 2,
      width: (line.box.x1 - line.box.x0) * factor + 8,
      height: (line.box.bottom - line.box.top) * factor + 4,
    }),
    [factor],
  );

  useEffect(() => {
    if (!selected) return;
    document
      .getElementById(`box-${selected}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selected, lines, drawn]);

  const visible = lines.filter(
    (line) => showAll || line.status !== "accepted" || line.id === selected,
  );
  const button =
    "rounded-md border px-2.5 py-1 text-sm bg-white disabled:opacity-40";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          className={button}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        <span>
          Page {page} of {pageCount || "…"}
        </span>
        <button
          type="button"
          className={button}
          disabled={!pageCount || page >= pageCount}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
        <span className="mx-1 text-slate-300">|</span>
        <button
          type="button"
          className={button}
          onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
          aria-label="Zoom out"
        >
          −
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className={button}
          onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
          aria-label="Zoom in"
        >
          +
        </button>
        <button type="button" className={button} onClick={() => setZoom(1)}>
          Fit width
        </button>
        {linesUrl && (
          <label className="flex items-center gap-1.5 ml-auto">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            Outline every line
          </label>
        )}
      </div>
      {rotated && (
        <p className="text-xs text-amber-800">
          This page is rotated, so line positions are not drawn on it.
        </p>
      )}
      {error && <p className="text-sm text-red-800">{error}</p>}
      <div
        ref={frame}
        className="h-[78vh] overflow-auto rounded-xl border bg-slate-100"
      >
        <div className="relative mx-auto w-fit">
          <canvas ref={canvas} className="block bg-white shadow" />
          {!!factor &&
            !rotated &&
            visible.map((line) => (
              <button
                key={line.id}
                id={`box-${line.id}`}
                type="button"
                title={
                  line.flags.map((flag) => flag.message).join(" ") || line.text
                }
                onClick={() => onSelect(line)}
                style={box(line)}
                className={`absolute rounded-sm border-2 ${line.excluded ? tone.excluded : tone[line.status]} ${
                  line.id === selected
                    ? "ring-4 ring-sky-500/70 border-sky-600"
                    : ""
                }`}
              />
            ))}
        </div>
      </div>
    </div>
  );
}

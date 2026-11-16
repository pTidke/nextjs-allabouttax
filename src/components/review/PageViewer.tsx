"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RenderTask } from "pdfjs-dist";
import type { LineForReview } from "@/lib/review/extraction-runs";
import { Spinner, usePdf } from "./pdf";

// Draws one page of the original with pdf.js. The line being checked is outlined;
// every other line can be outlined on request. Boxes are in PDF points from the
// top-left of the page's visible area, as the engine reports them, so they are
// scaled by (drawn width / page width).

type PageSize = {
  number: number;
  width: number;
  height: number;
  rotation: number;
};

const tone: Record<string, string> = {
  flagged: "bg-amber-300/35 border-amber-500",
  blocked: "bg-red-300/40 border-red-600",
  accepted:
    "border-emerald-600/40 hover:border-emerald-600 hover:bg-emerald-200/20",
  excluded: "border-slate-400 border-dashed hover:bg-slate-200/30",
  // The word check's own colours (see WordCheck).
  look: "bg-amber-300/30 border-amber-500 hover:bg-amber-300/50",
  todo: "border-slate-400/50 hover:border-slate-600 hover:bg-slate-200/30",
  done: "bg-emerald-300/15 border-emerald-600/50 hover:border-emerald-700",
  problem: "bg-red-300/30 border-red-600",
  left: "border-slate-300 border-dashed",
};
export type Outline = {
  line: LineForReview;
  tone: "look" | "todo" | "done" | "problem" | "left";
};

export default function PageViewer({
  src,
  linesUrl,
  pages,
  page,
  onPage,
  current,
  onSelect,
  outlines,
  navigation = true,
}: {
  src: string;
  // Null when the engine has not read this document: the page is shown without boxes.
  linesUrl: string | null;
  pages: PageSize[] | null;
  page: number;
  onPage: (page: number) => void;
  // The line being checked, outlined when it is on this page.
  current: LineForReview | null;
  onSelect: (line: LineForReview) => void;
  // Every line of the page with its colour, from the caller. When given, the
  // page draws these and does not load its own lines.
  outlines?: Outline[];
  // False when the caller moves between pages itself.
  navigation?: boolean;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { doc, error: loadFailed } = usePdf(src);
  const pageCount = doc?.numPages ?? pages?.length ?? 0;
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [drawn, setDrawn] = useState<{
    key: string;
    width: number;
    height: number;
  } | null>(null);
  const [lines, setLines] = useState<LineForReview[]>([]);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const drawKey = `${page}:${width}:${zoom}`;

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
        setDrawn({
          key: `${page}:${width}:${zoom}`,
          width: viewport.width,
          height: viewport.height,
        });
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
    if (!linesUrl || !showAll || outlines) return;
    const abort = new AbortController();
    void fetch(`${linesUrl}?page=${page}`, {
      cache: "no-store",
      signal: abort.signal,
    })
      .then((r) => (r.ok ? r.json() : { lines: [] }))
      .then((body) => setLines(body.lines ?? []))
      .catch(() => {});
    return () => abort.abort();
  }, [linesUrl, page, showAll, outlines]);

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

  const shown = current?.page === page ? current : null;
  // Bring the outlined line into view inside the page frame only; the window
  // itself must not move, or the close-up above would scroll away.
  useEffect(() => {
    const scroller = frame.current;
    const target = shown && document.getElementById(`box-${shown.id}`);
    if (!scroller || !target || !factor) return;
    const outer = scroller.getBoundingClientRect();
    const inner = target.getBoundingClientRect();
    scroller.scrollTo({
      top:
        scroller.scrollTop +
        inner.top -
        outer.top -
        (scroller.clientHeight - inner.height) / 2,
      left:
        scroller.scrollLeft +
        inner.left -
        outer.left -
        (scroller.clientWidth - inner.width) / 2,
      behavior: "smooth",
    });
  }, [shown, factor]);

  const toneOf = new Map(outlines?.map((o) => [o.line.id, o.tone]));
  const visible = outlines
    ? [
        ...outlines
          .map((o) => o.line)
          .filter((line) => line.page === page && line.id !== shown?.id),
        ...(shown ? [shown] : []),
      ]
    : [
        ...(showAll
          ? lines.filter((line) => line.page === page && line.id !== shown?.id)
          : []),
        ...(shown ? [shown] : []),
      ];
  const ready = drawn?.key === drawKey;
  const button =
    "rounded-md border px-2.5 py-1 text-sm bg-white disabled:opacity-40";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {navigation && (
          <>
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
          </>
        )}
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
        {linesUrl && !outlines && (
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
      {(error || loadFailed) && (
        <p className="text-sm text-red-800">
          {error ||
            "The original could not be displayed here. Open it in a new tab instead."}
        </p>
      )}
      <div
        ref={frame}
        className="relative max-h-[78vh] min-h-48 overflow-auto rounded-xl border bg-slate-100"
      >
        {!ready && !error && !loadFailed && (
          <div className="absolute inset-x-0 top-6 z-10 flex justify-center">
            <span className="rounded-full bg-white px-3 py-1.5 shadow">
              <Spinner
                label={doc ? "Drawing the page…" : "Loading the original…"}
              />
            </span>
          </div>
        )}
        <div className="relative mx-auto w-fit">
          <canvas ref={canvas} className="block bg-white shadow" />
          {ready &&
            !!factor &&
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
                className={`absolute rounded-sm border-2 ${
                  line.id === shown?.id
                    ? "border-sky-600 bg-sky-300/20 ring-4 ring-sky-500/40"
                    : toneOf.has(line.id)
                      ? tone[toneOf.get(line.id)!]
                      : line.excluded
                        ? tone.excluded
                        : tone[line.status]
                }`}
              />
            ))}
        </div>
      </div>
    </div>
  );
}

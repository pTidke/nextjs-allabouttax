"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RenderTask } from "pdfjs-dist";
import type { EngineBox } from "@/lib/review/extraction-runs";
import type { QueueEntry, ReviewLine } from "@/lib/review/line-reviews";
import { needsOneByOne, oneByOneReason } from "@/lib/review/line-rules";
import PageViewer from "./PageViewer";
import { Spinner, usePdf } from "./pdf";

// The line-by-line text check: one line at a time, shown as a close-up of the
// original with the line outlined, the engine's readings below it, and four
// choices. A choice is saved and the next undecided line comes up.

type PageSize = {
  number: number;
  width: number;
  height: number;
  rotation: number;
};
type Decision = NonNullable<ReviewLine["decision"]>;

export const readers: Record<string, string> = {
  native: "PDF text layer",
  "ocr:tesseract": "OCR",
  "ocr:easyocr": "Second OCR",
};
// Engine messages name readers by their ids ("ocr:tesseract reads …").
const readable = (message: string) =>
  message.replace(
    /\b(native|ocr:tesseract|ocr:easyocr)\b/g,
    (id) => readers[id] ?? id,
  );
const decisionText: Record<string, string> = {
  CONFIRMED: "Text confirmed",
  CORRECTED: "Corrected",
  UNREADABLE: "Marked unreadable",
};

// The area around a line, in page points: the line with a little of the lines
// above and below, and at least a third of the page's width for context.
function cropAround(box: EngineBox, size: PageSize) {
  const height = Math.max(box.bottom - box.top, 6);
  const padY = Math.max(14, height * 1.4);
  let x0 = Math.max(0, box.x0 - 28);
  let x1 = Math.min(size.width, box.x1 + 28);
  const minWidth = Math.min(size.width, Math.max(260, size.width / 3));
  if (x1 - x0 < minWidth) {
    const grow = (minWidth - (x1 - x0)) / 2;
    x0 = Math.max(0, x0 - grow);
    x1 = Math.min(size.width, x0 + minWidth);
    x0 = Math.max(0, x1 - minWidth);
  }
  return {
    x0,
    x1,
    top: Math.max(0, box.top - padY),
    bottom: Math.min(size.height, box.bottom + padY),
  };
}

function LineCrop({
  src,
  line,
  size,
}: {
  src: string;
  line: ReviewLine;
  size: PageSize;
}) {
  const { doc, error: loadFailed } = usePdf(src);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [drawn, setDrawn] = useState("");
  const [failed, setFailed] = useState(false);
  const crop = cropAround(line.box, size);
  // CSS pixels per page point: fill the frame, but never more than 3x.
  const scale = width ? Math.min(width / (crop.x1 - crop.x0), 3) : 0;
  const key = `${line.id}:${scale}`;

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
      if (!doc || !target || !scale || line.page > doc.numPages) return;
      const page = await doc.getPage(line.page);
      // pdf.js and the engine both measure the page's visible area from its
      // top-left corner; this factor only covers a difference in units.
      const unit = page.getViewport({ scale: 1 }).width / size.width;
      const viewport = page.getViewport({
        scale: scale / unit,
        offsetX: -crop.x0 * scale,
        offsetY: -crop.top * scale,
      });
      const cssWidth = (crop.x1 - crop.x0) * scale;
      const cssHeight = (crop.bottom - crop.top) * scale;
      const ratio = window.devicePixelRatio || 1;
      target.width = Math.floor(cssWidth * ratio);
      target.height = Math.floor(cssHeight * ratio);
      target.style.width = `${cssWidth}px`;
      target.style.height = `${cssHeight}px`;
      task = page.render({
        canvas: target,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      await task.promise;
      if (!cancelled) {
        setDrawn(key);
        setFailed(false);
      }
    }
    void draw().catch((e) => {
      if (!cancelled && (e as Error)?.name !== "RenderingCancelledException")
        setFailed(true);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
    // crop is derived from line and size, which are in the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, key, size]);

  if (size.rotation)
    return (
      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
        This page is rotated, so no close-up is shown. Find the line on the
        whole page below.
      </p>
    );
  const ready = drawn === key;
  return (
    <div ref={frame} className={`relative w-full ${ready ? "" : "min-h-24"}`}>
      {(loadFailed || failed) && (
        <p className="text-sm text-red-800">
          The original could not be drawn here. Open it in a new tab instead.
        </p>
      )}
      {!ready && !loadFailed && !failed && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <span className="rounded-full bg-white px-3 py-1.5 shadow">
            <Spinner label={doc ? "Drawing…" : "Loading the original…"} />
          </span>
        </div>
      )}
      <div
        className={`relative mx-auto w-fit overflow-hidden rounded-lg border bg-white shadow-sm transition-opacity ${ready ? "" : "opacity-30"}`}
      >
        <canvas
          ref={canvas}
          className="block"
          aria-label={`Close-up of page ${line.page}`}
        />
        {ready && (
          <div
            aria-hidden
            className="pointer-events-none absolute rounded-sm border-2 border-amber-500 bg-amber-200/20"
            style={{
              left: (line.box.x0 - crop.x0) * scale - 3,
              top: (line.box.top - crop.top) * scale - 3,
              width: (line.box.x1 - line.box.x0) * scale + 6,
              height: (line.box.bottom - line.box.top) * scale + 6,
            }}
          />
        )}
      </div>
    </div>
  );
}

// Words of one reading that the other reading does not have, so a difference
// between the text layer and OCR stands out.
function Marked({ text, other }: { text: string; other: string | null }) {
  if (!text.trim()) return <em className="text-slate-400">nothing</em>;
  if (other === null) return <>{text}</>;
  const pool = new Map<string, number>();
  for (const word of other.split(/\s+/).filter(Boolean))
    pool.set(word, (pool.get(word) ?? 0) + 1);
  return (
    <>
      {text.split(/(\s+)/).map((part, i) => {
        if (!part.trim()) return part;
        const left = pool.get(part) ?? 0;
        if (left) {
          pool.set(part, left - 1);
          return part;
        }
        return (
          <mark key={i} className="rounded bg-amber-200 px-0.5">
            {part}
          </mark>
        );
      })}
    </>
  );
}

export default function LineReviewer({
  src,
  linesUrl,
  pages,
  runId,
  lines: allLines,
  canDecide,
  versionId,
  onChanged,
}: {
  src: string;
  linesUrl: string;
  pages: PageSize[];
  runId: string;
  // Every line a person can check, in reading order; "required" marks those
  // that need a decision before the text can be accepted.
  lines: QueueEntry[];
  canDecide: boolean;
  versionId: string;
  onChanged: () => void;
}) {
  // The lines the engine asks about, or, on request, every line.
  const [everyLine, setEveryLine] = useState(false);
  // A whole page at once: tick the page's lines and confirm them together.
  const [pageMode, setPageMode] = useState(false);
  const required = useMemo(
    () => allLines.filter((entry) => entry.required),
    [allLines],
  );
  const queue = everyLine ? allLines : required;
  // Decisions saved here but not yet in the page's data.
  const [saved, setSaved] = useState<Record<string, Decision>>({});
  const decided = useCallback(
    (entry: QueueEntry) => saved[entry.id]?.decision ?? entry.decision,
    [saved],
  );
  // The lines of each page, loaded when first needed.
  const [loaded, setLoaded] = useState<Record<number, ReviewLine[] | "failed">>(
    {},
  );
  const requested = useRef(new Set<number>());
  const load = useCallback(
    (page: number) => {
      if (requested.current.has(page)) return;
      requested.current.add(page);
      void fetch(`${linesUrl}?page=${page}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
        .then((body: { lines: ReviewLine[] }) =>
          setLoaded((old) => ({ ...old, [page]: body.lines })),
        )
        .catch(() => {
          requested.current.delete(page);
          setLoaded((old) => ({ ...old, [page]: "failed" }));
        });
    },
    [linesUrl],
  );
  const [currentId, setCurrentId] = useState<string | null>(
    () => (queue.find((entry) => !entry.decision) ?? queue[0])?.id ?? null,
  );
  const index = Math.max(
    0,
    queue.findIndex((line) => line.id === currentId),
  );
  const entry = queue[index] ?? null;
  const pageLines = entry ? loaded[entry.page] : undefined;
  const entryId = entry?.id;
  const line = useMemo(
    () =>
      (Array.isArray(pageLines) &&
        pageLines.find((candidate) => candidate.id === entryId)) ||
      null,
    [pageLines, entryId],
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(entry?.page ?? 1);
  const decidedCount = queue.filter(decided).length;
  const unreadable = required.filter((e) => decided(e) === "UNREADABLE").length;
  // Acceptance needs only the required lines.
  const allDecided = !!required.length && required.every(decided);

  const go = useCallback(
    (to: number) => {
      const next = queue[Math.min(Math.max(to, 0), queue.length - 1)];
      if (!next) return;
      setCurrentId(next.id);
      setPage(next.page);
      setEditing(false);
      setError("");
    },
    [queue],
  );

  useEffect(() => {
    if (pageMode) load(page);
  }, [load, page, pageMode]);

  // Load the current line's page, and the page of the next open line ahead.
  useEffect(() => {
    if (!entry) return;
    load(entry.page);
    const ahead = queue.slice(index + 1).find((e) => !decided(e));
    if (ahead) load(ahead.page);
  }, [decided, entry, index, load, queue]);

  const ocr = line?.other.find(
    (reading) => reading.text.trim() && reading.text !== line.text,
  );

  const decide = useCallback(
    async (decision: Decision["decision"], text?: string) => {
      if (!line || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch(`/api/review/${versionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "line",
            runId,
            lineId: line.id,
            decision,
            text,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "That did not save.");
        const record: Decision = {
          decision,
          text: result.text ?? null,
          reviewer: "you",
          at: new Date().toISOString(),
        };
        setSaved((old) => ({ ...old, [line.id]: record }));
        setEditing(false);
        // The next undecided line after this one, wrapping around.
        const isOpen = (e: QueueEntry) => e.id !== line.id && !decided(e);
        const after = queue.slice(index + 1).findIndex(isOpen);
        const before = queue.slice(0, index).findIndex(isOpen);
        if (after >= 0) go(index + 1 + after);
        else if (before >= 0) go(before);
        onChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That did not save.");
      } finally {
        setBusy(false);
      }
    },
    [busy, decided, go, index, line, onChanged, queue, runId, versionId],
  );

  const startEditing = useCallback(() => {
    if (!line) return;
    const current = saved[line.id] ?? line.decision;
    setDraft(current?.decision === "CORRECTED" ? current.text! : line.text);
    setEditing(true);
  }, [line, saved]);

  // Keyboard: 1 to 4 choose, the arrow keys move between lines.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        target?.closest("input, textarea, select, [contenteditable]")
      )
        return;
      if (pageMode) return;
      if (event.key === "ArrowRight") go(index + 1);
      else if (event.key === "ArrowLeft") go(index - 1);
      else if (!canDecide || editing) return;
      else if (event.key === "1") void decide("CONFIRMED");
      else if (event.key === "2" && ocr) void decide("CORRECTED", ocr.text);
      else if (event.key === "3") startEditing();
      else if (event.key === "4") void decide("UNREADABLE");
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canDecide, decide, editing, go, index, ocr, pageMode, startEditing]);

  const size = pages.find((p) => p.number === entry?.page);
  const decision = line ? (saved[line.id] ?? line.decision) : null;
  const button =
    "rounded-lg border px-3 py-2 text-sm bg-white hover:bg-slate-50 disabled:opacity-40 text-left";
  const key = (k: string) => (
    <kbd className="mr-1.5 rounded border bg-slate-50 px-1.5 text-xs text-slate-500">
      {k}
    </kbd>
  );

  function switchTo(all: boolean) {
    setEveryLine(all);
    setEditing(false);
    setError("");
    const list = all ? allLines : required;
    if (list.some((e) => e.id === currentId)) return;
    const next = list.find((e) => !decided(e)) ?? list[0];
    if (next) {
      setCurrentId(next.id);
      setPage(next.page);
    }
  }
  const tab = (active: boolean) =>
    `rounded-md px-3 py-1 text-sm ${active ? "bg-white shadow-sm font-medium" : "text-slate-600 hover:text-slate-900"}`;

  // Which lines to go through: the ones the engine asks about, or every line.
  const switcher = allLines.length > required.length && (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-50 p-2">
      <span className="text-sm text-slate-600">Go through</span>
      <div
        role="group"
        aria-label="Which lines to go through"
        className="inline-flex rounded-lg bg-slate-200/70 p-1"
      >
        <button
          type="button"
          aria-pressed={!everyLine}
          className={tab(!everyLine)}
          onClick={() => switchTo(false)}
        >
          Lines to check ({required.length})
        </button>
        <button
          type="button"
          aria-pressed={everyLine}
          className={tab(everyLine)}
          onClick={() => switchTo(true)}
        >
          Every line ({allLines.length})
        </button>
      </div>
      <span className="text-xs text-slate-500">
        {everyLine
          ? "Lines the engine accepted can be checked too; it is optional."
          : "To check more lines than the engine asked about, choose Every line."}
      </span>
    </div>
  );

  const modes = canDecide && (
    <div
      role="group"
      aria-label="How to check"
      className="inline-flex rounded-lg bg-slate-200/70 p-1"
    >
      <button
        type="button"
        aria-pressed={!pageMode}
        className={tab(!pageMode)}
        onClick={() => setPageMode(false)}
      >
        One line at a time
      </button>
      <button
        type="button"
        aria-pressed={pageMode}
        className={tab(pageMode)}
        onClick={() => {
          setPageMode(true);
          setEditing(false);
        }}
      >
        A whole page at once
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      {modes}
      {pageMode ? (
        <PageChecklist
          key={page}
          pageNumber={page}
          pageCount={pages.length}
          lines={loaded[page]}
          saved={saved}
          runId={runId}
          versionId={versionId}
          onPage={(next) => setPage(next)}
          onRetry={() => load(page)}
          onConfirmed={(ids) => {
            const at = new Date().toISOString();
            setSaved((old) => {
              const next = { ...old };
              for (const id of ids)
                next[id] = {
                  decision: "CONFIRMED",
                  text: null,
                  reviewer: "you",
                  at,
                };
              return next;
            });
            onChanged();
          }}
          onOneByOne={(lineId) => {
            const entryAt = allLines.find((l) => l.id === lineId);
            if (!entryAt) return;
            if (!queue.some((l) => l.id === lineId)) setEveryLine(true);
            setCurrentId(lineId);
            setPageMode(false);
          }}
        />
      ) : (
        <>
          {!entry && switcher}
          {!entry ? (
            <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
              Every line passed the engine&rsquo;s checks and there is nothing
              to spot-check. Look over the whole page, then accept the text.
            </p>
          ) : (
            <section className="space-y-3 rounded-xl border p-4">
              {switcher}
              {/* Fixed places for Previous and Next, whatever the line's label. */}
              <div className="grid grid-cols-[7rem_1fr_7rem] items-center gap-2">
                <button
                  type="button"
                  className="rounded-md border px-2.5 py-1 text-sm disabled:opacity-40"
                  disabled={index === 0}
                  onClick={() => go(index - 1)}
                >
                  ← Previous
                </button>
                <h2 className="text-center font-semibold">
                  Line {index + 1} of {queue.length}
                </h2>
                <button
                  type="button"
                  className="rounded-md border px-2.5 py-1 text-sm disabled:opacity-40"
                  disabled={index >= queue.length - 1}
                  onClick={() => go(index + 1)}
                >
                  Next →
                </button>
              </div>
              <p className="min-h-4 text-center text-xs text-slate-500">
                page {entry.page}
                {entry.spotCheck
                  ? " · spot check of a line the engine accepted"
                  : !entry.required
                    ? " · accepted by the engine; checking it is optional"
                    : ""}
              </p>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-slate-100"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={queue.length}
                aria-valuenow={decidedCount}
                aria-label="Lines decided"
              >
                <div
                  className="h-full bg-emerald-600 transition-all"
                  style={{ width: `${(decidedCount / queue.length) * 100}%` }}
                />
              </div>
              <p className="text-xs text-slate-500">
                {decidedCount} of {queue.length} decided
                {unreadable ? ` · ${unreadable} unreadable` : ""}
              </p>

              {!line ? (
                pageLines === "failed" ? (
                  <p className="text-sm text-red-800">
                    This page&rsquo;s lines could not be loaded.{" "}
                    <button
                      type="button"
                      className="underline"
                      onClick={() => entry && load(entry.page)}
                    >
                      Try again
                    </button>
                  </p>
                ) : (
                  <Spinner label="Loading the line…" />
                )
              ) : (
                <>
                  {size && <LineCrop src={src} line={line} size={size} />}

                  {!!line.flags.length && (
                    <p className="text-sm text-amber-900">
                      {line.flags
                        .map((flag) => readable(flag.message))
                        .join(" ")}
                    </p>
                  )}
                  <dl className="space-y-2 text-base">
                    <div>
                      <dt className="text-xs text-slate-500">
                        {readers[line.source] ?? line.source}
                      </dt>
                      <dd className="font-medium">
                        <Marked text={line.text} other={ocr?.text ?? null} />
                      </dd>
                    </div>
                    {line.other.map((reading) => (
                      <div key={reading.source}>
                        <dt className="text-xs text-slate-500">
                          {readers[reading.source] ?? reading.source}
                        </dt>
                        <dd>
                          <Marked
                            text={reading.text}
                            other={reading === ocr ? line.text : null}
                          />
                        </dd>
                      </div>
                    ))}
                  </dl>

                  {decision && !editing && (
                    <p
                      className={`rounded-lg p-2 text-sm ${decision.decision === "UNREADABLE" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-900"}`}
                    >
                      {decisionText[decision.decision]}
                      {decision.decision === "CORRECTED" && (
                        <> to &ldquo;{decision.text}&rdquo;</>
                      )}{" "}
                      by {decision.reviewer}.
                      {canDecide && " Choose again to change it."}
                    </p>
                  )}

                  {canDecide && !editing && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        disabled={busy}
                        className={button}
                        onClick={() => void decide("CONFIRMED")}
                      >
                        {key("1")}Text is right
                      </button>
                      {ocr ? (
                        <button
                          type="button"
                          disabled={busy}
                          className={button}
                          onClick={() => void decide("CORRECTED", ocr.text)}
                        >
                          {key("2")}Use the {readers[ocr.source] ?? ocr.source}{" "}
                          reading
                        </button>
                      ) : (
                        <span className="hidden sm:block" />
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        className={button}
                        onClick={startEditing}
                      >
                        {key("3")}Type a correction
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className={`${button} text-red-700`}
                        onClick={() => void decide("UNREADABLE")}
                      >
                        {key("4")}Can&rsquo;t read
                      </button>
                    </div>
                  )}
                  {canDecide && editing && (
                    <form
                      className="space-y-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void decide("CORRECTED", draft);
                      }}
                    >
                      <label className="block text-sm text-slate-600">
                        What the page says
                        <input
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setEditing(false);
                          }}
                          maxLength={2000}
                          autoFocus
                          className="mt-1 block w-full rounded-md border p-2 text-base"
                        />
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          disabled={busy || !draft.trim()}
                          className="rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-40"
                        >
                          Save and go on
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border px-3 py-2 text-sm"
                          onClick={() => setEditing(false)}
                        >
                          Cancel
                        </button>
                        <span className="text-xs text-slate-500">
                          Enter saves, Esc cancels
                        </span>
                      </div>
                    </form>
                  )}
                </>
              )}
              {busy && <Spinner label="Saving…" />}
              {error && (
                <p role="alert" className="text-sm text-red-700">
                  {error}
                </p>
              )}
              {allDecided && (
                <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
                  {unreadable
                    ? `All lines are decided, but ${unreadable} cannot be read. Report the problem in the text check.`
                    : "All lines are decided. "}
                  {!unreadable && (
                    <a href="#text-check" className="underline">
                      Accept the text in the text check
                    </a>
                  )}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                <label className="flex items-center gap-1.5">
                  Jump to
                  <select
                    value={entry.id}
                    onChange={(e) =>
                      go(queue.findIndex((l) => l.id === e.target.value))
                    }
                    className="max-w-64 rounded border px-1 py-0.5 text-xs text-slate-700"
                  >
                    {queue.map((l, i) => {
                      const d = decided(l);
                      return (
                        <option key={l.id} value={l.id}>
                          {d ? (d === "UNREADABLE" ? "✗" : "✓") : "•"} Line{" "}
                          {i + 1}, page {l.page}
                          {l.spotCheck ? " (spot check)" : ""}
                        </option>
                      );
                    })}
                  </select>
                </label>
                {canDecide && (
                  <span>Keys: 1–4 choose · ← → move between lines</span>
                )}
              </div>
            </section>
          )}
        </>
      )}

      <details open className="group">
        <summary className="cursor-pointer text-sm font-semibold">
          Whole page
        </summary>
        <p className="mt-1 text-xs text-slate-500">
          Tick &ldquo;Outline every line&rdquo;, then click any line on the page
          to check it.
        </p>
        <div className="mt-2">
          <PageViewer
            src={src}
            linesUrl={linesUrl}
            pages={pages}
            page={page}
            onPage={setPage}
            current={line}
            onSelect={(picked) => {
              // Any line clicked on the page opens it for a decision, switching
              // to every line when it is not among the lines to check.
              if (!allLines.some((l) => l.id === picked.id)) return;
              if (!queue.some((l) => l.id === picked.id)) setEveryLine(true);
              setCurrentId(picked.id);
              setPage(picked.page);
              setEditing(false);
              setError("");
            }}
          />
        </div>
      </details>
    </div>
  );
}

// A whole page at once: every checkable line of the page in a list, ticked
// unless already decided or in need of a look on its own. "Text is right" for the
// ticked lines records them all; the server refuses any line that needs a look.
function PageChecklist({
  pageNumber,
  pageCount,
  lines,
  saved,
  runId,
  versionId,
  onPage,
  onRetry,
  onConfirmed,
  onOneByOne,
}: {
  pageNumber: number;
  pageCount: number;
  lines: ReviewLine[] | "failed" | undefined;
  saved: Record<string, Decision>;
  runId: string;
  versionId: string;
  onPage: (page: number) => void;
  onRetry: () => void;
  onConfirmed: (ids: string[]) => void;
  onOneByOne: (lineId: string) => void;
}) {
  const checkable = Array.isArray(lines)
    ? lines.filter((line) => !line.excluded && line.text.trim())
    : [];
  const decisionOf = (line: ReviewLine) => saved[line.id] ?? line.decision;
  const open = checkable.filter(
    (line) => !decisionOf(line) && !needsOneByOne(line),
  );
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const chosen = selected ?? new Set(open.map((line) => line.id));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const toggle = (id: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };
  async function confirm() {
    const ids = checkable
      .filter((line) => chosen.has(line.id) && !decisionOf(line))
      .map((line) => line.id);
    if (!ids.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/review/${versionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "lines", runId, lineIds: ids }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "That did not save.");
      onConfirmed(ids);
      setSelected(new Set());
      setMessage({
        text: `${ids.length} line${ids.length === 1 ? "" : "s"} confirmed.`,
      });
    } catch (e) {
      setMessage({
        text: e instanceof Error ? e.message : "That did not save.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }
  const oneByOne = checkable.filter(
    (line) => !decisionOf(line) && needsOneByOne(line),
  ).length;
  const decided = checkable.filter(decisionOf).length;
  const count = checkable.filter(
    (line) => chosen.has(line.id) && !decisionOf(line),
  ).length;
  const nav = "rounded-md border px-2.5 py-1 text-sm disabled:opacity-40";

  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div className="grid grid-cols-[7rem_1fr_7rem] items-center gap-2">
        <button
          type="button"
          className={nav}
          disabled={pageNumber <= 1}
          onClick={() => onPage(pageNumber - 1)}
        >
          ← Page
        </button>
        <h2 className="text-center font-semibold">
          Page {pageNumber} of {pageCount}
        </h2>
        <button
          type="button"
          className={nav}
          disabled={pageNumber >= pageCount}
          onClick={() => onPage(pageNumber + 1)}
        >
          Page →
        </button>
      </div>
      {lines === "failed" ? (
        <p className="text-sm text-red-800">
          This page&rsquo;s lines could not be loaded.{" "}
          <button type="button" className="underline" onClick={onRetry}>
            Try again
          </button>
        </p>
      ) : !lines ? (
        <Spinner label="Loading the page’s lines…" />
      ) : !checkable.length ? (
        <p className="text-sm text-slate-600">
          No lines to check on this page.
        </p>
      ) : (
        <>
          <p className="text-xs text-slate-500">
            Read the page below against these lines. {checkable.length} lines ·{" "}
            {decided} decided
            {oneByOne
              ? ` · ${oneByOne} must be decided on ${oneByOne === 1 ? "its" : "their"} own`
              : ""}
          </p>
          {!open.length && (
            <p className="rounded-lg bg-slate-50 p-2 text-sm text-slate-700">
              Nothing to select on this page:{" "}
              {oneByOne
                ? `${decided} of ${checkable.length} lines are decided, and the other ${oneByOne} must be decided one at a time (see below).`
                : `all ${checkable.length} lines are already decided.`}{" "}
              {pageNumber < pageCount && (
                <button
                  type="button"
                  className="underline"
                  onClick={() => onPage(pageNumber + 1)}
                >
                  Next page
                </button>
              )}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              className={nav}
              disabled={!open.length}
              onClick={() => setSelected(new Set(open.map((line) => line.id)))}
            >
              Select all
            </button>
            <button
              type="button"
              className={nav}
              disabled={!open.length}
              onClick={() => setSelected(new Set())}
            >
              Select none
            </button>
            <button
              type="button"
              disabled={busy || !count}
              onClick={() => void confirm()}
              className="ml-auto rounded-lg bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            >
              {busy
                ? "Saving…"
                : `Text is right for ${count} selected line${count === 1 ? "" : "s"}`}
            </button>
          </div>
          {message && (
            <p
              role={message.error ? "alert" : "status"}
              className={`text-sm ${message.error ? "text-red-700" : "text-emerald-800"}`}
            >
              {message.text}
              {!message.error && pageNumber < pageCount && (
                <>
                  {" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => onPage(pageNumber + 1)}
                  >
                    Next page
                  </button>
                </>
              )}
            </p>
          )}
          <ol className="max-h-[60vh] space-y-1 overflow-y-auto pr-1">
            {checkable.map((line) => {
              const decision = decisionOf(line);
              const alone = !decision && needsOneByOne(line);
              const other = line.other.find((r) => r.text.trim());
              return (
                <li
                  key={line.id}
                  className={`flex items-start gap-2 rounded-md p-1.5 text-sm ${alone ? "bg-amber-50" : ""}`}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select: ${line.text}`}
                    className="mt-1"
                    disabled={!!decision || alone}
                    checked={!decision && !alone && chosen.has(line.id)}
                    onChange={(e) => toggle(line.id, e.target.checked)}
                  />
                  <div className="min-w-0 flex-1">
                    <p className={decision ? "text-slate-500" : ""}>
                      {alone ? (
                        <Marked text={line.text} other={other?.text ?? null} />
                      ) : (
                        line.text
                      )}
                    </p>
                    {alone && other && (
                      <p className="text-xs text-slate-600">
                        {readers[other.source] ?? other.source}:{" "}
                        <Marked text={other.text} other={line.text} />
                      </p>
                    )}
                    {alone && (
                      <button
                        type="button"
                        className="text-xs text-amber-900 underline"
                        onClick={() => onOneByOne(line.id)}
                      >
                        {oneByOneReason(line)}: decide it on its own
                      </button>
                    )}
                  </div>
                  {decision && (
                    <span
                      className={`shrink-0 text-xs ${decision.decision === "UNREADABLE" ? "text-red-700" : "text-emerald-800"}`}
                    >
                      {decisionText[decision.decision]}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}

"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RenderTask } from "pdfjs-dist";
import type { EngineBox } from "@/lib/review/extraction-runs";
import type {
  LeftOut,
  QueueEntry,
  ReviewLine,
} from "@/lib/review/line-reviews";
import { oneByOneReason } from "@/lib/review/line-rules";
import { closingLabel } from "@/lib/review/closing-lines";
import PageViewer, { type Outline } from "./PageViewer";
import { Spinner, usePdf } from "./pdf";

// Step 1 of a review, "Check the words" (AD-48). One way of working, page by
// page: the page on the left, its lines on the right.
//   1. Lines the rules are unsure of, and a few spot checks, come up one at a
//      time as a close-up of the original.
//   2. Then the rest of the page is one list and one button: "These lines are
//      right". A line that is wrong is clicked and fixed instead.
//   3. When a page is done, the next page with lines to check comes up.
// Every line ends up checked; the Done button lives with the page (workspace).

type PageSize = {
  number: number;
  width: number;
  height: number;
  rotation: number;
};
type Decision = NonNullable<ReviewLine["decision"]>;
type Choice = Decision["decision"];

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
      <p className="border border-amber-700 bg-amber-50 p-3 text-sm text-amber-900">
        This page is turned sideways, so no close-up is shown. Find the line on
        the page.
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
          <span className="border border-ink bg-paper px-3 py-1.5">
            <Spinner label={doc ? "Drawing…" : "Loading the original…"} />
          </span>
        </div>
      )}
      <div
        className={`relative mx-auto w-fit overflow-hidden border border-ink bg-paper transition-opacity ${ready ? "" : "opacity-30"}`}
      >
        <canvas
          ref={canvas}
          className="block"
          aria-label={`Close-up of page ${line.page}`}
        />
        {ready && (
          <div
            aria-hidden
            className="pointer-events-none absolute border-2 border-amber-500 bg-amber-200/20"
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
// between two readings stands out.
function Marked({ text, other }: { text: string; other: string | null }) {
  if (!text.trim()) return <em className="text-ink-soft">nothing</em>;
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
          <mark key={i} className="bg-amber-200 px-0.5">
            {part}
          </mark>
        );
      })}
    </>
  );
}

const shownText = (line: ReviewLine, decision: Decision | null) =>
  decision?.decision === "CORRECTED" && decision.text
    ? decision.text
    : line.text;

export default function WordCheck({
  src,
  linesUrl,
  pages,
  runId,
  queue,
  leftOut,
  canDecide,
  versionId,
  onChanged,
}: {
  src: string;
  linesUrl: string;
  pages: PageSize[];
  runId: string;
  // Every line to check, in reading order.
  queue: QueueEntry[];
  // Lines left out of the chatbot's text: the signature, the "Copy to" list.
  leftOut: LeftOut[];
  canDecide: boolean;
  versionId: string;
  onChanged: () => void;
}) {
  const entries = useMemo(() => new Map(queue.map((e) => [e.id, e])), [queue]);
  const leftOutReason = useMemo(
    () => new Map(leftOut.map((l) => [l.id, l.reason])),
    [leftOut],
  );
  // Decisions saved here, ahead of the page's data catching up.
  const [saved, setSaved] = useState<Record<string, Decision>>({});
  const decided = useCallback(
    (id: string, extra: Record<string, Decision> = {}) =>
      extra[id]?.decision ??
      saved[id]?.decision ??
      entries.get(id)?.decision ??
      null,
    [entries, saved],
  );
  const pagesToCheck = useMemo(
    () => [...new Set(queue.map((e) => e.page))].sort((a, b) => a - b),
    [queue],
  );
  const openOn = useCallback(
    (page: number, extra: Record<string, Decision> = {}) =>
      queue.some((e) => e.page === page && !decided(e.id, extra)),
    [decided, queue],
  );
  const [page, setPage] = useState(
    () => queue.find((e) => !e.decision)?.page ?? pagesToCheck[0] ?? 1,
  );
  // A line clicked to look at or change; otherwise the next line to look at.
  const [picked, setPicked] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // The lines of each page, loaded when first needed.
  const [loaded, setLoaded] = useState<Record<number, ReviewLine[] | "failed">>(
    {},
  );
  const requested = useRef(new Set<number>());
  const load = useCallback(
    (number: number) => {
      if (requested.current.has(number)) return;
      requested.current.add(number);
      void fetch(`${linesUrl}?page=${number}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
        .then((body: { lines: ReviewLine[] }) =>
          setLoaded((old) => ({ ...old, [number]: body.lines })),
        )
        .catch(() => {
          requested.current.delete(number);
          setLoaded((old) => ({ ...old, [number]: "failed" }));
        });
    },
    [linesUrl],
  );
  const nextOpenPage = useCallback(
    (from: number, extra: Record<string, Decision> = {}) =>
      pagesToCheck.find((p) => p > from && openOn(p, extra)) ??
      pagesToCheck.find((p) => openOn(p, extra)) ??
      null,
    [openOn, pagesToCheck],
  );
  useEffect(() => {
    load(page);
    const ahead = nextOpenPage(page);
    if (ahead && ahead !== page) load(ahead);
  }, [load, nextOpenPage, page]);

  const pageLines = loaded[page];
  const lines = useMemo(
    () => (Array.isArray(pageLines) ? pageLines : []),
    [pageLines],
  );
  const decisionRecord = (line: ReviewLine) =>
    saved[line.id] ?? (entries.get(line.id)?.decision ? line.decision : null);
  const lookReason = (line: ReviewLine) =>
    oneByOneReason(line) ??
    (entries.get(line.id)?.spotCheck
      ? "A spot check: the rules accepted this line, and a few of those are looked at closely"
      : null);
  const checkable = lines.filter((line) => entries.has(line.id));
  const looks = checkable.filter(
    (line) => !decided(line.id) && lookReason(line),
  );
  const rest = checkable.filter(
    (line) => !decided(line.id) && !lookReason(line),
  );
  const current =
    (picked && checkable.find((line) => line.id === picked)) ||
    (canDecide ? looks[0] : null) ||
    null;
  const total = queue.length;
  const done = queue.filter((e) => decided(e.id)).length;
  const unreadable = queue.filter((e) => decided(e.id) === "UNREADABLE").length;

  const goPage = useCallback((number: number) => {
    setPage(number);
    setPicked(null);
    setEditing(false);
    setError("");
  }, []);
  // After saving: stay while the page has lines open, else go to the next page
  // that has.
  // A line clicked on purpose is a change: stay on its page.
  const advance = useCallback(
    (extra: Record<string, Decision>, stay = false) => {
      setPicked(null);
      setEditing(false);
      if (stay || openOn(page, extra)) return;
      const next = nextOpenPage(page, extra);
      if (next && next !== page) setPage(next);
    },
    [nextOpenPage, openOn, page],
  );

  async function post(body: Record<string, unknown>) {
    const response = await fetch(`/api/review/${versionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "That did not save.");
    return result;
  }

  const decide = useCallback(
    async (choice: Choice, text?: string) => {
      if (!current || busy) return;
      setBusy(true);
      setError("");
      try {
        const result = await post({
          action: "line",
          runId,
          lineId: current.id,
          decision: choice,
          text,
        });
        const extra = {
          [current.id]: {
            decision: choice,
            text: result.text ?? null,
            reviewer: "you",
            at: new Date().toISOString(),
          },
        };
        setSaved((old) => ({ ...old, ...extra }));
        advance(extra, !!picked);
        onChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That did not save.");
      } finally {
        setBusy(false);
      }
    },
    // post only closes over versionId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [advance, busy, current, onChanged, picked, runId, versionId],
  );

  async function confirmRest() {
    const ids = rest.map((line) => line.id);
    if (!ids.length || busy) return;
    setBusy(true);
    setError("");
    try {
      await post({ action: "lines", runId, lineIds: ids });
      const at = new Date().toISOString();
      const extra: Record<string, Decision> = {};
      for (const id of ids)
        extra[id] = { decision: "CONFIRMED", text: null, reviewer: "you", at };
      setSaved((old) => ({ ...old, ...extra }));
      advance(extra);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  const other = current?.other.find(
    (reading) => reading.text.trim() && reading.text !== current.text,
  );
  const startFixing = useCallback(() => {
    if (!current) return;
    const record = saved[current.id] ?? current.decision;
    setDraft(shownText(current, record ?? null));
    setEditing(true);
  }, [current, saved]);

  // Keys for the close-up: 1 right, 2 the other reading, 3 fix, 4 can't read,
  // 5 leave out.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        !current ||
        !canDecide ||
        editing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        target?.closest("input, textarea, select, [contenteditable]")
      )
        return;
      if (event.key === "1") void decide("CONFIRMED");
      else if (event.key === "2" && other) void decide("CORRECTED", other.text);
      else if (event.key === "3") startFixing();
      else if (event.key === "4") void decide("UNREADABLE");
      else if (event.key === "5") void decide("LEFT_OUT");
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canDecide, current, decide, editing, other, startFixing]);

  const outlines: Outline[] = lines.map((line) => {
    const choice = decided(line.id);
    return {
      line,
      tone:
        line.excluded ||
        leftOutReason.has(line.id) ||
        !entries.has(line.id) ||
        choice === "LEFT_OUT"
          ? "left"
          : choice === "UNREADABLE"
            ? "problem"
            : choice
              ? "done"
              : lookReason(line)
                ? "look"
                : "todo",
    };
  });
  const size = pages.find((p) => p.number === page);
  const pick = (id: string) => {
    if (!entries.has(id)) return;
    setPicked(id);
    setEditing(false);
    setError("");
  };
  const nav =
    "min-h-10 cursor-pointer whitespace-nowrap border border-ink bg-paper px-2.5 text-sm hover:bg-shade disabled:cursor-default disabled:opacity-40";
  const choiceButton =
    "min-h-11 cursor-pointer border border-ink bg-paper px-3 py-2.5 text-left text-[15px] hover:bg-shade disabled:cursor-default disabled:opacity-40";
  const elsewhere = nextOpenPage(page);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <section className="space-y-2 lg:sticky lg:top-20">
        <PageViewer
          src={src}
          linesUrl={linesUrl}
          pages={pages}
          page={page}
          onPage={goPage}
          current={current}
          onSelect={(line) => pick(line.id)}
          outlines={outlines}
          navigation={false}
        />
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
          <Key tone="bg-amber-300/60 border-amber-500">look closely</Key>
          <Key tone="border-ink">to check</Key>
          <Key tone="bg-emerald-300/30 border-brand">checked</Key>
          <Key tone="border-dashed border-ink">not needed</Key>
          <span>Click a line on the page to change it.</span>
        </p>
      </section>

      <section className="space-y-4 border border-ink bg-paper p-5">
        {/* Fixed places for the page buttons, whatever the title's length. */}
        <div className="grid grid-cols-[9.5rem_1fr_9.5rem] items-center gap-2">
          <button
            type="button"
            className={nav}
            disabled={page <= 1}
            onClick={() => goPage(page - 1)}
          >
            ← Previous page
          </button>
          <h2 className="text-center font-serif text-lg font-bold">
            Page {page} of {pages.length}
          </h2>
          <button
            type="button"
            className={nav}
            disabled={page >= pages.length}
            onClick={() => goPage(page + 1)}
          >
            Next page →
          </button>
        </div>
        <div className="space-y-1">
          <div
            className="h-2 overflow-hidden bg-shade"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={done}
            aria-label="Lines checked"
          >
            <div
              className="h-full bg-brand transition-all"
              style={{ width: `${total ? (done / total) * 100 : 100}%` }}
            />
          </div>
          <p className="text-sm text-ink-soft">
            {done} of {total} lines checked
            {unreadable ? ` · ${unreadable} can’t be read` : ""}
          </p>
        </div>

        {pageLines === "failed" ? (
          <p className="text-sm text-red-800">
            This page could not be loaded.{" "}
            <button
              type="button"
              className="underline"
              onClick={() => load(page)}
            >
              Try again
            </button>
          </p>
        ) : !pageLines ? (
          <Spinner label="Loading the page…" />
        ) : current && canDecide ? (
          <div className="space-y-3 border-2 border-ink bg-paper p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-semibold">
                {picked
                  ? decided(current.id)
                    ? "Change this line"
                    : "Check this line"
                  : "Look closely at this line"}
              </h3>
              {!picked && looks.length > 1 && (
                <span className="text-xs text-ink-soft">
                  1 of {looks.length} on this page
                </span>
              )}
            </div>
            {lookReason(current) && (
              <p className="text-sm text-amber-900">{lookReason(current)}.</p>
            )}
            {size && <LineCrop src={src} line={current} size={size} />}
            <div className="space-y-1">
              <p className="text-xs text-ink-soft">We read</p>
              <p className="text-lg font-medium">
                <Marked text={current.text} other={other?.text ?? null} />
              </p>
              {other && (
                <>
                  <p className="pt-1 text-xs text-ink-soft">
                    A second reading says
                  </p>
                  <p>
                    <Marked text={other.text} other={current.text} />
                  </p>
                </>
              )}
            </div>
            {decisionRecord(current) && !editing && (
              <p className="text-sm text-ink-soft">
                Now:{" "}
                {decisionRecord(current)!.decision === "UNREADABLE"
                  ? "can’t be read"
                  : decisionRecord(current)!.decision === "LEFT_OUT"
                    ? "left out"
                    : decisionRecord(current)!.decision === "CORRECTED"
                      ? `fixed to “${decisionRecord(current)!.text}”`
                      : "right"}{" "}
                ({decisionRecord(current)!.reviewer}).
              </p>
            )}
            {!editing ? (
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    disabled={busy}
                    className={`${choiceButton} border-2 border-brand bg-brand-soft font-semibold text-brand-strong hover:bg-brand-soft`}
                    onClick={() => void decide("CONFIRMED")}
                  >
                    ✓ It’s right
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className={choiceButton}
                    onClick={startFixing}
                  >
                    ✎ Fix it
                  </button>
                  {other && (
                    <button
                      type="button"
                      disabled={busy}
                      className={`${choiceButton} sm:col-span-2`}
                      onClick={() => void decide("CORRECTED", other.text)}
                    >
                      Use the second reading
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <button
                    type="button"
                    disabled={busy}
                    className="text-ink underline disabled:opacity-40"
                    onClick={() => void decide("LEFT_OUT")}
                    title="A garbled header, a watermark, a stray page number: kept out of the chatbot’s text"
                  >
                    Leave it out (not part of the text)
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="text-red-700 underline disabled:opacity-40"
                    onClick={() => void decide("UNREADABLE")}
                  >
                    Can’t read it
                  </button>
                </div>
              </div>
            ) : (
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void decide("CORRECTED", draft);
                }}
              >
                <label className="block text-sm text-ink-soft">
                  What the page says
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setEditing(false);
                    }}
                    maxLength={2000}
                    autoFocus
                    className="mt-1 block w-full border border-ink bg-paper p-2 text-base"
                  />
                </label>
                <div className="flex items-center gap-2">
                  <button
                    disabled={busy || !draft.trim()}
                    className="min-h-10 cursor-pointer bg-ink px-4 text-sm text-paper hover:bg-brand-strong disabled:opacity-40"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="min-h-10 cursor-pointer border border-ink bg-paper px-4 text-sm hover:bg-shade"
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
            {picked ? (
              <button
                type="button"
                className="text-sm underline"
                onClick={() => {
                  setPicked(null);
                  setEditing(false);
                }}
              >
                Back to the page
              </button>
            ) : (
              rest.length > 0 && (
                <p className="text-xs text-ink-soft">
                  Then the other {rest.length} line
                  {rest.length === 1 ? "" : "s"} of this page, all at once.
                </p>
              )
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {!canDecide ? (
              <p className="text-sm text-ink-soft">
                These are the lines as read. Checking them needs text check
                access.
              </p>
            ) : rest.length ? (
              <div className="space-y-1">
                <h3 className="font-semibold">
                  {checkable.length > rest.length
                    ? "Now the rest of this page"
                    : "Check this page"}
                </h3>
                <p className="text-sm text-ink-soft">
                  Compare these lines with the page. If one is wrong, click it
                  to fix it.
                </p>
              </div>
            ) : checkable.length ? (
              <p className="border border-brand bg-brand-soft p-3 text-sm text-brand-strong">
                Every line on this page is checked.{" "}
                {elsewhere ? (
                  <button
                    type="button"
                    className="underline"
                    onClick={() => goPage(elsewhere)}
                  >
                    Go to page {elsewhere}
                  </button>
                ) : (
                  "That was the last one."
                )}
              </p>
            ) : (
              <p className="border border-rule bg-shade p-3 text-sm text-ink-soft">
                Nothing to check on this page.{" "}
                {elsewhere && (
                  <button
                    type="button"
                    className="underline"
                    onClick={() => goPage(elsewhere)}
                  >
                    Go to page {elsewhere}
                  </button>
                )}
              </p>
            )}
            <ol className="max-h-[55vh] space-y-0.5 overflow-y-auto pr-1">
              {lines
                .filter((line) => line.text.trim())
                .map((line) => {
                  const choice = decided(line.id);
                  const record = decisionRecord(line);
                  const reason = leftOutReason.get(line.id);
                  if (!entries.has(line.id))
                    return (
                      <li
                        key={line.id}
                        className="flex gap-2 px-2 py-1 text-sm text-ink-soft"
                      >
                        <span className="w-4 shrink-0" />
                        <span className="min-w-0 flex-1">
                          {line.text}
                          <span className="ml-2 text-xs">
                            {reason
                              ? `${closingLabel[reason]}: not used by the chatbot`
                              : "Hindi: kept as evidence only"}
                          </span>
                        </span>
                      </li>
                    );
                  return (
                    <li key={line.id}>
                      <button
                        type="button"
                        disabled={!canDecide}
                        onClick={() => pick(line.id)}
                        className={`flex w-full gap-2  px-2 py-1 text-left text-sm hover:bg-shade disabled:hover:bg-transparent ${choice ? "text-ink-soft" : ""}`}
                      >
                        <span
                          className={`w-4 shrink-0 ${choice === "UNREADABLE" ? "text-red-700" : "text-brand"}`}
                          aria-label={
                            choice === "UNREADABLE"
                              ? "Can’t be read"
                              : choice === "LEFT_OUT"
                                ? "Left out"
                                : choice === "CORRECTED"
                                  ? "Fixed"
                                  : choice
                                    ? "Right"
                                    : "To check"
                          }
                        >
                          {choice === "UNREADABLE"
                            ? "✗"
                            : choice === "LEFT_OUT"
                              ? "–"
                              : choice === "CORRECTED"
                                ? "✎"
                                : choice
                                  ? "✓"
                                  : ""}
                        </span>
                        <span
                          className={`min-w-0 flex-1 ${choice === "LEFT_OUT" ? "line-through" : ""}`}
                        >
                          {shownText(line, record)}
                        </span>
                      </button>
                    </li>
                  );
                })}
            </ol>
            {canDecide && rest.length > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmRest()}
                className="min-h-12 w-full cursor-pointer bg-ink px-4 font-semibold text-paper hover:bg-brand-strong disabled:cursor-default disabled:opacity-40"
              >
                {busy
                  ? "Saving…"
                  : `✓ ${rest.length === checkable.length ? "All" : "These"} ${rest.length} line${rest.length === 1 ? " is" : "s are"} right`}
              </button>
            )}
          </div>
        )}
        {busy && current && <Spinner label="Saving…" />}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}

function Key({ tone, children }: { tone: string; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-3 w-5  border-2 ${tone}`} />
      {children}
    </span>
  );
}

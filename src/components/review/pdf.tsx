"use client";
import { useEffect, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";

// One pdf.js document per original, shared by every view of it (the close-up,
// the whole page, the details step) so the file is downloaded and parsed once.
//
// The worker is created once and passed to every document explicitly. Left to
// itself, pdf.js shares one worker per port between documents and destroys it
// with the first document destroyed, so a view closing at the moment another
// opens (the details step giving way to "Change a line") broke the new one.
// A document no longer used is kept for a minute in case a view comes back.

const KEEP_MS = 60_000;
let worker: Promise<import("pdfjs-dist").PDFWorker> | null = null;
async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");
  worker ??= Promise.resolve(
    pdfjs.PDFWorker.create({
      port: new Worker(
        new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
        { type: "module" },
      ),
    }),
  );
  return { pdfjs, worker: await worker };
}

type Entry = {
  users: number;
  task: Promise<PDFDocumentLoadingTask>;
  doc: Promise<PDFDocumentProxy>;
  closing: ReturnType<typeof setTimeout> | null;
};
const open = new Map<string, Entry>();

function acquire(src: string) {
  let entry = open.get(src);
  if (!entry) {
    const task = loadPdfJs().then(({ pdfjs, worker }) =>
      pdfjs.getDocument({ url: src, withCredentials: true, worker }),
    );
    entry = { users: 0, task, doc: task.then((t) => t.promise), closing: null };
    // A failed load is not kept: the next view tries again.
    entry.doc.catch(() => {
      if (open.get(src) === entry && !entry!.users) open.delete(src);
    });
    open.set(src, entry);
  }
  if (entry.closing) clearTimeout(entry.closing);
  entry.closing = null;
  entry.users++;
  return entry;
}

function release(src: string) {
  const entry = open.get(src);
  if (!entry || --entry.users > 0) return;
  entry.closing = setTimeout(() => {
    if (entry.users > 0 || open.get(src) !== entry) return;
    open.delete(src);
    // Destroys the document only; the shared worker stays.
    void entry.task.then((task) => task.destroy()).catch(() => {});
  }, KEEP_MS);
}

export function usePdf(src: string | null) {
  const [state, setState] = useState<{
    src: string | null;
    doc: PDFDocumentProxy | null;
    error: boolean;
  }>({ src: null, doc: null, error: false });
  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    const entry = acquire(src);
    entry.doc.then(
      (doc) => !cancelled && setState({ src, doc, error: false }),
      () => !cancelled && setState({ src, doc: null, error: true }),
    );
    return () => {
      cancelled = true;
      release(src);
    };
  }, [src]);
  // Ignore a result that belongs to an earlier src.
  return state.src === src ? state : { src, doc: null, error: false };
}

export function Spinner({ label }: { label: string }) {
  return (
    <span
      role="status"
      className="inline-flex items-center gap-2 text-sm text-slate-600"
    >
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-600" />
      {label}
    </span>
  );
}

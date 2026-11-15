"use client";
import { useEffect, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";

// One pdf.js document per original, shared by the line crop and the whole-page
// view so the file is downloaded and parsed once. It is released when the last
// component using it goes away.

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

type Entry = {
  users: number;
  task: Promise<PDFDocumentLoadingTask>;
  doc: Promise<PDFDocumentProxy>;
};
const open = new Map<string, Entry>();

function acquire(src: string) {
  let entry = open.get(src);
  if (!entry) {
    const task = loadPdfJs().then((pdfjs) =>
      pdfjs.getDocument({ url: src, withCredentials: true }),
    );
    entry = { users: 0, task, doc: task.then((t) => t.promise) };
    open.set(src, entry);
  }
  entry.users++;
  return entry;
}

function release(src: string) {
  const entry = open.get(src);
  if (!entry || --entry.users > 0) return;
  open.delete(src);
  void entry.task.then((task) => task.destroy()).catch(() => {});
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

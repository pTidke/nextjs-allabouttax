"use client";
import Link from "next/link";
import { useState } from "react";

type Result = { versionId: string; passages: number; needsOcr: boolean };
const MAX_BYTES = 32 * 1024 * 1024;

async function send(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The upload did not work.");
  return body;
}

export default function UploadForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [progress, setProgress] = useState("");
  const field = "mt-1 block min-h-10 w-full border border-ink bg-paper p-2";
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const file = (form.elements.namedItem("file") as HTMLInputElement)
          .files?.[0];
        if (!file) return;
        if (file.size > MAX_BYTES) {
          setError("This file is larger than 32 MB.");
          return;
        }
        const fields = new FormData(form);
        setBusy(true);
        setError("");
        setResult(null);
        try {
          setProgress("Checking the file…");
          const bytes = await file.arrayBuffer();
          const digest = await crypto.subtle.digest("SHA-256", bytes);
          const sha256 = [...new Uint8Array(digest)]
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          const started = await send("/api/review/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: fields.get("title"),
              officialUrl: fields.get("officialUrl"),
              issuedAt: fields.get("issuedAt") || undefined,
              size: file.size,
              sha256,
            }),
          });
          // Vercel accepts request bodies of up to 4.5 MB, so the file goes in parts.
          for (let i = 0; i < started.parts; i++) {
            setProgress(
              started.parts > 1
                ? `Uploading part ${i + 1} of ${started.parts}…`
                : "Uploading…",
            );
            const part = bytes.slice(
              i * started.partBytes,
              (i + 1) * started.partBytes,
            );
            await send(`/api/review/upload/${started.uploadId}/${i}`, {
              method: "PUT",
              headers: { "Content-Type": "application/octet-stream" },
              body: part,
            });
          }
          setProgress("Reading the text…");
          setResult(
            await send(`/api/review/upload/${started.uploadId}`, {
              method: "POST",
            }),
          );
          form.reset();
        } catch (e) {
          setError(e instanceof Error ? e.message : "The upload did not work.");
        } finally {
          setBusy(false);
          setProgress("");
        }
      }}
    >
      <label className="block text-sm font-medium">
        PDF file (up to 32 MB)
        <input
          name="file"
          type="file"
          accept="application/pdf,.pdf"
          required
          className={field}
        />
      </label>
      <label className="block text-sm font-medium">
        Title
        <input
          name="title"
          required
          maxLength={500}
          placeholder="Circular No. 7/2026"
          className={field}
        />
      </label>
      <label className="block text-sm font-medium">
        Official web address
        <input
          name="officialUrl"
          type="url"
          required
          placeholder="https://www.incometaxindia.gov.in/..."
          className={field}
        />
        <span className="text-xs font-normal text-ink-soft">
          An https link on a .gov.in or .nic.in site, where the public can read
          the same document.
        </span>
      </label>
      <label className="block text-sm font-medium">
        Issue date (optional)
        <input name="issuedAt" type="date" className={field} />
      </label>
      {error && (
        <p
          role="alert"
          className="border border-red-800 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {result && (
        <p
          role="status"
          className="border border-brand bg-brand-soft p-3 text-sm text-brand-strong"
        >
          Uploaded.{" "}
          {result.needsOcr
            ? "It has no text layer, so it is a scan. The extraction engine reads it with OCR on its next run, within two hours."
            : `${result.passages} passages were extracted.`}{" "}
          <Link href={`/review/${result.versionId}`} className="underline">
            Open it for review
          </Link>
        </p>
      )}
      <button
        disabled={busy}
        className="min-h-12 cursor-pointer bg-ink px-6 font-semibold text-paper hover:bg-brand-strong disabled:opacity-40"
      >
        {busy ? progress || "Uploading…" : "Upload"}
      </button>
    </form>
  );
}

"use client";
import Link from "next/link";
import { useState } from "react";

type Result = { versionId: string; passages: number; needsOcr: boolean };

export default function UploadForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const field = "block w-full border rounded-lg p-2 mt-1";
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const file = (form.elements.namedItem("file") as HTMLInputElement)
          .files?.[0];
        if (file && file.size > 4 * 1024 * 1024) {
          setError(
            "This file is larger than 4 MB. Larger documents need the extraction engine, which is coming next.",
          );
          return;
        }
        setBusy(true);
        setError("");
        setResult(null);
        try {
          const response = await fetch("/api/review/upload", {
            method: "POST",
            body: new FormData(form),
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok)
            throw new Error(body.error || "The upload did not work.");
          setResult(body);
          form.reset();
        } catch (e) {
          setError(e instanceof Error ? e.message : "The upload did not work.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block text-sm font-medium">
        PDF file (up to 4 MB)
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
        <span className="text-xs font-normal text-slate-500">
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
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {result && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"
        >
          Uploaded.{" "}
          {result.needsOcr
            ? "No text could be read from it, so it is waiting for OCR."
            : `${result.passages} passages were extracted.`}{" "}
          <Link href={`/review/${result.versionId}`} className="underline">
            Open it for review
          </Link>
        </p>
      )}
      <button
        disabled={busy}
        className="rounded-lg bg-emerald-700 text-white px-5 py-2 disabled:opacity-40"
      >
        {busy ? "Uploading…" : "Upload"}
      </button>
    </form>
  );
}

"use client";

import { useState } from "react";

// One email when tax form filling opens. Stored with the contact messages, so
// it shows in the admin inbox.
export default function WaitlistForm({
  layout = "row",
}: {
  layout?: "row" | "stack";
}) {
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState("sending");
    setError(null);
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          website: form.get("website"),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Please try again.");
      setState("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
      setState("idle");
    }
  }
  if (state === "done")
    return (
      <p role="status" className="border-2 border-ink bg-brand-soft px-5 py-4">
        <strong>You&apos;re on the list.</strong> We&apos;ll send one email when
        it opens.
      </p>
    );
  const stack = layout === "stack";
  return (
    <form
      onSubmit={submit}
      className={`flex w-full gap-3 ${stack ? "flex-col" : "flex-wrap"}`}
    >
      <label
        htmlFor={`waitlist-${layout}`}
        className={stack ? "font-medium" : "sr-only"}
      >
        Get one email when it opens
      </label>
      {/* Hidden from people; a bot that fills it is ignored. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />
      <input
        id={`waitlist-${layout}`}
        name="email"
        type="email"
        required
        maxLength={254}
        placeholder="you@example.com"
        className={`min-h-14 min-w-0 border border-ink bg-paper px-4 ${stack ? "" : "flex-[1_1_16rem]"}`}
      />
      <button
        type="submit"
        disabled={state === "sending"}
        className="min-h-14 cursor-pointer bg-ink px-6 font-semibold text-paper hover:bg-brand-strong disabled:opacity-60"
      >
        {state === "sending" ? "Adding you…" : "Join the waitlist"}
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-[#b3261e]">
          {error}
        </p>
      )}
    </form>
  );
}

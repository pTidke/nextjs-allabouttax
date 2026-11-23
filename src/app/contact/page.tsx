"use client";

import { useState } from "react";
import Link from "next/link";

export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    message: "",
  });
  const [status, setStatus] = useState<
    { state: "idle" | "sending" | "sent" } | { state: "error"; message: string }
  >({ state: "idle" });
  const [website, setWebsite] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus({ state: "sending" });
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, website }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(body.error || "Your message could not be sent.");
      setFormData({ name: "", email: "", message: "" });
      setStatus({ state: "sent" });
    } catch (error) {
      // Keep what they typed so nothing is lost.
      setStatus({
        state: "error",
        message:
          error instanceof Error
            ? error.message
            : "Your message could not be sent.",
      });
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const sending = status.state === "sending";
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-wrap gap-x-16 gap-y-12 px-6 pb-24 pt-16">
      <div className="flex min-w-0 flex-[1_1_22rem] flex-col gap-6">
        <h1 className="font-serif text-4xl font-bold leading-tight md:text-5xl">
          Need help or have feedback?
        </h1>
        <p className="text-lg text-ink-soft">
          Tell us about a problem with the site, or how we could make it
          better. We usually reply within 24 hours.
        </p>
        <div className="border-2 border-ink bg-paper p-6">
          <p className="label-mono mb-2 text-brand">Please note</p>
          <p>
            We can help with the site only. We can&apos;t give personal tax
            advice or file taxes for you. For tax questions,{" "}
            <Link href="/ask">ask the assistant</Link>, or speak to a CA about
            your own case.
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex min-w-0 flex-[1_1_22rem] flex-col gap-5 border-2 border-ink bg-paper p-6 md:p-9"
      >
        {/* Hidden from people; a bot that fills it is ignored. */}
        <input
          type="text"
          name="website"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="hidden"
        />
        <label className="flex flex-col gap-1.5">
          <span className="font-medium">Your name</span>
          <input
            name="name"
            required
            maxLength={200}
            value={formData.name}
            onChange={handleChange}
            className="min-h-12 w-full border border-ink bg-paper px-4"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-medium">Email</span>
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            value={formData.email}
            onChange={handleChange}
            placeholder="you@example.com"
            className="min-h-12 w-full border border-ink bg-paper px-4"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-medium">Message</span>
          <textarea
            name="message"
            required
            maxLength={5000}
            rows={6}
            value={formData.message}
            onChange={handleChange}
            placeholder="What happened, or what would help?"
            className="w-full resize-y border border-ink bg-paper px-4 py-3"
          />
        </label>
        <button
          type="submit"
          disabled={sending}
          className="min-h-13 cursor-pointer bg-ink font-semibold text-paper hover:bg-brand-strong disabled:opacity-60"
        >
          {sending ? "Sending…" : "Send message"}
        </button>
        {status.state === "sent" && (
          <p role="status" className="bg-brand-soft px-4 py-3">
            Thanks — your message has been sent.
          </p>
        )}
        {status.state === "error" && (
          <p role="alert" className="text-[#b3261e]">
            {status.message}
          </p>
        )}
      </form>
    </main>
  );
}

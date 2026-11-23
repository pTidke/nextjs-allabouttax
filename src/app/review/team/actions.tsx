"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Person = {
  id: string;
  name: string | null;
  email: string;
  roles: string[];
};
const names: Record<string, string> = {
  EXTRACTION: "Text check",
  TAX: "Tax review",
};

export default function TeamActions({ team }: { team: Person[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/review/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "That did not work.");
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      {error && (
        <p
          role="alert"
          className="border border-red-800 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      <form
        className="border border-ink bg-paper p-4 space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const email = String(data.get("email") ?? "");
          const roles = data.getAll("role").map(String);
          if (!roles.length) {
            setError("Choose at least one kind of review.");
            return;
          }
          for (const role of roles)
            if (!(await send({ action: "grant", email, role }))) return;
          form.reset();
        }}
      >
        <h2 className="font-serif text-xl font-bold">Add a reviewer</h2>
        <label className="block text-sm">
          Email they sign in with
          <input
            name="email"
            type="email"
            required
            className="mt-1 block min-h-10 w-full border border-ink bg-paper p-2"
          />
        </label>
        <div className="flex gap-6 text-sm">
          {Object.entries(names).map(([role, label]) => (
            <label key={role} className="flex items-center gap-2">
              <input type="checkbox" name="role" value={role} /> {label}
            </label>
          ))}
        </div>
        <button
          disabled={busy}
          className="min-h-10 cursor-pointer bg-ink px-4 text-sm text-paper hover:bg-brand-strong disabled:opacity-40"
        >
          Add
        </button>
      </form>
      <section className="space-y-3">
        <h2 className="font-serif text-xl font-bold">Current reviewers</h2>
        {!team.length && <p className="text-sm text-ink-soft">Nobody yet.</p>}
        {team.map((person) => (
          <article
            key={person.id}
            className="border border-ink bg-paper p-4 space-y-2"
          >
            <p className="text-sm">
              <strong>{person.name ?? person.email}</strong>
              {person.name && (
                <span className="text-ink-soft"> · {person.email}</span>
              )}
            </p>
            <div className="flex flex-wrap gap-3 text-sm">
              {person.roles.map((role) => (
                <span
                  key={role}
                  className="flex items-center gap-2 bg-shade px-3 py-1"
                >
                  {names[role] ?? role}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void send({ action: "revoke", userId: person.id, role })
                    }
                    className="text-red-700 underline text-xs"
                  >
                    remove
                  </button>
                </span>
              ))}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

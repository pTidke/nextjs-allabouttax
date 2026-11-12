"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { Candidate, Command } from "@/lib/extraction-staging/contract";
import type { SavedRevision } from "@/lib/extraction-staging/store";
type Summary = { id: string; title: string; state: string; scopeNote: string };
type Detail = {
  candidate: Candidate;
  history: { headRevision: string | null; revisions: SavedRevision[] };
};
type Fields = Pick<
  Command,
  | "note"
  | "checks"
  | "readingOrderChecked"
  | "contextChecked"
  | "criticalCharactersChecked"
>;
const empty = (): Fields => ({
  note: "",
  checks: [],
  readingOrderChecked: false,
  contextChecked: false,
  criticalCharactersChecked: false,
});
async function request(url: string, options?: RequestInit) {
  const response = await fetch(url, { ...options, cache: "no-store" });
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error || "The review could not be loaded.");
  return value;
}
export default function ExtractionPanel({ viewerId }: { viewerId: string }) {
  const [items, setItems] = useState<Summary[]>([]),
    [detail, setDetail] = useState<Detail | null>(null),
    [fields, setFields] = useState<Fields>(empty),
    [parent, setParent] = useState<string | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [message, setMessage] = useState("Loading staging drafts…"),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [cacheOk, setCacheOk] = useState(true);
  const pending = useRef<{ signature: string; requestId: string } | null>(null);
  const key = detail
    ? "extraction-review:" + viewerId + ":" + detail.candidate.id
    : null;
  useEffect(() => {
    request("/api/staging/extraction")
      .then((v) => {
        setItems(v.candidates);
        setMessage(
          v.candidates.length
            ? "Choose a draft to review."
            : "No drafts have been imported into staging.",
        );
      })
      .catch((e) => setMessage(e.message));
  }, []);
  function backup(next: Fields, base: string | null) {
    if (!key) return;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          fields: next,
          parent: base,
          pending: pending.current,
        }),
      );
      setCacheOk(true);
    } catch {
      setCacheOk(false);
      setMessage(
        "Browser backup unavailable. Export your notes before leaving this draft.",
      );
    }
  }
  async function load(id: string, latest = false) {
    if (dirty && !cacheOk) {
      setMessage(
        "Export your current notes before switching or loading a saved review.",
      );
      return;
    }
    if (
      latest &&
      dirty &&
      !window.confirm(
        "Load the saved review and replace the fields on screen? Export first if you need both versions.",
      )
    )
      return;
    setBusy(true);
    try {
      const next: Detail = await request(
        "/api/staging/extraction?candidateId=" + id,
      );
      const saved = next.history.revisions[0]?.command;
      let form: Fields = saved
        ? {
            note: saved.note,
            checks: saved.checks,
            readingOrderChecked: saved.readingOrderChecked,
            contextChecked: saved.contextChecked,
            criticalCharactersChecked: saved.criticalCharactersChecked,
          }
        : empty();
      let base = next.history.headRevision;
      let backup = false;
      pending.current = null;
      if (!latest) {
        try {
          const raw = localStorage.getItem(
            "extraction-review:" + viewerId + ":" + id,
          );
          if (raw) {
            const local = JSON.parse(raw);
            if (
              local.fields &&
              Array.isArray(local.fields.checks) &&
              typeof local.fields.note === "string"
            ) {
              form = local.fields;
              base = local.parent;
              pending.current = local.pending ?? null;
              backup = true;
            }
          }
        } catch {
          setMessage(
            "Browser backup could not be read. Saved server revision is shown.",
          );
        }
      } else {
        try {
          localStorage.removeItem("extraction-review:" + viewerId + ":" + id);
        } catch {
          // The current form still comes from the server. Do not overwrite it with an old backup.
        }
      }
      setDetail(next);
      setFields(form);
      setParent(base);
      setSelected(next.candidate.regions[0]?.id ?? null);
      setDirty(backup);
      setCacheOk(true);
      setMessage(
        backup
          ? base !== next.history.headRevision
            ? "Browser notes recovered, but a newer saved revision exists. Export these notes before loading the latest."
            : "Browser notes recovered. They are not saved to review history yet."
          : "Saved review loaded. Source checks are separate from tax approval.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not load the draft.");
    } finally {
      setBusy(false);
    }
  }
  function update(change: Partial<Fields>) {
    const next = { ...fields, ...change };
    setFields(next);
    setDirty(true);
    backup(next, parent);
  }
  function check(regionId: string, state: string) {
    update({
      checks: [
        ...fields.checks.filter((c) => c.regionId !== regionId),
        ...(state
          ? [{ regionId, state: state as Command["checks"][number]["state"] }]
          : []),
      ],
    });
  }
  async function save(action: Command["action"]) {
    if (!detail) return;
    setBusy(true);
    const body = {
      candidateId: detail.candidate.id,
      parentRevision: parent,
      action,
      ...fields,
    };
    const signature = JSON.stringify(body);
    if (!pending.current || pending.current.signature !== signature)
      pending.current = { signature, requestId: crypto.randomUUID() };
    try {
      try {
        localStorage.setItem(
          key!,
          JSON.stringify({ fields, parent, pending: pending.current }),
        );
      } catch {
        setCacheOk(false);
      }
      const result = await request("/api/staging/extraction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, requestId: pending.current.requestId }),
      });
      if (result.headRevision !== result.revision.id)
        throw new Error(
          "A newer review exists. Your notes are kept; load the latest before making another save.",
        );
      setParent(result.revision.id);
      setDetail({
        ...detail,
        history: {
          headRevision: result.revision.id,
          revisions: [
            result.revision,
            ...detail.history.revisions.filter(
              (r) => r.id !== result.revision.id,
            ),
          ],
        },
      });
      pending.current = null;
      setDirty(false);
      try {
        localStorage.removeItem(key!);
      } catch {}
      setMessage(
        action === "ACCEPT_EXTRACTION"
          ? "Extraction review recorded for this exact scope. Tax approval is still pending."
          : "Review revision saved with your signed-in identity.",
      );
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "The save failed. Your notes are kept; retry uses the same save identity.",
      );
    } finally {
      setBusy(false);
    }
  }
  function download() {
    if (!detail) return;
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              candidateId: detail.candidate.id,
              sourceHash: detail.candidate.sourceHash,
              revisionHash: detail.candidate.revisionHash,
              parentRevision: parent,
              fields,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "extraction-review-notes.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const c = detail?.candidate,
    region = c?.regions.find((r) => r.id === selected),
    render = c?.renders.find((p) => p.page === region?.page),
    asset = (id: string) =>
      "/api/staging/extraction/" + c!.id + "/objects/" + id;
  const crop =
    region && render
      ? {
          x: Math.max(0, region.box.x0 - 18),
          y: Math.max(0, region.box.top - 18),
          right: Math.min(render.width, region.box.x1 + 18),
          bottom: Math.min(render.height, region.box.bottom + 18),
        }
      : null;
  const ready =
    !!c &&
    c.state === "AWAITING_EXTRACTION_REVIEW" &&
    c.kind === "native_full_pages" &&
    !c.blockingHolds.length &&
    fields.checks.length === c.regions.length &&
    fields.checks.every((x) => x.state === "checked") &&
    fields.readingOrderChecked &&
    fields.contextChecked &&
    fields.criticalCharactersChecked &&
    !!fields.note.trim();
  return (
    <main className="mx-auto max-w-7xl space-y-6 px-6 py-10 text-slate-900">
      <header>
        <p className="text-sm font-semibold text-emerald-700">
          Isolated extraction staging
        </p>
        <h1 className="text-3xl font-semibold">
          Review the extraction against its source
        </h1>
        <p className="mt-2 text-slate-600">
          Saved decisions identify the signed-in reviewer and exact source
          revision. Tax approval and live answers are separate.
        </p>
      </header>
      <nav aria-label="Extraction drafts" className="flex flex-wrap gap-3">
        {items.map((x) => (
          <button
            key={x.id}
            disabled={busy}
            onClick={() => load(x.id)}
            className="rounded border p-3 text-left"
          >
            <strong>{x.title}</strong>
            <span className="block text-sm">
              {x.state === "BLOCKED"
                ? "Has unresolved holds"
                : "Awaiting source review"}
            </span>
          </button>
        ))}
      </nav>
      {c && (
        <>
          <section className="rounded border bg-slate-50 p-4">
            <h2 className="font-semibold">{c.title}</h2>
            <p>{c.scopeNote}</p>
            <div className="mt-2 flex gap-5">
              <a
                href={c.officialUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Official source
              </a>
              <a href={asset(c.original.object_id)} className="underline">
                Download original PDF
              </a>
            </div>
            {c.blockingHolds.length > 0 && (
              <div className="mt-3 rounded bg-amber-50 p-3">
                <strong>This scope cannot be accepted yet.</strong>
                <ul className="list-inside list-disc">
                  {c.blockingHolds.map((h) => (
                    <li key={h}>{h.replaceAll("_", " ").toLowerCase()}</li>
                  ))}
                </ul>
              </div>
            )}
            {c.reviewHolds.length > 0 && (
              <details className="mt-3">
                <summary>
                  Checks flagged by the importer ({c.reviewHolds.length})
                </summary>
                <ul className="list-inside list-disc">
                  {c.reviewHolds.map((h) => (
                    <li key={h}>{h.replaceAll("_", " ").toLowerCase()}</li>
                  ))}
                </ul>
              </details>
            )}
            <details className="mt-3">
              <summary>Source and revision identifiers</summary>
              <p className="break-all text-xs">
                Original: {c.sourceHash}
                <br />
                Extraction: {c.revisionHash}
              </p>
            </details>
          </section>
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="self-start rounded border p-4 lg:sticky lg:top-4">
              <h2 className="mb-3 font-semibold">
                Original page {region?.page}
              </h2>
              {render && region && crop && (
                <>
                  <p className="mb-2 text-sm text-slate-600">
                    Source crop for {region.id}; open the complete page below to
                    check surrounding context.
                  </p>
                  <div
                    className="relative overflow-hidden border"
                    style={{
                      aspectRatio:
                        (crop.right - crop.x) / (crop.bottom - crop.y),
                    }}
                  >
                    <Image
                      src={asset(render.object.object_id)}
                      alt={"Source crop for " + region.id}
                      width={render.width}
                      height={render.height}
                      unoptimized
                      className="absolute h-auto"
                      style={{
                        maxWidth: "none",
                        width:
                          (100 * render.width) / (crop.right - crop.x) + "%",
                        left: (-100 * crop.x) / (crop.right - crop.x) + "%",
                        top: (-100 * crop.y) / (crop.bottom - crop.y) + "%",
                      }}
                    />
                    <div
                      className="pointer-events-none absolute border-2 border-amber-600 bg-amber-200/20"
                      style={{
                        left:
                          (100 * (region.box.x0 - crop.x)) /
                            (crop.right - crop.x) +
                          "%",
                        top:
                          (100 * (region.box.top - crop.y)) /
                            (crop.bottom - crop.y) +
                          "%",
                        width:
                          (100 * (region.box.x1 - region.box.x0)) /
                            (crop.right - crop.x) +
                          "%",
                        height:
                          (100 * (region.box.bottom - region.box.top)) /
                            (crop.bottom - crop.y) +
                          "%",
                      }}
                    />
                  </div>
                </>
              )}
              {render && (
                <details className="mt-3">
                  <summary>Show complete page and context</summary>
                  <div className="max-h-[75vh] overflow-auto">
                    <div className="relative">
                      <Image
                        src={asset(render.object.object_id)}
                        alt={"Original document page " + render.page}
                        width={render.width}
                        height={render.height}
                        unoptimized
                        className="h-auto w-full"
                      />
                      {region && (
                        <div
                          className="pointer-events-none absolute border-2 border-amber-600 bg-amber-200/20"
                          style={{
                            left: (100 * region.box.x0) / render.width + "%",
                            top: (100 * region.box.top) / render.height + "%",
                            width:
                              (100 * (region.box.x1 - region.box.x0)) /
                                render.width +
                              "%",
                            height:
                              (100 * (region.box.bottom - region.box.top)) /
                                render.height +
                              "%",
                          }}
                        />
                      )}
                    </div>
                  </div>
                </details>
              )}
            </section>
            <section className="space-y-4">
              <h2 className="font-semibold">Source-bound regions</h2>
              <p className="text-sm text-slate-600">
                Choose a region to see its position on the original. Record
                differences rather than guessing. Corrections must return
                through the validated extraction path.
              </p>
              <button
                disabled={busy}
                className="rounded border px-3 py-2"
                onClick={() =>
                  update({
                    checks: c.regions.map((r) => ({
                      regionId: r.id,
                      state: "checked",
                    })),
                  })
                }
              >
                I checked every region against the original
              </button>
              <div className="max-h-[32rem] space-y-3 overflow-auto">
                {c.regions.map((r) => (
                  <article
                    key={r.id}
                    className={
                      "rounded border p-3 " +
                      (selected === r.id
                        ? "border-emerald-600 bg-emerald-50"
                        : "")
                    }
                  >
                    <button
                      className="text-left text-sm font-semibold underline"
                      onClick={() => setSelected(r.id)}
                    >
                      {r.id} · page {r.page}
                    </button>
                    <p className="whitespace-pre-wrap">
                      {r.state === "blank"
                        ? "[confirmed blank]"
                        : (r.proposed ?? "[unresolved]")}
                    </p>
                    {r.note && (
                      <p className="text-xs text-slate-600">{r.note}</p>
                    )}
                    <details>
                      <summary className="text-xs">Raw extracted text</summary>
                      <p className="whitespace-pre-wrap text-sm">
                        {r.raw ?? "[no raw transcription]"}
                      </p>
                    </details>
                    <label className="mt-2 block text-sm">
                      Source check for {r.id}
                      <select
                        disabled={busy}
                        className="ml-2 rounded border p-1"
                        value={
                          fields.checks.find((x) => x.regionId === r.id)
                            ?.state ?? ""
                        }
                        onChange={(e) => check(r.id, e.target.value)}
                      >
                        <option value="">Not checked</option>
                        <option value="checked">Matches source</option>
                        <option value="needs_changes">Needs correction</option>
                        <option value="unreadable">Cannot verify</option>
                      </select>
                    </label>
                  </article>
                ))}
              </div>
              <fieldset className="space-y-2 rounded border p-4">
                <legend>Whole-scope source checks</legend>
                {(
                  [
                    [
                      "readingOrderChecked",
                      "Reading order and heading relationships are correct",
                    ],
                    [
                      "contextChecked",
                      "Required qualifications, context and footnotes are included",
                    ],
                    [
                      "criticalCharactersChecked",
                      "Numbers, dates, names, identifiers and negations match",
                    ],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="block">
                    <input
                      disabled={busy}
                      type="checkbox"
                      checked={fields[key]}
                      onChange={(e) => update({ [key]: e.target.checked })}
                    />{" "}
                    {label}
                  </label>
                ))}
              </fieldset>
              <label className="block">
                Review notes / decision reason
                <textarea
                  aria-label="Review notes / decision reason"
                  className="mt-1 w-full rounded border p-3"
                  rows={4}
                  maxLength={4000}
                  value={fields.note}
                  disabled={busy}
                  onChange={(e) => update({ note: e.target.value })}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  className="rounded border px-3 py-2"
                  disabled={busy}
                  onClick={() => save("SAVE_DRAFT")}
                >
                  Save review draft
                </button>
                <button
                  className="rounded border px-3 py-2"
                  disabled={busy || !fields.note.trim()}
                  onClick={() => save("REQUEST_CHANGES")}
                >
                  Request corrections
                </button>
                <button
                  className="rounded bg-emerald-700 px-3 py-2 text-white disabled:opacity-40"
                  disabled={busy || !ready}
                  onClick={() => save("ACCEPT_EXTRACTION")}
                >
                  Accept extraction for this scope
                </button>
                <button className="rounded border px-3 py-2" onClick={download}>
                  Export my notes
                </button>
                <button
                  className="rounded border px-3 py-2"
                  disabled={busy}
                  onClick={() => load(c.id, true)}
                >
                  Load latest saved review
                </button>
              </div>
              <p className="text-sm text-slate-600">
                {dirty ? "Unsaved review fields. " : ""}Acceptance checks source
                extraction only. Nothing on this page approves tax applicability
                or publishes to chat.
              </p>
              <p
                role="status"
                aria-live="polite"
                className="rounded bg-slate-100 p-3"
              >
                {message}
              </p>
              <details>
                <summary>
                  Saved review history ({detail!.history.revisions.length})
                </summary>
                {detail!.history.revisions.slice(0, 10).map((r) => (
                  <article
                    key={r.id}
                    className="mt-3 rounded border p-3 text-sm"
                  >
                    <strong>
                      {r.command.action.replaceAll("_", " ").toLowerCase()}
                    </strong>
                    <p>
                      Reviewer: {r.actorId} · {r.serverStamp}
                    </p>
                    <p className="whitespace-pre-wrap">{r.command.note}</p>
                    <p className="break-all text-xs">{r.id}</p>
                  </article>
                ))}
              </details>
            </section>
          </div>
        </>
      )}
      {!c && (
        <p role="status" className="rounded bg-slate-100 p-3">
          {message}
        </p>
      )}
    </main>
  );
}

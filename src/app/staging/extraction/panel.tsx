"use client";
import Image from "next/image";
import { useRef, useState, useSyncExternalStore } from "react";
import type { Candidate, Command } from "@/lib/extraction-staging/contract";
import {
  recordedTableRow,
  reviewQueue,
  type summarizeReview,
} from "@/lib/extraction-staging/review-queue";
import type { SavedRevision } from "@/lib/extraction-staging/store";
type Summary = ReturnType<typeof summarizeReview>;
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
const statusLabel = {
  blocked: "Incomplete extraction",
  needs_review: "Needs a decision",
  no_flags: "No issues flagged",
};
const statusPriority = { needs_review: 0, no_flags: 1, blocked: 2 };
const issueLabel = {
  unresolved: "Needs reading",
  changed: "Compare readings",
  key_text: "Verify key text",
};
const checkLabels = {
  checked: "Matches source",
  needs_changes: "Needs correction",
  unreadable: "Cannot verify",
};
type CheckState = keyof typeof checkLabels;
const readableFlag = (flag: string) => flag.replaceAll("_", " ").toLowerCase();

function readPosition(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function subscribePosition(notify: () => void) {
  window.addEventListener("storage", notify);
  return () => window.removeEventListener("storage", notify);
}
async function request(url: string, options?: RequestInit, timeout = 20000) {
  const signal = AbortSignal.timeout(timeout);
  try {
    const response = await fetch(url, {
      ...options,
      cache: "no-store",
      signal,
    });
    if (!response.headers.get("content-type")?.includes("application/json"))
      throw new Error(
        "The review server did not respond as expected. Retry without clearing your notes.",
      );
    const value = await response.json();
    if (!response.ok)
      throw new Error(value.error || "The review could not be loaded.");
    return value;
  } catch (error) {
    if (signal.aborted)
      throw new Error(
        options?.method === "POST"
          ? "The server took too long to confirm. Your edits are still here; retry to confirm the same save."
          : "The review took too long to load. Try opening it again.",
      );
    throw error;
  }
}
export default function ExtractionPanel({
  viewerId,
  drafts,
}: {
  viewerId: string;
  drafts: Summary[];
}) {
  const items = [...drafts].sort(
    (a, b) => statusPriority[a.status] - statusPriority[b.status],
  );
  const [detail, setDetail] = useState<Detail | null>(null),
    [fields, setFields] = useState<Fields>(empty),
    [parent, setParent] = useState<string | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [message, setMessage] = useState(
      drafts.length
        ? "Choose a draft to review."
        : "No drafts have been imported into staging.",
    ),
    [operation, setOperation] = useState<"opening" | Command["action"] | null>(
      null,
    ),
    [dirty, setDirty] = useState(false),
    [cacheOk, setCacheOk] = useState(true),
    [showAll, setShowAll] = useState(false),
    [showRow, setShowRow] = useState(false),
    [showPage, setShowPage] = useState(false),
    [filter, setFilter] = useState<Summary["status"] | "all">("all"),
    [lastOpened, setLastOpened] = useState<string | null>(null);
  const pending = useRef<{ signature: string; requestId: string } | null>(null);
  const busy = operation !== null;
  const key = detail
    ? "extraction-review:" + viewerId + ":" + detail.candidate.id
    : null;
  const positionKey = "extraction-review-position:" + viewerId;
  const rememberedId = useSyncExternalStore(
    subscribePosition,
    () => {
      const position = readPosition(positionKey) as {
        candidateId?: unknown;
      } | null;
      return typeof position?.candidateId === "string"
        ? position.candidateId
        : null;
    },
    () => null,
  );
  const resumeId = drafts.find(
    (item) => item.id === (lastOpened ?? rememberedId),
  )?.id;
  function remember(
    candidateId: string,
    regionId: string | null,
    all: boolean,
  ) {
    setLastOpened(candidateId);
    try {
      localStorage.setItem(
        positionKey,
        JSON.stringify({ candidateId, regionId, all }),
      );
    } catch {
      // The review draft has its own backup and can still be saved.
    }
  }
  function select(regionId: string | null, all = showAll) {
    setSelected(regionId);
    setShowAll(all);
    setShowRow(false);
    if (detail) remember(detail.candidate.id, regionId, all);
  }
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
    setOperation("opening");
    setMessage("Opening review…");
    try {
      const next: Detail = await request(
        "/api/staging/extraction?candidateId=" + id,
      );
      const head = next.history.revisions[0];
      const saved = head?.command;
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
              const alreadySaved =
                head?.actorId === viewerId &&
                saved &&
                head.requestId === local.pending?.requestId &&
                head.parentRevision === local.parent &&
                saved.note === local.fields.note &&
                saved.readingOrderChecked ===
                  local.fields.readingOrderChecked &&
                saved.contextChecked === local.fields.contextChecked &&
                saved.criticalCharactersChecked ===
                  local.fields.criticalCharactersChecked &&
                saved.checks.length === local.fields.checks.length &&
                saved.checks.every((entry, index) => {
                  const check = local.fields.checks[index];
                  return (
                    entry.regionId === check?.regionId &&
                    entry.state === check?.state
                  );
                });
              if (alreadySaved) {
                localStorage.removeItem(
                  "extraction-review:" + viewerId + ":" + id,
                );
              } else {
                form = local.fields;
                base = local.parent;
                pending.current = local.pending ?? null;
                backup = true;
              }
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
      const queue = reviewQueue(next.candidate);
      const position = readPosition(positionKey) as {
        candidateId?: unknown;
        regionId?: unknown;
        all?: unknown;
      } | null;
      const restore = position?.candidateId === id ? position : null;
      const all = restore?.all === true;
      const restored = next.candidate.regions.find(
        (region) =>
          region.id === restore?.regionId &&
          (all || queue.issues.some((issue) => issue.region.id === region.id)),
      );
      const nextRegion =
        restored?.id ??
        queue.issues.find(
          (issue) =>
            !form.checks.some((check) => check.regionId === issue.region.id),
        )?.region.id ??
        queue.issues[0]?.region.id ??
        next.candidate.regions[0]?.id ??
        null;
      setSelected(nextRegion);
      setShowAll(all);
      setShowRow(false);
      setShowPage(false);
      remember(id, nextRegion, all);
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
      setOperation(null);
    }
  }
  function update(change: Partial<Fields>) {
    const next = { ...fields, ...change };
    setFields(next);
    setDirty(true);
    backup(next, parent);
  }
  function check(regionId: string, state: CheckState | "") {
    update({
      checks: [
        ...fields.checks.filter((c) => c.regionId !== regionId),
        ...(state ? [{ regionId, state }] : []),
      ],
    });
  }
  async function save(action: Command["action"]) {
    if (!detail) return;
    setOperation(action);
    setMessage(
      action === "ACCEPT_EXTRACTION"
        ? "Verifying source files before recording acceptance…"
        : "Saving your review…",
    );
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
      const result = await request(
        "/api/staging/extraction",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...body,
            requestId: pending.current.requestId,
          }),
        },
        action === "ACCEPT_EXTRACTION" ? 65000 : 20000,
      );
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
      setOperation(null);
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
    queue = c ? reviewQueue(c) : null,
    region = c?.regions.find((r) => r.id === selected),
    render = c?.renders.find((p) => p.page === region?.page),
    asset = (id: string) =>
      "/api/staging/extraction/" + c!.id + "/objects/" + id;
  const issueIndex =
    queue?.issues.findIndex((item) => item.region.id === selected) ?? -1;
  const issue = queue?.issues[issueIndex];
  const checkByRegion = new Map(
    fields.checks.map((entry) => [entry.regionId, entry.state]),
  );
  const decided =
    queue?.issues.filter((item) => checkByRegion.has(item.region.id)).length ??
    0;
  const row = c && region ? recordedTableRow(c, region) : [];
  const boxes =
    showRow && row.length > 1
      ? row.map((cell) => cell.box)
      : region
        ? [region.box]
        : [];
  const crop =
    boxes.length > 0 && render
      ? {
          x: Math.max(0, Math.min(...boxes.map((box) => box.x0)) - 18),
          y: Math.max(0, Math.min(...boxes.map((box) => box.top)) - 18),
          right: Math.min(
            render.width,
            Math.max(...boxes.map((box) => box.x1)) + 18,
          ),
          bottom: Math.min(
            render.height,
            Math.max(...boxes.map((box) => box.bottom)) + 18,
          ),
        }
      : null;
  function decide(state: CheckState) {
    if (!issue || !queue) return;
    check(issue.region.id, state);
    const following = [
      ...queue.issues.slice(issueIndex + 1),
      ...queue.issues.slice(0, issueIndex),
    ].find((item) => !checkByRegion.has(item.region.id));
    if (following) select(following.region.id);
  }
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
        <h1 className="text-3xl font-semibold">Extraction review inbox</h1>
        <p className="mt-2 text-slate-600">
          Start with flagged evidence, then open the full review when you need
          it. Flags are suggestions; the original is the source of truth.
        </p>
      </header>
      <nav aria-label="Extraction drafts" className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm">
            Show{" "}
            <select
              className="rounded border p-2"
              value={filter}
              onChange={(event) =>
                setFilter(event.target.value as typeof filter)
              }
            >
              <option value="all">All drafts</option>
              {Object.entries(statusLabel).map(([status, label]) => (
                <option key={status} value={status}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {resumeId && !c && (
            <button
              className="rounded border px-3 py-2"
              disabled={busy}
              onClick={() => load(resumeId)}
            >
              Resume last draft
            </button>
          )}
          <span className="text-sm text-slate-600">{items.length} loaded</span>
        </div>
        <div className="grid gap-2 lg:grid-cols-2">
          {items
            .filter((x) => filter === "all" || x.status === filter)
            .map((x) => (
              <button
                key={x.id}
                disabled={busy}
                aria-pressed={c?.id === x.id}
                onClick={() => load(x.id)}
                className={
                  "rounded border p-3 text-left " +
                  (c?.id === x.id ? "border-emerald-600 bg-emerald-50" : "")
                }
              >
                <strong>{x.title}</strong>
                <span className="block text-sm">
                  {statusLabel[x.status]} · {x.issueCount} flagged regions
                  {x.documentCheckCount
                    ? ` · ${x.documentCheckCount} document checks`
                    : ""}
                  {x.holdCount ? ` · ${x.holdCount} holds` : ""}
                  {" · Version " + x.revision}
                </span>
              </button>
            ))}
        </div>
        {items.length > 0 &&
          !items.some((x) => filter === "all" || x.status === filter) && (
            <p className="text-sm text-slate-600">
              No drafts match this filter.
            </p>
          )}
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
                    <li key={h}>{readableFlag(h)}</li>
                  ))}
                </ul>
              </div>
            )}
            {!!queue?.documentChecks.length && (
              <details className="mt-3">
                <summary>
                  Document checks ({queue.documentChecks.length})
                </summary>
                <p className="text-sm text-slate-600">
                  These importer checks apply to the scope as a whole. They do
                  not identify an exact location on the page.
                </p>
                <ul className="list-inside list-disc">
                  {queue.documentChecks.map((h) => (
                    <li key={h}>{readableFlag(h)}</li>
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
            <section className="self-start rounded border p-4 lg:sticky lg:top-24">
              <h2 className="mb-3 font-semibold">
                Original page {region?.page}
              </h2>
              {render && region && crop && (
                <>
                  <p className="mb-2 text-sm text-slate-600">
                    {showRow && row.length > 1
                      ? "Recorded row around "
                      : "Source crop for "}
                    {region.id}. Open the complete page to check surrounding
                    context.
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
                  {row.length > 1 && (
                    <button
                      type="button"
                      className="mt-2 rounded border px-3 py-1.5 text-sm"
                      aria-pressed={showRow}
                      onClick={() => setShowRow(!showRow)}
                    >
                      {showRow
                        ? "Show selected cell only"
                        : "Show recorded row"}
                    </button>
                  )}
                </>
              )}
              {render && (
                <details
                  className="mt-3"
                  open={showPage}
                  onToggle={(event) => setShowPage(event.currentTarget.open)}
                >
                  <summary>Show complete page and context</summary>
                  {c.kind === "image_table_band" && (
                    <p className="text-sm text-slate-600">
                      Use the original page to verify headers, units, and
                      footnotes.
                    </p>
                  )}
                  {showPage && (
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
                  )}
                </details>
              )}
            </section>
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">
                  {showAll ? "Full source review" : "Flagged evidence"}
                </h2>
                <button
                  className="rounded border px-3 py-2 text-sm"
                  disabled={busy}
                  onClick={() =>
                    select(
                      showAll && !issue
                        ? (queue?.issues[0]?.region.id ?? selected)
                        : selected,
                      !showAll,
                    )
                  }
                >
                  {showAll
                    ? "Show flagged evidence"
                    : "Open full source review"}
                </button>
              </div>
              {!showAll && queue && (
                <div className="space-y-3 rounded border p-4">
                  <p aria-live="polite" className="text-sm text-slate-600">
                    {decided} of {queue.issues.length} flagged regions have a
                    review result.
                    {queue.documentChecks.length > 0 &&
                      " Check the document-level warnings above as well."}
                  </p>
                  {issue ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="text-sm">
                          Flagged region{" "}
                          <select
                            className="rounded border p-2"
                            disabled={busy}
                            value={issue.region.id}
                            onChange={(e) => select(e.target.value)}
                          >
                            {queue.issues.map(({ region: item, kind }) => (
                              <option key={item.id} value={item.id}>
                                {item.id} · page {item.page} ·{" "}
                                {issueLabel[kind]}
                                {checkByRegion.has(item.id)
                                  ? " (result recorded)"
                                  : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          className="rounded border px-2 py-1.5 text-sm"
                          disabled={busy || issueIndex <= 0}
                          onClick={() =>
                            select(queue.issues[issueIndex - 1].region.id)
                          }
                        >
                          Previous issue
                        </button>
                        <button
                          className="rounded border px-2 py-1.5 text-sm"
                          disabled={
                            busy || issueIndex >= queue.issues.length - 1
                          }
                          onClick={() =>
                            select(queue.issues[issueIndex + 1].region.id)
                          }
                        >
                          Next issue
                        </button>
                      </div>
                      <p className="text-sm font-medium">{issue.reason}</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="min-w-0 rounded bg-slate-50 p-3">
                          <p className="text-xs font-semibold">
                            Proposed transcription
                          </p>
                          <p className="whitespace-pre-wrap break-words">
                            {issue.region.proposed?.trim()
                              ? issue.region.proposed
                              : "[unresolved]"}
                          </p>
                        </div>
                        <div className="min-w-0 rounded bg-slate-50 p-3">
                          <p className="text-xs font-semibold">
                            Raw extraction
                          </p>
                          <p className="whitespace-pre-wrap break-words">
                            {issue.region.raw ?? "[no raw transcription]"}
                          </p>
                        </div>
                      </div>
                      {issue.region.note && (
                        <p className="text-sm text-slate-600">
                          {issue.region.note}
                        </p>
                      )}
                      <div
                        className="flex flex-wrap gap-2"
                        aria-label="Result for this region"
                      >
                        {(
                          Object.entries(checkLabels) as [CheckState, string][]
                        ).map(([state, label]) => (
                          <button
                            key={state}
                            disabled={busy}
                            aria-pressed={
                              checkByRegion.get(issue.region.id) === state
                            }
                            className={
                              "rounded border px-3 py-2 text-sm " +
                              (checkByRegion.get(issue.region.id) === state
                                ? "border-emerald-600 bg-emerald-50"
                                : "")
                            }
                            onClick={() => decide(state)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-slate-600">
                        Choose a result to move to the next unreviewed issue.
                        Include the region ID in your notes if a correction is
                        needed.
                      </p>
                    </>
                  ) : (
                    <p className="text-sm">
                      No individual regions were flagged. Inspect the original
                      and use the full source review to check the scope.
                    </p>
                  )}
                </div>
              )}
              {showAll && (
                <>
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
                          state: checkByRegion.get(r.id) ?? "checked",
                        })),
                      })
                    }
                  >
                    I checked all remaining regions against the original
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
                          onClick={() => select(r.id)}
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
                          <summary className="text-xs">
                            Raw extracted text
                          </summary>
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
                            onChange={(e) =>
                              check(r.id, e.target.value as CheckState | "")
                            }
                          >
                            <option value="">Not checked</option>
                            <option value="checked">Matches source</option>
                            <option value="needs_changes">
                              Needs correction
                            </option>
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
                </>
              )}
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
                  {operation === "SAVE_DRAFT"
                    ? "Saving draft…"
                    : "Save review draft"}
                </button>
                <button
                  className="rounded border px-3 py-2"
                  disabled={busy || !fields.note.trim()}
                  onClick={() => save("REQUEST_CHANGES")}
                >
                  {operation === "REQUEST_CHANGES"
                    ? "Saving corrections…"
                    : "Request corrections"}
                </button>
                {showAll && (
                  <button
                    className="rounded bg-emerald-700 px-3 py-2 text-white disabled:opacity-40"
                    disabled={busy || !ready}
                    onClick={() => save("ACCEPT_EXTRACTION")}
                  >
                    {operation === "ACCEPT_EXTRACTION"
                      ? "Verifying evidence…"
                      : "Accept extraction for this scope"}
                  </button>
                )}
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
                {dirty ? "Unsaved review fields. " : ""}
                {showAll
                  ? "Acceptance checks extraction only; tax approval remains separate."
                  : "Save a draft after reviewing the flags. A flag review does not certify the whole document."}
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

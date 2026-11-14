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
    [lastResult, setLastResult] = useState<string | null>(null),
    [message, setMessage] = useState(
      drafts.length
        ? "Choose a draft to review."
        : "No drafts have been imported into staging.",
    ),
    [operation, setOperation] = useState<Command["action"] | null>(null),
    [openingId, setOpeningId] = useState<string | null>(null),
    [sourceStatus, setSourceStatus] = useState<{
      url: string;
      loaded: boolean;
    } | null>(null),
    [sourceAttempt, setSourceAttempt] = useState(0),
    [dirty, setDirty] = useState(false),
    [cacheOk, setCacheOk] = useState(true),
    [showAll, setShowAll] = useState(false),
    [showRow, setShowRow] = useState(false),
    [showPage, setShowPage] = useState(false),
    [filter, setFilter] = useState<Summary["status"] | "all">("all"),
    [lastOpened, setLastOpened] = useState<string | null>(null);
  const pending = useRef<{ signature: string; requestId: string } | null>(null);
  const busy = operation !== null || openingId !== null;
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
    const regions = detail?.candidate.regions;
    if (
      regions?.find((item) => item.id === regionId)?.page !==
      regions?.find((item) => item.id === selected)?.page
    )
      setSourceStatus(null);
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
    setOpeningId(id);
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
      if (id !== detail?.candidate.id) setSourceStatus(null);
      setDetail(next);
      setLastResult(null);
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
      const regions = all
        ? next.candidate.regions
        : queue.issues.map((issue) => issue.region);
      const checked = new Set(form.checks.map((entry) => entry.regionId));
      const nextRegion =
        restored?.id ??
        regions.find((item) => !checked.has(item.id))?.id ??
        regions[0]?.id ??
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
      setOpeningId(null);
    }
  }
  function update(change: Partial<Fields>) {
    const next = { ...fields, ...change };
    setFields(next);
    setDirty(true);
    backup(next, parent);
  }
  function check(regionId: string, state: CheckState | null) {
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
  const issue = queue?.issues.find((item) => item.region.id === selected);
  const flaggedRegions = queue?.issues.map((item) => item.region) ?? [];
  const reviewRegions = showAll ? (c?.regions ?? []) : flaggedRegions;
  const activeIndex = reviewRegions.findIndex((item) => item.id === selected);
  const activeRegion = reviewRegions[activeIndex];
  const sourceUrl = render ? asset(render.object.object_id) : null;
  const sourceReady = sourceStatus?.url === sourceUrl && sourceStatus?.loaded;
  const checkByRegion = new Map(
    fields.checks.map((entry) => [entry.regionId, entry.state]),
  );
  const decided = reviewRegions.filter((item) =>
    checkByRegion.has(item.id),
  ).length;
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
    if (!activeRegion || !sourceReady) return;
    check(activeRegion.id, state);
    setLastResult(`${activeRegion.id} · ${checkLabels[state]}`);
    const following = [
      ...reviewRegions.slice(activeIndex + 1),
      ...reviewRegions.slice(0, activeIndex),
    ].find((item) => !checkByRegion.has(item.id));
    if (following) select(following.id);
  }
  function toggleReviewMode() {
    if (!c) return;
    const regions = showAll ? flaggedRegions : c.regions;
    const next = regions.find((item) => !checkByRegion.has(item.id));
    const current = regions.find((item) => item.id === selected);
    select(
      next?.id ?? current?.id ?? regions[0]?.id ?? c.regions[0]?.id ?? null,
      !showAll,
    );
  }
  const canAccept =
    c?.state === "AWAITING_EXTRACTION_REVIEW" &&
    c.kind === "native_full_pages" &&
    !c.blockingHolds.length;
  const acceptanceMessage = !canAccept
    ? c?.blockingHolds.length
      ? `Acceptance is blocked by ${c.blockingHolds.length} extraction holds. Save your findings or request corrections. A repaired extraction is needed.`
      : "This scope is available for review findings only."
    : fields.checks.length !== c.regions.length ||
        c.regions.some((item) => !checkByRegion.has(item.id))
      ? "Review the remaining regions to continue."
      : fields.checks.some((entry) => entry.state !== "checked")
        ? "Acceptance requires every region to match the source. Request corrections for any differences."
        : !fields.readingOrderChecked ||
            !fields.contextChecked ||
            !fields.criticalCharactersChecked
          ? "Complete the whole-scope checks to continue."
          : !fields.note.trim()
            ? "Add a decision reason to continue."
            : null;
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
                disabled={busy || c?.id === x.id}
                aria-pressed={c?.id === x.id}
                aria-busy={openingId === x.id}
                onClick={() => load(x.id)}
                className={
                  "rounded border p-3 text-left " +
                  (c?.id === x.id ? "border-emerald-600 bg-emerald-50" : "")
                }
              >
                <strong>{x.title}</strong>
                {openingId === x.id && (
                  <span className="ml-2 text-sm">Opening…</span>
                )}
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
      {openingId && (
        <p role="status" className="rounded bg-slate-100 p-3">
          Opening {items.find((item) => item.id === openingId)?.title}…
        </p>
      )}
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
                  <svg
                    role="img"
                    aria-label={"Source crop for " + region.id}
                    className="block h-auto w-full overflow-hidden border"
                    width={crop.right - crop.x}
                    height={crop.bottom - crop.y}
                    viewBox={`${crop.x} ${crop.y} ${crop.right - crop.x} ${crop.bottom - crop.y}`}
                  >
                    <image
                      key={sourceUrl + ":" + sourceAttempt}
                      href={sourceUrl ?? undefined}
                      width={render.width}
                      height={render.height}
                      onLoad={() =>
                        sourceUrl &&
                        setSourceStatus({ url: sourceUrl, loaded: true })
                      }
                      onError={() =>
                        sourceUrl &&
                        setSourceStatus({ url: sourceUrl, loaded: false })
                      }
                    />
                    {sourceReady && (
                      <rect
                        x={region.box.x0}
                        y={region.box.top}
                        width={region.box.x1 - region.box.x0}
                        height={region.box.bottom - region.box.top}
                        className="fill-amber-200/20 stroke-amber-600"
                        strokeWidth={2}
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                  </svg>
                  {!sourceReady && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                      <p role="status">
                        {sourceStatus?.url === sourceUrl
                          ? "The source image could not be loaded."
                          : "Loading source image…"}
                      </p>
                      {sourceStatus?.url === sourceUrl && (
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded border px-2 py-1"
                          onClick={() => {
                            setSourceStatus(null);
                            setSourceAttempt((attempt) => attempt + 1);
                          }}
                        >
                          Retry source image
                        </button>
                      )}
                    </div>
                  )}
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
                  onClick={toggleReviewMode}
                >
                  {showAll
                    ? "Show flagged evidence"
                    : "Open full source review"}
                </button>
              </div>
              <div className="space-y-3 rounded border p-4">
                <p aria-live="polite" className="text-sm text-slate-600">
                  {decided} of {reviewRegions.length}{" "}
                  {showAll ? "regions" : "flagged regions"} reviewed.
                  {activeRegion &&
                    ` Viewing ${activeRegion.id}, page ${activeRegion.page}.`}
                </p>
                <p role="status" className="min-h-5 text-sm text-slate-600">
                  {lastResult ? `Recorded in draft: ${lastResult}` : ""}
                </p>
                {activeRegion ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        className="rounded border px-2 py-1.5 text-sm disabled:opacity-50"
                        disabled={busy || activeIndex <= 0}
                        onClick={() =>
                          select(reviewRegions[activeIndex - 1].id)
                        }
                      >
                        Previous
                      </button>
                      <button
                        className="rounded border px-2 py-1.5 text-sm disabled:opacity-50"
                        disabled={
                          busy || activeIndex >= reviewRegions.length - 1
                        }
                        onClick={() =>
                          select(reviewRegions[activeIndex + 1].id)
                        }
                      >
                        Next
                      </button>
                      <label className="text-sm">
                        Jump to{" "}
                        <select
                          className="rounded border p-1.5"
                          disabled={busy}
                          value={activeRegion.id}
                          onChange={(e) => select(e.target.value)}
                        >
                          {reviewRegions.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.id} · page {item.page}
                              {checkByRegion.has(item.id) ? " · reviewed" : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div
                      className="flex flex-wrap gap-2"
                      role="group"
                      aria-label={`Result for ${activeRegion.id}`}
                    >
                      {(
                        Object.entries(checkLabels) as [CheckState, string][]
                      ).map(([state, label]) => (
                        <button
                          key={state}
                          disabled={busy || !sourceReady}
                          aria-pressed={
                            checkByRegion.get(activeRegion.id) === state
                          }
                          className={
                            "rounded border px-3 py-2 text-sm disabled:opacity-50 " +
                            (checkByRegion.get(activeRegion.id) === state
                              ? "border-emerald-700 bg-emerald-50"
                              : "hover:bg-slate-50")
                          }
                          onClick={() => decide(state)}
                        >
                          {label}
                        </button>
                      ))}
                      {checkByRegion.has(activeRegion.id) && (
                        <button
                          type="button"
                          className="px-2 py-2 text-sm underline disabled:opacity-50"
                          disabled={busy}
                          onClick={() => {
                            check(activeRegion.id, null);
                            setLastResult(
                              `${activeRegion.id} · Result cleared`,
                            );
                          }}
                        >
                          Clear result
                        </button>
                      )}
                    </div>
                    {issue && (
                      <p className="text-sm font-medium">
                        {issueLabel[issue.kind]} · {issue.reason}
                      </p>
                    )}
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="min-w-0 rounded bg-slate-50 p-3">
                        <p className="text-xs font-semibold">
                          Proposed transcription
                        </p>
                        <p className="whitespace-pre-wrap break-words">
                          {activeRegion.state === "blank"
                            ? "[confirmed blank]"
                            : activeRegion.proposed?.trim()
                              ? activeRegion.proposed
                              : "[unresolved]"}
                        </p>
                      </div>
                      <div className="min-w-0 rounded bg-slate-50 p-3">
                        <p className="text-xs font-semibold">Raw extraction</p>
                        <p className="whitespace-pre-wrap break-words">
                          {activeRegion.raw ?? "[no raw transcription]"}
                        </p>
                      </div>
                    </div>
                    {activeRegion.note && (
                      <p className="text-sm text-slate-600">
                        {activeRegion.note}
                      </p>
                    )}
                    <p className="text-xs text-slate-600">
                      A choice moves to the next unchecked region. Use Previous
                      or Jump to to change a result. Include the region ID in
                      your notes when a correction is needed.
                    </p>
                  </>
                ) : (
                  <p className="text-sm">
                    No individual regions were flagged. Open full source review
                    to check the scope.
                  </p>
                )}
              </div>
              {showAll && canAccept && (
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
                    aria-describedby={
                      acceptanceMessage ? "acceptance-requirements" : undefined
                    }
                    disabled={busy || acceptanceMessage !== null}
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
              {showAll && acceptanceMessage && (
                <p
                  id="acceptance-requirements"
                  className="rounded bg-amber-50 p-3 text-sm"
                >
                  {acceptanceMessage}
                </p>
              )}
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

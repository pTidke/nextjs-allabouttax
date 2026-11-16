import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import type { EngineDocument } from "./extraction-runs";
import {
  applyReviewedLines,
  lineDecisions,
  progress,
  requiredLines,
  type Decided,
} from "./line-reviews";
import {
  STAGING_REVIEWER,
  draftFromStaging,
  matchLines,
  plannedDecisions,
  type StagingCandidate,
  type StagingCommand,
  type StagingTaxFields,
} from "./staging-carry-over";

// R3, step 2: writes the staging review work into the live review records. The
// staging rows are read by the caller (scripts/staging-carry-over.ts) and passed
// in, so this can be run, and tested, without the staging database.
//
// For each staging document (the newest candidate of each repair lineage) with
// a pending live version of the same file:
// - its history (revisions and tax reviews across the lineage) is kept in a
//   StagingCarryOver row;
// - the findings of its latest revision become line decisions on the live
//   engine run, where a line matches a region by text (see plannedDecisions);
// - an accepted extraction becomes an accepted live text check, rebuilding the
//   chatbot's passages, but only when every line live review asks about is then
//   decided and none is unreadable;
// - its latest tax review becomes a live tax-review draft for each tax reviewer
//   who has none. Nothing is published.
// It is safe to run again: a document is carried over once per engine run.

export type StagingData = {
  candidates: {
    id: string;
    payload: StagingCandidate;
    head: string | null;
  }[];
  revisions: {
    id: string;
    candidate_id: string;
    action: string;
    created_at: Date;
    payload: StagingCommand | null;
  }[];
  taxReviews:
    | {
        candidate_id: string;
        extraction_revision: string;
        decision: string;
        created_at: Date;
        fields: StagingTaxFields;
      }[]
    | null;
};

const short = (id: string) => id.slice(0, 12);

function lineage(data: StagingData, headId: string) {
  const byId = new Map(data.candidates.map((c) => [c.id, c]));
  const ids: string[] = [];
  let next: string | undefined = headId;
  while (next && byId.has(next) && !ids.includes(next)) {
    ids.push(next);
    next = byId.get(next)!.payload.repair?.replacesCandidateId;
  }
  return ids;
}

export async function carryOver(
  data: StagingData,
  options: { write: boolean },
) {
  const replaced = new Set(
    data.candidates
      .map((c) => c.payload.repair?.replacesCandidateId)
      .filter(Boolean),
  );
  const results = [];
  const headAction = (c: StagingData["candidates"][number]) =>
    data.revisions.find((r) => r.id === c.head)?.action;
  // Accepted reviews first: once a document's text is accepted, other staging
  // work on the same file (drafts, repair pilots) adds history, not decisions.
  const heads = data.candidates
    .filter((c) => !replaced.has(c.id))
    .sort(
      (a, b) =>
        Number(headAction(b) === "ACCEPT_EXTRACTION") -
        Number(headAction(a) === "ACCEPT_EXTRACTION"),
    );
  // In a plan nothing is written, so remember what would have been accepted.
  const acceptedInThisRun = new Set<string>();
  for (const head of heads) {
    const c = head.payload;
    const ids = lineage(data, head.id);
    const revisions = data.revisions
      .filter((r) => ids.includes(r.candidate_id))
      .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
    const headRevision = revisions.find((r) => r.id === head.head) ?? null;
    const taxReviews = (data.taxReviews ?? []).filter((t) =>
      ids.includes(t.candidate_id),
    );
    const latestTax =
      [...taxReviews]
        .filter((t) => t.extraction_revision === head.head)
        .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0] ??
      null;
    const report = {
      candidate: short(head.id),
      title: c.title,
      lineage: ids.length,
      head: headRevision?.action ?? null,
    };

    const version = await prisma.taxVersion.findFirst({
      where: { originalHash: c.sourceHash, status: "PENDING" },
      orderBy: { fetchedAt: "desc" },
      select: {
        id: true,
        document: { select: { latestVersionId: true } },
        extractionReviews: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { decision: true },
        },
      },
    });
    if (!version || version.document.latestVersionId !== version.id) {
      results.push({ ...report, outcome: "no pending live copy of this file" });
      continue;
    }
    const run = await prisma.extractionRun.findFirst({
      where: { versionId: version.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const usable = run?.status === "OK" && run.document ? run : null;
    const runId = usable?.id ?? "";
    if (
      await prisma.stagingCarryOver.findUnique({
        where: { candidateId_runId: { candidateId: head.id, runId } },
        select: { id: true },
      })
    ) {
      results.push({
        ...report,
        version: version.id,
        outcome: usable
          ? "already carried over onto this engine run"
          : "history already kept; waiting for the engine to read it",
      });
      continue;
    }

    const alreadyAccepted =
      version.extractionReviews[0]?.decision === "ACCEPTED" ||
      acceptedInThisRun.has(version.id);
    let planned: ReturnType<typeof plannedDecisions> = [];
    let state = null as ReturnType<typeof progress> | null;
    if (usable && !alreadyAccepted) {
      const document = usable.document as unknown as EngineDocument;
      const required = requiredLines(usable.id, document);
      const existing = await lineDecisions(usable.id);
      planned = plannedDecisions(
        matchLines(c, document).pairs,
        headRevision?.payload?.checks ?? [],
        new Set(required.all.map((l) => l.id)),
        new Set(existing.keys()),
      );
      const after = new Map<string, Decided>(existing);
      for (const p of planned)
        after.set(p.lineId, {
          decision: p.decision,
          text: p.text,
          reviewer: STAGING_REVIEWER,
          at: new Date(),
        });
      state = progress(required, after);
    }
    const acceptText =
      headRevision?.action === "ACCEPT_EXTRACTION" &&
      !alreadyAccepted &&
      !!state?.complete;
    const taxUsers = latestTax
      ? (
          await prisma.reviewerGrant.findMany({
            where: {
              role: "TAX",
              revokedAt: null,
              user: { taxReviewDrafts: { none: { versionId: version.id } } },
            },
            select: { userId: true },
          })
        ).map((g) => g.userId)
      : [];
    const counts: Record<string, number> = {};
    for (const p of planned) counts[p.decision] = (counts[p.decision] ?? 0) + 1;
    const outcome = {
      ...report,
      version: version.id,
      engineRun: usable ? short(usable.id) : "not read by the engine yet",
      lineDecisions: alreadyAccepted
        ? "none: the live text is already accepted; history only"
        : counts,
      stillUndecided: state?.undecided ?? null,
      unreadable: state?.unreadable ?? null,
      acceptText,
      taxDrafts: taxUsers.length,
    };
    if (acceptText) acceptedInThisRun.add(version.id);
    if (!options.write) {
      results.push({ ...outcome, outcome: "would write" });
      continue;
    }

    const history = {
      officialUrl: c.officialUrl,
      lineage: ids.map(short),
      revisions: revisions.map((r) => {
        const findings: Record<string, number> = {};
        for (const check of r.payload?.checks ?? [])
          findings[check.state] = (findings[check.state] ?? 0) + 1;
        return {
          candidate: short(r.candidate_id),
          action: r.action,
          at: new Date(r.created_at).toISOString(),
          findings,
          issues: r.payload?.issues?.length ?? 0,
          note: r.payload?.note?.trim() || null,
        };
      }),
      taxReviews: taxReviews.map((t) => ({
        decision: t.decision,
        at: new Date(t.created_at).toISOString(),
        fields: t.fields,
      })),
    };
    const accepted = headRevision
      ? new Date(headRevision.created_at).toISOString().slice(0, 10)
      : "";
    await prisma.$transaction(
      async (tx) => {
        await tx.stagingCarryOver.create({
          data: {
            versionId: version.id,
            candidateId: head.id,
            runId,
            title: c.title.slice(0, 1000),
            kind: c.kind,
            headAction: headRevision?.action ?? null,
            history: history as Prisma.InputJsonValue,
            lineDecisions: planned.length,
            textAccepted: acceptText,
            taxDrafts: taxUsers.length,
          },
        });
        if (usable && planned.length)
          await tx.lineReview.createMany({
            data: planned.map((p) => ({
              versionId: version.id,
              runId: usable.id,
              lineId: p.lineId,
              decision: p.decision,
              text: p.text,
              reviewerId: STAGING_REVIEWER,
            })),
          });
        if (acceptText) {
          // The same as accepting in the review page: the passages the chatbot
          // uses are rebuilt from the reviewed lines.
          await applyReviewedLines(tx, version.id);
          await tx.extractionReview.create({
            data: {
              versionId: version.id,
              reviewerId: STAGING_REVIEWER,
              decision: "ACCEPTED",
              note: `Carried over from the staging review, where the extraction was accepted on ${accepted} (revision ${short(head.head!)}).`,
            },
          });
        }
        if (latestTax)
          for (const userId of taxUsers)
            await tx.taxReviewDraft.create({
              data: {
                versionId: version.id,
                userId,
                fields: draftFromStaging(
                  latestTax.fields,
                  latestTax.decision,
                  new Date(latestTax.created_at),
                ),
              },
            });
      },
      { timeout: 30_000 },
    );
    results.push({ ...outcome, outcome: "written" });
  }
  return results;
}

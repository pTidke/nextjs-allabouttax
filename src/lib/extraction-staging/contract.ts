import { createHash } from "node:crypto";
import { HttpError } from "../http";
export const SHA = /^[a-f0-9]{64}$/;
export const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
export type ObjectRef = { object_id: string; sha256: string };
export type Region = {
  id: string;
  page: number;
  raw: string | null;
  proposed: string | null;
  state: string;
  note: string;
  box: { x0: number; top: number; x1: number; bottom: number };
};
export type Candidate = {
  id: string;
  sourceId: string;
  sourceHash: string;
  runId: string;
  revisionHash: string;
  title: string;
  officialUrl: string;
  scopeNote: string;
  kind: "native_full_pages" | "image_table_band";
  state: "BLOCKED" | "AWAITING_EXTRACTION_REVIEW";
  blockingHolds: string[];
  reviewHolds: string[];
  regions: Region[];
  evidence: ObjectRef[];
  original: ObjectRef;
  renders: { page: number; object: ObjectRef; width: number; height: number }[];
  repair?: {
    replacesCandidateId: string;
    requestRevisionId: string;
    description: string;
  };
};
export type ReportedIssue = {
  regionId: string | null;
  page: number | null;
  description: string;
};
export type Check = {
  regionId: string;
  state: "checked" | "needs_changes" | "unreadable";
};
export type Command = {
  candidateId: string;
  parentRevision: string | null;
  requestId: string;
  action: "SAVE_DRAFT" | "ACCEPT_EXTRACTION" | "REQUEST_CHANGES";
  note: string;
  checks: Check[];
  readingOrderChecked: boolean;
  contextChecked: boolean;
  criticalCharactersChecked: boolean;
  issues?: ReportedIssue[];
};
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "Invalid review command.");
  return value as Record<string, unknown>;
}
export function parseCommand(value: unknown): Command {
  const v = object(value),
    keys = [
      "candidateId",
      "parentRevision",
      "requestId",
      "action",
      "note",
      "checks",
      "readingOrderChecked",
      "contextChecked",
      "criticalCharactersChecked",
    ];
  if (
    Object.keys(v).some((k) => k !== "issues" && !keys.includes(k)) ||
    keys.some((k) => !(k in v))
  )
    throw new HttpError(400, "Unexpected or missing review fields.");
  if (
    typeof v.candidateId !== "string" ||
    !SHA.test(v.candidateId) ||
    !(
      v.parentRevision === null ||
      (typeof v.parentRevision === "string" && SHA.test(v.parentRevision))
    ) ||
    typeof v.requestId !== "string" ||
    !/^[A-Za-z0-9-]{16,100}$/.test(v.requestId) ||
    typeof v.action !== "string" ||
    !["SAVE_DRAFT", "ACCEPT_EXTRACTION", "REQUEST_CHANGES"].includes(
      String(v.action),
    ) ||
    typeof v.note !== "string" ||
    v.note.length > 4000 ||
    !Array.isArray(v.checks) ||
    v.checks.length > 1000 ||
    ["readingOrderChecked", "contextChecked", "criticalCharactersChecked"].some(
      (k) => typeof v[k] !== "boolean",
    )
  )
    throw new HttpError(400, "Invalid review command.");
  const checks = v.checks.map((x) => {
    const c = object(x);
    if (
      Object.keys(c).sort().join(",") !== "regionId,state" ||
      typeof c.regionId !== "string" ||
      c.regionId.length > 100 ||
      !["checked", "needs_changes", "unreadable"].includes(String(c.state))
    )
      throw new HttpError(400, "Invalid region finding.");
    return c as Check;
  });
  if (new Set(checks.map((c) => c.regionId)).size !== checks.length)
    throw new HttpError(400, "Duplicate region findings.");
  if ("issues" in v) {
    if (!Array.isArray(v.issues) || v.issues.length > 50)
      throw new HttpError(
        400,
        "A review can include at most 50 issue reports.",
      );
    for (const entry of v.issues) {
      const issue = object(entry);
      if (
        Object.keys(issue).sort().join(",") !== "description,page,regionId" ||
        (issue.regionId !== null &&
          (typeof issue.regionId !== "string" ||
            !issue.regionId ||
            issue.regionId.length > 100)) ||
        (issue.page !== null &&
          (typeof issue.page !== "number" ||
            !Number.isSafeInteger(issue.page) ||
            issue.page < 1)) ||
        (issue.regionId !== null && issue.page === null) ||
        typeof issue.description !== "string" ||
        !issue.description.trim() ||
        issue.description.length > 500
      )
        throw new HttpError(
          400,
          "An issue report needs a valid location and description.",
        );
    }
  }
  return { ...v, checks } as Command;
}
export function validateCandidate(value: Candidate) {
  if (
    !SHA.test(value.id) ||
    !SHA.test(value.sourceHash) ||
    !SHA.test(value.revisionHash) ||
    !identifier.test(value.sourceId) ||
    !value.runId ||
    value.title.length > 1000 ||
    value.scopeNote.length > 4000 ||
    !["BLOCKED", "AWAITING_EXTRACTION_REVIEW"].includes(value.state) ||
    !["native_full_pages", "image_table_band"].includes(value.kind) ||
    !value.regions.length ||
    value.regions.length > 1000 ||
    new Set(value.regions.map((r) => r.id)).size !== value.regions.length ||
    value.evidence.length > 1200 ||
    value.renders.length > 1000
  )
    throw new Error("Invalid staged candidate.");
  const url = new URL(value.officialUrl);
  if (
    url.protocol !== "https:" ||
    ![
      "www.incometaxindia.gov.in",
      "incometaxindia.gov.in",
      "www.incometax.gov.in",
      "incometax.gov.in",
    ].includes(url.hostname) ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new Error("Invalid official source.");
  const refs = [
    ...value.evidence,
    value.original,
    ...value.renders.map((r) => r.object),
  ];
  const evidence = new Map(value.evidence.map((r) => [r.object_id, r.sha256]));
  const renders = new Map(value.renders.map((r) => [r.page, r]));
  if (
    refs.some((r) => !identifier.test(r.object_id) || !SHA.test(r.sha256)) ||
    value.original.sha256 !== value.sourceHash ||
    refs.some((r) => evidence.get(r.object_id) !== r.sha256) ||
    renders.size !== value.renders.length ||
    value.renders.some(
      (r) =>
        !Number.isSafeInteger(r.page) ||
        r.page < 1 ||
        !Number.isFinite(r.width) ||
        !Number.isFinite(r.height) ||
        r.width <= 0 ||
        r.height <= 0,
    ) ||
    value.regions.some(
      (r) =>
        !r.id ||
        r.id.length > 100 ||
        !Number.isSafeInteger(r.page) ||
        r.page < 1 ||
        r.note.length > 4000 ||
        Object.values(r.box).some((n) => !Number.isFinite(n) || n < 0) ||
        r.box.x1 < r.box.x0 ||
        r.box.bottom < r.box.top ||
        !renders.has(r.page) ||
        r.box.x1 > (renders.get(r.page)?.width ?? 0) + 1 ||
        r.box.bottom > (renders.get(r.page)?.height ?? 0) + 1,
    )
  )
    throw new Error("Invalid source-bound region.");
  if (
    value.state === "AWAITING_EXTRACTION_REVIEW" &&
    value.blockingHolds.length
  )
    throw new Error("Conflicting review eligibility.");
  if (
    value.repair !== undefined &&
    (!value.repair ||
      Object.keys(value.repair).sort().join(",") !==
        "description,replacesCandidateId,requestRevisionId" ||
      !SHA.test(value.repair.replacesCandidateId) ||
      value.repair.replacesCandidateId === value.id ||
      !SHA.test(value.repair.requestRevisionId) ||
      typeof value.repair.description !== "string" ||
      !value.repair.description.trim() ||
      value.repair.description.length > 1500)
  )
    throw new Error("Invalid repair link.");
  return value;
}
export function validateDecision(candidate: Candidate, command: Command) {
  const ids = new Set(candidate.regions.map((r) => r.id));
  if (command.checks.some((c) => !ids.has(c.regionId)))
    throw new HttpError(
      400,
      "A finding belongs to a different source revision.",
    );
  for (const issue of command.issues ?? []) {
    if (
      issue.regionId !== null
        ? !candidate.regions.some(
            (r) => r.id === issue.regionId && r.page === issue.page,
          )
        : issue.page !== null &&
          !candidate.renders.some((r) => r.page === issue.page)
    )
      throw new HttpError(
        400,
        "An issue location belongs to a different extraction.",
      );
  }
  if (
    command.action !== "SAVE_DRAFT" &&
    !command.note.trim() &&
    !(command.action === "REQUEST_CHANGES" && command.issues?.length)
  )
    throw new HttpError(400, "Explain this review decision.");
  if (
    command.action === "ACCEPT_EXTRACTION" &&
    (candidate.state !== "AWAITING_EXTRACTION_REVIEW" ||
      candidate.kind !== "native_full_pages" ||
      candidate.blockingHolds.length ||
      command.issues?.length ||
      command.checks.length !== ids.size ||
      command.checks.some((c) => c.state !== "checked") ||
      !command.readingOrderChecked ||
      !command.contextChecked ||
      !command.criticalCharactersChecked)
  )
    throw new HttpError(
      409,
      "This extraction still needs source checks or has unresolved holds.",
    );
}

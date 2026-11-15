import type { Candidate, Command, Region } from "./contract";

export type RepairStatus =
  | "QUEUED"
  | "PROCESSING"
  | "READY"
  | "NEEDS_OPERATOR"
  | "FAILED"
  | "SUPERSEDED";
export type RepairTarget = { region: Region; descriptions: string[] };

export const TABLE_OCR_PILOT_HOLD = "TABLE_OCR_PILOT";

function isolatedCell(candidate: Candidate, region: Region) {
  const cell = region.tableCell;
  if (!cell) return false;
  const box = region.box;
  return !candidate.regions.some(
    (other) =>
      other.id !== region.id &&
      other.page === region.page &&
      other.tableCell?.tableId === cell.tableId &&
      Math.min(box.x1, other.box.x1) > Math.max(box.x0, other.box.x0) &&
      Math.min(box.bottom, other.box.bottom) > Math.max(box.top, other.box.top),
  );
}

export function repairTargets(
  candidate: Candidate,
  request: Command,
): RepairTarget[] {
  if (
    request.action !== "REQUEST_CHANGES" ||
    !request.issues?.length ||
    request.issues.length > 4
  )
    return [];

  const tablePilot =
    candidate.kind === "image_table_band" &&
    candidate.state === "BLOCKED" &&
    candidate.blockingHolds.includes(TABLE_OCR_PILOT_HOLD);
  if (!tablePilot && candidate.kind !== "native_full_pages") return [];

  const regions = new Map(
    candidate.regions.map((region) => [region.id, region]),
  );
  const targets = new Map<string, RepairTarget>();
  for (const issue of request.issues) {
    const region = issue.regionId ? regions.get(issue.regionId) : undefined;
    if (
      !region ||
      region.page !== issue.page ||
      (tablePilot ? !isolatedCell(candidate, region) : !!region.tableCell) ||
      region.state === "blank" ||
      region.state === "proposed_blank" ||
      region.box.bottom <= region.box.top ||
      region.box.x1 <= region.box.x0
    )
      return [];
    const target = targets.get(region.id) ?? { region, descriptions: [] };
    target.descriptions.push(issue.description);
    targets.set(region.id, target);
  }
  // Existing negative checks without a report also need attention.
  if (
    request.checks.some(
      (check) => check.state !== "checked" && !targets.has(check.regionId),
    )
  )
    return [];
  return [...targets.values()];
}

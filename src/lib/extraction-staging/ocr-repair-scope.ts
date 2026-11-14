import type { Candidate, Command, Region } from "./contract";

export type RepairStatus =
  | "QUEUED"
  | "PROCESSING"
  | "READY"
  | "NEEDS_OPERATOR"
  | "FAILED"
  | "SUPERSEDED";
export type RepairTarget = { region: Region; descriptions: string[] };

export function repairTargets(
  candidate: Candidate,
  request: Command,
): RepairTarget[] {
  if (
    request.action !== "REQUEST_CHANGES" ||
    candidate.kind !== "native_full_pages" ||
    !request.issues?.length ||
    request.issues.length > 4
  )
    return [];

  const regions = new Map(
    candidate.regions.map((region) => [region.id, region]),
  );
  const targets = new Map<string, RepairTarget>();
  for (const issue of request.issues) {
    const region = issue.regionId ? regions.get(issue.regionId) : undefined;
    if (
      !region ||
      region.page !== issue.page ||
      region.tableCell ||
      region.state === "blank" ||
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

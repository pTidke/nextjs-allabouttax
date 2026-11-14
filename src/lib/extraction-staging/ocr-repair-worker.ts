import sharp from "sharp";
import { HttpError } from "../http";
import {
  digest,
  validateCandidate,
  type Candidate,
  type ObjectRef,
} from "./contract";
import { repairTargets, type RepairTarget } from "./ocr-repair-scope";
import type { ExtractionStore } from "./store";

export type RepairInput = {
  image: Buffer;
  target: { left: number; top: number; width: number; height: number };
  raw: string | null;
  proposed: string | null;
  descriptions: string[];
};
export type RepairProvider = {
  model: string;
  propose(input: RepairInput): Promise<unknown>;
};
class RequiresReview extends Error {}

export async function repairModelInput(
  candidate: Candidate,
  { region, descriptions }: RepairTarget,
  read: (ref: ObjectRef) => Promise<Buffer>,
): Promise<RepairInput> {
  const render = candidate.renders.find((page) => page.page === region.page);
  if (!render) throw new RequiresReview();
  const bytes = await read(render.object);
  if (bytes.length > 24 * 1024 * 1024) throw new RequiresReview();
  const png = sharp(bytes, { limitInputPixels: 24_000_000, failOn: "warning" });
  const { width, height, format } = await png.metadata();
  // The source boxes use PDF page coordinates. The PNG can have a different DPI.
  if (format !== "png" || !width || !height) throw new RequiresReview();
  const scaleX = width / render.width;
  const scaleY = height / render.height;
  if (Math.abs(scaleX / scaleY - 1) > 0.02) throw new RequiresReview();
  const x0 = Math.floor(region.box.x0 * scaleX),
    y0 = Math.floor(region.box.top * scaleY),
    x1 = Math.min(width, Math.ceil(region.box.x1 * scaleX)),
    y1 = Math.min(height, Math.ceil(region.box.bottom * scaleY));
  if (x0 >= x1 || y0 >= y1 || x1 - x0 > 2000 || y1 - y0 > 360)
    throw new RequiresReview();
  const left = Math.max(0, x0 - 60),
    top = Math.max(0, y0 - 45),
    right = Math.min(width, x1 + 60),
    bottom = Math.min(height, y1 + 45);
  const image = await png
    .extract({ left, top, width: right - left, height: bottom - top })
    .png()
    .toBuffer();
  if (image.length > 2 * 1024 * 1024) throw new RequiresReview();
  return {
    image,
    target: { left: x0 - left, top: y0 - top, width: x1 - x0, height: y1 - y0 },
    raw: region.raw?.slice(0, 2000) ?? null,
    proposed: region.proposed?.slice(0, 2000) ?? null,
    descriptions,
  };
}

function correctedLine(value: unknown, before: string | null) {
  if (
    !value ||
    typeof value !== "object" ||
    !("decision" in value) ||
    value.decision !== "replace" ||
    !("text" in value) ||
    typeof value.text !== "string"
  )
    throw new RequiresReview();
  const text = value.text.trim().normalize("NFC");
  if (
    !text.length ||
    text.length > 1200 ||
    /[\x00-\x1f\x7f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(text) ||
    !/[\p{L}\p{N}]/u.test(text) ||
    text === before?.trim().normalize("NFC")
  )
    throw new RequiresReview();
  return text;
}

export async function runRepairJob(
  store: ExtractionStore,
  readEvidence: (ref: ObjectRef) => Promise<Buffer>,
  provider: RepairProvider,
  requestId?: string,
) {
  const job = await store.claimRepair(requestId);
  if (!job) return null;
  try {
    const input = await store.repairInput(job);
    if (!input) {
      await store.endRepair(job, "SUPERSEDED", "STALE_REQUEST");
      return "SUPERSEDED";
    }
    const { candidate, request } = input;
    const targets = repairTargets(candidate, request);
    if (!targets.length) throw new RequiresReview();
    const corrected = new Map<string, string>();
    for (const target of targets) {
      const evidence = await repairModelInput(candidate, target, readEvidence);
      const result = await provider.propose(evidence);
      corrected.set(
        target.region.id,
        correctedLine(result, target.region.proposed),
      );
    }
    const regions = candidate.regions.map((region) => {
      const proposed = corrected.get(region.id);
      return proposed === undefined
        ? region
        : {
            ...region,
            proposed,
            state: "transcribed",
            note: "Automated suggestion. Check the exact characters against the original.",
          };
    });
    const revisionHash = digest({
      previous: candidate.revisionHash,
      request: job.requestId,
      regions,
    });
    const repaired = validateCandidate({
      ...candidate,
      id: digest({ parent: candidate.id, revisionHash }),
      revisionHash,
      regions,
      repair: {
        replacesCandidateId: candidate.id,
        requestRevisionId: job.requestId,
        description:
          "Automated OCR proposal for the reported text. Compare the suggested wording with the original.",
      },
    });
    return (await store.completeRepair(job, repaired, provider.model))
      ? "READY"
      : "SUPERSEDED";
  } catch (error) {
    if (error instanceof RequiresReview) {
      await store.endRepair(job, "NEEDS_OPERATOR", "UNCERTAIN_OR_UNSUPPORTED");
      return "NEEDS_OPERATOR";
    }
    if (error instanceof HttpError && error.status === 409) {
      await store.endRepair(job, "SUPERSEDED", "STALE_REQUEST");
      return "SUPERSEDED";
    }
    const code =
      typeof error === "object" && error && "status" in error
        ? error.status
        : null;
    const permanent =
      typeof code === "number" &&
      code >= 400 &&
      code < 500 &&
      code !== 408 &&
      code !== 429;
    const status = permanent || job.attempts >= 3 ? "FAILED" : "QUEUED";
    await store.endRepair(
      job,
      status,
      permanent ? "PROVIDER_REJECTED" : "WORKER_ERROR",
    );
    return status;
  }
}

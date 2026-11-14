// Operator only: preserves validation authority before either a local or cloud import.
import { readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Candidate, ObjectRef } from "./contract";
import { validateCandidate } from "./contract";
import { readObject } from "./evidence";
import { candidateFromBundle } from "./import-bundle";
import { REMOTE_OBJECT_LIMIT } from "./object-stream";
export async function inventory(
  candidates: Candidate[],
  read: (ref: ObjectRef) => Promise<Buffer>,
  maxBytes = 20 * 1024 * 1024,
) {
  if (
    !candidates.length ||
    candidates.length > 20 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 300 * 1024 * 1024
  )
    throw new Error("Invalid staging transfer budget.");
  const refs = new Map<string, ObjectRef>();
  for (const c of candidates) {
    validateCandidate(c);
    for (const ref of c.evidence) refs.set(ref.sha256, ref);
  }
  const objects: { ref: ObjectRef; bytes: number }[] = [];
  let totalBytes = 0;
  for (const ref of [...refs.values()].sort((a, b) =>
    a.sha256.localeCompare(b.sha256),
  )) {
    const bytes = await read(ref);
    if (createHash("sha256").update(bytes).digest("hex") !== ref.sha256)
      throw new Error("Local transfer evidence changed.");
    if (bytes.length > REMOTE_OBJECT_LIMIT)
      throw new Error(
        "An object exceeds the staging web delivery limit. Keep it local until larger-file delivery is prepared.",
      );
    totalBytes += bytes.length;
    if (totalBytes > maxBytes)
      throw new Error("Bundle exceeds the explicit transfer budget.");
    objects.push({ ref, bytes: bytes.length });
  }
  return {
    objects,
    totalBytes,
    maxBytes,
    publicationEligible: false as const,
    taxApproved: false as const,
    retrievalItemsCreated: 0 as const,
  };
}
export async function prepareBundle(
  bundle: string,
  python: string,
  maxBytes?: number,
) {
  const names = (await readdir(bundle))
    .filter((f) => f.endsWith("-envelope.json"))
    .sort();
  if (!names.length || names.length > 20)
    throw new Error("Invalid staging envelope inventory.");
  const candidates: Candidate[] = [];
  for (const name of names)
    candidates.push(await candidateFromBundle(bundle, name, python));
  const root = path.resolve(bundle, "registry", "objects");
  const plan = await inventory(
    candidates,
    (ref) => readObject(root, ref),
    maxBytes,
  );
  return { candidates, root, plan };
}

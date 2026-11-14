import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { SHA, identifier, type Candidate, type ObjectRef } from "./contract";
export async function readObject(root: string, ref: ObjectRef) {
  if (!SHA.test(ref.sha256) || !identifier.test(ref.object_id))
    throw new Error("Invalid object reference.");
  if ((await lstat(root)).isSymbolicLink())
    throw new Error("Object root must not be a symlink.");
  const directory = await realpath(root),
    file = path.join(directory, ref.sha256 + ".blob"),
    handle = await open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  try {
    const stat = await handle.stat(),
      limit = 100 * 1024 * 1024;
    if (!stat.isFile() || stat.size > limit)
      throw new Error("Evidence is unavailable or exceeds budget.");
    const chunks: Buffer[] = [],
      hash = createHash("sha256");
    let total = 0;
    while (true) {
      const buffer = Buffer.alloc(64 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > limit) throw new Error("Evidence exceeds budget.");
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      chunks.push(chunk);
    }
    if (hash.digest("hex") !== ref.sha256)
      throw new Error("Source evidence changed.");
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}
export async function verifyEvidence(root: string, candidate: Candidate) {
  let total = 0;
  for (const ref of candidate.evidence) {
    total += (await readObject(root, ref)).length;
    if (total > 300 * 1024 * 1024) throw new Error("Evidence budget exceeded.");
  }
}

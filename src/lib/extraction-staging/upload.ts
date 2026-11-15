// Operator only. The web runtime must never import this module or receive upload credentials.
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import type { ObjectRef } from "./contract";
import type { NeonConfig } from "./neon-storage";
import { NeonEvidence, neonClient } from "./neon-storage";
import { inventory } from "./bundle-plan";
import type { Candidate } from "./contract";
export async function uploadCandidates(
  config: NeonConfig,
  candidates: Candidate[],
  read: (ref: ObjectRef) => Promise<Buffer>,
  maxBytes = 20 * 1024 * 1024,
  client: Pick<S3Client, "send"> = neonClient(config),
) {
  // Validate and budget the entire local transfer before the first network write.
  const plan = await inventory(candidates, read, maxBytes),
    remote = new NeonEvidence(config, client);
  const overall = AbortSignal.timeout(180000),
    deadline = () => AbortSignal.any([overall, AbortSignal.timeout(15000)]);
  await remote.privateBucket(deadline());
  let uploaded = 0,
    reused = 0;
  for (const { ref } of plan.objects) {
    try {
      await remote.raw(ref, deadline());
      reused++;
      continue;
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "NoSuchKey") throw error;
    }
    const bytes = await read(ref);
    // Recheck after planning: a changed local file is never sent under an old digest.
    if (
      bytes.length > 4 * 1024 * 1024 ||
      createHash("sha256").update(bytes).digest("hex") !== ref.sha256
    )
      throw new Error("Local evidence changed after transfer planning.");
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: remote.key(ref),
          Body: bytes,
          ContentLength: bytes.length,
          ContentType: "application/octet-stream",
          ContentDisposition: "attachment",
          CacheControl: "private, no-store",
          IfNoneMatch: "*",
          Metadata: { sha256: ref.sha256 },
        }),
        { abortSignal: deadline() },
      );
      uploaded++;
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "PreconditionFailed")
        throw error;
      reused++;
    }
    await remote.raw(ref, deadline());
  }
  return { ...plan, uploaded, reused };
}

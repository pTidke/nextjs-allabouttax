// Read-only data-plane adapter. Upload commands live exclusively in the operator module.
import {
  S3Client,
  GetObjectCommand,
  GetBucketAclCommand,
  GetBucketPolicyCommand,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import type { EvidenceConfig } from "./config";
import type { Candidate, ObjectRef } from "./contract";
import { checkedStream, checkReference } from "./object-stream";
export type NeonConfig = Extract<EvidenceConfig, { kind: "neon-s3" }>;
export function neonClient(
  config: NeonConfig,
  requestHandler?: S3ClientConfig["requestHandler"],
) {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    maxAttempts: 2,
    followRegionRedirects: false,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    requestHandler,
  });
}
export class NeonEvidence {
  constructor(
    readonly config: NeonConfig,
    readonly client: Pick<S3Client, "send"> = neonClient(config),
  ) {}
  key(ref: ObjectRef) {
    checkReference(ref);
    return this.config.prefix + ref.sha256 + ".blob";
  }
  async privateBucket(signal: AbortSignal) {
    const acl = await this.client.send(
      new GetBucketAclCommand({ Bucket: this.config.bucket }),
      { abortSignal: signal },
    );
    if (
      !acl.Owner?.ID ||
      !acl.Grants?.length ||
      acl.Grants.some(
        (g) =>
          g.Grantee?.Type !== "CanonicalUser" ||
          g.Grantee?.URI ||
          g.Grantee?.ID !== acl.Owner?.ID,
      )
    )
      throw new Error("Staging evidence bucket is not verified private.");
    try {
      const result = await this.client.send(
        new GetBucketPolicyCommand({ Bucket: this.config.bucket }),
        { abortSignal: signal },
      );
      const policy = JSON.parse(result.Policy || "{}");
      if (
        !Array.isArray(policy.Statement) ||
        policy.Statement.some((s: { Effect?: string }) => s.Effect !== "Deny")
      )
        throw new Error("Staging evidence policy needs operator review.");
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "NoSuchBucketPolicy")
        throw error;
    }
  }
  async raw(ref: ObjectRef, signal: AbortSignal) {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: this.key(ref) }),
      { abortSignal: signal },
    );
    if (
      !result.Body ||
      result.ContentRange ||
      result.$metadata.httpStatusCode !== 200
    )
      throw new Error("Complete source evidence is required.");
    return checkedStream(
      ref,
      result.Body.transformToWebStream(),
      result.ContentLength,
      signal,
    );
  }
  async read(ref: ObjectRef) {
    checkReference(ref);
    const signal = AbortSignal.timeout(15000);
    await this.privateBucket(signal);
    return this.raw(ref, signal);
  }
  async verify(candidate: Candidate) {
    const signal = AbortSignal.timeout(45000);
    await this.privateBucket(signal);
    let total = 0;
    for (const ref of candidate.evidence) {
      const perObject = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
      total += (await this.raw(ref, perObject)).length;
      if (total > 300 * 1024 * 1024)
        throw new Error("Evidence budget exceeded.");
    }
  }
}

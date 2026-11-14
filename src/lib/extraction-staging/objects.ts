import type { EvidenceConfig } from "./config";
import type { Candidate, ObjectRef } from "./contract";
import { readObject, verifyEvidence } from "./evidence";
import { NeonEvidence } from "./neon-storage";
export function evidenceReader(config: EvidenceConfig): {
  read(ref: ObjectRef): Promise<Buffer>;
  verify(candidate: Candidate): Promise<void>;
} {
  if (config.kind === "neon-s3") return new NeonEvidence(config);
  return {
    read: (ref) => readObject(config.root, ref),
    verify: (candidate) => verifyEvidence(config.root, candidate),
  };
}

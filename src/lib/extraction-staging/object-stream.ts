import { createHash } from "node:crypto";
import { SHA, identifier, type ObjectRef } from "./contract";
export const REMOTE_OBJECT_LIMIT = 4 * 1024 * 1024;
export function checkReference(ref: ObjectRef) {
  if (!SHA.test(ref.sha256) || !identifier.test(ref.object_id))
    throw new Error("Invalid object reference.");
}
export async function checkedStream(
  ref: ObjectRef,
  stream: ReadableStream<Uint8Array>,
  size: number | undefined,
  signal: AbortSignal,
  limit = REMOTE_OBJECT_LIMIT,
) {
  checkReference(ref);
  const reader = stream.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    if (
      size !== undefined &&
      (!Number.isSafeInteger(size) || size < 0 || size > limit)
    )
      throw new Error("Remote evidence exceeds the delivery budget.");
    const chunks: Uint8Array[] = [],
      hash = createHash("sha256");
    let total = 0;
    while (true) {
      signal.throwIfAborted();
      const result = await reader.read();
      signal.throwIfAborted();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > limit)
        throw new Error("Remote evidence exceeds the delivery budget.");
      hash.update(result.value);
      chunks.push(result.value);
    }
    if (
      (size !== undefined && total !== size) ||
      hash.digest("hex") !== ref.sha256
    )
      throw new Error("Remote source evidence changed or is incomplete.");
    return Buffer.concat(chunks, total);
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Match the full reviewed name at word boundaries, ignoring case/punctuation.
// Deliberately do not infer identity from partial names, model output or history.
export function normalizeEntity(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

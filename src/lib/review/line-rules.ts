import type { EngineLine } from "./extraction-runs";

// Rules about review lines shared by the server and the review screen. No
// database access here, so the browser can import it.

export function mostlyDevanagari(text: string) {
  const devanagari = (text.match(/[\u0900-\u097F]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return devanagari > latin;
}

const sameText = (a: string, b: string) =>
  a.normalize("NFC").replace(/\s+/g, " ").trim() ===
  b.normalize("NFC").replace(/\s+/g, " ").trim();

// Lines that must be decided one at a time, and why. These are where mistakes
// are; every other line can be confirmed together with the rest of its page.
// - a rule blocked it (a date, an amount, a reference did not check out);
// - another reader read the same place differently;
// - only one OCR reader read it, and it has a number in it (dates, amounts,
//   section and notification numbers, PANs: one misread digit changes the
//   meaning, and with one reader nothing catches it), or the reader was unsure.
export const LOW_OCR_CONFIDENCE = 90;

export function oneByOneReason(
  line: Pick<EngineLine, "status" | "text" | "source"> & {
    readings?: { source: string; text: string; confidence: number | null }[];
    other?: { text: string }[];
    confidence?: number | null;
  },
): string | null {
  if (line.status === "blocked") return "A rule blocked this line";
  const others = (
    line.other ?? (line.readings ?? []).filter((r) => r.source !== line.source)
  ).filter((reading) => reading.text.trim());
  if (others.some((reading) => !sameText(reading.text, line.text)))
    return "The readings disagree";
  if (line.source.startsWith("ocr:") && !others.length) {
    if (/\d/.test(line.text))
      return "Read by OCR only, and it has a number in it";
    const confidence =
      line.confidence ??
      line.readings?.find((r) => r.source === line.source)?.confidence ??
      null;
    if (confidence !== null && confidence < LOW_OCR_CONFIDENCE)
      return "The OCR was unsure of this line";
  }
  return null;
}

export const needsOneByOne = (line: Parameters<typeof oneByOneReason>[0]) =>
  oneByOneReason(line) !== null;

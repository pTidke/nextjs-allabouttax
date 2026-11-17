#!/usr/bin/env node
// Stands in for the pdfanchor command line in tests. FAKE_PDFANCHOR selects the
// behaviour: "ok" (default), "fail" (exit 1) or "mismatch" (wrong source hash).
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("9.9.9-test");
  process.exit(0);
}
const mode = process.env.FAKE_PDFANCHOR || "ok";
if (mode === "fail") {
  console.error("PDF could not be parsed.\nsecond line with details");
  process.exit(1);
}
const [, file, , out] = args;
const bytes = readFileSync(file);
const sha =
  mode === "mismatch"
    ? "0".repeat(64)
    : createHash("sha256").update(bytes).digest("hex");
const line = (id, text, status, flags = [], readings = []) => ({
  id,
  page: 1,
  order: 0,
  box: { x0: 72, top: 100, x1: 400, bottom: 112 },
  raw: text,
  text,
  source: "native",
  readings,
  font_size: 11,
  bold: false,
  scripts: ["Latn"],
  role: "body",
  paragraph: 0,
  table_id: null,
  status,
  flags,
  excluded: null,
});
const document = {
  schema_version: "0.1.0",
  source: {
    sha256: sha,
    bytes: bytes.length,
    filename: "original.pdf",
    pages: 2,
  },
  engine: {
    name: "pdfanchor",
    version: "9.9.9-test",
    policy_version: "0.1",
    config_sha256: "c".repeat(64),
    components: {},
  },
  created_at: "2026-11-15T00:00:00+00:00",
  title: null,
  pages: [
    {
      number: 1,
      width: 595.28,
      height: 841.89,
      rotation: 0,
      kind: "native",
      tables: [],
      flags: [],
      metrics: {},
      lines: [
        line(
          "p1-l1",
          "nnnnMINISTRY OF FINANCE",
          "flagged",
          [
            {
              rule: "crosscheck.disagreement",
              severity: "review",
              message: 'ocr:tesseract reads "MINISTRY OF FINANCE".',
            },
          ],
          [
            {
              source: "ocr:tesseract",
              text: "MINISTRY OF FINANCE",
              confidence: 91,
            },
          ],
        ),
        line(
          "p1-l2",
          "NOTIFICATION",
          "accepted",
          [],
          [{ source: "ocr:tesseract", text: "NOTIFICATION", confidence: 96 }],
        ),
      ],
    },
    {
      number: 2,
      width: 595.28,
      height: 841.89,
      rotation: 0,
      kind: "scanned",
      tables: [],
      flags: [],
      metrics: {},
      lines: [
        {
          ...line("p2-l1", "Annexure A", "flagged", [
            {
              rule: "ocr.single-reading",
              severity: "review",
              message: "Read by one OCR engine only.",
            },
          ]),
          page: 2,
          source: "ocr:tesseract",
        },
      ],
    },
  ],
  flags: [],
  summary: {
    pages: 2,
    pages_failed: 0,
    pages_scanned: 1,
    lines: 3,
    accepted: 1,
    flagged: 2,
    blocked: 0,
    excluded: 0,
    tables: 0,
  },
};
mkdirSync(out, { recursive: true });
// FAKE_PDFANCHOR_INDENT writes the file indented, as the real engine does.
writeFileSync(
  join(out, "document.json"),
  JSON.stringify(
    document,
    null,
    Number(process.env.FAKE_PDFANCHOR_INDENT || 0),
  ),
);
console.log(JSON.stringify({ summary: document.summary }));
process.exit(2);

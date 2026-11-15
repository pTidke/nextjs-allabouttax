import { test } from "node:test";
import assert from "node:assert/strict";
import type { EngineDocument } from "../src/lib/review/extraction-runs";
import {
  compareWithEngine,
  revisionSummary,
  settledText,
  type StagingCandidate,
} from "../src/lib/review/staging-carry-over";

const line = (id: string, text: string, x0: number, top: number) => ({
  id,
  page: 1,
  order: 0,
  box: { x0, top, x1: x0 + 100, bottom: top + 10 },
  text,
  source: "native",
  readings: [],
  status: "accepted",
  flags: [],
  excluded: null,
  role: "body",
  paragraph: 0,
  table_id: null,
});
const document = {
  pages: [
    {
      number: 1,
      width: 500,
      height: 700,
      lines: [
        line("a", "nnnnMINISTRY OF FINANCE", 200, 40),
        line("b", "NOTIFICATION", 220, 60),
        line("c", "Something only the engine read", 50, 90),
        { ...line("d", "भारत का राजपत्र", 10, 10), excluded: "script:Deva" },
      ],
    },
  ],
} as unknown as EngineDocument;
const region = (
  id: string,
  raw: string,
  proposed: string | null,
  x0: number,
  top: number,
) => ({
  id,
  page: 1,
  raw,
  proposed,
  state: "pending",
  // Staging boxes are in render pixels; this render is twice the page size.
  box: { x0: x0 * 2, top: top * 2, x1: 0, bottom: 0 },
});
const candidate = {
  regions: [
    region("r1", "nnnnMINISTRY OF FINANCE", "MINISTRY OF FINANCE", 201, 41),
    region("r2", "NOTIFICATION", null, 220, 60),
    region("r3", "A line the engine did not find", null, 50, 120),
  ],
  renders: [{ page: 1, width: 1000, height: 1400 }],
} as unknown as StagingCandidate;

test("staging regions are matched to the engine's lines by text, with boxes scaled to points", () => {
  assert.equal(settledText(candidate.regions[0]), "MINISTRY OF FINANCE");
  assert.deepEqual(compareWithEngine(candidate, document, new Set(["a"])), {
    engineLines: 3,
    engineRequired: 1,
    regions: 3,
    matchedByText: 2,
    matchedToSettledText: 1,
    requiredMatched: 1,
    regionsUnmatched: 1,
    medianBoxOffsetPoints: { x: 0.5, y: 0.5 },
  });
});

test("a revision is summarised in counts, without its note", () => {
  assert.deepEqual(
    revisionSummary({
      action: "SAVE_DRAFT",
      createdAt: new Date("2026-11-14T10:20:30Z"),
      checks: [
        { regionId: "r1", state: "checked" },
        { regionId: "r2", state: "checked" },
        { regionId: "r3", state: "unreadable" },
      ],
      issues: 1,
      hasNote: true,
    }),
    {
      action: "SAVE_DRAFT",
      at: "2026-11-14 10:20",
      findings: { checked: 2, unreadable: 1 },
      issues: 1,
      note: true,
    },
  );
});

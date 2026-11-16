import { test } from "node:test";
import assert from "node:assert/strict";
import { incomeYears } from "../src/lib/tax/years";
import { documentFacts } from "../src/lib/review/document-facts";
import type { EngineDocument } from "../src/lib/review/extraction-runs";

test("income years are read only where a year word introduces them", () => {
  const cases: [string, string[]][] = [
    [
      "effective for the tax years 2026-2027 to 2030-2031.",
      ["2026-27", "2027-28", "2028-29", "2029-30", "2030-31"],
    ],
    // An assessment year assesses the income of the year before it.
    ["relevant to the assessment year 2027-28", ["2026-27"]],
    ["for A.Y. 2025-26 and 2026-27", ["2024-25", "2025-26"]],
    ["financial year 2025-26, previous year 2024-25", ["2024-25", "2025-26"]],
    [
      "previous years 2026-27, 2027-28 and 2028-29",
      ["2026-27", "2027-28", "2028-29"],
    ],
    ["FY 2024-25 to 2026-27", ["2024-25", "2025-26", "2026-27"]],
    // Bare years, dates and non-consecutive years are not income years.
    ["the period 2026-27", []],
    ["31st March, 2030", []],
    ["tax year 2026-28", []],
  ];
  for (const [text, expected] of cases)
    assert.deepEqual(incomeYears(text), expected, text);
});

const line = (id: string, text: string, page = 1) => ({
  id,
  page,
  order: 0,
  box: { x0: 0, top: 0, x1: 1, bottom: 1 },
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
const notification = {
  pages: [
    {
      number: 1,
      width: 595,
      height: 842,
      lines: [
        { ...line("h", "भारत का राजपत्र"), excluded: "script:Deva" },
        line("l1", "MINISTRY OF FINANCE"),
        line("l2", "(Department of Revenue)"),
        line("l3", "(CENTRAL BOARD OF DIRECT TAXES)"),
        line("l4", "NOTIFICATION"),
        line("l5", "New Delhi, the 5th January, 2026"),
        line("l6", "No. 1/2026"),
        line(
          "l7",
          "S.O. 44(E).- In exercise of the powers conferred by section 10(23FE)...",
        ),
        line("l8", "investment made on or before the 31st day of March, 2030;"),
        line(
          "l9",
          "This notification shall be effective for the tax years 2026-2027 to 2030-2031.",
        ),
      ],
    },
  ],
} as unknown as EngineDocument;

test("document facts are proposed from the heading lines, each with its line", () => {
  const facts = Object.fromEntries(
    documentFacts(notification).map((f) => [
      f.field,
      [f.value, f.source.lineId],
    ]),
  );
  assert.deepEqual(facts, {
    documentType: ["NOTIFICATION", "l4"],
    documentNumber: ["1/2026", "l6"],
    gazetteNumber: ["S.O. 44(E)", "l7"],
    issuingAuthority: [
      "Ministry of Finance, Department of Revenue, Central Board of Direct Taxes",
      "l1",
    ],
    // The deadline on line 8 is not the issue date: only a dated or placed line is.
    issuedOn: ["2026-01-05", "l5"],
    periodMode: ["MULTI_PERIOD", "l9"],
    applicabilityNote: [
      "Names the income years 2026-27, 2027-28, 2028-29, 2029-30, 2030-31 (tax years; an assessment year is the year after).",
      "l9",
    ],
  });
});

test("a single named year is proposed as the period, and 'No. 122 of 2026' as a number", () => {
  const document = {
    pages: [
      {
        number: 1,
        width: 595,
        height: 842,
        lines: [
          line("a", "CIRCULAR"),
          line("b", "No. 122 of 2026-CBDT"),
          line("c", "Dated: 28.09.2026"),
          line("d", "for the assessment year 2027-28"),
        ],
      },
    ],
  } as unknown as EngineDocument;
  const facts = Object.fromEntries(
    documentFacts(document).map((f) => [f.field, f.value]),
  );
  assert.equal(facts.documentType, "CIRCULAR");
  assert.equal(facts.documentNumber, "122/2026");
  assert.equal(facts.issuedOn, "2026-09-28");
  assert.equal(facts.periodMode, "SINGLE_PERIOD");
  assert.equal(facts.period, "TY 2026-27");
});

test("facts are read from the reviewed text, corrections included", () => {
  const garbled = {
    pages: [
      {
        number: 1,
        width: 595,
        height: 842,
        lines: [line("m", "nnnnMINISTRY OF FINANCE"), line("n", "N0. 1/2026")],
      },
    ],
  } as unknown as EngineDocument;
  assert.deepEqual(documentFacts(garbled), []);
  const facts = documentFacts(
    garbled,
    new Map([
      ["m", "MINISTRY OF FINANCE"],
      ["n", "No. 1/2026"],
    ]),
  );
  assert.deepEqual(
    facts.map((f) => [f.field, f.value]),
    [
      ["documentNumber", "1/2026"],
      ["issuingAuthority", "Ministry of Finance"],
    ],
  );
});

test("lines that need a look on their own: blocked, or readings that disagree", async () => {
  const { needsOneByOne, mostlyDevanagari } =
    await import("../src/lib/review/line-rules");
  const base = {
    status: "flagged" as const,
    text: "No. 1/2026",
    source: "native",
  };
  assert.equal(needsOneByOne({ ...base, other: [] }), false, "one reader only");
  assert.equal(
    needsOneByOne({ ...base, other: [{ text: "No.  1/2026" }] }),
    false,
    "same text, different spacing",
  );
  assert.equal(
    needsOneByOne({ ...base, other: [{ text: "No. 7/2026" }] }),
    true,
  );
  assert.equal(needsOneByOne({ ...base, status: "blocked", other: [] }), true);
  // Read by one OCR reader only: numbers and unsure readings go one by one.
  const ocr = {
    status: "flagged" as const,
    source: "ocr:tesseract",
    other: [],
  };
  assert.equal(
    needsOneByOne({ ...ocr, text: "5.0. 5325(E).- In pursuance" }),
    true,
  );
  assert.equal(
    needsOneByOne({
      ...ocr,
      text: "(Department of Revenue)",
      confidence: 96.6,
    }),
    false,
  );
  assert.equal(
    needsOneByOne({ ...ocr, text: "BERBER EERMINISTRY", confidence: 45 }),
    true,
  );
  // Two readers that agree can go together, numbers or not.
  assert.equal(
    needsOneByOne({
      ...base,
      source: "native",
      other: [{ text: "No. 1/2026" }],
    }),
    false,
  );
  assert.equal(mostlyDevanagari("[भाग II—खण्ड 3(ii)] भारत का राजपत्र"), true);
  assert.equal(mostlyDevanagari("MINISTRY OF FINANCE (वित्त मंत्रालय)"), false);
});

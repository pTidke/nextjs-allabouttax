import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CHUNK_CHARS,
  chunksFrom,
  documentText,
  provisionsIn,
  reviewedDocument,
  sentences,
  splitLong,
} from "../src/lib/review/chunks";
import type {
  EngineDocument,
  EngineLine,
} from "../src/lib/review/extraction-runs";

let order = 0;
function line(
  id: string,
  text: string,
  paragraph: number,
  extra: Partial<EngineLine> = {},
): EngineLine {
  return {
    id,
    page: 1,
    order: order++,
    box: { x0: 0, top: 0, x1: 1, bottom: 1 },
    text,
    source: "native",
    readings: [],
    status: "accepted",
    flags: [],
    excluded: null,
    role: "body",
    paragraph,
    table_id: null,
    ...extra,
  };
}
const doc = (...pages: EngineLine[][]) =>
  ({
    source: { sha256: "x", pages: pages.length },
    pages: pages.map((lines, i) => ({
      number: i + 1,
      width: 1,
      height: 1,
      rotation: 0,
      kind: "native",
      flags: [],
      lines: lines.map((l) => ({ ...l, page: i + 1 })),
    })),
  }) as unknown as EngineDocument;

test("a paragraph running onto the next page is one block, across the running header", () => {
  const document = doc(
    [
      line("a1", "MINISTRY OF FINANCE", 0, { role: "heading" }),
      line(
        "a2",
        "2. The foundation shall furnish the statement in Form No. 10-",
        1,
      ),
      line("a3", "IG to the Commissioner of Income-", 1),
    ],
    [
      line(
        "b0",
        "THE GAZETTE OF INDIA : EXTRAORDINARY [PART II—SEC. 3(ii)] 3",
        0,
      ),
      line("b1", "tax (Exemptions) within one month of the end of the tax", 1),
      line("b2", "Act, 2025.", 1),
      line("b3", "3. This notification comes into force on publication.", 2),
    ],
  );
  const blocks = reviewedDocument(document, new Map());
  assert.deepEqual(
    blocks.map((b) => [b.kind, b.text, b.page, b.pageEnd]),
    [
      ["heading", "MINISTRY OF FINANCE", 1, 1],
      [
        "text",
        // Hyphens across a line break close up; a sentence across a page
        // break is joined; the Gazette running header between is gone.
        "2. The foundation shall furnish the statement in Form No. 10-IG to the Commissioner of Income-tax (Exemptions) within one month of the end of the tax Act, 2025.",
        1,
        2,
      ],
      ["text", "3. This notification comes into force on publication.", 2, 2],
    ],
  );
  assert.ok(!documentText(blocks).includes("GAZETTE"));
});

test("a long paragraph is split between sentences, never in a word, and each piece repeats the sentence before it", () => {
  const sentence = (n: number) =>
    `Sentence ${n} of the order says something about section 10(23FE) of the Act and its conditions in detail.`;
  const text = Array.from({ length: 60 }, (_, n) => sentence(n + 1)).join(" ");
  assert.ok(text.length > 2 * MAX_CHUNK_CHARS);
  const pieces = splitLong(text);
  assert.ok(pieces.length >= 3);
  for (const piece of pieces) {
    assert.ok(piece.length <= MAX_CHUNK_CHARS, `${piece.length}`);
    assert.match(piece, /^Sentence \d+ /, "starts at a sentence");
    assert.match(piece, /detail\.$/, "ends at a sentence");
  }
  // The last sentence of a piece opens the next one.
  for (let i = 1; i < pieces.length; i++) {
    const last = sentences(pieces[i - 1]).at(-1)!;
    assert.ok(pieces[i].startsWith(last));
  }
  // Every sentence is somewhere.
  for (let n = 1; n <= 60; n++)
    assert.ok(
      pieces.some((p) => p.includes(sentence(n))),
      `sentence ${n}`,
    );
});

test("abbreviations do not end a sentence", () => {
  assert.deepEqual(
    sentences(
      "S.O. 44(E).- In exercise of the powers, M/s. ABC Ltd. is notified under No. 1/2026. It applies from 1 April 2026.",
    ),
    [
      "S.O. 44(E).- In exercise of the powers, M/s. ABC Ltd. is notified under No. 1/2026.",
      "It applies from 1 April 2026.",
    ],
  );
});

test("a text with no full stop is cut at a comma or a space, never in a word", () => {
  const list = Array.from({ length: 400 }, (_, n) => `item${n}`).join(", ");
  for (const piece of splitLong(list)) {
    assert.ok(piece.length <= MAX_CHUNK_CHARS);
    assert.match(piece, /^item\d+/);
    assert.match(piece, /item\d+,?$/);
  }
});

test("chunks keep a proviso with its paragraph, start a new one at the next numbered paragraph, and carry their metadata", () => {
  const long = "The assessee shall maintain books of account. "
    .repeat(10)
    .trim();
  const document = doc([
    line("h1", "MINISTRY OF FINANCE", 0, { role: "heading" }),
    line("p2", `2. ${long}`, 1),
    line(
      "p3",
      "Provided that this does not apply to a person referred to in section 10(23FE).",
      2,
    ),
    line("p4", "Explanation.—For this purpose, rule 34 applies.", 3),
    line("p5", `3. ${long} It applies for the tax year 2026-27.`, 4),
    line("t1", "Form | Due date", 5, { table_id: "t1", role: "table" }),
    line("t2", "Form 10-IG | 31 May", 5, { table_id: "t1", role: "table" }),
  ]);
  const chunks = chunksFrom(reviewedDocument(document, new Map()));
  assert.deepEqual(
    chunks.map((c) => [c.context, c.kind, c.text.slice(0, 22)]),
    [
      ["MINISTRY OF FINANCE › para 2", "text", "MINISTRY OF FINANCE\n\n2"],
      ["MINISTRY OF FINANCE › para 3", "text", "3. The assessee shall "],
    ],
  );
  // The proviso and the Explanation stay with paragraph 2.
  assert.match(chunks[0].text, /Provided that/);
  assert.match(chunks[0].text, /Explanation/);
  assert.deepEqual(chunks[0].provisions, ["section 10(23FE)", "rule 34"]);
  // The table goes with paragraph 3, rows kept as rows.
  assert.match(chunks[1].text, /Form \| Due date\nForm 10-IG \| 31 May$/);
  assert.deepEqual(chunks[1].provisions, ["Form 10-IG"]);
  assert.deepEqual(chunks[1].incomeYears, ["2026-27"]);
});

test("provisions are read in their usual forms", () => {
  assert.deepEqual(
    provisionsIn(
      "under sub-section (2) of section 80C, clause (a) of rule 2BB and Form No. 10A, Schedule II",
    ),
    ["section 80C", "rule 2BB", "Form 10A"],
  );
});

test("a short title repeated at the top of every page is left out; repeated sentences are kept", () => {
  const page = (n: number) => [
    line(`t${n}`, "CBDT Circular 9/2026", 0),
    line(`a${n}`, `${n}. The assessee shall file the return in time.`, 1),
    line(`b${n}`, "This applies to every assessee.", 2),
  ];
  const document = doc(page(1), page(2), page(3));
  const text = documentText(reviewedDocument(document, new Map()));
  assert.ok(!text.includes("CBDT Circular 9/2026"), "running title out");
  assert.equal(text.match(/This applies to every assessee\./g)?.length, 3);
});

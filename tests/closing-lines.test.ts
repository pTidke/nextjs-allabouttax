import { test } from "node:test";
import assert from "node:assert/strict";
import { closingLines } from "../src/lib/review/closing-lines";
import { passagesFrom } from "../src/lib/review/line-reviews";
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
const page = (number: number, lines: EngineLine[]) => ({
  number,
  width: 1,
  height: 1,
  rotation: 0,
  kind: "native" as const,
  flags: [],
  lines: lines.map((l) => ({ ...l, page: number })),
});
const BODY =
  "S.O. 44(E).- In exercise of the powers conferred by section 295 of the Income-tax Act, 2025, the Central Board of Direct Taxes hereby makes the following rules.";

test("the signature and the Copy to list are left out; the heading block, body, document number and an annexure stay", () => {
  const document = {
    source: { sha256: "x", pages: 2 },
    pages: [
      page(1, [
        line("h1", "MINISTRY OF FINANCE", 0, { role: "heading" }),
        // Before the body: never a signature, though it names an office.
        line("h2", "Directorate of Income Tax (Systems)", 1, {
          role: "heading",
        }),
        line("b1", BODY, 2),
        // Short, but in the body: kept.
        line("b2", "2. This notification comes into force on 1 April 2026.", 3),
        line("n1", "[Notification No. 1/2026/F. No. 370142/1/2026-TPL]", 4),
        line("s1", "(Rajarshi Singh)", 5),
        line("s2", "Under Secretary to the Government of India", 6),
        line("s3", "Tel: 011-23092651", 7),
      ]),
      page(2, [
        line("c1", "Copy to:", 0),
        line("c2", "1. The PS to the Finance Minister.", 1),
        line("c3", "2. All Principal Chief Commissioners of Income-tax.", 2),
        line("c4", "(Rajarshi Singh)", 3),
        line("c5", "Director (ITA-II)", 4),
        line("a1", "ANNEXURE", 5, { role: "heading" }),
        line("a2", "Form of the statement to be furnished.", 6),
      ]),
    ],
  } as unknown as EngineDocument;
  assert.deepEqual(Object.fromEntries(closingLines(document)), {
    s1: "signature",
    s2: "signature",
    s3: "signature",
    c1: "copy list",
    c2: "copy list",
    c3: "copy list",
    c4: "copy list",
    c5: "copy list",
  });
  const text = passagesFrom(document, new Map())
    .map((p) => p.text)
    .join("\n\n");
  for (const kept of [
    "MINISTRY OF FINANCE",
    "2. This notification",
    "[Notification No. 1/2026",
    "ANNEXURE",
    "Form of the statement",
  ])
    assert.ok(text.includes(kept), kept);
  for (const dropped of [
    "Rajarshi",
    "Under Secretary",
    "Tel:",
    "Copy to",
    "Finance Minister",
  ])
    assert.ok(!text.includes(dropped), dropped);
  // A line a reviewer leaves out (a garbled header) goes too.
  const leftOut = passagesFrom(
    document,
    new Map([
      [
        "h2",
        {
          decision: "LEFT_OUT" as const,
          text: null,
          reviewer: "r",
          at: new Date(),
        },
      ],
    ]),
  )
    .map((p) => p.text)
    .join("\n\n");
  assert.ok(!leftOut.includes("Directorate"));
  assert.ok(leftOut.includes("MINISTRY OF FINANCE"));
});

test("an ordinary sentence about a Commissioner or a copy is not a signature", () => {
  const document = {
    source: { sha256: "x", pages: 1 },
    pages: [
      page(1, [
        line("b1", BODY, 0),
        line(
          "b2",
          "The Commissioner may, for reasons to be recorded in writing, extend the time.",
          1,
        ),
        line("b3", "A copy of the order shall be sent to the assessee.", 2),
        line("b4", "Commissioner of Income-tax (Appeals) | Delhi", 3, {
          table_id: "t1",
        }),
      ]),
    ],
  } as unknown as EngineDocument;
  assert.deepEqual([...closingLines(document).keys()], []);
});

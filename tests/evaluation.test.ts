import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  rankOf,
  scoreAnswer,
  scoreSearch,
  summary,
  type EvaluationCase,
} from "../src/lib/tax/evaluation";

const faq =
  "https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/objective-and-scope-new-act";
const n1 =
  "https://www.incometaxindia.gov.in/documents/d/guest/notification-1-2026-pdf";
const published = (source: string) => faq.includes(source);
const passage = (url: string, text: string) => ({ url, text, context: null });

test("search passes when the answer's passage is found, and records its rank", () => {
  const item: EvaluationCase = {
    id: "x",
    question: "q",
    supported: true,
    expect: { source: "objective-and-scope-new-act", passage: "Tax  Year is" },
  };
  const found = [
    passage(faq, "Something else."),
    passage(faq, "A tax year is the twelve months..."),
  ];
  assert.equal(rankOf(item, found), 2, "case and spacing do not matter");
  assert.deepEqual(scoreSearch(item, found, published), {
    id: "x",
    found: 2,
    status: "pass",
    rank: 2,
  });
  assert.equal(
    scoreSearch(item, [passage(faq, "Something else.")], published).status,
    "fail",
  );
});

test("a case for an unpublished document waits; a year outside every document must find nothing", () => {
  const waiting = scoreSearch(
    {
      id: "w",
      question: "q",
      supported: true,
      expect: { source: "notification-1-2026" },
    },
    [],
    published,
  );
  assert.equal(waiting.status, "waiting");
  const none: EvaluationCase = {
    id: "n",
    question: "q",
    supported: false,
    noEvidence: true,
  };
  assert.equal(scoreSearch(none, [], published).status, "pass");
  assert.equal(
    scoreSearch(none, [passage(faq, "x")], published).status,
    "fail",
  );
});

test("an order about one taxpayer must not be reached without naming them", () => {
  const item: EvaluationCase = {
    id: "e",
    question: "q",
    supported: false,
    notFrom: "notification-1-2026",
  };
  const all = () => true;
  assert.equal(scoreSearch(item, [passage(n1, "Inbar")], all).status, "fail");
  assert.equal(scoreSearch(item, [passage(faq, "x")], all).status, "pass");
  assert.equal(
    scoreAnswer(item, { supported: false, text: "", citedUrls: [] }, all)
      .status,
    "pass",
  );
  assert.equal(
    scoreAnswer(item, { supported: false, text: "", citedUrls: [] }, published)
      .status,
    "waiting",
    "waits while that document is unpublished",
  );
});

test("answers are scored on answering or refusing, citing and wording, with reasons", () => {
  const item: EvaluationCase = {
    id: "a",
    question: "q",
    supported: true,
    expect: { source: "objective-and-scope-new-act" },
    mustMatch: "12|twelve",
  };
  assert.equal(
    scoreAnswer(
      item,
      { supported: true, text: "Twelve months [S1].", citedUrls: [faq] },
      published,
    ).status,
    "pass",
  );
  const wrong = scoreAnswer(
    item,
    { supported: true, text: "A year.", citedUrls: [n1] },
    published,
  );
  assert.equal(wrong.status, "fail");
  assert.equal(
    wrong.reason,
    "did not cite the expected document; the answer lacks the expected words",
  );
  assert.equal(
    scoreAnswer(
      { id: "r", question: "q", supported: false },
      { supported: true, text: "x", citedUrls: [] },
      published,
    ).reason,
    "answered a question it should refuse",
  );
});

test("the summary counts passes, the passage found, its mean reciprocal rank and waiting cases", () => {
  assert.deepEqual(
    summary([
      { id: "a", status: "pass", rank: 1, found: 3 },
      { id: "b", status: "pass", rank: 2, found: 3 },
      { id: "c", status: "fail", rank: 0, found: 0 },
      { id: "d", status: "waiting", found: 0 },
    ]),
    [
      "Search: 2 of 3 cases pass; the answer's passage was found for 2 of 3 (mean reciprocal rank 0.50); 1 waiting for their document.",
    ],
  );
});

test("every case in the set is well formed", () => {
  const cases = JSON.parse(
    readFileSync(
      new URL("../evaluations/income-tax.json", import.meta.url),
      "utf8",
    ),
  ) as EvaluationCase[];
  assert.equal(
    new Set(cases.map((c) => c.id)).size,
    cases.length,
    "unique ids",
  );
  for (const c of cases) {
    assert.ok(c.id && c.question && typeof c.supported === "boolean", c.id);
    if (c.supported)
      assert.ok(c.expect?.source, `${c.id}: an answered case names its source`);
    if (c.mustMatch) new RegExp(c.mustMatch, "i");
  }
});

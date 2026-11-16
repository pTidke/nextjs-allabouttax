// The answer yardstick (roadmap M1, G1): a fixed set of questions, each with
// what a right answer looks like, scored the same way after every change to
// chunking, search, prompt or model. Database-free; scripts/tax-evaluate.ts
// runs it against the live library.
//
// Three things are scored separately, because they fail for different reasons:
//   - search: is the passage that answers the question among the six the
//     chatbot is given, and at what rank;
//   - answering: does the chatbot answer when it should, and refuse when it
//     should (outside the library, the wrong year, a calculation, another
//     taxpayer's order);
//   - citing: does the answer cite the document that holds the answer.
// A case whose document is not yet published is "waiting", not a failure.

export type EvaluationCase = {
  id: string;
  question: string;
  // Omit to ask without naming a year, as the chat does.
  period?: string;
  // Earlier questions of the same chat, oldest first, for follow-ups.
  context?: string[];
  // Should the chatbot answer it from the library?
  supported: boolean;
  // Where the answer is: part of the document's address, and a few words of
  // the passage that holds it (compared ignoring case and spacing).
  expect?: { source: string; passage?: string };
  // Search must find nothing at all (a year outside every document).
  noEvidence?: boolean;
  // A document search must not return: an order about one taxpayer, asked
  // about without naming them (AD-10).
  notFrom?: string;
  // Live runs: words the answer must contain (a regular expression).
  mustMatch?: string;
  // Who wrote or checked the case, for the record.
  note?: string;
};

export type Retrieved = { url: string; text: string; context: string | null };

const plain = (text: string) =>
  text.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

// 1-based rank of the first retrieved passage that holds the expected answer,
// or 0 when none does.
export function rankOf(item: EvaluationCase, evidence: Retrieved[]) {
  if (!item.expect) return 0;
  const passage = item.expect.passage ? plain(item.expect.passage) : null;
  const index = evidence.findIndex(
    (e) =>
      e.url.includes(item.expect!.source) &&
      (!passage || plain(`${e.context ?? ""} ${e.text}`).includes(passage)),
  );
  return index + 1;
}

export type SearchResult = {
  id: string;
  status: "pass" | "fail" | "waiting";
  // For cases with an expected passage.
  rank?: number;
  found: number;
  reason?: string;
};

// Search alone: the expected passage is among those found, or nothing is
// found where nothing should be.
export function scoreSearch(
  item: EvaluationCase,
  evidence: Retrieved[],
  published: (source: string) => boolean,
): SearchResult {
  const base = { id: item.id, found: evidence.length };
  if (item.expect && !published(item.expect.source))
    return {
      ...base,
      status: "waiting",
      reason: "its document is not published yet",
    };
  if (item.notFrom) {
    if (!published(item.notFrom))
      return {
        ...base,
        status: "waiting",
        reason: "its document is not published yet",
      };
    if (evidence.some((e) => e.url.includes(item.notFrom!)))
      return {
        ...base,
        status: "fail",
        reason: "found a document it should not reach",
      };
  }
  if (item.noEvidence)
    return evidence.length
      ? {
          ...base,
          status: "fail",
          reason: "found passages where none should be",
        }
      : { ...base, status: "pass" };
  if (item.expect) {
    const rank = rankOf(item, evidence);
    return rank
      ? { ...base, status: "pass", rank }
      : {
          ...base,
          status: "fail",
          rank: 0,
          reason: evidence.length
            ? "the passage with the answer was not among those found"
            : "nothing was found",
        };
  }
  // No expectation about search (a refusal the model must make itself).
  return { ...base, status: "pass" };
}

export type AnswerResult = {
  id: string;
  status: "pass" | "fail" | "waiting";
  answered: boolean;
  citedExpected: boolean | null;
  matched: boolean | null;
  reason?: string;
};

export function scoreAnswer(
  item: EvaluationCase,
  answer: { supported: boolean; text: string; citedUrls: string[] },
  published: (source: string) => boolean,
): AnswerResult {
  const base = { id: item.id, answered: answer.supported };
  if (
    (item.expect && !published(item.expect.source)) ||
    (item.notFrom && !published(item.notFrom))
  )
    return {
      ...base,
      status: "waiting",
      citedExpected: null,
      matched: null,
      reason: "its document is not published yet",
    };
  const citedExpected = item.expect
    ? answer.citedUrls.some((url) => url.includes(item.expect!.source))
    : null;
  const matched = item.mustMatch
    ? new RegExp(item.mustMatch, "i").test(answer.text)
    : null;
  const reasons = [
    answer.supported !== item.supported &&
      (item.supported
        ? "refused a question it should answer"
        : "answered a question it should refuse"),
    item.supported &&
      citedExpected === false &&
      "did not cite the expected document",
    !!item.notFrom &&
      answer.citedUrls.some((url) => url.includes(item.notFrom!)) &&
      "cited a document it should not reach",
    item.supported &&
      matched === false &&
      "the answer lacks the expected words",
  ].filter(Boolean) as string[];
  return {
    ...base,
    status: reasons.length ? "fail" : "pass",
    citedExpected,
    matched,
    ...(reasons.length ? { reason: reasons.join("; ") } : {}),
  };
}

// One line per measure, for the end of a run.
export function summary(search: SearchResult[], answers: AnswerResult[] = []) {
  const scored = search.filter((r) => r.status !== "waiting");
  const withPassage = scored.filter((r) => r.rank !== undefined);
  const hits = withPassage.filter((r) => r.rank! > 0);
  const lines = [
    `Search: ${scored.filter((r) => r.status === "pass").length} of ${scored.length} cases pass` +
      (withPassage.length
        ? `; the answer's passage was found for ${hits.length} of ${withPassage.length}` +
          ` (mean reciprocal rank ${(withPassage.reduce((n, r) => n + (r.rank ? 1 / r.rank : 0), 0) / withPassage.length).toFixed(2)})`
        : "") +
      `; ${search.length - scored.length} waiting for their document.`,
  ];
  const answered = answers.filter((r) => r.status !== "waiting");
  if (answered.length) {
    const cited = answered.filter((r) => r.citedExpected !== null);
    lines.push(
      `Answers: ${answered.filter((r) => r.status === "pass").length} of ${answered.length} pass` +
        (cited.length
          ? `; the expected document was cited in ${cited.filter((r) => r.citedExpected).length} of ${cited.length}`
          : "") +
        ".",
    );
  }
  return lines;
}

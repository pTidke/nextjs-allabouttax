import test from "node:test";
import assert from "node:assert/strict";
import {
  reviewSections,
  selectedSections,
} from "../src/lib/tax/review-sections";
import { suggestedReview } from "../src/lib/tax/review-suggestions";

test("numbered FAQ boundaries keep each complete answer without adjacent questions", () => {
  const text =
    "Title\n1. First question?\nFirst answer.\n\n2.Second question?\nSecond answer.\nMore explanation.";
  const sections = reviewSections(text);
  assert.equal(sections.length, 2);
  assert.equal(
    sections[1].text,
    "2.Second question?\nSecond answer.\nMore explanation.",
  );
  assert.doesNotMatch(selectedSections(text, ["faq-1"])[0].text, /Second/);
  assert.throws(() => selectedSections(text, ["full-document"]), /unavailable/);
  assert.equal(
    reviewSections(
      "1. Question?\nAnswer\n3. Nonconsecutive question?\nAnswer",
    )[0].id,
    "full-document",
  );
});

test("review preset is not offered for unverified or changed source text", () => {
  assert.equal(
    suggestedReview("https://example.test", "1. A?\nAnswer\n2. B?\nAnswer"),
    null,
  );
  assert.equal(
    suggestedReview(
      "https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/objective-and-scope-new-act",
      "Changed FAQ text",
    ),
    null,
  );
});

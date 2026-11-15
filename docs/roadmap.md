# Roadmap

Near-term work, in order, as checklists. The reasoning is in [`improvement-areas.md`](improvement-areas.md); the item codes (A1, L3, …) point there. What exists today is in [`../brain.md`](../brain.md).

Decisions this plan rests on (owner, 15 November 2026): rules only in ingestion, with rules allowed to accept easy pages and a person auditing; the Azure repair worker retired but kept as a switched-off backup; English text indexed, Hindi kept as evidence; Hindi and Hinglish questions deferred; free-tier hosting; forms product parked; the extraction engine to become a separate open-source library.

People: the owner reviews extraction; a chartered accountant reviews tax applicability, one to two hours a day. Every step below should be judged by how much of those hours it saves.

## M0. One codebase

- [x] Merge `codex/pdf-processing-lab` into the working branch (staging stays off by default)
- [x] Merge into `main` (pull request 6) and confirm the chatbot still works in production
- [ ] Find out why three tests in `tests/extraction-storage.test.ts` are cancelled on Node 22.23 (`engines` allows Node 22; CI uses 24)
- [ ] Remove leftovers (H1)

## M1. Chatbot fixes and an answer yardstick

- [x] Treat labels for the same income year as equal (A1)
- [x] Search follow-up questions together with the earlier questions of the chat (A2). A keyword-level fix; a real rewrite comes with M8
- [ ] Let clarifying questions through as a third outcome (A3)
- [ ] Save unanswered questions and log them as content gaps (B2)
- [ ] Refund the quota on refusals; show what remains (B3, B4)
- [ ] Evaluation set with expected source passages and expected refusals; store a trace per answer (G1, G2)
- [ ] Fix the contact form and the consent links (B11, B12)

Done when: the two verified failures have regression tests, and a change to retrieval or prompt can be scored in one command.

## M2. An extraction yardstick

- [ ] Choose about 100 pages across five classes: clean native, native with broken encoding, scanned, bilingual, tables (L3)
- [ ] Verify their transcripts in the staging inbox; this is the first use of reviewer time
- [ ] Port the lab's scorer into `pdfanchor.evaluate`; report false accepts, overall and on critical tokens
- [ ] Set `Policy.min_similarity` from the measurements and record the numbers in the package README

Done when: "accepted" has a measured error rate per class.

## M3. The engine, to parity with the lab

In the engine repository, [`pTidke/benzeneblack`](https://github.com/pTidke/benzeneblack). Work through its `docs/porting-from-the-lab.md`:

- [x] Skeleton: contract, text layer, Tesseract, cross-check, validators, policy, Markdown, chunks, CLI, tests
- [ ] Per-page process isolation and budgets
- [ ] EasyOCR as a tested second reader, including Hindi
- [ ] Pinned OCR weights recorded in the output
- [ ] Scan recovery strategies as retries
- [ ] More validators: split dates, amounts, section references
- [ ] Table structure: header paths, merged cells, scanned tables
- [ ] Page-group processing for large documents (L8)
- [x] Name (`pdfanchor`) and its own repository
- [x] Licence: Apache 2.0
- [ ] First release to PyPI

## M4. Unattended extraction on the free tier

- [ ] `extract` workflow in GitHub Actions: for each new or changed document, run `pdfanchor convert`, upload the evidence, import to staging (L1)
- [ ] Staging importer accepts `document.json`, including scanned full pages (L4)
- [ ] Inbox asks only about flagged lines, with an audit sample of accepted ones (L11)
- [ ] Reviewer can type a correction directly (L5)
- [ ] Local repair provider behind `RepairProvider`; Azure provider off by default (L5)

Done when: a new CBDT document reaches the review inbox with no command typed by anyone.

## M5. From staging to the live library

- [ ] Extraction revisions in the live schema; review decisions bound to them, not to chunk rows (C1)
- [ ] One structured tax-review model, replacing both current forms (L10)
- [ ] Rule-extracted metadata proposals with their source lines (D2)
- [ ] Release step with a dry-run manifest; withdraw and rollback (L9, D3)
- [ ] Originals in object storage (C7)

Done when: a document accepted in staging can be cited by the chatbot, and withdrawn again.

## M6. The corpus, in order of value

- [ ] E-filing help and FAQ pages
- [ ] Income-tax Act, 2025 and the Rules
- [ ] Return-form instructions
- [ ] Circulars and notifications of general application
- [ ] Fix the January discovery cliff and add conditional fetching (C6, C5)
- [ ] Soften the 48-hour gate; add a missed-run alert (A9, E1)

## M7. Knowledge store

- [ ] Nodes and structure-aware chunks from `chunks.jsonl` (C3, A11)
- [ ] Hybrid retrieval with a relevance floor (A4)
- [ ] Relationships between documents; the 1961-to-2025 section mapping (C10)
- [ ] Facts tables for slabs, limits and due dates (A12)

## M8. Answer flow

- [ ] LangGraph.js graph that keeps the evidence-only, validate-before-display and citation rules as nodes
- [ ] Quote-level citations checked on the server and shown on the page image (A8, B6)
- [ ] Stage events while the user waits (B5)
- [ ] Bounded repair on a validation failure (A7)

## Later

Hindi and Hinglish questions (A5). Optional model-proposed metadata as an assist, if rule proposals leave the reviewer too much to type. Other taxes. The forms product.

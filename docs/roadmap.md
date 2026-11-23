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
- [x] Let clarifying questions through as a third outcome (A3)
- [x] Save unanswered questions and log them as content gaps (B2); list them at `/admin/inbox`
- [x] Refund the quota on refusals; show what remains (B3, B4)
- [x] No empty conversations after a failed answer (B8)
- [x] Remove the year picker; take the year from the question, else search all years (B1, AD-05)
- [x] Say on each reply that did not count toward the daily limit
- [x] Evaluation set with expected source passages and expected refusals, scored for search, answering and citing in one command or the `Evaluate answers` workflow (G1). Grow it with reviewed questions as documents are published
- [ ] Store a trace per answer: what was retrieved, scores, latency, tokens (G2)
- [x] Fix the contact form and the consent links (B11, B12)
- [ ] Notify the admin of new contact messages (needs an e-mail service; deferred)

Done when: the two verified failures have regression tests, and a change to retrieval or prompt can be scored in one command.

## M2. An extraction yardstick

- [ ] Choose about 100 pages across five classes: clean native, native with broken encoding, scanned, bilingual, tables (L3)
- [ ] Verify their transcripts in the staging inbox; this is the first use of reviewer time
- [ ] Port the lab's scorer into `pdfanchor.evaluate`; report false accepts, overall and on critical tokens
- [ ] Set `Policy.min_similarity` from the measurements and record the numbers in the package README

Done when: "accepted" has a measured error rate per class.

## M3. The engine, to parity with the lab

In the engine repository, [`pTidke/pdfanchor`](https://github.com/pTidke/pdfanchor). Work through its `docs/porting-from-the-lab.md`:

- [x] Skeleton: contract, text layer, Tesseract, cross-check, validators, policy, Markdown, chunks, CLI, tests
- [ ] Per-page process isolation and budgets
- [x] EasyOCR as a tested second reader on English scanned pages (pdfanchor 0.0.3, 16 November 2026), in the extract workflow
- [ ] EasyOCR's Hindi model, measured
- [ ] Pinned OCR weights recorded in the output
- [ ] Scan recovery strategies as retries
- [ ] More validators: split dates, amounts, section references
- [ ] Table structure: header paths, merged cells, scanned tables
- [ ] Page-group processing for large documents (L8)
- [x] Name (`pdfanchor`) and its own repository
- [x] Licence: Apache 2.0
- [ ] First release to PyPI

## R. The document review workspace

Decided 15 November 2026: the owner and the chartered accountant both check extracted text; only the accountant does tax review; documents come from the CBDT listings and from uploads; staging work is carried over.

- [x] **R1.** `/review`: reviewer roles, one queue, the original beside its passages, text check, tax review gated on it, PDF upload, publish to the live library. Review actions removed from `/admin/knowledge`.
- [x] **R2a.** The engine runs every two hours over pending PDFs and its results are stored per version; a pdf.js page viewer with the engine's line boxes, flagged lines highlighted, and a list of lines that need a look with each reading side by side.
- [x] **R2b.** Line decisions: confirm a flagged line, use the OCR reading, or type its correction; lines accepted by rule count as checked apart from a five-line spot check; accepting the text rebuilds the chatbot's passages from the reviewed lines.
- [x] **R2b, follow-up.** Line boxes measured in the crop box (pdfanchor 0.0.2), so they sit on the text of Gazette PDFs; one line at a time with a close-up and automatic advance; loaders and faster page loads.
- [x] **R2d.** Check every line, not only those the engine asks about; checks made after acceptance require accepting the text again before publishing.
- [x] **R2c.** Scanned PDFs through OCR end to end, and uploads of up to 32 MB in parts. The review screen loads lines page by page, so long scans are no longer cut off at 500 lines.
- [x] **R3.** (Applied 15 November 2026; `/staging` retired 16 November. Left: run `carry-over` `apply` again once the engine has read Circular 3/2026.) Carry over the staging work: Notification 1/2026's accepted extraction and Circular 3/2026's saved review, with their history, from the staging database into the live review records. Needs R2's line-level storage, and an operator run with the staging database credentials. Then retire `/staging`.
- [x] **R5.** (16 November 2026, AD-48) A simpler review: three steps one at a time, every line checked page by page with close-ups only where needed, details filled in from the document and read back as a sentence, autosave, one *Publish*; passages follow late line changes by themselves; signatures and "Copy to" lists left out of the chatbot's text.
- [x] **R6.** (16 November 2026, AD-49) Chunks by rule along the document's own structure, never cutting a sentence or a word, joined across page breaks, with a metadata section per chunk (pages, heading path and paragraph, kind, years, provisions); the whole document and the chunk cards under *Behind the scenes*. No language model.
- [ ] **R4.** Withdraw a published decision and roll back a release (D3); show reviewer history per document.

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
- [x] Rule-extracted metadata proposals with their source lines (D2): document type, number, Gazette number, authority, issue date and years, confirmed in the tax form
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

- [ ] Nodes and structure-aware chunks from `chunks.jsonl` (C3, A11). Started: reviewed passages carry a heading path, page and income years
- [ ] Retrieval filters on passage years (`TaxChunk.incomeYears`, GIN-indexed)
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

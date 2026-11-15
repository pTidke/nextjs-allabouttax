# Improvement areas

Logic and behavioural UX only; visual design is out of scope. Companion to [`brain.md`](../brain.md), which describes what exists today.

- Covers the live product and the extraction lab and staging, which were developed on `codex/pdf-processing-lab` and merged on 15 November 2026. Findings were made against `main` at `d3025cb` and the lab at `868577f`.
- Items marked **verified** were reproduced by running the real code against the embedded test database. The rest come from reading the code and the branch's own records.
- Priority: **P0** fix before investing in anything else, **P1** needed for the stated goals, **P2** worthwhile, not blocking.
- Section 2 records the owner's decisions. Section 12 lists what is still open. The work is laid out as checklists in [`roadmap.md`](roadmap.md).

---

## 1. Where things stand

**Two systems that do not meet.** The live chatbot ingests documents through a text-layer-only path. The OCR work is a Python lab that someone runs by hand, feeding a hosted staging review screen. Nothing accepted in staging reaches the live library, so none of the OCR work affects an answer yet.

**What "depends on a chat LLM" means here.** There are three separate dependencies in the document path, and they need different fixes:

1. **The repair worker.** `src/lib/extraction-staging/azure-ocr-repair.ts` sends a crop of the flagged line or cell, the previous reading and the reviewer's note to the same Azure chat deployment the chatbot uses, and takes its transcription as the proposal.
2. **The operator.** Initial extraction is about thirty `tax-pdf` subcommands run locally, each needing a hand-built manifest and a fresh output directory, followed by `plan`, `upload` and `import`. "Manual repair" in the runbook means the operator prepares a new extraction. In practice that operator is a coding assistant in a chat session.
3. **Judgement calls recorded as "agent observations".** Several benchmark findings (table defects, date comparisons) were made by the assistant reading the page, then bound to the evidence.

The Python lab itself calls no language model. Tesseract, EasyOCR and Docling all run locally with pinned weights.

**The lab is careful and deliberately decides nothing.** Every result is hash-bound to source pixels, every run is immutable, and its policy is that no engine is selected, no confidence clears a hold, and no value is repaired. That is the right posture for a lab. It also means zero autonomy by construction: a person must tick every region of every page. Making it autonomous is mostly a matter of adding a tested decision policy and a driver, not a better OCR engine.

**The corpus still limits answer quality more than orchestration does.** One approved document, about 155 pending, no Act and no Rules. A LangGraph flow over that will still refuse almost everything.

## 2. Owner decisions (15 November 2026) and what they imply

| Decision | Implication |
| --- | --- |
| **Rules only in ingestion. Rules may accept easy pages; a person audits.** | A measured decision policy is the central piece of work (L2, L3). Review shows only what rules flag, plus an audit sample. |
| **Retire the Azure repair worker; keep it as a backup.** | A local provider becomes the default behind the same interface; the Azure provider stays in the code, switched off (L5). |
| **Index English; keep Hindi as evidence.** | Hindi-only lines are kept in the record and left out of review and exports (L6). This is `exclude_scripts` in the engine. |
| **Hindi and Hinglish questions deferred.** | A5 moves to "later". |
| **Free tier; the repository is public.** | Extraction runs in GitHub Actions, where minutes are unmetered for public repositories. No always-on worker, no paid OCR service. |
| **Everyone and everything.** | A destination. Order the corpus by value (C8). |
| **One chartered accountant, one to two hours a day, for tax review.** | Roughly 7 to 14 reviewer hours a week. Every automation choice should be judged by the minutes it saves per document. |
| **The engine becomes an open-source library.** | Scaffolded as `packages/pdfanchor`, generic and standalone; tax-specific rules stay in the application (10.1). |
| **Python for extraction, TypeScript online.** | See 10.4. |
| **Forms product parked.** | Section 10.5 is a short note only. |

**Should a model propose the metadata after all? Cost.** Option (b), a model called through the API that pre-fills the tax-review form for a person to approve, costs about the same per document as one chatbot answer, because it sends about the same amount of text: a typical notification or circular is 2,000 to 5,000 tokens in, and the filled form is a few hundred tokens out.

| Volume | Tokens | At a low-priced model | At a high-priced model |
| --- | --- | --- | --- |
| One document | ~4,000 in, ~600 out | about $0.002 | about $0.02 |
| The ~155 pending documents | ~0.6M in, ~0.1M out | about $0.30 | about $3 |
| A year of new CBDT circulars and notifications (~150) | the same | about $0.30 | about $3 |
| A 5,000-document backfill | ~20M in, ~3M out | about $11 | about $95 |

The price columns assume $0.25 and $2.50 per million input tokens and $2 and $15 per million output tokens, the range third-party trackers show for current Azure OpenAI chat models; Microsoft's own page did not render its figures when checked, so read the real rate for your deployment in the Azure portal and scale. The conclusion does not depend on the exact rate: money is not the reason to avoid (b). The reasons are the ones behind the rules-only decision, a model in the document path whose proposals a tired reviewer may wave through. A sensible middle is to keep rules as the default and add (b) later as an optional assist for the fields rules cannot fill, clearly marked as a model proposal, if the accountant's hours turn out to be the bottleneck.

For comparison, embeddings for retrieval are far cheaper again (about $0.02 per million tokens for the small embedding model, so a few cents for the whole corpus), and translating Hindi questions would cost a small fraction of a normal answer per question.

## 3. The items that matter most

| # | Item | Priority |
| --- | --- | --- |
| 1 | Same income year under a different label returns nothing (A1) | P0, verified |
| 2 | Follow-up questions dead-end without reaching the model (A2) | P0, verified |
| 3 | The model is told to ask clarifying questions, then its question is thrown away (A3) | P0 |
| 4 | Extraction has no driver; it runs by hand on one machine (L1) | P0 |
| 5 | Nothing in extraction ever decides, so a person checks everything (L2) | P0 |
| 6 | No accuracy measurement to base a decision rule on (L3) | P0 |
| 7 | Staging is a dead end; live ingestion cannot take a new extraction without unpublishing things (L9, C1) | P0 |
| 8 | No way to withdraw an approval in the live library (D3) | P0 before any automatic acceptance |
| 9 | The repair path is a chat model (L5) | P1 |
| 10 | The whole chatbot depends on a best-effort cron plus a 48-hour gate (E1, A9) | P1 |
| 11 | Unanswered questions are not saved anywhere (B2) | P1 |
| 12 | Primary law is absent from the corpus (C8) | P1 |

---

## 4. Answer correctness and retrieval (`main`)

**A1. Period labels are compared as strings. P0, verified.**
`retrieval.ts:66` requires `v.period = <selected string>`. A document approved for `TY 2026-27` returned 1 passage for `TY 2026-27` and 0 for `FY 2026-27` and `AY 2027-28`, although all three name April 2026 to March 2027. `periodRange()` in `registry.ts` already computes the canonical range, and `coverage.ts` has the same string comparison.
Fix: store and match on the income-year start date (or the range), and treat the label as display only. The picker in `ChatInterface.tsx` also offers Tax Year for years before the concept exists.

**A2. Retrieval ignores conversation history. P0, verified.**
Only the current message is searched. After "What is a tax year?", the follow-up "and how long is it?" produced the query `long | is | it`, matched nothing, and `route.ts:59` returned the fixed "no approved source" reply without calling the model. History is loaded later, only for generation.
Fix: rewrite the message into a standalone question using recent turns before retrieval, and carry forward named entities and section references.

**A3. Clarifying questions are discarded. P0.**
The prompt says "Ask for missing circumstances rather than guessing". When the model does that it sets `supported: false`, and `answer.ts:59-69` replaces its text with a fixed refusal and empties the suggestions. The user never sees the question.
Fix: add a third outcome, `needs_clarification`, whose text is shown, with a check that it makes no tax claim.

**A4. Matching is OR over loosely filtered words. P1.**
`searchTerms` drops 17 stop words; "is" and "it" pass through. Any chunk sharing one common word matches, the top 6 are taken with no minimum score. Harmless with one document; with a thousand it fills the context with weak passages. Ranking also recomputes `to_tsvector` per matching row.
Fix: hybrid retrieval (10.2), a relevance floor, a stored `tsvector` column.

**A5. Non-English questions cannot match. P1, verified.**
The term pattern is `[a-z0-9]{2,}`. A Hindi question produced an empty query and an immediate refusal. Hinglish matched only through its English words. With "everyone" as the audience this needs handling: translate the question to English for retrieval at query time and answer in the user's language. That is a query-time model call, which the rules-only decision does not exclude.

**A6. Entity-specific evidence needs the full legal name in every message. P1.**
By design (AD-10), but with A2 it means a follow-up about the same entity retrieves nothing. Solve it in query rewriting, not by loosening the filter.

**A7. One formatting slip from the model becomes a 503. P1.**
`validateAnswer` throws if the model writes `[S1, S2]` instead of `[S1][S2]`, lists a source it did not mark, or includes anything matching `www.`. The user sees "This request could not be completed". There is no retry (`maxRetries: 0`) and no repair pass.
Fix: normalise marker formats on the server, then allow one bounded repair call with the validation error.

**A8. Citations prove the id exists, not that the passage supports the sentence. P1.**
It can be tightened without another model: require a verbatim supporting quote per cited claim in the structured output, verify on the server that the quote is a substring of that evidence passage, and show it to the user. The lab's source boxes make it possible to highlight the quote on the page image as well.

**A9. "Could not re-check recently" is treated the same as "changed". P2.**
Evidence disappears 48 hours after its last successful fetch (`retrieval.ts:74`). A circular from 2019 does not become wrong because a cron run was skipped over a weekend.
Fix: keep the hard gate for changed content and document errors; for staleness, show "last verified N days ago" up to a longer limit before hiding.

**A10. A source-level error hides every document under it. P2.**
`retrieval.ts:76` requires `s.lastError IS NULL`. If the CBDT listing page changes its markup, all circulars and notifications leave the chatbot even though each PDF is still individually verifiable.
Fix: listing health should block discovery of new documents, not retrieval of verified ones.

**A11. Passages carry little context. P2.**
A chunk is up to 2,600 characters cut by length, with only the document title attached. The notification number, date, and the heading it sits under are lost unless they happen to be in the text.

**A12. No deterministic facts. P1 for usefulness.**
Slabs, limits, due dates and rates are not stored as data, and the model is forbidden to compute (AD-25). "How much tax on ₹12 lakh" and "what is the last date to file" are refused by design. A reviewed facts table with effective dates, plus deterministic calculator functions the answer flow can call, is the route to these.

## 5. Chat experience (behaviour, `main`)

**B1. Fifteen period options before the first question. P1.**
FY, AY and TY across five years, with no default; changing it wipes the conversation. With A1 fixed, offer one list of income years ("April 2026 – March 2027 · FY 2026-27 · AY 2027-28"), default to the current one, and infer the year from the question when it is stated.

**B2. Unanswered questions vanish. P1.**
When retrieval is empty, neither the question nor the reply is saved (`route.ts:59-70`), and `conversationId` is returned as `null`. They are missing after a reload, from history and from export. There is also no record of what people asked that the library could not answer, which is the best available signal for what to ingest next.
Fix: save both messages, and log the question to a content-gap table.

**B3. A refusal from the model costs one of ten daily questions. P1.**
The quota is refunded on errors but not when `supported` is false.

**B4. The quota is invisible until it is hit. P2.**

**B5. No progress during a wait of up to 40 seconds. P1.**
Validation before display (AD-08) can be kept while still streaming stage events: searching, reading N sources, drafting, checking citations.

**B6. Citations link to the whole document. P1.**
The user gets a URL and "Page 3, passage 2" and must find the passage. Show the passage inline and deep-link PDFs to the page. Snapshot the quoted text into the stored citation so history still makes sense after a document changes.

**B7. Refusals do not say what is covered. P2.**
Offer the nearest covered topics or a link into the library. The library lists titles only, has no search, and takes the period as free text matched against a regex.

**B8. Failed questions leave empty conversations. P2.**
The conversation row is created before the model call (`route.ts:80-84`) and is not removed when generation fails, so `/chats` can show entries with 0 messages.

**B9. Conversations have no title or search. P2.**

**B10. No feedback control. P1.**
No thumbs up or down, no "this is wrong".

**B11. The contact form does not send anything. P1.**
`contact/page.tsx:17-39` opens a Gmail compose window in a new tab and then clears the form. People without Gmail in that browser, or with a pop-up blocker, lose the message and are not told.

**B12. Consent links go nowhere. P1.**
The sign-in dialog says "By continuing, you agree to our Terms of Service and Privacy Policy" with both links set to `#` (`LoginModal.tsx:98-110`), although the documents exist in `LegalModals.tsx`.

**B13. No account-level export or deletion. P1.**

**B14. Sign-in is required before any value is shown. P2.**

## 6. Live ingestion (`main`)

**C1. No extractor versioning and no re-processing path. P0.**
This blocks connecting the lab to the live library:

- For PDFs the version identity is the byte hash (`ingestion.ts:107-110`). An unchanged PDF is matched to its existing version and its chunks are never regenerated, so a better extraction of the same file has nowhere to go.
- For HTML the identity is the hash of the *extracted text*. Any change to the HTML extractor produces a new `PENDING` version, `latestVersionId` moves to it, and the approved version silently drops out of answers. The one approved document today is an HTML page.
- Approval rewrites chunk rows (`review.ts:136-143`), so the review decision and the derived data are entangled.

Fix: three separate layers. Immutable original keyed by byte hash. Extraction revisions keyed to that original (the staging design already has these) that own text, structure and chunks. Review and release decisions that reference an exact extraction revision, never chunk rows. `docs/pdf-staging-handoff.md` on the branch describes the same records; they need to exist in the live schema.

**C2. The live path has no OCR and no quality gate beyond length. P1.**
Scanned PDFs are excluded; a text layer with broken encoding is accepted. Both are solved by replacing this path with the lab's output (L9), not by adding OCR here.

**C3. Chunking is by character count within a page. P1.**
A provision that crosses a page boundary is split, there is no overlap, and structure is ignored. Anchors such as "Page 3, passage 2" are not stable across re-extraction. The lab's line and glyph geometry gives a much better base for structure-aware chunks.

**C4. Size limits exclude the largest documents. P1.**
8 MB per fetch on `main`; the Income-tax Rules, 2026 PDF was rejected. See also L8.

**C5. Freshness by full re-download does not scale. P1.**
Every approved document is downloaded in full every day to stay inside the 48-hour gate, with no conditional requests, in four eight-minute worker windows a day.
Fix: `ETag` / `If-Modified-Since` or `HEAD` where the server supports them, and decouple "unchanged" from "re-downloaded".

**C6. The January discovery cliff. P1.**
The discovery window defaults to the current calendar year (`cbdt.ts:20-29`). On 1 January the adapter asks for a year the CBDT taxonomy may not have yet, throws (`cbdt.ts:152-158`), and marks the source failed, which by A10 hides every document under it. Documents dated late December but listed after 1 January are never discovered.
Fix: window of previous plus current year; a missing current-year term in January is an empty result, not an error.

**C7. Originals in Postgres under a 128 MiB budget. P1.**
Staging already uses object storage for evidence; the live library should use the same store, keyed by SHA-256.

**C8. The corpus is the wrong shape for the audience. P1.**
Three sources: this year's circulars, this year's notifications, one FAQ page. Most notifications are entity-specific. Missing: the Income-tax Act, 2025 and 1961, the Rules, Finance Acts, return forms and their instructions, the e-filing help pages. "Everything" eventually includes GST and other taxes, which need their own adapters, allow-listed hosts and a jurisdiction dimension (AD-24).
Suggested order: e-filing help and FAQ pages (HTML, cheap to review) → the 2025 Act and Rules → return-form instructions → circulars and notifications of general application → historical and entity-specific material → other taxes.

**C9. One scope per whole document. P1.**
A version has one period or date range and one entity (AD-23). Documents whose provisions commence on different dates cannot be represented.

**C10. No relationships between documents. P1.**
No amends, supersedes, clarifies or refers-to links. A superseded circular stays retrievable until someone notices.

## 7. Extraction lab and staging

**L1. The pipeline has no driver. P0.**
About thirty subcommands, each run by hand with a hand-made manifest and a fresh output directory, on a developer machine. Bundles are then planned, uploaded and imported by an operator. Nothing is scheduled and nothing connects a newly discovered document to an extraction run.
Fix: one supported command that runs the whole path, and a scheduled runner. The command now exists in skeleton form as `pdfanchor convert` (`packages/pdfanchor`); it needs the lab's capabilities ported in and a staging importer for its output. The runner calls it for every new or changed document and imports the result. Under the free-tier decision that runner is a GitHub Actions workflow; the existing lab CI job already builds the locked Python environment there.

**L2. Nothing ever decides. P0.**
Reports carry `selected_engine: None`. `assess()` blocks any artifact with a page that is not `native_candidate`. Acceptance needs every region ticked (53 for a one-page notification) plus three attestations. This is why the process needs a person, or an assistant, at every step.
Fix: a deterministic decision policy in one module, with explicit tiers (10.1), every rule recorded with the evidence that fired it. `pdfanchor/policy.py` is the first version, uncalibrated. Rules produce one of three outcomes per region: accepted by rule, flagged for a person, or blocked.

**L3. There is no measurement to base a rule on. P0.**
One of eighteen official reference pages is human-verified, plus three individual fields. The lab's README is explicit that no accuracy claim can be made. A rule that accepts text without a person needs a measured false-accept rate, per document class.
Fix: spend the first reviewer hours on references, not on documents: a verified set stratified by class (clean native, native with broken encoding, scan, bilingual, table), using the scoring the lab already has (`reference-pack`, `score-references`). Report false accepts on critical tokens separately from general character error.

**L4. Scanned full pages cannot enter staging. P1.**
The staging contract has two kinds, `native_full_pages` and `image_table_band`. OCR text of a scanned page has no import path, and the repair worker accepts only native pages or the table pilot. The scan work so far cannot be reviewed in the hosted screen.
Fix: add an OCR full-page kind whose regions carry each engine's reading and the rule outcome.

**L5. The repair path is the chat model. P1.**
See section 1. Under the rules-only decision:

- Keep the `RepairProvider` interface in `ocr-repair-worker.ts`; it is already the right seam. Add a local provider and make it the default; leave the Azure provider in the code, disabled.
- The local provider re-reads the crop with the settings the lab has already tried in `targeted_ocr.py` and `scan_recovery.py`: padding, 2× resize, line mode, the numeric profile, quarter-turns, and a second engine. It proposes a correction only when two independent readings agree with each other and differ from the previous reading. Otherwise it returns "uncertain", as the Azure provider does today.
- **Let the reviewer type the correction.** Today a reviewer describes the problem in free text and waits for a repair. They are already looking at the crop; typing `31st` is faster and more reliable than any round trip. The typed text is validated by the same checks as a proposal, bound to the source box, and recorded as a human correction. This is the main rules-only repair path; machine proposals are an assist.
- Where it runs: Tesseract.js is already the lab's engine and can run inside the existing Vercel queue consumer for single-line crops (to be confirmed against function memory and time limits). EasyOCR cannot run there, so the two-engine proposal comes from the batch runner, minutes later rather than seconds.

**L6. Hindi has a single reader. P1.**
Tesseract `hin` is the only Hindi engine; EasyOCR is configured for English and Docling's OCR backend rejects Hindi. An agreement rule cannot apply to Hindi text.
Options: add a second Hindi reader (EasyOCR ships a Hindi model; to be benchmarked), or treat the English text of bilingual instruments as the indexed text and keep the Hindi as displayed evidence that does not block acceptance. The second halves the review load on bilingual documents and is my recommendation for now (question 3).

**L7. Engine confidence cannot protect critical tokens. P1.**
The lab's own records: `31st` read as `31*` with word confidence 89 and symbol confidence 98; `01st April 2024` read as `015 April 2024` with confidence 92.
Fix: rule validators by token class instead of confidence. Dates, ordinals, section and rule numbers, amounts, percentages, instrument numbers (S.O., G.S.R., F. No.) and negations each get a grammar check and a cross-reading agreement check. A failure is a flag for a person, never a silent repair. A rule may attach a proposal ("day followed by `*`, `"` or `5` before a month name: probably an ordinal suffix") for the reviewer to confirm with one click.

**L8. Budgets fit samples, not the corpus. P1.**
50 pages per run, 10 pages per OCR comparison, 2 pages per EasyOCR refinement, 4 MiB per object in cloud staging. The Act and Rules run to hundreds of pages.
Fix: page-group scheduling with resumable runs, which the lab README already names as the next increment, and a larger-object delivery path.

**L9. Staging is a dead end. P0 with C1.**
An accepted extraction and a tax decision produce nothing in `TaxVersion` or `TaxChunk`. Until a release adapter exists, the live chatbot keeps using the text-layer path and none of this work reaches users.
Fix: after C1, a release step that turns an accepted extraction revision plus an accepted tax decision into retrievable items, with a dry-run manifest first (as `pdf-staging-handoff.md` proposes).

**L10. Two review systems with different fields. P1.**
`/admin/knowledge` on `main` records structured scope (document type, legal status, period mode, effective dates, entity, investment window). `/staging/tax-review` records four free-text fields and supporting line ids. Retrieval needs the structured form.
Fix: one tax-review model, structured, bound to an extraction revision, with supporting lines per field. Retire the other.

**L11. Reviewer attention is spread evenly. P1.**
The inbox already opens on flagged regions, but acceptance still requires every region to be checked. Once L2 and L3 exist, regions accepted by rule should need no tick, with a random audit sample shown to keep the rule honest.

**L12. One path among many experiments. P2.**
The README is a 95 KB chronological narrative and `benchmark/` holds about fifty run records. It is hard to tell which commands are the pipeline and which were trials.
Fix: promote the supported path into its own module and short README; move the experiment history to an archive document.

**L13. Engine settings worth a benchmark row. P2.**
`tessdata_fast` weights rather than `tessdata_best`; 120 DPI native renders against 300 DPI OCR renders. Measure once L3 exists.

**L14. Hosting details to watch. P2.**
The queue trigger is a beta type and the consumer is gated on the branch name. Evidence is re-hashed on every review read, which the docs flag as a latency and egress cost. The lab has no OS-level sandbox; running it in an ephemeral CI runner with only a staging upload credential is an improvement over a developer machine, and it should stay limited to public documents.

## 8. Review workflow (`main`)

**D1. Throughput. P1.**
One approved, about 155 pending, about ten fields per document typed by hand.

**D2. Presets are code. P1.**
`review-suggestions.ts` holds two presets pinned to a URL and a hash. Replace them with rule-extracted proposals stored in the database with their source span and the rule that produced them (10.1).

**D3. Approval is terminal. P0 before any automatic acceptance.**
`reviewVersion` only accepts `PENDING` versions. A wrong approval cannot be withdrawn; it can only be displaced when the source changes. There is no audit log beyond `reviewedBy`, `reviewedAt` and a note. Staging already has immutable revision history; the live library needs withdraw and release rollback.

**D4. No triage. P1.**
The queue is ordered by fetch time, with no filter by type or relevance, no search and no bulk action.

**D5. Releases are not real snapshots. P2.**
`KnowledgeRelease.versionIds` is an ever-growing array used in an `IN (…)` list, and retrieval also checks live flags.

## 9. Reliability, security, measurement, hygiene

**E1. The worker is a single point of failure for answers. P1.**
GitHub Actions schedules are best-effort. Automatic runs are now confirmed (`status.md`), but there is still no missed-run alert, and with A9 two missed days mean the chatbot answers nothing. On a free tier the mitigation is A9 (soften the gate) plus a dead-man check, rather than a paid scheduler.

**E2. No alerting. P1.** `tax:health` can only fail its own workflow run.

**E3. No model resilience. P2.** One deployment, no retries, 40-second timeout, no fallback.

**E4. Public database-backed endpoints with no cache or rate limit. P2.** `/api/knowledge/coverage` and `/library`.

**E5. Job history is never pruned. P2.**

**E6. Docs disagree on worker cadence. P2.** `tax-foundation.md` says every 15 minutes; `deployment.md` and the workflow say six hours.

**E7. Free-tier terms. P1, check.** The deployment docs already note that the hosting plan's terms should be checked for commercial use. Confirm before any public launch that is more than a pilot.

**F1. Personal identifiers are stored and sent as typed. P1.**
The UI asks users not to paste PAN, Aadhaar or bank details; nothing checks. Detect the obvious patterns before storing or sending, and warn.

**F2. Data-protection groundwork. P1.**
Consent and notice, account-level erasure, retention periods, grievance contact, processing region. Take legal advice on current obligations.

**F3. Reviewer and publisher are one role on `main`, changed only in the database. P2.** Staging's capability model is the better pattern.

**F4. Canonical host mismatch. P2, check.**
Production is `www.allabouttax.in`; metadata, sitemap and robots use `allabouttax.in`. `sameOrigin()` compares against `AUTH_URL`, so chat requests from the other host would be rejected unless one redirects to the other.

**G1. Answer evaluation is six cases with regex checks, run by hand. P1.**
Build a labelled set with the expected source passage per question and expected refusals. Measure retrieval recall, citation correctness and refusal correctness separately, on every change to retrieval, prompt or model.

**G2. No trace per answer. P1.**
Not stored: what was retrieved but not cited, scores, latency, token counts, cost, validation failures.

**G3. Errors are logged as a type name only. P2.**
Add request ids and stable error codes that carry no user text.

**H1. Leftovers. P2.**
`src/sanity/client.ts` and `@sanity/client`; `User.questionsToday`, `lastQuestionAt`, `threadId`; `--legacy-peer-deps`; NextAuth on a beta release; a typo in the JSON-LD description in `layout.tsx`.

**H2. The lab branch is merged into the working branch, not yet into `main`. P1.**
Staging is feature-flagged off by default. Merging to `main` triggers a production deployment and adds `vercel.json` function settings, so check the preview deployment first.

**H3. Three storage tests are cancelled on Node 22. P2.**
`tests/extraction-storage.test.ts` reports "Promise resolution is still pending but the event loop has already resolved" on Node 22.23, which `package.json` allows; CI runs Node 24.

---

## 10. Target architecture

### 10.1 Autonomous extraction, rules only

Keep the lab's contract and evidence model. Add a driver, a decision policy and a runner.

```
 knowledge worker finds a new or changed document
        │
        ▼
 GitHub Actions: extract workflow            (free tier, ephemeral runner)
   tax-pdf ingest  ─ preflight ─ native text + geometry ─ render
                   ─ OCR every page (2 engines) as a cross-check or as the reading
                   ─ validators by token class
                   ─ decision policy ─▶ per region: accepted by rule │ flagged │ blocked
                   ─ rule-extracted metadata proposals
        │ bundle (schemas/*.json)
        ▼
 upload + import to staging ─▶ reviewer sees only flagged regions, types corrections
        │ accepted extraction revision
        ▼
 tax review (rule proposals, person decides) ─▶ release adapter ─▶ live library
```

**Decision policy.** Deterministic, versioned, every outcome explained by the rule that fired.

| Class | Rule | Person sees |
| --- | --- | --- |
| Clean native page | Text layer present, no unmapped characters, no large images, no tables; an OCR reading of the rendered page agrees with the text layer above a threshold and on every critical token | Nothing, except an audit sample |
| Native page with flags | As above, but some regions fail a validator or disagree | Only those regions |
| Scanned page | Two independent readings; regions where they agree and validators pass are accepted | Disagreements and all critical tokens |
| Tables, handwriting, show-through, signatures | Never accepted by rule | Everything in the region |

Checking the text layer against an OCR reading of the same rendered page is the key deterministic test: it catches broken font encodings and hidden or stale text layers, which a length check cannot. Thresholds come from L3; until then every tier is "flag".

**Metadata by rule.** Document type from the listing it came from; instrument number and issue date from listing metadata and header patterns; sections cited by pattern; commencement from phrases such as "shall come into force on" and "with effect from"; amendment and supersession from phrases such as "in rule X, for the words … substitute"; named entity from the operative paragraph. Each proposal carries its source span and rule name and appears pre-filled in tax review. Whether an instrument is still in force and how it applies cannot be decided by rule; a person decides, as the owner chose.

**Applicability as facts plus computation.** Store commencement and end dates and relationships; compute "applies to income year Y" at query time by date overlap. That is today's `MULTI_PERIOD` mode made the default, and it removes the field that is hardest to fill by hand.

**What is retired.** The Azure repair provider as default (L5); operator-run commands (L1); agent observations as a source of findings (replaced by rule outcomes and reviewer statements).

### 10.2 Knowledge store

From flat chunks to a structured store, still in Neon Postgres.

- **Nodes.** Document → extraction revision → tree of nodes (chapter, section, sub-section, clause, proviso, explanation; for notifications: preamble, paragraphs, tables, annexures), each with a stable citation path and the source boxes the lab already records.
- **Chunks derived from nodes**, each prefixed with document title, number, date and heading path. Retrieve small, return the parent for context. Table rows carry their title, header path, units and footnotes, as the handoff document requires.
- **Hybrid retrieval.** The existing full-text index plus `pgvector` on the same tables, fused by reciprocal rank, then a relevance floor. Applicability filters run before ranking, as now. On a free tier, size the vectors deliberately: a few hundred dimensions or half-precision storage, so tens of thousands of chunks stay well inside Neon's allowance. A reranker can wait until the evaluation set shows it is needed.
- **Embeddings and the rules-only decision.** An embedding is a search index, not a decision; nothing is accepted or rejected by it. It does add a small per-document model call (question 4).
- **Relationships as tables.** `amends`, `supersedes`, `clarifies`, `refers_to`, and a section table that includes the official 1961-to-2025 section mapping.
- **Facts.** Reviewed tables for slabs, limits, due dates and rates with effective ranges and a source node each (A12).

### 10.3 Answer orchestration with LangGraph

Use LangGraph for control flow; use as little of LangChain as needed for model and retriever interfaces.

```
start ─▶ guard (scope, personal identifiers)
      ─▶ resolve period (stated, inferred, or ask)
      ─▶ analyse query (language, standalone rewrite, entities, sections, sub-questions)
      ─▶ retrieve (hybrid, applicability-filtered) ─▶ grade evidence
            ├─ not enough, but a detail would help ─▶ ask the user (interrupt)
            ├─ not enough                          ─▶ refuse, log the gap
            └─ enough ─▶ generate (structured, with quotes)
                      ─▶ verify (ids, quotes) ─ fail once ─▶ repair ─▶ verify
      ─▶ persist with trace ─▶ end
```

- AD-01, AD-08 and AD-09 become named nodes. `validateAnswer` stays deterministic code; the graph adds the rewrite, the clarification branch and the bounded repair that fix A2, A3 and A7.
- A Postgres checkpointer gives resumable conversations and the interrupt needed to ask the user something mid-flow.
- Facts and calculators are tools the graph calls; the model never does arithmetic.
- Emit stage events for B5.
- The graph does not improve accuracy by itself. Land G1 first, then measure each node's contribution.

Extraction stays a job pipeline, not a graph. Deterministic stages with explicit states are easier to re-run and audit, and the rules-only decision leaves nothing for an agent to do there.

### 10.4 TypeScript or Python

**Both, split by job, with the JSON bundle as the only contract between them.**

| Job | Language | Why |
| --- | --- | --- |
| PDF extraction, OCR, validators, decision policy, rule-based metadata | Python | It is already 11,000 lines with 328 passing tests. The PDF and OCR libraries it depends on have no equal in Node. It runs as a batch job, so it does not need to live in the web app. |
| Web app, staging review, release adapter, retrieval, answer graph | TypeScript | It shares auth, Prisma and deployment with the existing app and runs on Vercel's free tier. LangGraph.js covers what this graph needs: state graphs, interrupts, a Postgres checkpointer, streaming. |

Reasons not to move the answer flow to Python: it would need a separate always-on service, which the free tier does not give you; it would split auth and database access across two runtimes; and under the rules-only decision there is no model work on the Python side to share code with. Reasons not to port extraction to TypeScript: it would discard tested code for weaker libraries.

Keep the contract language-neutral: the schemas in `tools/pdf_pipeline/schemas/` are the source of truth, with generated types on the TypeScript side and one cross-language test per schema.

### 10.5 Forms product (parked)

Not designed further at the owner's request. Two things built now will carry over: the extraction pipeline (for reading a user's own documents) and the facts and rules tables (A12). Reading users' documents changes the privacy position, so the local-engine choice in 10.1 is the right default for that future too.

## 11. Suggested order

Each step is useful by itself and makes the next one measurable.

1. **Chatbot P0 fixes and the answer yardstick.** A1, A2, A3, B2, B3; the answer evaluation set and per-answer trace (G1, G2).
2. **Extraction yardstick.** Verified reference pages by class (L3). Nothing else in extraction can be trusted to run unattended without it.
3. **Driver and runner.** One `ingest` command; the GitHub Actions extract workflow; automatic upload and import (L1). Add the OCR full-page kind (L4).
4. **Decision policy and reviewer correction.** Validators, tiers, flagged-only review, typed corrections, local repair provider; Azure provider off (L2, L5, L7, L11).
5. **Connect staging to the live library.** Extraction revisions in the live schema, release adapter with dry run, withdraw and rollback, one structured tax-review model (C1, L9, L10, D3). Merge the branch (H2).
6. **Corpus in the right order** (C8), with page-group scheduling for the large documents (L8) and rule-extracted metadata proposals (D2).
7. **Knowledge store v2**: nodes, hybrid retrieval, relationships, facts (10.2).
8. **LangGraph answer flow** with streaming stages and quote-level citations (10.3). Hindi and Hinglish questions (A5) are deferred.

Steps 1 and 2 can run in parallel; they need different people. Step 8 can start once step 1's evaluation set exists, but it will only show its value after step 6 gives it something to retrieve.

## 12. Still open

1. **Name and licence for the engine.** `pdfanchor` is a working name, free on PyPI when checked. A licence must be chosen before publishing; the engines it builds on are permissively licensed, so a permissive licence is possible.
2. **A separate repository for the engine.** It lives in `packages/pdfanchor` for now and can be split out with its history once a repository exists.
3. **Redistribution of test documents.** Whether official PDFs may be shipped as a public test set with the library, or whether it should carry synthetic fixtures only.
4. **Merging to `main`.** Approved in principle; it deploys to production, so it should go through a pull request with the preview checked.
5. **Model-proposed metadata.** Parked as a possible later assist (section 2); revisit once the accountant has reviewed a few dozen documents and the time per document is known.

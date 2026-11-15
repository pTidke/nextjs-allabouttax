# Improvement areas

Logic and behavioural UX only; visual design is out of scope. Companion to [`brain.md`](../brain.md), which describes what exists today.

- Based on commit `d3025cb`, 15 November 2026.
- Items marked **verified** were reproduced by running the real code against the embedded test database. The rest come from reading the code.
- Priority: **P0** fix before investing in anything else, **P1** needed for the stated goals, **P2** worthwhile, not blocking.
- Section 10 lists the decisions that are the owner's to make. Several recommendations below depend on them.

---

## 1. Three corrections to the starting assumptions

These change how the next phase should be scoped.

**There is no OCR engine to improve.** `src/lib/tax/documents.ts` reads the text layer that is already embedded in a PDF. If a PDF has fewer than 300 extractable characters it is rejected. Building OCR is new work, and it is the smaller part of the problem: most recent CBDT PDFs already have a text layer.

**No chat LLM is in the document path in code.** Review is a person filling a form at `/admin/knowledge`. The only "automation" is two presets hard-coded in `src/lib/tax/review-suggestions.ts`, each pinned to one URL and one content hash. If a chat assistant is being used today, it is being used by hand, outside the repository, to work out what to type into that form. So the real dependency to remove is **manual review**, and the real question is how much of it may be automated (section 10, question 2).

**The corpus, not the orchestration, is the main limit on answer quality.** The docs record one approved document version and about 155 pending. The library has no Act and no Rules. A LangGraph flow over one approved FAQ will still refuse almost everything. Coverage and retrieval come first; orchestration then makes good use of them.

## 2. The ten that matter most

| # | Item | Priority |
| --- | --- | --- |
| 1 | Same income year under a different label returns nothing (A1) | P0, verified |
| 2 | Follow-up questions dead-end without reaching the model (A2) | P0, verified |
| 3 | The model is told to ask clarifying questions, then its question is thrown away (A3) | P0 |
| 4 | Improving the extractor will silently unpublish approved HTML documents and never touch existing PDFs (C1) | P0 for the pipeline work |
| 5 | No way to withdraw an approval, and no audit trail (D3) | P0 before any automation |
| 6 | Review throughput: every document needs a person to fill about ten fields (D1) | P1 |
| 7 | The whole chatbot depends on a best-effort six-hour cron plus a 48-hour gate (E1, A9) | P1 |
| 8 | Unanswered questions are not saved anywhere (B2) | P1 |
| 9 | Six evaluation cases cannot tell you whether a change helped (G1) | P1 |
| 10 | Primary law is absent from the corpus (C8) | P1 |

---

## 3. Answer correctness and retrieval

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
Fix: hybrid retrieval (section 8.2), a relevance floor, a stored `tsvector` column.

**A5. Non-English questions cannot match. P1, verified.**
The term pattern is `[a-z0-9]{2,}`. A Hindi question produced an empty query and an immediate refusal. Hinglish matched only through its English words.
Fix: decide the language policy. At minimum detect it and say so; better, translate the query to English for retrieval and answer in the user's language.

**A6. Entity-specific evidence needs the full legal name in every message. P1.**
By design (AD-10), but with A2 it means a follow-up about the same entity retrieves nothing. Solve it in query rewriting, not by loosening the filter.

**A7. One formatting slip from the model becomes a 503. P1.**
`validateAnswer` throws if the model writes `[S1, S2]` instead of `[S1][S2]`, lists a source it did not mark, or includes anything matching `www.`. The user sees "This request could not be completed". There is no retry (`maxRetries: 0`) and no repair pass.
Fix: normalise marker formats on the server, then allow one bounded repair call with the validation error.

**A8. Citations prove the id exists, not that the passage supports the sentence. P1.**
Documented in `docs/tax-foundation.md`. It can be tightened without another model: require a verbatim supporting quote per cited claim in the structured output, verify on the server that the quote is a substring of that evidence passage, and show it to the user.

**A9. "Could not re-check recently" is treated the same as "changed". P2.**
Evidence disappears 48 hours after its last successful fetch (`retrieval.ts:74`). A circular from 2019 does not become wrong because a cron run was skipped over a weekend.
Fix: keep the hard gate for changed content and document errors; for staleness, show "last verified N days ago" up to a longer limit before hiding.

**A10. A source-level error hides every document under it. P2.**
`retrieval.ts:76` requires `s.lastError IS NULL`. If the CBDT listing page changes its markup, all circulars and notifications leave the chatbot even though each PDF is still individually verifiable.
Fix: listing health should block discovery of new documents, not retrieval of verified ones.

**A11. Passages carry little context. P2.**
A chunk is up to 2,600 characters cut by length, with only the document title attached. The notification number, date, and the heading it sits under are lost unless they happen to be in the text.

**A12. No deterministic facts. P1 for usefulness.**
Slabs, limits, due dates and rates are not stored as data, and the model is forbidden to compute (AD-25). "How much tax on ₹12 lakh" and "what is the last date to file" are refused by design. A reviewed facts table with effective dates, plus deterministic calculator functions the answer flow can call, is the route to these. The forms product needs the same thing.

## 4. Chat experience (behaviour)

**B1. Fifteen period options before the first question. P1.**
FY, AY and TY across five years, with no default; changing it wipes the conversation. Most people do not know which label applies. With A1 fixed, offer one list of income years ("April 2026 – March 2027 · FY 2026-27 · AY 2027-28"), default to the current one, and let the flow infer the year from the question when it is stated.

**B2. Unanswered questions vanish. P1.**
When retrieval is empty, neither the question nor the reply is saved (`route.ts:59-70`), and `conversationId` is returned as `null`. They are missing after a reload, from history and from export. There is also no record of what people asked that the library could not answer, which is the best available signal for what to ingest next.
Fix: save both messages, and log the question to a content-gap table.

**B3. A refusal from the model costs one of ten daily questions. P1.**
The quota is refunded on errors but not when `supported` is false. With today's corpus most questions end that way.

**B4. The quota is invisible until it is hit. P2.**
No remaining count is returned or shown; the user finds out through an error.

**B5. No progress during a wait of up to 40 seconds. P1.**
The response arrives whole. Validation before display (AD-08) can be kept while still streaming stage events: searching, reading N sources, drafting, checking citations.

**B6. Citations link to the whole document. P1.**
The user gets a URL and "Page 3, passage 2" and must find the passage. The passage text is already in the database; show it inline and deep-link PDFs to the page. Snapshot the quoted text into the stored citation so history still makes sense after a document changes.

**B7. Refusals do not say what is covered. P2.**
The fixed text suggests narrowing the question. Offer the nearest covered topics or a link into the library. The library itself lists titles only, has no search, and takes the period as free text matched against a regex.

**B8. Failed questions leave empty conversations. P2.**
The conversation row is created before the model call (`route.ts:80-84`) and is not removed when generation fails, so `/chats` can show entries with 0 messages. Each retry creates another.

**B9. Conversations have no title or search. P2.**
The list shows period, date and message count.

**B10. No feedback control. P1.**
No thumbs up or down, no "this is wrong". Nothing ties user judgement back to the evaluation set.

**B11. The contact form does not send anything. P1.**
`contact/page.tsx:17-39` opens a Gmail compose window in a new tab and then clears the form. People without Gmail in that browser, or with a pop-up blocker, lose the message and are not told.

**B12. Consent links go nowhere. P1.**
The sign-in dialog says "By continuing, you agree to our Terms of Service and Privacy Policy" with both links set to `#` (`LoginModal.tsx:98-110`), although the documents exist in `LegalModals.tsx`.

**B13. No account-level export or deletion. P1 before the forms product.**
Only single conversations can be exported or deleted.

**B14. Sign-in is required before any value is shown. P2.**
A product choice, but worth testing one anonymous sample question against the coverage notice.

## 5. Document processing

**C1. No extractor versioning and no re-processing path. P0 for this workstream.**
This must be fixed before any extraction improvement ships:

- For PDFs the version identity is the byte hash (`ingestion.ts:107-110`). An unchanged PDF is matched to its existing version and its chunks are never regenerated, so better extraction or OCR would not apply to anything already ingested.
- For HTML the identity is the hash of the *extracted text*. Any change to the HTML extractor produces a new `PENDING` version, `latestVersionId` moves to it, and the approved version silently drops out of answers. The one approved document today is an HTML page.
- Approval rewrites chunk rows (`review.ts:136-143`), so the review decision and the derived data are entangled.

Fix: three separate layers. Immutable original keyed by byte hash. Extraction runs keyed by `(original, extractorVersion)` that own text, structure and chunks and can be regenerated. Review decisions that attach to the original plus a scope, never to chunk rows.

**C2. No OCR. P1.**
Scanned PDFs are excluded. See section 8.1.

**C3. No quality gate beyond length. P1.**
A text layer can exist and still be unusable: non-Unicode Hindi fonts decode to garbage, two-column Gazette pages interleave, headers and footers repeat on every page, tables flatten into word streams. Bilingual notifications (Hindi then English) are indexed as one blob under the `english` text-search configuration.

**C4. Chunking is by character count within a page. P1.**
A provision that crosses a page boundary is split, there is no overlap, and structure (section, sub-section, proviso, explanation, table) is ignored. Anchors such as "Page 3, passage 2" are not stable across re-extraction.

**C5. The 8 MB cap excludes the largest documents. P1.**
The Income-tax Rules, 2026 PDF was rejected for size (per `docs/tax-foundation.md`).

**C6. Freshness by full re-download does not scale. P1.**
Every approved document is downloaded in full every day to stay inside the 48-hour gate. There are no conditional requests. The worker has four eight-minute windows a day. A few thousand approved documents will not fit, and they will start dropping out of answers.
Fix: `ETag` / `If-Modified-Since` or `HEAD` where the server supports them, and decouple "unchanged" from "re-downloaded".

**C7. The January discovery cliff. P1.**
The discovery window defaults to the current calendar year (`cbdt.ts:20-29`). On 1 January the adapter asks for a year the CBDT taxonomy may not have yet, throws (`cbdt.ts:152-158`), and marks the source failed, which by A10 hides every document under it. Separately, documents dated late December but listed after 1 January are never discovered.
Fix: window of previous plus current year; a missing current-year term in January is an empty result, not an error.

**C8. The corpus is the wrong shape for individuals. P1.**
Three sources: this year's circulars, this year's notifications, one FAQ page. Most notifications are entity-specific. Missing: the Income-tax Act, 2025 and 1961, the Rules, Finance Acts, ITR forms and their instructions, the e-filing help pages. Those are what a salaried person's questions are answered from.

**C9. Originals in Postgres under a 128 MiB budget. P1.**
About 55 MiB was used by 132 documents. Move bytes to object storage keyed by SHA-256; keep the hash and metadata in Postgres.

**C10. One scope per whole document. P1.**
A version has one period or date range and one entity (AD-23). Documents whose provisions commence on different dates cannot be represented. Only numbered FAQs can be split.

**C11. No relationships between documents. P1.**
No amends, supersedes, clarifies or refers-to links. A superseded circular stays retrievable until someone notices.

## 6. Review workflow

**D1. Throughput. P1.**
One approved, about 155 pending, one administrator, about ten fields per document typed by hand. This, not OCR, is what currently limits what the chatbot can answer.

**D2. Presets are code. P1.**
`review-suggestions.ts` holds two presets pinned to a URL and a hash. Each new one is a commit and a deploy. Replace them with a metadata-proposal stage that writes proposed values, the text span each came from, the method and a confidence into the database (section 8.1).

**D3. Approval is terminal. P0 before any automation.**
`reviewVersion` only accepts `PENDING` versions. A wrong approval cannot be withdrawn; it can only be displaced when the source changes. There is no audit log beyond `reviewedBy`, `reviewedAt` and a note, and no second reviewer. Add withdraw, a review-event history table, and release rollback before letting anything publish without a person.

**D4. No triage. P1.**
The queue is ordered by fetch time. There is no filter by type or relevance, no search and no bulk action. The admin API also sends the full text of ten documents on every load.

**D5. Releases are not real snapshots. P2.**
`KnowledgeRelease.versionIds` is an ever-growing array used in an `IN (…)` list, and retrieval also checks live flags. Use a join table and decide whether an answer should be reproducible from its `releaseId`.

## 7. Reliability, security, measurement, hygiene

**E1. The worker is a single point of failure for answers. P1.**
GitHub Actions schedules are best-effort and are disabled on repositories with no recent activity. The docs note the first automatic run had not yet been observed. With A9, two missed days mean the chatbot answers nothing. Use a real scheduler and a dead-man alert.

**E2. No alerting. P1.** `tax:health` can only fail its own workflow run.

**E3. No model resilience. P2.** One deployment, no retries, 40-second timeout, no fallback.

**E4. Public database-backed endpoints with no cache or rate limit. P2.** `/api/knowledge/coverage` and `/library` run a join on every request, unauthenticated, `no-store`.

**E5. Job history is never pruned. P2.**

**E6. Docs disagree on worker cadence. P2.** `tax-foundation.md` says every 15 minutes; `deployment.md` and the workflow say six hours.

**F1. Personal identifiers are stored and sent as typed. P1.**
The UI asks users not to paste PAN, Aadhaar or bank details; nothing checks. Detect the obvious patterns before storing or sending, and warn.

**F2. Data-protection groundwork. P1 before the forms product.**
Consent and notice, purpose limitation, account-level erasure, retention periods, grievance contact, processing region. The Digital Personal Data Protection Act applies to this kind of data; take legal advice on current obligations.

**F3. Reviewer and publisher are one role, changed only in the database. P2.**

**F4. Canonical host mismatch. P2, check.**
Production is `www.allabouttax.in`; metadata, sitemap and robots use `allabouttax.in`. `sameOrigin()` compares against `AUTH_URL`, so chat requests from the other host would be rejected with 403 unless one redirects to the other.

**G1. Evaluation is six cases with regex checks, run by hand. P1.**
Build a labelled set with the expected source passage per question and expected refusals. Measure retrieval recall, citation correctness and refusal correctness separately. Run it on every change to retrieval, prompt or model. Without this, none of the work in section 8 can be shown to help.

**G2. No trace per answer. P1.**
Not stored: what was retrieved but not cited, scores, latency, token counts, cost, validation failures.

**G3. Errors are logged as a type name only. P2.**
Good for privacy (AD-19), but add request ids and stable error codes that carry no user text.

**H1. Leftovers. P2.**
`src/sanity/client.ts` and `@sanity/client`; `User.questionsToday`, `lastQuestionAt`, `threadId`; `--legacy-peer-deps`; NextAuth on a beta release; a typo in the JSON-LD description in `layout.tsx`.

---

## 8. Target architecture

### 8.1 Autonomous document intelligence

A staged job pipeline on the existing Postgres queue. Each stage writes its output and status, so a document can be re-run from any stage when that stage improves. No agent and no chat assistant.

```
fetch ──▶ store original (object storage, sha256)
      ──▶ classify each page: usable text layer? script? scanned?
      ──▶ extract:  good text layer ─▶ layout-aware text
                    otherwise      ─▶ OCR
      ──▶ quality gates per page ── fail ─▶ needs-attention queue
      ──▶ split languages; keep English as the indexed text
      ──▶ parse structure: instrument number, dates, sections cited,
                           commencement and amendment clauses, tables
      ──▶ propose metadata: field, value, source span, method, confidence
      ──▶ chunk by structure ─▶ embed ─▶ index
      ──▶ publish policy: auto │ auto with label │ person
```

Points that matter:

- **Text layer first, OCR only where gates fail.** A text layer is exact; OCR is not. Gates are deterministic: characters per page, share of dictionary words, script detection, replacement-character rate.
- **Choosing the OCR engine.** Decide by a bake-off on thirty of your own rejected PDFs, measuring character error rate and table fidelity. Candidates: a managed document service on the cloud you already use (no infrastructure; public documents, so no privacy concern); Tesseract with English and Hindi data (free, runs in the current worker, weakest on layout and tables); a self-hosted layout-aware stack such as PaddleOCR, docTR or Docling (better structure, needs a Python worker with more memory than a short CI job). My recommendation is managed for official documents now, and revisit self-hosting when user documents arrive with the forms product, because the privacy calculation changes there. Confirm Hindi support on your samples before committing to any of them.
- **What can be automated without a language model.** Much of the review form is extractable by rule: document type from the listing it came from; number and issue date from listing metadata and headers; sections cited by pattern; commencement from phrases like "shall come into force on" and "with effect from"; amendment and supersession from phrases like "in rule X, for the words … substitute"; a named entity from the notification's operative paragraph.
- **What cannot, honestly.** Whether an instrument is still in force, how it interacts with the 1961-to-2025 transition, and applicability that depends on reading conditions. For these, either a person decides or an extraction model called through an API fills a strict schema with supporting spans, and its output is treated as a proposal. That is not a chat dependency, but it is a model dependency; question 2 in section 10 is about where you draw this line.
- **Replace per-document period assignment with facts plus computation.** Store commencement and end dates and relationships; compute "applies to income year Y" at query time by date overlap. That is today's `MULTI_PERIOD` mode made the default, and it removes the field that is hardest to fill by hand.
- **Publish policy.** Field-level confidence and method decide the tier. Rule-extracted and cross-checked can publish automatically; model-proposed publishes with a visible "not yet reviewed" label or waits; anything failing a gate waits. This changes AD-02 and must be an explicit decision. D3 (withdraw, audit, rollback) is a precondition.

### 8.2 Knowledge store

From flat chunks to a structured store, still in Neon Postgres.

- **Nodes.** Document → version → tree of nodes (chapter, section, sub-section, clause, proviso, explanation; for notifications: preamble, paragraphs, tables, annexures). Each node has a stable citation path ("s. 80C(2)(i)", "Notification 1/2026, para 3") and page coordinates for highlighting.
- **Chunks derived from nodes**, each prefixed with its document title, number, date and heading path. Retrieve small, return the parent for context.
- **Hybrid retrieval.** The existing full-text index plus `pgvector` on the same tables, fused by reciprocal rank, then a reranker, then a relevance floor. Applicability filters run before ranking, as they do now. Embeddings are a retrieval index, not a chat model.
- **Relationships as tables.** `amends`, `supersedes`, `clarifies`, `refers_to`, and a section entity table that includes the official 1961-to-2025 section mapping. No separate graph database is needed at this scale.
- **Facts.** Reviewed tables for slabs, limits, due dates and rates with effective ranges and a source node each (A12).

### 8.3 Answer orchestration with LangGraph

Use LangGraph for control flow; use as little of LangChain as needed for model and retriever interfaces. Stay in TypeScript (LangGraph.js) inside the Next.js app unless question 4 says otherwise, so auth, Prisma and deployment stay as they are.

```
start ─▶ guard (scope, personal identifiers)
      ─▶ resolve period (stated, inferred, or ask)
      ─▶ analyse query (standalone rewrite, entities, sections, sub-questions)
      ─▶ retrieve (hybrid, applicability-filtered) ─▶ rerank ─▶ grade evidence
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

Ingestion stays a job pipeline, not a graph. Deterministic stages with explicit states are easier to re-run and audit.

### 8.4 Forms product

A separate application that shares packages with the chatbot.

```
shared   auth · document intelligence · knowledge store · tax rules engine · audit
forms    form registry ─▶ session graph ─▶ export
```

- **Form registry.** Each form and year as a versioned schema with field metadata: label, help, legal reference, validation, dependencies on other fields. Start from the official schemas and validation rules the department publishes for the return forms.
- **Rules engine.** Deterministic, versioned per year, unit-tested against worked examples. All arithmetic and validation live here.
- **Document import.** Form 16, AIS, 26AS and similar go through the pipeline in 8.1 with per-document templates. Every prefilled value keeps its provenance ("Form 16 Part B, item 6").
- **Session graph.** Intake → which form applies → import documents → field loop (ask, validate, explain with citations from 8.2) → compute → review → export. LangGraph's interrupts and checkpoints fit this well: the draft is the state, and every pause for the user is an interrupt.
- **"Real time".** A streamed session with autosave and resume. Field validation runs locally and instantly; the assistant explains and asks.
- **Export, not submission.** Produce the upload file or a filled PDF for the user to submit. Filing on the user's behalf through the portal's intermediary programme is a registration and compliance project of its own.
- **Sensitive data.** A separate store with field-level encryption, short retention, no identifiers in logs or prompts unless needed, and the groundwork in F2.

Repository shape: move to workspaces, with `packages/` for knowledge, document intelligence, rules and shared UI, and `apps/` for the chatbot and forms.

## 9. Suggested order

Each step is useful by itself and makes the next one measurable.

1. **Fix the P0 logic and build the yardstick.** A1, A2, A3, B2, B3; the evaluation set and per-answer trace (G1, G2); withdraw, audit and rollback (D3).
2. **Re-architect extraction storage** (C1), move originals out of Postgres (C9), fix the January cliff and conditional fetching (C7, C6).
3. **Document intelligence v1**: quality gates, OCR for failing pages, language split, structure parsing, metadata proposals shown in the review card (C2–C4, D2). People still approve, but confirm rather than type.
4. **Knowledge store v2 and corpus expansion**: nodes, hybrid retrieval, relationships; bring in the Act, Rules and form instructions (C5, C8, C10, C11, A4, A11).
5. **LangGraph answer flow** with streaming stages and quote-level citations (A7, A8, B5, B6).
6. **Publish policy** once step 3's proposals have a measured accuracy.
7. **Forms foundations**: workspaces, rules engine, facts tables (A12), sensitive-data store, first form.

Steps 3 and 4 can overlap. Step 7's rules engine can start early because nothing else blocks it.

## 10. Decisions needed from the owner

1. **Where is a chat assistant used today?** The code has no OCR and no model in the review path. Is someone pasting PDFs into a chat assistant to fill the review form, or is there other code not in this repository?
2. **What does "autonomous" allow?** (a) No model anywhere in ingestion, rules only, with a person approving what rules cannot decide. (b) A model called through an API to propose metadata, a person approves. (c) Automatic publication to the chatbot with no person, labelled as unreviewed. This is the largest decision here; it overturns AD-02.
3. **OCR hosting.** Managed service on the existing cloud, or self-hosted? Is Hindi text required, or is the English half of bilingual documents enough?
4. **Language for the new services.** Keep everything TypeScript (LangGraph.js in the Next.js app), or add a Python service? Self-hosted OCR would force Python for ingestion regardless.
5. **Forms product: first form and meaning of "fill".** Which form and year first? Guided questions that produce a file the user uploads, a browser helper that fills the government portal, or filing on their behalf?
6. **Audience.** Salaried individuals (the release plan's working assumption), or also professionals and businesses? This decides which sources to ingest first.
7. **Infrastructure budget.** The current setup is free-tier shaped (GitHub cron worker, originals in Postgres). OCR, embeddings and a reliable scheduler need paid compute. What is acceptable?
8. **Languages for users.** English only, or Hindi and Hinglish questions too?

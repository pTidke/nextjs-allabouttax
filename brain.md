# All About Tax — brain

Single source of truth for what this platform is, how it is built, and why it is built that way.
Read this before changing architecture. Update it in the same change whenever a decision here stops being true.

- The project has three parts: the **live product** (chatbot, ingestion, admin review), the **extraction lab and staging review** (merged from `codex/pdf-processing-lab` on 15 November 2026; staging is switched off by default), and, in its own repository, the **`pdfanchor` engine** ([`pTidke/benzeneblack`](https://github.com/pTidke/benzeneblack)), the start of the open-source extraction library. Sections 1–7.5 describe the live product, 7.6 the lab and staging, 7.7 the engine.
- Verified on 15 November 2026 by reading the source and running the tests: 34/34 on the live code before the merge; 328/328 Python tests in the lab; 30/30 in `pdfanchor`. After the merge the Node suite shows 62 passed and 3 cancelled on Node 22.23, all in `tests/extraction-storage.test.ts`; CI uses Node 24.
- Production and staging figures (user counts, corpus counts, deployment state) are quoted from `docs/` and `status.md`; they were not re-read from the live databases.
- `status.md` is the day-to-day status log, and `AGENTS.md` says to read it first. This file is the architectural reference. [`docs/improvement-areas.md`](docs/improvement-areas.md) explains what should change and why; [`docs/roadmap.md`](docs/roadmap.md) lists the work in order.

---

## 1. What the product is

An AI assistant for the Indian tax system, live at https://www.allabouttax.in.

Today it is one feature: a signed-in chatbot that answers central income-tax questions **only** from official documents that an administrator has reviewed and published, for a tax period the user selects, with citations back to the official source. If the reviewed library does not cover the question, it says so instead of answering from model memory.

The intended direction is broader:

1. A document-processing pipeline that reads official PDFs (including scanned ones) without a person in the loop.
2. A richer knowledge store and an orchestrated retrieval flow so answers are more accurate and better cited.
3. A separate product that helps people fill government tax forms in real time.

The first is under way as a local extraction lab, a hosted staging review screen and a new engine package; none of it is connected to the live library yet. The second and third are not started. Section 11 lists precisely what is and is not built.

## 2. Current state in one table

| Area | State |
| --- | --- |
| Chatbot | Live. Evidence-only answers, period-scoped, cited, non-streaming. |
| Corpus | Very small. Docs record 1 approved document version and ~155 pending review (4 Nov 2026). |
| Sources | CBDT circulars, CBDT notifications (current calendar year only), one e-filing FAQ page. |
| PDF handling (live) | Text-layer extraction only. No OCR in the live path. Scanned or >8 MB PDFs are rejected. |
| PDF extraction lab | Python lab, run by hand on a developer machine: native text with source geometry, Tesseract (English, Hindi) and EasyOCR (English) comparisons, scan recovery, table proposals. Nothing is selected or accepted automatically. |
| Engine (separate repository) | `pdfanchor` in [`pTidke/benzeneblack`](https://github.com/pTidke/benzeneblack): a working skeleton of the open-source engine. PDF in; `document.json`, Markdown and RAG chunks out, with a rule-based accepted / flagged / blocked verdict per line. Not yet at parity with the lab. |
| Staging review | **Retired on 16 November 2026 (R3).** Its pages, API routes and hosted repair queue are removed; its work was carried into the live review records by the `carry-over` workflow, which still reads the staging database. The library code (`src/lib/extraction-staging/`, including the Azure OCR repair worker) stays as a switched-off backup. |
| Retrieval | PostgreSQL full-text search. No embeddings, no reranking. |
| Orchestration | Plain TypeScript functions in one route handler. No LangChain or LangGraph. |
| Review | Fully manual, one document at a time, by an `ADMIN` user. Nothing is auto-approved. |
| Forms, calculators, uploads | Not built. |
| Users | 8 accounts, Google sign-in only. 10 questions per user per day. |

## 3. System map

```
 Browser (Google sign-in)
    │ HTTPS
    ▼
 ┌──────────────────────── Vercel ─────────────────────────┐
 │ Next.js 16 App Router, React 19                         │
 │  pages  /  /library  /chats  /profile  /contact         │
 │         /admin/knowledge                                │
 │  API    /api/assistant        /api/conversations/*      │
 │         /api/knowledge/coverage   /api/admin/knowledge  │
 │         /api/auth/*           /api/health               │
 └───────────┬──────────────────────────────┬──────────────┘
             │ Prisma 7 (pg adapter)        │ OpenAI SDK, Responses API
             ▼                              ▼
   Neon PostgreSQL                  Azure OpenAI deployment
   auth · knowledge · job queue     strict JSON schema, store:false
   chats · quota · worker state
             ▲
             │ DATABASE_URL only (no model or auth keys)
 ┌───────────┴──── GitHub Actions, cron 17 */6 * * * ──────┐
 │ scripts/tax-worker.ts tick   then  scripts/tax-health.ts│
 └───────────┬─────────────────────────────────────────────┘
             │ HTTPS, exact-host allow-list
             ▼
   www.incometaxindia.gov.in   www.incometax.gov.in
```

Two processes, one database. The web app never fetches government sites; the worker never calls the model.

## 4. Technology

| Layer | Choice | Notes |
| --- | --- | --- |
| Framework | Next.js `^16.4.5`, App Router, React 19.2, React Compiler on | `output: "standalone"`. `AGENTS.md` warns this Next version differs from older conventions; read `node_modules/next/dist/docs/` before writing Next code. |
| Language | TypeScript 5, Node `>=22.19` (CI and Docker use Node 24) | |
| Styling/UI | Tailwind 4, Radix primitives, shadcn-style components, framer-motion, lucide | |
| Database | PostgreSQL on Neon | Prisma 7 with `@prisma/adapter-pg`; optional Accelerate path if `DATABASE_URL` starts with `prisma://`. |
| Auth | NextAuth v5 beta, Google provider, Prisma adapter | Database sessions. `role` (`USER`/`ADMIN`) on `User`. |
| Model | Azure OpenAI via `openai` SDK, Responses API | Deployment name comes from `AZURE_OPENAI_DEPLOYMENT` (`.env.example` uses `gpt-5.6-luna`). |
| HTML parsing | cheerio | |
| PDF text | unpdf (pdf.js text layer) | No rasterising, no OCR. |
| HTTP client (worker) | undici with a custom DNS-validating connector | |
| Tests | `node:test` through `tsx`, PGlite embedded Postgres | Real migrations and real Prisma repositories. |
| Hosting | Vercel (web), GitHub Actions cron (worker), Neon (DB) | A Dockerfile with `web` and `worker` targets also exists. |
| Analytics | Vercel Analytics and Speed Insights | |

Install uses `npm ci --legacy-peer-deps` because of unresolved peer conflicts.

## 5. Repository map

```
src/app/                      routes (pages and API handlers)
  (marketing)/page.tsx        landing page; src/app/page.tsx re-exports it
  api/assistant/route.ts      the chat endpoint (the whole answer flow)
  api/admin/knowledge/route.ts  admin read model and all admin actions
  api/conversations/...       list, read, delete, export
  api/knowledge/coverage/     public per-period coverage summary
  admin/knowledge/            review UI (panel.tsx, review-card.tsx)
  library/ chats/ profile/ contact/
src/components/chat/          ChatContext (client state), ChatInterface, ChatWidget, CoverageNotice
src/lib/chat/                 answer.ts (prompt, schema, validation), generate.ts, model.ts,
                              access.ts (ownership, quota), history.ts, session.ts
src/lib/tax/                  the knowledge pipeline
  registry.ts                 sources, host allow-list, limits, period maths
  fetch.ts                    hardened fetcher
  cbdt.ts                     CBDT listing adapter (guest search API)
  documents.ts                extraction and chunking
  ingestion.ts                job queue, document ingestion, versioning
  scheduler.ts                daily/weekly scheduling, worker heartbeat
  review*.ts                  validation, approval, drafts, queue, FAQ sectioning, presets
  retrieval.ts                evidence query
  coverage.ts                 public coverage query
src/lib/operations/           health report, legacy auth import
src/lib/db.ts  http.ts        Prisma client, HTTP helpers (same-origin, bounded JSON, errors)
scripts/                      tax-worker, tax-health, tax-probe, tax-evaluate, tax-import-auth
prisma/                       schema and five hand-ordered SQL migrations
evaluations/income-tax.json   the answer yardstick: questions with their expected source passage or refusal
tests/                        unit and PGlite integration tests
docs/                         runbooks, improvement areas, roadmap
status.md                     running status log; read first when resuming work
tools/pdf_pipeline/           the Python extraction lab (CLI `tax-pdf`), its benchmarks and schemas
tools/extraction-staging/     SQL for the isolated staging database
src/lib/extraction-staging/   staging store, contract, repair worker
```

## 6. Data model

All tables are in one Postgres database (`prisma/schema.prisma`).

**Identity** — `User` (with `role`), `Account`, `Session`, `VerificationToken`. Standard NextAuth shape. `User.questionsToday`, `lastQuestionAt` and `threadId` are leftovers from the retired OpenAI Assistants flow and are unused.

**Knowledge**

| Table | Meaning | Key facts |
| --- | --- | --- |
| `TaxSource` | A registered listing or single document | `kind` is `LISTING` or `DOCUMENT`. `lastError` set when a source-level job fails. |
| `TaxDocument` | One official URL | `latestVersionId`, `verifiedAt` (last successful fetch), `lastError`, `issuedAt`. |
| `TaxVersion` | One fetched content state of a document | Holds `original` bytes, `text`, hashes, review `status` (`PENDING`/`APPROVED`/`REJECTED`) and all review metadata: `documentType`, `legalStatus`, `period`, `periodMode`, `effectiveFrom/To`, `entityName`, `investmentFrom/Through`, `applicabilityNote`, `jurisdiction`. Unique on `(documentId, hash)`. |
| `TaxChunk` | A retrievable passage (a chunk) | `anchor` (for example `Page 3, passage 2` or `FAQ 9`) and `text`; for chunks built from reviewed lines also `page`, `pageEnd`, `headings`, `context` ("Annexure A › para 2"), `kind`, `incomeYears` and `provisions`. GIN indexes on `to_tsvector('english', text)` and, used by retrieval, on the context line with the text. |
| `KnowledgeRelease` | A published manifest | Monotonic `sequence`, full `versionIds[]` array, `createdBy`. |
| `TaxReviewDraft` | A reviewer's private, incomplete form | Keyed by `(versionId, userId)`, optimistic `revision`. |

**Pipeline** — `IngestionJob` (Postgres-backed queue: `dedupeKey`, `status`, `attempts`, `availableAt`, `leaseUntil`, `leaseToken`, optional `documentUrl`) and `TaxWorkerState` (single `ingestion` heartbeat row).

**Engine runs** — `ExtractionRun` (`versionId`, `engine` such as `pdfanchor 0.0.2@55effa78855e`, `policyVersion`, `configSha`, `status` `OK`/`FAILED`, `summary`, `document`: the engine's `document.json` as JSONB, capped at 8 MB, `error`). Append-only; a newer engine version adds a newer run.

**Line decisions** — `LineReview` (`versionId`, `runId`, `lineId`, `decision` `CONFIRMED`/`CORRECTED`/`UNREADABLE`/`LEFT_OUT`, `text` only for corrections, `reviewerId`). Append-only; the newest row per run and line is its decision. `LEFT_OUT` (migration `202611160001`) marks a line that is not part of the text, such as a garbled header or a watermark.

**Conversations** — `TaxConversation` (`userId`, fixed `period`), `TaxMessage` (`role`, `content`, `citations` JSON, `releaseId`, `model`, `promptVersion`, and on assistant messages an `outcome`: `ANSWERED`, `CLARIFICATION`, `UNSUPPORTED` or `NO_EVIDENCE`), `DailyUsage` (`userId`, IST `day`, `count`), `TaxContentGap` (a question the library could not answer: points at the user's own message and is deleted with it).

**Contact** — `ContactMessage` (`name`, `email`, `message`) from the public contact form.

Hand-written SQL that Prisma's schema does not express: the GIN full-text index on `TaxChunk`, the partial unique index `IngestionJob_active_source` (one `RUNNING` job per source), and a check constraint on `periodMode`.

## 7. Core flows

### 7.1 Ingestion (worker)

1. **Schedule** (`scheduler.ts`). `tick` registers the built-in sources, then enqueues one job per enabled source per UTC day. Sunday's job is a `weekly` bucket; a missed Sunday is caught up later in the week.
2. **Claim** (`ingestion.ts`, `runNextJob`). One SQL statement claims the oldest due job with `FOR UPDATE SKIP LOCKED`, sets a 10-minute lease and a random lease token. Expired leases are reclaimed. One running job per source.
3. **Discover** (listing sources). CBDT listings go through `cbdt.ts`: read the public page, take the guest CSRF token and structure id, resolve the `Year` taxonomy, then page through the public search API for each year in the window. It validates totals, page sequence, duplicate ids, document host and issue year, and throws rather than return a partial list. The window starts at `TAX_DISCOVERY_START_YEAR`, defaulting to the current calendar year.
4. **Select what to check.** Daily runs queue new documents, documents with errors, and documents whose latest version is approved. Weekly and manual runs queue every known document.
5. **Fetch** (`fetch.ts`). HTTPS only, four exact hosts, DNS answers validated inside the socket connector, redirects followed manually and re-validated (max 5), 8 MB cap, 25 s timeout, only `text/html` or `application/pdf`.
6. **Extract** (`documents.ts`). PDF: pdf.js text layer, page by page. HTML: strip chrome, require `article` or a main container. Then pack paragraphs into passages of up to about 2,600 characters, never crossing a PDF page. Extraction is rejected if total text is under 300 characters, there are more than 1,000 chunks, or the title looks like a bot wall.
7. **Version.** Hash is SHA-256 of the bytes for PDFs and of the extracted text for HTML (so changing page chrome does not create a new version). A new hash creates a new `PENDING` `TaxVersion` with its chunks; an existing hash is reused. `latestVersionId` and `verifiedAt` are updated. A cumulative budget on stored originals (`TAX_MAX_ORIGINAL_BYTES`, default 128 MiB) is enforced under an advisory lock.
8. **Fail safely.** Errors are truncated, stored on the job and on the document or source, retried up to three attempts with exponential backoff, then left `FAILED` and visible to the admin.

### 7.2 Review and release (`/review`)

Review happens in the Review workspace at `/review` (since 15 November 2026; before that, in `/admin/knowledge`, which now only manages sources). Code: `src/lib/review/`, `src/app/review/`, `src/app/api/review/`.

- **Roles** (`ReviewerGrant`, `lib/review/roles.ts`): `EXTRACTION` checks extracted text; `TAX` decides applicability and publishes. An administrator grants and revokes them at `/review/team` by e-mail; the person must have signed in once. Being an administrator grants neither role. Roles are re-read from the database on every request.
- **Queue** (`reviewQueue`, `/review`): current `PENDING` versions under the same step names as a document's page, *1. Check the words*, *2. Check the details*, *Waiting to be read* (no passages and no engine run) and *Everything waiting*, ten a page. It opens on the reviewer's own step (the details first for someone who can do both, since they are closest to publishing) and offers the first document there as *Next for you · Start*. Statuses are plain: *Words to check*, *Sent back*, *Words checked · details next*.
- **Document page** (`app/review/[versionId]/workspace.tsx`, AD-48): three steps, one shown at a time, with a step indicator: *1. Check the words* (text check access), *2. Check the details* (tax access), *3. Published*. Someone with both kinds of access goes straight from one to the next; someone with one sees what the other person still has to do. Everything technical (how the engine read it, the passages the chatbot gets, the history, staging carry-over, the version hash) is in one closed *Behind the scenes* drawer.
- **Gate 1, the words** (`ExtractionReview`, append-only): `ACCEPTED` or `NEEDS_CHANGES` (with a note). The newest row is the current state. With an engine run, *Done* records `ACCEPTED` once every line is decided and none is unreadable; *Send it back* records `NEEDS_CHANGES`, with a note written for the reviewer when lines cannot be read. Without a run (web pages, or a PDF the engine has not read), the passages are compared with the original and *Done* accepts them as they are.
- **Gate 2, the details** (`components/review/TaxReviewForm.tsx`, `DetailsCheck`): the original on the left, the details on the right, filled in from the document facts, any checked preset and the reviewer's draft, in that order, and read back as one sentence (*What the chatbot will be told*). The reviewer corrects what is wrong: what it is, number, Gazette number, issuer, issue date, whether it is in force (law, guidance, only proposed), the date it applies from (the issue date unless the document says otherwise), one tax year or several, and everyone or one named person or company. A note for the chatbot is asked for only when it is required (several years, or an investment window). Rule expiry, investment dates, Gazette publication date, a note for the record and, for FAQ pages, the parts to publish are under *More details*. The draft saves itself a moment after each change; *Publish* is disabled with a plain list of what is missing; *Don't publish this document* asks for a reason. `recordTaxDecision` refuses approval unless the user has `TAX` and the latest text check is `ACCEPTED` and current, then calls `reviewVersion` below; an empty note is stored as "Checked against the original."
- **Upload** (`lib/tax/upload.ts`, `/review/upload`): a PDF of up to 32 MB, a title and the official https address on a `.gov.in` or `.nic.in` site, which is what the chatbot cites. It goes into the `uploads` source (kind `UPLOAD`) under the same storage budget. A PDF with no text layer is kept with a "needs OCR" error and no passages. Uploaded copies are fixed snapshots: the worker never re-fetches them and they are exempt from the 48-hour freshness rule.
- **Uploading in parts.** Vercel refuses request and response bodies above 4.5 MB, so the browser computes the file's SHA-256, starts an upload (`POST /api/review/upload` with the details, size and hash), sends it in parts of 3 MB (`PUT /api/review/upload/[id]/[n]`, stored in `UploadPart`), and completes it (`POST /api/review/upload/[id]`). Completing joins the parts, checks size and hash, adds the PDF like any upload and deletes the parts. Only the reviewer who started an upload can add to it; a reviewer has at most three open; unfinished uploads are deleted after a day. The storage budget is checked when the upload starts and again, under the lock, when it completes.
- **Serving originals** (`/api/review/[versionId]/original`): read from Postgres with `substring`, in one query up to 4 MB and otherwise streamed in 1 MB slices, so files above Vercel's response limit still display. Single byte ranges are answered with 206. The browser may keep the file for a day.
- **Engine runs** (`lib/review/extraction-runs.ts`, `scripts/extract-documents.ts`, `.github/workflows/extract.yml`): every two hours GitHub Actions installs pdfanchor at the commit pinned in the workflow (`PDFANCHOR_REF`) with Tesseract for English and Hindi, and runs it over each current pending PDF that this engine version has not read (up to 60 per run, 20 minutes). It uses `--lang eng+hin --exclude-script Deva`, so Hindi-only lines are kept as evidence but need no review. A result whose source hash differs from the stored original, or that is malformed, is stored as `FAILED`. Runs only add rows; they never approve anything. When a newer engine reads a pending document again (its text not yet accepted), the decisions made on the previous reading carry over to the new one for every line that reads exactly the same on the same page, once on each side; only lines the new engine reads differently come back for a decision (`carryLineDecisions` in `lib/review/extraction-runs.ts`).
- **Checking the words** (`components/review/WordCheck.tsx`, AD-48): one way of working, page by page, the page on the left with every line outlined in the colour of its state (look closely, to check, checked, not needed) and its lines on the right. First the page's lines that need a look come up one at a time as a close-up of the original drawn by pdf.js around the line, with what was read and any second reading (words that differ marked), and the choices *It's right*, *Fix it*, *Use the second reading*, and, smaller, *Leave it out (not part of the text)* and *Can't read it* (keys 1 to 5). Then the rest of the page is one list and one button, *These N lines are right*; a wrong line is clicked, on the list or on the page, and fixed instead. When a page is done the next page with lines open comes up by itself; a line clicked on purpose is a change, so the page stays. Fixed *Previous page* and *Next page* buttons and a progress bar (*N of M lines checked*) sit above. Signature, "Copy to" and Hindi lines are listed greyed with the reason, and need nothing.
- **Which lines need a look on their own** (`lib/review/line-rules.ts`, `confirmLines` in `lib/review/line-reviews.ts`): a rule blocked it; another reader read it differently; only one OCR reader read it and it has a number in it (dates, amounts, section and notification numbers, PANs) or the reader's confidence is below 90; or it is in the spot check. The server refuses such lines in a batch, so the guard does not depend on the screen.
- **Page viewer** (`components/review/PageViewer.tsx`): the page fitted to width with zoom, drawn by pdf.js, with outlines given by the caller (the word check) or, elsewhere, every line on request. The review page receives only a compact queue (line id, page, spot check, decision) for every line to check, however many, and the list of left-out lines; each line's text, readings, box and latest decision load page by page from `/api/review/[versionId]/lines?page=N`, which reads just that page out of the stored result (`jsonb_path_query_first`). The next page with an open line is fetched ahead. Without a run the page is still drawn, without boxes. All views share one pdf.js document (`components/review/pdf.tsx`), so the original is downloaded once; the browser may keep it for a day (`private, immutable`), since a version's original never changes.
- **Chunks for the chatbot** (`lib/review/chunks.ts`, AD-49; migration `202611160002`): built by rule in two steps from the reviewed lines. First the *reviewed document*: lines with corrections, without Hindi evidence, closing lines or lines left out, joined into blocks (paragraphs, tables with one row per line, headings); a word hyphenated across a line break is closed up ("Income-" + "tax", "10-" + "IG"); a paragraph the engine broke in two on one page is joined when the signs are clear (the next part starts in lower case, or the first stops on a comma or a word such as "of" or "the"), and one that runs onto the next page is joined whenever it has not ended and the next does not start a numbered item; titles in capitals never join. Then the *chunks*: blocks packed in order under one heading path up to 2,000 characters, never cutting a block; a proviso or Explanation stays with its paragraph; a new numbered paragraph ("3.") starts a new chunk once the current one has 400 characters; a block longer than 2,000 characters is split between sentences (abbreviations such as "No.", "S.O.", "M/s." do not end one; a sentence longer than a chunk is cut at a comma or space, never in a word), and each piece after the first repeats the sentence before it. Each chunk carries a metadata section: first and last page, heading path (the opening heading block, then the latest section heading), a context line with the paragraph number ("MINISTRY OF FINANCE › Annexure A › para 2", "(continued)" on later pieces), its kind (text, proviso, explanation, table, heading), the income years it names (read only where a year word introduces them, stored as the April–March year "2026-27", an assessment year counting as the year before) and the provisions it names ("section 10(23FE)", "rule 34", "Form 10-IG"). Retrieval searches the context line with the text, and the model is given it as each passage's `section` (prompt `tax-evidence-v6`). *Behind the scenes* shows the reviewed document whole, then the chunks as cards with their metadata. Legacy passages (web pages, documents without an engine run, and chunks built before AD-49) have no such metadata until rebuilt.
- **Document facts** (`lib/review/document-facts.ts`): rules read the reviewed text (corrections applied, left-out lines removed) for the document type, number ("1/2026", "No. 122 of 2026"), Gazette number ("S.O. 44(E)"), issuing authority and issue date (a dated line, or one naming New Delhi) from the first two pages; and from the whole document, the date it comes into force ("shall come into force on the 1st day of April, 2026"; on publication, the issue date), the one taxpayer it is about ("in the case of M/s …", or a name followed by "(PAN: …)" after "approves", "notifies" or "specifies") and the years named. Each comes with the line it came from, shown under the field as *Read from page N*. Approval stores the confirmed number, Gazette number, authority and issue date on the version.
- **Staging carry-over (R3)** (`lib/review/staging-carry-over.ts`, `lib/review/staging-apply.ts`, `scripts/staging-carry-over.ts`, `.github/workflows/carry-over.yml`): reads the old staging review database and writes its work into the live records: line decisions where staging's regions and the engine's lines match by text (a checked region confirms or corrects its line, an unreadable one marks it unreadable), an accepted text check where staging accepted the extraction and nothing is left undecided, tax-review drafts from staging tax reviews, and the history (`StagingCarryOver`), shown under the text check as "Carried over from the staging review".
- **Page geometry.** The engine measures every page in its crop box, the area PDF viewers show, from its top-left corner; pdf.js uses the same frame, so boxes need only scaling. Text outside the crop box is not a review line; the page carries a `page.hidden-text` flag instead. (pdfanchor 0.0.1 measured the whole sheet, the MediaBox, which shifted every box on pages with an inset crop box, as Gazette PDFs have.)
- **Line decisions** (`lib/review/line-reviews.ts`): with an engine run, every line is checked (AD-48) apart from Hindi evidence and the closing lines below. A spot check of about one rule-accepted line in twenty, from one to five (chosen by hash of run and line, so everyone sees the same ones), is looked at on its own. *Done* is refused until every line is decided and none is unreadable. On acceptance, the version's passages are rebuilt from the run's lines with corrections applied: Hindi evidence, closing lines and left-out lines removed, a paragraph's lines joined, a table's rows kept together, packed into passages of up to 2,000 characters per page (`Page N, passage M`). When a line changes after acceptance, the passages are rebuilt at once and the acceptance recorded again ("Passages rebuilt after a line was changed."); a line marked unreadable after acceptance withdraws it instead. An uploaded scan's "needs OCR" marker is cleared at acceptance. The engine does not re-read a version whose text has been accepted, so an engine upgrade does not reopen finished work.
- **Closing lines** (`lib/review/closing-lines.ts`): the signature (a name in brackets or capitals just above a designation such as Under Secretary or Director, a designation line, a telephone or e-mail line, "Yours faithfully") and the "Copy to" list, which runs until the next heading so an annexure after it is kept. Only after the body has started, only short paragraphs, never table cells. These lines need no check and are left out of the passages: nobody asks who signed a notification (owner, 16 November 2026). The document number in brackets at the foot is kept. The same goes for page furniture: the Gazette's running header ("THE GAZETTE OF INDIA : EXTRAORDINARY [PART II—SEC. 3(ii)]"), page numbers, and any short line that is not a sentence repeated at the top or foot of three or more pages, shown as *Page header or number*.

The structured fields and their checks are unchanged:

Approving requires: selected sections, document type, legal status, period mode, effective-from date, and a note. `validateReview` enforces date sanity, period overlap, and the entity and investment-window rules. Inside one transaction under advisory lock `740126`, `reviewVersion`:

- refuses anything that is not the latest `PENDING` version of its document;
- if a subset of FAQ sections was selected, **replaces** the version's chunks with only those sections;
- writes the review metadata and sets `jurisdiction = 'IN-CENTRAL'`;
- creates a new `KnowledgeRelease` whose `versionIds` is the previous manifest minus every version of this document, plus this one if approved.

Section-level selection exists only for consecutively numbered FAQ pages (`review-sections.ts`). Everything else is reviewed and scoped as a whole document.

### 7.3 Retrieval (`retrieval.ts`)

One SQL query against the latest release. A chunk is eligible only if all of these hold:

- its version is in the release manifest, `APPROVED`, legal status `EFFECTIVE` or `GUIDANCE`, jurisdiction `IN-CENTRAL`;
- period matches. The tax year is resolved by `resolvePeriod` in `registry.ts`: a year named in the question ("FY 2025-26", "AY 2026-27", "tax year 2026-27"; a bare "2025-26" does not count, being ambiguous), else the most recent one named earlier in the chat, else none. With a year, `SINGLE_PERIOD` requires the stored period to name the same income year (FY 2026-27, TY 2026-27 and AY 2027-28 are one year; `equivalentPeriods`) and effective dates must overlap it. With none, every year is searched and each passage carries its own period. `MULTI_PERIOD` always requires an applicability note;
- effective dates overlap the selected period's April–March range;
- if the version names an entity, the user's question contains that full normalised name;
- the version is still the document's latest, the document was fetched successfully within 48 hours, and neither the document nor its source has an error.

Matching is `to_tsquery('english', …)` over up to 24 lower-cased question terms joined with OR, ranked by `ts_rank_cd` and then by newest effective date, top 6. The terms of the last three questions in the same conversation also match, at half the weight of the current question, so a follow-up with no subject of its own ("and how long is it?") still finds its topic. The entity rule above still looks at the current message only.

### 7.4 Answer generation (`api/assistant/route.ts`, `lib/chat/*`)

1. Same-origin check, session check, input validation (message ≤ 6,000 characters, valid period, body ≤ 16 kB).
2. Load the conversation if an id was sent; it must belong to the user. Load its last three user questions as search context, and resolve the tax year from the question or those questions (or none).
3. Retrieve evidence. **If none, reply with a fixed limitation message**: no model call and no quota use, but both messages are saved (outcome `NO_EVIDENCE`) and the question is logged as a content gap.
4. Reserve one question from the daily quota (atomic upsert keyed on the IST date).
5. Load the last 8 messages as history.
6. Call the model once: `instructions` (prompt version `tax-evidence-v4`), a JSON payload of question, period, history and evidence (each passage labelled `S1…S6` with its scope metadata), strict JSON schema output `{answer, supported, needsClarification, sourceIds, suggestions}`, `store: false`, 2,200 max output tokens, 40 s timeout, no retries.
7. `validateAnswer`: reject URLs or markdown links in the text; every `[S#]` marker must be a declared source id and every declared id must appear as a marker; a supported answer must cite something. If `supported` is false the model text is discarded and a fixed refusal is returned (`UNSUPPORTED`), unless `needsClarification` is true and the text passes `safeClarification`: at most 400 characters, contains a question mark, no digits and no citation markers. Then it is shown as a clarifying question (`CLARIFICATION`). The no-digits rule keeps amounts, dates, rates and thresholds from model memory out of it. A "Source status: Official guidance […]" line is appended by the server for cited guidance.
8. `saveTurn` (`lib/chat/turn.ts`), in one transaction: create the conversation if this is its first question, save both messages with citations, release id, model, prompt version and outcome, log a content gap for `UNSUPPORTED`, and give the question back to the quota for `UNSUPPORTED`. A clarifying question is charged. On any failure after step 4 the quota is refunded and nothing is saved, so no empty conversation is left behind.
9. Reply with the message, suggestions and the number of questions left today, which the chat shows under the input.

The response is returned whole; nothing is streamed.

### 7.5 Client

`ChatContext` holds chat state in memory only (never `localStorage`) and is remounted when the signed-in identity changes. The chat opens as a full-screen dialog from a floating widget on every page. There is no year picker: the user names a year in the question when it matters, and each answer says which year it applies to. A reply that did not count toward the daily limit says so. `/chats` lists, reopens, exports (streamed JSON) and deletes conversations. `/library` and the in-chat coverage notice show which released documents are currently available, for all years or, in the library, for one year.

### 7.6 Extraction lab and staging review

*Retired on 16 November 2026: the `/staging` pages, `/api/staging` routes and the hosted repair queue were removed after the carry-over (R3). This section is kept as history; the library code it describes remains, disconnected, as a backup.*

This is a separate system, developed on the `codex/pdf-processing-lab` branch and merged on 15 November 2026. It does not read or write the live library, and the live ingestion in 7.1 is unchanged by it. Staging routes return 404 unless `EXTRACTION_STAGING_ENABLED` is set.

```
 developer machine (operator)                      Vercel preview, region cle1
 ┌──────────────────────────────┐                ┌───────────────────────────────────┐
 │ tools/pdf_pipeline  (Python) │                │ /staging/extraction   inbox        │
 │  native text + geometry      │  bundle        │ /staging/tax-review   tax decision │
 │  Tesseract eng / eng+hin     │ ─────────────▶ │ /api/staging/*                     │
 │  EasyOCR eng                 │  plan, upload, │ /api/queues/extraction-ocr         │
 │  Docling tables (optional)   │  import        │    └─ repair worker                │
 │  review packages (HTML)      │                └──────┬──────────────────┬──────────┘
 └──────────────────────────────┘                       │                  │ crop + prior reading
                                                        ▼                  ▼
                                      staging Neon: auth DB, review DB,   Azure OpenAI
                                      private object storage (evidence)   (same chat deployment)
```

**The lab (`tools/pdf_pipeline/`, about 11,000 lines of Python, CLI `tax-pdf`).**

- `runner.py` copies the original read-only, runs a preflight, then inspects each page in an isolated subprocess (`worker.py`) with time, memory, pixel, page and glyph budgets.
- Preflight uses two parsers that must agree on page count, and blocks on encryption, active content, embedded files and form fields.
- Per page it renders a PNG and extracts text lines with a source box for every glyph, plus candidate table grids (pdfplumber). It classifies the page as `native_candidate`, `ocr_required` or `blank_candidate` from text length, image area, and unmapped or private-use characters, and tags Devanagari and Latin script.
- `models.py` defines the versioned artifact contract (JSON schema in `schemas/`). `assess()` blocks the artifact if any page is missing, failed, or is not `native_candidate`. `publication_eligible` is the literal `false` in the type.
- OCR runs locally and offline. Tesseract.js 7 in a small Node worker (`ocr/worker.mjs`) with pinned, hash-checked `tessdata_fast` weights for English and Hindi; EasyOCR 1.7.2 on CPU for English as an independent second reading; an optional Docling probe for table structure (its OCR backend rejects Hindi). No model API is called from the lab.
- Supporting experiments, each its own subcommand: scan recovery (row segmentation, rotations), targeted OCR (numeric profile, background flattening), date and superscript hints, native and scanned table structure proposals, table reconstruction drafts, a reference dataset with CER/WER scoring, a source-transfer evaluation, and a structured content preview.
- Every run writes to a fresh directory, records engine versions, code and weight hashes, and never overwrites an earlier result. Feedback files in `benchmark/` bind each reviewer statement to exact source bytes, renders and regions.
- **No step chooses between readings.** Reports carry `selected_engine: None`; confidence and agreement never clear a hold. One official page of eighteen in the reference set is human-verified, plus three individual fields.

**The staging application (`src/lib/extraction-staging/`, `src/app/staging/`).**

- A validated bundle from the lab is uploaded and imported by an operator (`npm run extraction:staging -- plan|upload|import`). Candidates, review revisions and heads are immutable rows (database triggers reject update and delete) in a schema applied by hand from `tools/extraction-staging/*.sql`, not by Prisma.
- A candidate is one of two kinds: `native_full_pages` or `image_table_band`. Each has regions (`raw`, `proposed`, `state`, source box, optional table cell), the original, page renders and evidence objects, all content-addressed.
- Access is a separate, expiring, operator-granted capability. `ADMIN` on the main app does not imply it. A tax reviewer is granted by e-mail with an expiry.
- Extraction review: the inbox shows flagged regions beside the PDF. The reviewer marks each region "Matches source", "Needs correction" or "Cannot verify", and reports issues as free text. Acceptance needs a native full-page scope, no blocking holds, every region checked, three attestations (reading order, context, critical characters) and a reason.
- Repair: "Send correction request" queues a job (Vercel Queues, topic `extraction-ocr-repair-preview`). The consumer crops the stored page image around each reported line, sends the crop, the previous reading and the reviewer's description to the Azure chat deployment with a strict JSON schema (`replace` / `blank` / `uncertain`), validates the text, and writes a new candidate that returns as "Ready to recheck". Limits: four text lines per request; single table cells only on copies carrying the `TABLE_OCR_PILOT` hold. Anything else goes to manual repair by the operator.
- Tax review (`/staging/tax-review`): free-text fields (classification, applies to, period, notes) plus supporting line ids, bound to the accepted extraction revision. Pilot only.
- Evidence lives in Neon Object Storage through an S3 client; the web role has read-only access; each object is capped at 4 MiB in the cloud pilot.
- **Nothing accepted in staging reaches the live library.** There is no release adapter into `TaxVersion` / `TaxChunk`.

Recorded state (`status.md`, 14 November 2026): Notification 1/2026 has an accepted extraction awaiting its first tax review; Circular 3/2026 has a saved recheck draft and is blocked by its partial table scope.

### 7.7 The `pdfanchor` engine (repository `pTidke/benzeneblack`)

The planned open-source library: given any PDF, produce output a language model can read and a vector index can ingest. Character recognition is one stage inside it. It is a self-contained Python package in its own repository, https://github.com/pTidke/benzeneblack, with no dependency on this one. This application will use it as an installed dependency (`pip install "pdfanchor @ git+https://github.com/pTidke/benzeneblack"`) and treat it as a black box that produces `document.json`. It is licensed under Apache 2.0 and has not been released to PyPI yet.

```
PDF ─▶ preflight ─▶ text layer + geometry ─▶ OCR (scan, or cross-check)
    ─▶ rule validators ─▶ decision policy ─▶ structure
    ─▶ document.json · document.md · chunks.jsonl
```

- `model.py` is the output contract (schema `0.1.0`, published in `schemas/`). Every line has a page box, the reader's exact text, its source (`native` or `ocr:<engine>`), other engines' readings of the same place, a status and the flags behind it.
- `native.py` reads the text layer and table cells with boxes and classifies each page as native, scanned, blank or failed. `ocr/` defines the engine interface; Tesseract (command-line program) is implemented and tested, EasyOCR is written but untested.
- `crosscheck.py` compares two readings: overall similarity plus exact equality of critical tokens (anything with a digit, and negations). `validators/` raises flags for unmapped characters and malformed dates. Nothing rewrites text.
- `policy.py` decides per line: **accepted** (no validator objects and an independent reading agrees), **flagged** (with the rule id), or **blocked**. Tables are always flagged. A scanned page with no engine is blocked, never silently empty.
- `export/` writes Markdown (page breaks and flags as HTML comments) and chunks (one JSON object per line with `embedding_text`, `anchors` to page boxes, `status` and `rules`). A chunk never splits a paragraph, may cross a page break, and a table is its own chunk.
- `pipeline.convert()` runs the stages; `cli.py` exposes `pdfanchor convert file.pdf --out dir` with exit codes 0 (all accepted), 2 (needs a person), 1 (failed).

It is a skeleton, about 1,000 lines plus tests. Process isolation, pinned weights, scan recovery, table structure and large-document handling are still only in the lab; `docs/porting-from-the-lab.md` in the engine repository lists the order for bringing them across. The policy thresholds are uncalibrated.

## 8. Architectural decisions

Each entry records the decision, the reason, and the consequence that matters for future work. AD-01 to AD-25 concern the live product; AD-26 to AD-33 the lab and staging; AD-34 onward the engine.

| # | Decision | Why | Consequence |
| --- | --- | --- | --- |
| AD-01 | **Evidence-only answers; fail closed.** No evidence means a fixed limitation, never model memory. | Wrong tax advice is worse than no answer. | Usefulness is capped by corpus size and retrieval recall. |
| AD-02 | **Human approval gate.** Refresh and discovery never approve anything. | An imported notification is not automatically applicable law. | Review throughput is the bottleneck on coverage. |
| AD-03 | **Immutable originals with content-hash versions.** Changed content becomes a new `PENDING` version and the old approval stops being eligible. | Old approvals must not silently carry over to changed text. | Any change to a document removes it from answers until re-reviewed. Version identity is also tied to extractor output for HTML. |
| AD-04 | **Releases are full, numbered manifests** created under one advisory lock. | Every answer can record exactly which knowledge set produced it (`TaxMessage.releaseId`). | Retrieval still also checks live flags, so a release is not a pure snapshot. No rollback action exists. |
| AD-05 | **The tax year comes from the question, not a picker** (since 15 November 2026; previously the user chose one period per conversation). A year named in the question or earlier in the chat narrows the search; with none, every year is searched, each passage is labelled with its year, and the model must say which year the answer applies to or ask. | The picker was a barrier before the first question; most people do not know FY from AY. | Answers can mix years if the model ignores the labels; the citations show each source's year, and the evaluation set must cover it. A conversation is stored with period `AUTO`. |
| AD-06 | **Freshness and health gates at query time** (48 h since last successful fetch; no document or source error). | Do not cite something that may have been withdrawn. | A stalled worker or a broken listing removes evidence from answers. |
| AD-07 | **Lexical retrieval in Postgres** (FTS, OR query, top 6). | Simplest thing that works with one database and a tiny corpus. | Weak on synonyms, follow-ups, non-English and multi-document questions. |
| AD-08 | **One non-streamed model call with strict structured output, validated before display.** | Never show unchecked fragments. | Slower perceived response; a formatting slip by the model is a hard error. |
| AD-09 | **Citations are evidence ids validated on the server**; the model may not emit URLs. | Links shown to users are always ones the system retrieved. | Proves ids resolve, not that the passage supports the claim. |
| AD-10 | **Entity-specific documents require the full entity name in the question.** | Stops a named-entity exemption being generalised to everyone. | Follow-up questions must repeat the name. |
| AD-11 | **Postgres is the job queue** (leases, `SKIP LOCKED`, dedupe keys, one running job per source). | No extra infrastructure. | Throughput is serial per source; job history is never pruned. |
| AD-12 | **Worker is a separate bounded `tick`** run by GitHub Actions every six hours, with only the database credential. | Free, isolated from model and auth secrets. | Scheduling is best-effort; combined with AD-06 it is a single point of failure for answers. |
| AD-13 | **Strict outbound allow-list** (four hosts, HTTPS, DNS validated in the connector, redirects re-checked, 8 MB, 25 s). | SSRF and DNS-rebinding defence; only official material enters. | Adding a source or raising the size limit is a code change. |
| AD-14 | **CBDT adapter is complete-or-fail.** | Silent truncation would look like full coverage. | Any upstream layout or taxonomy change blocks the whole source. |
| AD-15 | **Original bytes live in Postgres** under a cumulative budget. | One store, transactional with metadata. | Hard ceiling on corpus size until originals move to object storage. |
| AD-16 | **Google-only sign-in, database sessions, admin role re-read from the database on every admin request.** | Small surface; role changes take effect immediately. | Roles can only be changed in the database. Reviewer and publisher are the same role. |
| AD-17 | **Daily quota is an atomic counter** (10 per user, 1,000 per admin, IST day), reserved before the model call and refunded on error or refusal. | Bounded model spend without races. | Limits are constants in `lib/chat/turn.ts`. |
| AD-18 | **Conversations are server-owned; the client keeps nothing durable.** No provider thread ids. | Private text should not persist in the browser; no lock-in to a provider's thread store. | Reload loses the open chat unless reopened from `/chats`. |
| AD-19 | **Logs carry only the error type.** | Never log financial text, credentials or provider errors. | Production failures are hard to diagnose. |
| AD-20 | **Azure OpenAI only, endpoint shape validated, fail closed if unconfigured.** | No accidental fallback to another provider or key. | Changing provider means changing `lib/chat/model.ts`. |
| AD-21 | **Tests run real migrations on embedded Postgres (PGlite).** | Exercise the actual SQL without a database service. | Does not cover Neon latency or true multi-process concurrency. |
| AD-22 | **Review presets are hard-coded and pinned to a URL plus content hash.** | A preset must never apply to text nobody checked. | Each preset is a code change and a deploy; it does not scale beyond a handful. |
| AD-23 | **Scope is per document version** (one period or date range, one entity), except numbered FAQs. | Keeps the first review model simple. | Documents whose provisions have different dates cannot be represented. |
| AD-24 | **Jurisdiction fixed to central income tax.** | First release scope. | GST and state taxes need new adapters and a jurisdiction dimension. |
| AD-25 | **The model must not calculate tax, prepare forms or state uncited rates or deadlines.** | No deterministic rules engine exists to back numbers. | The most common consumer questions are refused by design. |

| AD-26 | **Extraction is a separate Python lab outside the web app**, exchanging versioned JSON bundles. | The PDF and OCR tooling is Python; parsers must not run inside web requests. | Two languages and two runtimes; the bundle schema is the contract between them. |
| AD-27 | **Every extraction result is source-bound**: original bytes, page render, glyph or line boxes, raw engine output, all hashed. | A reviewer can always compare text with the exact pixels it came from. | Large evidence sets per document; strict size limits. |
| AD-28 | **The lab never selects or repairs.** No engine wins, no confidence threshold clears a hold, no date or number is corrected by rule. | Measured cases show high-confidence wrong dates. | Every region needs a person; there is no autonomy by construction. |
| AD-29 | **OCR engines run locally with pinned weights**; documents are not sent to an OCR API from the lab. | No per-page cost; reproducible. | Needs a machine with Python, Node and model files; cannot run in a Vercel function. |
| AD-30 | **Staging is fully isolated**: separate Neon auth and review databases, separate object storage, guards that refuse the live database. | Review experiments must not touch live answers or user data. | A release adapter is required before any of this reaches users. |
| AD-31 | **Staging history is immutable and capability-gated**, independent of the app's `ADMIN` role. | Auditable decisions; a site admin is not automatically a qualified reviewer. | Two permission systems; schema applied outside Prisma. |
| AD-32 | **Two review gates: extraction acceptance, then tax applicability**, each bound to an exact revision. | Transcription quality and legal meaning are different skills. | A document needs two human passes before it can be released. |
| AD-33 | **OCR repair proposals come from the Azure chat model reading a crop**, returned for human recheck. | Fast to build; matched three reviewed fields in a probe. | The document path depends on a chat model. The owner has since decided against this (section 12). |
| AD-37 | **Unanswered questions are kept, anonymously, for the administrator.** `/admin/inbox` lists them with period and reason but no name, email or user id, and they are deleted with their conversation. The privacy policy says so. | The best signal for what to ingest next. | User text is read by a person; the wording in the privacy policy must stay accurate. |
| AD-39 | **Two review gates with separate roles** (text check, then tax review), enforced on the server, with roles granted explicitly and independent of `ADMIN`. | A transcription error and a legal misreading are different mistakes and need different people. | Every document needs two passes. The owner, as admin, must grant himself a role to review. |
| AD-40 | **Uploaded documents are fixed snapshots**, cited by their official address, never re-fetched and exempt from the freshness rule. | Many official PDFs are not on the listings the worker reads. | If the official copy later changes, nothing notices; re-upload to replace it. |
| AD-42 | **Lines the engine accepts need no decision, apart from a fixed spot-check sample; the passages the chatbot uses are rebuilt from the reviewed lines.** | Reviewer time goes to the lines rules could not settle; the sample catches a rule that is wrong. | The sample is small (five lines per document); a systematic error in accepted lines can slip past until the evaluation set measures it. |
| AD-43 | **The text check goes one line at a time, with a close-up of the original**, and moves on by itself after each choice. | The reviewer reads one line against its own pixels without hunting for it on the page; the old staging inbox worked this way and was faster to use than a list. | The whole page is a scroll away rather than beside the line; the list of all lines is only the *Jump to* menu. |
| AD-44 | **Large uploads go to Postgres in 3 MB parts and come back as a stream**, not to object storage. | Free, no new service or keys, and it keeps one place for originals while the corpus is small. | Originals count against Neon's free storage (0.5 GB) and the 128 MiB `TAX_MAX_ORIGINAL_BYTES` budget; moving originals to object storage (C7) is still the long-term answer. |
| AD-45 | **Staging review work is carried over by matching lines on text, and an accepted staging tax review becomes a draft, not a publication.** | Staging's regions and the engine's lines for the same file matched one for one (53 of 53 on Notification 1/2026), so a person's earlier checks need not be repeated; publishing changes the chatbot's answers and should be a live decision. | A line whose text differs between the two readings is not carried over and must be decided again; carried-over decisions are attributed to "Staging review", not a named person, because staging accounts are separate. |
| AD-46 | **Metadata is read by rules from the reviewed text and confirmed by a person before it is published**; passage headings and years are derived from the text a person accepted. | Years and numbers decide what the chatbot retrieves; a misread year would hide the right passage. Rules can point at the line they read, so checking is quick. | Rules miss unusual layouts (no proposal is shown then); passage-level years are not confirmed one by one, only through the accepted text and the tax review. |
| AD-47 | **Lines can be confirmed a page at a time, except those where mistakes hide**: rule-blocked lines, lines whose readings disagree, and single-reader OCR lines with numbers or low confidence. | Checking every line of a scan one by one would take the reviewers' whole day; plain wording read by one reader is rarely wrong in a way that changes meaning, while one wrong digit can. | On number-heavy scanned pages most lines still go one by one until a second OCR reader can settle them (M3). Bulk confirmation trusts the reviewer to read the page. |
| AD-48 | **A review is three plain steps, one at a time: check the words (every line, page by page), check the details (filled in from the document, read back as one sentence), published.** Lines that need a look come up as close-ups; the rest of a page is confirmed with one button. A line changed after acceptance rebuilds the passages by itself. Signatures and "Copy to" lists are left out of the chatbot's text; a reviewer can leave out any other line that is not part of the text. | The owner found the earlier screen (two mode switches, required versus optional lines, *Accept the text again*, a 16-field form) confusing, and future reviewers will be less technical (16 November 2026). Every line being checked is simpler to explain than "the lines the engine asks about", and confirming a page at a time keeps it affordable. | Supersedes AD-42's "lines the engine accepts need no decision" and AD-43's single-line mode: every line now needs a decision, so a long Act costs at least one click per page. The spot check shrinks to one line in twenty. Closing-line rules can misfire; the lines they leave out are shown greyed on the page with the reason. Laptop only for now. |
| AD-49 | **Chunks are built by rule from the reviewed document, along its own structure, and can be rebuilt at any time without a second review.** A paragraph is never cut inside a sentence or a word; a paragraph that runs onto the next page is joined; each chunk carries a metadata section (pages, heading path and paragraph, kind, years, provisions named). No language model is used for chunking or metadata (owner, 16 November 2026). | The owner found chunks cut through words and sentences: the old packer sliced long paragraphs every 2,000 characters and never joined a paragraph across a page break. A language-model extractor such as LangExtract was considered and declined: it would put a model into ingestion, against the rules-only decision. | Chunking rules can still misjudge where a paragraph ends (for example a title without capitals at the foot of a page); the reviewed document shown whole under *Behind the scenes* is where to spot it. Published chunks are not rebuilt automatically, since old answers cite chunk ids; a pending document gets new chunks whenever its text is accepted or a line changes. |
| AD-41 | **The extraction engine runs in GitHub Actions on a schedule**, pinned to a commit of its own repository, and writes only `ExtractionRun` rows. | Free for a public repository; Python and Tesseract cannot run in Vercel functions. | Up to two hours' delay before a new document has line boxes; "Run workflow" runs it at once. Upgrading the engine means changing `PDFANCHOR_REF`, after which everything pending is read again. |
| AD-38 | **The contact form writes to the database**, with a hidden spam field, 3 messages per sender per hour and 100 site-wide per hour. Messages appear in `/admin/inbox`. | Free, no e-mail service or key. | Nobody is notified of a new message; the admin has to look. |
| AD-34 | **The engine is a generic, standalone package**; tax-specific rules and the staging contract stay in the application. | It is meant to be published for others; the application should treat it as a black box producing `document.json`. | Two places to change during the port from the lab. |
| AD-35 | **The engine decides by rule**: a line is accepted only when validators pass and an independent reading agrees on every critical token. Engine confidence is never used. | The owner allows rules to accept; recorded cases show confidence is high on wrong dates. | "Accepted" means "passed every rule" until thresholds are measured on reference pages. |
| AD-36 | **Three outputs from one record**: `document.json` is canonical; Markdown and chunks are derived and carry page anchors and status. | Serves model reading, vector indexing and human review from the same evidence. | Consumers must filter on `status`; flagged text is included and labelled by default. |

Advisory lock ids in use: `740126` publication and draft saves, `740127` manual refresh (with a per-source hash), `74329018` storage budget, `740129` auth import.

## 9. Security and privacy posture

- Mutating routes require an `Origin` header equal to the `AUTH_URL` origin, a session, and a bounded JSON body.
- Conversation access always filters by `userId`; missing and not-owned both return 404.
- Admin API re-reads the role from the database on every call.
- Client-supplied provider identifiers (`threadId`, `previous_response_id`) are rejected.
- User text, history and evidence are declared untrusted in the prompt; an injection case is in the evaluation set.
- Model requests set `store: false`.
- Chat messages are stored in plain text in Postgres. The UI asks users not to paste PAN, Aadhaar or bank details, but nothing enforces it.
- Users can export or delete individual conversations. There is no account-level export or deletion.
- Secrets are environment variables only; the worker environment has no model or auth secrets.

## 10. Operations

**Environment variables** — `DATABASE_URL`, optional `DIRECT_URL` (migrations when using Accelerate), `AUTH_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AZURE_OPENAI_BASE_URL` (must end in `/openai/v1/`), `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_KEY`, optional `TAX_DISCOVERY_START_YEAR`, `TAX_MAX_ORIGINAL_BYTES`.

**Commands**

| Command | Purpose |
| --- | --- |
| `npm run dev` / `build` / `start` | Web app |
| `npm test` | Unit and integration tests (no external services) |
| `npm run lint`, `npm run typecheck` | Static checks |
| `npm run tax:worker -- init\|enqueue\|once\|drain\|tick\|run` | Register sources, queue, process one, process a batch, scheduled bounded run, continuous run |
| `npm run tax:health [-- --strict]` | Freshness, failures, queue and heartbeat report; non-zero if no fresh approved evidence or no heartbeat within 12 h |
| `npm run tax:probe` | Read-only live check of the registered sources |
| `npm run tax:evaluate [-- --live]` | The answer yardstick (`lib/tax/evaluation.ts`, cases in `evaluations/income-tax.json`): search alone by default (is the passage that answers each question found, at what rank; is nothing found where nothing should be; is another taxpayer's order kept out), or with `--live` also the model (answers or refuses correctly, cites the expected document, uses the expected words). Cases whose document is not published wait. Also the manual `Evaluate answers` workflow, search by default; live needs the `AZURE_OPENAI_*` secrets in the `tax-worker` environment. Logs show ids, results, ranks and counts only. |
| `Library list` workflow (`scripts/library-list.ts`) | Every document in the library as a numbered table: title, source, issue date, review status, official link. Read-only; the titles are public publications. |

**CI** — `.github/workflows/checks.yml` runs lint, tests, build and typecheck with placeholder configuration on pull requests and pushes to `main`. `.github/workflows/knowledge-worker.yml` runs the worker and health check on a six-hour cron when the repository variable `TAX_WORKER_ENABLED` is `true`, inside the protected `tax-worker` environment.

**Migrations** — Five ordered SQL migrations, applied with `prisma migrate deploy`. Never `migrate reset` or `db push --accept-data-loss` against Neon.

**Health** — `/api/health` is liveness only. Real health is the `tax:health` CLI.

## 11. What does not exist

Stated plainly, because several of these are easy to assume:

- **No OCR in the live path.** Live ingestion reads a PDF's embedded text layer only; a scanned PDF fails with "Extraction needs manual review" and is excluded. OCR exists in the lab and in `pdfanchor`, neither of which feeds the live library.
- **No automated pipeline from PDF to reviewed text.** The lab is about thirty hand-run commands; an operator runs them locally, assembles the bundle and imports it. Nothing is scheduled.
- **No automatic decision in the lab or staging.** No engine is selected, no page or region is accepted by rule. `pdfanchor` has a decision policy, but its thresholds are not calibrated and nothing consumes its output yet.
- **No path for scanned full pages into staging.** The staging contract accepts native full pages and image table bands only.
- **Staging is retired.** Its accepted work was carried into the live review records (R3); nothing else flows from it.
- **No measured extraction accuracy.** One official reference page is verified.
- **No model in the live ingestion or review path.** In the live review screen, metadata is typed by a person; the only automation is two presets hard-coded in `review-suggestions.ts`. In staging, the one model in the document path is the Azure chat deployment used by the OCR repair worker.
- **No embeddings or vector index.** Retrieval is keyword search.
- **No LangChain, LangGraph or agent framework.** The answer flow is about 130 lines in one route handler.
- **No streaming.**
- **No document upload, calculator, form schema, form filling or filing.**
- **No amendment, supersession or cross-reference links between documents.**
- **No un-approve, rollback or audit log** beyond `reviewedBy`, `reviewedAt` and the review note.
- **No Act or Rules in the corpus.** The registry covers circulars, notifications and one FAQ page; the Income-tax Rules, 2026 PDF exceeded the 8 MB cap.
- **No answer feedback, tracing, token or cost recording.**
- **No alerting.** A failed worker run only fails its workflow.

Unused leftovers: `src/sanity/client.ts` and the `@sanity/client` dependency; the three legacy columns on `User`.

## 12. Direction

**Owner decisions, 15 November 2026**

| Topic | Decision |
| --- | --- |
| Automation boundary | Rules only in ingestion. Rules may accept easy pages without a person; a person audits and decides what rules cannot. |
| OCR repair | Retire the Azure chat-model repair as the default; keep it in the code as a switched-off backup (AD-33). |
| Bilingual documents | Index the English text; keep Hindi as displayed evidence that does not block acceptance. |
| Hindi and Hinglish questions | Deferred, to avoid extra model charges. |
| Hosting | Pilot stays on free tiers: Vercel, Neon, GitHub Actions. The repository is public. |
| Audience and scope | Everyone and all tax material, as the destination. |
| Reviewers | The owner for extraction; a chartered accountant for tax applicability, one to two hours a day. |
| Extraction engine | Open-sourced as a separate library named `pdfanchor`, in [`pTidke/benzeneblack`](https://github.com/pTidke/benzeneblack). |
| Languages | Python for extraction, TypeScript for everything online. |
| Forms product | Parked. |

Workstreams that follow. Details, trade-offs and sequencing are in [`docs/improvement-areas.md`](docs/improvement-areas.md).

1. **Autonomous extraction.** Bring the lab's capabilities into `pdfanchor`, run it on a schedule, and have people review only what its rules flag, so the chat model and the hand-run operator steps leave the loop. Then connect accepted extractions to the live library.
2. **Knowledge store and orchestrated answers.** Structure-aware nodes instead of character-count chunks, hybrid lexical plus vector retrieval with reranking, document relationships, and a LangGraph answer graph that keeps AD-01, AD-08 and AD-09 as explicit nodes.
3. **Forms product (parked).** A separate application on shared foundations, to be designed later.

## 13. Glossary

| Term | Meaning |
| --- | --- |
| FY | Financial year, 1 April to 31 March. The year income is earned. |
| AY | Assessment year. The year after the FY, in which that income is assessed. AY 2027-28 assesses FY 2026-27. |
| TY | Tax year. Introduced by the Income-tax Act, 2025 from 1 April 2026; covers the same April–March span as the FY. |
| CBDT | Central Board of Direct Taxes. Issues circulars and notifications. |
| Circular / Notification | CBDT instruments. Notifications are usually published in the Gazette; many name a specific entity. |
| Evidence | Chunks returned by retrieval and shown to the model as `S1…S6`. |
| Release | A `KnowledgeRelease` row: the full list of approved version ids at a point in time. |
| Fresh | A document whose last successful fetch is within 48 hours. |
| Scope | The review metadata that decides when a version may be retrieved: period or date range, entity, legal status. |

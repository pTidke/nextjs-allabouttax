# All About Tax — brain

Single source of truth for what this platform is, how it is built, and why it is built that way.
Read this before changing architecture. Update it in the same change whenever a decision here stops being true.

- Verified against commit `d3025cb` on 15 November 2026 by reading every tracked source file and running the test suite (34/34 passing on Node 22.23).
- Production figures (user counts, corpus counts) are quoted from `docs/` as of 4 November 2026; they were not re-read from the live database.
- Improvement areas and the forward architecture live in [`docs/improvement-areas.md`](docs/improvement-areas.md). This file describes what exists.

---

## 1. What the product is

An AI assistant for the Indian tax system, live at https://www.allabouttax.in.

Today it is one feature: a signed-in chatbot that answers central income-tax questions **only** from official documents that an administrator has reviewed and published, for a tax period the user selects, with citations back to the official source. If the reviewed library does not cover the question, it says so instead of answering from model memory.

The intended direction is broader:

1. A document-processing pipeline that reads official PDFs (including scanned ones) without a person in the loop.
2. A richer knowledge store and an orchestrated retrieval flow so answers are more accurate and better cited.
3. A separate product that helps people fill government tax forms in real time.

None of those three exist in the code yet. Section 11 lists precisely what is and is not built.

## 2. Current state in one table

| Area | State |
| --- | --- |
| Chatbot | Live. Evidence-only answers, period-scoped, cited, non-streaming. |
| Corpus | Very small. Docs record 1 approved document version and ~155 pending review (4 Nov 2026). |
| Sources | CBDT circulars, CBDT notifications (current calendar year only), one e-filing FAQ page. |
| PDF handling | Text-layer extraction only. **No OCR.** Scanned or >8 MB PDFs are rejected. |
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
evaluations/income-tax.json   six evaluation cases
tests/                        unit and PGlite integration tests
docs/                         deployment, release plan, tax foundation, improvement areas
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
| `TaxChunk` | A retrievable passage | `anchor` (for example `Page 3, passage 2` or `FAQ 9`) and `text`. GIN index on `to_tsvector('english', text)`. |
| `KnowledgeRelease` | A published manifest | Monotonic `sequence`, full `versionIds[]` array, `createdBy`. |
| `TaxReviewDraft` | A reviewer's private, incomplete form | Keyed by `(versionId, userId)`, optimistic `revision`. |

**Pipeline** — `IngestionJob` (Postgres-backed queue: `dedupeKey`, `status`, `attempts`, `availableAt`, `leaseUntil`, `leaseToken`, optional `documentUrl`) and `TaxWorkerState` (single `ingestion` heartbeat row).

**Conversations** — `TaxConversation` (`userId`, fixed `period`), `TaxMessage` (`role`, `content`, `citations` JSON, `releaseId`, `model`, `promptVersion`), `DailyUsage` (`userId`, IST `day`, `count`).

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

### 7.2 Review and release (admin)

The admin page lists the latest `PENDING` versions ten at a time, with the extracted text, any saved draft, and (for two specific documents) a hard-coded preset.

Approving requires: selected sections, document type, legal status, period mode, effective-from date, and a note. `validateReview` enforces date sanity, period overlap, and the entity and investment-window rules. Inside one transaction under advisory lock `740126`, `reviewVersion`:

- refuses anything that is not the latest `PENDING` version of its document;
- if a subset of FAQ sections was selected, **replaces** the version's chunks with only those sections;
- writes the review metadata and sets `jurisdiction = 'IN-CENTRAL'`;
- creates a new `KnowledgeRelease` whose `versionIds` is the previous manifest minus every version of this document, plus this one if approved.

Section-level selection exists only for consecutively numbered FAQ pages (`review-sections.ts`). Everything else is reviewed and scoped as a whole document.

### 7.3 Retrieval (`retrieval.ts`)

One SQL query against the latest release. A chunk is eligible only if all of these hold:

- its version is in the release manifest, `APPROVED`, legal status `EFFECTIVE` or `GUIDANCE`, jurisdiction `IN-CENTRAL`;
- period matches: `SINGLE_PERIOD` requires the stored period string to equal the user's selected string exactly; `MULTI_PERIOD` requires an applicability note;
- effective dates overlap the selected period's April–March range;
- if the version names an entity, the user's question contains that full normalised name;
- the version is still the document's latest, the document was fetched successfully within 48 hours, and neither the document nor its source has an error.

Matching is `to_tsquery('english', …)` over up to 24 lower-cased question terms joined with OR, ranked by `ts_rank_cd`, top 6.

### 7.4 Answer generation (`api/assistant/route.ts`, `lib/chat/*`)

1. Same-origin check, session check, input validation (message ≤ 6,000 characters, valid period, body ≤ 16 kB).
2. Load the conversation if an id was sent; it must belong to the user and have the same period.
3. Retrieve evidence. **If none, return a fixed limitation message immediately**: no model call, no quota use, nothing saved.
4. Reserve one question from the daily quota (atomic upsert keyed on the IST date).
5. Create the conversation if needed, load the last 8 messages as history.
6. Call the model once: `instructions` (prompt version `tax-evidence-v3`), a JSON payload of question, period, history and evidence (each passage labelled `S1…S6` with its scope metadata), strict JSON schema output `{answer, supported, sourceIds, suggestions}`, `store: false`, 2,200 max output tokens, 40 s timeout, no retries.
7. `validateAnswer`: reject URLs or markdown links in the text; every `[S#]` marker must be a declared source id and every declared id must appear as a marker; a supported answer must cite something. If `supported` is false the model text is discarded and a fixed refusal is returned. A "Source status: Official guidance […]" line is appended by the server for cited guidance.
8. Save the user and assistant messages in one transaction with citations, release id, model and prompt version. On any failure after step 4 the quota is refunded.

The response is returned whole; nothing is streamed.

### 7.5 Client

`ChatContext` holds chat state in memory only (never `localStorage`) and is remounted when the signed-in identity changes. The chat opens as a full-screen dialog from a floating widget on every page. The user must pick a period (FY, AY or TY × five years) before sending; changing it starts a new chat. `/chats` lists, reopens, exports (streamed JSON) and deletes conversations. `/library` and the in-chat coverage notice show which released documents are currently available for a period.

## 8. Architectural decisions

Each entry records the decision, the reason, and the consequence that matters for future work.

| # | Decision | Why | Consequence |
| --- | --- | --- | --- |
| AD-01 | **Evidence-only answers; fail closed.** No evidence means a fixed limitation, never model memory. | Wrong tax advice is worse than no answer. | Usefulness is capped by corpus size and retrieval recall. |
| AD-02 | **Human approval gate.** Refresh and discovery never approve anything. | An imported notification is not automatically applicable law. | Review throughput is the bottleneck on coverage. |
| AD-03 | **Immutable originals with content-hash versions.** Changed content becomes a new `PENDING` version and the old approval stops being eligible. | Old approvals must not silently carry over to changed text. | Any change to a document removes it from answers until re-reviewed. Version identity is also tied to extractor output for HTML. |
| AD-04 | **Releases are full, numbered manifests** created under one advisory lock. | Every answer can record exactly which knowledge set produced it (`TaxMessage.releaseId`). | Retrieval still also checks live flags, so a release is not a pure snapshot. No rollback action exists. |
| AD-05 | **The user states the tax period; one period per conversation.** | Tax rules are period-specific and the model must not guess. | Extra step before the first question; period labels are matched as strings. |
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
| AD-17 | **Daily quota is an atomic counter** (10 per user, 1,000 per admin, IST day), reserved before the model call and refunded on error. | Bounded model spend without races. | Limits are constants in the route handler. |
| AD-18 | **Conversations are server-owned; the client keeps nothing durable.** No provider thread ids. | Private text should not persist in the browser; no lock-in to a provider's thread store. | Reload loses the open chat unless reopened from `/chats`. |
| AD-19 | **Logs carry only the error type.** | Never log financial text, credentials or provider errors. | Production failures are hard to diagnose. |
| AD-20 | **Azure OpenAI only, endpoint shape validated, fail closed if unconfigured.** | No accidental fallback to another provider or key. | Changing provider means changing `lib/chat/model.ts`. |
| AD-21 | **Tests run real migrations on embedded Postgres (PGlite).** | Exercise the actual SQL without a database service. | Does not cover Neon latency or true multi-process concurrency. |
| AD-22 | **Review presets are hard-coded and pinned to a URL plus content hash.** | A preset must never apply to text nobody checked. | Each preset is a code change and a deploy; it does not scale beyond a handful. |
| AD-23 | **Scope is per document version** (one period or date range, one entity), except numbered FAQs. | Keeps the first review model simple. | Documents whose provisions have different dates cannot be represented. |
| AD-24 | **Jurisdiction fixed to central income tax.** | First release scope. | GST and state taxes need new adapters and a jurisdiction dimension. |
| AD-25 | **The model must not calculate tax, prepare forms or state uncited rates or deadlines.** | No deterministic rules engine exists to back numbers. | The most common consumer questions are refused by design. |

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
| `npm run tax:evaluate [-- --live]` | Retrieval preflight, or live model evaluation of the six cases |

**CI** — `.github/workflows/checks.yml` runs lint, tests, build and typecheck with placeholder configuration on pull requests and pushes to `main`. `.github/workflows/knowledge-worker.yml` runs the worker and health check on a six-hour cron when the repository variable `TAX_WORKER_ENABLED` is `true`, inside the protected `tax-worker` environment.

**Migrations** — Five ordered SQL migrations, applied with `prisma migrate deploy`. Never `migrate reset` or `db push --accept-data-loss` against Neon.

**Health** — `/api/health` is liveness only. Real health is the `tax:health` CLI.

## 11. What does not exist

Stated plainly, because several of these are easy to assume:

- **No OCR.** There is no OCR engine, model or service anywhere in the code. PDFs are read through their embedded text layer only. A scanned PDF fails with "Extraction needs manual review" and is excluded.
- **No model in the ingestion or review path.** No LLM reads, classifies or summarises documents. Review metadata is typed by a person. The only automation is two presets hard-coded in `review-suggestions.ts`.
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

Three workstreams follow from the owner's goals. Details, trade-offs and sequencing are in [`docs/improvement-areas.md`](docs/improvement-areas.md).

1. **Autonomous document intelligence.** Replace "text layer or fail" with a staged pipeline: page classification, text-layer extraction with quality gates, OCR for pages that fail them, structure parsing, machine-proposed metadata with provenance, and a publish policy. No interactive chat assistant in the loop.
2. **Knowledge store and orchestrated answers.** Structure-aware nodes instead of character-count chunks, hybrid lexical plus vector retrieval with reranking, document relationships, and a LangGraph answer graph that keeps AD-01, AD-08 and AD-09 as explicit nodes.
3. **Forms product.** A separate application on shared foundations: versioned official form schemas, a deterministic rules engine, document import through the same pipeline, an interactive filling session, and a dedicated store for sensitive personal data.

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

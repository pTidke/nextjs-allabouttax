# Tax knowledge foundation — first implementation

This milestone replaces the retired Assistants flow and adds a reviewable official-document pipeline. It does not implement tax calculations, document uploads, form drafting, GST coverage, complete historical CBDT coverage, or automatic filing.

## Included

- Responses API with strict structured output, evidence ID validation, explicit model configuration and `store: false`.
- Server-owned conversations, authenticated user checks, atomic daily quotas with India-time boundaries, error handling and bounded request bodies.
- Explicit FY/AY/TY selection. Answers use only a reviewed release and matching central-income-tax period. Empty, stale, failed, changed or unsupported evidence yields a limitation, never a model-memory fallback.
- Immutable original document bytes, hashes, extracted passages, reviewed type/status/date metadata, and monotonically numbered release manifests.
- HTML and text-PDF extraction. Scanned PDFs without usable text fail for manual handling; OCR is not implemented.
- Review and source-health interface at `/admin/knowledge`, restricted to existing ADMIN users with a fresh database role check on every API request.
- PostgreSQL refresh jobs: manual and scheduled enqueue, deduplication, leases, recovery, retries/backoff and terminal failure. A separate worker executes fetches.
- HTTPS exact-host allowlist, per-connection DNS validation, redirect checks, response size and timeout limits.
- Clickable citations that survive rendering and copy, with source URL, passage/page, checked time, period and version identity.

The model response is displayed only after structured-output and citation checks complete. This first implementation intentionally uses a complete JSON response instead of streaming unchecked fragments. Citation checks establish that IDs resolve to retrieved evidence; they do not prove semantic correctness. Tax-reviewer evaluations remain necessary.

## Database setup

The Neon POC database is configured and migrated. Unit/integration tests use disposable embedded PostgreSQL (PGlite) and the real Prisma repository code. PGlite does not replace production testing of remote latency and multiple concurrent worker processes.

There were no tracked migrations in the original project. Five migrations are included:

1. `202609270001_baseline`: the original auth/user schema.
2. `202609270002_tax_foundation`: additive knowledge, job, conversation and usage tables; full-text index; one-active-job-per-source index.
3. `202609280001_tax_worker`: independent document jobs, document error/issue-date metadata, and worker heartbeat.
4. `202609290001_tax_applicability`: multi-period scope, entity restriction and investment window metadata.
5. `202611040001_review_drafts`: private reviewer drafts, revision checks and cascade cleanup.

Use Node.js 22.19+ (or a supported newer release); validation here used Node.js 26.9.

For a NEW empty development database, configure `.env.local` using `.env.example`, then run:

```sh
npm install --legacy-peer-deps
npx prisma generate
npx prisma migrate deploy
npm run tax:worker -- init
npm run tax:worker -- enqueue
npm run tax:worker -- once
npm run dev
```

The repository already has peer dependency conflicts, so installation currently uses `--legacy-peer-deps`; revisit those before release. The Prisma CLI and client are aligned by the lockfile.

For an EXISTING database, back it up and compare its schema against the baseline before baselining. Only if the original schema matches, mark the baseline applied using `npx prisma migrate resolve --applied 202609270001_baseline`, then run `npx prisma migrate deploy`. Do not execute the baseline SQL against a database that already has those tables. Never use `migrate reset` or `db push --accept-data-loss` as a shortcut. When using an Accelerate URL, provide a direct PostgreSQL `DIRECT_URL` for migrations.

The original local edits and deleted legacy chat route were preserved. No existing user conversation records or browser storage were deleted. The new chat does not import or continue retired provider thread IDs. New messages are stored on the server; closing or starting a chat clears the view only. The client holds current chat state in memory, keyed to signed-in identity.

## Model and authentication

Keep existing Google authentication and API credentials in local/deployment environment variables. The assistant now uses Azure OpenAI v1 with deployment `gpt-5.6-luna`. Set `AZURE_OPENAI_BASE_URL=https://pr-allabouttax-resource.openai.azure.com/openai/v1/`, `AZURE_OPENAI_DEPLOYMENT=gpt-5.6-luna`, and `AZURE_OPENAI_API_KEY` in `.env.local` and the hosting environment. Use the Azure resource key, not the previous direct OpenAI key. These are server-only variables. The resource endpoint must include `/openai/v1/`; the Foundry project URL is not accepted by this integration. No dated API version is needed. Missing Azure configuration fails closed; old `OPENAI_API_KEY`, `OPENAI_MODEL`, and `OPENAI_BASE_URL` settings are not used by the assistant. The existing SDK supports this v1 request shape.

Azure configuration and the first cited FAQ answer have been exercised in the POC. Mocked SDK tests verify request shape; a successful example does not establish broad answer quality. Restart the development server after changing credentials or regenerating Prisma client code. An answer requires an approved, fresh knowledge release.

Reference: https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle?tabs=key

Sign in with an existing ADMIN account to access the knowledge interface. The user-authorized administrator account has been configured in Neon. The admin page is not exposed through public navigation.

## First source-to-answer exercise

1. Register starter sources in the admin screen or through `tax:worker init`.
2. Queue the Income Tax Department transition FAQ and run the worker.
3. For the transition FAQ, click **Prepare FAQ 9 review**. This selects only FAQ 9 and proposes GUIDANCE, TY 2026-27 and an effective start of 2026-04-01; publication and end dates remain blank. Inspect the displayed excerpt and the original source, then approve the selected sections. The suggestion is tied to the exact source URL and SHA-256 of the checked passage; source changes remove it. Other selections require their own reviewed metadata. The server rejects empty/unknown selections and dates that do not overlap the selected period.
4. Approve and publish. A new immutable release records the full set of approved version IDs.
5. Select exactly that reviewed period in chat and ask a question addressed by a passage.
6. Follow the source citation and compare the answer with the original.
7. Refresh the source after a material correction: the old version stops being eligible until the latest version is reviewed.

A review now chooses `SINGLE_PERIOD` (an explicit FY/AY/TY identifier) or `MULTI_PERIOD` (all income periods overlapping the reviewed effective dates, with a mandatory applicability explanation). Existing approvals retain exact period matching. Multi-period is appropriate only when the reviewer establishes that scope; it is not automatic applicability to every transaction or a substitute for reviewing amendments and the 1961/2025 transition. FAQ sections can still be selected separately; documents whose provisions need different dates must be split into reviewed scopes before ingestion. Original bytes/text remain immutable and approval indexes only selected sections. Published versions remain immutable in the review UI.

`effectiveTo` is exclusive and means rule/scope expiry. Optional `investmentFrom` and `investmentThrough` describe a separate inclusive investment-entry window; the latter never becomes an expiry or retrieval cutoff. Both investment dates and an applicability explanation are required together. Continuing obligations can therefore remain retrievable after the last eligible investment date. FY/TY cover April–March; AY maps to the preceding income year.

Optional `entityName` restricts retrieval to questions containing the full reviewed legal name, ignoring case and punctuation and matching word boundaries. Partial names and pronouns do not infer identity; follow-up questions must repeat the name. Filtering happens before ranking/limit, and scope metadata is passed to the model. This prevents unnamed/general questions from retrieving entity-specific exemptions, but semantic answer correctness still requires evaluations.

Notification 1/2026 has a draft preset tied to its exact extracted-text hash and official URL. It fills NOTIFICATION, across-period scope, Inbar Holding RSC Limited, and the 2030-03-31 inclusive investment cutoff. Status, publication, commencement and investment start remain unfilled for review; it does not publish or infer Gazette publication from the instrument date. See the source and confirm current legal/transition status before approval. No live notification was approved as part of this change.

Migration `202609290001_tax_applicability` adds nullable scope fields and a single-period default without changing existing approvals. Run `prisma migrate deploy` and regenerate Prisma before restarting the app and worker.

The lookup uses PostgreSQL full-text search and exact period/status filtering. It is lexical retrieval; vector retrieval and reranking are follow-up work. Six passages are selected. Synonyms, short follow-ups and queries requiring several interacting instruments need further retrieval evaluation.

## CBDT discovery and refresh worker

The circular and notification adapters use the same public guest search API and Year taxonomy used by the official website. No login or private administration API is used. The guest CSRF token is read from public HTML, restricted to the exact public endpoints, and never stored or logged. Redirects on JSON endpoints are rejected.

Live discovery on 28 September 2026 found 6 circulars and 128 notifications issued in 2026, across all seven notification pages. Listing titles and instrument issue dates are preserved. Tax applicability is still assigned by a reviewer; issue year is not an assessment/tax year.

The initial live import stored 132 documents pending review, preserving the previously approved FAQ. Two documents require follow-up: Notification 116/2026 returned unusable HTML, and Notification 22/2026 (Income-tax Rules, 2026) exceeds the 8 MB response limit. Neither is available to chat. Stored originals total about 55 MiB. The review screen pages through ten current pending versions at a time; obsolete pending versions are excluded before pagination.

`TAX_DISCOVERY_START_YEAR` defaults to the current calendar year. Within this window the adapter validates totals, pages, repeated IDs, allowed document URLs, and issue years. It fails visibly if an unsupported record, changed layout, incomplete page sequence or missing year filter prevents coverage verification. Up to 100 pages per year and an eight-minute discovery budget are supported. This is not complete historical coverage: register older official documents individually, or deliberately expand the issue-year window after checking storage capacity. A future year missing from the official taxonomy blocks that source until the official listing supports it.

Discovery creates separate document jobs. An unavailable or scanned PDF records its own error and is excluded from retrieval; it does not poison other successfully fetched documents. Listing discovery failures block that source's retrieval. Downloaded originals remain immutable; changed content at the same URL becomes pending and disqualifies the previous approved version. Identical content preserves the approved scope and selected chunks. Replacements at different URLs and cross-document legal amendments still require reviewer-managed applicability; automatic amendment relationships are not implemented.

Original bytes have a 128 MiB cumulative budget (`TAX_MAX_ORIGINAL_BYTES`) in Postgres, serialized with a database lock. This is not a total database size cap: chunks, indexes, chats and job history also consume space. Per-response downloads remain capped at 8 MB. Move originals to object storage and add retention policies before broad archive ingestion. Scanned or oversized documents require a subsequent OCR/document-processing milestone.

Freshness remains 48 hours since a successful document fetch. New evidence is never automatically approved.

### Run locally

```sh
npm run tax:worker -- run
```

Keep this in a separate terminal alongside `npm run dev`. It schedules one refresh per enabled source per UTC day, processes manual requests, retries failures, and wakes once a minute. On Sunday it performs reconciliation instead of the daily run; if Sunday was missed, it catches up on the next invocation. Daily discovery rechecks new/failed and approved documents; weekly/manual runs re-fetch every known original, including pending content and documents outside the discovery window. SIGINT/SIGTERM finishes the current job and exits. The admin page shows worker heartbeat, queue counts, listing health, individual document failures and results. A heartbeat is evidence of a recent worker check, not proof a hosting scheduler is installed.

### Deploy the worker

Run `npm run tax:worker -- tick` from a **separate scheduled job** every 15 minutes, using the same deployed code and Neon database. Each invocation schedules due daily/weekly work and processes at most 150 jobs or eight minutes between jobs; a single slow job may extend that limit. Give the host job at least a 20-minute timeout. Use a host service/job rather than a chat API route. Configure its environment with `DATABASE_URL`, optional `DIRECT_URL`, and the tax ingestion settings; it needs no model API key or Google auth credentials. Run `npm ci --legacy-peer-deps`, Prisma generation, and migrations during deployment. Use one worker initially and monitor throughput against the 48-hour freshness threshold.

`tick` exits when its budget or due queue is exhausted. The next invocation continues the queue. `run` is an alternative for a continuously hosted service, with graceful shutdown. Continuous polling uses database compute; an on-demand scheduled job is preferable for the free POC. No cloud scheduler or container service has been provisioned in this change; local commands alone do not keep updating when the computer is asleep.

Other commands: `init` registers sources; `enqueue daily|weekly` explicitly queues a dated batch; `once` processes one due job; `drain` processes a bounded batch without scheduling. Daily keys are stable per source/date. Manual refreshes reuse any queued/running work for the source across browser tabs and minute boundaries; completed source scans have a five-minute cooldown. Reload status performs only a read, preserves the current review page, and displays a completion timestamp. Active document jobs are reused. Lease tokens prevent an expired worker from committing downloaded evidence after another worker takes over. Failed jobs retry up to three attempts with backoff, then remain visible; a new manual source refresh retries exhausted document jobs.

Before launch, configure alerts for missing worker heartbeats, overdue source/document checks, terminal failures, queue age and storage usage. Job history currently has no automatic pruning. No tax review or approval is automated.

## Validation

```sh
npm test
npm run typecheck
npm run tax:probe
npm run build
```

The tests execute the actual migrations and repositories on disposable PostgreSQL, exercising approval, correction, period matching, expired evidence, source failures, proposals, leases, idempotency, ownership, concurrent quotas and extraction/citation/request validation. Live source probes are read-only and require no API key or database.

The production build was successfully rechecked on 4 November 2026. The earlier local native dependency blocker no longer reproduces. Next.js and the fetch client have been updated after a dependency audit. Standalone output and prepared Linux CI/container builds are described in `docs/deployment.md`; do not treat them as deployed until the host checks pass.

Review cards now have an explicit Save draft action. Drafts are private to the reviewer, incomplete fields are allowed, and concurrent saves are checked using a revision. Publication still requires the full review validation. The public source library and chat coverage notices count only currently eligible released documents. Account-scoped `/chats` supports reopening, streamed full JSON export, and explicit permanent deletion.

Public marketing and FAQ text now describe current capabilities and avoid hard-coded tax-news/rate claims. See `docs/release-plan.md` for the remaining launch work.

## Follow-up work

Add OCR and historical archive coverage; add section-level applicability and amendment relationships; add semantic retrieval/evaluations; supply delete/retention controls for server-side chats; implement rollback and reviewer audit UX; monitor ingestion; test live model output and browser flows; then build supported calculators and draft forms. The updated public copy describes bounded coverage; final owner review remains part of launch.

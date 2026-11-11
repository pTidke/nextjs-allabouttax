# All About Tax — release plan

Updated 4 November 2026. This is a development status record, not a claim of complete tax coverage.

## First release

Start with a source-backed central income-tax assistant for individuals. The audience choice is still awaiting the owner's response; salaried individuals are the working assumption. The first release must show actual coverage and decline unsupported questions. Broader Indian-tax coverage and draft filing workflows remain part of the product objective.

## Implemented

- Azure-hosted model integration, approved-evidence retrieval, citation validation and explicit FY/AY/TY selection.
- Neon migrations, Google authentication, role checks, conversation ownership and daily model quotas.
- Official HTML/text-PDF ingestion, document hashes/versioning, source refresh jobs and independent retries.
- Admin review of selected passages, across-period scope, entity restrictions and separate investment-entry windows.
- Saved private review drafts with revision checks; saving does not approve or publish.
- Source-library page and per-period coverage notice; stale/unapproved material stays unavailable.
- Conversation list/reopening, complete streamed JSON export, and owner-only permanent deletion.
- Corrected public pages to describe implemented features; removed hard-coded unsourced tax-news and tax-answer claims.
- Standalone deployment target, liveness endpoint, worker health CLI, CI workflow and opt-in scheduled-worker workflow.
- Small public-question answer-evaluation dataset using the same generator as production. This is an initial regression suite, not broad tax validation.

## Release gates

1. **Content:** review a useful starter set covering the supported individual-tax questions and periods. The database check at the start of this session found one approved version and 133 pending. The first cloud refresh increased the pending set to 155 versions. An imported notification is not automatically usable law. Establish Gazette dates, current status, transition provisions and section scope before publication.
2. **Quality:** run the small live evaluation, record failures, then expand to at least 50 representative tax-reviewer-labelled cases with source passages and expected refusals. Require review of answer correctness and citation support, beyond ID validity.
3. **Operations:** Linux CI and two manually dispatched GitHub worker runs passed. The six-hour schedule is configured, but its first automatic invocation is not yet observed. Configure independent missed-schedule alerts and confirm an automatic run.
4. **Deployment:** the existing host is Vercel (`allabouttax`, www.allabouttax.in). Azure credentials are configured for production/preview. Preserve the eight existing authentication accounts before changing its database to Neon; the tested import plan adds seven accounts and matches the existing admin. Confirm database backup/recovery and the Google callback URL. Test sign-in, admin access, chat, export and deletion in staging. Review the service's privacy/terms copy before public launch.
5. **Coverage gaps:** implement bounded large-document processing and OCR with suitable original-file storage; build historical and amendment relationships rather than expanding the discovery window blindly.
6. **Draft filing:** confirm the first form and assessment/tax year. Add eligibility checks, its versioned official schema, deterministic calculations, field validation and a human-review/export step. Sensitive personal filing data needs its own storage/retention design. No current feature produces an ITR or submits a return.

## Subsequent milestones

- Hybrid/semantic retrieval, better follow-up context and reranking measured against the evaluation set.
- Cross-document amendment/repeal relationships and several reviewed scopes per instrument.
- Auditable approval withdrawal/rollback and reviewer audit history.
- More personal-tax topics and periods; later separate GST adapters and evaluation datasets.
- A supported form workflow, then narrowly scoped calculators and additional forms.
- Usage/cost dashboards, account-level export/deletion and configurable retention.

## Verification recorded

- Linux CI passed lint, isolated tests, the production Next build and type checks for the release branch before the account migration utility was added.
- Local tests including account preservation/conflict rollback now pass (34 tests); six bounded live Azure answer evaluations passed.
- GitHub's protected `tax-worker` environment, encrypted database secret and opt-in variable are configured with owner approval. The workflow is on main and two cloud dispatches passed; automatic schedule execution remains to be observed.
- The owner approved account migration and Neon cutover. Seven users and seven provider accounts were imported, one existing admin matched, and all eight users are present in Neon. The old database was unchanged. Vercel production/preview database settings now point to Neon; the new production deployment is live. Public endpoints passed smoke checks, and the owner confirmed Google sign-in and a cited Azure answer.

## What is not complete

The entire original product is not complete. The code foundation and a bounded assistant are implemented; tax coverage, operational sign-off, large/scanned-file handling, semantic retrieval and statutory draft forms remain release work. Do not market the current corpus as answering every tax question.

## PDF pipeline update — 11 November 2026

The isolated lab now supports source-bound table reconstruction, explicit blank-cell edits and recoverable local revisions. Owner feedback confirms a narrow set of investment-form blanks; it does not accept the complete table or its legal meaning. A frozen four-page transfer trial on two fresh originals retained all eight image-provider attempts and found critical condition/choice-label omissions despite plausible grids. Table and script coverage, complete references and authenticated review remain open.

[PDF staging handoff](pdf-staging-handoff.md) now fixes the next implementation sequence: import envelope/validator and clean/blocked fixtures, authenticated extraction review, separate tax applicability decisions, then dry-run retrieval manifests. This is a design and lab-evidence increment; the current production ingestion, database and assistant are unchanged.

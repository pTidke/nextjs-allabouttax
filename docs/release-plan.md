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

1. **Content:** review a useful starter set covering the supported individual-tax questions and periods. The database check at the start of this session found one approved version and 133 pending. An imported notification is not automatically usable law. Establish Gazette dates, current status, transition provisions and section scope before publication.
2. **Quality:** run the small live evaluation, record failures, then expand to at least 50 representative tax-reviewer-labelled cases with source passages and expected refusals. Require review of answer correctness and citation support, beyond ID validity.
3. **Operations:** run CI on Linux, activate the chosen cloud worker, configure failure notifications, and confirm a successful scheduled run after local machines are stopped. A prepared workflow is not a deployed scheduler.
4. **Deployment:** choose the web host, configure runtime-only credentials, database backup/recovery and Google callback URL. Test sign-in, admin access, chat, export and deletion in staging. Review the service's privacy/terms copy before public launch.
5. **Coverage gaps:** implement bounded large-document processing and OCR with suitable original-file storage; build historical and amendment relationships rather than expanding the discovery window blindly.
6. **Draft filing:** confirm the first form and assessment/tax year. Add eligibility checks, its versioned official schema, deterministic calculations, field validation and a human-review/export step. Sensitive personal filing data needs its own storage/retention design. No current feature produces an ITR or submits a return.

## Subsequent milestones

- Hybrid/semantic retrieval, better follow-up context and reranking measured against the evaluation set.
- Cross-document amendment/repeal relationships and several reviewed scopes per instrument.
- Auditable approval withdrawal/rollback and reviewer audit history.
- More personal-tax topics and periods; later separate GST adapters and evaluation datasets.
- A supported form workflow, then narrowly scoped calculators and additional forms.
- Usage/cost dashboards, account-level export/deletion and configurable retention.

## What is not complete

The entire original product is not complete. The code foundation and a bounded assistant are implemented; tax coverage, cloud deployment, operational sign-off, large/scanned-file handling, semantic retrieval and statutory draft forms remain release work. Do not market the current corpus as answering every tax question.

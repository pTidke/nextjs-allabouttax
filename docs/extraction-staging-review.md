# Isolated extraction review

Implemented 11 November 2026; disabled by default. This is an extraction-review increment, not a production ingestion migration. No real reviewer grants, Neon schema changes or Vercel environment changes are part of local verification.

## What is implemented

`/staging/extraction` uses existing NextAuth sign-in and a separate database-backed `EXTRACTION_REVIEW` grant. Server routes derive the actor from the authenticated session; a browser cannot supply their identity, capability, filesystem path or approval flags. `ADMIN` does not imply access. Grants are operator-only, reasoned, expiring (at most 90 days) and audited; no self-assignment or tax grant endpoint exists.

The staging database stores immutable candidates and review revisions in its own `extraction_staging` schema. Revisions bind the actor, server time, exact candidate, parent, request identity, source checks and decision reason. Postgres transactions lock the candidate and recheck grants and the expected parent. Retry identities return the original revision; changed retry bodies and stale parents conflict. A browser retains unsaved notes per user/candidate and supports export; on a conflict the reviewer must preserve notes and explicitly load the latest revision. Local browser storage is convenience recovery, not authenticated review history. Use this first version with public official documents only, not private taxpayer records.

Source reads and decisions rehash the registered evidence, including original, render, raw outputs, context and prior feedback. Only a candidate's original PDF or rendered source pages can be downloaded through authenticated no-cache routes. Arbitrary paths, alternative objects and foreign candidate IDs cannot fetch files. Original PDFs download as attachments. The object adapter refuses symlinks/nonregular files, bounds reads and checks exact hashes. Filesystem operators remain trusted; it is not a parser sandbox or substitute for cloud object retention policies.

Acceptance requires an eligible native page scope, no blocking holds, every region checked, reading order/context/critical-character checks and a decision reason. Table scopes remain held in this first slice. A later saved draft or corrections request becomes the new unaccepted head; old acceptance remains in history. No method writes `TaxVersion`, `TaxChunk`, a tax approval, a release manifest or an index. Every response keeps `taxApproved` and `publicationEligible` false. Transcription edits require a newly validated lab revision and operator import; this screen records review findings only.

## Prepare an independent environment

1. Select a separate Neon development branch/database (or isolated local Postgres). Do not point this at the live database. Configure existing sign-in for the intended staging host separately; do not create a public authentication bypass. A local durable evidence directory requires a Node server with private persistent disk; Vercel's ephemeral filesystem is not a durable evidence backend. Managed object storage and its cost/retention must be agreed before hosting this review area on Vercel.
2. Configure the variables in `.env.example`: `EXTRACTION_STAGING_ENABLED=true`, a separate `EXTRACTION_STAGING_DATABASE_URL`, an explicit `EXTRACTION_STAGING_ENVIRONMENT_ID` and an absolute private `EXTRACTION_STAGING_OBJECT_ROOT`. The existing `DATABASE_URL` is compared for isolation, not used for review metadata. Both URLs must be direct Postgres URLs for this guard; Prisma Accelerate or unverifiable aliases fail closed. Direct/pooled Neon aliases are normalized. Connection values stay server-only and must never be committed.
3. Run the following from the repository root, substituting the same environment ID. Initialization is operator-driven and is never an application startup action or Prisma migration. It refuses a mismatched existing environment sentinel and rolls back.

```sh
npm run extraction:staging -- init --confirm-isolated allabouttax-extraction-dev
```

4. Set the object root to the selected validated bundle's `registry/objects`, outside any static/public web root. The command below re-runs the independent Python validator, then imports immutable normalized candidates. It never imports old acceptance flags. Run against a fresh copy if the lab bundle is still being edited; keep the original bundle, registry and CAS objects immutable for the deployed environment. Production credentials are stripped from the Python subprocess environment. Python is an offline operator dependency, not a web request dependency.

```sh
npm run extraction:staging -- import --bundle work/pdf-staging/import-v2
```

5. After confirming a real user's authenticated account ID, grant only extraction review with an explicit reason and expiry within 90 days. The placeholder below is not an account or automatic grant. An email address is not a user ID. Do not infer reviewer qualification from their admin role.

```sh
npm run extraction:staging -- grant --user-id AUTHENTICATED_USER_ID --reason 'Initial public-source extraction review' --expires-at FUTURE_ISO_TIMESTAMP
npm run extraction:staging -- revoke --user-id AUTHENTICATED_USER_ID --reason 'Review period ended'
```

6. Visit `/staging/extraction` on the prepared host, sign in and compare source regions. Save a draft first. Confirm it survives reload, verify a second reviewer gets a stale-parent conflict, revoke access and confirm source downloads are denied. Only then consider recording an actual scope acceptance. These are extraction checks; tax/legal applicability needs a separately designed capability and decision record.

Turning the feature off returns 404 before authentication or staging database access. Environment variables alone do not create a schema, import candidates or grant users. The runtime pins the environment sentinel and rejects a connection whose normalized host/port/database matches the main database. This guard cannot prove arbitrary DNS aliases refer to different databases: the operator must select a genuinely independent target and a least-privilege runtime role. Restrict the runtime role to candidate SELECT, capability SELECT, revision SELECT/INSERT and head SELECT/INSERT/UPDATE; reserve schema/candidate/grant administration for the operator role. Runtime credentials cannot be used by reviewers.

## Verified examples and limits

The operator adapter successfully revalidates both existing local examples: Notification 1/2026 has 53 regions and awaits extraction review; the partial table has 41 regions, including all 19 historical confirmed blanks, and retains its six blocking holds. A confirmed blank remains empty text with its explicit blank state, never zero or an inferred filled answer. Historical owner feedback is preserved as provenance; no real account has accepted these imported candidates.

`tests/extraction-staging.test.ts` runs real Postgres DDL/transactions/triggers with PGlite using synthetic principals and public engineering fixtures. It covers authorization, revocation/expiry, immutable records, concurrent/stale saves, retry identities, tampered evidence, source membership and geometry, isolated configuration, HTTP origin/body boundaries and protected downloads. The normal application test command runs it without cloud credentials. The separate Python lab continues to validate extraction scope and evidence lineage.

This first review screen caps the worklist at 30 candidates, each at 1,000 regions and 100 review revisions. Evidence is limited to 100 MiB per object and 300 MiB per candidate; candidate metadata is limited to 2 MB and a review request to 128 KiB. Do not silently truncate larger sources: prepare a bounded review scope or extend pagination/retention with tests before expansion. A local private object adapter is unsuitable for multi-instance serverless hosting. Backup/restore drills, managed immutable object storage, a real staging sign-in test, tax applicability decisions, wider unseen-source extraction evaluation and a dry-run retrieval release remain outstanding.

## Next increment

First activate and smoke-test this exact flow in an independent staging environment. Then add tax applicability review bound to the current accepted extraction head, with a separate qualified-reviewer capability, source-supported dates and period/entity/provision limits. Next build a dry-run citation/retrieval manifest that preserves qualifications, table headers/units/footnotes and exact page regions. Only a later explicit release may connect reviewed content to live answers.

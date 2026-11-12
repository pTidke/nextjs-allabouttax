# Extraction staging activation record

Verified 12 November 2026 UTC (11 November in America/Detroit). This records infrastructure preparation for draft extraction review. No tax approval or retrieval release was performed.

## Provider identity and cost

The connected Neon account owns the existing `AllAboutTax` project (`little-mode-43809833`), whose only branch is `production` (`br-still-shadow-b4ntq4ju`). Its subscription reports `free_v3` and its region is `aws-us-east-2`. Production databases, users, sessions, branches and credentials were not changed.

The pilot uses a newly created, empty **AllAboutTax Extraction Staging** project (`sparkling-thunder-56242364`) in the same organization (`org-summer-band-72278231`). A separate empty project provides independent project quotas and avoids cloning production records. Its subscription also reports `free_v3`. The root branch is `extraction-staging` (`br-small-bar-beyrd1rz`); the compute endpoint is `ep-little-surf-bek191kx`, capped at 0.25 CU. Suspension uses the Free-plan default (`suspend_timeout_seconds=0`).

The current [Free plan](https://neon.com/docs/introduction/plans) includes 1 GB Postgres storage, 5 GB object storage, 100 CU-hours and 5 GB public network transfer per project. The existing organization had only the production project before this creation, below the published project allowance. The pilot's initial evidence transfer is 11,494,675 bytes. No paid upgrade was selected. Future usage and Vercel hosting still require monitoring; the Vercel billing query returned `costs_not_found`, which does not establish zero cost or identify its plan.

## Databases and privileges

The application/auth database is `allabouttax_staging`; all five existing Prisma migrations applied successfully to this empty database using its direct endpoint. It contains zero users and zero sessions. The separate `extraction_review` database has the operator-applied `extraction_staging` schema and environment sentinel `allabouttax-extraction-dev`.

The operator role is `extraction_operator`. Web credentials use distinct roles with no superuser, database-creation or role-creation privilege and no inherited role memberships:

- `extraction_web_auth`: schema usage and CRUD only on `User`, `Account`, `Session` and `VerificationToken`. It cannot select `TaxChunk` or connect to the review database.
- `extraction_web_review`: schema usage; SELECT on environment, capabilities, candidates, revisions and heads; INSERT on revisions and heads; UPDATE on heads. It cannot change candidates, capabilities or existing revisions, or connect to the auth database.

PUBLIC database connection/temporary privileges and schema privileges were removed on these new staging databases. Broad grants/default grants from role creation were removed before the narrower grants were applied. Real role connections successfully read the intended tables; an attempted capability UPDATE as the review role returned SQLSTATE `42501` (permission denied). No user has received a reviewer grant, and no review revision exists.

The password-free production identity is pinned to `postgresql://ep-soft-flower-b432e4em.c-6.us-east-2.aws.neon.tech/neondb`, checked against provider endpoint and database metadata. Neither staging database is in that production project.

## Evidence storage and imports

The private bucket is `extraction-evidence-staging`. Provider storage metadata returned the branch-specific endpoint `https://br-small-bar-beyrd1rz.storage.c-9.us-east-2.aws.neon.tech`, region `us-east-2`, with path-style addressing. The actual ACL contains only the project owner; the provider returns `NoSuchBucketPolicy`. An anonymous request for an uploaded source object returned 403.

The runtime storage credential has only `storage:read`; an attempted PutObject returned `AccessDenied` / 403. The operator uploader uses a separate credential with both `storage:read` and `storage:write`, which is necessary for its privacy checks. Operator credentials are excluded from the proposed Vercel settings. An earlier unused write-only credential is retained pending explicit revocation approval; it was not used to upload files and must not be deployed.

The existing operator bundle `work/pdf-staging/import-v2` passed fresh independent validation. All 17 distinct content-addressed files were uploaded and downloaded again to verify their full SHA-256 hashes. Both immutable candidates were imported through the real read-only storage adapter:

- Notification 1/2026: 53 regions, awaiting extraction review, no blocking holds.
- Partial table: 41 regions, all 19 historical confirmed blanks preserved, six blocking holds retained.

Both remain ineligible for publication; no retrieval items or reviewer acceptances were created.

## Vercel status and remaining work

Team access is verified for `team_l0l8vQASn6FAKRs0G4EqAWmo` (`msptidke-6657s-projects`) and the existing `allabouttax` project (`prj_uzGa7dVRMlI9ddaE95DPFVAQ3giH`). Deployment `dpl_4fzAsQ7MMoCpUoWtxyegyCHLHG9m` is READY on commit `15165014b535ad929f6f4f17572ff6ecfd0977dd` of `codex/pdf-processing-lab`, with the review feature disabled.

The existing default preview database setting also targets production. No one should use the preview for staging sign-in until branch-specific isolation settings are applied and a new deployment is verified. The Vercel credential update was rejected by automatic approval review because destination-specific permission for these new credentials was not explicit. A read-only follow-up confirmed that no branch-specific settings were applied. Owner approval has been requested; no alternative transfer method was attempted.

The prepared setting set uses only the restricted database roles, read-only storage credential, a separate staging session key, environment/branch/bucket identity, and `AUTH_URL`. It targets Preview builds of `codex/pdf-processing-lab` only. Production configuration and operator upload credentials are excluded.

The proposed stable staging origin is:

`https://allabouttax-git-codex-pdf-proces-b11964-msptidke-6657s-projects.vercel.app`

Its Google OAuth callback, to register only after the deployment/origin is verified, is:

`https://allabouttax-git-codex-pdf-proces-b11964-msptidke-6657s-projects.vercel.app/api/auth/callback/google`

Remaining gates: explicit Vercel credential-transfer approval; branch-specific environment configuration and redeployment; Google callback registration; a fresh staging sign-in and expiring extraction-review grant; browser draft/reload/conflict/revocation/source-asset tests; and an isolated backup/restore drill. Production ingestion, tax applicability approval and RAG release remain later steps.

No secret values are recorded in this document or Git. Temporary operator configuration is kept outside the repository in an owner-only file for this activation session; it must not be committed or treated as a durable secrets manager.

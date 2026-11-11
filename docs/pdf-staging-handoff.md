# PDF lab to authenticated staging

Updated 11 November 2026. The pure validation boundary and two isolated local demonstration imports are implemented. Authenticated review, cloud integration and retrieval handoff remain design work. The live ingestion path is unchanged.

## Current boundary

The isolated lab retains original PDFs, page images, native/OCR alternatives, source-bound edits and local revision history. Table reconstruction now supports explicit column/cell repairs and blank choices. These facilities establish evidence lineage and editable proposals. They do not authenticate the self-reported reviewer, establish whole-document completeness, or approve legal applicability.

The application currently has `USER` and `ADMIN` roles, `TaxVersion`, `TaxChunk`, and private `TaxReviewDraft` records. `ingestDocument` creates the current text/chunks together. The PDF lab must not write into that path or reinterpret its draft flags as production approval. Integration needs a separate staging boundary first.

## First vertical slice

1. Add a versioned import envelope and a validator that accepts only internally registered source objects, exact extraction revisions and declared review scopes. Keep it pure and test it without credentials or database access.
2. Import two local fixtures into isolated staging: one complete clean text scope and one incomplete table scope. Neither creates `TaxChunk` records. The incomplete fixture must retain its holds and have no acceptance action available.
3. Add authenticated extraction review using existing sign-in plus a separate server-side capability grant. `ADMIN` may manage work but is not automatically a qualified tax approver. Initial reviewer grants are an explicit configuration step, with no public self-assignment. Persist immutable revisions with authenticated user ID, server timestamp, parent revision, action and reason. The browser cannot assert reviewer identity or accepted state.
4. Add a distinct tax-applicability decision against an exact accepted extraction scope. It records period, instrument status, provision/entity limitations, relevant dates, dependencies and the qualified reviewer's authenticated identity. Unknown dates stay unknown; investment-entry windows are distinct from expiry. This stage does not manufacture metadata from publication year.
5. Add a dry-run retrieval handoff. Show which accepted passages/table rows would enter retrieval, including citations and their required context. Do not write an index until both review gates and a release decision pass. A later explicit production release activates the adapter; staging imports alone cannot change live answers.

The first clean scope should use the already source-reviewed Notification 1/2026 page as a transcription control, not assume that its old tax approval applies to a new extraction revision. The negative table fixture should retain unplaced text and incomplete context from the engineering examples. It must stay blocked even when every visible entry cell has been marked blank.

## Required records

| Record | Immutable evidence / decision |
| --- | --- |
| Source object | Official URL and fetch time, original-byte checksum, content type, byte length, object ID and complete source-page count |
| Extraction run | Source object ID/checksum, engine/settings/weight versions, exact raw artifact IDs/checksums, status for every source page |
| Extraction revision | Parent revision, selected alternatives, source polygons and literal raw spans, edited text, explicit exclusions and reasons, unresolved holds, declared scope and context dependencies |
| Table revision | Stable cell IDs, source bounds, row/column spans, cell state, units, ordered header paths, footnotes and cross-page links; raw values and edits remain separate |
| Extraction decision | Exact revision/scope digest, authenticated reviewer ID, decision/time/reason and a complete disposition for each required region |
| Tax decision | Accepted extraction scope digest, legal applicability metadata, supporting source regions/dependencies, reviewer ID and decision/time/reason |
| Release manifest | Exact extraction and tax decision IDs, approved retrieval items and citation targets, dependency digests and prior release ID for rollback |

Local history records may be imported as attributed historical proposals, with their original self-reported names retained. They must not be upgraded to authenticated reviewer decisions. Chat-confirmed blank cells remain narrowly attributed feedback; they do not confirm other cells, table geometry or legal meaning.

## State transitions and holds

Source registration -> candidate run -> extraction draft -> extraction review -> accepted extraction scope -> tax review -> approved tax scope -> dry-run release -> published release.

Each transition is server-authorized and conditional on the exact parent revision. A failed/uncertain case stays in the same stage with explicit holds; successful OCR or JSON validation cannot advance it. Withdrawal or a new source/extraction/context revision invalidates eligibility for new releases. Old release records remain auditable; stale decisions do not transfer automatically.

Acceptance is scoped. All original pages must be inventoried, but a partial source can be reviewed only as an explicitly bounded scope with its necessary qualifications, headings, tables, footnotes and adjacent-page context. Unprocessed pages outside that scope remain disclosed; the UI must not call the complete PDF accepted. A dependency on unprocessed or unresolved content blocks the scope. Defining a smaller scope cannot bypass a material condition.

For a table, distinguish `unresolved`, `transcribed`, `blank`, `unreadable`, and positions covered by a reviewed span. Preserve blank, null/unresolved, zero and dash separately. A blank answer field is not a missing legal rule and must never become numeric zero. Unknown material text, missing headers, ambiguous units, unplaced content within required context and unresolved cross-page boundaries block that table's retrieval handoff. Excluding bleed-through or signatures requires an exact source region and a recorded reason; low OCR confidence alone is not an exclusion rule.

Only reviewed context may be used when serializing retrieval items. A row must carry its table title, ordered header path, units, qualifications and linked footnotes. Keep alternative forms separated by literal boundaries such as `OR`. Split or joined page relationships require explicit evidence and reviewer decisions; matching column counts or numeric sequences are insufficient. A language model may propose interpretations but cannot silently repair dates, numbers or table associations.

## Storage and operational boundary

Use Neon for metadata, review actions and release references. Do not bulk-copy page images/model outputs into the free database. Keep staging evidence in a local content-addressed object adapter first; choose managed object storage, region, retention and its cost before cloud rollout. Original objects and raw alternatives are immutable; edits are new revisions. Citations resolve to an official URL plus original/page/region identity, with the exact approved excerpt recorded for audit.

The import worker must use allowlisted object IDs, never reviewer-supplied filesystem paths or arbitrary URLs. Enforce byte/page/pixel limits, processing deadlines, retry identities, leases, and conditional commits. A retried import cannot duplicate a source, revision or decision. A hash is an integrity check, not reviewer authentication. File parsers and optional model runtimes stay outside the web request process; the existing local subprocess budgets are not a production OS sandbox.

Staging uses separate database/object namespaces and credentials, with no production write connection. No current step requires a paid resource or paid OCR API. Public fixtures must not contain completed taxpayer returns. Private uploads/forms need a separate consent, encryption, access, deletion and retention design before inclusion.

## Verification before connecting retrieval

- Unauthorized/self-assigned roles cannot review; an extraction reviewer cannot grant their own tax capability. Direct API requests enforce the same rules as the UI.
- Wrong source/raw/render hashes, foreign region IDs, changed context dependencies and stale revision parents fail closed.
- Duplicate/retried imports and interrupted saves are recoverable without duplicated decisions. Conflicting edits preserve both proposals and require a fresh parent.
- Reviewed blanks round-trip without becoming zero, missing text or a fabricated filled value. Unreadable/unplaced material remains held.
- Changing any accepted text/header/span/exclusion/footnote/continuation invalidates the affected extraction and tax eligibility until reviewed again.
- The negative table fixture cannot publish despite a successful provider status, valid geometry or zero unresolved entry cells.
- Dry-run items retain qualifications and exact source citations. Unsupported language/script or incomplete page context cannot be hidden by a clean preview.
- Backup/restore preserves evidence, revision chains, authenticated decisions and release manifests; rollback restores the prior published manifest without rewriting history.

## Work remaining after this design

The fresh-source four-page transfer trial is development coverage. Complete source-bound references and unseen-family scans, Hindi-body tables, genuinely image-only originals and harder scan classes remain evaluation work. Record false acceptance as well as explicit holds, critical characters separately from general transcription, table relationships separately from cell text, and correction time/cost per accepted scope. Do not report accuracy from candidate counts or raw-character accounting.

The pure import envelope/validator, operator-selected local object registry and clean/blocked fixture tests are implemented in the PDF lab. The two local demonstration receipts keep all approval flags false and create no retrieval items. Next implementation is authenticated extraction revision storage and server-side reviewer capabilities in isolated application staging; it must recheck revision parents inside its persistence transaction. Cloud storage, tax decisions, retrieval serialization and production release remain later increments. This document does not authorize or implement a production migration.

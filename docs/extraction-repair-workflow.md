# Staging extraction review and repair

## Automated text repair pilot

With the staging worker enabled, **Send correction request** queues a repair for up to four reported text lines with source boxes. The worker crops the stored image around each line and sends it, the previous reading and the reviewer's description to the configured Azure deployment. The inbox shows progress and refreshes while a job is pending. A validated suggestion returns in **Ready to recheck**, with the original extraction and proposed text available for comparison. The reviewer checks the changes and records the extraction decision. [Azure Responses API image input and structured outputs](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses)

Page-wide reports, table structure changes and uncertain readings go to manual repair. A failed request stays visible in the inbox. The worker preserves original evidence, scope holds and previous decisions. The job references the exact correction request and cannot publish a result after a newer request or replacement. Transient failures retry up to three times.

The table OCR pilot runs only on blocked benchmark copies marked with the TABLE_OCR_PILOT hold. A report on a single cell can propose literal text or a blank within the existing source box. Its row, column, neighbouring cells and confirmed blanks stay in place. A proposed blank appears separately from a confirmed blank and requires visual recheck. Overlapping cells, previously confirmed blanks and unreadable results go to manual repair.

To activate on an isolated staging database:

1. Apply [ocr-repair.sql](../tools/extraction-staging/ocr-repair.sql). Grant the existing review web role SELECT on the job table and INSERT on its request ID, candidate ID and status columns. The dedicated worker role needs schema usage, SELECT on environment, candidates, heads, revisions and repair jobs, INSERT on candidates, and UPDATE on repair jobs. The worker uses the existing private evidence reader with read-only storage access.
2. Set `EXTRACTION_OCR_REPAIR_ENABLED=true` for the staging preview and worker. Use the existing environment ID and database isolation settings. The worker also needs `AZURE_OPENAI_BASE_URL`, `AZURE_OPENAI_DEPLOYMENT` and `AZURE_OPENAI_API_KEY` in its own environment.
3. On Vercel, configure `EXTRACTION_OCR_WORKER_DATABASE_URL` as a sensitive variable for the staging preview branch. The preview posts the request ID to Vercel Queues and the private consumer runs the worker on demand. For a self-hosted environment, use `npm run extraction:ocr-worker -- run` under a process supervisor. The `once` command handles at most one job. Older requests can be resubmitted to enter the pilot.

Use public official documents for this pilot. Before extending it to tables, measure field accuracy, abstentions, turnaround and inference cost on a broader set of reviewed regions.

## Manual fallback

1. Open the extraction inbox and compare the highlighted area with the original PDF. Use **Report an issue** for a text or layout difference. Choose the area, page, or whole document and describe what the PDF shows. **Send correction request** records the report and moves the document to **Needs repair**.
2. The operator reads the report in review history and prepares a new extraction against the same original. For a table, inspect column boundaries, spanning headers, notes, and adjacent context. Preserve confirmed blanks where the source locations still match. Validate the new bundle with the existing staging validator, then register it against the saved request.
3. Refresh the inbox and open **Ready to recheck**. The new version opens at the changed or reported areas. The original request and repair summary are available above the comparison. Review the whole dependency area when a column, row, or heading changes. Acceptance still requires the full source and scope checks on an eligible version.

## Return a repaired version from the lab

For a validated bundle whose object files are already available to the staging runtime, use the existing staging operator connection. The prior candidate and request IDs are available under **Extraction scope and version** and **Saved review history**, respectively.

```sh
npm run extraction:staging -- import \
  --bundle /path/to/validated-bundle \
  --envelope corrected-table-envelope.json \
  --replaces PREVIOUS_CANDIDATE_ID \
  --request-revision SAVED_CORRECTION_REQUEST_ID \
  --repair-summary "Describe the corrections and any areas that need a second look."
```

Replace the example envelope name and IDs with those for the repair. For cloud staging, first run the existing `plan` and `upload` steps for the bundle. A linked import replaces the inbox entry and preserves the earlier extraction and its review history. A repair with outstanding validation holds can come back for targeted recheck. Circular 3/2026's partial table scope also needs the importer to support acceptance of verified table structure and context before it can be accepted.

# Staging extraction review and repair

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

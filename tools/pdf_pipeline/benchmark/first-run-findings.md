# First local runs — 5 November 2026

## Corpus snapshot

The read-only knowledge inventory found 156 stored current documents, including 155 PDFs, and one document needing attention. A provisional sample of 12 stored PDFs covers **326 pages**, not 426. The earlier progress estimate of 426 was an arithmetic error and was corrected after machine triage.

Machine signals in that sample: 57 pages contain images, 143 have Devanagari characters and 65 have suspect character mappings. These categories overlap and are not human labels or error-rate estimates. No image-only page was found in the stored sample; that is a coverage gap, partly explained by the old extraction-before-storage policy.

The official Rules PDF was separately fetched with a bounded, allowlisted lab download. It is 10,111,559 bytes with SHA-256 `f565e0f5ff3bf8f717daeb507f5e8569e720abc3309e6719f6f085889c9b802f` and 976 pages. Production's existing size limit and failed-document record were not changed. A two-page lab run accounts for all 976 pages but remains BLOCKED because the other 974 were not processed. Full-document processing/recovery is not established by this experiment.

## Native review packages

Four public official documents were processed into local packages: 22 pages total. All page entries and renders completed. One native document awaits extraction review; three remain blocked for image, character, table or geometry issues. Table detection produced 28 candidate grids, not 28 validated tables. No document was accepted or published. The product owner subsequently reported that Notification No. 1/2026 looks good visually; [the feedback record](review-feedback.json) binds that qualitative observation to the exact reviewed artifact. It does not establish token-level accuracy, complete script coverage or legal approval.

An early path-based run detected a changed working-copy checksum. The root cause was not established. The run was held. Parser backends now receive in-memory byte snapshots, preserved originals are read-only, and both original/render hashes are verified. Subsequent four-document runs preserved original checksums. A regression test checks that the native backend receives a byte snapshot rather than a source path. This is a defensive fix, not a claim to have proved a third-party defect.

## Optional Docling English trial

Docling 2.147.0 with RapidOCR/ONNX Runtime on CPU processed a synthetic image-only page and both pages of an official scanned circular. Requested-page counts matched returned pages. On the synthetic example, the output retained the seeded `1.5%`, `15%`, `31 March 2030` and `not an exemption` strings. The official result has no human-labelled accuracy score.

The experiment preserves raw JSON/Markdown plus versions and a weight-manifest digest. Its output is not mapped into the canonical contract and remains EXPERIMENTAL_NOT_ACCEPTED. It cannot clear native quality holds. The tested backend resolves English but rejects Hindi; multilingual accuracy is not established.

## Next gates

1. Human-label the triage set, fill coverage gaps and reserve held-out document groups.
2. Validate Hindi/legacy-font, table and stamp configurations; normalise chosen engine output into the canonical contract.
3. Complete the large-file page-group/recovery path and stronger process/network isolation.
4. Run the bounded managed-engine comparison only after service/budget approval.
5. Add correction revisions and acceptance, then evaluate LangExtract metadata suggestions against reviewed text.

These are first local engineering results, not a completed OCR benchmark or a production cutover.

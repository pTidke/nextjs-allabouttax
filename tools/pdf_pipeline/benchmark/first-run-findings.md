# First local runs — 5 November 2026

## Corpus snapshot

The read-only knowledge inventory found 156 stored current documents, including 155 PDFs, and one document needing attention. A provisional sample of 12 stored PDFs covers **326 pages**, not 426. The earlier progress estimate of 426 was an arithmetic error and was corrected after machine triage.

Machine signals in that sample: 57 pages contain images, 143 have Devanagari characters and 65 have suspect character mappings. These categories overlap and are not human labels or error-rate estimates. No image-only page was found in the stored sample; that is a coverage gap, partly explained by the old extraction-before-storage policy.

The official Rules PDF was separately fetched with a bounded, allowlisted lab download. It is 10,111,559 bytes with SHA-256 `f565e0f5ff3bf8f717daeb507f5e8569e720abc3309e6719f6f085889c9b802f` and 976 pages. Production's existing size limit and failed-document record were not changed. A two-page lab run accounts for all 976 pages but remains BLOCKED because the other 974 were not processed. Full-document processing/recovery is not established by this experiment.

## Native review packages

Four public official documents were processed into local packages: 22 pages total. All page entries and renders completed. One native document awaits extraction review; three remain blocked for image, character, table or geometry issues. Table detection produced 28 candidate grids, not 28 validated tables. No document was accepted or published. The product owner subsequently reported that Notification No. 1/2026 looks good visually; [the feedback record](review-feedback.json) binds that qualitative observation to the exact reviewed artifact. It does not establish token-level accuracy, complete script coverage or legal approval.

An early path-based run detected a changed working-copy checksum. The root cause was not established. The run was held. Parser backends now receive in-memory byte snapshots, preserved originals are read-only, and both original/render hashes are verified. Subsequent four-document runs preserved original checksums. A regression test checks that the native backend receives a byte snapshot rather than a source path. This is a defensive fix, not a claim to have proved a third-party defect.

## Reviewer defects — Circular No. 6/2026

The product owner reported defects in 16 native text-line regions. Page 1 block 1 contains a handwritten `06`; blocks 3–6 have poor Hindi transcription; block 34 is a signature. Page 2 block 5 is a signature, block 6 should contain the printed name `Hardev Singh`, and blocks 23–30 are garbled/mixed up. Exact region IDs, original bounding boxes and extracted strings are preserved in [review feedback](review-feedback.json). Proposed values are reviewer observations pending source verification; unspecified Hindi/garbled text is not guessed.

This exposes the need to test rendered-page OCR against unreliable existing text layers, validate Hindi explicitly, classify signature/handwriting regions separately, and check names as critical tokens. Signature imagery must remain traceable to the source rather than becoming invented prose or inferred identity. Region grouping/order in the page 2 cluster still needs inspection; its cause is not established. The tested English-only Docling trial does not resolve these Hindi or handwriting defects. Keep this document as a tuning/regression sample, with independent originals reserved for held-out evaluation.

## Optional Docling English trial

Docling 2.147.0 with RapidOCR/ONNX Runtime on CPU processed a synthetic image-only page and both pages of an official scanned circular. Requested-page counts matched returned pages. On the synthetic example, the output retained the seeded `1.5%`, `15%`, `31 March 2030` and `not an exemption` strings. The official result has no human-labelled accuracy score.

The experiment preserves raw JSON/Markdown plus versions and a weight-manifest digest. Its output is not mapped into the canonical contract and remains EXPERIMENTAL_NOT_ACCEPTED. It cannot clear native quality holds. The tested backend resolves English but rejects Hindi; multilingual accuracy is not established.

## Revised bilingual comparison

A separate image-only Tesseract.js 7.0.0 comparison renders both Circular No. 6 pages at 300 DPI, runs English and English+Hindi full-page variants, and reruns the reported regions with explicit geometry. The six issue groups cover 16 native regions; the disconnected page 2 signature/footer and left-margin groups are cropped separately. Original source and baseline hashes remain unchanged. All six groups remain open and the package remains BLOCKED.

The bilingual candidate produces readable Devanagari headings, but also corrupts part of the adjacent English “Direct Taxes” heading. The handwritten number remains wrong (`Q€` in the tested candidate). The name is still wrong in the crop and full-page variants; the reviewer-proposed `Hardev Singh` remains separate and is not injected into OCR. Two explicitly reviewer-marked signatures are presented as image regions without region OCR; this does not demonstrate automated signature detection. The page 2 alternatives still contain garbage; rotations are retained as experiments rather than promoted into a repaired reading order.

Pinned tessdata_fast English/Hindi integer models run successfully. An earlier optional floating-point tessdata_best attempt failed in the WASM core with a missing dot-product function. A separate 1.0.0 best_int language-package name-crop trial ran but still misread the name; it was not promoted as the chosen configuration. These trials do not establish an engine winner. The revised package is ready for comparison review, not acceptance or production use. No paid OCR service was invoked.

## Follow-up comparison feedback

The owner reports that the displayed page 1 Hindi heading group looks good. The handwritten number and printed name remain incorrect. For the page 2 left-margin group, the expected sequence is `1 2 3 4 5 6 7`, with `2`, `5` and `7` reported wrong. Seven list values span six native blocks, so there is no accepted one-to-one block/value mapping.

The owner permits excluding `p1-b34`, `p2-b5`, `p2-b23` and `p2-b24` from the extracted-text scope of this reviewed revision. Preserve their original source images, raw output and exclusion provenance; do not count excluded regions as correct or generalize this waiver to other footer/handwritten/legal content. This is a recorded scoped policy request, not yet a pipeline mutation or publication approval. The original comparison remains immutable. The separately observed English “Direct Taxes” mixed-script regression remains open despite positive qualitative feedback on the Hindi group.

## Independent English EasyOCR refinement

EasyOCR 1.7.2 with local CRAFT/English generation-2 weights processed six image requests: both full pages and four active source crops. It produced `CIRCULAR NO.06_/2026` for the handwritten-number line and `(Hardev Singh)` for the printed name. The numbering crop returned all seven digit tokens `1 2 3 4 5 6 7`, plus a stray `aEl` token. The extra underscore/stray token remain visible and unresolved. The English “Central Board of Direct Taxes” string is also present in the heading crop. This is agreement on selected observed strings, not a document-level accuracy score.

The owner-requested exclusions for four source regions are applied in the new text view. Two whole issue groups are excluded and four remain open; partial overlaps in full-page candidates stay held for separation. Raw provider results, the previous comparison, original scan and exact exclusion provenance are preserved. Original/source checksums remain unchanged. No OCR candidate or legal scope has been approved.

This run tests English only. It retains the prior bilingual candidate rather than treating EasyOCR's English-only output on Hindi as a replacement. A preliminary optional Devanagari-model download exceeded the exploratory download cap and was stopped; no EasyOCR Hindi inference result is claimed. Tests cover scoped exclusion, missing/changed artifacts, partial-overlap retention, numeric tokens, provider geometry, worker approval rejection and failure cleanup. A benchmark on independent, labelled originals is still needed before engine choice or production integration.

## Reverse-side show-through review

The owner identified `p2-easyocr-eng-45` through `p2-easyocr-eng-62` in the English refinement as reverse-side text visible through thin paper. A new scope-only revision excludes those 18 exact OCR regions from the main text view and collapses them under inspectable excluded evidence. The two punctuation-like recognised strings remain in raw evidence alongside the blank recognitions. No OCR rerun, confidence-based removal or automatic bleed-through detection occurred. Other low-confidence regions remain available.

The source, raw OCR and parent comparison bytes are preserved. The earlier four signature/footer exclusions remain in place. This does not change the open review status of number/name/heading/list candidates, create ground-truth accuracy labels or approve publication. The comparison remains BLOCKED. Regression tests verify that explicit exclusions do not remove other faint foreground text and that changed review geometry is rejected.

## Next gates

1. Human-label the triage set, fill coverage gaps and reserve held-out document groups.
2. Validate Hindi/legacy-font, table and stamp configurations; normalise chosen engine output into the canonical contract.
3. Complete the large-file page-group/recovery path and stronger process/network isolation.
4. Run the bounded managed-engine comparison only after service/budget approval.
5. Add correction revisions and acceptance, then evaluate LangExtract metadata suggestions against reviewed text.

These are first local engineering results, not a completed OCR benchmark or a production cutover.

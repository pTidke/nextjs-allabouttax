# Corpus and annotation rubric

The committed manifest contains public-source metadata and machine triage only. It is not a labelled evaluation dataset and has no accuracy score. Original bytes and detailed artifacts remain in gitignored `work/` directories.

## Initial reviewer and simple checks

The product owner has volunteered to perform the initial visual extraction checks, which do not require tax expertise. The owner reported that Notification No. 1/2026 looks good in the review gallery; the exact source and artifact revision are recorded in [review feedback](review-feedback.json). This is qualitative sample feedback, with no region-by-region labels or enumerated language coverage. No tax/legal reviewer has been designated and no ground-truth labels have been accepted yet.

The owner also reported defects in 16 regions of Circular No. 6/2026: handwritten identifier, Hindi text, signatures, a printed name and garbled regions. These source-bound defect reports and proposed corrections are retained separately from the immutable extraction artifact; they are not yet accepted ground-truth labels. The sample remains blocked. A separate bilingual comparison now preserves each report alongside raw full-page/crop OCR candidates. The owner subsequently reported that the Hindi group looks good, requested four scoped signature/footer exclusions, and specified the seven-item margin sequence with errors at 2/5/7. These are recorded separately against the exact comparison hash. Names, handwriting, numbering and the known adjacent English mixed-script regression remain open. Exclusions are not counted as correct transcription.

Start with a language you read comfortably. Open the first document in the local gallery, select a text line and compare it with the green-highlighted original region. Use the full-size image link if the preview is too small. Check that words are neither missing nor added; rates, decimal points, dates, names, section numbers and negations match; and table values remain under the correct visible headings. Report the page/region ID and the observed difference. Flag unreadable or unfamiliar text rather than guessing.

Matching transcription does not approve a document's legal status or applicability. Leave those fields and scope/dependency decisions to a qualified tax reviewer. The original text/OCR gallery is read-only. The table workspace now supports revision-bound local drafts, browser save and JSON export/import; no shared annotation history, acceptance or publish action exists.

## Establishing ground truth

For each selected original hash/page, an extraction reviewer records visible text and source polygons, reading order, headings/clauses, tables/cell relationships, footnotes and any genuinely unreadable regions. Preserve the original spelling, figures, punctuation, units and scripts. Record uncertainty instead of completing an illegible word from context.

Critical-token labels include rates, amounts, dates, clause/section identifiers, names, conditions and negations. Distinguish blank, zero, dash, covered and unreadable table cells. Date-role interpretation and legal applicability require a finance/tax reviewer; they are not OCR labels.

Use the generated `work/pdf-triage/annotation-template.jsonl` as a starting point. Empty expected text means unlabelled, not a blank page. Fill `verified_by` only after inspecting the original render. Add source geometry and a reason for exclusions or unresolved regions. Corrections must reference the exact original hash and accepted annotation revision.

## Grouping and held-out data

Assign related documents/versions/templates to groups before setting tuning/held-out splits. Do not put near-duplicate instruments into both sets. Reserve held-out originals before tuning OCR settings or writing extraction examples. Current split/group values are intentionally unassigned.

The exported stored-original sample is biased: the old ingestion path stores originals only after text extraction succeeds. Add independently acquired official image-only scans and failed/oversized documents. Synthetic scan fixtures exercise engineering gates but cannot substitute for that real cohort.

## Acceptance requirements

- Every source page is accounted for, with omitted/unprocessed pages blocking completeness.
- Every accepted text/table region resolves to the unchanged source revision.
- No unresolved material OCR, table/header or dependency issue is published.
- Report transcription error, critical-token accuracy, table relationships and abstention separately by document class and script.
- Measure clean-looking output that was wrong as well as detected failures.
- Track reviewer corrections/time and cost per accepted page.
- Successful provider status, JSON validity and character alignment alone do not establish source fidelity or legal correctness.

An extraction reviewer and finance/tax reviewer must agree and sign off the rubric before treating any experiment as a completed benchmark. No sign-off has been recorded in this increment.


## Engineering report and table prototype

[engineering-plan.json](engineering-plan.json) fixes the bounded native sample and keeps all related forms in an engineering group. It is not a held-out evaluation split. [engineering-run.json](engineering-run.json) records the measured run and its provenance. The local report links to immutable originals/renders and 62 official table candidates plus one synthetic table; candidate detection is not table accuracy. Accuracy remains unmeasured, even for visually plausible output.

Use local table drafts to record transcription and proposed header/span/unit/footnote relationships. They bind to the exact source, artifact, table and render hashes. Validation prevents transferring them silently to changed extraction output, and rejects overlapping spans/foreign footnote references. A browser save or exported `DRAFT_NOT_ACCEPTED` file does not become a benchmark label. Formal annotation acceptance, a signed rubric and independent real scan/handwriting/table references remain separate milestones.

The first real-table browser review recorded 48 choices for Circular No. 3/2026 page 3 (`p3-t1`), with unfinished text/merged-cell fields. Source-bound feedback records those choices as unfinished, not accepted ground truth. The UI now offers explicit candidate-copy confirmation and save/export/import of incomplete progress; strict draft and publication gates remain separate. No real-source transcription was silently filled to turn that review into an accuracy label.

## History and expanded scan increment

Review history now uses a separate local SQLite service with parent-linked immutable revisions, conditional saves, retry identities, integrity checks and a verified backup/restore. Initial saved progress remains unfinished; no reference labels are accepted automatically. See `review-history-run.json` for the measured local checks. This is single-operator lab storage, not production reviewer authentication or a cloud durability claim.

`expanded-scan-run.json` records three direct-fetched official additions, the previously tuned Circular 6 control and synthetic image-only/rotation/blur cases. It retains empty baseline OCR results and alternate layout attempts separately. Acquisition from legacy inventory metadata still has sampling bias; real image-only sources, broader scripts/layouts and signed accepted reference annotations remain required. No OCR accuracy or tax-law correctness score is reported.

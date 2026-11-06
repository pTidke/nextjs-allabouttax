# PDF processing laboratory

This is the first local increment of the separate document-processing plan. It is not the production ingestion path. It has no database client, approval endpoint, embedding code or RAG publisher. `publication_eligible` is always false, including when native extraction finishes successfully.

## Delivered

- Read-only public-corpus inventory/export through `scripts/tax-corpus.ts`.
- Pinned Python package and hashed native/test dependency lock.
- Independent preflight page counts, byte-preserved originals, read-only original files and byte-snapshot parser inputs.
- Process-isolated native parsing/rendering with time, byte, pixel, page and glyph budgets.
- Versioned JSON contract with displayed-page geometry, glyph regions, text-line candidates, structured table-cell candidates and explicit uncertainty.
- Per-page accounting, incomplete-run holds, source/render checksums and immutable run directories.
- Static side-by-side review packages; selecting a line or table cell highlights its original region. Full-size page images are available.
- Synthetic failure regression tests and a Linux CI job without production secrets or model downloads.
- Optional Docling CPU experiment with local model weights, version/hash recording and full-page English OCR. Raw experimental output is separate from the canonical artifact.

## Local setup

From the repository root, use Python 3.12 and uv:

```sh
uv venv tools/pdf_pipeline/.venv --python 3.12
uv pip install --python tools/pdf_pipeline/.venv/bin/python --require-hashes -r tools/pdf_pipeline/requirements-test.lock
uv pip install --python tools/pdf_pipeline/.venv/bin/python --no-deps -e tools/pdf_pipeline
```

If the normal uv cache is not writable, set `UV_CACHE_DIR` to an allowed task-specific cache directory. Do not change HOME.

```sh
npm run tax:corpus -- --export-count 12
tools/pdf_pipeline/.venv/bin/tax-pdf triage work/pdf-corpus/sources.json --out work/pdf-triage
tools/pdf_pipeline/.venv/bin/tax-pdf batch work/pdf-corpus/sources.json --out work/pdf-lab/demo --ids 4859b7812f85,cc4238745db8,e228528d7afc,3756112e45b5
tools/pdf_pipeline/.venv/bin/python -m http.server 8787 --bind 127.0.0.1 --directory work/pdf-lab/demo
```

Open `http://127.0.0.1:8787/`. Serve only the generated review directory, never the repository or a credentials directory. The example source hashes refer to the recorded corpus snapshot; future corpora must select their own unique original hashes.

Corpus inventory reads only the public knowledge tables within a read-only transaction. It exports at most 15 originals with an 80 MiB total budget. It does not alter production approvals. Originals, model files, local environments and generated packages stay under gitignored paths.

## Single document and exit codes

```sh
tools/pdf_pipeline/.venv/bin/tax-pdf process /path/to/public-source.pdf --out work/pdf-lab/runs
tools/pdf_pipeline/.venv/bin/tax-pdf process /path/to/large.pdf --pages 1,2 --out work/pdf-lab/runs
tools/pdf_pipeline/.venv/bin/tax-pdf verify work/pdf-lab/runs/RUN_DIRECTORY
```

- `0`: operation completed; a document may still await human extraction review. This does not mean approved.
- `2`: review package was produced/verified, but blocking quality or completeness issues remain.
- `1`: command, input or processing operation failed.

Every source page appears in the manifest, including unprocessed pages. A selected-page run is explicitly incomplete. Native output with scan images, suspicious characters, unknown table relationships or unverified form content remains held. An apparently blank page requires confirmation.

The laboratory accepts up to 100 MiB / 1,000 source pages, but processes at most 50 pages and 250,000 glyphs per run, with a 600-second run budget and 50-second subprocess timeouts. It limits each render to 16 million pixels. Budget exhaustion leaves unprocessed page records and blocks the run. The next service increment must add durable page-group scheduling/artifact streaming for complete large-document processing.

Linux parser children enforce CPU/address-space limits. macOS address-space limits are not enforced. Children receive a reduced environment without application credentials, but this is not an OS network/filesystem sandbox. Run only the bounded public-document pilot here; do not deploy it as an untrusted upload service.

## Optional local Docling experiment

This is opt-in, installs a larger local dependency stack and downloads public model weights. It does not use Azure or send documents to a model API. Review the model/library licenses and resource use before broader deployment.

```sh
uv pip install --python tools/pdf_pipeline/.venv/bin/python -e 'tools/pdf_pipeline[test,docling]'
tools/pdf_pipeline/.venv/bin/python -m tax_pdf.docling_probe prepare --models work/docling-models --languages en
tools/pdf_pipeline/.venv/bin/python -m tax_pdf.docling_probe probe --models work/docling-models --file work/pdf-fixtures/scan.pdf --out work/docling-experiments/scan-NEW --languages en
```

Use a fresh output directory for every probe. At most ten selected pages are permitted. Probe output records requested/returned pages, the full source page count, provider status, engine versions and a model-weight manifest digest. `EXPERIMENTAL_NOT_ACCEPTED` remains the state even when the provider reports success. Remote services/plugins are disabled in Docling and model access is set offline for probes, but no OS egress sandbox is claimed.

The tested RapidOCR configuration resolves English and rejects `hi` (Hindi). Do not apply it to the bilingual corpus and claim multilingual accuracy. Hindi OCR, seals, handwriting and table semantics require their own validated backend/configuration and labelled cohort.

## Bilingual image-OCR comparison

An optional Node worker runs Tesseract.js 7.0.0 locally on bounded PNGs, separately from the web app and the canonical artifact. Its own npm lockfile is under `ocr/`. English and Hindi integer language weights come from a pinned revision of the official tessdata_fast repository; both their bytes and manifest are checked. Documents are not sent to an OCR API. Model preparation downloads public weights; comparison uses local files only. The library configuration follows the [Tesseract.js API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md) and [official language data documentation](https://tesseract-ocr.github.io/tessdoc/Data-Files).

```sh
npm ci --prefix tools/pdf_pipeline/ocr --ignore-scripts --no-audit --no-fund
tools/pdf_pipeline/.venv/bin/python -m tax_pdf.ocr_compare prepare --models work/tesseract-fast-models
tools/pdf_pipeline/.venv/bin/python -m tax_pdf.ocr_compare compare --models work/tesseract-fast-models --baseline work/pdf-lab/demo-v2/packages/BASELINE_RUN --feedback tools/pdf_pipeline/benchmark/review-feedback.json --out work/pdf-lab/demo-v2/comparisons/FRESH_RUN
```

Use `--cache /tmp/allabouttax-npm-cache` with npm if the normal cache is not writable. Replace baseline/output names with the actual local run directories. Serve the same review directory on localhost and open `comparisons/FRESH_RUN/index.html`. The CLI uses exit 0 for a completed comparison, which **always remains BLOCKED**; failure is exit 1. No accepted text, publication action or RAG mutation is produced.

The source-bound feedback must match the original hash, run ID, artifact hash, fingerprint, region IDs, text and geometry. Reviewer notes and proposed corrections never enter the OCR job. Each page gets separate English and English+Hindi full-page candidates. Reported regions get focused crop attempts. Disconnected regions are split before cropping; tall narrow groups also get explicit 90/270-degree alternatives. No orientation is selected or reading order declared correct automatically. Reviewer-marked signatures appear as source images without running region OCR or inferring identity; raw full-page OCR may still contain signature garbage. This is human-assisted handling, not automatic signature detection.

Comparison bounds: at most ten complete baseline pages, 100 MiB original, 300 DPI, 16 million pixels/render, 120 seconds/OCR job and 600 seconds total. Jobs receive a reduced environment without app credentials. There is no OS filesystem/egress sandbox. Noncanonical raw JSON, pixel/source geometry, crop transforms, file hashes, engine versions, weight/code/lock digests and reviewer notes remain separate. A failed job removes its incomplete comparison staging directory and leaves the baseline unchanged. Existing lab constraints on rendering still apply.

The comparison is a tuning sample. It has no accuracy score, legal approval, accepted corrections, automatic signature detector or verified table/reading-order semantics. No confidence threshold clears a quality hold. A fresh source review is needed after every changed result.

## Independent English OCR refinement and scoped exclusions

EasyOCR is an optional second engine for the remaining English/name/number regions. It does not replace the previously reviewed Hindi candidate. Install its optional dependencies separately; no EasyOCR models or inference run in web CI:

```sh
UV_CACHE_DIR=/tmp/allabouttax-uv-cache uv pip install --python tools/pdf_pipeline/.venv/bin/python -e 'tools/pdf_pipeline[easyocr]'
tools/pdf_pipeline/.venv/bin/python -m tax_pdf.easyocr_probe prepare --models work/easyocr-models
tools/pdf_pipeline/.venv/bin/python -m tax_pdf.refine_compare --previous work/pdf-lab/demo-v2/comparisons/circular-6-bilingual-v4 --review tools/pdf_pipeline/benchmark/review-feedback.json --models work/easyocr-models --out work/pdf-lab/demo-v2/comparisons/FRESH_REFINEMENT
```

The worker uses EasyOCR 1.7.2 on CPU with two threads, CRAFT detection and English generation-2 recognition. [Official usage/configuration](https://github.com/JaidedAI/EasyOCR) supports local model paths and disabling downloads. Two public release weights are pinned by SHA-256; preparation downloads only those specific archive members within byte/decompression budgets. Inference disables downloads and rejects custom network files. Transitive Python runtime versions are recorded, not supplied as a complete platform-specific production environment lock.

Refinement requires a review bound to the previous comparison hash, original hash and baseline hash. It verifies the previous file inventory before copying it to a new directory. The current bounded runner accepts at most two source pages / ten PNG requests, with 16-million-pixel / 40-MiB image limits, a 20-MiB result budget and a 180-second worker wall timeout. The child receives a reduced environment; this is not an OS memory/network/filesystem sandbox. Original source bytes, provider polygons/confidences, previous outputs and reviewer notes remain preserved.

Only explicit source-revision region exclusions are applied. Wholly contained OCR regions are omitted from the main text view while remaining in raw evidence. Partially overlapping regions stay visible and flagged for separation. Excluded content is never scored as correctly recognised. Signature detection and legal relevance are not inferred automatically. The four exclusions currently come directly from the owner's review of this Circular.

Digit-only tokens are displayed separately from other detected text, without filling gaps or substituting the expected sequence. English model errors on Hindi are visible and the prior bilingual result remains available; these candidates are not merged into accepted text. Every non-excluded issue still requires review. The CLI exits 0 for a completed but BLOCKED comparison, or 1 for failure. There is no publication/embedding/RAG write path.

## Reviewer-confirmed reverse-side show-through

A source-bound scope review can exclude explicitly identified OCR regions without rerunning a model. For example:

```sh
tools/pdf_pipeline/.venv/bin/python -m tax_pdf.refine_compare --scope-only --previous work/pdf-lab/demo-v2/comparisons/circular-6-easyocr-v3 --review tools/pdf_pipeline/benchmark/review-feedback.json --out work/pdf-lab/demo-v2/comparisons/FRESH_SCOPE_REVIEW
```

The user identified page 2 EasyOCR regions 45–62 as text showing through from the reverse side of thin paper. The main text view collapses those 18 exact regions under excluded evidence. Their text, boxes, raw provider output and original page images remain unchanged and inspectable. Parent comparison snapshots and review notes have hash-named lineage files. Excluded regions are not scored as correct; publication remains disabled.

This is a reviewer-confirmed exclusion, not an automatic bleed-through classifier or a confidence threshold. Other faint/low-confidence foreground text remains available for review. Scope labels cannot be transferred blindly to rerun region IDs or other documents. Automatic foreground/show-through separation needs its own labelled validation before it can remove content.

## Contract and quality policy

`schemas/artifact.schema.json` is generated from `tax_pdf.models`. Coordinates are displayed PDF-page points with a top-left origin. Original page index and printed page label are distinct. Line polygons and native glyph polygons are retained; exact character-span-to-glyph alignment across inserted spaces/ligatures is not yet implemented. Future LangExtract input must retain an explicit span map rather than use an untracked Markdown conversion.

Raw text is preserved; NFC-normalised text is a separate display field. No tax rate, date, identifier or negation is automatically repaired. Table grids are candidates: null/covered cells, empty strings, zero and dash are distinct; merged spans, header paths, units and footnotes are unverified and block acceptance. Reading order is a geometric candidate, not verified legal structure.

Local table correction drafts are available below. Authenticated shared correction history, reviewer acceptance, tax applicability, source-authority decisions, cross-document dependencies, cloud storage/queues, OS sandboxing and production integration remain future milestones. LangExtract/Azure evaluation begins after a labelled acceptance rubric and the relevant service budget are agreed. No paid resources were provisioned for this increment.

## Reproduce checks

```sh
tools/pdf_pipeline/.venv/bin/ruff check tools/pdf_pipeline
tools/pdf_pipeline/.venv/bin/ruff format --check tools/pdf_pipeline
tools/pdf_pipeline/.venv/bin/python -m pytest tools/pdf_pipeline/tests -q
tools/pdf_pipeline/.venv/bin/tax-pdf schema --out /tmp/pdf-artifact.schema.json
diff tools/pdf_pipeline/schemas/artifact.schema.json /tmp/pdf-artifact.schema.json
```

Synthetic fixtures can be generated once into a new directory with `python -m tax_pdf.fixtures --out work/pdf-fixtures`. They are marked as synthetic and are never tax-law evidence. CI uses only synthetic PDFs and has no production database credentials or external OCR calls.

See [benchmark rubric](benchmark/README.md), [recorded triage](benchmark/triage-manifest.json) and [first-run findings](benchmark/first-run-findings.md).


## Bounded engineering benchmark and table draft workspace

`tax-pdf benchmark` generates a fresh native extraction run, JSON/HTML coverage report, preserved source packages and a local table workspace. It does not apply previous OCR corrections, rerun optional OCR engines, infer accepted ground truth or publish knowledge.

```sh
tools/pdf_pipeline/.venv/bin/tax-pdf benchmark work/pdf-corpus/benchmark-sources-v1.json --plan tools/pdf_pipeline/benchmark/engineering-plan.json --out work/pdf-lab/demo-v2/benchmarks/FRESH_RUN
```

The source manifest uses the existing `documents` array (`path`, `sha256`, `title`, optional `url`); paths must resolve below its directory. Add the separately preserved large-source metadata to that array and the four deterministic fixture entries generated with `tax_pdf.fixtures` before using this committed plan. Source bytes must match every plan hash. The plan records original page counts, explicit selected pages, official/synthetic cohorts and engineering groups. It refuses duplicate selections, unknown hashes, invalid pages, over twenty originals/eighty selected pages or a held-out evaluation claim. Each document run is additionally capped at twenty processed pages and 180 seconds; unsampled/budget-held/failed pages remain explicit. Check the resulting report rather than interpreting exit 0 as a quality pass. A failed per-document run remains in the denominator; manifest/checksum validation failure aborts without a completed report. The earlier twelve-source sample is biased towards documents the legacy pipeline could extract.

The first report covers 48 selected official pages from thirteen originals with 1,302 source pages, plus all five pages of four synthetic fixtures. Only pages 1–2 of the 976-page Rules original were processed. Official and synthetic results stay separate; accuracy metrics are null because no accepted labels exist. Runtime measures the bounded native package operation on this machine, excluding optional OCR comparisons, reviewer time and the report/workspace generation. No cost per accepted page is claimed.

Open `benchmarks/FRESH_RUN/tables/index.html` in the localhost gallery. Start with the clearly marked synthetic table, then choose a public-source table. Select a raw cell to highlight its source and enter a separate draft transcription/state. Blank (`""`), zero (`"0"`), dash (`"-"`), covered and unreadable stay distinct; raw candidates are never rewritten. Propose header rows/paths, units, spans and a source-block-bound footnote. The draft preview renders proposed spans and keeps unchecked cells explicit. Missing/split grids or continuation problems go in table notes; adding/resegmenting source cells and cross-page table linking are later work. This prototype edits one footnote per draft and rejects imports containing more, avoiding silent loss.

Save explicitly in browser storage or download/copy draft JSON. Browser storage is revision-keyed local convenience, not durable shared storage. A changed source, artifact, render, table, run or fingerprint rejects old imports. Proposed merged anchors require explicit covered-cell relationships; out-of-bounds/overlapping spans and foreign footnote blocks are rejected. The independent validator rechecks original/render bytes and draft binding:

```sh
tools/pdf_pipeline/.venv/bin/tax-pdf check-table-draft work/pdf-lab/demo-v2/benchmarks/FRESH_RUN/packages/RUN_ID table-draft.json
```

A valid draft is still `DRAFT_NOT_ACCEPTED`; validation checks provenance and structure, not whether the transcription or legal interpretation is correct. There is no server write, extraction acceptance, tax approval or RAG path. Review times, independently labelled accuracy, a broader real scan cohort and persisted multi-reviewer workflow remain required before production integration.

## Saving an unfinished table review

The review form now has explicit **Matches original**, **Confirmed blank** and **Needs another check** actions. “Matches original” copies the selected raw string exactly after a reviewer clicks; it does not infer a transcription for unresolved cells or alter numbers/word spacing. Transcription and optional layout fields remain editable.

**Save progress** retains incomplete text/merged-cell choices in a separate `UNFINISHED_TABLE_REVIEW` envelope when strict draft validation fails. It can be downloaded/imported and restored on reload, including the last selected table. The form states what still needs attention. Such progress files are not accepted annotations and cannot pass `check-table-draft` merely because they were saved. Revision, source/render integrity, field shape and candidate-cell identity remain mandatory for progress; unfinished text/geometry and footnote relationships remain subject to the existing strict validator. Browser storage is local convenience; keep the exported file for a durable copy.

```sh
tools/pdf_pipeline/.venv/bin/tax-pdf check-table-progress PACKAGE_DIR unfinished-review.json
```

This reports source binding and whether the nested draft passes the structural checks; it never grants extraction acceptance, legal approval, or publication. The initial Circular No. 3 page-3 table review contained 48 recorded choices but no completed text transcriptions or merged anchors. They were preserved exactly rather than converted into verified reference labels. The updated local workspace uses the same benchmark source packages; its UI revision does not change the measured native-extraction run.

## Local durable review history

The disk-backed laboratory server is separate from Next.js and the production database:

```sh
tools/pdf_pipeline/.venv/bin/tax-pdf serve-review --root work/pdf-lab/demo-v2 --store work/pdf-review-history/reviews.sqlite --port 8788
```

Open `http://127.0.0.1:8788/benchmarks/native-engineering-v2/tables/index.html`. **Load latest saved review** resumes an existing revision, and **Save to review history** writes a new one. A browser recovery copy is retained before loading history. Browser-only save/export remain available on the static server. Existing local reviews were imported with their original bindings and unfinished status; saving or importing never grants acceptance.

The SQLite store is outside the served directory with owner-only file permissions. Every revision records its parent, original payload, creation timestamp, retry identity, checksum and strict-validation result. Revisions reject ordinary updates/deletes; the parent chain and record hashes are checked on read/save. Conditional writes reject stale edits with HTTP 409. Retrying an interrupted request reuses its identity, without creating another revision or moving the head backwards. A browser-storage failure does not negate a successful disk save. This detects accidental changed/broken history; it is not a signed audit log protected from an administrator who controls the database.

The server binds only to `127.0.0.1`, validates literal Host/Origin and browser request-site headers, requires a same-origin custom header for JSON writes, disables framing, and rejects hidden/traversing/outside-symlink paths. Database/backup files cannot be put under the static root. Saves are limited to five MiB, history to 999 revisions per binding and the local database to a 100-MiB budget. Package registration is bounded to 500 extraction runs; restart the service after adding new editable packages. Source/render bytes and exact draft bindings are independently checked before writes. Other local processes running as the same user are trusted; this is not a remotely accessible or authenticated multi-user service. Reviewer labels are self-reported.

Create a consistent, non-overwriting SQLite snapshot with:

```sh
tools/pdf_pipeline/.venv/bin/tax-pdf review-backup --root work/pdf-lab/demo-v2 --store work/pdf-review-history/reviews.sqlite --out work/pdf-review-history/backups/NEW.sqlite
```

Keep the preserved source packages alongside the history backup when moving machines. The backup command uses SQLite's backup API, not a raw live-file copy. Restore was checked against every saved table/revision. The current backup is on the same machine; off-machine retention and restore procedures remain deployment work. Production requires authenticated reviewer identities/roles, managed storage and retention, operational isolation, and a separate acceptance workflow. No acceptance endpoint, RAG writer, cloud resource or production database access is added here.

## Expanded scan comparison

```sh
tools/pdf_pipeline/.venv/bin/tax-pdf compare-scans work/pdf-corpus/expanded-scan-sources-v1.json --models work/tesseract-fast-models --out work/pdf-lab/demo-v2/benchmarks/FRESH_SCAN_RUN
```

The manifest follows `tax-pdf batch`, adding explicit `pages` and `kind` (`official` or `synthetic`). It permits at most six originals and ten selected page/derivative cases. Originals and render checksums remain preserved. All pages are accounted for by the native runner; selected pages render at 300 DPI. The comparison has a 600-second deadline, with native processing bounded by remaining time (at most 120 seconds per source) and each local OCR job bounded to 120 seconds. Incomplete/failed OCR attempts remain represented; an exhausted document-run deadline aborts the incomplete experiment without replacing a previous report.

The measured extension directly fetched Circulars 2, 4 and 7/2026 using the application's existing official-host/DNS/redirect/byte checks, before evaluating this experiment. Their four pages join both pages of the already-tuned Circular 6 and a synthetic image-only page with separate 90-degree and blur derivatives: nine cases total. Acquisition metadata still comes from the legacy inventory, so this is not a representative held-out dataset; a separate real image-only cohort remains a gap. Only the synthetic input is altered, and every derivative keeps its source/transform/hash. OCR boxes on rotated images are also mapped back to unchanged source-page coordinates.

English and English/Hindi local Tesseract candidates remain separate. Empty default-layout results explicitly raise `OCR_RETURNED_NO_LINES` and trigger a separate PSM 6 layout experiment, marked `ALTERNATIVE_LAYOUT_UNVERIFIED`. The original empty result is retained. The wider run found one readable scanned page where both default attempts yielded no lines; alternate attempts yielded candidates, without proving complete or correct transcription. Provider confidence, nonempty text and completed jobs are never accuracy scores or approval. The HTML gallery links every candidate to its image region, with unchanged native text and raw provider output retained. Character/word/table accuracy stay null until accepted labels exist. CI mocks OCR and downloads no models; the actual local runs are recorded separately.

The expanded scan comparison is a raw engine experiment. It does not apply the prior Circular 6 reviewer exclusions/corrections; the separately preserved refinement and scope-review packages remain the evidence for that work.

## Source-bound reference dataset and error scoring

The frozen `benchmark/reference-plan-v1.json` selects **18 official development pages** (11 originals) and **5 authored synthetic pages** (4 originals). All inspected/tuned circulars stay in development, and related forms remain one group. This is a risk-focused lab sample, not representative sampling or an untouched holdout. A new unseen source/template cohort, including real image-only scans, is still needed for final evaluation.

```sh
tools/pdf_pipeline/.venv/bin/tax-pdf reference-pack \
  --root work/pdf-lab/demo-v2 \
  --native-report work/pdf-lab/demo-v2/benchmarks/native-engineering-v2/report.json \
  --scan-report work/pdf-lab/demo-v2/benchmarks/expanded-scans-v3/scan-report.json \
  --plan tools/pdf_pipeline/benchmark/reference-plan-v1.json \
  --out work/pdf-lab/demo-v2/benchmarks/FRESH_REFERENCE_SET

tools/pdf_pipeline/.venv/bin/tax-pdf score-references \
  work/pdf-lab/demo-v2/benchmarks/FRESH_REFERENCE_SET/dataset.json \
  --root work/pdf-lab/demo-v2 \
  --out work/pdf-lab/demo-v2/benchmarks/FRESH_REFERENCE_SET/FRESH_RESULTS
```

`dataset.json` preserves the full selected page/attempt inventory. Separate reference files, candidate snapshots and input-evidence hashes keep proposed text apart from references. Original bytes and selected render hashes are rechecked on scoring. Raw OCR files and source reports are pinned. Different-DPI OCR renders are recorded explicitly; these text metrics compare transcriptions, not cross-render geometry. Edited candidates, stale verified annotations, duplicate source pages/attempts, path traversal and changed evidence are rejected. Every rescore writes a fresh result directory; no earlier result is overwritten.

`PROPOSED` official references start with **no expected transcript** and never receive accuracy scores. Candidate text is available alongside the original page as a proposal to check, not a source of automatic labels. Authored synthetic references are derived from the deterministic fixture specification, after exact original-byte hash verification, independently of extractor output. They must never be described as accepted official labels.

`schemas/reference.schema.json` defines the label contract. A `HUMAN_VERIFIED` record requires complete expected text, source/render/page binding, a named reviewer, timezone-aware review time, `visual_source_comparison` and the SHA-256 of the canonical annotation (`Reference.annotation()` / `sha_json`). Changing any annotation, source or scope invalidates that verification. This is a **self-attested local annotation record**, not authenticated identity, a cryptographic signature, extraction acceptance, legal review or publication permission. No tool in this increment marks an official reference verified automatically.

### Reference annotation rubric

1. Transcribe visible printed text in source reading order, checking the image rather than copying the PDF text layer unchecked. Preserve punctuation, case, Unicode, dates, names, section identifiers, rates, negations and list labels. Record applicable handwriting separately for future region-scoped labels; do not infer unclear characters from sequence or context.
2. Do not insert signature guesses, reverse-side show-through or invisible text-layer artifacts into the expected transcript. The current complete printed-text contract cannot express their region labels, partial/unreadable text or ambiguous order: leave those references proposed until a region-scoped contract and visual review resolve them. Existing Circular 6 exclusions remain separate evidence, not transferred labels on new region IDs.
3. For each table, account for every grid position. Distinguish text, a confirmed empty cell and a covered merged position; identify the anchor and spans for every merge. Zero, dash, blank and unresolved null are different. Preserve header rows; header paths, units and footnote associations still require a richer relationship evaluator.
4. A full-page reference must cover the whole page. Partial checks, qualitative “looks good,” status choices and a few corrected strings do not establish a verified transcript. Keep notes/disagreements and incomplete work; do not force uncertain references into a score.
5. Recheck all critical names, dates, identifiers, figures and negations. Keep transcription review separate from finance/tax interpretation. A finance reviewer later determines legal authority/applicability; that does not retroactively prove transcription quality.

### Metric definitions and limits

- **CER:** exact unit-cost Levenshtein edits over NFC Unicode code points, divided by reference code points, after folding whitespace. **WER:** the same over whitespace-separated tokens. No case folding, ASCII conversion, punctuation removal, digit grouping repair or number/name correction is permitted. Rates can exceed 100% due to insertions. Unicode code points are not grapheme clusters; WER is not a language-specific linguistic tokenizer.
- Micro totals sum edit counts and reference lengths over **all scored attempts**, retaining empty/failed output as omissions. Unverified references remain in coverage/attempt totals but have null error rates, never zero error. The report also counts observed empty outputs independently of label availability.
- Report separate engine/transform results. Repeated synthetic derivatives are correlated attempts, not independent pages or evidence of generalization. Overall synthetic totals mix those attempts and are diagnostics only.
- Critical-string occurrence counts are checks, **not critical-token accuracy**: they cannot prove location/meaning or detect every substituted occurrence. Reading-order accuracy is null (text edit scores may still penalize reordered content).
- Table diagnostics pair tables by supplied page order and compare literal cell values/spans. Null cannot prove a covered cell, and unspecified spans stay unresolved. Missing/extra tables are counted. Header relationships and semantic/table-structure accuracy remain unmeasured; exact cell text does not establish a correct table.
- A false-clean text diagnostic requires an explicit clean claim and a verified transcript mismatch. Current lab candidates make no clean claims, so zero such cases has a zero claim denominator and is **not evidence of a safe quality gate**.

The first run caught approximately 90% character error on the rotated synthetic image despite nonempty OCR output. Both OCR language variants matched the unchanged and blurred simple synthetic image after the stated normalization. Native-only extraction omitted two synthetic scanned pages. All 14 synthetic table value cells matched, while merged-anchor spans and the covered relationship remained unresolved. These measurements do not establish official-document accuracy. No accepted extractions or tax knowledge were created.

### First confirmed official reference

`benchmark/references/notification-1-2026-p1.json` preserves the first complete owner-confirmed development transcript. The owner confirmed the displayed full Notification 1/2026 page, then explicitly confirmed the Hindi header correction from `रािपत्र` to `राजपत्र`. The raw candidate and original PDF are unchanged. The local reference set was copied to a fresh `reference-development-v3` revision; earlier references/reports remain preserved. `benchmark/reference-reviews.json` records both statements, the exact one-character correction, source/render/candidate/reference hashes and the reference's self-attested verification scope.

`benchmark/reference-verification-run.json` records the rescore: **one character and one word edit** on this native page, rather than a perfect score against its own uncorrected candidate. Only one of the eighteen official pages is verified; the other seventeen stay unscored. This is development regression evidence for an already inspected page, not unseen-document accuracy or tax/extraction publication approval. The initial `reference-run.json` remains the historical pre-verification run. To reproduce the verified revision from a fresh generated pack, copy the committed reference over its matching proposed reference file, validate source/render binding and rescore into a new result directory.

## Reviewed scan defects and image-only recovery trials

`benchmark/expanded-scan-feedback.json` preserves 25 owner-reported findings from the expanded scan gallery. Bindings include the exact scan-report digest, language/layout and full original line records (text, source-point box and image-pixel box). Validation rechecks original PDF bytes, source artifacts, renders, OCR input images and raw output files. Numbering restarts across OCR language/layout variants, so a bare region ID is never sufficient. Region highlights use image coordinates against the supplied image dimensions, rather than mixing source points and image pixels.

```sh
tools/pdf_pipeline/.venv/bin/tax-pdf review-scans \
  work/pdf-lab/demo-v2/benchmarks/expanded-scans-v3/scan-report.json \
  tools/pdf_pipeline/benchmark/expanded-scan-feedback.json \
  --out work/pdf-lab/demo-v2/comparisons/FRESH_SCAN_REVIEW

tools/pdf_pipeline/.venv/bin/tax-pdf recover-scans \
  work/pdf-lab/demo-v2/benchmarks/expanded-scans-v3/scan-report.json \
  tools/pdf_pipeline/benchmark/expanded-scan-feedback.json \
  --models work/tesseract-fast-models \
  --reference work/pdf-lab/demo-v2/benchmarks/reference-development-v3/references/944d5d44b2c9-p1.json \
  --out work/pdf-lab/demo-v2/benchmarks/FRESH_RECOVERY
```

The read-only review view keeps every raw region alongside the scoped correction. Decorative stars differ from the `th` fragment associated with the handwritten 25th March date. A mixed body/signature region must be split, and Rubal Singh / other printed names are retained even if the region also contains a signature. Clause/list prefixes are partial corrections; text following them is not replaced. The already correct Devanagari `५` is retained. The broad Circular 4 page 1 bleed-through report rejects its OCR candidates but supplies no safe foreground/background mask. Circular 6's general punctuation/script comments and the ambiguously specified positive synthetic comment remain qualitative; no whole page is accepted from them.

Recovery uses only source pixels and generic OCR settings. On each of the two narrow columns it finds horizontal ink bands without reading an expected sequence length, preserves the unchanged tight crop, and OCRs each candidate row with white padding and 2x resizing. The threshold is used only for segmentation; it never erases pixels in the OCR input. Short discarded ink runs are recorded and remain a quality hold. There is no sequence completion, digit substitution, punctuation repair or recipient association. Reviewer sequences enter diagnostics only after all row OCR jobs finish.

For the rotated synthetic case, all four quarter-turns and both Tesseract language settings are tried separately. Every attempt, including empty/failed ones, is retained. Authored reference text enters diagnostics only after OCR. Source boxes use inverse quarter-turn transforms. No angle is selected based on the gold transcript or confidence, and this control does not establish orientation detection on unseen documents. The total worker budget is 300 seconds with bounded image/row counts and per-job limits inherited from the local OCR worker. Optional EasyOCR is not called by these recovery commands.

`benchmark/scan-recovery-run.json` records 24 actual local attempts. Both columns separated into the expected 9 and 7 row candidates, but raw OCR still misreads some labels, including Circular 6's 2/5/7 and `I.` for 1. The synthetic text matched its authored reference in four of the eight orientation/language attempts; the failed alternatives remain in the report. These are development findings, not a production quality gate or accepted full-page transcription. The first Notification 1 reference remains the only human-verified official page. No RAG, production ingestion, original PDF or raw OCR file was changed.

### Targeted number and paper-background experiments

```sh
tools/pdf_pipeline/.venv/bin/tax-pdf targeted-ocr \
  work/pdf-lab/demo-v2/benchmarks/expanded-scans-v3/scan-report.json \
  tools/pdf_pipeline/benchmark/expanded-scan-feedback.json \
  work/pdf-lab/demo-v2/benchmarks/recovery-reviewed-scans-v1/recovery.json \
  --models work/tesseract-fast-models \
  --easyocr-models work/easyocr-models \
  --out work/pdf-lab/demo-v2/benchmarks/FRESH_TARGETED_RUN
```

This separate experiment reuses the exact source-bound row crops, re-creating their pixels from the original page to verify crop/padding/resize provenance. It checks the prior raw OCR against its recorded text and hashes. It never segments a column using the expected number of labels. Each row gets a fixed numeric-label alphabet (`0123456789.`) with English line OCR; normal English/Hindi text keeps its unrestricted alphabet. The worker rejects arbitrary profiles, extra answer/sequence parameters and invalid language/layout combinations. Applied parameters and the profile-module digest are recorded. Parsing keeps the raw output and delimiter separate from literal ASCII digits: it does not turn `I` into `1`, change scripts, remove leading zeros or fill a missing label.

If supplied, the existing pinned local EasyOCR model makes an independent English-only attempt on every unchanged padded crop. The subprocess receives only an opaque ID and image path; expected numbers are used after both engines return. All outputs remain separate and no engine is selected by its match to the reviewer sequence. These are inspected development examples, not unseen accuracy or proof of label-to-recipient associations. Omitting `--easyocr-models` explicitly records the independent comparison as not requested. No new model download or cloud call occurs.

For the rejected Circular 4 page 1, the lab retains grayscale, locally flattened paper background, and threshold candidates in both full-page layouts, plus three overlapping flattened strips. The background estimate uses local bright pixels and smooth shading; this is **not** a foreground/back-side classifier. Faint front-side text may disappear along with show-through. Derived pixels are preserved separately, with source-coordinate mappings; strips are not merged or deduplicated. Line counts and vertical occupancy measure candidate coverage only, never character accuracy or recall. All nine attempts and any failure remain visible, with complete-transcript, faint-foreground-loss and reading-order holds. No variant is automatically selected.

The experiment has a 300-second shared OCR budget, at most two reviewed columns/forty rows, ten images per independent OCR batch and a sixteen-megapixel preprocessing limit. The existing subprocess limits still apply; these controls do not provide an OS sandbox. Fresh output directories and source/model/code hashes preserve lineage. `benchmark/targeted-ocr-run.json` records measured results separately from mocked CI tests. No reference verification, extraction acceptance or production publication is added.

The recorded run retained **41 image attempts**: sixteen numeric-profile Tesseract crops, sixteen independent EasyOCR crops and nine paper-background/layout candidates. Independent OCR read Circular 6's seven digits correctly. Circular 7 returned `3_`, `5_`, `6_` and `8_` for four labels; their punctuation remains unresolved rather than silently normalized. The numeric alphabet alone failed to repair both sequences and even misread Circular 6's visible 7 as 2; a separate single-character-layout smoke trial did not help. Circular 4's flattened/default-layout attempt returned 39 line candidates spanning all eight vertical bins, compared with zero lines in the original default attempts and header-only alternate output. Date/punctuation errors remain visible. This establishes improved candidate coverage on one inspected page, not complete or correct foreground transcription. The report preserves every alternative, selects none and adds no verified reference.

`benchmark/targeted-ocr-review.json` records the owner's later comparative preference for independent OCR in the first (Circular 7) number section and for Circular 4's flattened full-page PSM 3 candidate. The explicit correction `31*` → `31st` binds to the exact report, source image, candidate raw output, line geometry, word box and character span. A separate local reviewed copy applies only that correction; the original OCR is unchanged. The source image confirms the superscript `st`. The wrong word had confidence 89, its line 94 and the asterisk symbol 98: low-confidence detection alone would miss it. This is a saved date/superscript regression example, not an implemented automatic repair or a new complete verified reference. Comparative positive feedback does not resolve unspecified punctuation, select a general OCR policy or authorize tax publication.

## Date and superscript review hints

```sh
tools/pdf_pipeline/.venv/bin/tax-pdf review-dates \
  work/pdf-lab/demo-v2/DATE_INPUTS.json \
  --out work/pdf-lab/demo-v2/comparisons/FRESH_DATE_REVIEW
```

The standalone audit reads a manifest with `inputs` (at most twenty). Each input supplies a unique `id`, `title`, `variant`, source `package` path and `artifact_sha256`, `source_sha256`, `page`, `preprocessing` (`unchanged` or `flattened`), candidate `image` path/hash, and OCR `state` (`EXPERIMENTAL_NOT_ACCEPTED` or `FAILED`). Completed attempts also supply `raw` and `raw_sha256`. All paths are relative to the manifest directory and checked for traversal/symlinks. The audit verifies original/render hashes and re-creates flattened pixels using the recorded deterministic transform; only unrotated full-page inputs are supported. OCR image dimensions and input binding must match. Failed/empty attempts remain not assessed. New output directories preserve older runs.

Rules flag suspicious suffix marks before an English month name, nonstandard ordinal forms, invalid day/month/year combinations and literal superscript glyphs in a named-month date. They run independently of confidence, retain exact character spans and source-point/image-pixel boxes, and show unchanged source crops. An asterisk may be a real footnote, and a source can itself use nonstandard spelling: the action is source comparison, never inferred repair. Numeric date order, Hindi date grammar, cross-line fragments, clean-looking substituted digits/names, date roles and legal applicability remain uncovered. A zero-warning result is explicitly **not a clean verdict**. No thresholds or automatic engine selection are introduced.

`benchmark/date-transfer-plan.json` freezes a small transfer check: Circulars 13–15/2025, first page only, unchanged English/bilingual and separate flattened-English candidates. Related CBDT templates and any public search snippets prevent a blind/new-template claim. Acquisition failures must remain recorded without substitution based on OCR success. There are no accepted reference labels or accuracy estimates for this cohort. All processing remains local with existing pinned weights; no paid OCR or production write path is used.

The measured transfer run is in `benchmark/date-warning-run.json`. The public listing API returned 403; direct official PDF requests for Circulars 13 and 14 returned 404. Both unavailable selections remain recorded, with no success-based substitutions. Circular 15 supplied one fresh page with embedded text, three OCR variants and no verified transcript. The frozen initial detector caught `10" December` at line confidence 94, while missing its garbled handwritten header. A subsequent development revision adds a `dated` / `date:` cue followed by a four-digit year when no English named-month date can be parsed. It flags that header without guessing the handwriting. It also asks for review of valid numeric reference dates, so it is an abstention hint rather than a defect verdict.

The final report retains seven correlated warnings across those three variants and the known Circular 4 control. Line-broken `31*` / `October` and the bilingual `1070 December` still escape these narrow rules; no score or clean verdict hides them. The newly inspected page is now a development example. Two planned sources, real image-only scans and unseen template groups remain collection gaps. Earlier audit revisions and raw OCR remain preserved. Tests cover confidence-independent flags, ordinal/calendar boundaries, explicit numeric/Hindi/cross-line limits, source mapping, changed evidence, crop/flatten provenance, empty/failed attempts, escaping and processing budgets.

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

### Split dates and OCR disagreement

The date audit now searches up to three consecutive lines within the **same provider paragraph**, requiring downward progression, a small vertical gap, similar left margins and horizontal overlap. It does not join separate paragraphs, distant lines or separate columns. A whitespace-joined search view is diagnostic only: exact original line text, character spans, word/line boxes, fragment confidence and unverified reading order remain separate. Word boxes are used only when the complete word inventory aligns literally; otherwise geometry stays at line precision. Neither raw text nor provider order is rewritten. This does not establish layout/reading-order correctness or support arbitrary dates split between blocks/pages.

Day fields of three to six digits, such as `1070 December`, are held for source review rather than truncated or repaired. Nearby section/clause/rule/paragraph identifiers are excluded from that oversized-day interpretation. Hindi dates, numeric date semantics, day/ordinal glyphs split into separate fragments, and clean-looking wrong digits remain outside the initial coverage.

Completed attempts also expose literal date candidates for same-original/page/render spatial comparison. Unique overlapping candidates with different NFC/whitespace-folded text raise disagreement hints; absent candidates and ambiguous geometry retain separate flags. Equal text is only surface agreement, even if it is identically wrong. Reused raw evidence is not counted as independent; empty/failed attempts remain not comparable. All raw values and source crops are shown separately, with no engine/variant winner. This is date-candidate comparison, not full-page OCR alignment or an omission/accuracy evaluator. Comparisons are capped at twenty inputs, one hundred date regions per input and one thousand flags.

`benchmark/date-gap-run.json` records the development rerun and one additional full-page local EasyOCR attempt using the existing pinned weights. The split `31*` / `October` is now flagged in all three Tesseract variants, and the bilingual `1070 December` is held for oversized day/calendar review. EasyOCR also produces date errors and a different segmentation of the page. Its unmatched candidates may reflect parsing/layout differences rather than actual missing printed text. The final report retains twelve correlated date warnings and fourteen pairwise comparison flags across five attempts on two previously inspected pages. Those counts are not distinct errors, reference coverage or production accuracy. Existing reports, acquisition failures and raw outputs remain preserved; no accepted reference, extraction or RAG write was added.

### Administrative content and reviewed dates

`benchmark/retrieval-scope-review.json` records the owner's follow-up: Circular 4 is qualitatively good apart from `31*`, Circular 15's header day is `29th`, and EasyOCR is comparatively cleaner for the copy-list numbers while misordering its heading. The previously confirmed `31st March, 2026` and the source-confirmed `29th October, 2025` are scoped reviewed header values, separate from raw OCR and from legal effective-date interpretation. Unresolved substantive body dates remain held; the answering LLM is not expected to guess them.

The owner proposes excluding Circular 15's administrative “Copy to” list from tax-answer retrieval. The draft binds two source-image areas to the exact original/render, covers the heading and recipients 1–12, and preserves issuer names/designations as provenance. One Tesseract region mixes “The Guard File” with signature strokes and must be split before exclusion. EasyOCR emits “Copy” last despite its source position above the list; it also emits a substantive `10th` fragment near the end of provider order. A text-tail cutoff or provider-order assumption is unsafe. Substantive clauses, conditions, exceptions, tables, annexures and footnotes must remain eligible for review wherever they appear.

This record does not implement a retrieval filter, alter a RAG index or accept a full-page reference. Administrative errors remain transcription errors; a narrower retrieval/content evaluation must state its scoped exclusions and denominator rather than count ignored text as correct. Original files and complete raw outputs remain available for audit.

### Structured content preview before retrieval

The `prepare-content` command builds a separate, read-only JSON/HTML draft. It does not produce chunks, embeddings, accepted extraction records or index writes. All OCR alternatives remain separate. The original PDF, artifact manifest, page render, complete raw OCR, review and per-region crops are retained with checksums. The source-bound review file is a local record of owner feedback; a checksum does not authenticate a reviewer or replace a future authenticated approval workflow.

```sh
tools/pdf_pipeline/.venv/bin/tax-pdf prepare-content \
  work/pdf-lab/demo-v2/date-warning-inputs-v2.json \
  --date-report work/pdf-lab/demo-v2/comparisons/date-warnings-v5/date-review.json \
  --review tools/pdf_pipeline/benchmark/retrieval-scope-review.json \
  --out work/pdf-lab/demo-v2/comparisons/FRESH_CONTENT_PREVIEW
```

Preparation re-creates the exact bound date report, rechecking originals, render/preprocessing pixels and OCR bytes. Stale reports, changed review snapshots and mismatched source/page/render evidence fail before a finished directory is exposed. Provider-line characters must form an exhaustive, non-overlapping span inventory. This accounting protects already extracted text; it does **not** measure characters or regions that OCR missed on the original. The unchanged top-level raw OCR remains available separately because its provider formatting can differ from its line inventory. The strict content schema is at `schemas/content-preview.schema.json` and is checked against the model in tests.

Only exact reviewed header snapshots receive explicit before/after edits. Circular 4's `31*` token becomes `31st` in the reviewed copy. Circular 15's bound English and EasyOCR header variants receive `29th October, 2025`; two other variants retain their original text and carry a correction-transfer hold. Reviewed source metadata never establishes a legal effective date. Raw date warnings and pairwise discrepancies remain visible, including unresolved substantive dates.

Administrative scope uses only the two reviewed Circular 15 source areas. No global Copy-to rule, language-model classification or text-tail cutoff is used. A mixed line is split only if its complete word inventory aligns literally with the original line and every word has usable source geometry. Otherwise the whole line stays held. The Guard File text is separated from signature strokes without deleting those strokes from the evidence. Issuer metadata is associated by reviewed geometry with a recorded 16-pixel padding; this does not verify its transcription. Unknown signatures/noise and ambiguous boundaries remain visible for review. Native table candidates keep their complete cell grid and unresolved spans/header paths; table overlaps take priority over exclusion. Substantive clauses, annexures and footnotes outside the reviewed areas are retained as unverified candidates.

Reading order is a geometric row-band proposal, never verified prose. It repositions EasyOCR's displaced `10th` next to the body-date fragments and `Copy` above its administrative recipients. Wide gaps, overlapping boxes and ambiguous row associations receive additional holds. Every region remains unverified, including apparently ordinary text. This selected development run cannot establish general multi-column order, faint-text recall, handwriting accuracy, multi-page table association or critical-field coverage.

`benchmark/structured-content-run.json` records the measured preview: **202 provider lines / 9,429 characters become 210 fully accounted spans across five alternatives of two source pages**. There are 110 content candidates, 64 administrative spans, 20 metadata spans and 16 mixed spans, counted across correlated alternatives. Three bound header edits are applied; no engine is selected. Circular 4 page 2 remains explicitly unrepresented. No new complete official reference is verified, and no accuracy or false-clean claim is made. The preview is bounded to twenty inputs, two thousand lines and six thousand content spans per page, sixteen-megapixel source images and a 120-second packaging deadline (the reused date audit has its own 60-second deadline). There is no OS sandbox guarantee.

The next stage is broader source/template evaluation, especially image-only scans, mixed-language dates, tables, annexures and multiple pages. Acceptance needs measured critical-token and relationship coverage, authenticated review revisions and the remaining production storage/worker controls. The current draft remains blocked from production ingestion.

The later owner feedback on Circular 15's English preview identifies its four mixed review spans as signature artifacts. `benchmark/retrieval-scope-review-v2.json` preserves that statement, the prior review/preview digests, complete parent OCR-line snapshots and exact child-span/crop bindings. Source comparison maps the same strokes in the other variants to fourteen excluded signature spans across the four alternatives. Two EasyOCR review spans are printed issuer text, so they remain metadata. No global signature detector, source-image deletion or whole-page approval is inferred.

To reproduce this follow-up, use the same `prepare-content` command with `--review tools/pdf_pipeline/benchmark/retrieval-scope-review-v2.json` and another fresh output directory. The classification must match the input ID, raw hash, complete parent line, child character interval, raw text, source box, crop hash and prior mixed scope. Changed/duplicated decisions, unbound variants and table or reviewed-field overlaps are rejected. All provider characters, raw OCR, original/render bytes, source crops, proposed order, reviewed date text and page-level/date holds remain unchanged. The signature scope resolves non-text transcription/boundary work only. `benchmark/structured-region-review-run.json` records the resulting 14 signature exclusions and 22 metadata spans; no mixed spans remain on these selected Circular 15 variants, while substantive-date uncertainty remains held.

## Fixed source-transfer pilot

`benchmark/transfer-evaluation-plan.json` freezes six source identifiers, page-selection rules and OCR settings before local acquisition/extraction. `benchmark/transfer-prior-sources.json` records the earlier source hashes used to reject exact-source reuse; related circular/form families remain explicitly related. Search metadata/snippets were seen during discovery, so this is a source-transfer development pilot, not blind evaluation or a representative accuracy estimate. Failures remain in the planned-source denominator. Historical forms/manuals are extraction specimens, not assertions of current filing requirements.

```sh
tools/pdf_pipeline/.venv/bin/tax-pdf evaluate-transfer \
  work/pdf-corpus/transfer-evaluation-v1/sources-v2.json \
  --plan tools/pdf_pipeline/benchmark/transfer-evaluation-plan.json \
  --prior tools/pdf_pipeline/benchmark/transfer-prior-sources.json \
  --models work/tesseract-fast-models \
  --easyocr-models work/easyocr-models \
  --out work/pdf-lab/demo-v2/benchmarks/FRESH_TRANSFER_PILOT
```

The acquired manifest must bind the plan digest and retain every planned acquisition slot. Sources are checksum-checked local public originals; acquisition uses the existing allowlisted public-address-checked fetcher, with its stricter 8 MiB cap. No allowlist, authentication, production database or API configuration is changed. The runner selects unique first/middle/last pages for native inspection, first/last for English and English+Hindi Tesseract, and first only for independent English EasyOCR. Empty default Tesseract output gets a separately retained layout-6 attempt. Neither failure nor confidence selects a replacement winner. Source/render geometry and candidate image hashes must agree. Failed worker output is retained when within the existing raw-byte budget.

The runner allows at most six sources / 80 MiB total, 25 MiB per original, 1,000 original pages each, three selected native pages per source, sixteen-megapixel images, the existing subprocess limits, and a 900-second overall deadline. Originals, renders, native table grids, raw engine outputs, model/code/input digests and a file checksum ledger remain available. Changed inputs, code or local weights invalidate final packaging. All page counts include unprocessed original pages; the report never approves extraction or tax content.

Literal number/ordinal/negation inventories and English date warnings supply review hints only. Whole-page inventory disagreement may reflect segmentation, formatting or signature noise; surface agreement can preserve the same error. These are not aligned critical-field accuracy, omission recall, reading-order or semantic-table scores. Native tables remain unverified grids; plain OCR supplies no reconstructed table relationships. A page with native OCR-layer characters and a full-page scan image is not counted as image-only. Hindi, faint-front-side text and real image-only coverage require independently confirmed examples.

The report includes six or fewer source-first checks. Each acquired document receives a first crop before second crops are added. Date locations may come from native geometry, and table windows from candidate table geometry; these locations are hints, not reference text. Crops are recreated from unchanged source renders and are bound to the original/page/render and crop hashes. The queue leaves `expected_text`, critical fields and reviewer verification empty. Review applies to that visible region only; it does not verify a whole page or legal applicability. Full-page CER/WER, critical-field accuracy and false-clean rates remain unavailable until references and denominators are verified.

`benchmark/transfer-evaluation-run.json` records the final measured run and the acquisition failures. Development reruns of these same frozen inputs are correlated and do not add independent documents or held-out trials. The next step is focused reference checking and a separately frozen collection that fills the real image-only/Hindi/faint-text gaps; no source is silently substituted to improve a score.

The final local run acquired **three of six planned sources** (52 original pages) and processed nine selected pages in 79.04 seconds: 24 native/OCR attempts, no worker failures and twenty unverified native table grids. Three unavailable source slots remain in the report. Circular 2/2024 retains a scanned page with an imperfect embedded OCR layer; its printed date is misread or displaced across candidates. On the ITR-2 manual, Tesseract reads the visible `01st April 2024` as `015 April 2024`, including a bilingual line with confidence 92. These agent source comparisons await owner verification and demonstrate why confidence cannot clear a date. Five date hints and twenty-five pairwise inventory differences are not error or accuracy counts.

The owner subsequently confirmed exactly three fields: Circular 2/2024’s identifier `2/2024` and printed date `05th march, 2024`, plus the ITR-2 manual’s `01st april 2024`. `benchmark/transfer-field-review.json` preserves the verbatim feedback, source/render/crop hashes, complete parent-line snapshots and literal character spans. Its twelve comparisons ignore case and whitespace only. All four circular-date alternatives mismatch; the independent output’s misplaced `0sth` has no date warning. Native/EasyOCR match the manual date, while both Tesseract variants mismatch. Both Tesseract variants and EasyOCR match the circular identifier; native text contains stray punctuation. A separate read-only local preview is at `comparisons/transfer-field-review-v1/index.html`; `benchmark/transfer-field-review-run.json` binds its artifacts. The original pilot remains unchanged. Three scoped field references do not create a verified page, table, engine-selection policy, date-role inference or publication approval.

`benchmark/transfer-field-preferences.json` records the owner’s follow-up preferences, interpreted in the three-field context: EasyOCR for the circular identifier and April date, bilingual Tesseract for the March date. Each preference binds the prior field review and exact comparison digest. The first two field mappings are contextual interpretations, with the verbatim message preserved. Preferences do not change raw exact-match results: the March Tesseract candidate still reads `05" March, 2024`, and the confirmed `05th march, 2024` remains the reviewed reference. The read-only follow-up preview is `comparisons/transfer-field-review-v2/index.html`; earlier feedback and outputs are unchanged. No automatic engine policy or whole-page acceptance is added.


## Reviewed character-box row relationships

`table_projection.project_character_row(table, row)` supplies a read-only projection for an explicitly selected ASCII character-box row. It receives no expected name or reference. It revalidates complete/unique cell identities, source bounds, left-to-right order, a common label/value row band and non-spanning one-character slots. Unknown cells, multi-character prose, non-ASCII values, missing geometry and ambiguous spans are rejected. The returned row keeps every raw cell and its coordinates. Empty candidate slots display as spaces and only right padding is hidden; they are not confirmed blanks. This is an explicit projection, not automatic form detection or a replacement for canonical raw tables.

`benchmark/form49a-row-review.json` preserves the owner's nine filled label/value associations across four nested grids on historical Form 49A page 4, plus the company’s full-name interpretation. Each grid binds the exact source, artifact, render and table digest. All nine filled values match the source-cell projections after case/whitespace comparison; all 312 original cells remain. Three unmentioned empty rows are still unreviewed, and the outer instruction table, cell-level spans/blanks, prose and whole-page order remain unverified. The company’s `XYZ DATA CORPORATION (IND` / `IA) PRIVATE LIMITED` rows are preserved as layout fields; only the explicitly reviewed boundary is joined without a separator to form `XYZ DATA CORPORATION (INDIA) PRIVATE LIMITED`. No generic person/corporation or cross-row joining policy is inferred.

The local read-only preview is `comparisons/form49a-row-review-v1/index.html`; `benchmark/form49a-row-review-run.json` records its source/crop/code bindings and denominators. The projection can be reproduced by loading the bound package's `artifact.json` as `Artifact`, selecting page 4 and tables `p4-t2` through `p4-t5`, and calling `project_character_row` separately for each row. Reference comparison and the explicitly reviewed company continuation happen after projection. This inspected example is not general table accuracy, a whole-table reference, legal applicability approval or production acceptance. No OCR rerun, model API, database, chunk or embedding is involved.


## Same-row and displaced date-fragment checks

The date audit now adds a separate same-visual-row search across provider paragraphs. It anchors on an English month/year fragment and searches up to three short fragments to its left, retaining exact provider-line numbers, offsets, text and source geometry. An explicit `dated`/`date:` cue or ordinal ending is required; uncued plain numbers are not attached to month/year headings. Tight distance/overlap checks and known-native-table exclusion limit accidental column/table bridges. Separate superscript endings remain separate literal fragments; no characters are completed, substituted or silently joined. Competing associations are all retained with ambiguity flags. Every new spatial association requests source review even if its literal date looks correct. The original provider order and raw text are unchanged.

The added search is bounded to 2,000 provider lines, 100 month/year anchors, eight predecessors per node, 64 traversed paths per anchor and at most 100 total emitted date regions with the earlier vertical search. It supports at most four fragments per spatial window. Budget excess fails closed. Proximity thresholds are development heuristics, not a validated column/reading-order model. Known native table intersections suppress this added pass; that cannot establish scanned-table structure or complete date coverage. Hindi/numeric date grammar, arbitrary corruption, legal date roles and omissions remain outside this check.

`benchmark/date-fragment-run.json` records a before/after audit of the same twenty saved OCR outputs from five previously inspected documents/eight source pages. The baseline was saved before code changes at commit `ac425d0`. Three unchanged EasyOCR envelopes were adapted by copying their exact single-page records, with envelope/record hashes retained; no OCR was rerun. The initial envelope-as-page manifest failed protocol validation and was retained without a published baseline; the fixed twenty-input inventory remained unchanged in the successful comparison.

All 21 prior date regions, including sixteen warnings, remain. Two same-row review regions are added, bringing warnings to eighteen. Circular 2/2024's displaced `0sth` is now flagged with its original `Dated` and month/year fragments (provider lines 8, 64, 9). Circular 15/2025's displaced `10th` is associated with `December, 2025`; source comparison shows a correct date, so this is a layout-review hint, not a new transcription-error verdict. Source crops, exact raw spans and previous diagnostics were independently checked. The scoped March/April references, variant preferences and Form 49A row reviews are unchanged.

Reproduce the current audit with `tax-pdf review-dates work/pdf-lab/demo-v2/date-fragment-inputs-v2.json --out work/pdf-lab/demo-v2/comparisons/FRESH_DATE_FRAGMENT_REVIEW`. The retained preview is `comparisons/date-fragments-v1/index.html#case-7`. The source-bound three-line circular subset in `tests/fixtures/circular2-displaced-date.json` is a development regression; only its raw text and geometry enter the detector. Tests also retain ambiguity, separate superscripts, unchanged single-line dates, unrelated nearby text, known tables and all search-budget holds. There is no measured false-warning rate, held-out precision/recall, auto-repair, engine selection, tax review, RAG publication or production integration in this increment.


## Broader native-table layout trial

`benchmark/table-layout-plan.json` fixes a seven-page development trial on three reused originals: reviewed Form 49A page 4, adjacent ITR validation-manual pages 20–22, and the middle pages 6–8 of the longer thirteen-page return-form notification. All sources were previously seen; only manual pages 20/22 are newly processed relative to the source-transfer run. The native extractor and page/table contracts are unchanged. This does not test scanned-table OCR or establish held-out performance.

```sh
tools/pdf_pipeline/.venv/bin/tax-pdf benchmark \
  work/pdf-corpus/table-layout-v1/sources.json \
  --plan tools/pdf_pipeline/benchmark/table-layout-plan.json \
  --out work/pdf-lab/demo-v2/benchmarks/FRESH_TABLE_LAYOUT_TRIAL
```

`benchmark/table-layout-run.json` records seven processed pages out of 62 original pages, twelve candidate grids and 894 retained source cells, with no failed native runs and 2.287 seconds of measured native-run time. Every original page remains accounted. All twelve drafts and source artifacts stay unaccepted/blocked. The nine filled Form 49A control values match the earlier references on the same PDF and exact native table digests; this does not separately approve the new lower-resolution render or transfer whole-table acceptance.

The ITR pages each contain an 18-row/two-column candidate grid. The longer form has 11-column grids on pages 6/7, another ten-column grid on page 7 and a twenty-column grid on page 8. Four adjacent-page inventories are retained without merging. Matching column counts cannot establish table continuity, and geometric containment (four nested Form 49A grids) cannot establish semantic hierarchy. Headers, spans, blank/covered cells, units, footnotes and cross-page relationships remain unverified. Local `structure-notes.json` binds those inventories to their exact table/source revisions; `files.json` checks every retained artifact. This is coverage and hold-behavior evidence, not table accuracy.

The review workspace is `benchmarks/table-layout-v1/tables/index.html`. Browser QA selected the ITR page-20 grid and located its first row label on the original image without confirming or saving any review choice. All twelve tables are available, and zero draft choices/revisions were recorded. The next validation work is source review of representative multi-level headers, spans and page-boundary relationships, followed by separately planned scanned/Hindi/faint-text table samples. No production ingestion or RAG changes are included.

## Source-bound table structure proposals

`review-table-structure` packages explicit engineering hypotheses separately from both raw tables and owner reviews. It does not detect continuations automatically, transcribe cells, assign units, fill blanks, select an OCR engine or accept a table. Its plan binds every selected table to the exact source PDF, artifact, render, run and table revision. Original and render checksums are verified again on the copied output before a finished directory is exposed. The original page inventory, complete artifact and all existing page renders remain available; no candidate is removed by the focused display.

```sh
tools/pdf_pipeline/.venv/bin/tax-pdf review-table-structure \
  work/pdf-lab/demo-v2/benchmarks/table-layout-v1/packages/e228528d7afc-1794039858956568000 \
  tools/pdf_pipeline/benchmark/table-structure-proposal.json \
  --out work/pdf-lab/demo-v2/comparisons/FRESH_TABLE_STRUCTURE_REVIEW
```

The proposal was authored **after** agent inspection of the original pages; it is not a frozen detector benchmark, owner confirmation or independent reference. `benchmark/table-structure-run.json` records four grids/465 preserved cells across the already processed notification pages 6–8. The focused preview is `comparisons/table-structure-v4/index.html`. It shows three checks:

1. On page 6, two broad headings each cover an Amount/Section pair. Two null positions are proposed as covered by the neighboring heading, not confirmed empty fields. The validator requires literal source anchors, ordered adjacent children, complete proposed coverage and matching horizontal edges. Other title spans, header levels and individual cells remain unreviewed.
2. The page-6 rows appear to continue in the upper page-7 grid. A literal `OR` separates this from the lower alternative form on page 7; the crop retains the separator and the next conditional title. Continuations must select boundary tables on adjacent pages, preventing a link from bypassing the lower alternative. Neither matching columns nor these geometry checks establish semantic continuity.
3. The lower page-7 grid's header appears to continue on page 8 despite a change from ten to twenty atomic columns. Seven explicit heading-fragment associations preserve both raw texts and page identities. Their displayed horizontal edges differ by at most three points (the development tolerance); equal column counts are not required and no columns or texts are joined. This is a limited same-width check, not a registration/scale algorithm or automatic page-order repair.

Grey/shaded form cells remain visible with a review hold. Their fillability, non-applicability or numeric value is not inferred from shading or empty native text. `null`, `""`, zero and dash remain distinct in the source artifact. All relationships remain `AGENT_LAYOUT_PROPOSAL_NOT_ACCEPTED`, `owner_verified=false`, `publication_eligible=false`; no table draft/history revision or reviewed name/date reference is modified. The HTML has no approval/save control. Feedback must identify the scoped relationship rather than accept the entire form or legal meaning.

Packaging is bounded to a one-megabyte plan, twenty-megabyte artifact, twenty bound tables, ten thousand selected cells, twenty source renders and sixteen-megapixel displayed images. Nonadjacent/reversed/bypassed tables, unbound cells, stale evidence, invented separators, misaligned split headings and unsafe identifiers fail closed. These checks constrain an explicit proposal; they do not measure table/OCR precision, omissions, language coverage or multi-page completeness.

Next execution gates: record the owner's scoped layout feedback; freeze separate scanned/bilingual/faint-table examples before running them; then prepare an isolated staging handoff with authenticated extraction revisions and distinct tax applicability approval. The staging design must keep original/raw/edited content, spans, header paths, cell exclusions, footnotes and cross-page links separate, require explicit review for ambiguous relationships, and invalidate approvals when any bound source or extraction revision changes. Only the accepted extraction plus applicable tax review can become retrieval material. A layout proposal or successful native extraction alone cannot satisfy either approval. No production integration is part of this increment.

## Fixed image-input table trial

`benchmark/scanned-table-plan.json` was committed at `5ac84bd` before the image-provider runs. It selects Circular 3/2026 pages 3/5 and the SFT dictionary notification page 10 as genuine scanned pages with existing OCR layers, plus notification 97 page 6 as a rasterized native control. Source pages were inspected before selection and had already been processed in the native engineering cohort. This is development coverage across related forms, not held-out performance. No cohort slot is replaced after seeing its output. Hindi/bilingual tables, real image-only original PDFs, handwriting, faint/broken grids and filled returns remain explicit collection gaps.

Both providers receive the complete 300-DPI page PNG, with no preprocessing, native/embedded text, reference table geometry, expected row counts or reviewed corrections. The English Docling/RapidOCR/TableFormer image pipeline uses the existing pinned local weights, full-page OCR, CPU/two threads, application remote services disabled and offline model settings. The image backend accepts PNG input directly; no derivative PDF is generated. A separate fixed bilingual Tesseract layout-3 attempt supplies plain text lines for comparison, not a second table-structure contract. English-only table processing does not establish Hindi table coverage.

```sh
tools/pdf_pipeline/.venv/bin/tax-pdf trial-scan-tables \
  work/pdf-corpus/sources.json \
  --plan tools/pdf_pipeline/benchmark/scanned-table-plan.json \
  --models work/tesseract-fast-models --docling-models work/docling-models \
  --out work/pdf-lab/demo-v2/benchmarks/FRESH_SCANNED_TABLE_TRIAL

tools/pdf_pipeline/.venv/bin/tax-pdf review-scan-tables \
  work/pdf-lab/demo-v2/benchmarks/scanned-tables-v1 \
  --findings tools/pdf_pipeline/benchmark/scanned-table-findings.json \
  --out work/pdf-lab/demo-v2/comparisons/FRESH_SAVED_TABLE_REVIEW
```

Prepared weights are required; these commands do not download models or call paid services. The source-bound findings option applies only to the exact recorded trial. Omit it for a new trial and compare its original pages separately.

`benchmark/scanned-table-run.json` records four processed pages from three originals/38 original pages. All eight fixed attempts returned raw output; no table was accepted. Docling emitted four grids with **202 retained cell claims and 48 uncovered positions**, with zero overlapping claims. Those are provider-grid inventory figures, not an omission/error count or accuracy score. All 58 trial file-ledger entries were independently checked. The measured sum of attempt wall times was 54.912 seconds, including local provider startup; this is neither production latency nor cost per accepted page. Full source inventories and unprocessed-page holds remain intact.

The SFT dictionary produces a plausible 19-row/five-column grid, but completeness and critical-character accuracy are unverified. Agent comparison of the other sources identifies structural defects: the scanned investment form attaches Amount to the Part C title and combines the separate B/C labels; the rasterized complex control collapses the original Amount/Section subcolumns. Its conditional title survives as a separate provider text item outside the table. Raw text is not corrected and no engine is selected. `benchmark/scanned-table-findings.json` binds these post-run agent observations to exact source images/raw outputs; they are not owner-confirmed references or automatic quality detectors. Earlier name/date references and the pending layout proposals are unchanged.

The final read-only gallery is `comparisons/scanned-table-review-v3/index.html`. It revalidates the complete upstream ledger, original/artifact/page/image bindings and raw output hashes before reinspection; it does not rerun OCR. The source trial and prior review revisions remain unchanged. A fresh report distinguishes trial code hashes from later inspection/view hardening. Known coordinate origins, positive boxes, the source/provider aspect ratio and bounded row/column spans constrain display geometry. Invalid or overlapping claims remain held; no canonical table is synthesized. The schematic uses illustrative widths and explicit “Not emitted” markers for unrepresented positions. These display markers are not invented cells, zeros, confirmed blanks or verified merged spans. A matching provider grid is still unaccepted.

The trial permits at most four pages/eight attempts, 16-megapixel PNGs and a 1,200-second overall deadline; individual Docling attempts are killed after at most 180 seconds and Tesseract after at most 120. Provider raw output is bounded to 40 MiB. Inspection limits fifty tables, ten thousand cells per table/twenty thousand per page, twenty thousand grid positions per table and one hundred thousand expanded span claims. Oversized/invalid schematics are withheld. Saved-review evidence is capped at 500 ledger entries/300 MiB; failed attempts stay in the denominator. These are application budgets, not an OS memory/network sandbox.

Next: adapt image-table **proposals** into the source-bound correction workflow, retaining unmatched positions and raw provider identities as unresolved evidence. Column/header repair needs pixel/source review rather than assumptions based on expected letter sequences or identical column counts. Preserve conditional titles, section boundaries, units and footnotes with the table. Broader unseen scanned/bilingual/faint-table validation, authenticated extraction revisions and separate tax review must precede a production retrieval handoff. The present defects prevent treating provider completion as structural acceptance.

## Source-bound table reconstruction drafts

The isolated correction workspace adds explicit split/merge and header-link controls for image-provider tables. A reconstruction uses its own source-page boundaries and rectangular cell anchors; the complete raw provider table remains unchanged. It binds the source PDF, artifact, render, trial, raw output and selected raw-table digest. Changed bindings, overlapping/missing grid positions, duplicated raw character spans, invalid headings and unexplained transcription changes fail validation. A confirmed blank needs an explicit source note; an unresolved position is never converted to a blank or zero.

Splitting adds a source boundary or uses an existing one, updates crossing spans and clears the affected transcription/source links for review. Merging requires a tiled rectangle, retains raw links and clears the merged transcription. Downstream header links to affected anchors are cleared. Released characters return to the unplaced inventory; they are not deleted. Raw links use Unicode code-point offsets. Undo/redo, browser copies, JSON import/export and conditional append-only disk revisions preserve earlier proposals. Unapplied form edits block saving until applied or explicitly discarded. The enlarged original region and proportional, independently scrollable table support side-by-side source checks.

```sh
tools/pdf_pipeline/.venv/bin/tax-pdf prepare-table-repairs \
  work/pdf-lab/demo-v2/benchmarks/scanned-tables-v1 \
  --plan tools/pdf_pipeline/benchmark/table-repair-plan.json \
  --out work/pdf-lab/demo-v2/comparisons/FRESH_TABLE_RECONSTRUCTION

tools/pdf_pipeline/.venv/bin/tax-pdf check-table-repair \
  PATH_TO_BOUND_SOURCE_PACKAGE PATH_TO_DOWNLOADED_RECONSTRUCTION.json

tools/pdf_pipeline/.venv/bin/tax-pdf serve-review \
  --root work/pdf-lab/demo-v2 \
  --store work/pdf-lab/table-reconstruction-history.sqlite3 --port 8789
```

The example generator supports exactly two source-bound development cases, using geometry and transcriptions authored after source inspection with native grid aids. It is **not an automatic repair algorithm**. The starting views are scoped authored representations of observed defects; the complete unedited provider JSON and original PDF remain linked. The prepared investment-form proposal restores a separate Amount column and B/C labels within Part C. The complex-form proposal restores Amount/Section pairs beneath B and C within a two-row heading band. Other statutory headings, conditional titles, units/reference rows, notes, verification, shaded entry fields and complete page relationships remain unreviewed and available in the original/raw evidence.

`benchmark/table-repair-run.json` records the final `comparisons/table-reconstruction-v5/index.html`, code/file bindings and all 58 verified upstream ledger entries. The two provider tables retain 79 raw cells/3,659 characters. Prepared proposals still leave 19/5 unresolved cells and 292/3,062 unplaced raw characters respectively. Those figures describe scoped evidence accounting, not OCR omissions, correctness or an accuracy score. The complex example releases extraneous linked fragments, so its unplaced count increases. No raw text is lost. Four agent-authored disk revisions (starting/prepared per example) and a verified backup remain outside Git and the served directory.

All reconstructions force `TABLE_RECONSTRUCTION_DRAFT`, `owner_verified=false` and `publication_eligible=false`. Server validation checks evidence/geometry consistency; a successful save does not approve extraction or authenticate the self-reported reviewer. Source-bound regression fixtures exercise these previously inspected cases without an accepted reference, model download or production credentials. Local validation totals 285 Python tests and 14 JavaScript tests, plus lint/format and browser split/merge, undo, reload recovery, pending-edit guards and source-highlight checks.

Next: collect scoped owner feedback on the two prepared repairs; extend evaluation to unseen scanned/bilingual/faint tables and full table context; then implement authenticated extraction revisions and distinct tax applicability approval in isolated staging. Unplaced/unreadable text, critical fields, footnotes and cross-page relationships need explicit treatment before any retrieval handoff. No production ingestion, chunking or embeddings change in this increment.


The owner subsequently confirmed the fifteen displayed unresolved investment-form cells (`r4c2`–`r4c6`, `r5c2`–`r5c6`, `r6c2`–`r6c6`) as blank. `benchmark/table-blank-review.json` preserves the literal feedback, screenshot hash, source binding and exact prior cell states. Four existing browser blank choices were preserved separately. The final source-bound local revision has nineteen blank cells and no unresolved cells within this scope; 292 provider characters remain unplaced and the rest of the document is still unreviewed. This is scoped chat feedback relayed into local history, not authenticated whole-table or tax approval.

The editor previously rejected blank-state edits without a note and showed the error only in the page header. Applying an explicit blank state now records that choice automatically when the note is empty; custom notes remain unchanged. Changed transcriptions still require a source note, and imported blank drafts without one still fail validation. Feedback also appears beside Apply. The current workspace is `comparisons/table-reconstruction-v6/index.html`; the earlier immutable examples and backups remain retained. A regression checks the blank transition, custom notes, unchanged raw links, other cell states and non-publishing flags. All fifteen JavaScript tests pass; browser QA saved/reloaded all nineteen blank choices.

## Fresh-source table transfer and staging design

`benchmark/table-transfer-plan.json` was committed at `cb9a97f` before provider execution. Two newly acquired official PDFs were absent from the 24 observed prior local source hashes (87 saved artifacts), but their circular/form families have prior exposure. Four pages were selected after source-image inspection: two thin-sheet scanned Circular 3/2025 pages with embedded OCR, plus two rasterized native Notification 7/2023 audit-form controls. Both image providers receive only full-page pixels/settings; no native cells, reviewed blanks, corrections or expected output. The audit table body is English; its Hindi running header does not establish Hindi table coverage.

The legacy salary URL failed; its exact replacement link was acquired from the public official detail page using the existing safe fetcher. Failed attempts remain recorded without replacing either source slot. `benchmark/table-transfer-run.json` binds acquisition, source/code/weight revisions, the four-page trial and the read-only review at `comparisons/table-transfer-v1/index.html`. All eight provider attempts completed. Six grids retain 172 raw cell claims and 66 uncovered positions, with no overlapping claims; these are inventory counts, not accuracy or omission scores. All 53 upstream ledger entries and both saved-review entries were independently checked. Original page inventories account for all forty source pages; only the four selected pages were processed.

Source comparison found material failures despite a complete claimed grid: a scanned surcharge table corrupts section identifiers and truncates a condition. Audit-form output drops several choice labels and does not preserve the complete nested form structure. Candidate Markdown expands shared spans into repeated display text; that is not proof of repeated source content. Plausible-looking other grids remain unverified. `benchmark/table-transfer-findings.json` binds the agent observations to original images/raw outputs; no correction, owner acceptance, cross-page merge or engine selection follows from them.

```sh
tools/pdf_pipeline/.venv/bin/tax-pdf trial-scan-tables \
  work/pdf-corpus/table-transfer-v1/sources-v3.json \
  --plan tools/pdf_pipeline/benchmark/table-transfer-plan.json \
  --models work/tesseract-fast-models --docling-models work/docling-models \
  --out work/pdf-lab/demo-v2/benchmarks/FRESH_TABLE_TRANSFER
```

[The staging handoff design](../../docs/pdf-staging-handoff.md) defines the next implementation slice: a pure, versioned import validator with complete-clean and incomplete-table fixtures, then authenticated extraction revisions, separate tax review and a dry-run release manifest. It identifies the current ingestion/schema boundary and keeps lab imports away from existing `TaxChunk` writes. Production authentication integration, storage selection, acceptance and retrieval are designed but not implemented here. No production credentials, paid model/OCR service or index changes were needed for this trial.

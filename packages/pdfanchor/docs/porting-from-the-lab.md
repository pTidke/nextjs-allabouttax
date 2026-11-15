# Porting from the lab

`tools/pdf_pipeline/` is the laboratory: about 11,000 lines, 328 tests, and a record of what works on real Indian tax documents. `pdfanchor` is the product that comes out of it. This page says what moves, in what order, and what stays behind.

## What changes in spirit

The lab never chooses: no engine is selected, nothing is accepted, every result is an experiment for a person to inspect. The engine keeps the lab's evidence rules and adds the one thing the lab refuses to do, a decision.

| Kept from the lab | Changed |
| --- | --- |
| Every line and cell has a source box | A policy decides accepted, flagged or blocked |
| Raw text is preserved; normalised text is separate | One command runs everything |
| Text is never repaired by rule | Output includes Markdown and chunks |
| Every page is accounted for, including failures | Generic: no tax-specific knowledge |
| Engine versions and settings are recorded | Readings are compared by rule, not shown side by side |
| No model API, no network | |

## Order of work

1. **Reference pages first.** Before porting more, build the verified reference set the lab started (`reference_pack.py`, `reference_eval.py`, `benchmark/references/`). Port the CER/WER scorer as `pdfanchor.evaluate`, and add the two numbers that decide whether the policy is safe: the share of accepted lines that are wrong (false accepts), overall and on critical tokens. Calibrate `Policy.min_similarity` from it.
2. **Isolation and budgets.** Port the per-page subprocess with time, memory, pixel and glyph limits from `runner.py` and `worker.py`. Needed before running on files you did not choose.
3. **Second reader.** Finish `ocr/easyocr.py` from `easyocr_probe.py`: pinned weights, offline mode, time limit. Add its Hindi model and measure it; today Hindi has one reader.
4. **Pinned Tesseract weights.** `ocr_compare.py` verifies weight hashes and records them. Bring that in, and record the `tessdata` variant in `Engine.components`. Benchmark `tessdata_best` against `tessdata_fast`.
5. **Scan recovery.** `scan_recovery.py` and `targeted_ocr.py`: quarter-turn detection, row segmentation, the numeric profile, background flattening. Each becomes a retry strategy the pipeline tries when the first reading fails a rule, with every attempt kept as a `Reading`.
6. **More validators.** From `date_review.py`, `date_spatial.py`, `date_regions.py` and `date_disagreement.py`: split dates and displaced fragments. Then amounts, percentages and section references.
7. **Tables.** `table_structure.py`, `table_inventory.py`, `table_projection.py`, `scan_tables.py`: header paths, merged cells, units, footnotes, tables on scanned pages. Tables stay "flagged" until these exist and are measured.
8. **Large documents.** Page-group scheduling with resumable output, so a 600-page Act can be processed in a job with a time limit.
9. **Reading order.** Multi-column pages and footnotes. `structured_content.py` has the row-band proposal.

## What stays in the application

| Lab module | Why it stays |
| --- | --- |
| `staging.py`, `staging_bundle.py`, `staging_demo.py` | The staging import contract belongs to the review application. It should take `document.json` as its input. |
| `review.py`, `review_server.py`, `review_store.py`, `compare_review.py`, `*_view.py` | Local review pages. The hosted staging inbox replaces them. |
| `corpus.py`, `scripts/tax-corpus.ts` | Reads this application's database. |
| `benchmark/*.json` | Feedback bound to specific official documents. The reference pages can become a public test set if the documents may be redistributed; check first. |
| `content_scope.py`, `content_classification.py` | Administrative-content rules specific to CBDT circulars ("Copy to", Guard File). These become an optional profile outside the generic engine. |
| Tax metadata rules (instrument number, commencement, amendments) | Tax-specific. They read `document.json` and live with the application, or in a separate `pdfanchor-india-tax` add-on. |

## Connecting the application

The application should treat the engine as a black box that produces `document.json`:

- The extract workflow runs `pdfanchor convert` for each new or changed official document.
- The staging importer builds a candidate from `document.json`: flagged lines become the review queue; accepted lines need no tick, apart from an audit sample.
- The release adapter turns accepted extraction plus an accepted tax decision into retrievable items, starting from `chunks.jsonl`.
- The local repair provider calls the engine's OCR adapters on a crop.

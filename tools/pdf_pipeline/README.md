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

## Contract and quality policy

`schemas/artifact.schema.json` is generated from `tax_pdf.models`. Coordinates are displayed PDF-page points with a top-left origin. Original page index and printed page label are distinct. Line polygons and native glyph polygons are retained; exact character-span-to-glyph alignment across inserted spaces/ligatures is not yet implemented. Future LangExtract input must retain an explicit span map rather than use an untracked Markdown conversion.

Raw text is preserved; NFC-normalised text is a separate display field. No tax rate, date, identifier or negation is automatically repaired. Table grids are candidates: null/covered cells, empty strings, zero and dash are distinct; merged spans, header paths, units and footnotes are unverified and block acceptance. Reading order is a geometric candidate, not verified legal structure.

Corrections, reviewer acceptance, tax applicability, source-authority decisions, cross-document dependencies, cloud storage/queues, OS sandboxing and production integration are future milestones. LangExtract/Azure evaluation begins after a labelled acceptance rubric and the relevant service budget are agreed. No paid resources were provisioned for this increment.

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

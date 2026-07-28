# SP BOM verifier artifacts

The repository runner writes one run directory under `.tmp/bom-verification/` by default.

## Root files

- `manifest.json`: run version, git commit, input, API host, non-secret auth mode, file counts, per-file state, quote/job IDs, timings, and artifact paths.
- `report.md`: compact cross-file result table.

`schemaVersion` is currently `sp-bom-verification-v1`. Paths and IDs are local evidence and may be included in a report; authentication material is never written.

## Per-file directory

- `source.json`: absolute source path, byte size, and SHA-256.
- `upload.json`: exact `POST /api/bom/quotes` response.
- `job-snapshots.jsonl`, `job-final.json`: parser polling responses.
- `quote-prepared.json`: exact response after analysis persistence.
- `quote-built.json`: exact response after all parsed sheets are selected and built.
- `quote-snapshots.jsonl`: enrichment and part-data polling responses, when polling was needed.
- `part-data-prepare.json` or `part-data-prepare-error.json`: one UI-equivalent retry needed to open candidate panels.
- `quote-detail.json`: exact final quote-detail response used as the screen source.
- `candidates/<itemId>.json`: exact candidate-drawer response for every active item.
- `candidates/<itemId>.error.json`: per-row capture failure without aborting other rows.
- `comparison-pages/<page>.json`: exact comparison-modal response at page size 50.
- `comparison.json`: ordered collection of all raw comparison page responses.
- `api-trace.jsonl`: method, path, expected contract, status, elapsed time, and error text; no request/response bodies or auth headers.
- `summary.json`: derived screen counts and capture-completeness checks.
- `report.md`: derived Korean human-readable file report.
- `error.json`: terminal failure evidence. Quote/job IDs remain present if creation had already succeeded.

## Exact versus derived

Exact API evidence:

- upload, job, prepared/build/detail responses;
- candidate responses;
- comparison-page responses.

Derived convenience output:

- manifest counts;
- summary checks;
- Markdown reports.

The runner validates exact responses with `@sp/api-contract`. A schema failure is a contract mismatch and must not be reinterpreted as a successful upload.

The `screen` block in `summary.json` uses the same `@sp/utils` presentation function imported by sp-vue:

- `matched`: non-excluded rows with a non-`none` match status;
- `review`: unselected engine-review rows without a stock-blocking reason;
- `unmatched`: remaining unselected rows;
- `excluded`: engine-excluded rows;
- `nostock`, `uncosted`, `pendingReview`: the same UI card semantics.

## Mechanical checks

- `build-ready`: selected sheets built successfully.
- `enrichment-terminal`: supplier enrichment is no longer running.
- `screen-item-count`: presentation function saw every final detail item.
- `candidate-capture-complete`: every active item had a candidate response. This fails when part data is unavailable.
- `comparison-capture-complete`: comparison rows equal final active detail rows.

These checks verify completion and evidence capture. They do not prove correct extraction or candidate suitability.

## Side effects and replay

Each run follows the real customer path and can leave:

- a draft quote and quote items;
- an uploaded source file;
- engine jobs and supplier calls;
- persisted candidate snapshots;
- catalog ingest and index activity.

Deleting the local artifact folder does not undo those effects. Re-running the same file can produce different live supplier price, stock, cache, or availability data while still following the identical application path.

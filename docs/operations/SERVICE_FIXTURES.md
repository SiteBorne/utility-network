# Service Fixtures (SUN-0600)

## Fixture sources

Rather than duplicating fixture corpora, service-runtime reuses already-accepted
fixtures directly:

- **SEC/HTTP adapter fixtures**: loaded straight from
  `packages/provider-adapters/fixtures/**` (e.g.
  `sec-edgar/submissions-success.json`) via
  `tests/support.ts::loadAdapterFixture` — these are already-committed,
  already-accepted SUN-0300 fixtures, not re-derived or copied.
- **Document-worker results**: `fixtures/document-worker-results/*.json` are
  real `WorkerResult` JSON captured by actually running SUN-0400A's
  `local_runner.py` CLI against its own committed fixture PDFs
  (`services/modal-worker/fixtures/pdf/*.pdf`) — not hand-authored. See the
  capture commands below.
- **HTML page fixtures**: inline strings in each web-context test (small,
  self-contained; not worth a separate fixture file).

## Regenerating document-worker-results fixtures

```bash
cd services/modal-worker
.venv/bin/python -m modal_worker.local_runner fixtures/pdf/native_text_one_page.pdf > /tmp/native.json
.venv/bin/python -m modal_worker.local_runner fixtures/pdf/multi_table.pdf > /tmp/table.json
.venv/bin/python -m modal_worker.local_runner fixtures/pdf/scanned_page.pdf > /tmp/scanned.json
.venv/bin/python -m modal_worker.local_runner fixtures/pdf/malformed.pdf > /tmp/malformed.json   # exits 1 — a `failed` WorkerResult, not an error
.venv/bin/python -m modal_worker.local_runner fixtures/pdf/encrypted.pdf > /tmp/encrypted.json   # exits 1 — a `failed` WorkerResult, not an error
```

Then copy the relevant file into
`packages/service-runtime/fixtures/document-worker-results/<name>.json`. Only
re-run this if SUN-0400A's extraction behavior intentionally changes — these
fixtures should otherwise stay pinned so service-runtime's tests stay
deterministic and independent of the document worker's exact library versions.

## The DocumentWorkerBridge test double

`FixtureDocumentWorkerBridge` (`services/document-evidence/worker-bridge.ts`)
replays a captured `WorkerResult` for a given scenario key — never spawns a
process. `SubprocessDocumentWorkerBridge` is the real, production-shaped
implementation (spawns `python -m modal_worker.local_runner`); it is exercised
by exactly one integration test (`worker-bridge.subprocess.test.ts`),
automatically skipped when the document-worker's `.venv` is absent — mirroring
`packages/provider-adapters`' live-gate pattern (opt-in, never a hard dependency
of the fast default `pnpm test` path or the Node CI job).

## The fixture matrix

`fixtures/SERVICE_FIXTURE_MATRIX.yaml` documents each scenario (`scenario_id`,
`service_id`, category, dependency fixtures, expected result class, test
reference). `scripts/verify-fixtures.ts` executes the matching TypeScript
scenario for every row and asserts the actual `result_class` matches — a
behavioral regression gate, not a file-existence check — and additionally
cross-checks that the YAML row set and the TS scenario set are in 1:1
correspondence (fails on any orphaned row or scenario, or a duplicate
`scenario_id`).

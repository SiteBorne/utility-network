# R3-A4-55 — Provenance + Evidence Graph production qualification

Date: 2026-09-28. Staging/qualification only. Production traffic, D1 and
Workflow registration are unchanged.

## Lines and candidates

|                                            | Base (live)               | Candidate commit                         | Branch                | Artifact sha256 | Uploaded version (no traffic)        |
| ------------------------------------------ | ------------------------- | ---------------------------------------- | --------------------- | --------------- | ------------------------------------ |
| EDGE `siteborne-utility-edge`              | 19477db8 / 5705e934 @100% | d7890e52443d10f4358b9e98be90fcb800d0838f | r3-a4-edge-provenance | db8b2e19…0356   | b356d711-cbed-46ad-afb1-6b1dad0bca68 |
| HOST `siteborne-paid-continuation-runtime` | d939f3b2 / 639db8bc @100% | 314e24e8190ef29abdd1882b32c3e69f5c9162c1 | r3-a4-host-provenance | 930f4235…c8a8   | bed4dde0-f6da-413a-b736-06832ef2637b |

Each candidate is exactly one commit on its live source. Neither pulls in
metadata-vcm-qualification history, the evidence-graph package, or migration
0015: the runtime observation module has no imports.

- EDGE (7 files, +237/−2): `[version_metadata]` binding,
  `runtime-observation.ts`, optional `runtime` object on `GET /health` (strict
  contract and OpenAPI; absent when unbound, so the pre-A4 shape is unchanged),
  optional `Env` field, test.
- HOST (4 files, +272): `[version_metadata]` binding, the identical
  `runtime-observation.ts`, one void emitter call at the top of
  `PaidContinuationWorkflow.run()` (Workers Logs event
  `siteborne.runtime_version`), test. The HTTP surface is still an inert 404. No
  step, ordering, retry, `provider_dispatched_at`, stage-fence or settlement
  change.

## Shared (metadata-vcm-qualification)

- `migrations/0015_evidence_graph.sql`: append-only, content-addressed
  `evidence_nodes`/`evidence_edges`. Columns are CHECKed against the canonical
  body, `authority` is pinned to `'NONE'`, triggers deny UPDATE/DELETE and
  conflicting re-insert, edges must reference existing nodes, and every object
  uses `IF NOT EXISTS`.
- Test migration loaders now keep `CREATE TRIGGER … BEGIN …; END` whole
  (`split(/;(?!\s*END\b)/)`; 55 files). Wrangler's own D1 splitter already
  handles compound statements.
- evidence-graph additions: the `CONFLICT` chain status, `RUNTIME_SELF_REPORT`
  observations (`runtime-report.ts`, which has no expected-version input), a D1
  append-only writer and verifying reader (`d1-store.ts`), staged capture
  (`record*Stage`, `verifyUploadStage`), toolchain provenance
  (`ORIGINAL_RELEASE_TOOLCHAIN` / `REBUILD_TOOLCHAIN`), and firewall F6–F9.
- `scripts/release/release-provenance.mts`: stages A–H. It runs the dry-run
  build itself (repeat N, bytes must agree), issues Cloudflare GETs only, and
  stage H renders SQL without executing it.
- `scripts/release/check-evidence-firewall.mts`: F4 and F6–F9 against any
  checkout.

## Gates

| Gate                                                                                                                                                                                               | Result                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Migration 0015 tests (insert, idempotent duplicate, UPDATE/DELETE denied, broken reference, conflicting content, projection/authority CHECK, batch rollback, tampered-row rejection, rendered SQL) | 12/12                                                       |
| Old/new EDGE and HOST, D1 suites on schema through 0015                                                                                                                                            | 0 candidate-specific failures (see compat section)          |
| EDGE focused (A2 result auth, A3 reclaim, cron, MCP, readiness, health, catalog, contracts, observation)                                                                                           | 332/332                                                     |
| HOST focused (provider authority, settlement, workflow, recovery, lifecycle, host config, observation)                                                                                             | 304 pass / 30 env-skipped (same skips on base)              |
| Evidence package + firewall mutation tests                                                                                                                                                         | 77/77                                                       |
| Full suite, shared branch                                                                                                                                                                          | 4,911 pass / 79 skip / 0 fail                               |
| Firewall F4, F6–F9 over shared, EDGE candidate, HOST candidate and live host source                                                                                                                | PASS ×4                                                     |
| Reproducible builds (×2 each)                                                                                                                                                                      | EDGE db8b2e19… ×2, HOST 930f4235… ×2                        |
| Local chain source → build → artifact                                                                                                                                                              | CRYPTOGRAPHICALLY_BOUND (both)                              |
| Upload VERIFY (platform bytes = artifact)                                                                                                                                                          | PASS (both)                                                 |
| Config parity vs live                                                                                                                                                                              | only difference is the `CF_VERSION_METADATA` binding (both) |

Finding fixed during qualification: the first 0015 draft had no `IF NOT EXISTS`,
which broke the live-harness re-run test
(`nevermined-live-migration-idempotency`). It was corrected before any commit.

`reconcile-payment-attempts.contract.test.ts` times out at the default 5 s under
load and passes 38/38 with `--testTimeout=60000`, with and without 0015. This is
pre-existing.

## Production plan (design only — requires separate authorization)

1. Read-only preflight: both deployments still single-version on 5705e934 /
   639db8bc; D1 at 0014; evidence tables absent; paid ingress off.
2. `wrangler d1 migrations apply siteborne-utility --remote` (0015 only);
   confirm `d1_migrations` shows 0015.
3. Schema readback: 12 `evidence_*` objects; UPDATE/DELETE are denied on an
   empty table (use a `SELECT RAISE` probe only; never write test rows to
   production).
4. Old runtimes + new schema: health/readiness on the live edge; no errors in
   host logs. Neither runtime references the new tables.
5. EDGE direct single-version cutover:
   `wrangler versions deploy b356d711-…@100%`. Never a split or 0% member,
   because the edge runs the `* * * * *` cron and a 0% member would still
   receive scheduled invocations.
6. `GET https://utility.siteborne.net/health` →
   `runtime.platform_version_id == b356d711-…`.
7. `release-provenance.mts deployment` → `runtime --health-url …` →
   `persist --out-sql` → apply the rendered SQL (separately authorized write) →
   `evaluate`: expect COMPLETE_PLATFORM_ATTESTED with OBSERVED_RUNTIME.
8. Host drain gate: the canonical 96d16be5 predicate plus Cloudflare lookup = 0,
   and 0 nonterminal instances.
9. HOST direct single-version cutover: `versions deploy bed4dde0-…@100%`.
10. HOST runtime observation: the next real run, or a separately authorized
    zero-effect probe, emits `siteborne.runtime_version`. Save the event and run
    `runtime --log-event-json`.
11. Capture and persist the HOST chain as in step 7.
12. `loadEvidenceGraph` read-back from production: `rejected = []`, no
    conflicts.
13. Re-run `check-evidence-firewall.mts` on both deployed commits.

Rollback: forward-fix preferred. The previous version IDs remain available, and
0015 is additive (rollback means stop writing).

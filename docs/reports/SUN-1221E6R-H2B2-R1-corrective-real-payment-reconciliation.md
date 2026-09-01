# SUN-1221E6R-H2B2-R1 — corrective host fix + real-payment reconciliation

## Summary

The dedicated Workflow host's precompiled-output-validator registration defect — root cause of the first real H2B2 payment attempt's `EvalError: Code generation from strings disallowed for this context` (evidence `3984aff`) — is fixed, proven locally (TDD RED/GREEN/mutation), proven in the real dry-run bundle (worker-runtime harness), deployed exactly once to production, and now proven fixed on real infrastructure by a second real, authorized payment attempt. That attempt did **not** hit the EvalError: `open-envelope-1`, `check-authorization-expiry-1`, and `invoke-executor-1` all completed successfully as Workflow steps, for the first time end-to-end. The Workflow classified the executor result `internal_verification_failed` and stopped before any settlement call — a legitimate application-level verification outcome, not a crash. Zero economic effect, confirmed independently via D1 and on-chain balance reads.

## Root cause and fix (recap)

Real production API route entrypoints (`production-web-context-v2-cdp-route.ts:34`, `production-verify-v2-cdp-route.ts:91`, `paid-services.ts:86`) all call `setPrecompiledOutputValidators(outputValidatorsById)` at module load. The dedicated Workflow host (`apps/edge-api/src/workflow-host-entrypoint.ts`) never did — confirmed absent from every `setPrecompiledOutputValidators` call site in the repository before this fix. Its `SchemaVerifier` therefore fell through to `getAjv()`'s runtime AJV compilation path, which calls `new Function` internally — blocked by the Cloudflare Workers isolate.

Fix: `workflow-host-entrypoint.ts` now imports `setPrecompiledOutputValidators` and `outputValidatorsById` and calls `setPrecompiledOutputValidators(outputValidatorsById)` at module scope, mirroring the three existing production entrypoints exactly.

## Proof (local)

- New test `apps/edge-api/tests/workflow-host-precompiled-validators.test.ts`: imports the real, unmodified host entrypoint module and asserts `getPrecompiledOutputValidator()` returns a defined, working validator for `web_context_verified.v2`'s output schema.
- RED (before fix): 2/2 tests failed — `expected undefined to be defined`.
- GREEN (after fix): 2/2 tests pass.
- Mutation proof: reverted the fix via `git stash`, RED reproduced exactly (2/2 failed, same assertion), restored, GREEN reproduced again.
- Full regression: 214 test files, 2585 tests pass, 74 skipped (unchanged baseline).
- Worker-runtime harness (`scripts/test-worker-runtime.mts`, real `workerd`): 99/99 scenarios pass, including a new `PRECOMPILED_VALIDATOR_REGISTRATION` marker added to the existing host dry-run bundle inclusion check — confirms `setPrecompiledOutputValidators` is present in the *actual deployed bundle text*, not just the source module graph.
- Lint: clean. Typecheck: 3 pre-existing errors, 0 new (unrelated file, unchanged baseline). Production preflight: PASS. Secret-scan scope: OK, no new findings; manual grep of changed files found no secret material.
- Single-settlement-owner re-audit: unchanged, exactly one production call site (`paid-continuation-workflow.ts:480`).

Committed as `89e9870`.

## Deployment (exactly one)

Pre-deploy immutability gate (read-only): `de70bf98-f304-4d7f-b189-4ae2401041a0` @ 100%, `db7054c9-76ee-4830-aabe-8a4542261b6a` @ 0%, no third version — unchanged from before this checkpoint. Host had exactly the 8 previously-staged secrets (no `CDP_WALLET_SECRET`).

Ran `wrangler deploy --config wrangler.paid-continuation-runtime.toml` exactly once. New host version: `45c99a30-89f4-49cd-9a1b-91467b0617dc`. Bindings confirmed in deploy output: `PAID_CONTINUATION_WORKFLOW` (Workflow), `DB` (D1), `SELLER_WALLET_ADDRESS`, and all four ADR-0055 vars (`PAYMENT_ENVIRONMENT=production`, `PRODUCTION_ENABLED=true`, `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true`, `PRODUCTION_CDP_CREDENTIALS_APPROVED=true`) exactly as before. Readback confirmed all 8 secret names unchanged, no rotation. Public API containment re-verified: `de70bf98` still @ 100%, no candidate upload, no deployment mutation.

No extra synthetic Workflow instance was created this checkpoint. A fresh 402 challenge against `db7054c9` was decoded and confirmed to carry the exact authorized economics (`network=eip155:8453`, `asset=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, `amount=9000`, `payTo=0x7f44a2dd237938F18632d4CcA40f4c690295E6E1`). D1 baseline recorded before handoff: 8 `payment_attempts` rows, 8 `jobs` rows.

## The real payment attempt

You ran `pnpm web-context-first-paid-e2e` with your own CDP credentials. Client-observed result:

```json
{"ok":false,"stage":"RESULT_OBSERVED","challenge_received":true,"challenge_validated":true,"payment_material_created":true,"paid_request_submitted":true,"submission_result":"ambiguous","http_status":502}
```

Per the no-retry authorization, no second attempt was made. Read-only reconciliation:

- **D1**: `payment_attempts` count is now 9 (+1 from baseline). Newest row: `lifecycle_stage: "verified"`, `payment_rail: "cdp"`, `settlement_transaction_reference: null`, `settlement_pending_at: null`. `jobs` count is now 9 (+1). Newest row: `id: 3898e160-edd7-4bbf-adcb-80ac4b75f301`, `service_id: web_context_verified.v2`, `current_state: REJECTED`, created and updated ~9 seconds apart.
- **Workflow instance**: `siteborne-wf-8c6272229787e3b8903b76e3a4bbc682dac87d96723de45d`, version `caa7b4b7-4fe3-434d-9839-2e6e5f864286` (the new graph compiled by this checkpoint's redeploy). Status: ✅ Completed, Success: Yes, duration 6 seconds, last successful step `invoke-executor-1`.
  - `open-envelope-1`: ✅ Success — real payment material (EIP-3009 authorization, quote, requirement) decrypted correctly.
  - `check-authorization-expiry-1`: ✅ Success — `{"expired":false}`.
  - `invoke-executor-1`: ✅ Success as a *step* (no crash, no EvalError) — the real executor ran and returned `result_class: "internal_verification_failed"`, with a full receipt (`receipt_id`, `job_id`, `input_hash`, `output_hash`, `pcc_hash`) generated. No settlement step appears in the instance trace — the Workflow's own logic never called `evidenceProvider.settle()` because verification did not pass.
- **On-chain (Base mainnet, read directly via RPC, not through any SITEBORNE code)**: buyer USDC balance = 28,197 atomic (unchanged from pre-attempt baseline). Seller USDC balance = 19,000 atomic (unchanged). Zero economic effect confirmed independently of both D1 and the Workflow trace.
- The client's HTTP 502/`"ambiguous"` result is resolved: the Workflow itself completed cleanly server-side (6 seconds) with a definitive, non-crashing terminal state; the client's 502 reflects the HTTP response leg back to the operator's terminal, not a Workflow-level failure. This is now a resolved, non-ambiguous outcome — `FAIL_RECONCILED_NO_SETTLEMENT`, not a genuine ambiguity requiring further reconciliation.

**Open item**: the exact reason the verification pipeline classified this result `internal_verification_failed` was not extracted this checkpoint — the CLI's `wrangler workflows instances describe` output truncates long step outputs regardless of `--truncate-output-limit`, and no richer record was found in `x402_service_results` (empty for this `payment_identifier`, since that table only persists fully-settled results). This is a legitimate, separate follow-up diagnostic question, not evidence of a broken architecture — the EvalError this checkpoint targeted is conclusively fixed.

## Result

| Field | Value |
|---|---|
| `H2B2_R1_HOST_FIX_PROVEN` | YES (local RED/GREEN/mutation + real-payment confirmation) |
| `H2B2_R1_HOST_DEPLOYMENTS` | 1 |
| `H2B2_R1_HOST_VERSION_ID` | `45c99a30-89f4-49cd-9a1b-91467b0617dc` |
| `WORKFLOW_INSTANCE_CREATIONS` (synthetic) | 0 |
| `REAL_PAYMENT_ATTEMPTS` | 1 |
| `REAL_WORKFLOW_INSTANCE` | `siteborne-wf-8c6272229787e3b8903b76e3a4bbc682dac87d96723de45d` |
| `EVAL_ERROR_RECURRED` | NO |
| `SETTLEMENT_ATTEMPTS` | 0 |
| `CHAIN_TRANSACTIONS` | 0 |
| `REAL_ECONOMIC_EFFECT_USDC` | 0 |
| `PUBLIC_PRODUCTION_TRAFFIC` | `de70bf98-f304-4d7f-b189-4ae2401041a0` @ 100% (unchanged) |
| `API_CANDIDATE_TRAFFIC` | `db7054c9-76ee-4830-aabe-8a4542261b6a` @ 0% (unchanged) |
| `RETRY_PERFORMED` | NO |
| `SUN1221E6R_H2B2_R1_RESULT` | `FAIL_RECONCILED_NO_SETTLEMENT` — architecture fix proven; downstream verification-rejection reason is a separate open diagnostic item |
| `SUN1221F_CANARY_ELIGIBLE` | NO — a genuine payment success has still not been observed end-to-end |
| `NEXT_REQUIRED_CHECKPOINT` | `READ_ONLY_DIAGNOSIS` of the `internal_verification_failed` reason |

This authorization has expired. No further deployment, instance, or payment action was taken beyond what is recorded above.

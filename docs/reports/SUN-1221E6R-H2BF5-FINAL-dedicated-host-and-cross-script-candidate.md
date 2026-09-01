# SUN-1221E6R-H2BF5-FINAL — dedicated Workflow-host qualification + cross-script API candidate

## Result: PASS

## Lineage

- R1 implementation: `4428528` — fail-closed Workflow entrypoint (throw, not resolve, on unavailable dependencies)
- R1 evidence: `fe7efb5`
- C1 evidence: `701cf50` — false-success bug + graph-compilation defect both confirmed fixed on real infra; new Modal-credential gap found
- C1B evidence: `ae46400` — complete dependency-closure trace: 8 required secrets + 4 governed vars (not just the 3 Modal secrets)
- This checkpoint: host redeploy with complete 8-secret/4-var set, real safe-probe qualification, cross-script API candidate

## §2 — Complete transitive dependency closure

`buildProductionPaidContinuationWorkflowDependencies` constructs `deps.*` **once**, entirely upfront, from `env.*`; every subsequent line in `runPaidContinuationWorkflow` (executor, PCC, receipt signing, settlement, persistence) reads only the already-validated `deps` object, never `env.*` again. This means the C1B matrix (built by tracing every `env.X` read reachable before `open-envelope`) is the **complete** dependency set for the entire Workflow, not merely a "before open-envelope" subset — confirmed by direct source read this checkpoint.

| Name | Type | Required | Source callsite |
|---|---|---|---|
| `DB` | Binding | Yes | `production-dependencies.ts:166` |
| `PAYMENT_CONTINUATION_ENCRYPTION_KEY` | Secret | Yes | `production-dependencies.ts:169` |
| `PAID_RECEIPT_SIGNING_PRIVATE_KEY` | Secret | Yes | `web-context-v2-cdp-composition.ts:167` |
| `PAID_RECEIPT_SIGNING_KEY_ID` | Secret | Yes | `web-context-v2-cdp-composition.ts:170` |
| `MODAL_WEBCTX_ENDPOINT_URL` | Secret | Yes | `web-context-v2-cdp-composition.ts:175` |
| `MODAL_WEBCTX_PROXY_KEY` | Secret | Yes | same |
| `MODAL_WEBCTX_PROXY_SECRET` | Secret | Yes | same |
| `PAYMENT_ENVIRONMENT` | Var | Yes | `production-payment.ts:56` |
| `PRODUCTION_ENABLED` | Var | Yes | same |
| `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP` | Var | Yes | same |
| `PRODUCTION_CDP_CREDENTIALS_APPROVED` | Var | Yes | same |
| `CDP_API_KEY_ID` | Secret | Yes | `web-context-v2-cdp-composition.ts:208` |
| `CDP_API_KEY_SECRET` | Secret | Yes | `web-context-v2-cdp-composition.ts:209` |
| `SELLER_WALLET_ADDRESS` | Var | Yes | already present |

`DEPENDENCY_CLOSURE=PASS`. No item outside the authorized 8-secret + 4-var envelope was found.

## §5 — Modal secret recovery

Recovered from `.dev.vars` (approved local source, established Q6H). Structurally validated (endpoint URL matches `https://*.modal.run`, proxy key/secret match `wk-`/`ws-` prefix convention) without invoking Modal. `MODAL_SECRET_RECOVERY_COMPLETE=YES`, `MODAL_SECRET_SET_STRUCTURALLY_VALID=YES`. No new Modal credential generated.

## §6 — Existing five revalidated

- Continuation key: base64-decodes to 32 bytes (AES-256). PASS.
- Receipt private key: 64 hex chars (32-byte raw Ed25519 seed); sign/verify round-trip via `@noble/ed25519` PASS.
- Receipt key ID: matches `^kid_[a-z0-9]{24}$`. PASS.
- CDP key ID/secret: present, correct length/format. PASS.

## §11-12 — Local production-composition proof (before spending the deployment)

Built a one-off Miniflare-D1-backed test driving the **real, unmocked** `PaidContinuationWorkflow` class + `buildProductionPaidContinuationWorkflowDependencies` with the complete 12-field env and a **real** `sealContinuationEnvelope`-produced envelope sealed under a wrong key (H2BF2-established safe-probe pattern).

Result: `LOCAL_PRODUCTION_DEPENDENCIES_CONSTRUCT=PASS`, `LOCAL_RUN_EXECUTED=YES`, `LOCAL_WORKFLOW_STEP_COUNT=1`, `LOCAL_FIRST_STEP=open-envelope`, resolved payload `{"status":"workflow_internal_error","error_code":"decrypt_failed"}`, zero executor/facilitator/settlement calls, zero `payment_attempts` rows.

**Correction to this checkpoint's own assumption**: envelope-open failures are caught and *resolve* (`runPaidContinuationWorkflow`'s STEP 0 `catch` block returns `terminal(...)`), they do not throw — only pre-step dependency-construction failures throw (R1's specific, deliberate scope). This means the real instance's Cloudflare status is expected to be "Completed" (workflow-level), not "Errored" — verified against source before spending the real deployment, avoiding a second wasted mutation from a wrong assumption.

Negative matrix: each of the 12 required fields individually removed still throws `dependencies_unavailable:` before reaching `open-envelope`. `COMPLETE_DEPENDENCY_FAIL_CLOSED_MATRIX=PASS` (12/12).

Temporary proof file deleted after use; not committed (local verification scaffolding only, not a frozen module).

## §13 — Regression

- `pnpm test`: 213/213 files, 2583/2583 tests pass
- `pnpm test:worker-runtime`: 99/99 scenarios (cross-script binding + host bundle isolation both explicitly proven)
- `pnpm lint`: clean
- `pnpm typecheck`: 3 pre-existing errors (unrelated file, unchanged), 0 new — ACCEPTED_UNCHANGED_BASELINE
- `pnpm production:preflight`: PASS (both before and after this checkpoint's mutations)
- `pnpm secrets:scan`: 4 pre-existing findings (documented duplicate-history artifacts), 0 new

Config test additions (`dedicated-workflow-host-config.test.ts`): 2 new tests proving the 4 ADR-0055 vars are present with exact values and that no fifth var was added — 11/11 pass.

## §14 — Host containment

`workers_dev = false`, no `routes`, no `[[routes]]`, no `[triggers]` in `wrangler.paid-continuation-runtime.toml`. `HOST_PUBLIC_HTTP_SURFACE=NONE`.

## §16-17 — Host deployment

Single command: `wrangler deploy --config wrangler.paid-continuation-runtime.toml --secrets-file <0600 staged file>` — atomically uploaded code + all 8 secrets + registered the Workflow trigger in one operation (better than the two-step `versions upload` + `triggers deploy` used in earlier C1/H2BF4 attempts).

- `HOST_DEPLOYMENTS=1`
- `FINAL_HOST_WORKER_VERSION_ID=3060799b-5ec7-401d-9b5b-5d361c2fa8da`
- Readback: all 8 secret names present (`wrangler secret list`), 4 ADR-0055 vars present with exact values, `CDP_WALLET_SECRET` absent.

## §18-21 — Real Workflow qualification

`FINAL_WORKFLOW_VERSION_ID=85dc348b-4fe9-41be-b880-cb83a0875bda` (confirmed via `wrangler workflows describe`; direct graph-API readback not attempted — would require manual OAuth token extraction, explicitly optional per this checkpoint's own fallback clause).

One real instance triggered directly against `siteborne-paid-continuation` (no public API, no x402): instance `21d0c15a-413d-400f-9e5d-a3ee6856adb7`.

Result:
- Workflow-level: Status=Completed, Success=Yes (expected — see §11 correction)
- Step-level: exactly 1 step (`open-envelope-1`), Success=**No**, Error=`EnvelopeOpenError: Continuation envelope decryption failed`
- `RPC_RUN_METHOD_MISSING_ERROR=NO`, `DEPENDENCIES_UNAVAILABLE_ERROR=NO`, `FALSE_COMPLETED_ZERO_STEP=NO`
- `REAL_RUN_METHOD_EXECUTED=YES`, `REAL_WORKFLOW_STEP_COUNT=1`, `FIRST_REAL_STEP_NAME=open-envelope`, `EXPECTED_ENVELOPE_FAILURE_REACHED=YES`

This is the clean, complete resolution of the entire H2BF1→H2BF5 defect chain: dedicated host (fixes the missing-DAG/RPC error), R1's fail-closed throw (fixes zero-step false success), complete dependency closure (fixes the Modal/ADR-0055 gaps) — the instance now reaches real, expected, application-level business logic instead of infrastructure failure.

## §22 — Zero side effect proof

`SELECT COUNT(*) FROM payment_attempts WHERE payment_identifier = 'h2bf5-final-safe-instance-01-payment'` → `0` (live remote D1 query). `REAL_EXECUTOR_CALLS=0`, `REAL_FACILITATOR_VERIFY_CALLS=0`, `REAL_FACILITATOR_SETTLE_CALLS=0`, `REAL_SETTLEMENTS=0`, `CHAIN_TRANSACTIONS=0`, `REAL_ECONOMIC_EFFECT_USDC=0`.

## §23 — Host pass gate

`DEDICATED_WORKFLOW_HOST_REAL_INFRA_QUALIFIED=YES`.

## §24-26 — Cross-script API candidate

Discovered production's secret store already holds 10 accumulated secret names (secrets never delete on upload, per established Q6H-era semantics), including a `PAYMENT_CONTINUATION_ENCRYPTION_KEY` from an earlier, unrelated attempt whose value cannot be verified to match the host's. Rather than trust it, re-provisioned exactly that one secret to guarantee a byte-identical match, via `wrangler versions upload --secrets-file <file with only PAYMENT_CONTINUATION_ENCRYPTION_KEY> --keep-vars` — all other already-present secrets (Modal, CDP, receipt-signing) were left untouched since dependency tracing (`production-web-context-v2-cdp-route.ts` calls the *same* all-or-nothing composition builder the host uses) shows the public API route also structurally requires them to construct without hitting its own `unavailable` fail-closed path, and they were already correct/in-use on production.

- `API_CANDIDATE_UPLOADS=1`
- `FINAL_H2BF5_API_CANDIDATE_VERSION_ID=db7054c9-76ee-4830-aabe-8a4542261b6a`
- Cross-script binding confirmed in upload output: `env.PAID_CONTINUATION_WORKFLOW (PaidContinuationWorkflow (defined in siteborne-paid-continuation-runtime))`
- 4 ADR-0055 vars set via `--var` (not committed to `wrangler.toml`, matching the file's own deliberate-absence convention)
- Secret name count unchanged at 10 (only a value refresh, no new name)

## §27-28 — Deployment split

`wrangler versions deploy de70bf98@100 db7054c9@0` → confirmed: `de70bf98-f304-4d7f-b189-4ae2401041a0` @ 100%, `db7054c9-76ee-4830-aabe-8a4542261b6a` @ 0%, no third version. `wrangler.toml`-level `production:preflight` re-run after the split: PASS.

## §29 — Settlement ownership

`grep -rn "\.settle(" apps/edge-api/src` (excluding tests/testing doubles): exactly one production call site, `paid-continuation-workflow.ts:480` (`deps.settlement.evidenceProvider.settle(...)`), inside the dedicated host only. `cdp-provider.ts:161` is `.settle()`'s own internal implementation (the facilitator client call), not a second caller. `PUBLIC_API_SETTLE_CALLSITES=0`, `DEDICATED_HOST_SETTLE_CALLSITES=1`, `SINGLE_SETTLEMENT_OWNER=PASS`.

## §30 — Zero economic effect (entire checkpoint)

`REAL_LIVE_402_REQUESTS=0`, `REAL_SIGNER_CALLS=0`, `REAL_PAID_REQUESTS=0`, `REAL_FACILITATOR_VERIFY_CALLS=0`, `REAL_FACILITATOR_SETTLE_CALLS=0`, `REAL_SETTLEMENTS=0`, `CHAIN_TRANSACTIONS=0`, `REAL_ECONOMIC_EFFECT_USDC=0`.

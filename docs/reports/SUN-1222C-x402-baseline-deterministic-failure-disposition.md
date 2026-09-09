# SUN-1222C-X402-BASELINE-DETERMINISTIC-FAILURE-DISPOSITION

Test-infrastructure-only checkpoint. Zero production mutation: no Cloudflare
mutation, no deployment, no secret mutation, no live payment/settlement/
provider call, no economic action. Closes the 10 deterministic baseline
payment-test failures carried forward from
`docs/reports/SUN-1222C-mtls-production-provisioning-plan.md` §0/§32.

## 0. Disposition summary

```
SUN1222C_X402_BASELINE_FAILURE_DISPOSITION=PASS
START_HEAD=f450bf0d61b90349685064684c11fb49a13bf670
FINAL_HEAD=<see §26 below — printed at commit time>
ORIGINAL_DETERMINISTIC_FAILURES=10
CURRENT_HEAD_FAILURES_REPRODUCED=10/10
CURRENT_FAILURE_CLASS=DETERMINISTIC
PRE_PCC_BASELINE_FAILURE_COUNT=0/64
TEST_SHAPE_DRIFT=YES
REAL_PRODUCTION_PAYMENT_DEFECTS=0
CARRIED_PAYMENT_TEST_FAILURE_CLASS=TEST_INFRASTRUCTURE_CONFIRMED
EXPECTED_RED_REPRODUCED=YES
PRODUCTION_SOURCE_FILES_CHANGED=0
PREVIOUS_DETERMINISTIC_FAILURES_GREEN=10/10
AFFECTED_FILES_GREEN=4/4
PAYMENT_TEST_MUTATION_PROOF=PASS
ECONOMICS_UNCHANGED=YES
PAYMENT_IDENTIFIER_UNCHANGED=YES
TOTAL_PRODUCTION_SETTLE_CALLSITES=1 (PUBLIC_API=0, MCP_ADAPTER=0, DEDICATED_WORKFLOW=1)
MTLS_REGRESSION=NO
PCC_WIRE_RESULT_REGRESSION=NO
TYPECHECK=PASS (23/23) BUILD=PASS (12/12) LINT=PASS (16/16)
DETERMINISTIC_FAILURES=0
FULL_TEST_SUITE_DETERMINISTIC_CLEAN=YES
PROTOCOL_X402_CHECK=PASS PROTOCOL_MCP_CHECK=PASS PROTOCOL_A2A_CHECK=PASS
PRODUCTION_PREFLIGHT=PASS
PUBLIC_API_WRANGLER_DRY_RUN=PASS PAID_RUNTIME_WRANGLER_DRY_RUN=PASS ALERT_WORKER_WRANGLER_DRY_RUN=PASS
NEW_SECRET_FINDINGS=0
FULL_RELEASE_GATE_CLEAN=YES
CLOUDFLARE_MUTATIONS=0 PRODUCTION_DEPLOYMENTS=0 REAL_SETTLEMENTS=0 ECONOMIC_EFFECT_USDC=0
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-MTLS-PRODUCTION-PROVISIONING
```

## 1. Integrity gate

```
pwd            = /Users/meta4ickal/SITEBORNE Utility Network
toplevel       = /Users/meta4ickal/SITEBORNE Utility Network
branch         = main
HEAD (start)   = f450bf0d61b90349685064684c11fb49a13bf670
git status     = clean
PLAN_COMMIT_EXISTS     = 0 (exists)
PLAN_COMMIT_REACHABLE  = 0 (is HEAD)
```

## 2. Exact four failing files and ten failing tests

Recovered directly from `docs/reports/SUN-1222C-mtls-production-provisioning-plan.md`
§0 (already diagnosed, not re-guessed) and reconfirmed by direct test run
this checkpoint:

```
FAILING_FILE_1 = apps/edge-api/tests/x402-service-route.test.ts
FAILING_FILE_2 = apps/edge-api/tests/nevermined-service-route.test.ts
FAILING_FILE_3 = apps/edge-api/tests/production-cdp-full-stack-mock.test.ts
FAILING_FILE_4 = apps/edge-api/tests/production-cdp-provider-wiring.test.ts
```

DETERMINISTIC_FAILING_TESTS (10):

1. `production-cdp-provider-wiring.test.ts > production CDP provider wiring (SUN-1200 checkpoint B) > exact positive lifecycle: real CdpPaymentEvidenceProvider + mock facilitator, production network/asset, verify=1 execute=1 settle=1`
2. `production-cdp-full-stack-mock.test.ts > production CDP full-stack mock (SUN-1200 checkpoint D, directive §22/§23) > §22 full outer HTTP positive production mock: mainnet challenge, production USDC, seller identity match, verify=1 execute=1 settle=1, receipt, PSL`
3. `x402-service-route.test.ts > x402 HTTP vertical slice (SUN-0700A checkpoint 5) > exact synthetic end-to-end lifecycle (company_evidence_graph.v1) > 402 -> pay -> 200, with PAYMENT-RESPONSE, receipt, and link`
4. `nevermined-service-route.test.ts > Nevermined alternative rail HTTP lifecycle > runs fixed PAYG through D1, service/PCC/linkage, settle, and a bounded response`
5. `x402-service-route.test.ts > four-service local route matrix (directive §30) > /v1/company/evidence-graph: 402 -> synthetic paid success`
6. `x402-service-route.test.ts > four-service local route matrix (directive §30) > /v1/web/context: 402 -> synthetic paid success`
7. `x402-service-route.test.ts > four-service local route matrix (directive §30) > /v1/verify/agent-output: 402 -> synthetic paid success`
8. `x402-service-route.test.ts > Bazaar -> HTTP machine-buyer round trip (directive §31) > a Bazaar discovery declaration for company_evidence_graph.v1 correctly identifies the real route this checkpoint mounts, and its own frozen example input drives a full 402 -> pay -> success cycle`
9. `x402-service-route.test.ts > HTTP property tests (directive §35) > property: every 200 response corresponds to exactly one consumed payment attempt with a verified SITEBORNE receipt`
10. `x402-service-route.test.ts > SUN-1221E6R-H2A — post-verification execution/settlement survives a disconnected request context > registers exactly one waitUntil-protected pipeline promise, with no duplicated execution, for a normal successful paid request`

Each failure's expected/actual/location/mock/production-source/governing-commit
is recorded in §5-§6 below.

## 3. Reproduce on current HEAD

Ran the four files together, twice, via `npx vitest run <4 files>`:

- Run 1: `Test Files 4 failed (4) / Tests 10 failed | 49 passed | 5 skipped (64)`
- Run 2 (rerun, identical files/tests): `10 failed | 49 passed | 5 skipped (64)`, byte-identical failure set both times, no timeouts, no flaky retries.

```
CURRENT_HEAD_FAILURES_REPRODUCED=10/10
CURRENT_FAILURE_CLASS=DETERMINISTIC
```

Every failure is a plain `AssertionError` (`expected undefined to be 'success'`,
or a `toMatchObject` mismatch) at a fixed line — never a timeout, network
error, or fixture-load error.

## 4. Reproduce on pre-PCC baseline

Baseline commit: `a76142e5c46bfc103d8061ec1841c62c3174e454`
(`SUN-1222C-PCC-WIRE-RESULT-GOVERNANCE-DECISION`), confirmed the direct
parent of `ac642cb4d56601f62a15f1bfcf80a3eff4821693`
(`SUN-1222C-PCC-WIRE-RESULT-IMPLEMENTATION`) via
`git log --oneline -1 ac642cb^`.

Method: a **read-only `git worktree`** checked out at `a76142e` (never the
main working tree), with `node_modules` symlinked in from the main tree
(`git diff --stat a76142e HEAD -- package.json pnpm-lock.yaml` confirmed zero
dependency drift, so this is safe). The four failing test files themselves
are byte-identical between `a76142e` and current HEAD
(`git diff --stat a76142e HEAD -- <4 files>` → empty) — proving the
comparison isolates the production-source change alone. Removed with
`git worktree remove --force` immediately after.

Result: `Test Files 4 passed (4) / Tests 59 passed | 5 skipped (64)` — **zero
failures**, same four files, same 64 tests, only the commit differs.

```
PRE_PCC_BASELINE_FAILURE_COUNT=0/64
```

This is direct, not inferred, evidence: the four files pass cleanly against
the pre-PCC production source and fail deterministically against the
post-PCC production source, with the test files themselves unchanged
between the two commits.

## 5. Trace the governed result-shape change

`git show --stat ac642cb` confirms the four failing files are **not** among
the seven files that commit touched (it touched
`paid-continuation-workflow.ts`, `x402-mcp-adapter.ts`,
`in-process-workflow-binding.ts`, and three test files — none of the four
failing ones).

`paid-continuation-workflow.ts` diff (`DurableCachedResult.body`):

```
OLD_TEST_EXPECTED_RESULT_SHAPE =
  { service_id, result_class, output?, receipt_id, link_id, link_hash }
CURRENT_GOVERNED_RESULT_SHAPE =
  the full PCC document (verificationReceipt === pccResult.pcc),
  schema authority contracts/releases/2.0.0/schemas/
  proof-carrying-context.schema.json:
  { pcc_version, job_id, contract{service_id, service_version, ...,
    idempotency_key}, subject, claims, evidence, completeness,
    provenance, verification{..., decision, score}, receipt{output_hash,
    ..., signature, signed_at}, extensions }
  (additionalProperties: false at the top level)
TEST_SHAPE_DRIFT=YES
```

`result_class` / `receipt_id` / `link_id` / `link_hash` do not exist
**anywhere** in the governed schema (confirmed by reading
`contracts/releases/2.0.0/schemas/proof-carrying-context.schema.json`'s
`contract` and `receipt` definitions directly) — they were not renamed or
relocated to a different wire field, only removed from the wire entirely
(service identity/idempotency now live at `contract.service_id`/
`contract.idempotency_key`; `link_id`/`link_hash` are durable D1 state,
never returned to the buyer).

Empirical confirmation (temporary diagnostic test, deleted after use, and a
temporary single `console.log` in `production-cdp-provider-wiring.test.ts`,
reverted before commit): the real wire body produced by
`buildPaidServicesApp` in this test harness is exactly

```json
{
  "schema_valid": true, "material_claims_supported": true,
  "evidence_accessibility": 1, "freshness": 1, "completeness": 1,
  "cross_source_agreement": 1, "provenance_valid": true,
  "decision": "pass", "score": 1
}
```

for both `evidenceMode: 'fixture'` and `evidenceMode: 'production'`
(CDP-evidenced `/v2/web/context`) routes — i.e. exactly
`result.verification`, per `createInProcessWorkflowBinding`'s documented,
pre-existing `validatePcc` stub (`(outcome) => ({ valid: true, pcc:
outcome.result.verification })`, see §6). `verification.decision === 'pass'`
is this harness's governed nested-location equivalent of the old
`result_class === 'success'`.

## 6. Production defect vs. test-infrastructure defect

| # | Test | ROOT_CAUSE_CLASS | PRODUCTION_SOURCE_DEFECT | TEST_INFRASTRUCTURE_DEFECT | REQUIRED_FIX |
|---|------|---|---|---|---|
| 1-10 | all ten (see §2) | **A** — stale expected assertion only | No | Yes — asserted the pre-`ac642cb` flat envelope (`result_class`/`receipt_id`/`link_id`), which the governed wire contract no longer produces by design | Read the governed nested location (`body.decision === 'pass'`) instead |

`REAL_PRODUCTION_PAYMENT_DEFECTS=0` — every one of the ten fails for the
identical, single, already-governed reason: an assertion against a field
`ac642cb` deliberately removed from the wire per the accepted governance
decision (`docs/reports/SUN-1222C-pcc-wire-result-governance-decision.md`),
never a schema/network/mock-fidelity/logic defect. No E or F classification
applies.

## 7. Production path proven correct before touching tests

Ran, unmodified, before any test edit:

- `paid-continuation-workflow-pcc-wire-result.test.ts` (21/21) — the
  dedicated, harness-independent RED→GREEN→mutation proof (from `ac642cb`
  itself) that `DurableCachedResult.body` *is* a schema-valid PCC document.
- `x402-mcp-adapter.test.ts`, `paid-continuation-workflow.test.ts`,
  `mcp-four-service-acceptance.test.ts` (already-updated PCC-shape
  consumers) — all green.

```
PRODUCTION_SHAPED_PAYMENT_PATH=PASS
```

## 8. Genuine RED baseline

`RED_TESTS` = the same 10 listed in §2, reproduced twice (§3) with a fixed
`AssertionError`/`toMatchObject` mismatch at a specific line each time —
never a network/fixture/schema/timeout error.

```
EXPECTED_RED_REPRODUCED=YES
```

## 9. Minimum test-infrastructure fix

`PRODUCTION_SOURCE_FILES_CHANGED=0`. Only the four failing test files were
edited — assertion-only changes, no new fixture machinery, no second PCC
construction, no schema loosening:

- `expect(body.result_class).toBe('success')` →
  `expect(body.decision).toBe('pass')` (5 sites across the four files,
  covering all 10 originally-failing tests — one site, the "four-service
  local route matrix" loop, covers 3 tests).
- `expect(body.receipt_id).toBeTruthy(); expect(body.link_id).toBeTruthy();`
  (and the `toBeDefined()` variant) removed — these fields no longer exist
  on the wire body by governed design (§5), so there is no governed nested
  location left to read them from; `decision === 'pass'` is the direct
  substitute success signal actually present.
- One directly-adjacent, already-vacuous assertion
  (`expect(retryBody.link_id).toBe(body.link_id)`, trivially `undefined ===
  undefined` post-`ac642cb`, not itself one of the 10 originally-failing
  tests) was strengthened in the same edit to
  `expect(retryBody).toEqual(body)` — byte-identical replay of the whole
  governed body is the equivalent, still-meaningful "same result, never a
  second consumption" proof the property test's own docstring describes.

Every fix follows the exact precedent `ac642cb` itself already established
(`x402-mcp-adapter.test.ts`'s own diff, and the "Section 8" comment in
`mcp-four-service-acceptance.test.ts` explicitly documenting this same
in-process-double `validatePcc`-fidelity gap as pre-existing and
out-of-scope) — no new doctrine invented.

```
PRODUCTION_SOURCE_FILES_CHANGED=0
```

## 10. CDP / facilitator mock fidelity

Audited all four files' `verify`/`settle`/provider-invocation mocks
(`mockFacilitator`, `mockSellerClient`, chain-receipt-checker doubles) —
unmodified by this checkpoint, and structurally unrelated to the wire-body
shape (mocks live at the facilitator boundary; the PCC-shape change is
strictly downstream of settlement, in result construction only).

```
MOCK_MATCHES_PRODUCTION_INTERFACE=YES (unchanged; not this checkpoint's concern)
```

## 11. Payment identity / economics

No production source touched (§9). `payment_identifier`, service identity,
amount/network/asset/payTo/scheme/expiry, idempotency, and retry/settlement
semantics are structurally unreachable from a test-assertion-only diff.

```
ECONOMICS_UNCHANGED=YES
PAYMENT_IDENTIFIER_UNCHANGED=YES
```

Frozen v2 economics unchanged (not read or touched this checkpoint):
`company_evidence_graph.v2=31200, web_context_verified.v2=8000,
document_evidence_json.v2=9800, verify_agent_output.v2=17000, TOTAL=66000`
atomic USDC.

## 12. Settlement ownership

```
grep -rn "\.settle(" apps/edge-api/src --include="*.ts" | grep -v test
```
→ exactly one real call site:
`apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts:682`
(`deps.settlement.evidenceProvider.settle(...)`), inside the dedicated
Workflow. No call in `x402-service.ts` (public API) or the MCP adapter.

```
PUBLIC_API_SETTLE_CALLSITES=0
MCP_ADAPTER_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
```

## 13. GREEN

```
npx vitest run <4 files>
→ Test Files 4 passed (4) / Tests 59 passed | 5 skipped (64)
```

```
PREVIOUS_DETERMINISTIC_FAILURES_GREEN=10/10
AFFECTED_FILES_GREEN=4/4
```

## 14. Mutation proof

1. Re-ran `paid-continuation-workflow-pcc-wire-result.test.ts` (21/21,
   unmodified) — the pre-existing, dedicated PCC-shape mutation proof
   (missing `pcc_version`, business-payload-only replacement, unknown
   `service_id`, etc.) remains green, confirming this checkpoint's
   test-only changes did not disturb it.
2. Mutation-proved the eight assertion sites this checkpoint edited: backed
   up the four files, `sed`-replaced every `expect(...).toBe('pass')` /
   `{ decision: 'pass' }` with a deliberately wrong sentinel value, re-ran
   the four files — result: `10 failed | 49 passed | 5 skipped (64)`,
   **the exact same 10 tests, at the exact same assertion lines**, failed
   again. Restored the four files from backup; re-ran — back to `59 passed
   | 5 skipped (64)`.

```
PAYMENT_TEST_MUTATION_PROOF=PASS
```

## 15. Targeted payment regression

```
npx vitest run apps/edge-api/tests/x402-service-route.test.ts \
  apps/edge-api/tests/nevermined-service-route.test.ts \
  apps/edge-api/tests/production-cdp-full-stack-mock.test.ts \
  apps/edge-api/tests/production-cdp-provider-wiring.test.ts \
  apps/edge-api/tests/paid-continuation-workflow-pcc-wire-result.test.ts \
  packages/protocol-mcp/src/frozen-contracts.test.ts \
  apps/edge-api/tests/mcp-four-service-acceptance.test.ts \
  apps/edge-api/src/control-plane/mcp/x402-mcp-adapter.test.ts \
  apps/edge-api/tests/paid-continuation-workflow.test.ts
→ Test Files 9 passed (9) / Tests 237 passed | 5 skipped (242)
```

```
TARGETED_PAYMENT_FILES=9
TARGETED_PAYMENT_TESTS=237/242 (5 pre-existing, unrelated skips)
```

## 16. mTLS regression

```
npx vitest run apps/edge-api/tests/mtls-caller-context.test.ts \
  apps/edge-api/tests/agent-card-signing.test.ts \
  packages/protocol-a2a/src/signing.test.ts \
  packages/protocol-a2a/src/transport.test.ts \
  packages/protocol-a2a/src/protocol.property.test.ts
→ Test Files 5 passed (5) / Tests 71 passed (71)
```

```
MTLS_REGRESSION=NO
```

## 17. PCC regression

```
npx vitest run apps/edge-api/tests/paid-continuation-workflow-pcc-wire-result.test.ts \
  packages/protocol-mcp/src/frozen-contracts.test.ts \
  packages/pcc-schema/src/pcc-extension-container.test.ts \
  packages/pcc-schema/src/pcc-schema.test.ts \
  apps/edge-api/tests/mcp-four-service-acceptance.test.ts \
  apps/edge-api/src/control-plane/mcp/x402-mcp-adapter.test.ts \
  apps/edge-api/tests/paid-continuation-workflow.test.ts
→ Test Files 7 passed (7) / Tests 178 passed (178)
```

(`mcp-four-service-acceptance.test.ts`'s own "Section 8 FINDING" console
warning for the pre-existing, documented, out-of-scope in-process-double
PCC-fidelity gap fired exactly as before — not a new condition, does not
fail the test, unrelated to this checkpoint's changes.)

```
PCC_WIRE_RESULT_REGRESSION=NO
```

## 18. Full typecheck / build / lint

```
pnpm typecheck → 23 successful, 23 total
pnpm build     → 12 successful, 12 total (pre-existing turbo "no output
                  files" warning for @siteborne/edge-api#build, unrelated
                  to this checkpoint, present on unmodified HEAD too)
pnpm lint      → 16 successful, 16 total
```

```
TYPECHECK=PASS BUILD=PASS LINT=PASS
```

(`npx eslint` run directly against the four edited test files surfaces one
pre-existing `@typescript-eslint/consistent-type-imports` finding at
`x402-service-route.test.ts:53`, in a line this checkpoint did not touch;
confirmed present identically on unmodified HEAD via `git stash`. The
project's own `lint` script scopes to `src/` only for `@siteborne/edge-api`
and does not include `tests/`, so this pre-existing finding is outside the
project's own LINT gate and was not introduced or worsened by this
checkpoint.)

## 19. Full test suite

```
npx vitest run
→ Test Files 1 failed | 252 passed | 22 skipped (275)
  Tests      1 failed | 3092 passed | 78 skipped (3171)
```

The single failure —
`packages/service-runtime/src/services/document-evidence/worker-bridge.subprocess.test.ts
> produces a signed receipt for the ten-page OCR checkpoint-2I service
input` — was a `60000ms` timeout, not an assertion failure, in a real-
subprocess OCR test wholly unrelated to payments/PCC. Rerun in isolation:

```
npx vitest run packages/service-runtime/.../worker-bridge.subprocess.test.ts
→ Test Files 1 passed (1) / Tests 3 passed (3), slowest test 15.6s (well
  under the 60s budget) — pure parallel resource contention during the
  full-suite run, exactly the same class of finding `ac642cb`'s own commit
  message already documented for this suite ("63 timeout-classed failures
  ... pure parallel resource contention").
```

```
DETERMINISTIC_FAILURES=0
FULL_TEST_SUITE_DETERMINISTIC_CLEAN=YES
```

## 20. Protocol gates

```
pnpm x402:check → PASS (format/lint/typecheck/test/property/fixtures/spec-baseline)
pnpm mcp:check   → PASS (check/edge-test/metadata:verify/pack:verify)
pnpm a2a:check   → PASS (spec:verify, a2a-route.test.ts 2/2)
```

```
PROTOCOL_X402_CHECK=PASS PROTOCOL_MCP_CHECK=PASS PROTOCOL_A2A_CHECK=PASS
```

## 21. Production preflight

```
pnpm production:preflight
→ PASS: required binding(s) present -- DB.
→ PASS: required [vars] present.
→ PASS: economic/cutover vars are absent or fail-closed in the pre-upload candidate.
→ PASS: versioned and aliased Worker preview URLs are explicitly disabled.
→ PRODUCTION_CONFIG_DRIFT_CHECK: PASS
→ PASS: 12/12 paid routes are structurally unavailable before economics.
→ PASS: all required real secret names are present (names only, zero values read/logged).
→ PREFLIGHT RESULT: PASS
```

```
PRODUCTION_PREFLIGHT=PASS
```

## 22. Wrangler dry runs

Workspace-pinned wrangler, `versions upload --dry-run` (bundles only,
"`--dry-run: exiting now`", zero deploy) against all three configs:

```
wrangler.toml                              → PASS (public API)
wrangler.paid-continuation-runtime.toml    → PASS (paid continuation runtime)
wrangler.settlement-alert-worker.toml      → PASS (settlement alert worker)
```

```
PUBLIC_API_WRANGLER_DRY_RUN=PASS
PAID_RUNTIME_WRANGLER_DRY_RUN=PASS
ALERT_WORKER_WRANGLER_DRY_RUN=PASS
```

## 23. Secrets / logging

```
npx tsx scripts/scan-working-tree-secrets.ts
→ 2 findings, both in docs/reports/*.md (generic-api-key rule matching a
  Worker VERSION_ID string, e.g. "PUBLIC_API_SECOND_VERSION=..."), both in
  files last committed at 3cbee0e (long predating this checkpoint) and
  outside the four files this checkpoint touched.
```

```
NEW_SECRET_FINDINGS=0
REAL_PAYMENT_CREDENTIAL_FIXTURES=0
```

No test fix introduced a real credential, private key, wallet secret, raw
signed payment payload, live payment authorization, or production token —
the diff is assertion-and-comment-only against synthetic fixture data
already present in these files.

## 24. Source boundary

```
git diff --stat
 apps/edge-api/tests/nevermined-service-route.test.ts       | 14 ++++--
 apps/edge-api/tests/production-cdp-full-stack-mock.test.ts | 14 ++++--
 apps/edge-api/tests/production-cdp-provider-wiring.test.ts | 13 +++++-
 apps/edge-api/tests/x402-service-route.test.ts              | 51 ++++++++++--
 4 files changed, 76 insertions(+), 16 deletions(-)
```

All four: `test assertion` (+ explanatory comments). No fixture/mock/double
files, no production source, no docs (besides this report) changed.

```
PRODUCTION_SOURCE_FILES_CHANGED=0
UNEXPECTED_FILES_CHANGED=0
```

## 25. This report

`docs/reports/SUN-1222C-x402-baseline-deterministic-failure-disposition.md`
(this file).

## 26. Commit integrity

Printed and verified at commit time — see the commit this report ships
with; `git cat-file -e <SHA>^{commit}` and
`git merge-base --is-ancestor <SHA> HEAD` both exit 0, working tree clean
after commit.

## 27. Zero economic / production effect

```
CLOUDFLARE_CA_MUTATIONS=0 CLOUDFLARE_MTLS_MUTATIONS=0 WAF_MUTATIONS=0 DNS_MUTATIONS=0
CERTIFICATES_ISSUED=0 SECRET_MUTATIONS=0
PRODUCTION_DEPLOYMENTS=0 TRAFFIC_MUTATIONS=0 PRODUCTION_D1_WRITES=0
LIVE_QUOTES_OR_INTENTIONAL_402_REQUESTS=0 REAL_SIGNING_PAYMENT_ACTIONS=0
PAID_REQUESTS=0 REAL_PROVIDER_CALLS=0 FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0 REAL_SETTLEMENTS=0 CHAIN_TRANSACTIONS=0
ECONOMIC_EFFECT_USDC=0
```

(Every "verify"/"settle" call exercised by every test run in this checkpoint
was against an injected mock/double, on ephemeral Miniflare D1 in a
disposable temp directory — never a real facilitator, real CDP client, or
real chain RPC.)

## 28. Release disposition

```
REAL_PRODUCTION_PAYMENT_DEFECTS=0
PREVIOUS_DETERMINISTIC_FAILURES_GREEN=10/10
DETERMINISTIC_FAILURES=0
all protocol/preflight/dry-run gates PASS
```

```
SUN1222C_X402_BASELINE_FAILURE_DISPOSITION=PASS
CARRIED_PAYMENT_TEST_FAILURE_CLASS=TEST_INFRASTRUCTURE_CONFIRMED
FULL_RELEASE_GATE_CLEAN=YES
```

## 29. Follow-up (out of this checkpoint's authorized scope, not blocking)

Noted for a separate, dedicated session — not fixed here since none of
these are among the 10 carried failures and touching currently-green tests
was outside this checkpoint's authorization boundary:

- `x402-service-route.test.ts` has several other pre-existing, now-vacuous
  `body.link_id`/`body.receipt_id` comparisons in tests that were **not**
  among the 10 failures (e.g. `secondBody.link_id === firstBody.link_id`,
  a `Set` of `link_id`s expected to have size 1) — these currently pass
  only because both sides are `undefined` post-`ac642cb`, silently losing
  the coverage they once had. Same root cause and same fix pattern as this
  checkpoint's §9, just not currently RED.
- `mcp-four-service-acceptance.test.ts`'s own documented "Section 8" gap
  (`in-process-workflow-binding.ts`'s `validatePcc` stub forwards
  `result.verification` instead of building a full, schema-conformant PCC
  document) remains open, exactly as `ac642cb` left it — raising this
  double to build a real PCC is a distinct, larger undertaking, explicitly
  out of scope for both that checkpoint and this one.
- The pre-existing `@typescript-eslint/consistent-type-imports` finding at
  `x402-service-route.test.ts:53` (§18) is untouched by this checkpoint and
  outside the project's own `tests/`-excluding lint gate.

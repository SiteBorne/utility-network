# SUN-0700B Checkpoint 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove one real Base Sepolia `upto` payment for
`document_evidence_json.v1`, close the normal edge-api typecheck and secret-scan
gates, and accept SUN-0700B without enabling production.

**Architecture:** Preserve the accepted HTTP route, D1 replay, payment evidence
provider, service runtime, PCC receipt, UsageResult, and PaymentServiceLink
boundaries. Extend only the credential-dependent edge integration and guarded
live test for official `upto` signing/verification/settlement; keep all ordinary
checks credential-free and network-free.

**Tech Stack:** TypeScript 5 strict mode, Hono, Cloudflare D1/Miniflare,
`@coinbase/cdp-sdk` 1.55.0, x402 2.21.0, Vitest, Gitleaks 8.30.1, pnpm/Turbo.

## Global Constraints

- Network is hard-gated to `eip155:84532`; Base mainnet is forbidden.
- Seller is `0x7f44a2dd237938F18632d4CcA40f4c690295E6E1`; controlled buyer is
  `0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99`.
- Never print, persist, hash, serialize, or report secret values, bearer
  material, private keys, raw authorization headers, or complete
  `PAYMENT-SIGNATURE` payloads.
- Real execution requires `RUN_LIVE_X402=1`; ordinary tests and CI make zero
  payment calls.
- The service is the accepted `document_evidence_json.v1` implementation and
  canonical local document fixture; pricing comes from `@siteborne/pricing`
  through accepted x402 mappings.
- Settlement amount is measured actual usage, never the authorized maximum
  unless they naturally equal.
- Checkpoint-1 exact evidence and commit
  `654a5453cdcffc01570aae8b2bd554141d6999f7` remain unchanged; no additional
  real exact settlement is planned.
- `production_ready` and production execution remain false.

---

### Task 1: Make edge-api's declared typecheck real

**Files:**

- Modify: `apps/edge-api/package.json`
- Modify: `apps/edge-api/tsconfig.json` only if project metadata is required,
  without weakening strictness or excluding x402/CDP source
- Modify: the specific `apps/edge-api/src/**/*.ts` files named by strict
  compiler diagnostics
- Test: existing edge-api and root suites

**Interfaces:**

- Consumes: the existing strict `tsconfig.base.json` and workspace path mappings
- Produces: `pnpm --filter @siteborne/edge-api typecheck` invoking
  `tsc --noEmit` and returning zero diagnostics

- [ ] Run `pnpm --filter @siteborne/edge-api exec tsc --noEmit --pretty false`
      and retain the failing diagnostic classification as the RED proof.
- [ ] Correct systemic type defects first: double-wrapped repository return
      types, invalid synchronous dynamic imports, missing type exports/imports,
      and context/environment declarations.
- [ ] Correct remaining file-local strict diagnostics without `any`, strictness
      relaxation, or source exclusion.
- [ ] Replace the package's echo script with `tsc --noEmit`.
- [ ] Run edge typecheck, edge tests, root `pnpm typecheck`, and root normal
      tests with `RUN_LIVE_X402=0`.

### Task 2: Prove secret-scan coverage

**Files:**

- Modify: `.gitleaks.toml`
- Modify: `package.json`
- Create: `scripts/verify-secret-scan-scope.ts`
- Test: scope verifier executed by `pnpm secrets:scan`

**Interfaces:**

- Consumes: `git ls-files`, `.gitignore`, Gitleaks default rules, and the
  repository's tracked tree
- Produces: a fail-closed audit proving every tracked path is eligible for
  scanning and canary secrets are detected in representative
  source/config/report/migration/script/generated/live-test paths

- [ ] Add a failing scope test that detects tracked ignored files, broad path
      allowlists, missing required path classes, and a Gitleaks invocation that
      omits either Git-history or working-tree coverage.
- [ ] Narrow or remove path-wide allowlists; retain only exact false-positive
      patterns that cannot hide unrelated credentials.
- [ ] Make `pnpm secrets:scan` run the scope verifier, Git-history scan, and
      current working-tree scan with redaction.
- [ ] Verify the test catches runtime-constructed synthetic canaries without
      placing canary token literals in repository source.
- [ ] Record the 3.3 GB checkout versus 4.15 MB tracked-content explanation and
      current scan counts in the checkpoint report.

### Task 3: Add deterministic `upto` boundary proof

**Files:**

- Modify: `apps/edge-api/src/control-plane/routes/x402-service.ts` only if
  actual-settlement propagation has a demonstrated gap
- Modify: `apps/edge-api/src/control-plane/evidence/cdp-provider.ts` only if
  official `upto` response semantics require a demonstrated correction
- Modify: `apps/edge-api/tests/x402-evidence-provider-boundary.test.ts`
- Modify: `apps/edge-api/tests/x402-service-route.test.ts`
- Create: `apps/edge-api/tests/live/x402-live-upto.test.ts`

**Interfaces:**

- Consumes: actual `PaymentPayload`, selected `PaymentRequirements`, measured
  `UsageResult`, `CdpPaymentEvidenceProvider`, and the existing route factory
- Produces: deterministic proof that actual amount is bounded, settle receives
  actual rather than maximum, `PAYMENT-RESPONSE` reports actual, failures cannot
  consume payment, and replay/conflict semantics remain D1-authoritative

- [ ] Write failing assertions for `upto` actual/max separation, response
      amount, replay counters, four conflict bindings, authorization exceeded,
      and settlement failure state.
- [ ] Run the targeted tests and confirm failures identify missing behavior
      rather than test errors.
- [ ] Implement the minimum route/provider/live-test changes needed for those
      assertions.
- [ ] Run targeted tests to green and verify the guarded live file is skipped
      with `RUN_LIVE_X402=0`.

### Task 4: Select and measure the accepted document fixture

**Files:**

- Inspect: `packages/service-runtime/fixtures/document-worker-results/`
- Inspect: `services/modal-worker/fixtures/`
- Modify: guarded live test only

**Interfaces:**

- Consumes: the accepted SUN-0400A fixture bridge and `@siteborne/pricing`
  resource metrics
- Produces: deterministic pages/modes/resource metrics, receipt, actual atomic
  amount, and an authorization maximum derived from canonical pricing

- [ ] Execute candidate accepted fixtures locally through the real
      document-service path.
- [ ] Select a natural fixture whose actual cost is within, preferably below,
      the canonical maximum.
- [ ] Assert `0 <= actual_amount <= authorized_maximum` and settle/link/response
      equality to actual.

### Task 5: Run the complete pre-live gate

**Files:** none

- [ ] Run every deterministic command in checkpoint section 30, using local IPC
      permission where Miniflare/tsx requires it.
- [ ] Confirm credentials are checked only as SET/MISSING.
- [ ] Run authenticated `/supported` as the first external call and require both
      Base Sepolia `upto` and regression-information `exact` support.
- [ ] Stop without signing if any preflight requirement fails.

### Task 6: Execute one guarded real Base Sepolia `upto` payment

**Files:**

- Modify after execution:
  `docs/reports/SUN-0700B-checkpoint-2-live-upto-report.md`

- [ ] Obtain the 402 and decode `PAYMENT-REQUIRED` through the accepted codec.
- [ ] Sign the maximum authorization with the controlled CDP-managed account
      without private-key export.
- [ ] Retry through structural validation, D1 acquisition, real `/verify`, one
      document execution, PCC receipt verification, UsageResult creation, real
      `/settle`, PaymentServiceLink, consumed state, and codec-valid HTTP 200
      `PAYMENT-RESPONSE`.
- [ ] Retry the identical identity and prove zero second execution,
      verification, settlement, job, or fulfillment usage calculation.
- [ ] Run the safe real facilitator rejection only if it does not settle
      on-chain; otherwise rely on retained generic live proof plus deterministic
      `upto` boundary coverage.
- [ ] Capture only the public evidence fields authorized by checkpoint
      section 28.

### Task 7: Verify and commit implementation/live proof

**Files:** all implementation, tests, plan, audit, and checkpoint report files
from Tasks 1-6

- [ ] Disable the live flag and rerun `pnpm secrets:scan`, full `pnpm check`,
      and `git diff --check`.
- [ ] Inspect the complete diff and confirm no credential/temp artifacts exist.
- [ ] Commit with `feat(x402): verify live upto settlement on base sepolia`.

### Task 8: Audit and accept SUN-0700B

**Files:**

- Modify: `TASKS.yaml`
- Modify: `PROJECT_STATE.yaml`

- [ ] Audit original SUN-0700B criteria against retained exact and new `upto`
      public evidence.
- [ ] If and only if all criteria pass, transition SUN-0700B from `active` to
      `accepted`, retain production false, and record both reports/commits.
- [ ] Inspect the dependency frontier; identify but do not start the next task.
- [ ] Run governance/state/task validators, `pnpm secrets:scan`, and full
      `RUN_LIVE_X402=0 pnpm check` on the bookkeeping diff.
- [ ] Commit with `chore(state): accept SUN-0700B and advance payment frontier`.
- [ ] Verify clean status and return the 48-field sanitized stop report.

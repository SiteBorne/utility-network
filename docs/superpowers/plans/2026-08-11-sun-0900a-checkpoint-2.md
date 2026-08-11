# SUN-0900A Checkpoint 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the credential-free Nevermined provider boundary and four
deterministic Nevermined-only paid routes, prove the shared
D1/service/PCC/usage/link lifecycle, and accept SUN-0900A without contacting
Nevermined.

**Architecture:** Extend the existing `createX402ServiceRoute` implementation
into a single rail-aware route lifecycle selected by an explicit route
configuration. CDP keeps its accepted payload/codec/provider behavior;
Nevermined supplies official-SDK requirement construction, opaque-token
validation, a sealed fixture-versus-authenticated provider factory, and
Nevermined response mapping. Both rails converge before authoritative D1
acquisition and reuse the same job transitions, service executor, PCC receipt,
UsageResult, PaymentServiceLink, result persistence, and replay reconstruction.

**Tech Stack:** TypeScript, Hono, D1/Miniflare, Vitest/fast-check,
`@nevermined-io/payments@1.10.0`, `@siteborne/protocol-nevermined`,
`@siteborne/protocol-x402`, `@siteborne/service-runtime`.

## Global Constraints

- Credential-free, network-free, no Nevermined account, registration, or live
  settlement.
- Never print or persist an access token, API key, authorization header,
  provider dump, or diagnostic text.
- Route selects exactly one rail; no stacking or fallback.
- Production/default Nevermined routes reject fixture trust before service
  execution.
- Every deterministic fixture provider emits `synthetic_fixture`; only the
  explicit authenticated SDK factory can create an external provider.
- All new payment-attempt and link records use v2; historical v1 digests remain
  byte-identical.
- `document_evidence_json.v1` authorizes `190000`, measures `12000`, and settles
  `12000`; registration remains disabled.
- Production readiness and enablement remain false.

---

### Task 1: Nevermined transport, requirement, validation, and live guard

**Files:**

- Create: `packages/protocol-nevermined/src/codec.ts`
- Create: `packages/protocol-nevermined/src/requirement.ts`
- Create: `packages/protocol-nevermined/src/live-guard.ts`
- Modify: `packages/protocol-nevermined/src/client.ts`
- Modify: `packages/protocol-nevermined/src/validation.ts`
- Modify: `packages/protocol-nevermined/src/evidence.ts`
- Modify: `packages/protocol-nevermined/src/index.ts`
- Test: `packages/protocol-nevermined/src/codec.test.ts`
- Test: `packages/protocol-nevermined/src/requirement.test.ts`
- Test: `packages/protocol-nevermined/src/live-guard.test.ts`
- Test: `packages/protocol-nevermined/src/validation.test.ts`

**Interfaces:**

- Produces `buildNeverminedRequirementBinding`, bounded
  `PAYMENT-REQUIRED`/`PAYMENT-RESPONSE` codecs, `validateNeverminedAccessToken`,
  verification/settlement binding validation, and `evaluateNeverminedLiveGuard`.
- Consumes the frozen declarations and official `X402PaymentRequired`-compatible
  structural type without importing the SDK at runtime.

- [ ] Write tests that independently assert the exact public requirement
      binding, safe codec failures, bounded token rules, result mismatches, and
      live guard matrix.
- [ ] Run `pnpm nevermined:test` and confirm the new tests fail because the APIs
      do not exist.
- [ ] Implement the smallest credential-independent codecs, binding
      builder/validator, and guard.
- [ ] Re-run `pnpm nevermined:test`,
      `pnpm --filter @siteborne/protocol-nevermined typecheck`, and lint; keep
      the protocol package free of SDK/environment access.

### Task 2: Sealed Edge provider and official SDK adapter

**Files:**

- Create: `apps/edge-api/src/control-plane/evidence/nevermined-provider.ts`
- Modify:
  `apps/edge-api/src/control-plane/evidence/nevermined-sdk-parameters.ts`
- Modify: `packages/protocol-x402/src/evidence/provider.ts`
- Test: `apps/edge-api/tests/nevermined-provider.test.ts`
- Test: `apps/edge-api/tests/nevermined-sdk-parameters.test.ts`

**Interfaces:**

- Produces `NeverminedPaymentEvidenceProvider.fixture(client)` and
  `createAuthenticatedNeverminedPaymentEvidenceProvider(options)`; the
  constructor and authenticated adapter brand remain module-private.
- The provider consumes only `NeverminedFacilitatorClient`, validates the
  accepted authorization context, maps bounded evidence into existing SITEBORNE
  external evidence, and normalizes exceptions to machine codes.
- The authenticated factory alone calls `Payments.getInstance`; deterministic
  tests never call it.

- [ ] Write failing tests for narrow-client parameters, synthetic fixture trust,
      rejection/exception sanitization, actual settlement amount, response
      mismatch, and absence of a public external-trust constructor.
- [ ] Run the focused Vitest files and observe expected missing-API failures.
- [ ] Implement the private SDK adapter, private authenticated brand, fixture
      factory, authenticated factory, and evidence mapping.
- [ ] Re-run focused tests, Edge typecheck, and lint.

### Task 3: One rail-aware route lifecycle

**Files:**

- Modify: `apps/edge-api/src/control-plane/routes/x402-service.ts`
- Modify: `apps/edge-api/src/control-plane/repositories/d1/x402-quotes.ts`
- Test: `apps/edge-api/tests/nevermined-service-route.test.ts`
- Regression: `apps/edge-api/tests/x402-service-route.test.ts`

**Interfaces:**

- Adds a discriminated Nevermined rail configuration to the existing route
  factory while preserving current CDP call sites.
- `X402QuoteRepository` gains a bounded matching lookup for the latest unexpired
  route/input quote, allowing opaque Nevermined authorization to identify the
  persisted challenge without parsing the token or inventing another header.
- Nevermined request transport is exactly `PAYMENT-SIGNATURE` plus the accepted
  `Payment-Identifier` header.

- [ ] Write failing HTTP tests for 402 requirement decoding, structural rejects
      before provider, D1-before-verify, one successful fixed lifecycle, and
      actual-usage settlement.
- [ ] Run the focused test and confirm failures are due to
      unmounted/unimplemented Nevermined behavior.
- [ ] Add explicit rail branches only for requirement/auth/provider/response
      construction; keep one common D1/job/service/PCC/usage/link/replay body.
- [ ] Re-run Nevermined and CDP route suites after every green step.

### Task 4: Four route mounting and default fail-closed behavior

**Files:**

- Modify: `apps/edge-api/src/control-plane/routes/paid-services.ts`
- Modify: `apps/edge-api/src/index.ts`
- Test: `apps/edge-api/tests/nevermined-service-route.test.ts`
- Test: `apps/edge-api/tests/paid-routes-mounting.test.ts`

**Interfaces:**

- Reuses each existing accepted `ServiceExecutor` for both its CDP path and
  Nevermined path; there is no second service implementation.
- `buildPaidServicesApp` mounts four bounded provider-unavailable Nevermined
  handlers by default, and mounts the lifecycle only with an explicit Nevermined
  fixture/production configuration.

- [ ] Write failing tests for exactly four paths, default 503 behavior, explicit
      fixture mode, production fixture rejection, and unchanged open routes.
- [ ] Refactor service descriptors/executors only enough to mount both paths
      from one source.
- [ ] Re-run focused mounting, Nevermined route, and open CDP regression tests.

### Task 5: Replay, conflicts, failures, adversarial, property, and no-network proofs

**Files:**

- Expand: `apps/edge-api/tests/nevermined-service-route.test.ts`
- Create: `apps/edge-api/tests/nevermined-provider-boundary.test.ts`
- Modify: `packages/protocol-nevermined/src/no-network.test.ts`
- Create: `packages/protocol-nevermined/src/runtime.property.test.ts`

**Interfaces:**

- Test fixtures expose counters only in test code: Nevermined verify/settle, CDP
  verify/settle, service executions, and job rows.

- [ ] Add one failing behavioral test at a time for replay reconstruction,
      cross/same-rail conflicts, authorization exceeded, verify/settle
      reject/throw, wrong public settlement fields, hostile/oversized inputs, no
      fallback, no free/trial, v2 mutations, v1 compatibility, and ambient fetch
      prohibition.
- [ ] For each test, observe the expected failure before implementing the
      minimum route/provider validation.
- [ ] Run `pnpm nevermined:test`, focused Edge tests, `pnpm d1:test`, and
      `pnpm x402:check` until all are green.

### Task 6: Checkpoint evidence and implementation commit

**Files:**

- Create: `docs/reports/SUN-0900A-checkpoint-2-report.md`
- Modify: `docs/operations/NEVERMINED_PROTOCOL.md`
- Modify: `docs/operations/PAYMENT_RAILS.md`

- [ ] Record deterministic-only evidence, counts, amounts, trust boundaries, and
      all deferred live/registration claims.
- [ ] Run the full validation list from the accepted Checkpoint 2 directive plus
      final credential presence checks and `git status --short`.
- [ ] Review the diff for secret/token persistence and architecture drift.
- [ ] Commit source/tests/docs as
      `feat(nevermined): add deterministic alternative rail runtime`.

### Task 7: Final SUN-0900A acceptance and bookkeeping commit

**Files:**

- Modify: `TASKS.yaml`
- Modify: `PROJECT_STATE.yaml`

- [ ] Audit every Checkpoint 1 and Checkpoint 2 acceptance criterion against
      fresh executable evidence.
- [ ] If and only if all criteria pass, set SUN-0900A accepted; keep SUN-0900B
      blocked external, zero active tasks, blocked frontier, and production
      false.
- [ ] Run governance/state/tasks validation, secret scan, and the complete
      `pnpm check` again on the final state.
- [ ] Commit bookkeeping as
      `chore(state): accept SUN-0900A and block on nevermined sandbox`.
- [ ] Verify a clean tree and report the exact external frontier without
      starting SUN-0900B.

# SITEBORNE Durable Paid Continuation Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace request-lifetime-dependent post-verification execution with a
durable Cloudflare Workflow while preserving SITEBORNE's existing synchronous
x402 public contract and at-most-one settlement invariant.

**Architecture:** HTTP Worker verifies and performs policy gates, then creates
or joins a deterministic Workflow keyed by payment_identifier. Workflow owns
execute → PCC → settlement → persistence; signed settlement material is stored
only as an AES-256-GCM authenticated encrypted continuation envelope.

**Spec:**
docs/reports/SUN-1221E5Q6-.../.. (n/a) — canonical spec is
docs/reports/SUN-1221E6R-H2AW-durable-paid-continuation-workflow-design.md
(commit `21d11ab4770c628f0c8132ae842c9c93cf2382a3`)

## Global constraints

- No production source or test file may change until its owning checkpoint
  (H2AWI-1/2/3) executes with TDD RED→GREEN.
- `SINGLE_SETTLEMENT_OWNER=WORKFLOW` after H2AWI-3 lands. Before that,
  `apps/edge-api/src/control-plane/routes/x402-service.ts`'s existing
  request-local `CdpPaymentEvidenceProvider.settle()` call remains the owner
  and must not be touched by H2AWI-1/2.
- `RAW_SIGNATURE_PLAINTEXT_DURABLE_STORAGE_PLANNED=NO`: the signed EIP-3009
  payload may exist in Worker memory only; any persisted form must pass
  through `sealContinuationEnvelope`.
- Every external mutation (Workflow resource creation, secret creation,
  Worker version upload, D1 migration apply, deployment/traffic change,
  real 402/signing/settlement) requires a fresh standalone human
  authorization at its owning checkpoint gate (H2AWI-4, H2B, F, G). No task
  in H2AWI-1/2/3 performs one.
- Reuse existing crash-recovery primitives instead of re-deriving them:
  `x402-service.ts` already persists a durable pre-settle draft
  (`cdp_settlement_pending_draft` / `nevermined_settlement_pending_draft`,
  see `apps/edge-api/src/control-plane/routes/x402-service.ts:243-299`) before
  calling `evidenceProvider.settle()`, and never re-calls `settle()` on
  recovery — it reconciles externally via
  `apps/edge-api/src/control-plane/evidence/chain-receipt-checker.ts`. The
  Workflow settle step reuses this exact pattern instead of inventing new
  ambiguity semantics.
- Repository conventions to follow: domain modules live under
  `apps/edge-api/src/control-plane/<area>/`, D1 access goes through
  `apps/edge-api/src/control-plane/repositories/d1/*.ts`, state transitions go
  through `apps/edge-api/src/control-plane/state-machine/index.ts`'s
  `JobState` / `createStateEvent` / `getAllowedTransitions` / `isTerminal`.

---

## H2AWI-1 — Shared durable primitives (local source only)

No Workflow resource, no production route change, no external mutation.

### Task 1.1 — Continuation domain types

**Files:**
- Create `apps/edge-api/src/control-plane/continuation/types.ts`
- Test: `apps/edge-api/tests/continuation-types.test.ts`

**Interfaces:**
- Produces: `ContinuationEnvelopeV1`, `ContinuationEnvelopeMetadata`,
  `WorkflowContinuationInput`, `WorkflowContinuationResult`,
  `SettlementReconciliationResult` (exact shapes below).

```ts
export interface ContinuationEnvelopeMetadata {
  readonly job_id: string;
  readonly payment_identifier: string;
  readonly service: string; // e.g. "web_context_verified.v2"
  readonly network: string; // e.g. "eip155:8453"
  readonly asset: string; // ERC-20 contract address, lowercase
  readonly pay_to: string; // seller address, lowercase
  readonly amount_atomic: string; // decimal string, exact atomic units
  readonly valid_before_unix: number; // EIP-3009 validBefore, seconds
}

export interface ContinuationEnvelopeV1 {
  readonly v: 1;
  readonly key_id: string; // identifies which secret version sealed this
  readonly iv_b64: string; // 12-byte GCM IV, base64
  readonly ciphertext_b64: string; // AES-256-GCM ciphertext+tag, base64
  readonly aad_fingerprint: string; // sha256 hex of canonicalized AAD, for logging only (never the AAD itself)
}

export interface WorkflowContinuationInput {
  readonly envelope: ContinuationEnvelopeV1;
  readonly metadata: ContinuationEnvelopeMetadata; // clear-text copy of the AAD fields, needed to route without opening the envelope
  readonly request_id: string;
}

export type WorkflowTerminalStatus =
  | 'settled'
  | 'executor_rejected'
  | 'executor_timeout'
  | 'pcc_failed'
  | 'authorization_expired'
  | 'settlement_rejected'
  | 'settlement_ambiguous'
  | 'persistence_failed_after_settlement'
  | 'workflow_internal_error';

export interface WorkflowContinuationResult {
  readonly status: WorkflowTerminalStatus;
  readonly job_id: string;
  readonly receipt_id?: string;
  readonly settlement_transaction_reference?: string;
  readonly error_code?: string;
}

export interface SettlementReconciliationResult {
  readonly outcome: 'confirmed' | 'not_found' | 'inconclusive';
  readonly settlement_transaction_reference?: string;
  readonly checked_at_unix: number;
}
```

**Checklist:**
1. Write `continuation-types.test.ts` asserting the module exports exist with
   correct TS structural shape (compile-time check via a `satisfies` helper
   plus one runtime smoke test that a literal object matching each interface
   type-checks and round-trips through `JSON.stringify`/`JSON.parse`
   unchanged). This is intentionally a thin RED (types have no runtime
   behavior) — the "failing test" is a TypeScript compile failure before the
   file exists, which the checklist step 2 captures as the RED evidence.
2. Run `pnpm typecheck` — expect failure (module not found).
3. Add `types.ts` with the exact interfaces above, nothing else.
4. Run `pnpm typecheck` — expect PASS.
5. `pnpm test continuation-types.test.ts` — expect PASS.
6. No mutation proof required (pure type module, no branching logic).
7. Commit: `SUN-1221E6R-H2AWI-1a: continuation domain types`.

### Task 1.2 — Deterministic Workflow instance ID

**Files:**
- Create `apps/edge-api/src/control-plane/continuation/instance-id.ts`
- Test: `apps/edge-api/tests/continuation-instance-id.test.ts`

**Interfaces:**
- Consumes: nothing external (pure function).
- Produces: `deriveWorkflowInstanceId(paymentIdentifier: string): string`

**Design (frozen):**
- Algorithm: `siteborne-wf-` + lowercase hex SHA-256 of the UTF-8 bytes of
  `paymentIdentifier`, truncated to 56 hex chars (Cloudflare Workflow
  instance IDs must be ≤ 64 chars, `[a-zA-Z0-9_-]`; `siteborne-wf-` is 13
  chars, leaving headroom under the 64-char cap with the 56-char hex tail =
  69 — **too long**, so truncate hex to 48 chars instead: `siteborne-wf-` (13)
  + 48 hex = 61 chars, under the 64-char limit with margin).
- Uses Web Crypto `crypto.subtle.digest('SHA-256', ...)`, available in the
  Workers runtime — no new dependency.
- Explicitly NOT `computeAttemptHash()` (32-bit rolling hash, not
  collision-resistant, unsuitable for an identity binding a real economic
  transaction to a single Workflow run).
- Same `payment_identifier` → same ID (byte-for-byte, no randomness). Two
  different `payment_identifier` values collide only if SHA-256 collides
  (cryptographically negligible).

**Checklist:**
1. Write failing test: `deriveWorkflowInstanceId('pay_abc')` returns a
   deterministic value on repeat calls; two different inputs return
   different values; output matches `/^siteborne-wf-[0-9a-f]{48}$/`; output
   length ≤ 64.
2. Run test — RED (module doesn't exist).
3. Implement `instance-id.ts` using `crypto.subtle.digest`.
4. Run test — GREEN.
5. Regression: `pnpm test continuation-instance-id.test.ts`.
6. Mutation proof: assert that truncating the hex to a different length, or
   swapping SHA-256 for `computeAttemptHash`, breaks the fixed test vector
   (hardcode one known `payment_identifier` → known-ID pair in the test so an
   accidental algorithm change is caught, not just the regex).
7. Commit: `SUN-1221E6R-H2AWI-1b: deterministic workflow instance id`.

### Task 1.3 — Continuation envelope seal/open (AES-256-GCM)

**Files:**
- Create `apps/edge-api/src/control-plane/continuation/envelope.ts`
- Test: `apps/edge-api/tests/continuation-envelope.test.ts`

**Interfaces:**
- Consumes: `ContinuationEnvelopeV1`, `ContinuationEnvelopeMetadata` from
  Task 1.1.
- Produces:
  ```ts
  export interface SealInput {
    readonly payload: unknown; // the signed EIP-3009 authorization + facilitator requirements object, JSON-serializable
    readonly metadata: ContinuationEnvelopeMetadata;
    readonly keyMaterial: CryptoKey; // imported once by the caller, not by this module
    readonly keyId: string;
  }
  export async function sealContinuationEnvelope(input: SealInput): Promise<ContinuationEnvelopeV1>;

  export class EnvelopeOpenError extends Error {
    constructor(public readonly code:
      | 'unsupported_version'
      | 'malformed_encoding'
      | 'decrypt_failed'
      | 'aad_mismatch', message: string);
  }
  export interface OpenInput {
    readonly envelope: ContinuationEnvelopeV1;
    readonly expectedMetadata: ContinuationEnvelopeMetadata; // caller-supplied, from its own trusted job record — never trust envelope-embedded claims alone
    readonly keyMaterial: CryptoKey;
  }
  export async function openContinuationEnvelope(input: OpenInput): Promise<unknown>; // throws EnvelopeOpenError
  ```

**Design (frozen):**
- Algorithm: AES-256-GCM via Web Crypto (`crypto.subtle.encrypt`/`decrypt`,
  `{ name: 'AES-GCM', iv, additionalData }`).
- Key length: 256 bits (32 bytes), imported by the caller from the
  `PAYMENT_CONTINUATION_ENCRYPTION_KEY` secret (raw base64, 32 bytes decoded)
  via `crypto.subtle.importKey('raw', ..., 'AES-GCM', false, ['encrypt',
  'decrypt'])`. This module never reads the secret binding itself — it only
  accepts an already-imported `CryptoKey`, keeping it testable without any
  Worker environment.
- IV: 12 bytes (96 bits, the standard/recommended GCM nonce size), generated
  fresh per seal via `crypto.getRandomValues`. Never reused across seals with
  the same key.
- Ciphertext representation: `crypto.subtle.encrypt` output (ciphertext with
  16-byte GCM tag appended) base64-encoded as one string
  (`ciphertext_b64`); IV separately base64-encoded (`iv_b64`).
- AAD canonicalization: JSON with sorted top-level keys, no whitespace:
  `JSON.stringify({amount_atomic, asset, job_id, network, pay_to,
  payment_identifier, service, valid_before_unix})` with keys inserted in
  that exact alphabetical order (matches the field order already declared
  alphabetically in `ContinuationEnvelopeMetadata` except `valid_before_unix`
  — the canonicalizer sorts explicitly, it does not rely on object insertion
  order). AAD bytes = UTF-8 of that string, passed as `additionalData` to
  both encrypt and decrypt.
- `aad_fingerprint`: SHA-256 hex of the canonical AAD bytes, stored
  alongside the envelope for log correlation without ever logging the AAD
  or plaintext. Recomputed and compared on open as a cheap pre-check before
  the (authoritative) GCM tag verification.
- Required encrypted fields (inside `payload`, never in clear): the full
  signed EIP-3009 authorization object (`from`, `to`, `value`, `validAfter`,
  `validBefore`, `nonce`, `signature`) and the facilitator payment
  requirements object needed for `evidenceProvider.settle()`.
- Allowed clear fields: everything in `ContinuationEnvelopeMetadata` — none
  of it is secret (it's the same economic data already in `payment_attempts`
  and the D1 job row); it exists in clear specifically so routing/Workflow
  dispatch never needs to decrypt.
- Validation behavior: `openContinuationEnvelope` must (a) reject
  `v !== 1` as `unsupported_version`; (b) reject non-base64 or wrong-length
  IV/ciphertext as `malformed_encoding`; (c) recompute AAD from
  `expectedMetadata` (not from anything embedded in the envelope) and pass
  it to `decrypt` — if `expectedMetadata` doesn't match what was sealed, GCM
  authentication fails and this surfaces as `decrypt_failed`, which is the
  correct behavior: **the caller's own record is the source of truth for
  what the envelope should contain, not a self-declared field inside it.**
- Error taxonomy: exactly the four `EnvelopeOpenError` codes above. No error
  message may include plaintext, key material, IV, or ciphertext bytes —
  only the code and a static description.
- Key identifier handling: `key_id` is a caller-supplied opaque string
  (Task 3 in H2AWI-4 defines the actual secret-naming/rotation scheme); this
  module treats it as pass-through metadata written into the envelope at
  seal time and available to the caller after open to pick the right
  `CryptoKey` for decryption — this module does not do key lookup itself.
- `authorization validBefore` handling: carried as a clear metadata field
  (`valid_before_unix`) specifically so the Workflow can reject an expired
  authorization (Task 2.6) without opening the envelope first.

**Checklist:**
1. Write failing tests (see Task 1.4 below — full vector list lives there;
   this task's own RED covers just the round-trip and the four error codes).
2. RED: run tests against nonexistent module.
3. Implement `envelope.ts`.
4. GREEN.
5. Regression: full `continuation-envelope.test.ts` suite (see Task 1.4).
6. Mutation proof: flip `additionalData` canonicalization to unsorted key
   order in a mutation branch and confirm the AAD-mismatch test still fails
   correctly (i.e., the test suite is actually sensitive to canonicalization,
   not accidentally order-independent).
7. Commit: `SUN-1221E6R-H2AWI-1c: AES-256-GCM continuation envelope`.

### Task 1.4 — Crypto test vectors

**Files:**
- Modify: `apps/edge-api/tests/continuation-envelope.test.ts` (created in
  Task 1.3; this task fills in the full vector list before that task's
  commit — sequenced here for clarity of coverage, executed as part of 1.3's
  RED/GREEN cycle)

**Required cases (each one explicit test, no loops-hiding-cases):**
1. Round trip: seal then open with identical metadata → original payload.
2. Wrong key: open with a different (but validly imported) `CryptoKey` →
   `decrypt_failed`.
3. Tampered ciphertext: flip one byte of `ciphertext_b64` after seal →
   `decrypt_failed`.
4. Tampered IV: flip one byte of `iv_b64` → `decrypt_failed`.
5. Wrong `job_id` in `expectedMetadata` at open time → `decrypt_failed`.
6. Wrong `service` → `decrypt_failed`.
7. Wrong `network` → `decrypt_failed`.
8. Wrong `amount_atomic` → `decrypt_failed`.
9. Wrong `pay_to` → `decrypt_failed`.
10. Wrong `payment_identifier` → `decrypt_failed`.
11. Unsupported envelope version (`v: 2` constructed by hand) →
    `unsupported_version`.
12. Malformed encoding: non-base64 `ciphertext_b64` → `malformed_encoding`.
13. Missing encryption key: caller passes `undefined` where `CryptoKey` is
    required → TypeScript compile-time rejection (no runtime case needed;
    assert via `// @ts-expect-error` comment in the test file, confirming
    the type system — not a runtime guard — is the enforcement mechanism).
14. Key rotation / key-ID mismatch: seal with `key_id: 'k1'`, attempt open
    supplying `k2`'s `CryptoKey` (simulating a caller that picked the wrong
    key from its rotation table) → `decrypt_failed` (this module doesn't
    special-case key-ID mismatch; the caller's key-selection-by-`key_id` is
    exercised in Task 4.5, this test just proves wrong-key-for-this-`key_id`
    fails safely like case 2).

No test may use a production secret; all keys are locally generated via
`crypto.subtle.generateKey({name:'AES-GCM', length:256}, true, [...])` inside
the test file.

**Checklist:** covered by Task 1.3 (sequenced together; this task exists to
make the 14-vector requirement independently auditable against §6 of the
design and §30/§31 of the mission).

### Task 1.5 — Idempotency-key helpers

**Files:**
- Create `apps/edge-api/src/control-plane/continuation/idempotency-keys.ts`
- Test: `apps/edge-api/tests/continuation-idempotency-keys.test.ts`

**Interfaces:**
- Consumes: `payment_identifier: string`.
- Produces:
  ```ts
  export function workflowInstanceIdempotencyKey(paymentIdentifier: string): string; // === deriveWorkflowInstanceId, re-exported under this name for call-site clarity in H2AWI-2/3
  export function executorInvocationIdempotencyKey(paymentIdentifier: string): string; // `${paymentIdentifier}:executor`
  export function pccIdempotencyKey(paymentIdentifier: string): string; // `${paymentIdentifier}:pcc`
  export function settlementIdempotencyKey(paymentIdentifier: string): string; // `${paymentIdentifier}:settlement` — maps 1:1 onto the EXISTING `payment_attempts` row keyed by payment_identifier; this is not a new DB column, it is the string handed to Workflow step names / log correlation
  export function resultPersistenceIdempotencyKey(paymentIdentifier: string): string; // `${paymentIdentifier}:result`
  export function receiptPersistenceIdempotencyKey(paymentIdentifier: string): string; // `${paymentIdentifier}:receipt`
  export function terminalEventIdempotencyKey(paymentIdentifier: string): string; // `${paymentIdentifier}:terminal`
  ```

**Mapping to existing DB constraints (Task 8 of the mission, answered here
because it is a pure design fact needed before H2AWI-2 can be written):**

| Concept | Existing constraint | Schema work required |
|---|---|---|
| Workflow instance creation | Cloudflare Workflows platform: creating with a duplicate instance ID throws `ExistingInstanceInstantiationError` — this IS the idempotency guard, no D1 needed | none |
| Executor invocation | none pre-existing; Workflow step retry is the only re-execution driver, and each Workflow step runs at-most-once-per-successful-completion by platform contract | none |
| PCC generation | none pre-existing (PCC generation is pure/deterministic from job inputs today) | none |
| Settlement | **existing** `payment_attempts` unique row per `payment_identifier` (confirmed in SUN-1221E6R-H1A forensics) plus the existing `cdp_facilitator_settle_attempt_count` at-most-one-confirmed invariant (`apps/edge-api/src/control-plane/repositories/d1/payment-attempts.ts`) | none — reused as-is |
| Result persistence | job row keyed by `job_id`, state machine `isTerminal()` guard in `apps/edge-api/src/control-plane/state-machine/index.ts` prevents re-transition out of a terminal state | none |
| Receipt persistence | `receipt_id` field already present on the pending-draft shape in `x402-service.ts:256-257`; needs a durable column if not already persisted post-settlement (see H2AWI-4 D1 migration check, Task 6.1) | **possible** — confirm in Task 6.1 |
| Terminal event | `createStateEvent` / job event log already append-only with `(job_id, to_state)` implicitly unique per transition attempt via `isTerminal` guard | none |

No key here is a bare in-memory guard; every one maps to either a platform
guarantee (Workflow instance dedup) or an existing D1 constraint.

**Checklist:**
1. Write failing test asserting each helper's exact string format against
   fixed input/output pairs (not just "is a string").
2. RED.
3. Implement.
4. GREEN.
5. Regression: full continuation module test suite.
6. No mutation proof needed (pure string formatting, covered by exact fixed
   vectors already).
7. Commit: `SUN-1221E6R-H2AWI-1d: idempotency key helpers + DB constraint mapping`.

### H2AWI-1 exit gates

- `pnpm test` (full suite) PASS.
- `pnpm test:worker-runtime` PASS (no behavior touched, regression only).
- `pnpm lint` PASS.
- `pnpm typecheck` PASS.
- `pnpm production:preflight` PASS (source touched is additive-only, unused
  by any production route yet).
- `pnpm secrets:scan` — 0 new findings.
- Bundle isolation: confirm via existing production-bundle test that the new
  `continuation/` modules are NOT yet imported by any production route (they
  are inert until H2AWI-3 wires them in) — this is an explicit assertion in
  a new tiny test, not an assumption.
- External mutation: none. `WORKFLOW_DEPLOYMENTS=0`,
  `WORKER_VERSION_UPLOADS=0`, `SECRET_MUTATIONS=0`, `D1_MUTATIONS=0`.

---

## H2AWI-2 — Workflow orchestration (local source only; no deployment)

Depends on H2AWI-1's frozen interfaces. May write code against the
`cloudflare:workers` `WorkflowEntrypoint` API and unit-test its step logic
with fake `WorkflowStep`/`WorkflowEvent` doubles — this does not require a
live Workflow resource (same pattern already used for the Modal safe-egress
client's fake-socket unit tests).

### Task 2.1 — Workflow entrypoint skeleton + step graph

**Files:**
- Create `apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts`
- Test: `apps/edge-api/tests/paid-continuation-workflow.test.ts`

**Interfaces:**
- Consumes: `WorkflowContinuationInput`, `WorkflowContinuationResult`,
  `ContinuationEnvelopeV1`, `openContinuationEnvelope` (H2AWI-1);
  `ServiceExecutor`/`ExecutorOutcome` shape already defined in
  `apps/edge-api/src/control-plane/routes/x402-service.ts:103-134` (reused,
  not redefined); `D1PaymentAttemptRepository`
  (`apps/edge-api/src/control-plane/repositories/d1/payment-attempts.ts`);
  `JobState`/`createStateEvent`/`isTerminal`/`getAllowedTransitions`
  (`apps/edge-api/src/control-plane/state-machine/index.ts`);
  `CdpPaymentEvidenceProvider`
  (`apps/edge-api/src/control-plane/evidence/cdp-provider.ts`).
- Produces: `class PaidContinuationWorkflow extends WorkflowEntrypoint<Env,
  WorkflowContinuationInput>` with `run(event, step):
  Promise<WorkflowContinuationResult>`.

**Frozen step graph (7 steps, from design §11/§12):**

| # | STEP_NAME | INPUT | OUTPUT | SIDE EFFECTS | TIMEOUT | RETRIES | IDEMPOTENCY KEY | FAILURE STATE | LOGGING | SENSITIVE DATA |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | `open-envelope` | `WorkflowContinuationInput` | decrypted payment payload (in-step memory only) | none (pure) | 10s | 0 (deterministic — retrying a bad envelope never succeeds) | n/a | `workflow_internal_error` if throws | envelope error `code` only, never plaintext | payload held only in this step's closure, never returned from `step.do` |
| 1 | `check-authorization-expiry` | decrypted payload's `valid_before_unix` | `{expired: boolean}` | none (pure, reads `Date.now()`) | 5s | 0 | n/a | → `authorization_expired` terminal if expired | expiry delta in seconds | none |
| 2 | `invoke-executor` | job's service config + decrypted payload's non-secret routing fields | `ExecutorOutcome` | real network call to Modal safe-egress / CDP-composed executor | 40s (covers Modal's 35s hard kill + margin) | 2 (Workflow platform retry, exponential backoff) | `executorInvocationIdempotencyKey(payment_identifier)` | → `executor_rejected` / `executor_timeout` terminal | outcome class + latency, never payload | none |
| 3 | `generate-pcc` | `ExecutorOutcome` | signed PCC artifact | uses existing PCC signing key (unchanged) | 10s | 1 | `pccIdempotencyKey(payment_identifier)` | → `pcc_failed` terminal | PCC id only | none |
| 4 | `settle` | decrypted signed EIP-3009 payload + facilitator requirements | `SettleResponse` | **real on-chain settlement call** via `CdpPaymentEvidenceProvider.settle()` (reused from `evidence/cdp-provider.ts`, unchanged) | 20s | **0 (zero blind retries — frozen invariant)** | `settlementIdempotencyKey(payment_identifier)` — before calling, writes the SAME durable pre-settle draft shape `x402-service.ts` already writes (`cdp_settlement_pending_draft`) via `D1PaymentAttemptRepository`, so a crash between step-4 dispatch and step-4 completion is recoverable exactly like today's request-local path | → `settlement_rejected` OR → `settlement_ambiguous` (never automatically retried; see Task 2.4) | settle response class, transaction reference if present, never signature | signed payload is in step memory only for the duration of this one step; not returned to `run()`'s outer scope beyond a redacted summary |
| 5 | `persist-result` | `SettleResponse` (confirmed) | none | D1 write: job terminal state via `createStateEvent`, result row | 10s | 3 (safe to retry — write is upsert-by-`job_id`, and settlement is already confirmed before this step runs) | `resultPersistenceIdempotencyKey` | → `persistence_failed_after_settlement` if all retries exhausted (see Task 2.9 recovery) | job_id, terminal state name | none |
| 6 | `persist-receipt-and-finalize` | confirmed result | `WorkflowContinuationResult` | D1 write: receipt row + terminal state-machine transition via `createStateEvent`/`isTerminal` guard | 10s | 3 (same upsert-safety reasoning as step 5) | `receiptPersistenceIdempotencyKey` + `terminalEventIdempotencyKey` | `workflow_internal_error` if exhausted after settlement (money is safe, only bookkeeping incomplete — flagged for Task 2.9 recovery) | receipt_id | none |

**Checklist:**
1. Write failing test constructing a fake `WorkflowStep` (records `step.do`
   calls, allows injecting per-step success/throw), asserting the 7 steps
   are invoked in this exact order for the happy path, with the exact
   `IDEMPOTENCY KEY` string passed to each `step.do` call's name argument.
2. RED (class doesn't exist).
3. Implement `run()` calling `step.do(name, options, callback)` per the table
   above, `options` carrying `{retries: {limit, ...}, timeout}` matching the
   table.
4. GREEN.
5. Regression: full workflow test file.
6. Mutation proof: for step 4 specifically, mutate `retries.limit` from 0 to
   1 and confirm a dedicated test (`settle step has zero retries`) fails —
   proving the zero-blind-retry invariant is actually test-enforced, not
   just documented.
7. Commit: `SUN-1221E6R-H2AWI-2a: paid continuation workflow step graph`.

### Task 2.2 — Executor integration (reuse, not reinvent)

**Files:**
- Modify: `apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts`
  (step 2 body)
- Test: extend `paid-continuation-workflow.test.ts`

**Interfaces:**
- Consumes: `ServiceExecutor` type as already defined in `x402-service.ts`
  (`X402ServiceRouteConfig['executor']` today) — the Workflow constructs the
  same executor via the same composition functions
  (`apps/edge-api/src/control-plane/production/web-context-v2-cdp-composition.ts`'s
  `buildWebContextV2CdpProductionRouteConfig`, already fixed in E6P to
  forward `MODAL_WEBCTX_*`). No new executor abstraction — step 2 is a thin
  adapter calling the existing `ServiceExecutor` function with `env` bindings
  passed through `WorkflowEntrypoint`'s own `this.env`.

**Checklist:**
1. Failing test: step 2 calls the injected executor exactly once with the
   job's routing input, surfaces `ExecutorOutcome.rejected` as
   `executor_rejected`, surfaces a thrown timeout error as
   `executor_timeout`.
2. RED → 3. implement thin adapter → 4. GREEN.
5. Regression.
6. Mutation proof: swap `executor_rejected` and `executor_timeout` branches
   and confirm dedicated tests for each fail independently (proves they're
   not one merged catch-all).
7. Commit: `SUN-1221E6R-H2AWI-2b: workflow executor step integration`.

### Task 2.3 — PCC step integration

**Files:** same workflow file; test extension.

Reuses whatever existing PCC signing call the production executor already
performs (confirmed present in `web-context-v2-production-executor.ts` and
`verify-agent-output-v2-production-executor.ts` — grep hit in repo recon)
rather than a new `computePCC`. Step 3 wraps that exact call.

**Checklist:** same RED→GREEN→regression→mutation→commit shape as 2.1/2.2.
Mutation proof: a corrupted PCC signature must surface as `pcc_failed`, not
silently pass to step 4 — dedicated test.
Commit: `SUN-1221E6R-H2AWI-2c: workflow PCC step integration`.

### Task 2.4 — Settlement step + durable pre-settle draft reuse

**Files:** same workflow file; test extension; no changes to
`x402-service.ts` in this task (that file's own request-local settle path
stays alive and untouched until H2AWI-3 removes it).

**Design:** Step 4 calls `D1PaymentAttemptRepository`'s existing
draft-write method (same shape `x402-service.ts:243-299` already uses) to
persist `cdp_settlement_pending_draft` BEFORE calling
`CdpPaymentEvidenceProvider.settle()`, then calls `settle()` exactly once
(`retries.limit: 0`). Three outcomes:
- Success with clear confirmation → step returns confirmed `SettleResponse`.
- Explicit rejection (facilitator says no, pre-broadcast) → terminal
  `settlement_rejected`, zero economic effect, draft marked rejected.
- Ambiguous (network error mid-call, no clear yes/no) → terminal
  `settlement_ambiguous`; step does **not** retry; a **separate, later,
  explicitly human- or ops-triggered** reconciliation path (Task 2.5) is the
  only thing allowed to resolve it — never another `settle()` call from this
  Workflow run.

**Checklist:** RED→GREEN→regression→mutation (assert step 4 never calls
`settle()` a second time within one Workflow run under any injected fake
failure sequence — this is the single most important mutation test in the
whole plan) →commit `SUN-1221E6R-H2AWI-2d: settlement step with pre-settle draft reuse`.

### Task 2.5 — Settlement ambiguity reconciliation (read-only)

**Files:**
- Create `apps/edge-api/src/control-plane/continuation/settlement-reconciliation.ts`
- Test: `apps/edge-api/tests/settlement-reconciliation.test.ts`

**Interfaces:**
- Consumes: existing
  `apps/edge-api/src/control-plane/evidence/chain-receipt-checker.ts` (the
  same read-only on-chain checker `x402-service.ts` already injects as
  `cdpChainReceiptChecker`).
- Produces: `reconcileAmbiguousSettlement(paymentIdentifier, checker):
  Promise<SettlementReconciliationResult>` — bounded retries (design §12
  allows bounded retries here specifically, unlike step 4 itself), read-only,
  never calls `settle()`.

**Design decision (answers mission §12):** the `SETTLEMENT_AMBIGUOUS`
representation does **not** require a new D1 enum/column. It is represented
as: the Workflow instance terminates with
`WorkflowContinuationResult.status === 'settlement_ambiguous'`, and the
existing `payment_attempts` row's `lifecycle_stage` stays whatever the
pre-settle draft already set it to (`verified` per the H1A forensics
finding), with the pre-settle draft record itself serving as the durable
"an attempt happened, outcome unknown" marker — exactly the representation
`x402-service.ts` already uses today. This is intentionally **not** conflated
with `FAILED`: a job state machine transition to a `FAILED`-family
`JobState` only happens once `reconcileAmbiguousSettlement` returns
`not_found` after its bounded retry budget; `inconclusive` leaves the job
non-terminal for manual/ops follow-up (this is the one legitimate case in
this entire architecture where a job may sit non-terminal awaiting a human,
by design, matching how job `de147124` already sits today pending exactly
this kind of reconciliation).

**Checklist:** standard RED→GREEN→regression→mutation (bounded retry count
is exactly N, not unbounded — dedicated test)→commit
`SUN-1221E6R-H2AWI-2e: settlement ambiguity reconciliation`.

### Task 2.6 — Authorization expiry step

Already scoped in the step-graph table (step 1). Implementation task:

**Checklist:** RED (expired `valid_before_unix` must short-circuit before
step 2 ever runs — dedicated test proving `invoke-executor` is never called
when step 1 returns expired) → GREEN → regression → mutation (off-by-one
second boundary test: `valid_before_unix === now` treated as expired, not
valid — fail-closed) → commit
`SUN-1221E6R-H2AWI-2f: authorization expiry gate`.

### Task 2.7 — Result/receipt persistence + terminal transition

Already scoped (steps 5/6). Implementation task wires
`D1PaymentAttemptRepository` and `createStateEvent`/`isTerminal` from the
state machine.

**Checklist:** RED→GREEN→regression→mutation (attempting a second
`createStateEvent` transition out of an already-terminal state must throw
`TerminalStateError`, per existing state-machine code — dedicated test
proving the Workflow step respects this existing guard rather than
bypassing it) →commit
`SUN-1221E6R-H2AWI-2g: result/receipt persistence + terminal transition`.

### Task 2.8 — Crash/restart determinism tests

**Files:** `apps/edge-api/tests/paid-continuation-workflow-crash-matrix.test.ts`

Cloudflare Workflows guarantees each completed `step.do` is memoized and not
re-executed on Workflow restart; this test suite simulates restart by
re-invoking `run()` with a fake `WorkflowStep` whose `.do()` returns cached
results for already-completed step names and only actually invokes the
callback for not-yet-completed ones (mirroring the platform's own memoization
contract, per Cloudflare Workflows documentation on step memoization).

**Required matrix (12 cases, from mission §30, all decided in design §14
and reused here without re-deriving):**
1. Crash before step 0 (envelope never opened) — restart re-runs step 0,
   safe (pure).
2. Crash during step 2 (executor call) — Workflow-level retry re-invokes
   step 2; test asserts `executorInvocationIdempotencyKey`-scoped idempotency
   means a second Modal call is acceptable here (executor is designed
   idempotent/side-effect-free on the destination — this is a documented
   assumption inherited from the existing production executor's contract,
   not a new one).
3. Crash during step 3 (PCC) — same reasoning, PCC generation is
   deterministic from step-2's already-memoized output.
4. Crash before step 4's pre-settle draft write — restart re-runs step 4
   from scratch, draft not yet written, safe.
5. Crash after pre-settle draft write, before `settle()` call — restart
   finds existing draft; step 4 logic must check for an existing
   **unresolved** draft and route directly to `settlement_ambiguous`
   reconciliation rather than calling `settle()` again — dedicated test,
   this is the exact "crash after draft, before settle" case from design
   §14.
6. Crash during `settle()` network call, response never received — same
   as case 5 from the restarted Workflow's point of view (it only sees "an
   unresolved draft exists"): → `settlement_ambiguous`.
7. Crash after `settle()` returns confirmed, before step 4 returns — restart
   must NOT re-call `settle()`; must instead re-run reconciliation, find a
   confirmed on-chain result via `chain-receipt-checker.ts`, and proceed as
   if step 4 had returned confirmed (dedicated test: reconciliation feeding
   step 4's happy-path continuation, not just the ambiguous path).
8. Crash during step 5 (persist-result), settlement already confirmed —
   restart re-runs step 5 (upsert-safe by design, see step-graph table).
9. Crash during step 6 (persist-receipt), settlement already confirmed,
   result already persisted — restart re-runs step 6 only (steps 0-5
   memoized).
10. Duplicate Workflow create attempt for the same `payment_identifier`
    (e.g. HTTP handler retried the create call itself) — asserted at the
    HTTP-integration layer in H2AWI-3, not here, but this test file asserts
    the **precondition** the HTTP layer will rely on: `run()` given the same
    `WorkflowContinuationInput` twice (simulating the platform having
    somehow started two instances, which the platform's own instance-ID
    uniqueness should prevent) produces byte-identical `settle`
    idempotency-key usage in both, so IF that ever happened settlement is
    still bounded to the D1 at-most-one invariant as the final backstop.
11. Executor timeout exactly at the 40s step boundary — step must report
    `executor_timeout`, not hang.
12. Settlement rejected pre-broadcast (facilitator explicit no) — zero
    economic effect, terminal `settlement_rejected`, draft marked resolved
    (not left ambiguous).

**Checklist:** each of the 12 cases is its own `it(...)` block (no shared
loop hiding failures) → RED (file doesn't exist) → implement fake-step-with-
memoization test harness → GREEN on all 12 → this task is itself the
regression/mutation proof for Task 2.1-2.7's crash safety → commit
`SUN-1221E6R-H2AWI-2h: crash/restart determinism matrix (12 cases)`.

### H2AWI-2 exit gates

Same gate list as H2AWI-1, plus:
- `PROSPECTIVE_NEW_MODULE_COUNT` for this checkpoint = 2
  (`paid-continuation-workflow.ts`, `settlement-reconciliation.ts`).
- Bundle isolation: new workflow module still not imported by any production
  HTTP route (only by its own tests) — asserted explicitly.
- No live Workflow resource created; all tests run against fake
  `WorkflowStep`/`WorkflowEvent` doubles.

---

## H2AWI-3 — HTTP integration (local source only; no deployment)

Depends on H2AWI-1 and H2AWI-2's frozen interfaces.

### Task 3.1 — Durable handoff creation in the payment-verified path

**Files:**
- Modify: `apps/edge-api/src/control-plane/routes/x402-service.ts`
  (the point immediately after payment verification succeeds and before the
  existing request-local `evidenceProvider.settle()` call)
- Test: extend `apps/edge-api/tests/x402-service-route.test.ts` (existing
  file, per H2A's precedent in the same suite)

**Interfaces:**
- Consumes: `deriveWorkflowInstanceId`, `sealContinuationEnvelope`
  (H2AWI-1); `Env['PAID_CONTINUATION_WORKFLOW']` binding type (added to
  `apps/edge-api/src/control-plane/config/env.ts`'s `Env` interface as
  `Workflow<WorkflowContinuationInput>`).
- Produces: a durable-handoff helper,
  `createOrJoinPaidContinuation(env, input): Promise<WorkflowInstance>`,
  added to a new small file
  `apps/edge-api/src/control-plane/continuation/handoff.ts` (kept separate
  from the 1000+ line `x402-service.ts` per the "no giant orchestration
  file" rule) — `x402-service.ts` imports and calls it, does not inline the
  Workflow SDK calls itself.

**Design:** `createOrJoinPaidContinuation` calls
`env.PAID_CONTINUATION_WORKFLOW.create({id: deriveWorkflowInstanceId(...),
params: workflowInput})`; on `ExistingInstanceInstantiationError` (platform
guarantee, not a bug), it instead calls `env.PAID_CONTINUATION_WORKFLOW.get(id)`
and returns the existing instance — this is the mechanism answering mission
§16 (retrying client with the same `payment_identifier` joins the same
Workflow rather than creating a second one; no second `settle()` is
possible because the Workflow instance, and therefore step 4's
zero-retry settle call, only ever runs once per instance ID).

**Checklist:** RED (test expects `createOrJoinPaidContinuation` to be called
exactly once after verification, with a `WorkflowContinuationInput` whose
envelope round-trips to the same signed payload the route received) → GREEN
→ regression (full `x402-service-route.test.ts`) → mutation (a duplicate
call with the same `payment_identifier` must hit the `get()` branch, not
`create()` twice — dedicated test using a fake `Workflow` binding that
throws `ExistingInstanceInstantiationError` on the second `create()`) →
commit `SUN-1221E6R-H2AWI-3a: durable handoff creation after payment verification`.

### Task 3.2 — Remove request-local settlement ownership

**Files:**
- Modify: `apps/edge-api/src/control-plane/routes/x402-service.ts` (delete
  the direct `evidenceProvider.settle()` call site and the
  now-Workflow-owned pending-draft write that duplicates Task 2.4's logic;
  keep `CdpPaymentEvidenceProvider` itself unchanged — it is reused BY the
  Workflow, not deleted)
- Test: extend `x402-service-route.test.ts`

**Required invariant test (mission §9):**
```
HTTP_SETTLE_CALL_COUNT_MAX = 0
WORKFLOW_SETTLE_CALL_COUNT_MAX = 1
```
A dedicated test instruments a fake `evidenceProvider.settle` with a call
counter, drives a full simulated paid request through the route handler with
a fake Workflow binding, and asserts the route itself never calls `settle`
directly — only `PAID_CONTINUATION_WORKFLOW.create`/`get`. A second test
proves there is no code path where a Workflow `get()`/status-lookup failure
falls through to a local `settle()` call (mutation: temporarily reintroduce
a fallback branch and confirm this specific test fails — this is the
concrete kill-switch for "accidental second settlement owner" from mission
§9).

**Checklist:** RED→GREEN→regression (this is the highest-risk change in the
whole plan — full `pnpm test` run required, not just the targeted file) →
mutation (as above) → commit
`SUN-1221E6R-H2AWI-3b: remove request-local settlement, Workflow becomes sole owner`.

### Task 3.3 — Synchronous HTTP waiter

**Files:**
- Create `apps/edge-api/src/control-plane/continuation/waiter.ts`
- Test: `apps/edge-api/tests/continuation-waiter.test.ts`
- Modify: `x402-service.ts` to call the waiter after handoff.

**Design (answers mission §15):**
- Mechanism: poll, not push. `waitForWorkflowResult(instance,
  {pollIntervalMs: 500, httpMaxWaitMs: 25000}): Promise<WorkflowContinuationResult
  | {timedOut: true}>` calls `instance.status()` every 500ms.
- `httpMaxWaitMs: 25000` is chosen to stay safely under Cloudflare's
  documented ~30s `waitUntil`/disconnect-adjacent ceilings referenced in
  H2AR — but critically, **this bound is not a correctness primitive**
  (per the global constraint above): if the HTTP waiter times out, the
  Workflow keeps running to completion regardless, because it is durable
  and detached from this request. The waiter timeout only controls what the
  *synchronous HTTP response* says.
- Disconnect behavior: if the underlying `fetch`/Worker request is
  cancelled by client disconnect mid-poll, the poll loop simply stops (no
  `waitUntil` needed to keep the Workflow alive — the Workflow's own
  durability, not the Worker's, is what survives). This is the key
  architectural difference from H2A: nothing about Workflow completion
  depends on this Worker invocation surviving.
- Terminal-result retrieval: on success, waiter returns the
  `WorkflowContinuationResult`; route handler converts it to the exact
  existing public HTTP response shape (unchanged schema, per mission §15's
  "public response schema must remain unchanged" and design §17).
- Error conversion: `{timedOut: true}` → route returns the existing "still
  processing" interim response shape if one already exists in the current
  contract, else (if no such shape exists today) a `202`-class response
  carrying the Workflow instance's poll-again information — **this exact
  choice requires reading the current OpenAPI/service-detail contract in
  Task 3.4 before finalizing**, flagged here rather than guessed.

**Checklist:** RED→GREEN→regression→mutation (poll loop must stop exactly
at `httpMaxWaitMs`, not one interval late or early — boundary test) →
commit `SUN-1221E6R-H2AWI-3c: synchronous HTTP waiter over Workflow status`.

### Task 3.4 — Public contract verification

**Files:**
- No production source change. Test-only:
  `apps/edge-api/tests/x402-public-contract-unchanged.test.ts`

**Task:** Snapshot the current OpenAPI/service-detail/agent-card responses
for `web_context_verified.v2` (already exercised by existing coherence tests
per the E6H/E6I/E6P checkpoints' own `pnpm run route:coherence`-style checks)
before Task 3.1-3.3 land, and again after; assert byte-identical schema
(timing/latency characteristics may differ, structure may not). This test
is written and run RED (capture baseline) before 3.1 starts, then re-run
GREEN after 3.3 completes — it is the concrete proof for mission §15's "must
remain unchanged" requirement, not an assertion made without evidence.

**Checklist:** capture baseline → (3.1-3.3 land) → re-run, GREEN → commit
`SUN-1221E6R-H2AWI-3d: public contract unchanged proof`.

### Task 3.5 — Duplicate client retry behavior

**Files:** extend `x402-service-route.test.ts`.

**Design (answers mission §16 precisely):** when a client resubmits the
identical paid request (same signed payload, hence same
`payment_identifier`) after losing the first response, the route:
1. Re-verifies the payment signature/quote read-only (cheap, already
   required for request parsing) — **does not** re-call the facilitator's
   verify endpoint if a `payment_attempts` row for this `payment_identifier`
   already shows `lifecycle_stage=verified` or later (avoids a redundant
   facilitator call, matches existing `x402-service.ts` idempotency
   precedent for repeated requests).
2. Calls `createOrJoinPaidContinuation` — hits the `get()` branch (Task
   3.1), joining the in-flight or completed Workflow instance.
3. Waits via Task 3.3's waiter and returns whatever the (single, shared)
   Workflow instance's actual outcome is.

Net effect: **no second settle**, and the second HTTP request transparently
observes the first payment's real outcome — exactly the guarantee mission
§16 requires, stated exactly rather than left as "should be safe."

**Checklist:** RED (dedicated test: two concurrent simulated requests with
identical payload → exactly one `settle()` call recorded across both) →
GREEN → regression → mutation (remove the `get()`-joining behavior and
confirm this test fails, proving it's load-bearing) → commit
`SUN-1221E6R-H2AWI-3e: duplicate client retry joins existing workflow instance`.

### Task 3.6 — Workflow create failure (verify succeeded, no executor/settlement)

**Files:** extend `x402-service-route.test.ts`.

**Checklist:** RED (fake `PAID_CONTINUATION_WORKFLOW.create` throws a
non-`ExistingInstanceInstantiationError` error → route returns an explicit
failure response, `evidenceProvider.settle` call count stays 0, no
synchronous fallback path exists) → GREEN → regression → mutation (reinsert
a fallback-to-local-settle branch, confirm test fails) → commit
`SUN-1221E6R-H2AWI-3f: workflow create failure has no synchronous fallback`.

### Task 3.7 — Bundle isolation re-verification

**Files:** extend the existing production-bundle isolation test (same one
used in Q5/Q6 checkpoints throughout this project).

**Checklist:** confirm the new `continuation/` modules and
`workflows/paid-continuation-workflow.ts` ARE now present in the production
bundle (they're wired in, unlike H2AWI-1/2 where they were inert) and that
no dev-diagnostic-only code leaked in alongside them → commit
`SUN-1221E6R-H2AWI-3g: bundle isolation re-verification post-integration`.

### H2AWI-3 exit gates

- Full `pnpm test`, `pnpm test:worker-runtime`, `pnpm lint`, `pnpm
  typecheck`, `pnpm production:preflight`, `pnpm secrets:scan` all PASS.
- `HTTP_SETTLE_CALL_COUNT_MAX=0` proven by Task 3.2's dedicated test, not
  asserted narratively.
- No Workflow resource provisioned yet, no Worker version uploaded — this
  checkpoint changes local source only, exactly like H2AWI-1/2.

---

## H2AWI-4 — External provisioning + non-economic live qualification

**REQUIRES fresh standalone human external-mutation authorization before any
task in this section begins**, per the same gate pattern already established
for Q6H (Modal provisioning) and Q6I/E6P (Worker candidate creation) earlier
in this project.

### Task 4.1 — Wrangler Workflow binding

**Files:** modify `wrangler.toml` (add a `[[workflows]]` block: `name =
"siteborne-paid-continuation"`, `binding = "PAID_CONTINUATION_WORKFLOW"`,
`class_name = "PaidContinuationWorkflow"`), modify
`apps/edge-api/src/control-plane/config/env.ts` (add
`PAID_CONTINUATION_WORKFLOW: Workflow<WorkflowContinuationInput>` to `Env`),
and the Worker's main export module (wherever other `WorkflowEntrypoint`
classes would need re-export — this repo has none yet, so this is a new
export of `PaidContinuationWorkflow` from the Worker's entrypoint file,
required by Cloudflare Workflows' deployment model).

### Task 4.2 — Continuation encryption secret provisioning

Name: `PAYMENT_CONTINUATION_ENCRYPTION_KEY` (matches the naming convention
of existing `MODAL_WEBCTX_*` secrets and `PAID_RECEIPT_SIGNING_PRIVATE_KEY`).
Generation: 32 random bytes via `openssl rand -base64 32`, provisioned via
`wrangler versions secret put` (never `wrangler secret put`, per the E6H/E6I
precedent already established this project — non-deployed candidate only).
Rotation: `key_id` field in the envelope (Task 1.3) allows a future second
secret (`PAYMENT_CONTINUATION_ENCRYPTION_KEY_V2`) to coexist during a
rotation window — old-key envelopes (which are short-lived, seconds to
minutes, since they only exist between HTTP handoff and Workflow step 0)
naturally age out; no long-term dual-key decrypt path is needed given the
envelope's lifetime is bounded to one Workflow run, not indefinite storage.

### Task 4.3 — D1 migration determination

Per Task 6.1 (deferred from H2AWI-1's idempotency-key mapping table): read
the current `payment_attempts` schema in full (migration files under
whatever directory `docs/decisions/0045-d1-payment-attempt-persistence.md`
documents) to confirm whether `receipt_id`/`settlement_transaction_reference`
columns already exist (H1A forensics observed them present as queryable
fields on the row, suggesting **no migration is needed** — but this must be
confirmed against the actual `CREATE TABLE`/migration file, not inferred
from one forensic query, before this task can close). If confirmed absent:
add one additive (nullable, no data loss, no `de70bf98` incompatibility)
migration. If confirmed present: `D1_MUTATIONS=0` for this plan, documented
with the exact schema file reference as proof.

### Task 4.4 — Candidate build + non-economic verification

Build one non-deployed candidate (same `wrangler versions upload
--keep-vars --secrets-file` pattern already proven safe in E6P/Q6I) from
H2AWI-1/2/3 source, restore all 7 governed vars, confirm Workflow binding
resolves, run the same non-economic dual-target verification style already
used for the Modal executor (Q6H) — but for this checkpoint, "non-economic"
means driving a full Workflow run through steps 0-3 with a deliberately
invalid/expired test authorization so step 4 never actually calls a real
`settle()`, proving steps 0-3 and the crash/restart guarantees work against
a live (not faked) Workflow resource before any real money is at risk.

### Task 4.5 — Key-ID selection at call sites

Wire the caller-side (Task 3.1's `handoff.ts`) key lookup: read
`env.PAYMENT_CONTINUATION_ENCRYPTION_KEY`, import via
`crypto.subtle.importKey`, pass the resulting `CryptoKey` + a fixed
`key_id: 'v1'` into `sealContinuationEnvelope`. This is the first point
where H2AWI-1's "this module does not do key lookup" boundary (Task 1.3) is
closed by a concrete caller.

### H2AWI-4 exit gates

- Candidate technically valid, 0% traffic, production untouched.
- `SUN1221E6R_H2B_REAL_PAYMENT_ELIGIBLE` becomes `YES` only after this
  checkpoint's full gate list passes — matching every prior real-payment
  eligibility gate in this project (E6P → E6R, same pattern).
- Ends with exactly one immutable candidate, per mission §26.

---

## H2B — Real payment qualification

Out of scope for implementation planning. Requires a fresh standalone human
payment authorization, exactly one 402/EIP-3009/paid-submission/settlement
cycle, and human-executed signing per this project's established boundary
(the coding agent does not construct or submit live financial transactions
itself — see SUN-1221E6R-H1/H1-H2 precedent).

---

## Rollback compatibility (mission §22, frozen here)

- **New schema/resource exists, production still `de70bf98`:** safe by
  construction — `de70bf98` never references the Workflow binding or the new
  `continuation/` modules; they are additive and unused by old code.
- **Candidate qualification running (H2AWI-4), rollback of production:**
  unaffected — qualification traffic is 0%, isolated from `de70bf98`'s
  100%.
- **New candidate fails:** discard the candidate (never delete `de70bf98`);
  no Workflow instances exist yet at this point since none have been
  created by production traffic.
- **Post-promotion rollback with an in-flight Workflow:** `ROLLBACK_DOES_NOT_
  KILL_INFLIGHT_WORKFLOW=YES` — Cloudflare Workflow instances are
  independent resources from the Worker version that created them; rolling
  the Worker version back does not terminate or delete existing Workflow
  instances, which continue running/completing on their own. A rolled-back
  Worker version that no longer exports `PaidContinuationWorkflow` would
  break *new* instance creation, not existing ones — this is a genuine
  platform limitation to respect: **rollback must not remove the
  `PaidContinuationWorkflow` export** while any instance might still be
  in flight; if a full code rollback is ever needed after production
  traffic exists, it must wait for in-flight Workflow instances to drain
  (bounded by the per-step timeouts in the step-graph table, worst case
  under 2 minutes) or be treated as a deliberate, separately-authorized
  containment decision, not an ordinary rollback.
- `ROLLBACK_DOES_NOT_DUPLICATE_SETTLEMENT=YES`: guaranteed by the same
  Workflow-instance-ID-uniqueness + zero-blind-retry-on-settle invariants
  proven in H2AWI-2/3 regardless of which Worker version is currently
  active, since settlement ownership lives in the Workflow instance, not in
  Worker version state.

## Test requirement coverage map

| Mission §30 requirement | Covered by |
|---|---|
| client disconnect | Task 3.3, 3.4 |
| Workflow restart | Task 2.8 (cases 1-9) |
| duplicate Workflow create | Task 3.1 mutation test, Task 2.8 case 10 |
| executor failure | Task 2.2 |
| executor timeout | Task 2.2, 2.8 case 11 |
| PCC failure | Task 2.3 |
| authorization expiry | Task 2.6 |
| settle rejection | Task 2.4, 2.8 case 12 |
| settle ambiguity | Task 2.4, 2.5, 2.8 cases 5-7 |
| crash after settle transmission | Task 2.8 cases 6-9 |
| settled-on-chain + persistence failure | Task 2.8 case 8-9, step-graph `persistence_failed_after_settlement` |
| duplicate client retry | Task 3.5 |
| envelope tamper | Task 1.4 cases 3-4 |
| AAD substitution | Task 1.4 cases 5-10 |
| wrong amount/network/service/payTo | Task 1.4 cases 8, 7, 6, 9 |
| missing key | Task 1.4 case 13 |
| rotation | Task 1.4 case 14, Task 4.2 |
| waiter disconnect | Task 3.3 |
| rollback with in-flight Workflow | Rollback compatibility section above (design-level, not a unit test — flagged as an operational runbook item, not code) |

`DESIGN_TEST_REQUIREMENT_COUNT=19`, `PLANNED_TEST_REQUIREMENT_COUNT=19`,
`UNCOVERED_TEST_REQUIREMENTS=0`.

## Security control coverage map

| Threat (design §27) | Checkpoint owner |
|---|---|
| ciphertext theft | Task 1.3 (AES-256-GCM, no plaintext persistence) |
| key compromise | Task 4.2 (rotation via `key_id`) |
| cross-job ciphertext transplant | Task 1.4 cases 5-10 (AAD binding) |
| replay | Task 2.6 (authorization expiry), Task 3.1/3.5 (instance-ID dedup) |
| log leakage | Task 1.3 (error taxonomy excludes plaintext), Task 2.1 (logging column in step-graph table) |
| Workflow invocation spoofing | Task 4.1 (binding is Worker-internal only, not a public entrypoint) |
| duplicate economic execution | Task 2.4 mutation test, Task 3.1/3.5 |
| settlement replay | Task 2.4 (zero blind retries), Task 2.8 case 10 |
| stale authorization | Task 2.6 |
| malicious client retry | Task 3.5 |

No item is "handled later" without a named checkpoint owner.

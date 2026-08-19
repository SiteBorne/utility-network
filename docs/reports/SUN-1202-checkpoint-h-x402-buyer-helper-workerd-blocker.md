# SUN-1202 Checkpoint H — x402 Buyer-Helper `workerd` Functional Blocker

Resolves the `X402_EXTENSION_CLASSIFICATION = FUNCTIONAL_BLOCKER` finding
SUN-1201 checkpoint G surfaced. Implementation commit `a697225`. This report
commits separately.

## Repository

- `START_HEAD` = `b3f8b1f` (SUN-1201 checkpoint G closure report)
- `END_HEAD` = this report's own commit, on top of `a697225`
- Implementation commit: `a697225`
- Closure-report commit: (this file's own commit, immediately following)
- Working-tree state: clean except the known transient `wrangler.toml` diff,
  confirmed before and after every step (including both mutation proofs, which
  explicitly assert this via `git diff` in their own `finally` blocks)
- Transient `wrangler.toml` diff: unchanged content throughout

## Reproduction

**`BUYER_HELPER_WORKERD_REPRODUCED = YES`**, reproduced fresh in this checkpoint
(not asserted from the prior report alone).

- Package/helper: `@x402/extensions@2.21.0` (pinned; also re-checked against
  `2.23.0`, the latest published version — identical defect), function
  `declarePaymentIdentifierExtension` (server-side) /
  `validatePaymentIdentifier` (server-side validator) — reached via SITEBORNE's
  own official buyer helper, `buildBuyerPaymentIdentifierExtensions`
  (`packages/protocol-x402/src/identifier/payment-identifier.ts`), which wraps
  upstream's `appendPaymentIdentifierToExtensions`.
- Input: `declareSiteborneePaymentIdentifierSupport(true)` (the real server-side
  402-challenge declaration) →
  `buildBuyerPaymentIdentifierExtensions(declared, id)` (the real, official
  buyer-side helper, called exactly as a real buyer client would).
- Emitted extension object (real, from the real helper, captured in
  `payment-identifier.test.ts`'s new "H1" test):
  `{"payment-identifier":{"info":{"required":true,"id":"pay_<uuid>"},"schema":{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"required":{"type":"boolean"},"id":{"type":"string","minLength":16,"maxLength":128,"pattern":"^[a-zA-Z0-9_-]+$"}},"required":["required"]}}}`
- Encoded request representation: `Base64(JSON.stringify(PaymentPayload))` in
  the `PAYMENT-SIGNATURE` header, per
  `packages/protocol-x402/src/codec/headers.ts`.
- Receiving code: `apps/edge-api/src/control-plane/routes/x402-service.ts` →
  `parsePaymentIdentifier` → `@x402/extensions`'
  `extractAndValidatePaymentIdentifier` → `validatePaymentIdentifier`.
- Exact rejection point (before this checkpoint's fix):
  `validatePaymentIdentifier`'s
  `if (ext.schema) { try { ajv.compile(ext.schema) ... } catch (error) { return {valid:false, ...} } }`.
- **Node result**: succeeds (Node allows `eval`/`new Function`) —
  `parsePaymentIdentifier` returns `{status: 'present', id}`.
- **`workerd` result (before fix)**:
  `400 {"error":"malformed_payment_signature","message":"malformed"}`.
  Underlying exception, confirmed via a standalone smoke test (a bare fetch
  handler doing nothing but `new Ajv2020().compile()` on the extension's schema,
  no surrounding try/catch):
  `EvalError: Code generation from strings disallowed for this context`, thrown
  reliably, every request, under real `wrangler dev --local`.

## Root cause

**`ROOT_CAUSE`**: `@x402/extensions`' `declarePaymentIdentifierExtension`
unconditionally attaches `paymentIdentifierSchema` to every server-declared
`payment-identifier` extension (no way to omit it via that official API); its
`validatePaymentIdentifier` performs a real, request-time
`new Ajv2020().compile(ext.schema)` whenever a buyer echoes that field back — a
real Workers `EvalError` under `workerd`'s request-time dynamic-code-generation
restriction, self-caught by the package's own `try/catch` into a false
`{valid: false}`.

**`FAULT_OWNER = UPSTREAM`**. Confirmed by reading the installed package source
directly across two versions (pinned 2.21.0, latest published 2.23.0 —
byte-identical in this regard): not a version-skew issue. Not caused by any
non-standard SITEBORNE wrapper behavior — SITEBORNE's buyer helper does exactly
what the official API documents (echo the declared extension, fill in `id`).

Protocol authority consulted: the pinned upstream package's own source (only
available authority — no separate official protocol document was bundled or
referenced beyond the package itself). `ext.schema` is structurally optional in
`validatePaymentIdentifier`'s own logic (guarded by `if (ext.schema)`), and
SITEBORNE's own contract
(`packages/protocol-x402/src/identifier/payment-identifier.ts`'s own doc
comment) already establishes that the Payment-Identifier extension's `id` is "an
idempotency coordinate, not proof of payment" — `schema` is strictly weaker than
that: pure self-descriptive metadata, never wire content
`info.id`/`info.required` depend on.

Affected field/operation:
`PaymentPayload.extensions['payment-identifier'].schema`, consumed only by
`validatePaymentIdentifier`'s optional self-validation branch.

## Resolution

**`FIX_STRATEGY` = Preferred A (SITEBORNE compatibility adapter)**, per the
governing directive's own preference ordering. New
`sanitizePaymentIdentifierExtensionForValidation` drops (only) the
`payment-identifier` extension's `schema` field from an already-decoded
`PaymentPayload`, applied unconditionally inside `parsePaymentIdentifier` itself
— the single real entry point every caller (the real HTTP route, every test, any
future caller) passes through, so the fix cannot be bypassed by a caller
forgetting to apply it separately.

**Files changed**:

- `packages/protocol-x402/src/identifier/payment-identifier.ts` — the adapter +
  wiring.
- `packages/protocol-x402/src/identifier/payment-identifier.test.ts` — 8 new
  tests (21 total, up from 13), including one using the real, official buyer
  helper end-to-end.
- `scripts/test-worker-runtime.mts` — Phase 2's buyer-payload construction now
  echoes the full declared extension (schema included), exactly the official
  shape; two new H3/H4 scenarios.
- `scripts/test-x402-blocker-caught.mts` (new) — the blocker regression/
  mutation proof.
- `docs/decisions/0057-x402-payment-identifier-schema-sanitization.md` (new
  ADR).

**Dependency changes**: none. `@x402/extensions`/`@x402/core` remain pinned at
`2.21.0` — confirmed (by reading the latest published 2.23.0 source directly)
that upgrading would not have fixed this, so no upgrade was attempted.

**Wire-format changes**: none. `agent-verification-input.schema.json` and every
other contract schema file are byte-identical.
`pnpm contracts:baseline:verify`/`compat:check`/`release:verify` all pass with
zero detected drift — see ADR 0057's own "why this is not a wire-format change"
section.

**Cryptographic-semantics changes**: none. Full trace, buyer helper → extension
→ encoded request → server parser → validator → payment verification →
settlement/execution:

| Field                                                                                                                        | Classification                                            | Changed?                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payload.payload` (the signed authorization: real EIP-712 signature in production, `synthetic_signature` under fixture mode) | signature-bound                                           | No — untouched, sanitizer never reads or writes it                                                                                                                          |
| `payload.accepted` (scheme/network/amount/asset/payTo/quote binding)                                                         | payment-identity + settlement-bound                       | No — untouched                                                                                                                                                              |
| `extensions['payment-identifier'].info.id`                                                                                   | payment-identity (idempotency coordinate)                 | No — passed through unchanged                                                                                                                                               |
| `extensions['payment-identifier'].info.required`                                                                             | metadata (server-declared requirement flag)               | No — passed through unchanged; the SERVER's own stored `paymentIdentifierRequired` config, never the buyer-echoed value, controls missing/required semantics (proven by H4) |
| `extensions['payment-identifier'].schema`                                                                                    | presentation-only (self-descriptive JSON Schema metadata) | **Dropped**, deliberately, before reaching the upstream validator                                                                                                           |

No signature-bound or settlement-bound value is touched. Payment
verification/settlement code (`evidence/verification.ts`,
`evidence/settlement.ts`, the CDP/Nevermined evidence providers) is untouched by
this checkpoint.

**`X402_EXTENSION_CLASSIFICATION` = `RESOLVED`.**

## Security

- Malformed extension result: still rejected. H3 (real `workerd`,
  `scripts/test-worker-runtime.mts`): a schema-echoing extension with an invalid
  `id` (`too-short`) → `400 malformed_payment_signature`. Also covered at the
  Node level (`payment-identifier.test.ts`'s H3 test).
- Security-field mutation result: still rejected/governed correctly. H4 (real
  `workerd`): a buyer that tampers with the echoed `info.required` flag (claims
  `false`, omits an id) on a route the SERVER's own stored config marks required
  → `400 malformed_payment_signature` (`missing_required_identifier`) — the
  server-declared requirement, not the buyer's claim, controls the outcome. Also
  covered at the Node level.
- Unsigned request result: unchanged. Phase 1 (real `wrangler.toml`)
  re-verified: `web_context_verified.v2`/`document_evidence_json.v2` unsigned
  requests still 402.
- Payment verification: unchanged — no file in `evidence/verification.ts`,
  `evidence/settlement.ts`, `evidence/provider.ts`, or any CDP/Nevermined
  evidence-provider implementation was touched.
- Test settlement seam still production-unreachable: re-verified this checkpoint
  — bundle-isolation check (fresh `wrangler deploy --dry-run` of the real
  `wrangler.toml`) still finds zero matches for the test entrypoint's source
  chunk or marker.
- **`REQUEST_CONTROLLED_PAYMENT_BYPASS = NONE`.** The sanitizer only ever
  removes a field; it adds no new code path a request can select, and it applies
  unconditionally (not gated by any header/query/env value).

## Worker runtime

- Official buyer-helper-compatible path: **works under real `workerd`** — Phase
  2's Case A/B now construct payloads that echo the full declared extension
  (schema included), exactly the real official helper's output, and both pass.
- Cases A/B: unchanged governing outcomes (200/`success`/`pass` and
  502/`service_execution_failed`/`partial` respectively), now proven with the
  schema-echoing (real, official) payload shape rather than SUN-1201's
  workaround shape.
- Cases C/D/E/F control: unchanged, re-verified this checkpoint, all still pass
  (pre-economic 400s, real `wrangler.toml`).
- Worker-runtime total pass count: **17/17** (up from SUN-1201's 15/15 — 2 new
  H3/H4 scenarios added).
- `SUCCESSFUL_EXECUTION_WORKERD` = still `YES` (unchanged, re-verified).

## Bundle

Fresh `wrangler deploy --dry-run` of the real `wrangler.toml` (173,832-line
bundle):

- Bare `eval(` count: **0**.
- `new Function(` count: **1** (AJV's own internal `_compile`, the same single
  library-internal occurrence as every prior checkpoint — not a new reachable
  call site).
- Request-reachable dynamic-code-generation count from this fix: **0** —
  `sanitizePaymentIdentifierExtensionForValidation` does no code generation of
  any kind; it is present in the bundle (3 occurrences: definition + call
  sites), confirming the fix IS reachable in the real Worker, exactly as
  intended.
- `@x402/extensions`' own `ajv2.compile(ext.schema)` call site is still
  textually present in the bundle (it is unmodified upstream library code) — but
  now provably unreachable with a non-empty `schema`, since
  `parsePaymentIdentifier` strips that field before upstream's validator ever
  sees it, for every caller, unconditionally.
- Deterministic provider (`FixturePaymentEvidenceProvider`): present in the
  bundle (pre-existing, already-audited — see SUN-1201's report), never
  reachable from any production request path.
- Test entrypoint (`worker-runtime-test-entrypoint.ts`): **absent** — zero
  matches for its source chunk or marker string.

## Regression

| Gate                                                                                                                                                       | Result                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused x402 tests (`payment-identifier.test.ts`)                                                                                                          | 21/21 pass                                                                                                                                                 |
| Full Vitest (`protocol-x402 service-runtime apps/edge-api/tests/x402-service-route.test.ts apps/edge-api/tests/paid-routes-mounting.test.ts verification`) | **67 files / 778 tests, all pass**                                                                                                                         |
| Profile 1 differential suite (`schema-profile-1.test.ts`)                                                                                                  | included above, 55/55 (untouched by this checkpoint)                                                                                                       |
| `pnpm test:worker-runtime`                                                                                                                                 | **17/17**                                                                                                                                                  |
| `pnpm schemas:check`                                                                                                                                       | pass                                                                                                                                                       |
| Whole-repo typecheck                                                                                                                                       | 23/23 tasks pass                                                                                                                                           |
| Lint                                                                                                                                                       | 16/16 tasks pass (including the one `no-unused-vars` fix in `payment-identifier.ts`)                                                                       |
| Format (`prettier --check .`)                                                                                                                              | pass                                                                                                                                                       |
| `pnpm secrets:scan`                                                                                                                                        | pass, 0 leaks                                                                                                                                              |
| `pnpm check`                                                                                                                                               | **exit 0**                                                                                                                                                 |
| `pnpm security:release`                                                                                                                                    | **exit 0** (semgrep/OSV/Trivy 0C-0H/Schemathesis/chaos/load/test:worker-runtime all green)                                                                 |
| `pnpm contracts:baseline:verify`/`compat:check`/`release:verify`                                                                                           | all pass, zero drift                                                                                                                                       |
| Production bundle audit                                                                                                                                    | 1 `new Function(` (unreachable), 0 bare `eval(`, fix reachable, test entrypoint absent                                                                     |
| Old-AJV mutation proof (`test-old-verify-path-caught.mts`)                                                                                                 | **PASS** — `OLD_VERIFY_PATH_CAUGHT` remains `YES`, re-run against this checkpoint's code, unregressed                                                      |
| New x402 blocker regression proof (`test-x402-blocker-caught.mts`)                                                                                         | **PASS** — mutant reproduces the exact SUN-1201 blocker (400 `malformed_payment_signature` on the official-buyer-helper shape), restoration verified clean |

## Economic state

`VERSION_UPLOADS=0` `DEPLOYMENTS=0` `PAYMENT_SIGNATURES=0` `SETTLEMENTS=0`
`TRANSACTIONS=0` — against real infrastructure, this entire checkpoint. Every
payment constructed anywhere in this checkpoint's tests/harnesses is synthetic,
against the structurally-isolated SUN-1201 test-only seam.

## Remaining blockers

**`PRODUCTION_CUTOVER_BLOCKERS`**: none currently known. This was the one
concrete, previously-identified blocker (`FUNCTIONAL_BLOCKER`) standing between
the closed worker-runtime proofs and a safe future cutover consideration; it is
now resolved.

**`GENUINELY_DEFERRED`**: the automated `test:worker-runtime`/mutation-proof
scripts remain `pnpm`-script-invoked local tooling, not wired into an external
CI system (none exists in this repository to wire into).

**`NEWLY_DISCOVERED_RISKS`**: none found this checkpoint beyond the one already
being resolved. The production bundle audit did not surface any further
request-time dynamic-code-generation call sites beyond the three
already-classified occurrences carried forward from SUN-1200/1201 (A2A
startup-only, zod's self-disabling JIT probe, AJV's own internal `_compile`).

**`CONTRACT_AMBIGUITIES`**: none. No SITEBORNE-visible wire contract changed;
this was purely an implementation/runtime-compatibility fix.

## Standing hard boundaries (unchanged, still in effect)

No version upload, no deploy, no route enablement, no secret modification, no
production D1/KV/R2 mutation, no payment signature, no real settlement, no real
transaction, at any point in this checkpoint. Production confirmed unchanged
immediately before writing this report: 100% at
`a4ada936-a434-4522-a8af-41c57170f4e4`, `GET /` → 200, unsigned
`POST /v2/verify/agent-output` → 404. **This checkpoint does not authorize the
next checkpoint and does not authorize any candidate upload.**

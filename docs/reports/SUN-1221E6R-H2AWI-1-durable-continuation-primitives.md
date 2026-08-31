# SUN-1221E6R-H2AWI-1 — Durable Continuation Shared Primitives

Local source + tests only. Zero Workflow provisioning, zero Cloudflare
resource creation, zero production secret, zero Worker upload, zero D1
mutation, zero deployment/traffic change, zero economic action.

## 1. Design and plan lineage

- Architecture design: `docs/reports/SUN-1221E6R-H2AW-durable-paid-continuation-workflow-design.md`, commit `21d11ab4770c628f0c8132ae842c9c93cf2382a3`.
- Implementation plan: `docs/superpowers/plans/2026-08-31-siteborne-durable-paid-continuation-workflow.md`, plan-freeze evidence commit `694b654ad5c6efd22fdebec4b0a6560987f5c41f`.
- This checkpoint implements plan Tasks 1.1–1.5 (H2AWI-1 scope only).

## 2. Session-limit interruption and resume

The first execution attempt (a background agent) failed mid-Task-1.2 with a
platform rate-limit error (`HTTP 429`, session limit, unrelated to this
work's correctness). A resume checkpoint (SUN-1221E6R-H2AWI-1R2) reported
that a worktree-lineage repair had already occurred — fast-forwarding the
implementation branch from a stale original HEAD
(`bfb2c452dbecdd61f3f468edf0df6dda3870d707`) to the correct plan-freeze base
(`694b654ad5c6efd22fdebec4b0a6560987f5c41f`) — and that Tasks 1.1–1.5 were
already committed.

Per this session's own standing rule (background-task notifications and
resume claims are not verified user input), **every claim in that resume
message was independently re-verified from scratch before being trusted**,
not accepted on the message's word:

- Worktree HEAD, branch, and working-tree cleanliness were checked directly
  (`git status --short`, `git rev-parse HEAD`, `git log --oneline`) and
  matched exactly: `a49cec8fee4103aefcae98a0e9d4bdb46367ede2`, clean.
- All four claimed implementation files and five claimed test files were
  confirmed to exist on disk.
- All 54 targeted default-pool tests were re-run and genuinely passed (not
  inferred from the resume text).
- The Workflow instance-ID algorithm's claimed hard-coded test vector
  (`pay_abc` → `siteborne-wf-0d20809df0229b75ab747c8e41d962a64b42ef348d5b5af4`)
  was independently recomputed with Node's own `crypto.createHash('sha256')`
  outside the test suite entirely, and matched exactly.
- The envelope's claimed algorithm, error-code taxonomy, and canonical AAD
  field order were read directly from `envelope.ts`'s source and matched the
  claims exactly (canonical JSON key order: `amount_atomic, asset, job_id,
  network, pay_to, payment_identifier, service, valid_before_unix`).

All of this held up under independent verification. Nothing in the resume
claims required correction.

## 3. Implementation commits

| Task | Commit | Subject |
|---|---|---|
| 1.1 | `422d2bbc1d7d883826664ee6d7b9616ac79eba3e` | continuation domain types |
| 1.2 | `548b633d76a5c85fcb54adc5cf9bac101461b636` | deterministic workflow instance id |
| 1.3/1.4 | `ca7f02c233a8847c2b3dd891a31477bc36865fd2` | AES-256-GCM continuation envelope |
| 1.5 | `a49cec8fee4103aefcae98a0e9d4bdb46367ede2` | idempotency key helpers + DB constraint mapping |
| bundle isolation | `87824240a96c812547be512bd9f6635259aa52d2` | prove continuation primitives remain bundle-isolated |

## 4. RED/GREEN evidence per task

Each task followed genuine TDD (its own commit's test file failed against
absent/incomplete implementation before the paired implementation commit made
it pass); the resume checkpoint's own record of durable RED observations was
independently corroborated by re-running the final GREEN state (§2) rather
than re-deriving each historical RED transcript, per this checkpoint's own
"do not repeat completed TDD" instruction. One genuine defect was caught and
fixed during Task 1.5's own GREEN pass: `workflowInstanceIdempotencyKey` was
typed `Promise<string>` but threw synchronously before ever returning a
promise (a caller doing `.catch()` on the return value would never see the
error) — corrected by making the wrapper genuinely `async`.

## 5. Workflow instance-ID algorithm

`apps/edge-api/src/control-plane/continuation/instance-id.ts`:
`deriveWorkflowInstanceId(paymentIdentifier: string): Promise<string>` —
`crypto.subtle.digest('SHA-256', ...)` over the UTF-8 payment identifier,
hex-encoded, truncated to the first 48 characters, prefixed `siteborne-wf-`
(61 characters total). Explicitly does not reuse `computeAttemptHash()`
(the repository's existing, cryptographically weak 32-bit rolling hash) —
Mutation 5 (§16) proves the test suite would catch a regression to that
weaker function.

Hard-coded vector: `pay_abc` →
`siteborne-wf-0d20809df0229b75ab747c8e41d962a64b42ef348d5b5af4`,
independently recomputed with Node's `crypto` module outside the test
harness (§2) and matched exactly.

## 6. Async WebCrypto interface clarification

The frozen plan's own interface shorthand,
`deriveWorkflowInstanceId(paymentIdentifier: string): string`, is a
documentation simplification, not the literal implemented signature.
`crypto.subtle.digest` is asynchronous in every runtime that provides it
(Web Crypto standard, including the Workers runtime), so no synchronous
implementation is possible without either a different digest algorithm or a
bundled non-native SHA-256 library — both rejected: the plan requires
`crypto.subtle.digest('SHA-256', ...)` specifically, and no new crypto
dependency is authorized. The implemented and tested signature is
`Promise<string>`; `workflowInstanceIdempotencyKey` (§8) mirrors the same
`Promise<string>` shape for the same reason. This is a plan-shorthand
clarification, not a design change: `PLAN_INTERFACE_DRIFT=NO_RUNTIME_DESIGN_DRIFT`.

## 7. Continuation envelope V1

`apps/edge-api/src/control-plane/continuation/envelope.ts`:
`sealContinuationEnvelope(...)` / `openContinuationEnvelope(...)` operate on
`ContinuationEnvelopeV1` (version `1`, `iv_b64`, `ciphertext_b64` including
the GCM authentication tag, `key_id`, `aad_fingerprint`) and
`ContinuationEnvelopeMetadata` (the clear, non-secret fields bound as AAD).

## 8. Cryptographic parameters

- Algorithm: **AES-256-GCM** (`AES_GCM = 'AES-GCM'`, `AES_KEY_BITS = 256`,
  enforced via `hasAes256Usage()` before every seal/open).
- IV: 12 bytes (`GCM_IV_BYTES`), freshly generated with
  `crypto.getRandomValues()` on every `seal` call — never reused, never
  derived.
- Ciphertext: raw AES-GCM output (ciphertext + 16-byte tag), base64-encoded.

## 9. Canonical AAD — all eight fields, exact order

`canonicalAad()` serializes exactly this JSON key order (verified directly
against source, §2):

```
amount_atomic, asset, job_id, network, pay_to, payment_identifier, service, valid_before_unix
```

Every field is validated present/well-formed before use
(`validateMetadata()`): the four `job_id`/`payment_identifier`/`service`/
`network`/`asset`/`pay_to` string fields must be non-empty strings,
`amount_atomic` must match `^(?:0|[1-9][0-9]*)$` (a non-negative integer
string, no leading zeros), and `valid_before_unix` must be a non-negative
safe integer.

## 10. Clear vs. encrypted fields

Clear (envelope metadata, never encrypted): the eight AAD fields above —
none of them is payment material; they are job/economic identity used only
to bind the ciphertext to the correct context, never to reconstruct a
payment. Encrypted (inside the AES-GCM ciphertext): the actual continuation
payload (the caller's arbitrary JSON-serializable value — in the real
H2AWI-3/H2AWI-2 flow, the signed EIP-3009 authorization). No raw signature,
authorization, or reusable payment material exists anywhere in clear
envelope fields, by construction — enforced by `RAW_SIGNATURE_PLAINTEXT_DURABLE_STORAGE_PLANNED=NO`'s test coverage (§14).

## 11. Error taxonomy — four codes

`EnvelopeOpenErrorCode`: `unsupported_version`, `malformed_encoding`,
`decrypt_failed`, `aad_mismatch`. Every thrown message is a static, redacted
string (e.g. `"Continuation envelope decryption failed"`,
`"Continuation envelope associated data does not match"`) — never includes
plaintext, key material, IV, ciphertext, or any part of the caller-supplied
payload. `instance-id.ts`'s own validation throws
`"paymentIdentifier must be a non-empty string"` (also static/redacted).

## 12. Missing/invalid key behavior

`hasAes256Usage()` rejects any `CryptoKey` that isn't AES-256 with the
correct `encrypt`/`decrypt` usage *before* attempting the crypto operation —
seal throws `TypeError('Continuation envelope key must be AES-256-GCM')`;
open throws `EnvelopeOpenError('decrypt_failed', ...)`. Both fail closed;
neither silently proceeds with a wrong/weak key.

## 13. Crypto test matrix

`continuation-envelope.test.ts`: 27 tests, re-run and confirmed passing in
this checkpoint (§2) — round trip, wrong key, tampered ciphertext, tampered
IV, all eight individual AAD-field substitutions, unsupported envelope
version, malformed encoding, missing encryption key, key-ID mismatch. None
of these tests depends on a production secret — every key used is a
locally-generated `CryptoKey` via `crypto.subtle.generateKey`.

## 14. AAD substitution coverage — eight fields

Each of the eight canonical AAD fields (§9) has its own dedicated
substitution test proving that field is genuinely bound into
authentication — altering any one of the eight, in isolation, with every
other field held correct, causes `openContinuationEnvelope` to reject with
`aad_mismatch` rather than silently succeeding.

## 15. Real-workerd compatibility

`tests/workerd/continuation-envelope.workerd-test.ts`: 2 tests, run in this
checkpoint against the actual Cloudflare Workers runtime (not Node's
polyfilled `crypto`, not a mock) via `vitest.workerd.config.ts` — confirmed
passing (§2). This proves `crypto.subtle.digest`/`crypto.subtle.encrypt`/
`crypto.subtle.decrypt`/`crypto.getRandomValues` behave identically to the
Node-side test expectations under the real target runtime, closing the gap
a Node-only test suite could not.

## 16. Security mutation proof — seven mutations

Seven one-at-a-time implementation mutations were performed (each applied,
observed to cause the expected test failure, then reverted before any
commit):

| # | Mutation | Caught by | Observed failure |
|---|---|---|---|
| 1 | remove AES-GCM `additionalData` from seal/open | job_id AAD substitution test | expected `decrypt_failed`, got `aad_mismatch` |
| 2 | remove `amount_atomic` from canonical AAD | amount_atomic binding test | altered amount opened successfully instead of failing |
| 3 | replace random IV with constant zero IV | fresh-IV test | both IVs identical (`AAAAAAAAAAAAAAAA`) |
| 4 | swallow decrypt failure, substitute plaintext | wrong-key test | wrong key no longer produced `decrypt_failed` |
| 5 | replace SHA-256 instance-ID derivation with `computeAttemptHash()`-style 32-bit hash | hard-coded `pay_abc` vector | weak result `siteborne-wf-000...000` instead of the real 48-hex-char digest |
| 6 | accept unsupported envelope version | V2 downgrade-rejection test | V2 envelope opened instead of `unsupported_version` |
| 7 | include serialized payment payload in missing-key error | redacted-error test | leaked marker `0xsensitive-eip3009-signature` appeared in the thrown message |

All seven were caught by an existing test and none required a new test to
be written to catch it — the 27-test matrix (§13) already provides full
coverage.

## 17. Idempotency helpers — domain separation

`apps/edge-api/src/control-plane/continuation/idempotency-keys.ts` exports
seven distinct key-derivation helpers, each scoped to one durable-write
domain so no cross-domain key collision is possible even for the same
`payment_identifier`: `workflowInstanceIdempotencyKey`,
`executorInvocationIdempotencyKey`, `pccIdempotencyKey`,
`settlementIdempotencyKey`, `resultPersistenceIdempotencyKey`,
`receiptPersistenceIdempotencyKey`, `terminalEventIdempotencyKey`.
`workflowInstanceIdempotencyKey` is the only one requiring the async SHA-256
derivation (§6); the remaining six are synchronous string-domain-prefixed
helpers safe for direct use inside a Workflow step or D1 write path.

## 18. H2AWI-2 / H2AWI-3 interface compatibility

Read the H2AWI-2 and H2AWI-3 consumer sections of the frozen plan without
implementing either. `ContinuationEnvelopeV1`, `ContinuationEnvelopeMetadata`,
`WorkflowContinuationInput`, `WorkflowContinuationResult`,
`SettlementReconciliationResult`, `openContinuationEnvelope`, and the six
synchronous idempotency helpers are consumable by H2AWI-2 without
redefinition. `deriveWorkflowInstanceId` and `sealContinuationEnvelope` are
consumable by H2AWI-3's future HTTP handoff, provided that consumer `await`s
the instance-ID derivation (§6) — no other change is required on the
H2AWI-3 side. No material interface contradiction was found.

`H2AWI2_INTERFACE_COMPATIBILITY=PASS`
`H2AWI3_INTERFACE_COMPATIBILITY=PASS_WITH_ASYNC_AWAIT_REQUIREMENT`
`PLAN_INTERFACE_DRIFT=NO_RUNTIME_DESIGN_DRIFT`

## 19. Bundle isolation proof

Added one narrow assertion to the existing
`runBundleIsolationCheck()` (`scripts/test-worker-runtime.mts`,
commit `8782424`), checking four exact, real strings pulled directly from
the new source (the `siteborne-wf-` prefix and three distinct thrown-error
messages) against the real `wrangler deploy --dry-run` production bundle.
Run via `pnpm test:worker-runtime`: **94/94 scenarios passed** (93 prior +
this new one), with `markers=none` — the continuation primitives remain
completely unimported/inert in the real production bundle.

## 20. Full regression — exact counts, this checkpoint's own run

| Gate | Result |
|---|---|
| `pnpm test` | **2517 passed**, 41 skipped (223 files, 203 passed / 20 skipped) |
| `pnpm test:worker-runtime` | **94/94 scenarios passed** |
| `pnpm lint` | **16/16 tasks PASS** |
| `pnpm typecheck` (whole repo) | 22/23 tasks pass; `@siteborne/edge-api` fails with exactly the two pre-existing baseline errors (§21) |
| `pnpm production:preflight` | **PASS** |
| `pnpm secrets:scan` | 4 findings, all 4 matching the established pre-existing baseline (2 unique findings × old/rewritten commit SHA each); **0 new** |
| Targeted continuation suite | **54/54** (default pool) + **2/2** (real-workerd) = **56/56** |
| Source-only edge-api typecheck (`tsc --project tsconfig.json`) | **PASS**, exit 0 |

`MODAL_TESTS=NOT_REQUIRED` — no Python/Modal source changed this checkpoint.

## 21. Whole-repository typecheck — unchanged baseline

`@siteborne/edge-api`'s aggregate typecheck command
(`tsc --project tsconfig.json && tsc --project tsconfig.live-tests.json`)
fails with exactly two errors, both in
`tests/live/web-context-first-paid-e2e-local.test.ts` (line 540:
`Promise<string>` not assignable to `Promise<\`0x${string}\`>`; line 623: a
mutated `PaymentRequirements.network` string not assignable to the branded
`\`${string}:${string}\`` type) — pre-existing, live-test-only, unrelated to
continuation work, confirmed as the *complete* error set with no additional
error from any continuation module. `TYPECHECK=ACCEPTED_UNCHANGED_BASELINE`.
The source-only `tsconfig.json` check (excluding live tests) passes cleanly
on its own (§20).

## 22. Aggregate edge-api real-workerd harness — separate, pre-existing failure

`pnpm --filter @siteborne/edge-api test:workerd` (the *aggregate* command
covering every `tests/workerd/*.workerd-test.ts` file, not the narrowly
targeted continuation-only invocation) encounters a pre-existing, unrelated
failure in `tests/workerd/input-schema-validation.workerd-test.ts`
(`SyntaxError: Unexpected token ':'` from AJV's ESM/CJS interop under the
workerd pool). This is a harness/dependency issue in a different, older
test file — not touched by this checkpoint. The continuation-specific
workerd test, run directly and in isolation (§15, §20), passes cleanly:
`EDGE_API_AGGREGATE_WORKERD_BASELINE=EXISTING_AJV_HARNESS_FAILURE`,
`WORKER_WEBCRYPTO_COMPATIBILITY=PASS`. The authoritative release harness
(`pnpm test:worker-runtime`, §19) is a separate command and was run
separately with a clean 94/94 result.

## 23. Public contract — no impact

Zero changes to `x402-service.ts`, any production route, `wrangler.toml`,
or any public response shape (§confirmed via diff, no such files touched —
see §26). `PUBLIC_CONTRACT_CHANGE=NO`, `ECONOMICS_CHANGE=NO`,
`PAYMENT_ORDERING_CHANGE=NO`, `D1_SCHEMA_CHANGED=NO`.

## 24. Waiter-timeout behavior — explicitly deferred

This checkpoint makes no decision about what the public HTTP response looks
like if a future HTTP waiter (H2AWI-3) times out while its Workflow keeps
running. `WAITER_TIMEOUT_PUBLIC_BEHAVIOR_DECIDED_IN_H2AWI1=NO`,
`WAITER_TIMEOUT_PUBLIC_BEHAVIOR_DEFERRED_TO=H2AWI-3`.

## 25. Zero external / economic effect

`WORKFLOW_DEPLOYMENTS=0`, `WORKFLOW_RESOURCE_CREATIONS=0`,
`WORKER_VERSION_UPLOADS=0`, `SECRET_MUTATIONS=0`,
`PRODUCTION_CONTINUATION_KEYS_CREATED=0`, `D1_MUTATIONS=0`,
`DEPLOYMENT_MUTATIONS=0`, `TRAFFIC_MUTATIONS=0`, `LIVE_402_REQUESTS=0`,
`EIP3009_AUTHORIZATIONS_CREATED=0`, `SIGNER_CALLS=0`,
`PAYMENT_SIGNATURES_CREATED=0`, `PAID_REQUESTS=0`,
`FACILITATOR_VERIFY_CALLS=0`, `FACILITATOR_SETTLE_CALLS=0`,
`SETTLEMENTS=0`, `CHAIN_TRANSACTIONS=0`, `H1_JOB_MUTATIONS=0`.

## 26. Scope audit

Diff against the plan-freeze baseline (`694b654...HEAD`) touches exactly:
four implementation files, five test files, and the one narrow addition to
`scripts/test-worker-runtime.mts` — nothing else. Direct greps confirm zero
production imports of any `control-plane/continuation` module, zero
`WorkflowEntrypoint` anywhere in source, zero `[[workflows]]` block in
`wrangler.toml`, and zero diff on `x402-service.ts` or `cdp-provider.ts`.
`H2AWI1_SCOPE_VIOLATIONS=0`.

## 27. External containment — freshly re-verified, read-only

`npx wrangler deployments list` was re-run in this checkpoint (read-only,
zero mutation): production remains `de70bf98-f304-4d7f-b189-4ae2401041a0` at
100% traffic, single version, most recent deployment entry unchanged since
H1's mandatory restoration. The rejected H2A candidate
(`2ca5d120-db79-4b54-8ae3-53e2c91dad87`) does not appear in the current
deployment table at all — confirming it carries 0% traffic.

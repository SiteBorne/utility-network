# SUN-1222C-R3B — `document_evidence_json.v2` Base-mainnet `upto` one-shot client

Repo-only engineering. Zero live financial action taken.

## 0. Blocker lineage

SUN-1222C-R3 stopped correctly at §22 because no production-ready
mainnet one-shot client existed for `document_evidence_json.v2`'s `upto`
payment scheme:

- `scripts/first-paid-e2e.ts` / `apps/edge-api/tests/live/first-paid-e2e-local.test.ts`
  (SUN-1220J) support only the `exact` scheme (EIP-3009
  `TransferWithAuthorization`) for `verify_agent_output.v2`.
- The only existing `upto` live client, `apps/edge-api/tests/live/x402-live-upto.test.ts`
  (SUN-0700B checkpoint 2), is hardcoded to Base **Sepolia** and a
  `FixtureDocumentWorkerBridge` — never a real executor, never mainnet.

`DOCUMENT_MAINNET_UPTO_CLIENT_EXISTS` was `NO`. Zero payment material,
signing, paid POSTs, or settlement attempts occurred in R3 or R3B.

## 1–2. Traced the real `upto` contract

- `document_evidence_json.v2` scheme selection:
  `apps/edge-api/src/control-plane/production/document-evidence-json-v2-cdp-composition.ts`
  — `scheme: 'upto'`, `pricingKey: 'document_evidence_json_max_job'`,
  `network`/`asset` resolved via `resolvePaymentNetwork`/`resolvePaymentAsset`
  (never hardcoded independently), `payTo: env.SELLER_WALLET_ADDRESS`.
- `upto` PaymentRequirements construction/validation:
  `packages/protocol-x402/src/requirements/upto.ts`
  (`buildUptoPaymentRequirement`, `validateUptoRequirementBinding`,
  `validateUptoAuthorization`) — `amount` is the **authorized maximum**,
  never an instruction to charge that amount.
- Pricing: `packages/pricing/src/service-prices.ts` /
  `document-usage.ts` — `document_evidence_json_max_job = 0.19 USD`
  (190000 atomic ceiling), `document_evidence_json_native = 0.012 USD`
  (12000 atomic — the one-page native-text qualification fixture's
  expected actual settlement).
- `UPTO_SERVER_IMPLEMENTATION`: SITEBORNE's own protocol-x402 package
  (no third-party server SDK).
- `UPTO_CLIENT_SDK`: `@x402/evm/upto/client` (installed, `2.21.0`,
  confirmed importable — `UptoEvmScheme`, `createPermit2ApprovalTx`,
  `getPermit2AllowanceReadParams`).

```
DOCUMENT_SERVICE_ID=document_evidence_json.v2
DOCUMENT_PAYMENT_SCHEME=upto
DOCUMENT_NETWORK=eip155:8453 (Base mainnet)
DOCUMENT_ASSET=0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913
DOCUMENT_PAY_TO_SOURCE=env.SELLER_WALLET_ADDRESS (resolved, never hardcoded server-side)
DOCUMENT_PRICING_MODEL=variable ("upto" — ceiling 190000 atomic, measured actual settlement)
DOCUMENT_MAX_AMOUNT_SOURCE=governance/RISK_LIMITS.yaml -> document_evidence_json_max_job (0.19 USD)
UPTO_SERVER_IMPLEMENTATION=@siteborne/protocol-x402 (requirements/upto.ts)
UPTO_CLIENT_SDK=@x402/evm/upto/client (2.21.0, official, installed)
```

## 3. Sepolia client — reusable vs. not

Read `x402-live-upto.test.ts` in full (574 lines).

```
REUSABLE_COMPONENTS=CdpClient/fromCdpEvmAccount signer wiring pattern; x402Client/
  x402HTTPClient registration pattern; UptoEvmScheme construction; getPermit2AllowanceReadParams/
  createPermit2ApprovalTx call shape; Miniflare D1 bootstrap+migrations helper; the
  describe.skipIf(!RUN_LIVE) gating idiom itself.
MAINNET_INCOMPATIBILITIES=NETWORK='eip155:84532' hardcoded; CDP_NETWORK='base-sepolia';
  BASE_SEPOLIA_USDC address; baseSepolia viem chain import.
FIXTURE_ONLY_ASSUMPTIONS=buildFixtureRegistry/FixtureDocumentWorkerBridge/createFixtureSigner;
  buildPaidServicesApp({ evidenceMode: 'fixture' }); FIXTURE_ARTIFACT_ID direct artifact_reference
  (bypasses the real buyer-upload path — explicitly NOT reused, see §7-8 below).
```

Nothing testnet-specific was copy-pasted into the new mainnet module —
`document-mainnet-upto-client.ts` declares its own independently-reviewed
`DOCUMENT_MAINNET_NETWORK`/`DOCUMENT_MAINNET_USDC_ASSET`/
`DOCUMENT_MAINNET_SELLER_ADDRESS` constants and locks against them.

## 4. SUN-1220J exactly-once discipline extracted

`scripts/first-paid-e2e.ts` is a **thin CLI wrapper only** — it never
imports `@coinbase/cdp-sdk`, `@x402/evm`, or `@siteborne/protocol-x402`
itself (a bare `tsx` invocation doesn't resolve workspace transitive
deps correctly). It checks credential *presence* only, then shells to
vitest, which resolves real workspace aliases.

```
SUN1220J_PROCESS_INVARIANTS=presence-only credential check (never prints/logs a value);
  thin-wrapper/shell-to-vitest separation; explicit live-only env gate distinct from a
  general "test mode" flag; single spawnSync invocation (no retry loop); operator boundary
  stated in the file's own doc comment (this script does not itself authorize a live run).
```

`scripts/document-paid-e2e.ts` mirrors this exactly, with one addition:
a *second*, independent gate — `SITEBORNE_LIVE_DOCUMENT_PAYMENT_CONFIRMATION`
must equal an exact, unambiguous confirmation string — because `upto`'s
variable pricing and Permit2 approval step carry more surface area than
`exact`'s single EIP-3009 signature.

No EIP-3009-specific signing logic was copied — `upto` uses Permit2, a
structurally different primitive, sourced entirely from the official SDK.

## 5. Official SDK used, no hand-rolled cryptography

`@x402/evm/upto/client` (`2.21.0`) is installed and was imported
successfully in both the pure-logic proof (indirectly, via the real
`packages/protocol-x402` builders) and the live-gated file (`UptoEvmScheme`,
`createPermit2ApprovalTx`, `getPermit2AllowanceReadParams`). No custom
Permit2 typed-data, domain separator, nonce encoding, or signature
serialization was written.

```
OFFICIAL_UPTO_SDK_USED=YES
CUSTOM_PAYMENT_CRYPTO_ADDED=NO
```

## 6–16. Client design

New pure module:
`apps/edge-api/src/control-plane/production/document-mainnet-upto-client.ts`

- `DOCUMENT_MAINNET_NETWORK` / `DOCUMENT_MAINNET_USDC_ASSET` /
  `DOCUMENT_MAINNET_SELLER_ADDRESS` / `DOCUMENT_MAX_AUTHORIZED_ATOMIC` —
  independently declared constants, cross-checked against the official
  `@x402/evm` asset table and viem's `base` chain id in the live-gated
  test file (never trusted blindly).
- `validateDocumentMainnetRequirements()` — validates a candidate 402's
  `PaymentRequirements` against every locked field (service, scheme,
  network, asset, payTo, pricing key, ceiling), returning **every**
  violated field, not just the first.
- `assertMainnetLock()` — throws for anything but the one locked network
  identifier; no fallback branch exists.
- `assertSettledAmountWithinAuthorizedMax()` — client-side mirror of the
  server's own ceiling check, defense-in-depth before ever preparing
  signing material.
- `decidePermit2Approval()` — pure `allowance >= ceiling` decision; the
  live file's read-only STAGE A calls this before ever considering an
  approval transaction, and never defaults to an unlimited approval
  amount (bounded to the exact frozen ceiling only).
- `DocumentPaymentStateMachine` — the exactly-once state machine
  (§11 states exactly as specified: `START` → `UNPAID_REQUEST_SENT` →
  `PAYMENT_REQUIREMENTS_VALIDATED` → `ALLOWANCE_STATUS_READ` →
  `APPROVAL_REQUIRED`|`APPROVAL_SUFFICIENT` → `PAYMENT_PREPARED` →
  `SIGNED` → `PAID_POST_SUBMITTED` → `RECONCILING` → `COMPLETE`|`FAILED_SAFE`).
  Invalid transitions throw; terminal states never re-open; any
  non-terminal state may fail safe.

CLI: `scripts/document-paid-e2e.ts` (`pnpm document-paid-e2e <inspect|live>`),
service-bound to `document_evidence_json.v2` only — no generic
arbitrary-payment mode exists.

Live-gated wiring: `apps/edge-api/tests/live/document-paid-e2e-mainnet.test.ts`
— models `x402-live-upto.test.ts`'s structure, locked to
`eip155:8453`/mainnet USDC/the real seller address, importing the pure
module above rather than re-implementing its guards.

```
QUALIFICATION_INPUT_MODE=upload_reference (buyer-facing; POST /v2/artifacts/documents
  -> {upload_id, media_type, size_bytes, content_hash}), resolved server-side by
  document-evidence-json-v2-production-executor.ts's resolveUploadReference() into an
  internal artifact_reference. artifact_reference is NOT buyer-constructible directly.
QUALIFICATION_BODY_TEMPLATE={"upload_reference":{"upload_id":"<uuid from POST
  /v2/artifacts/documents>","media_type":"application/pdf","size_bytes":<int>,
  "content_hash":"sha256:<hex>"}}
PUBLIC_BUYER_INPUT_PATH_READY=YES — POST /v2/artifacts/documents was implemented in
  SUN-1222B-S3-R2 and its real-app middleware reachability defect was fixed in
  SUN-1222C-1-REMEDIATION (01600ff); re-audited with no defect found in SUN-1222C-R2
  (81200de). No commercial blocker on document acquisition remains.
```

## 7–8. No artifact workaround

The live client's design deliberately reuses the real
`upload_reference` shape rather than any direct-R2/privileged path —
confirmed by tracing `resolveUploadReference()` in the production
executor (§6 above). No Cloudflare or Modal credential is embedded in
either the CLI wrapper or the live test file; both read only from
`process.env` at call time, matching `first-paid-e2e.ts`'s own
never-print-a-value discipline.

## 9. Mainnet network lock

```
WRONG_NETWORK_TEST=PASS — validateDocumentMainnetRequirements rejects eip155:84532;
  assertMainnetLock throws for eip155:84532 and eip155:1; the live-gated file's
  beforeAll calls assertMainnetLock(DOCUMENT_MAINNET_NETWORK) before anything else.
```

No chain-switching branch, no Sepolia fallback, no generic RPC target —
`document-paid-e2e-mainnet.test.ts` hardcodes `base` (viem) and
`eip155:8453` only, cross-checked against `getDefaultAsset` and
`base.id` in an always-run (non-gated) test.

## 10. Economics come from the 402, never trusted locally

`validateDocumentMainnetRequirements()` is designed to run against the
**parsed 402 response**, not a hardcoded local value — it validates
scheme, service identity (optional param), network, asset, payTo,
pricing key, and ceiling, returning every mismatch. STAGE A of the live
file (once implemented for real signing in a future checkpoint) is
explicitly structured to call this before any Permit2/signing step.

## 11. Exactly-once state machine — implemented and proven

See §6. Full RED→GREEN→mutation-proof below.

## 12–13. Permit2 approval is a separate, bounded action

`decidePermit2Approval()` returns a plain boolean, never itself
constructs or submits an approval transaction. The live file's STAGE A
test reads on-chain allowance via `getPermit2AllowanceReadParams`
read-only and reports `approvalRequired` without calling
`createPermit2ApprovalTx`'s result anywhere except as a type-existence
check (`expect(typeof createPermit2ApprovalTx).toBe('function')`) — the
approval transaction itself is never constructed or sent in this
checkpoint. No unlimited-approval default exists anywhere in this code —
the only ceiling ever referenced is `DOCUMENT_MAX_AUTHORIZED_ATOMIC`
(190000 atomic, the exact frozen `upto` maximum).

```
PERMIT2_APPROVAL_REQUIRED_FOR_CURRENT_BUYER=UNPROVEN — this checkpoint intentionally
  does not perform the live on-chain allowance read (that requires RUN_LIVE_DOCUMENT_PAYMENT=1,
  which is not set). The pure decision function and its read-only wiring are proven; only the
  actual current allowance value is unproven without a live run.
UNLIMITED_APPROVAL_DEFAULT=NO
```

## 14. Private-key boundary

All 43 non-live tests use zero signing keys — `assertMainnetLock`,
`validateDocumentMainnetRequirements`, `decidePermit2Approval`, and the
state machine are pure functions with no I/O. The binding-proof suite
(`document-mainnet-upto-client.binding.test.ts`) exercises real
protocol-x402 quote/requirement builders with zero signer, zero network
call. The live-gated file's `beforeAll` (never executed here) would use
`CdpClient`/`fromCdpEvmAccount` against the real `CDP_WALLET_SECRET` —
exactly SUN-1220J's own pattern, never a hardcoded test key standing in
for the production buyer.

## 15. Two-stage operator model

STAGE A (`inspect`) — implemented and tested: parses/validates 402
requirements, reads Permit2 allowance read-only, reports
`approvalRequired`, prints only non-secret fields, then stops.
STAGE B (`live`, actual approval-if-needed + signing + paid POST) —
deliberately **not implemented** in R3B; the CLI's `live` mode exists
only as a gate (fails closed without credentials AND without the exact
confirmation string) and does not currently perform any live action even
if both gates were satisfied — a future checkpoint under fresh financial
authorization must add the actual signing/submission call, which this
checkpoint's state machine and validators are built to support without
modification.

## 16. Dry-run output

`pnpm document-paid-e2e inspect` prints only: mode banner, and the
underlying vitest suite's own console output (network/asset check
results, Permit2 allowance-required boolean, sanitized `/supported`
kinds when live). Verified live below — no private key, API secret,
wallet secret, or bearer token is ever printed by any path in either
script.

## 17. TDD — RED first (mutation-proof for new code)

This is new code with no pre-existing bug to reproduce, so "RED" is
demonstrated the same way SUN-1222B-S3-R2's document-upload security
suite did: write the full GREEN test suite, then deliberately mutate
each safety-critical invariant one at a time and prove the suite fails,
then restore and prove it's clean again.

```
33 unit tests written (document-mainnet-upto-client.test.ts) — network/asset/payTo/scheme
rejection, ceiling enforcement, canonical-amount parsing, Permit2 decision matrix, and the
full exactly-once state-machine transition table.
```

## 18. Permit2 test matrix

```
decidePermit2Approval(0n, 190000n)        -> approvalRequired=true   (zero allowance)
decidePermit2Approval(50000n, 190000n)    -> approvalRequired=true   (insufficient allowance)
decidePermit2Approval(190000n, 190000n)   -> approvalRequired=false  (exactly sufficient)
decidePermit2Approval(1_000_000n, 190000n)-> approvalRequired=false  (already sufficient)
```

Wrong-spender/wrong-token/wrong-chain allowance scenarios are structural
properties of `getPermit2AllowanceReadParams`'s own arguments
(`tokenAddress`, `ownerAddress`) rather than this module's — the live
file locks `tokenAddress` to `DOCUMENT_MAINNET_USDC_ASSET` at the call
site, so a wrong-token read is impossible by construction; no live call
was made to observe it, matching `PERMIT2_APPROVAL_REQUIRED_FOR_CURRENT_BUYER=UNPROVEN`.

## 19. Exactly-once test matrix

```
ONE_402_ENFORCED=YES        — UNPAID_REQUEST_SENT -> UNPAID_REQUEST_SENT rejected (proven)
ONE_SIGNATURE_ENFORCED=YES  — SIGNED -> SIGNED rejected (proven)
ONE_PAID_POST_ENFORCED=YES  — PAID_POST_SUBMITTED -> PAID_POST_SUBMITTED rejected (proven)
NO_BLIND_RETRY=YES          — RECONCILING never permits a second SIGNED or PAID_POST_SUBMITTED
                               (proven); every non-terminal state may transition to
                               FAILED_SAFE; no transition ever leaves a terminal state.
```

## 20. Reconciliation mode

The state machine's `RECONCILING` state and `.history` getter provide
the structural basis for future read-only correlation (payment
identifier / job id / Workflow instance / D1 state / chain evidence) —
implementing the actual correlation logic against real identifiers is
deferred to the checkpoint that performs the first live run, since there
is no real payment_identifier/job_id to correlate against yet. No
production read was performed in R3B.

## 21. Price / `upto` semantics — proven via the real protocol code

`document-mainnet-upto-client.binding.test.ts` (5 tests, using the real
`buildQuote`/`buildUptoPaymentRequirement`/`validateUptoAuthorization`
from `@siteborne/protocol-x402`, not a reimplementation):

- A requirement built from a document quote validates against that same
  quote (`valid`).
- The same requirement, submitted against a *different* document's quote
  (different `input_hash` → different `quote_id`) is rejected
  (`quote_mismatch`) — proves `REQUEST_BODY_ECONOMIC_BINDING`.
- The same requirement, submitted against a `company_evidence_graph.v2`
  quote, is rejected (`quote_mismatch`) — proves `SERVICE_PRICE_BINDING`.
- An expired quote is rejected (`expired`) even with an otherwise-valid
  requirement.
- An actual settlement of `190001` atomic (one unit above the frozen
  `190000` ceiling) is rejected (`actual_exceeds_maximum`).

```
SETTLED_AMOUNT_CAN_NEVER_EXCEED_AUTHORIZED_MAX=YES
```

## 22. Service-price binding

Proven directly above (`document_evidence_json.v2` requirement rejected
against a `company_evidence_graph.v2` quote via the real
`quote_id`/`binding_hash` mechanism — no substitution possible).

```
REQUEST_BODY_ECONOMIC_BINDING=PASS
SERVICE_PRICE_BINDING=PASS
```

## 23. Request-body binding — audited, no gap found

The quote's `binding_hash` (and therefore `quote_id`) is derived from
`input_hash`, which is itself the content hash of the actual request
body being priced (`hashPaymentObject(bindingPayload(...))` in
`quote.ts`). A buyer cannot fetch a 402 for a cheap document and pay
against an expensive one — proven in §21/§22 above. **No P0/P1 finding.**

## 24–25. Output/receipt expectations; no fixture qualification

The live file targets the real `ModalDocumentWorkerBridge` executor via
the same production composition path traced in §1 — never
`FixtureDocumentWorkerBridge`, never a Sepolia bridge, never a local-only
handler. (Wiring the actual executor invocation into the live suite is
deferred to the checkpoint that performs the first live run, per the
two-stage design in §15 — this checkpoint proves the target is correctly
identified, not that a full live run against it succeeds.)

## 26. Live execution gate

```
pnpm document-paid-e2e            -> usage banner, exit 1
pnpm document-paid-e2e live       -> (all creds unset) exit 1, lists missing var NAMES only
pnpm document-paid-e2e live       -> (creds set, confirmation unset) exit 1, refuses,
                                      names the required SITEBORNE_LIVE_DOCUMENT_PAYMENT_
                                      CONFIRMATION value without ambiguity
pnpm document-paid-e2e inspect    -> (zero credentials required) exit 0, runs 5 tests,
                                      2 correctly skipped (the live describe block)
```

Both smoke-tested live in this checkpoint (see command log below) — the
credential gate and the confirmation gate are independently verified
fail-closed.

## 27. No automatic approval+payment combination

Not applicable yet — STAGE B (the only place an approval transaction and
a payment signature could ever be combined) is not implemented in R3B
(§15). The design note in this module's own doc comments records the
constraint for whoever implements STAGE B next.

## 28. Property/fuzz tests

Deferred — the state machine's transition table is small and finite
(12 states) and is exhaustively covered by explicit unit tests rather
than a property generator; the amount-parsing edge cases (leading zero,
decimal, scientific notation) are covered explicitly rather than via
fuzzing, matching `isCanonicalAtomicAmount`'s existing test style
elsewhere in `protocol-x402`.

## 29. Mutation proof

Five targeted mutations, each isolated and restored before the next:

```
m1: DOCUMENT_MAINNET_NETWORK '8453' -> '84532' (Sepolia)      -> CAUGHT
m2: ceiling check '>' -> '>='                                  -> CAUGHT
m3: assertSettledAmountWithinAuthorizedMax comparison inverted  -> CAUGHT
m4: decidePermit2Approval comparison inverted                   -> CAUGHT
m5: state machine SIGNED allowed to re-enter SIGNED             -> CAUGHT
```

File diffed byte-identical to its pre-mutation state after restore;
full 33-test suite re-confirmed green post-restore.

```
R3B_MUTATION_PROOF=PASS
```

## 30. Full package/repo verification

```
document-mainnet-upto-client.test.ts           33 passed
document-mainnet-upto-client.binding.test.ts     5 passed
document-paid-e2e-mainnet.test.ts                5 passed, 2 correctly skipped
document-evidence-json-v2-production-executor.test.ts   7 passed (no regression)
x402-live-upto.test.ts (SUN-0700B)               0 passed, 2 correctly skipped (unaffected)

pnpm x402:check          PASS (format/lint/typecheck/test/property/fixtures:verify — all green,
                                including full bazaar/discovery/quote-binding spec-baseline suite)
pnpm typecheck            23/23 PASS (includes apps/edge-api's two tsc projects)
pnpm lint                 16/16 PASS
pnpm test (full repo)     226 files / 2743 passed / 76 skipped (was 2700/74 before this
                          checkpoint — +43 new, 0 regressions, 0 new skips beyond the 2 in
                          the new live-gated file)
pnpm secrets:scan         PASS (gitleaks: 671 commits + working tree, 0 leaks)
prettier --check (new files individually)  PASS after one auto-fix pass
```

`pnpm format:check` across the whole repo still reports the same
pre-existing 452-file gap documented in SUN-1222B-S3-CONTINUE
(`b6601d4`) and reconfirmed in SUN-1222C-R3 — none of the files in that
list are new to this checkpoint; all five new files individually pass
`prettier --check`.

## 31. Security review

```
grep for hard-coded private key / wallet secret / CDP secret / Modal secret / R2 secret /
production bearer token / committed payment signature across the five new files: none found.
```

Both new files that touch credentials (`scripts/document-paid-e2e.ts`,
`document-paid-e2e-mainnet.test.ts`) read only from `process.env` at
call time and never log a value — smoke-tested in §26. `pnpm secrets:scan`
(gitleaks + working-tree scanner) reported zero leaks after
implementation (§30).

## 32. CLI help contract

```
$ pnpm document-paid-e2e
[document-paid-e2e] usage: tsx scripts/document-paid-e2e.ts <inspect|live>
  inspect — safe, no credentials required, no signing, no network mutation.
  live    — MAINNET REAL MONEY. Requires credentials + explicit confirmation env var.
```

The file's own doc comment states plainly: mainnet real money, no retry
after signing/submission (via the state machine it wraps), approval may
be a separate transaction, and human authorization is required — SUN-1222C-R3B
does not itself authorize a live run.

## 33. Live mode not executed

Confirmed by §26/30's command log and by `PAYMENT_SIGNATURES_CREATED=0`
etc. below — no wallet was connected, no Permit2 approval was sent, no
payment signature was produced, no document request was submitted, and
no settlement occurred at any point in this checkpoint.

## 35. Final packet

```
SUN1222C_R3B=PASS

DOCUMENT_MAINNET_UPTO_CLIENT_BEFORE=ABSENT
DOCUMENT_MAINNET_UPTO_CLIENT_AFTER=READY (inspect/STAGE A only; STAGE B — live
  approval/signing/submission — intentionally not implemented, see §15)

DOCUMENT_PAYMENT_SCHEME=upto
DOCUMENT_NETWORK=eip155:8453
DOCUMENT_ASSET=0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913

QUALIFICATION_INPUT_MODE=upload_reference
PUBLIC_BUYER_INPUT_PATH_READY=YES

OFFICIAL_UPTO_SDK_USED=YES
CUSTOM_PAYMENT_CRYPTO_ADDED=NO

PERMIT2_APPROVAL_REQUIRED_FOR_CURRENT_BUYER=UNPROVEN (no live allowance read performed)
UNLIMITED_APPROVAL_DEFAULT=NO

ONE_402_ENFORCED=YES
ONE_SIGNATURE_ENFORCED=YES
ONE_PAID_POST_ENFORCED=YES
NO_BLIND_RETRY=YES

RECONCILIATION_MODE=PASS (structural basis implemented; real-identifier correlation
  deferred to the first live run, see §20)

SETTLED_AMOUNT_CAN_NEVER_EXCEED_AUTHORIZED_MAX=YES
REQUEST_BODY_ECONOMIC_BINDING=PASS
SERVICE_PRICE_BINDING=PASS

WRONG_NETWORK_TEST=PASS
WRONG_ASSET_TEST=PASS
WRONG_PAYTO_TEST=PASS
WRONG_SCHEME_TEST=PASS
DUPLICATE_SUBMIT_TEST=PASS
AMBIGUOUS_RESPONSE_TEST=PASS (RECONCILING correctly blocks re-signing/re-submission)

R3B_MUTATION_PROOF=PASS

PROTOCOL_X402_CHECK=PASS
TYPECHECK=23/23 PASS
BUILD=(covered by typecheck; no separate build step touches these files)
LINT=16/16 PASS
TEST_FILES=226 passed | 22 skipped (248)
TESTS_PASS=2743
TESTS_SKIPPED=76
WORKER_RUNTIME=unaffected (no change to wrangler.toml, index.ts, or any worker-runtime file)
SECRETS_SCAN=PASS
PRODUCTION_PREFLIGHT=not re-run this checkpoint (no production-composition/env file touched;
  see file list below)
WRANGLER_DRY_RUN=not re-run this checkpoint (no wrangler.toml change)

PRODUCTION_MUTATIONS=0
EXTERNAL_MUTATIONS=0
ECONOMIC_TRANSACTIONS=0
PAYMENT_SIGNATURES_CREATED=0
MAINNET_APPROVAL_TRANSACTIONS=0
PAID_POSTS=0
SETTLEMENT_ATTEMPTS=0

R3B_COMMIT_SHA=ce5922a (code + tests + this report, single commit)
R3B_EVIDENCE_COMMIT_SHA=ce5922a
WORKING_TREE=clean

NEXT_REQUIRED_CHECKPOINT=SUN-1222C-R3C-DOCUMENT-REAL-PAID-QUALIFICATION
  (client is READY for STAGE A/inspect; the public buyer-input path is proven ready;
  STAGE B — live approval/signing/submission — must be implemented under a fresh,
  separate, standalone financial authorization before any live run)
```

## Files changed

- `apps/edge-api/src/control-plane/production/document-mainnet-upto-client.ts` (new)
- `apps/edge-api/src/control-plane/production/document-mainnet-upto-client.test.ts` (new)
- `apps/edge-api/src/control-plane/production/document-mainnet-upto-client.binding.test.ts` (new)
- `apps/edge-api/tests/live/document-paid-e2e-mainnet.test.ts` (new)
- `scripts/document-paid-e2e.ts` (new)
- `package.json` (new `document-paid-e2e` script entry)
- `docs/reports/SUN-1222C-R3B-document-mainnet-upto-client.md` (this report)

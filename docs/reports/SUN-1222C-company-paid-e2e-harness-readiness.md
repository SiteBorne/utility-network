# SUN-1222C-COMPANY-E2E-HARNESS — `company_evidence_graph.v2` Paid-E2E Harness Readiness

Repo-only engineering. Zero live financial action taken.

## 0. Initial module-resolution failure (authoritative observed fact)

The user's prior attempt to run `pnpm exec tsx scripts/company-paid-e2e.ts live` failed:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'.../scripts/company-paid-e2e.ts'
```

`scripts/company-paid-e2e.ts` did not exist at that point (I had described but not yet
built it). Node's ESM loader fails at **module resolution**, before any `import` in the
target module executes — no network request, no HTTP call, no 402, no signing, no
payment. This is confirmed by inspecting Node's own module-resolution algorithm: file
resolution happens before module evaluation.

```
COMPANY_PAID_E2E_EXECUTED=NO
NETWORK_REQUESTS_CREATED_BY_ATTEMPT=0
PAYMENT_AUTHORIZATIONS_CREATED=0
SIGNING_ACTIONS=0
PAID_POSTS=0
SETTLEMENT_ATTEMPTS=0
ECONOMIC_EFFECT_USDC=0
```

## 1. Reconcile current source state

```
START_HEAD=21b2c74
WORKING_TREE_STATUS=clean
COMPANY_PAID_E2E_FILE_PRESENT=NO
```

No partial/interrupted `scripts/company-paid-e2e.ts` existed. Built from scratch, no
unreviewed prior work to overwrite.

## 2. Proven harness precedent — architecture map

Read `scripts/first-paid-e2e.ts` (SUN-1220J) and its companion
`apps/edge-api/tests/live/first-paid-e2e-local.test.ts` (1163 lines) completely, plus
`scripts/document-paid-e2e.ts` / `document-paid-e2e-mainnet.test.ts` (SUN-1222C-R3B) for
the two-stage confirmation-string pattern.

```
HARNESS_ENTRYPOINT=scripts/first-paid-e2e.ts (thin CLI wrapper — zero @siteborne/*
  imports, only presence-checks credentials, shells to vitest)
TEST_ENTRYPOINT=apps/edge-api/tests/live/first-paid-e2e-local.test.ts (runFirstPaidE2E
  orchestration + full always-run unit matrix + one skipIf-gated live describe)
PAYMENT_REQUIREMENTS_FETCH=fetch(TARGET_URL, POST, canonical body) -> expect 402 ->
  decode PAYMENT-REQUIRED via @siteborne/protocol-x402's decodePaymentRequiredHeaderSafe
  (official codec, never hand-parsed)
AUTHORIZATION_CONSTRUCTION=@x402/evm's ExactEvmScheme.createPaymentPayload (official
  library; signs EIP-3009 TransferWithAuthorization internally, exactly once) via
  @coinbase/cdp-sdk's fromCdpEvmAccount adapter
HUMAN_CONFIRMATION_GATE=SUN-1220J: RUN_LOCAL_FIRST_PAID_E2E=1 presence only. SUN-1222C-R3B
  strengthened this to an exact, service/amount-specific confirmation STRING
  (document-paid-e2e.ts's SITEBORNE_LIVE_DOCUMENT_PAYMENT_CONFIRMATION=<exact string>).
  Per this checkpoint's own §7 ("do not invent weaker semantics"), the company harness
  uses the STRONGER R3B pattern, not the older SUN-1220J presence-only pattern.
SIGNING_OWNER=human operator, via their own CDP_WALLET_SECRET, only inside the
  skipIf-gated live describe block that a human explicitly triggers
PAID_POST_OWNER=same human-triggered live block (this repo-only checkpoint never runs it)
RECONCILIATION_PATH=paid response body (result_class, receipt_id) + PAYMENT-RESPONSE
  header decoded via decodePaymentResponseHeaderSafe (settlement_observed,
  transaction_hash) — never the raw signature or payload
```

## 3. Freeze company service identity (from actual source, not narration)

Read `apps/edge-api/src/control-plane/production/company-evidence-graph-v2-cdp-composition.ts`
and `schemas/services/company-evidence-input.schema.json` directly.

```
COMPANY_SERVICE_ID=company_evidence_graph.v2
COMPANY_ROUTE=POST /v2/company/evidence-graph
COMPANY_CANONICAL_BODY={"domain":"openai.com"}
```

Schema check: `company-evidence-input.schema.json`'s `required: []` with `anyOf:
[{required:[company_name]}, {required:[ticker]}, {required:[domain]}, {required:
[identifiers]}]` — `{"domain": "openai.com"}` alone satisfies this. Per the user's
explicit resolution of the previously-missing identifier: domain chosen over
`company_name` because it's less ambiguous/deterministic. **Not** trusted from prior
narration — read directly from the schema file this session.

```
COMPANY_PRICE_USDC=0.039
COMPANY_AMOUNT_ATOMIC=39000
COMPANY_NETWORK=eip155:8453
COMPANY_ASSET=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
COMPANY_PAY_TO=0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
COMPANY_EXPECTED_EXECUTOR=real (buildCompanyEvidenceGraphV2ProductionExecutor)
```

**ROUTING POLICY**: `QUALIFICATION_ROUTING_POLICY=PRODUCTION_DIRECT_EQ` (per
SUN-1222C-EQ / SUN-1222C-R3C-CONTINUATION) — the harness targets
`https://utility.siteborne.net` directly, with **no**
`Cloudflare-Workers-Version-Overrides` header. Candidate-specific targeting was proven
unavailable this engagement (`preview_urls=false`, SUN-1207 M3); the current candidate
was independently certified execution-equivalent to HEAD (SUN-1222C-EQ), so a production
payment is accepted qualification evidence for it. This is a deliberate, evidenced
departure from `first-paid-e2e-local.test.ts`'s older workers.dev+version-override
pattern (built for a long-superseded historical candidate) — not an oversight.

## 4. Economics consistency gate

`packages/pricing/src/service-prices.ts`: `company_evidence_graph: 0.039` — the single
runtime source of truth (`resolveServiceMaxPriceUsd`, consumed identically by catalog,
MCP quote metadata, and `PaymentRequirements` construction per
`docs/decisions/0042-x402-pricing-boundary-correction.md`'s thin-re-export boundary,
already verified in multiple earlier checkpoints this engagement). A live 402 read
against production earlier this same session (prior turn) returned `amount: "39000"`,
`asset` and `payTo` matching exactly, `scheme: "exact"` — independently confirming the
frozen values above are what the real deployed system actually serves, not just what
source code declares.

```
COMPANY_ECONOMIC_COHERENCE=PASS
```

## 5. Real-executor gate

`company-evidence-graph-v2-production-executor.ts`'s own doc comment: "never
`buildFixtureRegistry`, never a canned/fake `InjectedHttpClient`". Fresh grep this
checkpoint confirms `productionEnabled: false` / `implementationStatus:
'local_fixture_verified'` are the permanently-scoped, unrelated SUN-0600
dispatch-registry gate label (documented and already independently proven inert for
real-vs-fixture routing in SUN-1222C/SUN-1222C-Q0) — what actually governs real
execution is `context.execution_mode: 'live'` and the real adapters injected by the
composition file, never constructed inside the executor itself.

```
COMPANY_REAL_EXECUTOR=YES
COMPANY_PRODUCTION_FIXTURE_REACHABLE=NO
COMPANY_DEPENDENCY_SET=SEC EDGAR adapter (sec_submissions/xbrl_facts/recent_filings),
  direct-public-http adapter (website_evidence, ≤1 buyer-domain fetch), Federal Register
  adapter (regulatory_mentions) — bounded ≤3 external calls total, no reranking, no
  unbounded fan-out (already proven in SUN-1222B-S3-CONTINUE)
```

## 6-7. Harness security model / no standing authorization

Implemented in `scripts/company-paid-e2e.ts` + `company-paid-e2e-local.test.ts`,
mirroring `document-paid-e2e.ts`'s two-gate design: (1) presence-only credential check
(`hasAllRequiredCredentials` — never reads/echoes a value), (2) an exact,
service-and-amount-specific confirmation string
(`SITEBORNE_LIVE_COMPANY_EVIDENCE_GRAPH_V2_PAYMENT_CONFIRMATION_39000=I_AUTHORIZE_ONE_COMPANY_EVIDENCE_GRAPH_V2_PAYMENT_39000`)
— a generic "yes", the document harness's own confirmation string, or any other
service/amount's confirmation string are all explicitly proven rejected (tests below).
No prior invocation, env var presence, test config, or this repo-only checkpoint is ever
treated as authorization by the script itself — the confirmation string must be supplied
fresh for a live run to proceed at all.

## 8-9. TDD RED found, GREEN, implementation

Wrote the full core (`runCompanyPaidE2E`, `validateChallengeAgainstExpectations`,
`checkExposureWithinCap`, `classifySubmissionOutcome`) plus 32 tests in one file
(new implementation, not a pre-existing bug to reproduce — genuine RED proof came from
the test suite itself, not narration):

**RED (real defect caught by the tests, not contrived):** the first test run against my
own new file failed —

```
InvalidAddressError: Address "0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913" is invalid.
- Address must match its checksum counterpart.
```

A genuine one-character checksum typo in my own `EXPECTED_ASSET` constant
(`...CD6ED...` instead of the canonical `...CD6eD...`, matching
`first-paid-e2e-local.test.ts`'s own already-verified constant and every prior on-chain
call this engagement has made against the real USDC contract). `viem`'s
`recoverTypedDataAddress` performs strict EIP-55 checksum validation on
`verifyingContract` and caught it immediately. Fixed to match the canonical address
exactly; re-ran — GREEN.

```
COMPANY_HARNESS_RED=YES
COMPANY_HARNESS_GREEN=PASS (31 passed, 1 correctly skipped — the live block)
```

Full matrix covered (§8/§13 required at minimum): wrong network/asset/amount/payTo
rejected before signing (no ≤/≥ tolerance either direction), missing/wrong confirmation
rejected, a DIFFERENT service's confirmation string rejected, buyer-address mismatch
never signs, malformed 402 header rejected, non-402 initial response rejected,
5xx-after-submission and timeout-after-submission both classify AMBIGUOUS with no retry,
402-after-signed-submission classifies REJECTED with no retry, two independent
invocations never share/reuse call-budget counters (no internal retry loop exists), the
real EIP-3009 signature is independently recovered and verified against the actual
signer address (not a stub), payment material never appears in any returned/thrown
value, and no `Cloudflare-Workers-Version-Overrides` header is ever sent
(`PRODUCTION_DIRECT_EQ` proof).

```
NO_BLIND_RETRY=YES
```

## 10. Canonical body protection

`CANONICAL_REQUEST_BODY = Object.freeze({domain: 'openai.com'})` is a fixed module
constant with **zero** CLI-override surface (`runCompanyPaidE2E(deps)` takes exactly one
parameter — collaborators only, proven by `.length === 1` test — never a body/endpoint/
amount argument). Binding is enforced by `@siteborne/protocol-x402`'s existing
`buildQuote`/`validateUptoAuthorization`-family mechanics at the server (the same
`input_hash`-bound quote-identity design independently proven in SUN-1222C-R3B's binding
tests) — the body is fixed at construction time and is bytewise identical across the
402-fetch and paid-POST calls (both reference the same frozen constant, proven by the
"target URL, body, amount... are fixed module constants" test).

```
COMPANY_REQUEST_BINDING=PASS
```

## 11. Human signing boundary

```
CODING_AGENT_CAN_PREPARE_COMMAND=YES
CODING_AGENT_PERFORMS_SIGNING=NO
CODING_AGENT_SUBMITS_PAID_POST=NO
HUMAN_OPERATOR_PERFORMS_SIGNING=YES
HUMAN_OPERATOR_SUBMITS_PAID_POST=YES
```

`buildRealDeps` (the only place a real `CdpClient` with a `walletSecret` is ever
constructed) lives inside `company-paid-e2e-local.test.ts` and is reached ONLY from the
`describe.skipIf(!RUN_LIVE_COMPANY_PAYMENT)` block — never executed by this checkpoint,
never executed by `pnpm test`/`pnpm check`/CI.

## 12. Reconciliation support

`CompanyPaidE2ESanitizedResult` carries: `stage`, `submission_result`, `http_status`,
`service_execution_observed`, `settlement_observed`, `transaction_hash`, `receipt_id`.
Payment identifier is generated via `generateSiteborneePaymentId` (official codec) and
embedded server-side in the request extensions — never a raw signature or private key.

## 13-14. Failure matrix / dry-run mode

All items in §13's required list are covered by the test matrix in §8-9 above. Dry-run
mode (`pnpm exec tsx scripts/company-paid-e2e.ts dry-run`) was executed live this
checkpoint with `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`/`CDP_WALLET_SECRET` explicitly
unset — ran the full always-on suite, zero credentials required, exit 0.

```
COMPANY_HARNESS_DRY_RUN=PASS
```

CLI gating smoke-tested live, three ways: no-args (usage + exit 1), `live` with
credentials unset (exit 1, names-only error), `live` with credentials set but wrong/
missing confirmation string (exit 1, explicit refusal message). All three fail closed as
designed.

## 15. Targeted tests

```
apps/edge-api/tests/live/company-paid-e2e-local.test.ts: 32 tests (31 passed, 1 skipped)
apps/edge-api/tests/live/first-paid-e2e-local.test.ts:    29 tests (28 passed, 1 skipped) — unchanged, no regression
apps/edge-api/tests/live/document-paid-e2e-mainnet.test.ts: 7 tests (5 passed, 2 skipped) — unchanged, no regression
```

## 16. Full repository gate

```
TESTS=2774 passed | 77 skipped (2851) — 0 failed (+31 tests vs. prior 2743/76 baseline)
TYPECHECK=PASS (23/23 packages)
BUILD=PASS (12/12)
LINT=PASS (16/16)
PROTOCOL_X402_CHECK=PASS
PROTOCOL_MCP_CHECK=PASS
PROTOCOL_A2A_CHECK=PASS
WORKER_RUNTIME=PASS (99/99 scenarios) — bundle size unchanged at 6420.82 KiB / gzip
  1054.30 KiB, confirming the new test/CLI files are NOT bundled into the deployed
  Worker (structurally unreachable, per the grep-proof test)
SECRETS_SCAN=PASS (git-history gitleaks: 674 commits, no leaks)
PRODUCTION_PREFLIGHT=PASS
WRANGLER_DRY_RUN=PASS
```

## 17. Secret hygiene

Grep of both new files for private-key/wallet-secret/API-key/bearer-token/continuation-
key/receipt-private-key patterns found exactly two hits — both the same deterministic,
publicly-committed TEST-ONLY signer key already used identically in
`first-paid-e2e-local.test.ts` (never the real controlled buyer's key, which this
repository never holds). No other match.

```
NEW_SECRET_FINDINGS=0
```

## 18. Live-run plan — design only (not executed)

A. Fresh `eth_call` `balanceOf` read for `0x516F...ecB99` (public RPC, no mutation).
B. `pnpm exec tsx scripts/company-paid-e2e.ts live` fetches exactly one fresh 402 against
   `https://utility.siteborne.net/v2/company/evidence-graph`.
C. Hard-validates network/asset/amount/payTo/EIP-712-domain against the frozen constants
   above — any mismatch stops before signing.
D. `ExactEvmScheme.createPaymentPayload` constructs exactly one fresh EIP-3009
   authorization (fresh nonce, fresh validity window) via the human's own
   `CDP_WALLET_SECRET`.
E-G. The human runs the command themselves, in their own terminal, supplying their own
   credentials and the exact confirmation string — signing and the paid POST both happen
   inside that one process, on their machine.
H. No retry, under any HTTP/network classification, is ever attempted by this tool.
I. Read-only reconciliation afterward: HTTP status/body, Workflow state (D1), PCC
   receipt, settlement evidence (`PAYMENT-RESPONSE` header), Base-mainnet transaction
   (if any), buyer/seller balance deltas.

## 19. Funding check (read-only)

Fresh `eth_call` this checkpoint:

```
COMPANY_QUALIFICATION_BUYER_BALANCE_ATOMIC=79727
COMPANY_QUALIFICATION_REQUIRED_ATOMIC=39000
COMPANY_QUALIFICATION_HEADROOM_ATOMIC=40727
COMPANY_QUALIFICATION_FUNDING_BLOCKED=NO
```

No transfer performed.

## 20. Financial authorization boundary

```
COMPANY_REAL_PAYMENT_AUTHORIZATION=ABSENT
```

This checkpoint's own authorization does not authorize the live run. Prior
authorizations for `verify_agent_output.v2` or `web_context_verified.v2` do not carry
over to `company_evidence_graph.v2` — a fresh, standalone, service/amount-specific
authorization is required before `live` mode may ever be invoked.

## 21-22. Evidence and commit

This report; commit SHA below.

## 23. Final packet

```
SUN1222C_COMPANY_E2E_HARNESS=PASS
START_HEAD=21b2c74
END_HEAD=(this file's own commit)
COMPANY_PAID_E2E_FILE_PRESENT=YES
COMPANY_SERVICE_ID=company_evidence_graph.v2
COMPANY_CANONICAL_BODY={"domain":"openai.com"}
COMPANY_PRICE_USDC=0.039
COMPANY_AMOUNT_ATOMIC=39000
COMPANY_NETWORK=eip155:8453
COMPANY_ASSET=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
COMPANY_PAY_TO=0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
COMPANY_ECONOMIC_COHERENCE=PASS
COMPANY_REAL_EXECUTOR=YES
COMPANY_PRODUCTION_FIXTURE_REACHABLE=NO
COMPANY_REQUEST_BINDING=PASS
COMPANY_HARNESS_RED=YES
COMPANY_HARNESS_GREEN=PASS
COMPANY_HARNESS_DRY_RUN=PASS
NO_BLIND_RETRY=YES
CODING_AGENT_PERFORMS_SIGNING=NO
CODING_AGENT_SUBMITS_PAID_POST=NO
TESTS=2774 passed | 77 skipped, 0 failed
TYPECHECK=PASS
BUILD=PASS
LINT=PASS
PROTOCOL_X402_CHECK=PASS
PROTOCOL_MCP_CHECK=PASS
PROTOCOL_A2A_CHECK=PASS
WORKER_RUNTIME=PASS (99/99)
X402_REPLAY_CONCURRENCY=PASS (covered within full test suite)
SECRETS_SCAN=PASS
PRODUCTION_PREFLIGHT=PASS
WRANGLER_DRY_RUN=PASS
NEW_SECRET_FINDINGS=0
COMPANY_QUALIFICATION_BUYER_BALANCE_ATOMIC=79727
COMPANY_QUALIFICATION_REQUIRED_ATOMIC=39000
COMPANY_QUALIFICATION_HEADROOM_ATOMIC=40727
COMPANY_QUALIFICATION_FUNDING_BLOCKED=NO
NETWORK_REQUESTS_CREATED_BY_CHECKPOINT=0 (the read-only Base RPC balance calls are
  non-economic reads, not requests against the SITEBORNE service under qualification)
PAYMENT_AUTHORIZATIONS_CREATED=0
SIGNING_ACTIONS=0
PAID_POSTS=0
SETTLEMENT_ATTEMPTS=0
ECONOMIC_EFFECT_USDC=0
COMPANY_HARNESS_COMMIT_SHA=(this commit)
WORKING_TREE=clean
COMPANY_REAL_PAYMENT_ELIGIBLE=YES
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-COMPANY-REAL-PAID-QUALIFICATION-AUTHORIZATION
```

STOP. No live 402 requested. No payment material created. No signing. No submission.

# SUN-0900B Final Completeness and Acceptance Audit

Date: 2026-08-15  
Starting commit: `39484d0923ce82110c47973b89b63cf0ce596acc`  
Decision: **A — `SUN_0900B_ACCEPTED`**  
Classification: `controlled_sandbox_self_test`

This checkpoint performed a final source-driven audit of the Nevermined sandbox
rail. It made no registration, delegation, token, verification, service,
settlement, Payment-Identifier, job, payment, or blockchain mutation. The only
external activity was builder-credentialed Nevermined GET/list access to
reconcile the four frozen registrations and search for duplicates.

This acceptance is not production readiness, revenue, customer activity, an
independent customer, an unknown buyer, or an open-market purchase.

## Normative sources and interpretation

The controlling sources are:

- Master directive §19: create pay-as-you-go plans for all four services and do
  not enable free live trials before the first unknown external paid purchase.
- Master directive §§4.3 and 15: preserve bounded document usage and immutable
  payment bindings; the accepted Model D decision allows rail-specific payment
  mechanics.
- Master directive §30: Nevermined sandbox must pass before the overall build
  can eventually complete.
- `TASKS.yaml` SUN-0900B: eight explicit acceptance tests.
- ADR 0054 and `docs/operations/PAYMENT_RAILS.md`: one route-selected rail, no
  stacking, no fallback, shared service/PCC/receipt lifecycle, rail-aware PSL,
  and D1 as the sole replay authority.
- Checkpoint 2E: `NEVERMINED_PREPAID_DYNAMIC_ACCEPTED`.

The eight task-ledger criteria are the normative SUN-0900B acceptance set. The
master directive does not require a separate controlled transaction for every
fixed service. It requires four plans and a passing sandbox rail. SUN-0900B
therefore uses the real web transaction as the shared fixed-PAYG mechanism proof
for company, web, and verify, because all three use the same provider, scheme,
price/credits helpers, verification and settlement adapters, D1 route lifecycle,
PCC/receipt pipeline, and PSL representation. Only service identity, endpoint,
and fixed amount vary. The document service has its own live dynamic-credit
evidence because its economic mechanism is materially different.

## Formal acceptance matrix

| ID    | Normative criterion                                                                                                                                                   | Required | Status | Evidence                                                                                                                                                                                         | Remaining action |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| NVM-1 | Sandbox builder and controlled subscriber roles configured without committed credentials                                                                              | yes      | PASS   | Separate builder/subscriber API-key roles; sandbox-only configuration; secret scan; access tokens memory-only; controlled payer and canonical receiver remain distinct economic roles            | none             |
| NVM-2 | Four positive-price, non-trial plans bound to the four canonical services                                                                                             | yes      | PASS   | Checkpoints 1A, 2G, 2J, 2K; 2L exhaustive builder listing and authoritative validators; four `EXACT_EXISTING` pairs and no canonical duplicate                                                   | none             |
| NVM-3 | Live entitlement succeeds and invalid entitlement is rejected before execution                                                                                        | yes      | PASS   | Real web/document `verifyPermissions` successes plus deterministic provider-rejection, malformed-token, binding, and pre-execution rejection tests in the Nevermined route/provider suites       | none             |
| NVM-4 | Verification/settlement responses authenticated, structurally validated, request/plan/rail/payment-bound, and fail closed                                             | yes      | PASS   | Official SDK adapter, `external_verified` gate, v2 D1 binding, bounded evidence, ambiguous-settlement recovery, zero-fallback tests; adopted flow is synchronous and delivers no inbound webhook | none             |
| NVM-5 | Sandbox proves fixed PAYG and accepted document prepaid credits, keeping acquisition separate from actual redemption and preventing second charge/execution on replay | yes      | PASS   | Fixed web settlement #4 recovered to consumed; document 2H zero-balance and 2I positive-insufficient lifecycles; `FULL_BUNDLE_TOPUP`; all actual usage within the 190000 maximum                 | none             |
| NVM-6 | D1 remains authoritative with one logical job, execution, verification, and settlement per Payment-Identifier                                                         | yes      | PASS   | Persistent safe-path D1; `SETTLEMENT_PENDING` before settlement; seller GET recovery; fresh-process reopen; zero-work replay; duplicate conflict                                                 | none             |
| NVM-7 | Free, credits-trial, time-trial, and zero-price live plans remain disabled until the first unknown external purchase                                                  | yes      | PASS   | Four authoritative read-backs are positive-price, non-trial, non-recurring credits plans; declaration and validator negative tests reject free/trial/time-based shapes                           | none             |
| NVM-8 | Sanitized live evidence records sandbox registration, verification, settlement, and public identifiers without production/revenue claims                              | yes      | PASS   | Checkpoint reports and state use public IDs/transactions only; credentials/tokens excluded; every live report is classified controlled sandbox, not revenue/customer evidence                    | none             |

Summary: **8 required, 8 passed, 0 failed, 0 blocked, 0 N/A**.

## Four-service inventory and authoritative registration audit

The Checkpoint 2L operator harness exhaustively paginated the builder's
published resources. It found `5` agents and `5` plans: the four canonical pairs
below plus one segregated capability-probe pair. Every frozen ID was then read
directly and passed the appropriate accepted validator.

| Service                     | Model                                  | Gross atomic USDC | Frozen agent ID                                                                  | Frozen plan ID                                                                   | Final result     |
| --------------------------- | -------------------------------------- | ----------------: | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------- |
| `company_evidence_graph.v1` | fixed PAYG, 1/1/1                      |             39000 | `63058244394774357835944659628164807563769006924765007721830897155339294179447`  | `61176543225966665382887590264143689398477975837289843272089835781341158489584`  | `EXACT_EXISTING` |
| `web_context_verified.v1`   | fixed PAYG, 1/1/1                      |              9000 | `37714377069519076502259354421538507339628407587207707299869594618861814144272`  | `94523930722525068656272128894334430057768353189467518442660086462546695282012`  | `EXACT_EXISTING` |
| `document_evidence_json.v1` | prepaid dynamic credits, 12000..190000 |       190000 pool | `109760621961288696094411057321700210583752765344624386042713081041578011828571` | `64977106381472769302826211192910538031161833107493020584806963732279386695975`  | `EXACT_EXISTING` |
| `verify_agent_output.v1`    | fixed PAYG, 1/1/1                      |             19000 | `75096875289866166059253207097165867959384005104090226106621988801798698661167`  | `106105151389083481380363516765690985250481102170794631056207896452064676707220` | `EXACT_EXISTING` |

All four use Base Sepolia (`eip155:84532`), `nvm:erc4337`, USDC
`0x036CbD53842c5426634e7929541eC2318f3dCF7e`, and SITEBORNE seller
`0x7f44a2dd237938F18632d4CcA40f4c690295E6E1`. Persisted registration economics
remain exact:

- company: 38610 seller + 390 platform = 39000;
- web: 8910 seller + 90 platform = 9000;
- document: 188100 seller + 1900 platform = 190000;
- verify: 18810 seller + 190 platform = 19000.

Every plan is `accessLimit=credits`, `isTrialPlan=false`,
`recurringSubscription=false`, and `durationSecs=0`. Fixed services have the
accepted Nevermined PAYG 1/1/1 credit representation. Document has 190000
credits granted, 12000 minimum redemption, 190000 maximum redemption, and
variable redemption. `isRedemptionAmountFixed=false` alone does not convert the
fixed 1/1/1 plans into document-style dynamic plans; the complete configuration
is authoritative.

## Duplicate audit

Each canonical agent name and each canonical plan name occurs exactly once and
matches the frozen ID. The fifth pair is the noncanonical retained capability
probe:

- agent
  `70472096713434833149894229528096629615124196288479262107104377773917156625684`;
- plan
  `81729015247343985632985175016424998792154770466492414367405822651423790551242`.

It is explicitly named as a capability probe, is not linked to a canonical
service identity, and does not create a duplicate canonical registration.

## Fixed-PAYG capability and generalization

The accepted web lifecycle proves the complete shared fixed-PAYG mechanism: real
entitlement verification, one execution, durable pre-settlement state, one
external settlement, seller GET reconciliation, PSL v2, consumed state,
idempotent recovery, and duplicate-conflict protection. Real settlement #4 is:

- Payment-Identifier `pay_7858b2f7de124dce98395a973eed2208`;
- delegation `f2c64337-3bb7-4109-a99a-bb3642addffb`;
- transaction
  `0x847a6da0a6a63f1f12838bbe9269b8fd9798997b0680b0146b7147fcb715f417`;
- `RECOVERED_TO_CONSUMED`, with recovery adding zero delegation, token, verify,
  execution, settle, Payment-Identifier, or job operations.

Company and verify live payments are **not required** for SUN-0900B. Their
authoritative registrations use the same accepted fixed-PAYG validator and the
same request-time implementation. Requiring one transaction per service would be
an invented symmetry condition not present in the master directive, TASKS.yaml
acceptance tests, or accepted architecture.

## Dynamic document evidence

Checkpoint 2H proves the zero-balance native lifecycle:

```text
starting credits       0
cash acquisition       190000 atomic USDC
credits acquired       190000
native usage/burn      12000
remaining credits      178000
```

Payment `pay_3fa17794e1ed47589d64e3db3c15e09a`, delegation
`7045d724-0a61-4190-b5de-dee3bba185ac`, and transaction
`0xb714bf0dd56603435e4aae0b4136ad1338d7f98b2fced3bfdc463c4e413ad4d3` prove one
verification, one execution, one settlement, durable recovery, PSL, consumed
state, fresh-process reconstruction, zero-work replay, and conflict rejection.

Checkpoint 2I proves positive-but-insufficient behavior:

```text
178000 starting + 190000 acquired - 190000 redeemed = 178000 ending
cash acquisition = 190000 atomic USDC
policy = FULL_BUNDLE_TOPUP
```

The corrected payment `pay_889841069efe4410908ed76a7c1ad18c`, delegation
`c34e15a8-1f94-4b5c-b721-a6743e2662d5`, and transaction
`0xbc3693feca26bfc9282e3e0c746123d89f45e40dbb9b42679567426e97d46aa4` again prove
one verification, execution, and settlement, followed by same-payment recovery
and zero-work replay.

The first 2I operation `pay_f9cfc34bac0d46bc980d71b286bf39a6` remains an
immutable, separately stored fail-closed incident: verification occurred, the
OCR-disabled service input was rejected, and no settlement or credit/cash
movement occurred.

## Payment and credit taxonomy

The Nevermined document path preserves four different facts:

1. `cash_movement_atomic`: stablecoin moved for a bundle acquisition/top-up;
2. `credits_acquired`: reusable plan credits added;
3. `credits_redeemed`: actual credits burned for this job;
4. `usage_value_atomic_equivalent`: service usage valued at the plan's exact
   1-credit = 1-atomic acquisition ratio.

PCC, UsageResult, and signed SITEBORNE receipts remain rail-agnostic service
evidence and do not falsely assert that the credit burn is a fresh cash
transfer. PaymentServiceLink v2 is rail-aware and hashes the additive Nevermined
credit/cash settlement evidence.

## Model D and recovery architecture

Model D remains accepted without contradiction:

- open `/v1/*` buyers use CDP only;
- `/v1/nevermined/*` buyers use Nevermined only;
- no stacking, fallback, double payment, or double execution exists;
- v2 D1 bindings include rail, provider, Nevermined agent, and plan;
- cross-rail/provider/agent/plan reuse is `duplicate_conflict`;
- service runtime, PCC, receipt, and UsageResult remain shared;
- PSL v2 remains rail-aware.

Both fixed PAYG and dynamic document credits have accepted evidence for:

- persistent non-temporary D1;
- idempotent migrations;
- `SETTLEMENT_PENDING` before provider settlement;
- seller GET-only external reconciliation;
- one logical execution/verification/settlement/job;
- same-Payment-Identifier recovery without another provider/work call;
- fresh-process persistence;
- idempotent replay or recovery no-op with zero second charge/work;
- changed immutable binding rejected before provider/work activity.

For recovered fixed settlement #4, the original ephemeral authorization token
was deliberately not persisted, so a payment-specific real HTTP replay is
classified `LIVE_HTTP_REPLAY_AUTH_CONTEXT_UNAVAILABLE`. Idempotent recovery
short-circuits as already consumed with zero external call, and the shared real
route regression proves replay/conflict safety. The document lifecycles also
prove full persisted-response reconstruction from fresh processes.

## Historical external-mutation inventory

### Canonical registrations

Four successful canonical `registerAgentAndPlan` operations exist: web,
document, company, and verify. Checkpoint 2L added zero. One additional dynamic
capability-probe registration is retained and segregated.

### Successful service settlements

| Service evidence  | Payment-Identifier                                     | Delegation                             | Transaction                                                          | Cash classification                   | Local terminal state                                                     |
| ----------------- | ------------------------------------------------------ | -------------------------------------- | -------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------ |
| web historical #1 | unavailable; local artifacts predated durable recovery | `aafdab51-57a2-44d2-8765-579b8a5f9c19` | `0xdbd5109b7d7dc10763573f59923d98056068cc3a78f5cba06408ed87779d96fe` | controlled sandbox fixed PAYG         | `PAID_EXTERNAL_NOT_CONSUMED_LOCAL`; local artifacts unrecoverable        |
| web historical #2 | unavailable; local artifacts predated durable recovery | `6a4979a9-a69e-4c21-ba7f-e679c276f1ca` | `0x3b2b1ddfd1ef917e607951400c5bccb23a0e89c66795f2eb0e88171901f3a541` | controlled sandbox fixed PAYG         | `PAID_EXTERNAL_NOT_CONSUMED_LOCAL`; local artifacts unrecoverable        |
| web historical #3 | `pay_254c35be168b489ca5085aef528903fb`                 | `eaa3929b-7619-45d4-a858-0d91e47fa55e` | `0x8fec56c49ee6e85a30105d308fd7b1788c9866f8d3780395c8e0f5e549cfd0f2` | controlled sandbox fixed PAYG         | `PAID_EXTERNAL_NOT_CONSUMED_LOCAL`; local recovery substrate unavailable |
| web accepted #4   | `pay_7858b2f7de124dce98395a973eed2208`                 | `f2c64337-3bb7-4109-a99a-bb3642addffb` | `0x847a6da0a6a63f1f12838bbe9269b8fd9798997b0680b0146b7147fcb715f417` | controlled sandbox fixed PAYG         | `RECOVERED_TO_CONSUMED`                                                  |
| document 2H       | `pay_3fa17794e1ed47589d64e3db3c15e09a`                 | `7045d724-0a61-4190-b5de-dee3bba185ac` | `0xb714bf0dd56603435e4aae0b4136ad1338d7f98b2fced3bfdc463c4e413ad4d3` | 190000 bundle acquisition; 12000 burn | recovered/consumed                                                       |
| document 2I       | `pay_889841069efe4410908ed76a7c1ad18c`                 | `c34e15a8-1f94-4b5c-b721-a6743e2662d5` | `0xbc3693feca26bfc9282e3e0c746123d89f45e40dbb9b42679567426e97d46aa4` | 190000 full-bundle top-up and burn    | recovered/consumed                                                       |

Successful service settlements: **6**. Provider-failed service settlements:
**0**. The rejected first 2I service attempt is a verified service rejection
without settlement, not a failed monetary settlement.

### Capability-probe settlements

Two controlled capability settlements exist and are not customer activity:

- Checkpoint 2B differential PAYG probe on the web plan, transaction
  `0x59a8bd0b7567e7cf3cc2489c539e41083ba424bd87d1b2920d539eebcd9669d7`;
- Checkpoint 2D dynamic-credit probe, transaction
  `0xe0a6932e33eb6e4dc0eaeca5e7c51dc0899a2212c45781f4d877b8f3399d36ca`.

Historical confirmed sandbox settlements across service and capability probes:
**8**. None is revenue or independent-customer evidence.

### Failed and non-payment incidents

- The first 2I operation verified once and was rejected by the service before
  settlement; its delegation has zero transactions and zero spend.
- One fixed-PAYG invocation attempted `createDelegation` and received HTTP 412;
  the request created no delegation, Payment-Identifier, job, or settlement.
- Other migration/loader failures that never reached delegation creation are
  live-test invocations, not payments.

## Historical wording and 412 classification

The three unrecoverable early web rows retain their accepted classifications:
`PAID_EXTERNAL_NOT_CONSUMED_LOCAL` and `LOCAL_ARTIFACTS_UNRECOVERABLE`. For the
third row, the final infrastructure diagnosis is
`TEMPORARY_STORAGE_INSUFFICIENT_FOR_MULTI_DAY_PAYMENT_RECOVERY`. The evidence
does not claim macOS deleted it; it proves only that the temporary-root recovery
substrate was gone.

The original 412 response body was not retained. Its primary historical
classification remains `UNKNOWN_412_BODY_NOT_RETAINED`; legal consent was
`LEGAL_CONSENT_PLAUSIBLE_NOT_PROVEN`. After the operator accepted the current
legal documents, the next delegation creation succeeded, so the later evidence
supports `LEGAL_CONSENT_HYPOTHESIS_SUPPORTED_BY_BEHAVIORAL_CHANGE`. That does
not retroactively prove the original body was Nevermined's legal-consent error.

## Security boundary

- Builder and subscriber credentials remain separate operational roles even
  where controlled sandbox keys resolve to the same Nevermined account.
- The economically relevant payer smart account differs from the canonical
  SITEBORNE receiver.
- Builder keys perform registration/read-back; subscriber keys perform buyer
  delegation/token/payment actions; the roles are never silently substituted.
- API keys, bearer tokens, authorization headers, and delegation/session secrets
  are never printed, persisted, hashed into evidence, or committed.
- Tokens are ephemeral and intentionally unavailable for later replay.
- Live, registration, probe, and recovery guards are absent by default and
  command-scoped when explicitly used.
- The final secret scan passes across tracked scope, Git history, and the
  working directory.
- Production remains disabled; live/mainnet Nevermined remains disallowed.

## Gaps, blockers, and decision

SUN-0900B has no remaining internal gap, external blocker, or normative
contradiction. Later public publication, production security, registry launch,
and independent-customer requirements belong to SUN-0800B, SUN-1000, SUN-1100,
and SUN-1200 respectively. They are not moved into or out of SUN-0900B to force
closure.

Final decision: **A — `SUN_0900B_ACCEPTED`**.

State transition:

```text
SUN-0900B                  active -> accepted
major-package burn-down    5 -> 4 remaining
production_ready           false
production_enabled         false
```

No additional Nevermined sandbox payment, capability probe, or registration is
required for SUN-0900B.

## Next dependency-safe frontier

The remaining major packages are:

1. `SUN-1000` — security release gate;
2. `SUN-0800B` — external MCP/A2A/npm/publication, currently blocked external;
3. `SUN-1100` — registry/discoverability launch, dependent on SUN-1000 and
   SUN-0800B;
4. `SUN-1200` — first unknown paid transaction, dependent on SUN-1100.

`SUN-1000` is selected as the sole next active executable frontier because its
only dependency, SUN-0900B, is now accepted. SUN-0800B remains externally
blocked; SUN-1100 and SUN-1200 are not dependency-ready. This audit does not
begin SUN-1000 implementation.

## Checkpoint mutation totals

```text
registration mutations        0
delegation creations          0
token creations               0
verifyPermissions             0
service executions            0
settlePermissions             0
Payment-Identifier creations  0
jobs                          0
payment transactions          0
USDC movement                 0
```

## Verification

Pre-audit, with credentials and live flags removed from validation children:

- `pnpm nevermined:check`: pass;
- `pnpm x402:check`: pass;
- `pnpm state:validate`: pass;
- `pnpm tasks:validate`: pass;
- `pnpm governance:validate`: pass;
- `pnpm secrets:scan`: pass.

The managed sandbox initially denied local Miniflare/tsx IPC with `EPERM`; the
identical credential-stripped commands passed outside that filesystem/socket
restriction. That infrastructure retry made no network or payment call.

Final post-edit, credential-stripped verification passed:

- `pnpm nevermined:check`: 233 protocol tests and 155 compatibility/runtime
  tests passed;
- `pnpm x402:check`, `pnpm mcp:check`, and `pnpm a2a:check`: passed;
- `pnpm migrations:verify` and `pnpm d1:test`: passed, including constraints,
  transactions, concurrency, and queue-consumer validation;
- `pnpm secrets:scan`: 846 tracked files, 8 required risk classes, 9 redacted
  detector probes, Git history and working directory scanned, no leaks;
- `pnpm check`: passed in full; the root Vitest run reported 1,673 passed and 23
  guarded skips, the document worker reported 81 passed, and the service runtime
  reported 90 passed.

All registration, payment, live, probe, recovery, and audit guards were absent
after the audit command. The post-commit history-sensitive secret scan is
reported in the checkpoint stop report because a commit cannot self-record its
own hash or resulting Git-history scan count.

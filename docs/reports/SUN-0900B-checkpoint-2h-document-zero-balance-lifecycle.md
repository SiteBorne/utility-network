# SUN-0900B Checkpoint 2H — Zero-Balance Document Credit Lifecycle

- Date: 2026-08-15
- Classification: `controlled_sandbox_self_test`
- Environment: Nevermined sandbox / Base Sepolia (`eip155:84532`)
- Production ready: `false`
- Production enabled: `false`

## Outcome

Checkpoint 2H is accepted for the frozen **zero-credit, native one-page**
document lifecycle. One logical payment acquired a 190,000-credit prepaid pool,
executed `document_evidence_json.v1` exactly once, redeemed the measured 12,000
credits, and left 178,000 credits. The 190,000-atomic USDC acquisition and the
12,000-credit usage value are deliberately recorded as different economic facts.

The external settlement succeeded before the first live process rejected an
ambiguous immediate provider observation. No fresh payment was attempted. A
recovery-only process used the original persistent Payment-Identifier, seller
GET-only reconciliation, public Base Sepolia evidence, and the already-durable
service artifacts to finalize the same lifecycle. Recovery added zero
delegations, tokens, verifications, executions, settlements, or jobs.

This proof sets the frozen document declaration to:

```text
registration_allowed        true
registered                  true
sandbox_capability_verified true
dynamic_live_allowed        true
```

Those values apply only to the frozen zero-balance native lifecycle. The
positive-but-insufficient balance case is still:

```text
PARTIAL_POSITIVE_INSUFFICIENT_BALANCE_UNPROVEN
```

## Frozen registration

| Field                   | Authoritative value                                                              |
| ----------------------- | -------------------------------------------------------------------------------- |
| Service                 | `document_evidence_json.v1`                                                      |
| Agent ID                | `109760621961288696094411057321700210583752765344624386042713081041578011828571` |
| Plan ID                 | `64977106381472769302826211192910538031161833107493020584806963732279386695975`  |
| Endpoint                | `POST https://utility.siteborne.net/v1/nevermined/document/evidence-json`        |
| Gross acquisition price | 190,000 atomic Base Sepolia USDC                                                 |
| Credits granted         | 190,000                                                                          |
| Minimum redemption      | 12,000                                                                           |
| Maximum redemption      | 190,000                                                                          |
| Redemption              | Variable                                                                         |
| Acquisition value       | `190000 / 190000 = 1` atomic acquisition value per credit                        |

Builder-key GET read-back continued to pass
`validateNeverminedDocumentDynamicPlan`, and the registration remained the same
exact agent/plan pair. Registration mutations during Checkpoint 2H: zero.

## Durable identity and preconditions

| Field                          | Evidence                                                             |
| ------------------------------ | -------------------------------------------------------------------- |
| Payment-Identifier             | `pay_3fa17794e1ed47589d64e3db3c15e09a`                               |
| Nevermined delegation          | `7045d724-0a61-4190-b5de-dee3bba185ac`                               |
| Delegation budget              | 19 cents, the smallest whole-cent bound covering 190,000 atomic USDC |
| Delegation lifetime            | approximately 3,600 seconds as configured                            |
| Subscriber payer               | `0xCa7DD940B5071Bbcb238901794B900CF9db376E7`                         |
| Payer pre-live USDC            | 20,000,000 atomic / 20 test USDC                                     |
| Starting document-plan credits | 0                                                                    |
| Persistent D1 path             | `$HOME/.local/share/siteborne/live-d1/sun-0900b-document-dynamic`    |
| Pre-mutation D1 state          | no unfinished or recoverable document lifecycle                      |
| Control-plane job              | `cc61c890-0131-4bad-b521-4144383d76f0`                               |

One plan-bound authorization token was minted and kept only in memory. It was
not printed, logged, hashed into evidence, persisted in D1, or reused to create
a new payment. The live flag was command-scoped to the single fresh lifecycle.

## Verification, execution, PCC, and receipt

The live provider received the frozen 190,000 maximum and returned accepted
external verification exactly once. The verification evidence hash is:

```text
sha256:2647e08523958a8d6ec382cb644c5581b0703502bd053ac5325cedddfe2e8f3c
```

The lifecycle persisted `external_verified` before work. The actual local
`document_evidence_json.v1` runtime then processed the frozen native one-page
fixture exactly once and produced one logical job. Canonical pricing derived the
actual UsageResult from measured execution:

```text
authorized maximum = 190000
actual usage       = 12000
actual <= maximum  = true
```

UsageResult hash:

```text
sha256:600e144f5dfc9ec83f0119aed168cb18f7b82b7a37ce3b3aed7b96e962c71aaa
```

Service output hash:

```text
sha256:855b4cafa623c4f52338217cca47cb213f625c960a4cf146e36a09863f6a9c44
```

The persisted PCC decision is `pass`; service, job, output, evidence, and usage
bindings were validated before settlement. The runtime's PCC carrier does not
assign a separate public PCC identifier. Its immutable evidence binding is
covered by the signed receipt and durable result.

Signed SITEBORNE receipt:

```text
receipt ID:   rcpt_6b0beb959e8ea1e3a979935a
receipt hash: sha256:d87e14b90bbfb41c0061427ac1499bd68265ca6f1658c8c747b228a02166127f
evidence:     sha256:0d13032be973dc1f618edb9bb12e79014779dfc7f454a1fb164b512200fe96e4
```

The original live process cryptographically self-verified the signed receipt
before persisting the settlement draft and calling the provider. The fixture
signing-key registry is intentionally process-local, so the recovery process did
not fabricate a second signature-verification claim with a replacement test key.
It instead re-hashed the unchanged receipt and revalidated its service, internal
job, output, receipt-ID, and decision bindings.

The UsageResult, PCC, receipt, verification evidence, job, and immutable hashes
were durable before the lifecycle entered `SETTLEMENT_PENDING` at:

```text
2026-08-15T20:05:40.581Z
```

## External settlement and recovery

`settlePermissions` was called once with **12,000 credits**, not 190,000. The
external provider mutation succeeded, but the live wrapper's immediate
observation check failed closed with
`dynamic_credit_settlement_observation_mismatch`. The HTTP attempt therefore did
not claim success, and D1 remained authoritatively recoverable at
`SETTLEMENT_PENDING` with the completed service artifacts.

The recovery-only path contains no delegation, token, verification, service, or
settlement methods. It reconciled the original delegation and payment with
seller-side GETs and public Base Sepolia reads. Nevermined reported exactly one
succeeded economic transaction for the delegation, with amount `19` cents and
currency `USDC`.

Public Base Sepolia transaction:

```text
0xb714bf0dd56603435e4aae0b4136ad1338d7f98b2fced3bfdc463c4e413ad4d3
```

The receipt succeeded and its USDC transfer trace proved:

| Economic fact                            | Atomic amount |
| ---------------------------------------- | ------------: |
| Subscriber-to-ERC-4337 execution funding |       190,000 |
| SITEBORNE seller                         |       188,100 |
| Nevermined platform                      |         1,900 |
| Gross cash acquisition                   |       190,000 |

The final seller/platform split source was the public ERC-4337 execution address
`0x47a72d7094c4c5b0566e159579dbd79220a0ea24`. The same receipt trace proved a
190,000-atomic transfer from the externally verified subscriber payer to that
execution address before its exact seller/platform split. This preserves payer
binding without incorrectly requiring the final split transfer to originate
directly from the smart account.

Authoritative credit state after settlement:

```text
starting credits =      0
credits acquired = 190000
credits redeemed =  12000
remaining credits = 178000

0 + 190000 - 12000 = 178000
```

Rail-specific credit evidence hash:

```text
sha256:f7f93523c719d38d6bdbb5bb29d1e12be726ae4688d6381cada77a3cadb732bf
```

Recovered bounded provider evidence hash:

```text
sha256:ad87ee82e0c4d017a917b77940c794cb3e6533dc9e3362e408896c05243fd228
```

The evidence keeps these three values distinct:

```text
cash_movement_atomic          = 190000
credits_redeemed              = 12000
usage_value_atomic_equivalent = 12000
```

No receipt or PCC states that 12,000 atomic USDC moved during the request.

## Linkage, consumed state, and replay

After external cash and credit evidence were both proven, the recovery path
transitioned the original payment from `SETTLEMENT_PENDING` to
`SETTLED_EXTERNAL`, built and independently self-verified PaymentServiceLink v2,
durably stored the final result, and only then marked the payment consumed and
the original job delivered.

```text
PSL ID:   lnk_d12646a2484b2a231efffd4d
PSL hash: sha256:4c9838b32279a8a2b8e2ac4543f0e06ea2b9c9d9b67930229aa73bb408216360
settlement evidence hash:
sha256:4655d6e436674c41b1043550b51d2fdae6c6aab70ef6836618efd7a5a4a22828
```

Consumed timestamp:

```text
2026-08-15T20:17:03.276Z
```

A credential-free fresh process reopened the persistent D1 store and recovered
the same Payment-Identifier, job, output, UsageResult, PCC, receipt, settlement
evidence, PSL, status 200 result, and consumed lifecycle. It independently
self-verified the PSL and rail-specific credit evidence.

Replay and recovery counters:

| Counter                    | Additional operations |
| -------------------------- | --------------------: |
| Recovery verification      |                     0 |
| Recovery service execution |                     0 |
| Recovery settlement        |                     0 |
| Recovery jobs              |                     0 |
| Replay verification        |                     0 |
| Replay service execution   |                     0 |
| Replay settlement          |                     0 |
| Replay jobs                |                     0 |

The identical persisted result reconstructed successfully. Reusing the same
Payment-Identifier with a changed immutable input binding classified as
`replay_conflict` / `duplicate_conflict` before provider work, execution,
settlement, or result leakage.

## Code and deterministic coverage

Checkpoint 2H adds:

- a canonical BigInt-only `NeverminedCreditsSettlementEvidence` builder and
  fail-closed validator;
- bounded Nevermined settlement observations without raw SDK or authorization
  material;
- independent PaymentServiceLink hash/ID self-verification;
- durable UsageResult, PCC, receipt, settlement evidence, and PSL persistence;
- lifecycle ordering that records external settlement, verifies linkage, and
  only then consumes/delivers;
- a one-shot live document harness and a same-payment recovery-only harness;
- mutation, malformed-evidence, route-ordering, durable-evidence, replay, and
  conflict regression tests.

The live harness remains skipped unless `RUN_LIVE_NEVERMINED=1`. The recovery
harness requires an explicit Payment-Identifier and forbids live flags. Normal
tests and CI remain credential-free and network-free.

## Scope and claims

- New document registrations: **0**.
- Fresh document lifecycles: **1**.
- Real document settlements: **1**.
- Delegation creations: at most **1**, reconciled for the one lifecycle.
- Authorization tokens: **1**, ephemeral.
- `verifyPermissions` calls: **1**.
- Service executions: **1**.
- Logical jobs: **1**.
- `settlePermissions` calls: **1**.
- Second payments or settlements: **0**.
- Base mainnet transactions: **0**.
- Revenue/customer claim: **none**.

This is controlled sandbox evidence, not revenue, independent customer activity,
an unknown buyer, an open-market purchase, or production readiness. Production
remains disabled and not ready.

## Next checkpoint

Do not repeat the zero-balance lifecycle and do not create another document
plan. The next document payment checkpoint is the isolated
positive-but-insufficient balance case, for example 5,000 existing credits
against a 12,000 native burn. Its automatic top-up behavior must be observed,
not inferred. Remaining canonical Nevermined registrations must continue to use
reconcile-first, single-mutation checkpoints.

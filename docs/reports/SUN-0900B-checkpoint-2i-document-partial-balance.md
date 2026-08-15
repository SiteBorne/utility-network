# SUN-0900B Checkpoint 2I — Positive-But-Insufficient Document Balance

Date: 2026-08-15 Starting accepted commit:
`4309cc067cdab703477473d107ad65e16c2e613f` Pre-live repair commit:
`066fb5fb41491a05610fdbf03e7b8632440afdd5` Classification:
`controlled_sandbox_self_test` Checkpoint result: **ACCEPTED —
`FULL_BUNDLE_TOPUP`**

Checkpoint 2I proved the frozen Nevermined document plan's behavior when a
subscriber starts with a positive but insufficient reusable credit balance. The
accepted corrected payment started with `178000` credits, required a real
service-derived `190000`-credit burn, acquired a full new `190000`-credit bundle
for `190000` atomic Base Sepolia USDC, redeemed `190000`, and ended with
`178000` credits:

```text
178000 starting + 190000 acquired - 190000 redeemed = 178000 ending
```

This is a full-bundle top-up, not a deficit-only `12000`-credit acquisition. The
provider settlement succeeded once. The initial process rejected an immediate
settlement-observation mismatch and returned no paid success, then the same
durable `Payment-Identifier` was recovered from seller GET-only and public-chain
evidence with zero additional verify, execution, settlement, or jobs. A separate
credential-free process reopened and replay-audited the consumed result.

This checkpoint does not claim production readiness, revenue, customer activity,
an independent customer, or an open-market purchase.

## Frozen registration and economics

- Network: Base Sepolia, `eip155:84532`.
- Asset: Base Sepolia USDC, `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.
- Subscriber smart account: `0xCa7DD940B5071Bbcb238901794B900CF9db376E7`.
- SITEBORNE receiver: `0x7f44a2dd237938F18632d4CcA40f4c690295E6E1`.
- Frozen document agent:
  `109760621961288696094411057321700210583752765344624386042713081041578011828571`.
- Frozen document plan:
  `64977106381472769302826211192910538031161833107493020584806963732279386695975`.
- Registration validator: `valid=true` before and after settlement.
- Registration reconciliation: `EXACT_EXISTING` before and after settlement.
- Registration mutations: `0`.
- Gross acquisition price: `190000` atomic USDC.
- Credits per acquisition: `190000`.
- Variable redemption range: `12000..190000`.
- Exact acquisition value: `190000 / 190000 = 1` atomic USDC per credit.
- Authoritative starting document balance: `178000` credits.
- Required measured burn: `190000` credits.
- Positive-but-insufficient deficit: `12000` credits.
- Pre-live payer balance: `19756000` atomic Base Sepolia USDC.

## Deterministic maximum-cost fixture

The accepted fixture is
`services/modal-worker/fixtures/pdf/scanned_ten_page.pdf`:

- PDF version 1.3;
- 10 pages;
- file SHA-256:
  `d0b09ad4ccceb8dbaad8647fe0eb19f13793a11fcb5ca91a047b0b8576d3750f`;
- normal request field `ocr_permission=true`;
- actual file length `size_bytes=29001`;
- real local Python worker result: 10 processed pages, all OCR, no tables;
- canonical pricing subtotal: `190000`;
- canonical maximum: `190000`;
- canonical `actual_amount`: `190000`;
- capped: `false`.

The fixture uses the normal `document_evidence_json.v1` request schema and
service runtime. There is no caller-supplied amount, pricing override, or
fabricated UsageResult. Its corrected immutable input hash is:

`sha256:f2bf49622791b31d01307cad7daf171908bcc26e94d543975af8222a34c05f82`.

## Attempt 1 — preserved fail-closed incident

The first Checkpoint 2I payment remains immutable and separate:

- Payment-Identifier: `pay_f9cfc34bac0d46bc980d71b286bf39a6`.
- Persistent D1 path:
  `$HOME/.local/share/siteborne/live-d1/sun-0900b-document-partial-balance`.
- Input hash:
  `sha256:b889fc62ece7d0c68e0173fb91d7d075bd880aa595266043ed35b02d7884aba2`.
- Delegation: `fde6e86c-1415-4bac-966f-2228526078bd`.
- Job: `418c712b-542a-42dc-b08c-9f63a5c08d5a`.
- Provider verification: one accepted verification.
- Lifecycle stage: `verified`.
- Job state: `REJECTED`, attempt count `1`.
- Delegation transaction count: `0`.
- Delegation spent: `0` cents.
- Service output, PCC, receipt, settlement draft, settlement, and cached paid
  result: absent.
- Consumed state: false.

The initiating request omitted OCR permission and retained the old one-byte
fixture declaration. The service correctly rejected it before settlement. The
bridge vocabulary defect exposed by that failure was repaired before the second
authorization: TypeScript `always` / `if_needed` / `never` now maps to Python
`required` / `if_needed` / `forbidden`, and OCR-required content without
permission fails closed before PCC/receipt generation. The first D1 directory
and payment were never rewritten, reused, or settled.

## Pre-live repair and controls

Commit `066fb5fb41491a05610fdbf03e7b8632440afdd5` froze the repair before
external mutation. It also added deterministic regression coverage for:

- immutable separation of the rejected and corrected inputs;
- exact ten-page OCR worker/pricing proof at `190000`;
- signed receipt generation and self-verification for the corrected input;
- no PCC/receipt for the same fixture without OCR permission;
- no settlement draft or cached paid response after local service rejection;
- identical rejected retry adding no provider/work activity;
- minimum 45-minute delegation lifetime;
- a distinct Attempt 2 D1 store containing zero payment attempts and zero jobs.

Immediately before Attempt 2, read-only reconciliation proved:

- frozen registration validator: pass;
- frozen registration: `EXACT_EXISTING`;
- starting credits: exactly `178000`;
- Attempt 1 delegation transactions: `0`;
- Attempt 1 successful transactions: `0`;
- payer USDC: `19756000` atomic;
- corrected real-worker/pricing fixture: exactly `190000`;
- Attempt 2 D1 path: absent/empty;
- repository tree: clean;
- all live, registration, recovery, and capability-probe flags: absent.

## Attempt 2 — one corrected logical lifecycle

Exactly one new live command was issued for the corrected input. It used:

- Persistent D1 path:
  `$HOME/.local/share/siteborne/live-d1/sun-0900b-document-partial-balance-attempt2`.
- Payment-Identifier: `pay_889841069efe4410908ed76a7c1ad18c`.
- Delegation: `c34e15a8-1f94-4b5c-b721-a6743e2662d5`.
- Delegation limit: `19` cents.
- Payment token: minted once, memory-only, never printed or persisted.
- Job: `8e765d08-6530-4c08-8fdf-88d8a070fa12`.
- Quote: `qte_5ff9a2d9523f572027a6adab`.
- Requirement: `req_459b511194344bc77f581fc6`.

The new payment was acquired in D1 before provider verification. Real
`verifyPermissions` accepted once, and external-verification evidence was
persisted before service execution. The corrected service executed exactly once,
produced one logical job, derived `actual_amount=190000`, passed PCC, created an
Ed25519-signed SITEBORNE receipt, and self-verified that receipt.

Sanitized durable service evidence:

- Output hash:
  `sha256:fa52e70f82c0cdd9f1b60e09668be658e75c963b752653e19e9bdca339edf1d2`.
- PCC decision: `pass`; schema, provenance, and material-claim checks: pass;
  score `1`.
- Receipt ID: `rcpt_f5887ed77da2e85534debce6`.
- Receipt hash:
  `sha256:284fbef1d455735c4a5fe0870cf33ec9276356692adc8376bb809173c23d2d9c`.
- Receipt evidence hash:
  `sha256:292ad0e61f951602a6953f36b6ae239c4e1b949237b87eb7dfeb46595a227781`.
- Receipt signature algorithm: `Ed25519`; self-verification: pass before
  settlement.
- UsageResult ID: `usg_e5a02aedf79d29be0aa414d0`.
- UsageResult hash:
  `sha256:6f1bf1b3fc9e70f61d23dd920fe5e30335f954f6d6723325925f5c36d2cd3a5a`.
- Resource-metrics hash:
  `sha256:0169d4ba5d52807ed1daa32704f39345805c22afd91e66b43e7eefa3b64ba1aa`.
- Verification-evidence hash:
  `sha256:872a21c55504add36cfcec835b4038e46ff024e417081611027c185b2c5a0062`.
- Durable `SETTLEMENT_PENDING` timestamp: `2026-08-15T22:10:44.952Z`.

## Provider settlement and recovery

Real `settlePermissions` was called exactly once with `190000`, the measured
usage for this fixture. Nevermined succeeded externally but the first local
process rejected its immediate settlement observation as
`dynamic_credit_settlement_observation_mismatch`. The route returned no HTTP
paid success and left the payment durably `settlement_pending`; it did not call
settlement again.

Seller GET-only reconciliation then proved exactly one succeeded delegation
transaction:

- Transaction:
  `0xbc3693feca26bfc9282e3e0c746123d89f45e40dbb9b42679567426e97d46aa4`.
- Provider status: `succeeded`.
- Provider transaction time: `2026-08-15T22:10:48.848Z`.
- Delegation amount: `19` cents.
- Delegation transaction count: `1`.
- Delegation final status: `Exhausted`.
- Immediate/provider credits redeemed: `190000`.
- Immediate/provider remaining balance: `178000`.

The recovery-only finalizer used the same Payment-Identifier, delegation, job,
and durable settlement draft. It performed seller GETs and public Base Sepolia
receipt validation only. It added:

```text
verify       0
execute      0
settle       0
jobs         0
```

Public Base Sepolia USDC Transfer evidence proves:

```text
seller       188100 atomic
platform       1900 atomic
gross        190000 atomic
```

The authoritative plan-balance equation proves:

```text
starting credits     178000
credits acquired     190000
credits redeemed     190000
ending credits       178000

178000 + 190000 - 190000 = 178000
```

The cash acquisition and credit acquisition agree under the frozen 1-credit =
1-atomic acquisition value. The observed policy is therefore exactly:

`FULL_BUNDLE_TOPUP`.

It is not `DEFICIT_ONLY_TOPUP`; Nevermined acquired a complete `190000`-credit
bundle rather than only the `12000`-credit deficit.

## Settlement linkage, consumed state, and replay

Recovery built and verified the additive Nevermined credits-settlement evidence:

- Credits-settlement evidence hash:
  `sha256:b9993b48a65c4e758475581ead185e453725f7a46c78e5e34eeea28dd56c533e`.
- External settlement-evidence hash:
  `sha256:e03126c7332bba8f206d46fdaf1bc44afa0c4f086ef870f155f4d03c919af67f`.
- PaymentServiceLink ID: `lnk_8a191d31963f4bd181cb2539`.
- PaymentServiceLink hash:
  `sha256:86e07dbd6c51be9f8c6874b2091e4fcfe36563866be9d0d4b615d04d22beb049`.
- PaymentServiceLink version: `2`; validation: pass.
- Final HTTP result reconstructed in durable cache: `200`.
- Final payment lifecycle: `settled`, consumed at `2026-08-15T22:12:43.354Z`.
- Final job state: `DELIVERED`, attempt count `1`.
- Jobs for the Payment-Identifier: `1`.

A separate process reopened the same persistent D1 path with all Nevermined,
CDP, and live variables removed. It verified the stored credits evidence and
PaymentServiceLink, reconstructed the same consumed result, and proved:

```text
replay additional verify      0
replay additional execute     0
replay additional settle      0
replay additional jobs        0
changed immutable binding     replay_conflict
```

No token was minted for replay. Attempt 1 remained `verified` / `REJECTED` and
unconsumed in its separate D1 store; Attempt 2 alone became settled/consumed.

## Acceptance and remaining scope

- `PARTIAL_POSITIVE_INSUFFICIENT_BALANCE_PROVEN=true`.
- Proven policy: `FULL_BUNDLE_TOPUP`.
- `sandbox_capability_verified=true` remains true.
- `dynamic_live_allowed=true` remains true for the frozen controlled sandbox
  document capability.
- `production_ready=false`.
- `production_enabled=false`.
- New real Attempt 2 settlements: `1`.
- Additional settlements during recovery/replay: `0`.
- Registration mutations: `0`.
- No mainnet operation occurred.
- No revenue or customer claim is made.
- No further partial-balance payment is required.

SUN-0900B remains active because the remaining canonical fixed Nevermined
services have not all been registered and reconciled. The next checkpoint is a
serial, reconcile-first registration checkpoint for one remaining fixed-price
service; it must not repeat either document payment or create another document
plan.

## Final deterministic regression

The acceptance state passed with every live, registration, recovery, and probe
flag absent and every external credential removed from child processes:

- `pnpm nevermined:check`;
- `pnpm x402:check`;
- `pnpm mcp:check`;
- `pnpm a2a:check`;
- governance, state, and task validation;
- migrations and D1 validation;
- `pnpm secrets:scan`;
- full `pnpm check`.

Recorded final results:

- root Vitest suite: `1639` passed, `20` skipped;
- Nevermined protocol: `199` passed;
- Nevermined compatibility matrix: `155` passed;
- x402 protocol: `451` passed, plus `20` property tests and fixture audit;
- document worker: `81` passed;
- service runtime: `90` passed;
- MCP/A2A, governance/state/tasks, contracts, migrations, D1, control plane,
  adapters, verification, and generated-artifact drift gates: pass;
- secret-scan scope: `839` tracked files / `5385180` bytes / `8` required
  classes / `9` redacted detector probes;
- Gitleaks history: `91` commits / approximately `5.88 MB` / no leaks;
- Gitleaks working directory: approximately `12.48 MB` / no leaks;
- final `pnpm check`: pass.

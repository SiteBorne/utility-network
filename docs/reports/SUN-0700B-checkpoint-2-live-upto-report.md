# SUN-0700B Checkpoint 2 — Live Base Sepolia Upto Settlement

## Status

Checkpoint 2 completed on 2026-08-10. Together with the retained Checkpoint 1
exact proof, this closes the live `SUN-0700B` acceptance criteria for real CDP
facilitator `/verify` and `/settle` behavior on both required schemes.

This was a controlled validation transaction. The controlled buyer is not an
independent customer, the transfer is not reported as revenue, and no Base
mainnet transaction occurred. `production_ready` and production execution remain
`false`.

## Environment and preflight

- Required environment variables: all five `SET` by presence-only checks.
  Values, credential hashes, bearer material, private keys, RPC credentials, and
  raw signed authorization material were never printed or persisted.
- `@coinbase/cdp-sdk`: `1.55.0`, confined to `apps/edge-api`.
- `@x402/core`: `2.21.0`.
- The first external call was authenticated facilitator `/supported`.
- Sanitized `/supported` result:
  - `exact` on `eip155:84532`: supported (regression information only; no second
    exact payment was made).
  - `upto` on `eip155:84532`: supported, including the required public
    facilitator-address metadata.
- The controlled wallet required one public Base Sepolia Permit2 approval
  transaction before signing the upto authorization. This was an allowance
  prerequisite, not a service payment or settlement. The test checks existing
  allowance first, so later runs do not create unnecessary approval
  transactions.
- CDP's optional project-node RPC resolver returned no Base Sepolia entry. The
  test therefore used viem's bundled Base Sepolia public RPC metadata only for
  Permit2 allowance reads and independent public receipt confirmation. Wallet
  signing remained CDP-managed, and `/verify` and `/settle` remained real CDP
  facilitator calls.

## Controlled upto settlement evidence

| Field                           | Sanitized public evidence                                                 |
| ------------------------------- | ------------------------------------------------------------------------- |
| Network                         | `eip155:84532` (Base Sepolia)                                             |
| Scheme                          | `upto`                                                                    |
| Service                         | `document_evidence_json.v1` / `v1`                                        |
| Contract release                | `1.0.0`                                                                   |
| Fixture                         | accepted `native-text-success` document-worker result                     |
| Pricing source version          | `1.0.0`                                                                   |
| Authorized maximum              | `190000` Base Sepolia USDC atomic units                                   |
| Actual measured amount          | `12000` Base Sepolia USDC atomic units                                    |
| Settled amount                  | `12000` Base Sepolia USDC atomic units                                    |
| Quote ID                        | `qte_ab30d171b4442d5b2f48b9ea`                                            |
| Requirement ID                  | `req_692f0a27d87625162f2ab341`                                            |
| Payment-Identifier              | `pay_1f08d55518ed46468e2ca20d4a300cb4`                                    |
| Buyer                           | `0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99`                              |
| Seller / payTo                  | `0x7f44a2dd237938F18632d4CcA40f4c690295E6E1`                              |
| Initial response                | HTTP `402` with codec-valid `PAYMENT-REQUIRED`                            |
| Buyer signing                   | CDP-managed Permit2 upto authorization succeeded; no private-key export   |
| Facilitator verify              | Succeeded; `external_verified` evidence passed the lifecycle gate         |
| Verification evidence hash      | `sha256:961c0e8a7c48b52680e6fd365cd61b45e5b9d1468aca4d45a812f75080c6fa40` |
| Service job ID                  | `bc362d7f-ca62-47d7-b35c-08261666ad95`                                    |
| Service execution count         | `1`                                                                       |
| Resource metrics                | 1 native-text page; 0 OCR; 0 tables; uncapped                             |
| Resource subtotal               | `12000` micro-USD / USDC atomic units                                     |
| Service output hash             | `sha256:c25a330c45d4919d1b0d02817d80b371e55bde8a85ef1c3f7039efdd112948c2` |
| PCC mesh result                 | `pass`; schema/provenance/material claims valid; score `1`                |
| SITEBORNE receipt ID            | `rcpt_49c010b065b7c7743522b3cf`                                           |
| SITEBORNE receipt hash          | `sha256:fe5fa8cfc02a0b40ff08a6a6f7e59de0a6e3b31cdc40e3ac145885bb6ffa157f` |
| Receipt self-verification       | Passed cryptographically                                                  |
| UsageResult ID                  | `usg_7155c18d53cad8a084122ccb`                                            |
| UsageResult hash                | `sha256:6510b09ca4df0cf78bb22bb4987db68d2abac08904b40c365a70861558a369ba` |
| Facilitator settle              | Succeeded exactly once for actual measured amount                         |
| Public Base Sepolia transaction | `0xbb297d5c94368c61b8a7f2d6a2f3e9acee9f42afcc18679f8f4720a86de45644`      |
| Public receipt confirmation     | Base Sepolia transaction receipt status `success`                         |
| Settlement evidence hash        | `sha256:8f3bdac859c5c05063dc12daa2c7452573235563881a570ebd4597a754c4d8e5` |
| PaymentServiceLink ID           | `lnk_fd1d647687bf2d45ae65f742`                                            |
| PaymentServiceLink hash         | `sha256:197c57625f74be3b8b96f8f6e231fc7b64a93f944f70951c3bcf20a719f9e0f9` |
| Paid response                   | HTTP `200` with codec-valid `PAYMENT-RESPONSE` amount `12000`             |

The required amount invariants held without changing canonical pricing:

```text
actual_amount (12000) < authorized_maximum (190000)
settled_amount (12000) == actual_amount (12000)
```

The maximum was the buyer authorization ceiling. It was never used as the
measured charge and was never copied into the settlement response amount.

## Document execution and UsageResult binding

The accepted local SUN-0400A document path processed the existing native-text
fixture exactly once. `@siteborne/pricing` derived the actual amount from the
worker result's real page classifications. The UsageResult binds the quote,
requirement, Payment-Identifier, service/version, request input hash, output
hash, signed receipt ID/hash, resource-metrics hash, pricing version, actual
amount, and authorized maximum.

Deterministic linkage tests prove that mutations to metrics, actual amount,
output, receipt ID, or receipt hash change or invalidate the UsageResult
binding. The settlement provider received the original signed payload and
maximum requirements plus the accepted UsageResult; only the official
facilitator settlement request used a requirements copy whose amount was the
measured actual amount.

## Replay proof

The same logical request and identical `Payment-Identifier` were retried after
settlement. D1 reconstructed the prior result and remained authoritative:

- replay HTTP status: `200`;
- same receipt, PaymentServiceLink, and `PAYMENT-RESPONSE`;
- logical D1 job count: `1`;
- total service executions: `1`;
- total facilitator verification calls: `1`;
- total facilitator settlement calls: `1`.

Therefore replay caused zero second execution, zero second logical job, zero
second verification, and zero second settlement.

## Conflict and fail-closed proof

- Same Payment-Identifier plus changed maximum, input, quote, or resource is
  `duplicate_conflict`; no prior result leaks.
- A deterministic executor-boundary case with actual amount above authorized
  maximum returns `authorization_exceeded`: no clipping, maximum-charge
  fallback, successful settlement, HTTP success, or `PAYMENT-RESPONSE`.
- A deterministic settlement-provider failure cannot return HTTP `200` or a
  `PAYMENT-RESPONSE`, and cannot reach settled/consumed state.
- Checkpoint 1's retained non-settling real facilitator rejection proves a
  rejected `/verify` executes the service zero times and calls `/settle` zero
  times. It was not repeated because the behavior is scheme-generic and an
  additional real negative was unnecessary.
- Normal tests and CI keep `RUN_LIVE_X402` disabled and make no payment-network
  calls. The guarded upto suite separately proved two skipped tests when the
  flag was `0`.
- Existing production-route tests remain green; paid production execution is
  still disabled.

## Final SUN-0700B acceptance audit

- Retained real exact evidence:
  `docs/reports/SUN-0700B-checkpoint-1-live-exact-report.md`, transaction
  `0x85345d5ec7e7efcfd2a7f91ded19c3463c7abda41e9ea1551fcc6466d4831e25`.
- New real upto evidence: this report, transaction
  `0xbb297d5c94368c61b8a7f2d6a2f3e9acee9f42afcc18679f8f4720a86de45644`.
- Both schemes used real CDP facilitator `/verify` and `/settle`.
- Both schemes passed the existing D1 replay, lifecycle, service, PCC receipt,
  and PaymentServiceLink boundaries.
- No accepted SUN-0700A layer was bypassed.
- The CDP SDK remains in `apps/edge-api`; `packages/protocol-x402` remains
  credential-independent.
- No Base mainnet transaction occurred.
- No revenue or independent-customer claim is made.
- Production remains disabled and not ready.

No required SUN-0700B criterion remains after the final validation and
bookkeeping gates pass.

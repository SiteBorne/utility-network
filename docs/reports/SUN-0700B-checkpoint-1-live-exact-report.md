# SUN-0700B Checkpoint 1 — Live Base Sepolia Exact Settlement

## Status

Checkpoint 1 completed on 2026-08-10. SUN-0700B remains `active`, not
`accepted`, because the separately authorized `upto` checkpoint has not been
started. `production_ready` remains `false`; production execution remains
disabled.

This was a controlled validation transaction. The controlled buyer is not an
independent customer, the transfer is not reported as revenue, and no Base
mainnet transaction occurred.

## Environment and preflight

- Required environment variables: all five `SET` by presence-only checks.
  Values, credential hashes, JWTs, private keys, and raw authorization material
  were never printed or persisted.
- `@coinbase/cdp-sdk`: `1.55.0`, installed only in `apps/edge-api`.
- `@x402/core`: `2.21.0`.
- Authenticated facilitator `/supported`: succeeded.
- Sanitized supported kinds required for this checkpoint:
  - `exact` on `eip155:84532`: supported.
  - `upto` on `eip155:84532`: supported, but not executed.
- SUN-0700B was activated only after this preflight; task, project-state, and
  governance validators passed with exactly one active task.

## Controlled exact settlement evidence

| Field                           | Sanitized public evidence                                                  |
| ------------------------------- | -------------------------------------------------------------------------- |
| Network                         | `eip155:84532` (Base Sepolia)                                              |
| Scheme                          | `exact`                                                                    |
| Service                         | `web_context_verified.v1` / `v1`                                           |
| Canonical price                 | `$0.009`                                                                   |
| Atomic amount                   | `9000` Base Sepolia USDC atomic units                                      |
| Quote ID                        | `qte_53170de6582d887608d4e8d8`                                             |
| Requirement ID                  | `req_57a154caa007291191227362`                                             |
| Payment-Identifier              | `pay_900bd3c9349046a5b9a634fc9c0fa195`                                     |
| Buyer                           | `0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99`                               |
| Seller / payTo                  | `0x7f44a2dd237938F18632d4CcA40f4c690295E6E1`                               |
| Initial response                | HTTP `402` with a codec-valid `PAYMENT-REQUIRED`                           |
| Buyer signing                   | Succeeded through the CDP-managed EVM account; no private-key export       |
| Facilitator verify              | Succeeded; `external_verified` evidence passed the existing lifecycle gate |
| Verification evidence hash      | `sha256:aca61d3b0aa0cfbe45a616d5e51781f4dfafdcd381eaa1441902c9ba301b4f46`  |
| Service job ID                  | `d8d428e6-139d-47b3-8e0a-c3262eaef242`                                     |
| Service execution count         | `1`                                                                        |
| Service output hash             | `sha256:34673de0d6ca5f2d5ebb18796363b781440cb00a4d596354944b21fcb49b8660`  |
| SITEBORNE receipt ID            | `rcpt_fcbb5423408da37f98848a10`                                            |
| SITEBORNE receipt hash          | `sha256:2d9b3aa815f524ceb0c933ffd15530666c55810d8ba752cd54ba7f1152b18e62`  |
| Receipt self-verification       | Passed cryptographically                                                   |
| Facilitator settle              | Succeeded exactly once                                                     |
| Public Base Sepolia transaction | `0x85345d5ec7e7efcfd2a7f91ded19c3463c7abda41e9ea1551fcc6466d4831e25`       |
| Settlement amount               | `9000`                                                                     |
| Settlement evidence hash        | `sha256:75df70fcc2be4a0e24674afc51bfdcf42297148e974d97db92e01cec714f023b`  |
| PaymentServiceLink ID           | `lnk_d76e4d54276348cf74b644a0`                                             |
| PaymentServiceLink hash         | `sha256:e811be39573e9a96db0ef202e563916d395e98ca82bc21a6b57b8fceffff76e3`  |
| Paid response                   | HTTP `200` with codec-valid `PAYMENT-RESPONSE`                             |
| Verification timestamp          | `2026-08-10T23:00:16.438Z`                                                 |
| Settlement timestamp            | `2026-08-10T23:00:16.438Z`                                                 |

## Replay proof

The same logical request and identical `Payment-Identifier` were retried after
settlement. D1 reconstructed the prior response and remained authoritative:

- replay HTTP status: `200`;
- same receipt, PaymentServiceLink, and `PAYMENT-RESPONSE`;
- logical D1 job count: `1`;
- total service executions: `1`;
- total facilitator verification calls for the paid identity: `1`;
- total facilitator settlement calls for the paid identity: `1`.

Therefore the replay caused zero second settlement, zero second service
execution, and zero second logical job.

## Negative and fail-closed proof

- A signed EIP-3009 payload whose `authorization.value` was changed after
  signing was rejected by the real facilitator `/verify`: HTTP `402`, service
  executions `0`, settlement calls `0`.
- A wrong-amount candidate requirement was rejected locally before any
  facilitator call: HTTP `400`, service executions `0`, verify calls `0`,
  settlement calls `0`.
- Deterministic tests cover malformed `PAYMENT-SIGNATURE`, wrong network, wrong
  amount, expired/unknown quote, wrong resource, and Payment-Identifier binding
  conflict without spending testnet funds.
- Deterministic provider-boundary tests prove settlement failure cannot return
  HTTP `200` or `PAYMENT-RESPONSE`.
- Thrown official facilitator verification/settlement failures are normalized
  into fail-closed evidence using bounded machine reason codes only. Free-form
  `invalidMessage`, `errorMessage`, and ordinary exception messages are neither
  returned nor hashed.
- Verification rejection transitions from `PAYMENT_CHALLENGED` directly to the
  canonical `REJECTED` state with transition reason `PAYMENT_FAILED`; it never
  enters a nonexistent intermediate state and never executes the service.

## Compatibility findings resolved during the live checkpoint

The first live attempt stopped before buyer signing or any transaction because
the route's requirement lacked the EIP-712 token-domain metadata required by the
official x402 EVM client. The route now carries protocol-generic
`PaymentRequirements.extra` metadata, while the CDP live integration derives
Base Sepolia USDC name/version from `@x402/evm.getDefaultAsset()` rather than
duplicating or guessing them.

The successful settlement then exposed two rejection-path defects after its own
replay proof had already passed: thrown HTTP facilitator rejections were not
normalized, and `PAYMENT_FAILED` was incorrectly used as a job state rather than
a transition reason. Both defects now have deterministic regressions, and only
the non-settling live negatives were rerun after their fixes. The
successful-flow test was not rerun, preserving exactly one settlement.

## Security and scope assertions

- No credential, bearer JWT, wallet secret, private key, raw signed payment
  authorization, or full environment snapshot is present in this report or in
  repository artifacts.
- The CDP SDK remains confined to `apps/edge-api`; `packages/protocol-x402`
  remains credential-independent.
- No Base mainnet transaction occurred.
- No revenue or independent-customer claim is made.
- Real `upto` settlement was not started.

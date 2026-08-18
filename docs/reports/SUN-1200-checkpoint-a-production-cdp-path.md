# SUN-1200 Checkpoint A — Production CDP Payment Path Implementation

**Starting HEAD:** `a517d89` **Classification:** capability implemented,
production not activated — `SUN-1200` remains `BLOCKED_EXTERNAL — MARKET_DEMAND`

## Governance authority (read before implementation)

- Master directive §8: "No route, policy, provider or pricing rule may
  autonomously affect production until it reaches `EXECUTABLE_VERIFIED`."
- ADR 0055
  (`docs/decisions/0055-human-authorized-production-bootstrap-exception.md`):
  distinguishes autonomous production authority (unchanged, still requires
  `EXECUTABLE_VERIFIED`) from a narrow, human-authorized bootstrap exception.
  Authorizes only the governance _mechanism_ — no specific future mutation.
- `docs/operations/PAYMENT_RAILS.md` / ADR 0054: CDP and Nevermined are
  structurally separate routes with no fallback — the basis for this checkpoint
  leaving Nevermined completely untouched.
- `governance/PROJECT_STATE.yaml` `market_integrity`: self/related-wallet/
  compensated/precommitted purchases and artificial volume remain forbidden —
  unaffected and unweakened by this checkpoint.

## Official CDP/x402 production semantics reconciled

- Base mainnet chain ID `8453`; official native USDC contract
  `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` — sourced directly from the
  already-installed `@x402/evm@2.21.0` SDK's own `DEFAULT_STABLECOINS` table,
  cross-checked against public block-explorer/Circle documentation (BaseScan,
  Blockscout) — no conflict found.
- `createCdpFacilitatorClient()` (`@coinbase/cdp-sdk/x402`, already a real
  `apps/edge-api` dependency) takes no network parameter — network selection
  happens entirely via the `network` field passed to `.verify()`/`.settle()`,
  not via facilitator construction. This means the existing
  `CdpPaymentEvidenceProvider`
  (`apps/edge-api/src/control-plane/evidence/cdp-provider.ts`, built SUN-0700B
  checkpoint 1, `providerKind: 'external'`) is already network-agnostic — no new
  facilitator-construction code was needed.

## What existed before this checkpoint (confirmed empty)

- `PRODUCTION_NETWORK = 'eip155:8453'` existed only as a documented constant;
  grepped confirmed zero call sites anywhere set
  `productionNetworkAuthorized: true`.
- Every payment-executing route (`paid-services.ts`) unconditionally declared
  `PREPRODUCTION_NETWORK`.
- `validateProductionBindings()` (`env.ts`) was defined but had zero call sites
  in the live request path (only exercised in one test file).

## Environment model

New closed selector `PaymentEnvironment = 'preproduction' | 'production'`
(`packages/protocol-x402/src/network/preproduction.ts`). Read from
`env.PAYMENT_ENVIRONMENT` via `resolvePaymentEnvironment` (edge-api layer) —
fails closed to `'preproduction'` for anything except the exact literal
`'production'` (unset, empty, wrong casing, any other string). Never inferred
from hostname, `ENVIRONMENT`, `NODE_ENV`, deployment name, or secret presence.

## Production authorization gate

`isProductionPaymentAuthorized(input)` requires **all four**, independently:

1. `environment === 'production'`
2. `productionEnabled === true` (the standing kill switch)
3. `humanBootstrapAuthorized === true` (ADR 0055's per-action authorization)
4. `productionCredentialsApproved === true` (separate from #2 — see credential
   policy below)

ADR 0055 is explicitly not treated as perpetual authorization — the
`humanBootstrapAuthorized` boolean must be independently, explicitly set for a
specific action; nothing in this checkpoint sets it.

## Network/asset resolution

`resolvePaymentNetwork(input)` replaces every previously unconditional
`PREPRODUCTION_NETWORK` literal in `paid-services.ts` (`paymentRoute()`'s CDP
branch, `v2CdpRoute()`). Resolves `PRODUCTION_NETWORK` only when fully
authorized; otherwise always `PREPRODUCTION_NETWORK`, still routed through the
existing `assertPreproductionNetwork` guard for defense in depth.

`resolvePaymentAsset(network)`
(`apps/edge-api/src/control-plane/config/production-payment.ts`) resolves the
asset strictly from the network via the official SDK's own `getDefaultAsset` —
structurally impossible to hardcode a mismatched asset.
`assertNetworkAssetConsistency` is an additional defense-in-depth check.

`PaidServicesConfig` gained one new optional field,
`productionAuthorization?: ProductionAuthorizationInput`. Omitted (every
existing caller) resolves via `DEFAULT_UNAUTHORIZED_PRODUCTION_INPUT` —
byte-identical to prior behavior, proven live (see tests below).

## Credential policy (ADR 0055 §8)

`PRODUCTION_CDP_CREDENTIALS_APPROVED` is a genuinely separate gate from
`PRODUCTION_ENABLED`. Previously-exposed sandbox/testnet credentials never
automatically satisfy it. This checkpoint provisions no credentials and sets no
approval — the flag is reserved, unset, defaulting to unapproved/`false`.

## Seller identity

`assertSellerIdentityConsistent` distinguishes the configured public
`SELLER_WALLET_ADDRESS` (a Cloudflare secret) from an authenticated CDP wallet
identity, throwing on mismatch. The hook is real and tested with a mock
authenticated address — no real CDP wallet client is constructed anywhere in
this checkpoint.

## Production bindings

`checkProductionBindingsPresent` — the canonical, wired equivalent of the
previously-dead `validateProductionBindings()` — presence-only check (never
reads/logs/returns values) for `SELLER_WALLET_ADDRESS`, `CDP_API_KEY_ID`,
`CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`.

## Route/Model D preservation

No new public paths introduced (`/production/*`, `/mainnet/*` etc. — none added,
matching directive). `/v1/*` and `/v2/*` CDP routes unchanged in shape. The
Nevermined branch of `paymentRoute()` still declares
`network: PREPRODUCTION_NETWORK` unconditionally and never calls
`resolvePaymentNetwork` — confirmed by direct inspection (grep), not altered by
this checkpoint. CDP production authorization has no code path into the
Nevermined declaration; Nevermined remains unmounted/fail-closed exactly as
before.

## D1 / Payment-Identifier / recovery semantics

Unchanged. No schema migration, no new replay model, no new lifecycle states —
this checkpoint touches only network/asset/authorization resolution upstream of
the existing, unmodified D1/lifecycle boundary.

## Negative and positive controls (all real, deterministic, no live provider call)

`packages/protocol-x402/src/network/preproduction.test.ts` (19 tests) and
`apps/edge-api/tests/production-payment-gate.test.ts` (23 tests, unit level)
plus `apps/edge-api/tests/production-payment-challenge.test.ts` (7 tests, real
Miniflare D1 + real Hono `app.request()` — a genuine 402 challenge, not a mock):

- Kill switch: `productionEnabled=false` denies even with every other gate true
  (both unit and live-challenge level).
- Bootstrap-auth control: `humanBootstrapAuthorized=false` denies even with
  every other gate true.
- Missing-credential-approval control: `productionCredentialsApproved=false`
  denies.
- Missing-credential (bindings) control: reports exactly the missing subset,
  never a secret value.
- Seller-mismatch control: throws on a genuinely different authenticated
  address.
- Wrong-asset controls (both directions): production network + preproduction
  asset fails closed; preproduction network + production asset fails closed.
- Default-mainnet-reachability control: an all-default/unset-shaped input never
  resolves production.
- Testnet regression (live): omitting `productionAuthorization` entirely, and
  passing it fully-unauthorized explicitly, both resolve the exact prior Base
  Sepolia challenge (network `eip155:84532`, asset
  `0x036CbD53842c5426634e7929541eC2318f3dCF7e`) — byte-identical to
  pre-checkpoint behavior.
- Mock positive construction (live): with every gate deliberately true (mocked —
  `evidenceMode` stays `'fixture'` throughout, so no economic path is reachable
  regardless), the real 402 challenge for both `/v1/*` and `/v2/*` CDP routes
  correctly resolves network `eip155:8453` and asset
  `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` — the real official values, not
  placeholders.

Total new/changed tests: 49 (19 + 23 + 7), all passing.

## Secret redaction audit

`checkProductionBindingsPresent` returns only field names (`missing: string[]`),
never values — tested explicitly (a value containing a marker string is
confirmed absent from the serialized result). No new log/error path in this
checkpoint prints `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`, or any
authorization/signing material.

## Cloudflare deployment config (prepared, not deployed)

Four new reserved `Env` fields
(`apps/edge-api/src/control-plane/config/env.ts`), documented, no secret values
anywhere:

- `PAYMENT_ENVIRONMENT` (var) — must be `'production'`
- `PRODUCTION_ENABLED` (var or secret) — must be `'true'`
- `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP` (secret, per-action) — must be
  `'true'`
- `PRODUCTION_CDP_CREDENTIALS_APPROVED` (var or secret) — must be `'true'`

None of these are set in `wrangler.toml` or as Cloudflare secrets by this
checkpoint. Wrangler OAuth remains revoked (from the prior checkpoint) — not
re-logged-in; no Cloudflare API call of any kind was made in this checkpoint.

## Security

`pnpm check`: format, lint, typecheck (all 23 workspace packages), all tests,
contracts, governance/state/tasks validate, `secrets:scan` — clean.
`pnpm security:release` (Semgrep → OSV → Trivy → Schemathesis → Chaos → Load):
exit 0, Trivy `blocking_critical_high_vulnerabilities: 0`,
`blocking_critical_high_misconfigurations: 0`, Chaos 18/18, Load 7/7.

## External mutation accounting

Real provider calls: 0. CDP transactions: 0. Production transactions: 0.
Nevermined calls: 0. Deployments: 0. DNS mutations: 0. Wrangler
re-authentication: 0 (deliberately not performed this checkpoint).

## Remaining prerequisites before any production-enabling deploy

1. A real credential-provisioning decision (separate checkpoint): provision real
   mainnet-scoped `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`/ `CDP_WALLET_SECRET`,
   explicitly approve them (`PRODUCTION_CDP_CREDENTIALS_APPROVED=true`), and
   provision a real production `SELLER_WALLET_ADDRESS`.
2. Wrangler re-authentication (`wrangler login`, fresh session) — revoked in the
   prior checkpoint, not restored here.
3. Wiring an actual `CdpPaymentEvidenceProvider` construction into `index.ts`'s
   live `/v1/*`/`/v2/*` handlers, gated behind `isProductionPaymentAuthorized` —
   this checkpoint built and proved the network/asset/authorization resolver but
   deliberately did not wire a real facilitator client into the live request
   path, keeping the change strictly to "capability, not activation."
4. A specific, bounded, human-authorized bootstrap action (ADR 0055) that sets
   `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true` for that one action only.
5. A Cloudflare deploy of this code (not performed this checkpoint).

## Final state

```
PRODUCTION_CDP_CODE_PATH               true
PRODUCTION_CDP_CREDENTIALS_APPROVED    false
production_ready                       false
production_enabled                     false
EXECUTABLE_VERIFIED                    false
SUN-1200                               BLOCKED_EXTERNAL — MARKET_DEMAND
```

# SUN-1200 Checkpoint D — Live Runtime Hook Wiring / Production-Disabled Artifact

**Starting HEAD:** `bd82a04` **Classification:** capability complete, production
not activated — `SUN-1200` remains `BLOCKED_EXTERNAL — MARKET_DEMAND`

## Objective

Wire the two real runtime boundaries checkpoint C left deliberately unwired —
`buildCdpSellerAddressLookup` and `cdpChainReceiptChecker` — into the outer
Worker (`index.ts`), while proving it remains structurally impossible to
authenticate, verify, settle, or move money under default/deployed-
preproduction settings.

## Outer runtime construction order (traced)

For a direct `/v2/*` request: `PAID_ROUTES_ENABLED` gate → D1 binding presence →
`resolveCdpEvidence(env)` (environment → four ADR 0055 gates →
`checkProductionBindingsPresent` → **seller lookup** → seller-identity match →
facilitator construction) → `buildPaidServicesApp` (network/asset resolution,
`cdpChainReceiptChecker` passed alongside) → the mounted route handles
verify/execute/settle. This is the same, single construction path checkpoint B/C
already established — no second production-routing architecture was created.

## Seller lookup runtime factory

`buildProductionCdpAccountLookupClientFactory` (`production-payment.ts`) — real,
not stubbed: returns a closure that, only when invoked, constructs a real
`@coinbase/cdp-sdk` `CdpClient` from the given credential bindings. Construction
of the _factory_ makes no network call (proven —
`production-payment-gate.test.ts`); constructing the _client_ itself is also
synchronous/local (`CdpClient`'s own constructor does no I/O, matching
`createCdpFacilitatorClient`'s already-confirmed property). Wired into
`index.ts`'s `resolveCdpEvidence` as
`buildCdpSellerAddressLookup(buildProductionCdpAccountLookupClientFactory(env), env.SELLER_WALLET_ADDRESS)`,
passed unconditionally into `resolveProductionCdpEvidenceProvider`'s deps — this
is safe specifically _because_ that function's own existing gate order
(unchanged) never calls the hook until all four ADR 0055 gates and all four
required secrets already hold.

## Seller lookup fail-closed order (proven, directive §4)

New tests (`production-payment-gate.test.ts`) directly assert ordering: a mock
seller-lookup failure is reached only _after_ every gate/binding check passes,
and the facilitator client is **never constructed** when the seller lookup fails
— `facilitatorConstructed` stays `false`. A missing binding short-circuits
before the seller lookup is even attempted. A malformed configured
`SELLER_WALLET_ADDRESS` (new local format check, `EVM_ADDRESS_PATTERN`) fails
closed **before any client is constructed at all** — zero network exposure for a
bad env var, by construction.

## A real safety defect found and fixed during this checkpoint's own testing

The existing, previously-accepted `production-cdp-outer-router.test.ts`
regression suite's shared `FULL_PRODUCTION_ENV_SHAPE` used a well-formed real
EVM `SELLER_WALLET_ADDRESS` together with all four ADR 0055 gates and all three
CDP secrets present (synthetic values). Through checkpoint C, this combination
was safe because the seller hook was unwired — no code path could ever reach it.
**After wiring the real hook this checkpoint, this exact, already-accepted test
would have attempted a genuine outbound network call to Coinbase's API with fake
credentials on every `pnpm check` run** (caught before commit, not in production
— no real call was ever actually observed to complete, but the code path was
genuinely reachable and this is not a defensible state for a regression suite to
be in). Fixed by making that shared constant's `SELLER_WALLET_ADDRESS`
deliberately, explicitly malformed (documented in the file's own header comment
as a hard requirement), so every scenario in that file continues to resolve to
`evidenceMode: 'fixture'` via a local, network-free format check — never via
network failure or timeout. A genuine positive full-stack proof was moved to a
new, explicitly-injected- mocks-only file (see below) instead of ever exercising
the real, non-injectable `index.ts` factories with a well-formed address.

## Chain receipt checker architecture

`chain-receipt-checker.ts` (new) uses `viem` — already a real, declared
`apps/edge-api` dependency (transitively required by `@x402/evm`), so no new
Trivy-scanned dependency surface. `createViemChainReceiptClient` constructs a
`viem` `PublicClient` scoped to exactly one chain (`base`/`baseSepolia` from
`viem/chains`, selected by `PRODUCTION_NETWORK`/`PREPRODUCTION_NETWORK`) —
construction makes no network call (proven directly,
`chain-receipt-checker.test.ts`). RPC source: two new, explicitly non-secret
`Env` fields, `BASE_RPC_URL`/`BASE_SEPOLIA_RPC_URL` — absent/unset falls back to
viem's own built-in default public Base RPC, so no external provisioning is
required by this checkpoint. No existing RPC/blockchain-client stack was found
elsewhere in the repository to reuse (confirmed by direct grep); no new large
dependency was added — `viem` already existed.

## Receipt success classification

`buildCdpChainReceiptChecker` never calls a receipt `SETTLED` merely because it
exists. Classification is the chain's own authoritative EIP-658 receipt `status`
field: `'success'` → `SETTLED`; `'reverted'` → `FAILED` (a definitive on-chain
failure). Every other outcome — not yet mined, not found, a malformed/absent
hash (rejected by a local regex _before_ the client is even called), or any
transport failure (timeout, RPC 5xx, network unavailable) — is `STILL_UNKNOWN`.
RPC uncertainty is never silently upgraded into `FAILED`, and a checker failure
never manufactures `SETTLED` — both proven with dedicated tests (thrown "not
found" error, thrown transport error, malformed hash, an unresolvable client
factory).

## Wiring into index.ts

Both hooks are wired unconditionally into both `/v1/*` and `/v2/*` CDP route
construction (`resolveCdpEvidence`/`resolveCdpChainReceiptChecker`). This is
deliberate and safe: `cdpChainReceiptChecker`'s returned function is only ever
invoked from inside `attemptCdpRecovery`'s own optional chain-check branch
during a genuine ambiguous CDP settlement — itself unreachable whenever
`evidenceMode` is `'fixture'` (`FixturePaymentEvidenceProvider` never produces
an ambiguous settlement), so wiring it unconditionally changes no reachable
behavior in the (currently universal) fixture-mode case, and it is read-only by
construction regardless. No test-only backdoor was added; no duplicate provider
factory was created.

## Startup / preproduction dormancy

Constructing `resolveCdpEvidence`/`resolveCdpChainReceiptChecker` at mount-time
never triggers a CDP auth call or an RPC call by itself — confirmed directly:
`buildProductionCdpAccountLookupClientFactory`'s returned factory and
`createViemChainReceiptClient` are both proven, in isolation, to complete
synchronously with zero network I/O. With `PAYMENT_ENVIRONMENT=preproduction`
(the default everywhere today), `isProductionPaymentAuthorized` is `false`
before the seller lookup is ever reached — zero production seller-lookup calls,
unchanged from checkpoint C. `cdpChainReceiptChecker` is network-generic by
rail/network — its invocation path is identical for preproduction, but is only
ever reached during ambiguous CDP recovery, which requires a real ambiguous
settlement in the first place.

## Kill-switch / credential-approval / human-authorization controls (re-proven)

`production-cdp-outer-router.test.ts`'s existing kill-switch, credential-
approval, and human-bootstrap controls all re-ran unchanged and green — with the
corrected, deliberately-malformed shared seller address, these prove (as before)
zero production path is reachable when any one of the four gates is false, now
additionally guaranteeing zero seller-lookup network exposure for the same
reason regardless of gate state.

## Positive mocks / negative controls (new)

`production-cdp-full-stack-mock.test.ts` (new, 4 tests) — the genuine directive
§22/§23 full-stack proof, built via `buildPaidServicesApp` directly with every
external boundary (facilitator, CDP account-lookup client, chain- RPC client)
injected as a deterministic mock, never the real network-facing factories:

- Full outer HTTP positive production mock: real mainnet challenge (chain ID
  `eip155:8453`, real USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`), seller
  identity match, verify=1/execute=1/settle=1, receipt, PSL; replay produces
  zero additional economic operations.
- Full outer HTTP recovery mock: an ambiguous production settlement recovers
  correctly from a genuinely fresh app instance (only D1 shared) — never a
  generic perpetual 202.
- Recovery via the (mocked) chain-receipt boundary: a candidate transaction hash
  converges to success with **zero** additional facilitator settle calls.
- Seller mismatch through the full mocked stack: a mock CDP account lookup
  resolving a different address than configured fails closed to fixture
  mode/testnet — the real facilitator client is never even constructed.

`production-payment-gate.test.ts` (+7 new): seller lookup ordering (three tests,
above), `buildProductionCdpAccountLookupClientFactory` construction-vs-
invocation proofs (two tests).

`chain-receipt-checker.test.ts` (new, 12 tests): SETTLED/FAILED/STILL_UNKNOWN
classification, malformed-hash short-circuit, unresolvable-network
short-circuit, real (non-mocked) `viem` client construction for both networks
with zero network calls, an explicit RPC-URL-override path.

## exact/upto recovery regression

`production-cdp-settlement-recovery.test.ts` (checkpoint C's 9 tests) re-ran
unchanged and green, including the `upto` positive recovery preserving
`authorized_maximum=190000`/`actual_amount=12000` and its negative control.

## Model D

Re-proven unchanged: `chaos-v2.test.ts`'s `MODEL_D_RAIL_ISOLATION` still passes;
every new checkpoint-D function (seller lookup, chain receipt checker) is
reached only from CDP-rail code paths — the Nevermined branch of
`paymentRoute()` and every Nevermined-specific function are untouched by this
checkpoint. Zero Nevermined calls anywhere in this checkpoint's own work.

## Production configuration contract (documented, not provisioned)

Non-secret: `PAYMENT_ENVIRONMENT`, `PRODUCTION_ENABLED`,
`HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP`, `PRODUCTION_CDP_CREDENTIALS_APPROVED`
(existing, ADR 0055), plus the two new `BASE_RPC_URL`/`BASE_SEPOLIA_RPC_URL`
(both optional; a public RPC endpoint URL is not credential material). Secret
names (unchanged, already documented in `wrangler.toml`'s own comment block):
`SELLER_WALLET_ADDRESS` (public address, not secret, but provisioned alongside
the credentials it must match), `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`,
`CDP_WALLET_SECRET`. None of these were added to `wrangler.toml`'s `[vars]`
section (unmodified by this checkpoint, confirmed by `git status`) —
`PRODUCTION_CDP_CREDENTIALS_APPROVED` remains `false` by default.

## Production artifact

`wrangler deploy --dry-run` (local bundling only, no Cloudflare authentication —
confirmed still logged out) succeeds cleanly: 5534.90 KiB gzip 957.04 KiB (up
from checkpoint B's ~3066 KiB — the expected cost of bundling `viem`'s chain
definitions/RPC client for the real, now-wired receipt-checker path). Bindings
list unchanged aside from the existing production-marked `ENVIRONMENT` var
(pre-existing, unrelated to the payment gates). No new `wrangler.toml` vars; no
test doubles, synthetic secrets, or private report content bundled into the
artifact (the artifact contains only compiled source, never test files).

## Security

`pnpm check` (format, lint, typecheck, full test suite, contracts,
governance/state/tasks validate, secrets:scan/gitleaks) and
`pnpm security:release` (Semgrep 0 findings, OSV critical=0, Trivy 0C/0H,
Schemathesis, Chaos, Load) both green. `x402:check`, `nevermined:check`,
`mcp:check`, `a2a:check`, `governance:validate` (77/77), `state:validate`
(30/30) all green.

## External mutation accounting

Real CDP auth calls: 0. Real chain RPC calls: 0. Real provider calls: 0.
Production/CDP transactions: 0. Nevermined calls: 0. Cloudflare
login/authentication: 0 (confirmed still logged out). Deployments: 0. DNS
mutations: 0.

## Remaining external prerequisites

1. Real credential-provisioning checkpoint (mainnet-scoped CDP secrets,
   `PRODUCTION_CDP_CREDENTIALS_APPROVED=true` decision, real
   `SELLER_WALLET_ADDRESS`) — this is now the ONLY remaining internal-work gap;
   every runtime boundary needed for production is real, wired, and tested
   end-to-end with mocks.
2. Wrangler re-authentication (still revoked).
3. A specific, bounded, human-authorized bootstrap action (ADR 0055) setting
   `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true` for that one action only.
4. A real Cloudflare deploy.

## Final state

```
PRODUCTION_CDP_CODE_PATH                true
PRODUCTION_CDP_PROVIDER_WIRING          true
PRODUCTION_SETTLEMENT_RECOVERY_READY    true
PRODUCTION_SELLER_IDENTITY_READY        true
PRODUCTION_RUNTIME_HOOKS_WIRED          true
PRODUCTION_CDP_CREDENTIALS_PROVISIONED  false
PRODUCTION_CDP_CREDENTIALS_APPROVED     false
production_ready                        false
production_enabled                      false
EXECUTABLE_VERIFIED                     false
SUN-1200                                BLOCKED_EXTERNAL — MARKET_DEMAND
```

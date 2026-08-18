# SUN-1200 Checkpoint B — Production CDP Provider Wiring / Mock Execution

**Starting HEAD:** `6e0da39` **Classification:** capability complete, production
not activated — `SUN-1200` remains `BLOCKED_EXTERNAL — MARKET_DEMAND`

## Before / after architecture

**Before:** `packages/protocol-x402`/`paid-services.ts` (checkpoint A) could
resolve a production network/asset, but `index.ts`'s live `/v1/*`/`/v2/*`
handlers still hardcoded `evidenceMode: 'fixture'` unconditionally — no code
path could ever construct a real `CdpPaymentEvidenceProvider`, regardless of any
env var.

**After:** `index.ts` calls one new boundary, `resolveCdpEvidence(env)`, which
resolves both the evidence provider (via `resolveProductionCdpEvidenceProvider`)
and the network/asset authorization input from the _same_ outcome — never
independently. A real `CdpPaymentEvidenceProvider` is constructible, and
genuinely exercised end-to-end in this checkpoint's own tests, but the live
public route boundary still cannot reach it today: no real
`getAuthenticatedSellerAddress` implementation is wired in, which is a
deliberate, disclosed choice (see "Seller identity" below), not an oversight.

## Official facilitator/provider contract reconciled

`createCdpFacilitatorClient()` (`@coinbase/cdp-sdk/x402`) takes no network
parameter — confirmed again this checkpoint by direct inspection; network
selection happens entirely via the `network` field in `.verify()`/`.settle()`
calls, not facilitator construction. Construction itself makes no network call.
`@coinbase/cdp-sdk` is already a real (non-dev) `apps/edge-api` dependency, so
wiring its import into `index.ts` adds no new Trivy-scanned dependency surface.

## Provider construction boundary

`resolveProductionCdpEvidenceProvider`
(`apps/edge-api/src/control-plane/config/production-payment.ts`) is the single
construction boundary. It returns the existing, always-safe
`{evidenceMode: 'fixture'}` unless, in strict order:

1. `isProductionPaymentAuthorized(authorization)` — all four ADR 0055 gates.
2. `checkProductionBindingsPresent` — all four required secrets present.
3. `deps.getAuthenticatedSellerAddress` is supplied and resolves without
   throwing.
4. `assertSellerIdentityConsistent` — the resolved address matches configured
   `SELLER_WALLET_ADDRESS`.

Only then does it construct
`new CdpPaymentEvidenceProvider(deps.createFacilitatorClient())`. Any failure
anywhere falls back to fixture mode rather than throwing (consistent with every
other gate in this system: an unauthorized/misconfigured request still gets a
safe, normal, non-economic answer).

**No startup-time economic construction**: the function is only ever called
per-request (inside the existing cache-rebuild trigger, same as before), never
at module load.

## Seller identity — deliberately unwired

`index.ts` supplies `createFacilitatorClient: createCdpFacilitatorClient` (real)
but **omits** `getAuthenticatedSellerAddress` entirely. Per
`resolveProductionCdpEvidenceProvider`'s own fail-closed design, an absent hook
fails closed to fixture mode — meaning production construction is structurally
unreachable via the live route today, regardless of any env var combination.
Building a real CDP wallet-identity lookup is genuinely new SDK usage not yet
established anywhere in this codebase, and is deferred to a future
credential-provisioning checkpoint (matching the user's own proposed sequence).
The hook and consistency check (`assertSellerIdentityConsistent`) are real and
tested with mocks only.

## Real finding #1 (found and fixed this checkpoint): network/evidence-mode divergence

An earlier version of `resolveCdpEvidence` passed the raw, env-var-only
`ProductionAuthorizationInput` straight into `buildPaidServicesApp` —
independent of whether evidence-provider construction actually succeeded.
Outer-router testing (see below) caught this immediately: setting the four
`PAYMENT_ENVIRONMENT`/`PRODUCTION_ENABLED`/`HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP`/`PRODUCTION_CDP_CREDENTIALS_APPROVED`
env vars to `'true'` — **no real secrets needed** — was enough to make the live
app construct and serve a real Base-mainnet 402 challenge (real chain ID, real
USDC contract address) while `evidenceMode` correctly stayed `'fixture'`
underneath. This is a truthfulness defect (advertising real mainnet payment
terms with zero real settlement capability behind them), not merely cosmetic.

**Fixed**: `productionAuthorization` passed to `buildPaidServicesApp` is now
derived from the _same_ success/failure outcome as evidence-provider
construction — `cdpEvidence.evidenceMode === 'production'` gates both, always in
lockstep. Re-verified live after the fix (see "default-mainnet-reachability
control" below).

## Real finding #2 (documented, not silently worked around): CDP-rail `settlement_failed` retry semantics

Direct inspection and empirical testing (real integration tests, not assumption)
established: CDP-rail settlement has no Nevermined-style two-phase
`settlement_pending` → reconciliation recovery path (`x402-service.ts` gates the
durable pre-settle draft write and `reconcileNeverminedSettlementForRecovery`
both `if (rail === 'nevermined')` only). Any CDP settle rejection — explicit
(`provider_rejected`) or ambiguous (a thrown exception) — transitions straight
to the terminal `settlement_failed` state. A same-Payment-Identifier retry after
that point is classified `duplicate_same` and returns `202 processing`
indefinitely (no second verify/settle call, but also no reconstructed terminal
result — CDP has no `reconstructFromJob` equivalent for this rail either). A
real buyer must submit a genuinely new Payment-Identifier to actually retry
after a rejected settlement. This is pre-existing, already-accepted SUN-0700A/B
behavior; this checkpoint neither introduces nor changes it, and does not invent
a parallel CDP recovery mechanism that doesn't exist.

(An earlier draft of the test suite incorrectly concluded the opposite — that
retries fully re-process — due to a test-construction bug: reusing a fresh
Payment-Identifier per call instead of the same one. Caught and fixed before
finalizing.)

## Tests (13 new, all real integration-level, no real provider call)

`apps/edge-api/tests/production-cdp-provider-wiring.test.ts` (5 tests, real
Miniflare D1, real `CdpPaymentEvidenceProvider` wrapping a mock
`HTTPFacilitatorClient` matching `cdp-provider.test.ts`'s own established
pattern):

- Exact positive lifecycle (`web_context_verified.v2`): real mainnet
  network/asset in the challenge, verify=1, execute=1, settle=1.
- Upto positive lifecycle (`document_evidence_json.v2`): max=190000,
  actual=12000, verify=1, execute=1, settle=1.
- Replay after success: identical response, zero additional provider calls.
- Settlement rejected (explicit): terminal, same-identifier retry returns 202
  processing, zero additional provider calls.
- Settlement ambiguous (thrown exception): same terminal/202-processing
  behavior.

`apps/edge-api/tests/production-cdp-outer-router.test.ts` (8 tests, real
Miniflare D1, the real `index.ts` app via `app.request()`, synthetic secret
values only):

- Default-mainnet-reachability control: every production env var `'true'` +
  synthetic credentials present → still resolves testnet (the fix above,
  re-verified).
- Kill switch (`PRODUCTION_ENABLED=false`), credential-approval control,
  human-bootstrap control, missing-credentials control — each individually
  false, every other gate true → testnet, every time.
- Model D re-proof (×2): `/v2/nevermined/*` stays structurally absent;
  `/v1/nevermined/*` stays its existing hardcoded 503 — both independent of
  every CDP production flag.
- Secret redaction: none of the synthetic CDP secret values appear in any
  response body.

## Testnet regression

`production-payment-challenge.test.ts` (checkpoint A, 7 tests) and the full
existing suite (`x402-service-route.test.ts` 30, `paid-routes-mounting.test.ts`
10, `chaos-v2.test.ts` 12, `chaos-v2-settlement-recovery.test.ts` 16,
`model-d-v2-nevermined.test.ts`) all re-run clean — 105 tests total across the
combined regression pass, zero behavior change to any existing accepted path.

## D1 / receipt / PSL

No new database, no schema change. The mock-production tests persist through the
exact same D1-backed repositories and lifecycle every other accepted test uses.

## Production artifact

`wrangler deploy --dry-run` (local bundling only, no Cloudflare authentication —
confirmed still logged out before and after) succeeds cleanly: 3066 KiB (up from
~2980 KiB, the new `@coinbase/cdp-sdk/x402` import — expected, no new Trivy
surface since the dependency was already declared). No new `wrangler.toml` vars
— production stays disabled by default in the real deployment config.

## Security

`pnpm check`: clean (format, lint, typecheck across all 23 workspace packages,
all tests, contracts, governance/state/tasks validate, secrets:scan — including
a check that the synthetic-but-realistic-looking CDP test secret strings never
trip a false-positive leak). `pnpm security:release`: exit 0, Trivy
`blocking_critical_high_vulnerabilities: 0`,
`blocking_critical_high_misconfigurations: 0`, Chaos 18/18, Load 7/7.

## External mutation accounting

Real CDP provider calls: 0. CDP transactions: 0. Production transactions: 0.
Nevermined calls: 0. Deployments: 0. DNS mutations: 0. Wrangler authentication:
0 (confirmed still logged out).

## Remaining prerequisites before any production-enabling deploy (unchanged from checkpoint A, one item narrowed)

1. Real credential-provisioning checkpoint (mainnet-scoped CDP secrets,
   `PRODUCTION_CDP_CREDENTIALS_APPROVED=true` decision, real
   `SELLER_WALLET_ADDRESS`).
2. Wrangler re-authentication (still revoked, not restored this checkpoint).
3. **Narrowed**: a real `getAuthenticatedSellerAddress` implementation (the one
   remaining unwired hook — everything else in the execution path is now proven
   end-to-end with mocks).
4. A specific, bounded, human-authorized bootstrap action (ADR 0055) setting
   `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true` for that one action only.
5. A real Cloudflare deploy.

## Final state

```
PRODUCTION_CDP_CODE_PATH               true
PRODUCTION_CDP_PROVIDER_WIRING         true
PRODUCTION_CDP_CREDENTIALS_PROVISIONED false
PRODUCTION_CDP_CREDENTIALS_APPROVED    false
production_ready                       false
production_enabled                     false
EXECUTABLE_VERIFIED                    false
SUN-1200                               BLOCKED_EXTERNAL — MARKET_DEMAND
```

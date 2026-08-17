# SUN-1000 Checkpoint 1O-B2 — v2 Provider Activation / Live Sandbox Proofs (INTERIM — blocked)

**Status: NOT COMPLETE.** This checkpoint mounted the real v2 Nevermined routes
and proved local structural correctness end to end, but the first real economic
mutation (a bounded live sandbox payment against `company_evidence_graph.v2`)
was blocked by a reproducible, deterministic rejection from the real Nevermined
sandbox backend. Per the user's own standing instruction — _"fail closed on
ambiguity: never retry an uncertain registration/payment/ settlement mutation
until provider read/reconciliation proves the original mutation did not occur"_
— work stopped here rather than guessing further.

`USER_ACCEPTED_EXPOSED_CDP_CREDENTIAL_RISK=true`.
`ROTATE_EXPOSED_CDP_SANDBOX_CREDENTIALS_BEFORE_NEXT_PROVIDER_MUTATION=WAIVED_BY_USER`
(this checkpoint only, per explicit user instruction). Credential rotation was
NOT performed and is NOT represented as remediated.

## What was completed

1. **Credential/capability reconciliation** —
   `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`/
   `CDP_WALLET_SECRET`/`NVM_API_KEY`/`NVM_ENVIRONMENT` all present (values never
   read/printed). `NVM_ENVIRONMENT=sandbox` confirmed. `RUN_LIVE_NEVERMINED`
   confirmed off by default.
2. **Provider READ-only reconciliation** — all four v2 Nevermined registrations
   (company/web/document/verify) reconciled `state: 'existing'` against the
   known IDs frozen in checkpoint 1O-B1. Zero new registrations.
3. **Local route binding** — new additive `v2NeverminedRoute()`/
   `neverminedV2Enabled` route family
   ([paid-services.ts](../../apps/edge-api/src/control-plane/routes/paid-services.ts))
   binds the four v2 services to their real registered `agentId`/`planId` (never
   the symbolic placeholder) — proven by
   [model-d-v2-nevermined.test.ts](../../apps/edge-api/tests/model-d-v2-nevermined.test.ts)
   (4/4 passing): `/v2/nevermined/*` structurally 404 when disabled; throws at
   construction (not per-request) when enabled without an `evidenceProvider`;
   all four routes present with real IDs when correctly configured; sibling CDP
   `/v2/*` routes on the same app instance remain untouched (still
   `eip155:84532`, CDP shape) — no cross-rail contamination.
4. **`/v2/*` and `/v2/nevermined/*` HTTP forwarding** — added to
   [index.ts](../../apps/edge-api/src/index.ts) for the first time (previously
   `/v2/*` was never reachable through the deployed server at all, despite
   `paid-services.ts` registering real v2 CDP routes on an app object nothing
   ever dispatched to). Each route family uses its own separate, never-shared
   cached app instance and provider, per the discovered
   shared-provider-per-app-instance constraint. `/v2/nevermined/*` gates on
   `NEVERMINED_ROUTES_ENABLED`, `resolveNeverminedConfig`, and
   `evaluateNeverminedLiveGuard` (fail-closed on any absent/misconfigured
   credential; `NVM_ENVIRONMENT=live` hard-rejected even with
   `RUN_LIVE_NEVERMINED=1`) — proven by 6 new gate tests in
   [paid-routes-mounting.test.ts](../../apps/edge-api/tests/paid-routes-mounting.test.ts).
5. **Durable live-sandbox D1 persistence** — a dedicated, non-ephemeral
   directory (`sun-1000-checkpoint-1o-b2`, separate from v1's
   `sun-0900b-checkpoint1`) via the existing
   [live-persistence-path.ts](../../apps/edge-api/src/control-plane/live-persistence-path.ts)
   guard.
6. **Delegation reconciliation, twice, both real external state**: first attempt
   found `no_match`, created exactly one new ERC-4337 delegation
   (`spendingLimitCents: 1`, `durationSecs: 3600`, plan-bound), confirmed via
   independent read-back `exact_existing`. Second attempt (after the fix below
   and a ~90s wait) found and reused that same delegation, `exact_existing` —
   **zero additional delegations created**.

## What is blocked

The bounded live payment attempt for `company_evidence_graph.v2`
(`AMOUNT=39000`, matching the frozen registration) fails identically on two
independent attempts — one against a freshly-created delegation, one against the
same delegation reused (ruling out simple eventual-consistency):

```
402 {"error":"payment_verification_rejected","message":"verification_not_successful"}
```

A temporary, backed-up-and-restored (md5-confirmed byte-identical,
`5635b480578ad3744371b9b78bbf937e`) diagnostic added to
`OfficialNeverminedSdkAdapter.verifyPermissions()` captured the real SDK
response on the first attempt:

```
isValid: false
invalidReason: 'Cannot order pay-as-you-go plan'
payer: '0xCa7DD940B5071Bbcb238901794B900CF9db376E7'
```

### Root-cause investigation (read-only, no further mutation)

- Traced into the installed `@nevermined-io/payments@1.10.0` SDK source.
  `getPayAsYouGoCreditsConfig()`'s own doc comment: _"Credits are not minted
  upfront; these values are required for validation only."_
  `settlePermissions()`'s own doc comment: the backend _"will attempt to order
  more [credits] before settling"_ when balance is insufficient — a fallback
  that is invalid, by definition, for a plan type that never mints credits.
- Confirmed **both v1 and v2 registrations use identical real PAYG
  configuration** (`getPayAsYouGoPriceConfig`/`getPayAsYouGoCreditsConfig`,
  byte-identical calls in `nevermined-register-company.test.ts` and
  `nevermined-register-company-v2.test.ts`) — this is not a v2-specific
  registration defect.
- Our delegation/token/verify call sequence matches the SDK's own documented
  `create-first` pattern (`token.d.ts` JSDoc) exactly, and the
  `NeverminedPaymentRequired` shape we build/round-trip is structurally
  identical to the SDK's own `buildPaymentRequired()` output. **Not a shape
  defect.**
- Found a genuine precedent: the already-accepted differential PAYG probe
  ([nevermined-differential-payg-probe.test.ts](../../apps/edge-api/tests/live/nevermined-differential-payg-probe.test.ts),
  checkpoint 2B) proves the _identical_ flow **did** succeed for real on
  `web_context_verified.v1` (real on-chain tx
  `0x59a8bd0b7567e7cf3cc2489c539e41083ba424bd87d1b2920d539eebcd9669d7`) — ruling
  out a fundamental PAYG+delegation architectural incompatibility. That
  successful run explicitly reused an already-established delegation (_"Reusing
  existing usable delegation"_); our first failing attempt used a brand-new one.
  The eventual-consistency hypothesis this suggested was **tested and
  falsified**: the second attempt, reusing the now-confirmed-`exact_existing`
  delegation after a ~90s wait, failed identically.

**Conclusion: this is a real, reproducible, deterministic rejection from the
live Nevermined sandbox backend, root cause not fully resolved.** It is not
explained by delegation freshness, plan misregistration, request shape, or our
own route-construction code (all cross-checked above). Resolving it further
requires either Nevermined's own non-shipped API documentation/ support, or a
different registration/flow decision that is explicitly outside this
checkpoint's authorization (_"do not create any additional v2 agents/plans"_).

## Per the user's explicit fail-closed instruction, no further live mutation

was attempted beyond the two diagnostic-purpose attempts above (one initial, one
authorized retry after investigating and proposing the eventual- consistency
hypothesis). No blind retry loop was run.

## Exact external-mutation accounting

- Nevermined agent/plan registrations created: **0** (all four reconcile
  `existing` against frozen 1O-B1 IDs).
- Nevermined delegations created: **1** (`no_match` → created once; second
  attempt correctly reused it, `exact_existing`).
- Nevermined settlements/redemptions: **0** (never reached — verify rejected
  before settle was attempted both times).
- CDP testnet transactions: **0** (CDP proof not yet attempted; blocked behind
  this Nevermined finding per script ordering).
- Retries after an ambiguous result: **0** (both attempts had an unambiguous,
  non-ambiguous rejection reason; the second was a deliberate, user-authorized
  single re-attempt against confirmed state, not a retry of an ambiguous
  outcome).
- DNS/deployment/publication: **0**.
- `customer_count_increment`: **0**. `revenue_evidence_increment`: **0**.

## Diagnostic logging discipline

Temporary `console.log` diagnostics added to `nevermined-provider.ts`'s
`verifyPermissions()`/`settlePermissions()` were backed up before editing and
restored immediately after the diagnostic value was captured — confirmed
byte-identical to the original via md5 (`5635b480578ad3744371b9b78bbf937e`).
`git status` on that file is clean (zero diff from HEAD).

## Remaining work (all still pending, blocked on this finding)

- Root-cause the Nevermined backend's PAYG verify rejection (needs external
  Nevermined support/docs, or an explicit user decision on how to proceed).
- Live proofs for web, verify, document v2 services (all downstream of this same
  blocker for the two fixed-PAYG services; document is architecturally
  different, not yet attempted).
- Post-settlement recovery proof, real CDP Base Sepolia payment proof,
  cross-rail Payment-Identifier conflict proof, full regression, final
  21-section stop report.

## Final state

SUN-1000 remains `active`. Acceptance is **NOT YET** — unchanged from 1O-B1
(11/12 PASS, 1/12 BLOCKED_EXTERNAL: Trivy). This checkpoint adds no new SUN-1000
criterion pass/fail; it is Phase-2 provider-activation work, now itself blocked
on an unresolved real external-provider rejection. No credential rotation
performed or claimed. Production remains disabled throughout. `production_ready`
remains `false`.

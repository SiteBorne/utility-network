# SUN-1221E6R-H2AWI-3F — Real Production Route Continuation-Wiring Fix

## Why this checkpoint existed

H2AWI-4 provisioning was correctly stopped before any external Cloudflare
mutation. Fresh source inspection at that stop point found a real
production-wiring defect, distinct from and downstream of everything
H2AWI-1/2/3 built and verified.

## Root cause

H2AWI-3 (`7aaa29d`) made the durable Cloudflare Workflow the **sole**
settlement owner and removed the request-local `evidenceProvider.settle()`
fallback from `x402-service.ts` entirely. From that point on, a paid
production route with no `workflow`/`continuationEnvelopeKey` bound cannot
settle at all — it must fail closed, not silently degrade.

Neither `production-web-context-v2-cdp-route.ts` nor
`production-verify-v2-cdp-route.ts` was ever updated to forward
`PAID_CONTINUATION_WORKFLOW` (typed in `Env` since H2AWI-3c, `34b3d26`) or
a continuation-envelope encryption key into `createX402ServiceRoute`'s
config. Both fields are optional at that call boundary
(`workflow?: WorkflowBindingLike`, `continuationEnvelopeKey?: CryptoKey`),
so they silently arrived as `undefined`. Every real paid request on either
production route would reach `createOrJoinPaidContinuation` inside
`x402-service.ts`, find `config.workflow`/`config.continuationEnvelopeKey`
missing, and hit `create_failed` — an opaque per-request runtime failure,
not a clear startup-time signal. This is the same class of gap as
SUN-1221E6P (Modal env-propagation), one checkpoint layer up the stack.

Compounding this: `env.ts` typed `PAID_CONTINUATION_WORKFLOW` but never
typed `PAYMENT_CONTINUATION_ENCRYPTION_KEY` at all, so there was no typed
secret for a route to read even if it had tried to forward one.

## Fix

- **`config/env.ts`** — added `PAYMENT_CONTINUATION_ENCRYPTION_KEY?: string`,
  paired 1:1 with the existing `PAID_CONTINUATION_WORKFLOW` binding.
- **`continuation/envelope.ts`** — added `importContinuationEnvelopeKey()`:
  imports a base64-encoded 256-bit secret into a non-extractable AES-GCM
  `CryptoKey`. Fails closed with a new typed `EnvelopeKeyImportError`
  (`malformed_encoding` | `invalid_key_length`) rather than silently
  accepting a mis-sized or malformed key.
- **Both production route files** — added an explicit fail-closed gate
  immediately after the existing composition-`unavailable` check: if
  either `c.env.PAID_CONTINUATION_WORKFLOW` or
  `c.env.PAYMENT_CONTINUATION_ENCRYPTION_KEY` is absent, return the
  existing `productionServiceExecutorUnavailable(c)` (503) — the same
  response shape already used for missing Modal/CDP dependencies just
  above it in the same function. When both are present, `config.workflow`
  and `config.continuationEnvelopeKey` are set explicitly before
  `createX402ServiceRoute(subApp, config)` is called.

This is deliberately the smallest fix that closes the gap: no change to
`x402-service.ts`, the Workflow orchestration, the envelope format, or
either composition module's CDP-evidence resolution.

## Proof

`apps/edge-api/tests/production-route-continuation-wiring.test.ts` (new,
6 tests) exercises the **real** route modules through the real app
(`../src/index`). The two production composition modules
(`web-context-v2-cdp-composition.ts`, `verify-agent-output-v2-cdp-composition.ts`)
are mocked to return a fixed, always-valid config — their own CDP-evidence/
network resolution (real facilitator + account-lookup calls) is an
orthogonal, pre-existing concern unrelated to this fix, and mocking it out
is what makes these tests deterministic and fast rather than needing real
CDP credentials. `createX402ServiceRoute` itself is spied on via
`vi.mock(..., importOriginal)` — every other export stays real — so the
exact `config` object each route hands it can be inspected directly, the
strongest available proof that the fix's actual mechanism is under test
rather than a downstream side effect.

**RED (3 cases, reproducing the original bug):**
- No workflow, no key bound → 503 `service_executor_not_configured`,
  `createX402ServiceRoute` never called.
- Workflow bound, key absent → still 503, still uncalled.
- Key present, workflow absent → still 503, still uncalled.

(Both production routes covered for the "neither bound" case; the two
partial-absence cases are covered once, since the gate logic is identical
in both files and the H2AWI-3F fix is byte-for-byte the same shape in each.)

**GREEN (2 cases, one per route):**
- Both present → `createX402ServiceRoute` called exactly once;
  `config.workflow` is `toBe()` the exact bound fake-Workflow instance
  (not a copy); `config.continuationEnvelopeKey` is defined and its
  `.algorithm.name === 'AES-GCM'` (a real imported `CryptoKey`, not a
  placeholder).

## Regression

- `pnpm test`: **2557/2557 passed** (2548 baseline + 6 new + 3 net
  previously-skipped-now-passing; 0 failed), 22 skipped (74 pre-fix minus
  the 3 that unskipped).
- `pnpm test:worker-runtime`: **95/95** scenarios passed; bundle-isolation
  and bundle-inclusion proofs unchanged; real `wrangler.toml` dry-run
  bundle confirmed to still reach the handoff-path durable-continuation
  primitives (not dead code) and still exclude every fixture/test-only
  seam.
- `pnpm lint`: clean, 16/16 packages.
- `pnpm typecheck` (edge-api): 2 pre-existing errors only, both in
  `tests/live/web-context-first-paid-e2e-local.test.ts`, both unrelated to
  this change (unchanged from the H2AWI-3 baseline); the real (non-live-test)
  `tsconfig.json` project compiles with zero errors.
- `pnpm production:preflight`: **PASS** (zero mutating Cloudflare calls).
- `pnpm secrets:scan`: **4 findings**, all pre-existing git-identity-rewrite
  duplicates (2 real findings × 2 commit hashes each, from the earlier
  `git filter-branch` author-identity correction) — identical to every
  prior checkpoint's baseline. Zero new.

## Zero-effect confirmation

```
WORKFLOW_RESOURCE_MUTATIONS=0
SECRET_MUTATIONS=0
WORKER_VERSION_UPLOADS=0
DEPLOYMENT_MUTATIONS=0
D1_MUTATIONS=0
LIVE_402_REQUESTS=0
EIP3009_AUTHORIZATIONS_CREATED=0
SIGNER_CALLS=0
PAID_REQUESTS=0
FACILITATOR_SETTLE_CALLS=0
SETTLEMENTS=0
CHAIN_TRANSACTIONS=0
H1_JOB_MUTATIONS=0
```

`FINAL_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0`,
`FINAL_PRODUCTION_TRAFFIC=100%`, unchanged throughout.

## Result

```
SUN1221E6R_H2AWI3F_PRODUCTION_ROUTE_WIRING=PASS
SUN1221E6R_H2AWI4_ELIGIBLE=YES
NEXT_REQUIRED_CHECKPOINT=SUN-1221E6R-H2AWI-4
```

Implementation commit: `42b327e`.

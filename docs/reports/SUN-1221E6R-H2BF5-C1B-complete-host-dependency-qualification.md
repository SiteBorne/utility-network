# SUN-1221E6R-H2BF5-C1B — Complete Host Dependency Qualification

## Result: BLOCKED at dependency closure (§3) — zero external mutation

Authorization was present and valid. Dependency-closure tracing was
performed **before** touching the staged secret file or Cloudflare, per
§2's explicit instruction. It found a **second, larger gap** beyond the
three `MODAL_WEBCTX_*` secrets: four required plain **variables**
(`PAYMENT_ENVIRONMENT`, `PRODUCTION_ENABLED`,
`HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP`, `PRODUCTION_CDP_CREDENTIALS_APPROVED`)
are also missing from the host, and are deliberately absent by design
(`wrangler.paid-continuation-runtime.toml` comment, mirroring the public
Worker's own SUN-1205 checkpoint K stance).

Per §3's own rule ("If ANY additional unprovisioned requirement exists
outside the authorized five + exact three MODAL_WEBCTX values... STOP.
Do not expand the mutation scope automatically"), this checkpoint stops
here. **Zero deployment, zero instance, zero secret-file mutation
occurred.**

## Traced call path

`PaidContinuationWorkflow.run()` → `buildProductionPaidContinuationWorkflowDependencies`
(`production-dependencies.ts:157-249`) → for `web_context_verified.v2` →
`buildWebContextV2CdpProductionRouteConfig`
(`web-context-v2-cdp-composition.ts:159-249`), checked in this exact
order:

1. `db` present (line 164) — **present** (D1 binding confirmed live)
2. `PAID_RECEIPT_SIGNING_PRIVATE_KEY` present (line 167) — **present** (staged secret)
3. `PAID_RECEIPT_SIGNING_KEY_ID` present (line 170) — **present** (staged secret)
4. `MODAL_WEBCTX_ENDPOINT_URL` / `_PROXY_KEY` / `_PROXY_SECRET` all present
   (line 175-176) — **this is the exact check C1's real instance failed on**
5. `buildProductionSigner(...)` succeeds (line 182) — depends only on #2/#3, untested past this point
6. `resolveProductionAuthorizationInput(env)` (line 193) reads
   `PAYMENT_ENVIRONMENT`, `PRODUCTION_ENABLED`,
   `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP`,
   `PRODUCTION_CDP_CREDENTIALS_APPROVED` (`production-payment.ts:47-63`)
   and builds `ProductionAuthorizationInput`
7. `resolveProductionCdpEvidenceProvider(productionAuthorization, ...)`
   (line 204) — returns `evidenceMode !== 'production'` whenever
   `isProductionPaymentAuthorized(productionAuthorization)` is false,
   which it structurally must be with all four inputs unset/false — and
   the composition function then returns
   `{ unavailable: true, reason: 'production payment evidence unavailable
   and no explicit test evidence override was supplied' }` (line 229-234)

Steps 1-4 are already covered by the previously-authorized eight secrets.
Step 6/7 is the newly discovered gap: **even after adding the three Modal
secrets, the very next check in the same function would fail**, on a
class of dependency (plain vars, not secrets) this checkpoint's
authorization does not cover.

## COMPLETE_HOST_DEPENDENCY_MATRIX (before `open-envelope`)

| Name | Type | Required before open-envelope | Currently present | Source of requirement |
|---|---|---|---|---|
| `DB` | BINDING | YES | YES | `production-dependencies.ts:166` |
| `PAYMENT_CONTINUATION_ENCRYPTION_KEY` | SECRET | YES | YES (staged) | `production-dependencies.ts:169` |
| `PAID_RECEIPT_SIGNING_PRIVATE_KEY` | SECRET | YES | YES (staged) | `web-context-v2-cdp-composition.ts:167` |
| `PAID_RECEIPT_SIGNING_KEY_ID` | SECRET | YES | YES (staged) | `web-context-v2-cdp-composition.ts:170` |
| `MODAL_WEBCTX_ENDPOINT_URL` | SECRET | YES | NO | `web-context-v2-cdp-composition.ts:175` |
| `MODAL_WEBCTX_PROXY_KEY` | SECRET | YES | NO | `web-context-v2-cdp-composition.ts:175` |
| `MODAL_WEBCTX_PROXY_SECRET` | SECRET | YES | NO | `web-context-v2-cdp-composition.ts:175` |
| `PAYMENT_ENVIRONMENT` | VAR | YES (gates evidence mode) | **NO — deliberately absent** | `production-payment.ts:56`, consumed `web-context-v2-cdp-composition.ts:193` |
| `PRODUCTION_ENABLED` | VAR | YES (gates evidence mode) | **NO — deliberately absent** | same |
| `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP` | VAR | YES (gates evidence mode) | **NO — deliberately absent** | same |
| `PRODUCTION_CDP_CREDENTIALS_APPROVED` | VAR | YES (gates evidence mode) | **NO — deliberately absent** | same |
| `SELLER_WALLET_ADDRESS` | VAR | YES (feeds CDP evidence resolution) | YES (already in `[vars]`) | `web-context-v2-cdp-composition.ts:207,222` |
| `CDP_API_KEY_ID` | SECRET | YES | YES (staged) | `web-context-v2-cdp-composition.ts:208` |
| `CDP_API_KEY_SECRET` | SECRET | YES | YES (staged) | `web-context-v2-cdp-composition.ts:209` |

Dependencies required *after* `open-envelope` (executor invocation, PCC,
settlement, D1 persistence) were not traced further — this checkpoint
never reached that boundary, and per §4 of the authorization this is
provisioning/qualification, not architecture cleanup, so no refactor of
the check ordering was attempted or proposed.

## Why this is not a secret-set problem

`PAYMENT_ENVIRONMENT`, `PRODUCTION_ENABLED`,
`HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP`, `PRODUCTION_CDP_CREDENTIALS_APPROVED`
are typed `?: string` in `Env` (`config/env.ts:128,135,140,146`) and live
in `[vars]`, not as Cloudflare secrets — confirmed by the host's own
`wrangler.paid-continuation-runtime.toml`, which documents their absence
as **deliberate**, explicitly mirroring the public API Worker's own
frozen-candidate stance: "every consumer is fail-closed on absence...
[t]his exact bounded values it needs in its own reviewed
commit/version — never this file, never by default."

Setting these four to authorize real production CDP evidence resolution
on this host is a governance decision of the same class ADR 0055
describes ("every one must be independently, explicitly configured for a
specific action") — outside the scope of a value-recovery/provisioning
checkpoint and outside what this authorization's explicit "exact three
MODAL_WEBCTX_* values" boundary covers.

## Zero-mutation confirmation

No staged secret file was modified. No `wrangler` deploy, secret, or
trigger command was run against the host or the public API this
checkpoint. No Workflow instance was created. Public API production
(`de70bf98-f304-4d7f-b189-4ae2401041a0` @ 100%) and the host's prior state
(version `e4f01d0e-800b-41ee-8f44-37f3d25064bd`, Workflow version
`8f79c00c-b59c-48cd-8bf2-cfe876e9ed5d`, C1's failed instance
`9895a6ed-e265-413c-9b0c-1929bb6e7e31`) are all unchanged.

## Lineage

R1 implementation `4428528`, evidence `fe7efb5`. C1 evidence `701cf50`.

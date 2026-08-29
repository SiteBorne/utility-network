# SUN-1220Q1 — `/ready` Production-Truthfulness Root-Cause + Remediation Design

Design-only checkpoint. No source implementation, no D1 mutation, no Worker
upload, no deployment, no traffic shift, no live requests (unpaid or paid),
no signing, no settlement, no process termination. All findings below are
sourced from committed evidence and direct source inspection — no claim is
asserted without a file/line reference.

## 0. Evidence-integrity discipline

Every claim below follows: command → actual output → authoritative
read-back → narration. Read-only verification commands were actually run
against local tooling (`git`, `pnpm production:preflight`, `pnpm
secrets:scan`, `wrangler deployments list`, `ps aux`) — no live HTTP request
was sent to the Worker.

## 1. SUN-1220Q failure evidence reconciliation

```
$ git rev-parse 09a7862
09a7862ec2285629adbe04e7fae6ae400534d127
```

`SUN1220Q_FAILURE_EVIDENCE_COMMIT_SHA=09a7862ec2285629adbe04e7fae6ae400534d127`

From the committed Q report (`docs/reports/SUN-1220Q-first-paid-service-production-release.md`):

- Promotion of `8a1cdfe1-2e68-4dd9-b604-07dc3a666963` to 100% succeeded and
  was authoritatively read back (§ deployment list, version-only diff from
  known-good).
- Normal-routing candidate attribution, `/catalog`, `/services/<id>`, and
  agent-card truthfulness for `verify_agent_output.v2` all passed —
  consistent with P4/P5.
- `/ready` returned, verbatim, captured in the Q report:

```json
{
  "status": "not_ready",
  "phase": "foundation",
  "production_services_enabled": false,
  "blocked_external": ["cloudflare_account_configuration", "ionos_dns_migration",
    "seller_wallet", "cdp_credentials", "nevermined_credentials", "registry_publication"],
  "reason": "Service contracts and production dependencies are not yet verified. Only health/readiness endpoints available."
}
```

  captured under `cf-ray` `a327ad1a9f039da2`.

- `Q_READY_HTTP_STATUS=200`
- `Q_READY_STATUS=not_ready`
- `Q_READY_PRODUCTION_SERVICES_ENABLED=false`
- `Q_READY_BLOCKED_EXTERNAL=[cloudflare_account_configuration, ionos_dns_migration, seller_wallet, cdp_credentials, nevermined_credentials, registry_publication]`
- `Q_READY_OTHER_FIELDS=phase:"foundation", reason:"Service contracts and production dependencies are not yet verified. Only health/readiness endpoints available."`
- Rollback: `SUN1220Q_ROLLBACK=PASS` — read back, `GET /health` HTTP 200,
  `pnpm production:preflight` PASS.
- Live-window accounting: 6 tail-captured events, all discovery/health
  probes, `EXTERNAL_PAID_REQUESTS_OBSERVED=0`, fully observed (Q tail
  covered the entire window, not `UNPROVEN`).
- Q-owned tail process stopped by exact PID; 8 pre-existing, unrelated
  `wrangler tail` process trees were observed and explicitly left
  untouched — same disposition still current (§26 below).

This checkpoint's own re-read of the identical source that produced that
response (§3) confirms the captured JSON is not a paraphrase — it is a
byte-for-byte match of the hardcoded literal in `readiness.ts` (§3).

## 2. Current production reconciliation (read-only)

```
$ (apps/edge-api) npx wrangler deployments list
...
Created:     2026-08-29T01:11:58.336Z
Version(s):  (100%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
                 Created:  2026-08-22T07:06:16.667Z
                 Message:  SUN-1209 frozen candidate e5d061e2
```

The most recent deployment (`2026-08-29T01:11:58.336Z`, the Q rollback) is
the last entry in the list — single active version, 100% traffic, candidate
`8a1cdfe1-...` absent.

```
$ pnpm production:preflight
...
[production:preflight] PREFLIGHT RESULT: PASS
```

`CURRENT_PRODUCTION_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce`
`CURRENT_PRODUCTION_TRAFFIC=100%`
`ACTIVE_DEPLOYMENT_VERSION_COUNT=1`
`CURRENT_PRODUCTION_CONTAINMENT=PASS`

No live request of any kind was sent in this checkpoint (candidate or
known-good).

## 3. `/ready` dataflow, entrypoint to output

```
$ grep -n "ready" apps/edge-api/src/index.ts
78:app.route('/ready', readinessRoute);
```

The entire handler, [`apps/edge-api/src/routes/readiness.ts`](../../apps/edge-api/src/routes/readiness.ts):

```ts
readinessRoute.get('/', (c) => {
  const response = {
    status: 'not_ready' as const,
    phase: 'foundation',
    production_services_enabled: false,
    blocked_external: [
      'cloudflare_account_configuration',
      'ionos_dns_migration',
      'seller_wallet',
      'cdp_credentials',
      'nevermined_credentials',
      'registry_publication',
    ],
    reason:
      'Service contracts and production dependencies are not yet verified. Only health/readiness endpoints available.',
  };
  const validated = validateReadinessResponse(response);
  return c.json(validated);
});
```

This is a **fully literal, compile-time object**. The handler's Hono
context parameter `c` is never used to read `c.env` — no binding, no
variable, no D1 query, nothing runtime-derived reaches this function at
all. `validateReadinessResponse` (`packages/contracts/src/index.ts:126`)
only parses the literal against `ReadinessResponseSchema` — it does not
source any value.

```
READY_PIPELINE=apps/edge-api/src/index.ts:78 (app.route) → apps/edge-api/src/routes/readiness.ts:6 (readinessRoute.get('/')) → packages/contracts/src/index.ts:126 (validateReadinessResponse, pass-through validation only) → c.json(validated)
READY_STATUS_SOURCE=hardcoded literal (readiness.ts:8)
READY_PRODUCTION_SERVICES_ENABLED_SOURCE=hardcoded literal (readiness.ts:10)
READY_BLOCKED_EXTERNAL_SOURCE=hardcoded literal array (readiness.ts:11-18)
READY_USES_D1=NO
READY_USES_VERSION_LOCAL_ENV=NO
READY_USES_RUNTIME_PAID_ROUTE_GATES=NO
READY_HAS_HARDCODED_SNAPSHOT_DATA=YES
```

## 4. Input matrix for `/ready`'s fields (as currently implemented)

| Field | Category |
|---|---|
| `status` | `LEGACY_CHECKPOINT_SNAPSHOT` (compile-time literal, no input at all) |
| `phase` | `LEGACY_CHECKPOINT_SNAPSHOT` |
| `production_services_enabled` | `LEGACY_CHECKPOINT_SNAPSHOT` |
| `blocked_external` | `LEGACY_CHECKPOINT_SNAPSHOT` |
| `reason` | `LEGACY_CHECKPOINT_SNAPSHOT` |

`READY_INPUT_MATRIX`: every field is `STATIC_COMPILE_TIME` /
`LEGACY_CHECKPOINT_SNAPSHOT` — none is `D1_SHARED_STATE`,
`VERSION_LOCAL_ENV`, `RUNTIME_BINDING_CHECK`, `PROVIDER_HEALTH`, or
`SERVICE_RUNTIME_STATE`. There is no differentiation to preserve between
"known-good" and "qualified candidate" today: **every Worker version ever
built returns byte-identical `/ready` output**, because nothing in the
function is a function of anything version-local.

## 5. Intended `/ready` semantics — searched in priority order

- **schemas/types**: `ReadinessResponseSchema`
  (`packages/contracts/src/index.ts:37-44`) defines only shape/type
  constraints (`status: enum('ready'|'not_ready')`,
  `production_services_enabled: boolean`, `blocked_external: string[]`,
  `phase`/`reason`: `string`). It carries no semantic commitment about
  *what* `production_services_enabled` aggregates over. Its own test suite
  (`packages/contracts/src/contracts.test.ts:40-62`) explicitly accepts
  `status:'ready'`, `production_services_enabled:true`,
  `blocked_external:[]` as a fully valid shape — the schema was written to
  allow a truthful "ready" state; it just isn't produced anywhere yet.
- **ADRs**: none reference `/ready` (`grep -rn "/ready" docs/adr` returns
  no matches).
- **route tests**: none exist for `readiness.ts` — no file under
  `apps/edge-api/tests` or colocated with `routes/readiness.ts` exercises
  this route at all. `READY_ENDPOINT_SEMANTICS` has zero test-encoded
  contract.
- **worker-runtime tests**: `scripts/test-worker-runtime.mts` was grepped
  for `ready`/`readiness` — no match.
- **OpenAPI**: `catalog.ts:279-292` declares `/ready` → 200 →
  `$ref: '#/components/schemas/ReadinessResponse'`. No example values, no
  narrative description beyond `summary: 'Readiness check'`.
- **production-readiness docs**: none found under `docs/` referencing this
  route's intended contract by name.
- **release/checkpoint reports**: SUN-1220P1 is the only prior checkpoint
  that examined `/ready` (§6 below — and its conclusion is shown to rest on
  an incorrect premise).
- **comments**: `readiness.ts` itself carries no doc comment explaining
  intended semantics.

Given the total absence of a written contract beyond "shape it must match,"
and given §3's proof that today's implementation is a static snapshot with
no runtime input of any kind, the honest classification is:

```
READY_ENDPOINT_SEMANTICS=H (ambiguous — no repository authority commits to A–G; nearest textual signal is the "foundation"/"Only health/readiness endpoints available" wording, which reads as an early-project placeholder, not a deliberate ongoing contract)
READY_STATUS_SEMANTICS=undetermined by any written authority; textually suggests "overall platform bring-up phase," never updated past its initial value
PRODUCTION_SERVICES_ENABLED_SEMANTICS=undetermined by any written authority; name suggests "are production services enabled" in aggregate, but no code, test, or doc defines "aggregate" as ANY vs ALL
BLOCKED_EXTERNAL_SEMANTICS=undetermined by any written authority; the six items read as an early-project onboarding checklist (account setup, DNS, wallet, CDP/Nevermined credentials, registry publication), not a live-computed blocker list
CONTRACT_AMBIGUOUS=YES
```

This ambiguity matters for §14/§15 below: there is no contract to have
violated in a strict sense, but the field is *also* not contractually
committed to remaining a static launch-phase snapshot forever — nothing
forbids making it truthful, and its own schema already anticipates a true
"ready" state that has simply never been reached in code.

## 6. Why P1 did not change `/ready` — and why that reasoning does not hold up

`docs/reports/SUN-1220P1-public-discovery-truthfulness-design.md:120` states:

> `/ready` | `production_services_enabled` — distinct, aggregate field
> (`ControlPlaneConfig.productionEnabled`, itself `environment ===
> 'production'`, see §6) | n/a (different semantic) | n/a | **Runtime-local
> (`env.ENVIRONMENT`)**

and line 316: "`/ready` is a different, already-runtime-derived field and
is out of scope."

This is checked directly against source in this checkpoint:

```
$ grep -n "createControlPlaneConfig" apps/edge-api/src/index.ts apps/edge-api/src/control-plane/config/env.ts
apps/edge-api/src/index.ts:20:import type { ControlPlaneConfig } from './control-plane/config/env';
apps/edge-api/src/control-plane/config/env.ts:160:export function createControlPlaneConfig(env: Env): ControlPlaneConfig {
```

`index.ts` imports only the **type** `ControlPlaneConfig`, never the
function `createControlPlaneConfig` that would compute
`productionEnabled = environment === 'production'`. The codebase's own
prior investigation (`env.ts:191-196`, dated SUN-1205 checkpoint K) already
recorded this precisely:

> "This function (and its only caller, `createControlPlaneConfig`) has
> zero callers anywhere in the real request path — `index.ts` imports only
> the `Env`/`ControlPlaneConfig` *types* from this module, never the
> `createControlPlaneConfig` function."

And separately, `readiness.ts` (§3) never references `ControlPlaneConfig`,
`createControlPlaneConfig`, or `env.ENVIRONMENT` at all — it is a pure
literal. So P1's classification of `production_services_enabled` as
"Runtime-local (`env.ENVIRONMENT`)" describes a code path
(`createControlPlaneConfig`) that is **provably dead** and was never the
actual source of the field P1 was describing. P1's own §6 ("Runtime
activation authority, for comparison") never actually traced
`readiness.ts` — it traced `production-payment.ts`'s route-execution gates
and then, for the `/ready` row in its comparison table, appears to have
assumed the field's name implied a wiring that P1 did not verify against
`readiness.ts`'s literal source (the only place `production_services_enabled`
is actually serialized).

```
P2_READY_CHANGE_REQUIRED_DECISION=YES (a decision was recorded — "out of scope," "different semantic")
P2_READY_DECISION_REASON=INCORRECT — the stated basis ("already
runtime-derived via env.ENVIRONMENT") does not match `readiness.ts`'s
actual implementation, which is a fully static literal with zero env
input. The decision was not "accidentally omitted" (it was explicitly
considered) and not "ambiguous" (P1 stated a specific, checkable, and
false technical claim) — it was an unverified premise that this
checkpoint disproves against the literal handler source.
```

This does not mean P1/P2's actual delivered scope (`/catalog`,
`/services/<id>`, agent-card) was wrong to exclude `/ready` — it means the
*reason* given for exclusion was inaccurate, and the field was never
actually re-examined against its real source before being marked
out-of-scope.

## 7. Q's hard-gate interpretation

Q's report required `READY_RUNTIME_AVAILABILITY_CONTRADICTION=NO` and
treated `status=not_ready` + `production_services_enabled=false`, while a
live paid route was active and had already settled a real payment
(SUN-1220O), as a contradiction.

Given §5's finding that no repository authority commits `/ready` to a
narrower meaning than "reflect production reality," and given §6's finding
that the only prior authority on record (P1) rested on a false premise
rather than a deliberate narrower contract, Q's interpretation cannot be
shown to be a misapplication of an established narrower semantic — there
was no established narrower semantic to misapply. Q's plain reading (a
field literally named `production_services_enabled`, returning `false`,
while a production service is in fact enabled and economically executing)
is the natural reading of the field's own name, and nothing in the
codebase contradicts it.

```
Q_READY_HARD_GATE_WAS_SEMANTICALLY_CORRECT=YES
```

This rules out the "checkpoint-policy bug, not a Worker bug" branch (§14
Class B) as the primary classification — see §14.

## 8. `production_services_enabled` — intended rule

No code, test, schema, or doc defines this as "ALL production services"
vs. "ANY production service" vs. "global production mode." The only
textual signal is the field's own name (`production_services_enabled`,
plural) read against the one already-established precedent this
repository has for "is *a* production service active": P2's
`resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus`, which governs
exactly one service's effective discovery truth and was deliberately built
to answer "is *this* service's runtime-execution path currently
authorized," not "are all catalog services production-ready." Given
SITEBORNE currently has exactly one paid route with a real
production-activation path at all (`verify_agent_output.v2`/CDP — the
other 11 rows have no equivalent production-gate resolver implemented),
"ANY production service active" and "ALL production services active with a
real gate" are presently equivalent in practice, but not in principle —
which matters for §15's approach choice (an "ALL" reading would force
`/ready` to depend on 11 services that have no runtime gate to consult at
all, which is not implementable without inventing gates for services this
checkpoint has no authorization to touch).

```
PRODUCTION_SERVICES_ENABLED_INTENDED_RULE=UNDETERMINED by written authority; nearest coherent reading given existing code is "at least one catalog service is genuinely production-active" (ANY), because that is the only version of the question this codebase currently has an answer for
KNOWN_GOOD_EXPECTED_PRODUCTION_SERVICES_ENABLED=false (known-good's env has PAID_ROUTES_ENABLED/route flag/ADR-0055 gates off — confirmed by P4/P5's repeated "known-good-equivalent gates (all off)" test case, discovery-truthfulness.test.ts:126-132)
QUALIFIED_CANDIDATE_EXPECTED_PRODUCTION_SERVICES_ENABLED=true (candidate's env, once promoted with real production bindings/credentials, satisfies resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus — proven true at the exact moment Q captured the contradictory /ready response, since the real paid route was live)
CURRENT_IMPLEMENTATION_MATCHES_CONTRACT=NO (current implementation ignores env entirely; it cannot match any contract because it has no input)
```

## 9. `blocked_external` — blocker-by-blocker reconciliation

| Blocker | Source | Original reason | Currently true | Resolution evidence | Should appear now |
|---|---|---|---|---|---|
| `cloudflare_account_configuration` | hardcoded literal | Cloudflare account/Worker not yet configured | NO | Production Worker has been live and deploying since well before SUN-1220 (deployment history in §2 goes back to `f4f20676` created 2026-08-22; SUN-1207 M3 preflight and SUN-1209 frozen candidates predate this checkpoint) | NO |
| `ionos_dns_migration` | hardcoded literal | DNS not yet migrated to production domain | UNPROVEN — no DNS-status check exists in this repository's read-only tooling; this checkpoint has no authority to run a live DNS lookup or is not certain one would be conclusive without one | UNPROVEN (would need a dedicated DNS-status source, not fabricated here) | UNPROVEN |
| `seller_wallet` | hardcoded literal | Seller wallet not yet provisioned | NO | `checkProductionBindingsPresent` requires `SELLER_WALLET_ADDRESS`; `pnpm production:preflight` (§2, this checkpoint's own run) reports `PASS: required [vars] present -- SELLER_WALLET_ADDRESS, ...`; SUN-1220O's real paid settlement used this exact wallet as seller | NO |
| `cdp_credentials` | hardcoded literal | CDP API credentials not yet issued | NO | `checkProductionBindingsPresent` requires `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`; `production:preflight`'s "6 secret name(s)" / "all required real secret names are present" (§2 run, this checkpoint); SUN-1220O's real paid E2E used live CDP credentials to settle on Base mainnet | NO |
| `nevermined_credentials` | hardcoded literal | Nevermined integration not yet credentialed | UNPROVEN by this read-only checkpoint — `production:preflight`'s output (§2) does not enumerate Nevermined-specific bindings, and Q's own report records `NVM_ENVIRONMENT=sandbox` (Nevermined inactive by design, not by missing credentials) — this is a *different* fact than "blocked," so this checkpoint records it as `UNPROVEN` rather than asserting NO without direct evidence | UNPROVEN |
| `registry_publication` | hardcoded literal | Service not yet published to an external agent registry | UNPROVEN — no registry-publication check exists anywhere in this repository's tooling; this checkpoint has no evidence either way | UNPROVEN |

```
READY_BLOCKED_EXTERNAL_HAS_STALE_ITEMS=YES
STALE_BLOCKER_COUNT=3 (cloudflare_account_configuration, seller_wallet, cdp_credentials — proven resolved by direct evidence above)
VALID_CURRENT_BLOCKER_COUNT=0 proven; 3 UNPROVEN (ionos_dns_migration, nevermined_credentials, registry_publication — this checkpoint neither confirms nor denies these without a dedicated evidence source, and does not invent one)
```

## 10. Static snapshot vs. dynamic runtime

```
READY_IMPLEMENTATION_MODEL=STATIC_SNAPSHOT
READY_RUNTIME_DIVERGENCE_POINT=apps/edge-api/src/routes/readiness.ts:6-21 — the entire handler body. Every other production-truthfulness surface P2 touched (catalog.ts, card.ts) resolves at least one field through a version-local env-gate function at request time; readiness.ts resolves nothing at request time. The divergence is total, not partial: there is no point along the pipeline (§3) where runtime state could have entered and was dropped — it was simply never wired in from the route's inception.
```

## 11. Reuse of the P2 effective-discovery resolver

```
P2_EFFECTIVE_DISCOVERY_RESOLVER=resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus (apps/edge-api/src/control-plane/config/production-payment.ts:226-236)
P2_RUNTIME_AUTHORITY=production-verify-v2-cdp-route.ts → buildVerifyAgentOutputV2CdpProductionRouteConfig (the real route-activation path this resolver deliberately mirrors: two route flags via isVerifyAgentOutputV2CdpRouteFlagEnabled, all four ADR-0055 gates via isProductionPaymentAuthorized, receipt-signing key presence, and CDP/seller binding presence via checkProductionBindingsPresent — all synchronous, non-network checks, explicitly not a live CDP account lookup)
CAN_READY_REUSE_P2_EFFECTIVE_STATE=YES, for the one field that maps cleanly: "is verify_agent_output.v2/CDP genuinely production-active" is exactly what this resolver already answers, version-locally, with zero new code. It is the same function `/catalog` and `/services/verify_agent_output.v2` already call (catalog.ts:44-59), so reusing it for `/ready` introduces no new authority, no new D1 access, and no new drift risk between surfaces.
```

It cannot, by itself, resolve `blocked_external`'s three `UNPROVEN` items
(§9) — DNS migration, Nevermined credentialing, and registry publication
have no existing resolver anywhere in this codebase, because no runtime
gate today depends on any of them. Inventing checks for those three is out
of this checkpoint's scope (design-only, and speculative gate invention
was not requested) — §15 designs around this by only asserting a blocker
is resolved when direct evidence proves it (§9), and otherwise leaving it
as a to-be-revisited item rather than silently dropping or silently
re-asserting it.

## 12. Three separated concepts

```
A. PLATFORM READINESS       — "can the Worker process serve requests at all" — trivially YES on any deployed version; not meaningfully distinct from /health today, and no repository authority requires it to mean more.
B. SERVICE PRODUCTION AVAILABILITY — "is verify_agent_output.v2/CDP genuinely production-active on this exact Worker version" — answered version-locally by resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus (§11); false for known-good, true for a qualified+bound candidate.
C. EXTERNAL BLOCKERS         — the six-item onboarding checklist (§9); three provably resolved, three unproven by any existing repository tooling.
```

Candidate-state derivation (once promoted with real production bindings,
as at the moment Q captured its contradictory response):

```
PLATFORM_READY=true (Worker served the request, HTTP 200)
SELECTED_SERVICE_PRODUCTION_ACTIVE=true (proven by SUN-1220O's real settlement and by /catalog's truthful production_enabled=true at that same moment)
ANY_PRODUCTION_SERVICE_ACTIVE=true (same fact — verify_agent_output.v2 is the one service with a real gate, and it was active)
ALL_SERVICES_PRODUCTION_READY=false (the other 11 catalog rows have no production-activation path implemented at all — this remains true regardless of remediation choice, and is not something this checkpoint proposes changing)
UNRESOLVED_EXTERNAL_BLOCKERS=ionos_dns_migration, nevermined_credentials, registry_publication (UNPROVEN, carried forward, not asserted resolved)
```

These are not collapsible into one boolean without loss: `status`,
`production_services_enabled`, and `blocked_external` are three distinct
JSON fields already in the frozen schema (§16), and B ≠ D — a truthful
`/ready` for the current candidate state would show
`production_services_enabled=true` while `status` could reasonably remain
something other than a bare `'ready'` given `ALL_SERVICES_PRODUCTION_READY=false`
and three still-unproven blockers. This is exactly why the schema already
carries four independent fields rather than one.

## 13. Truth table

| Case | Description | `status` | `production_services_enabled` | `blocked_external` | selected-service discovery |
|---|---|---|---|---|---|
| A | known-good, selected route inactive | `not_ready` | `false` | 3 unproven items only (stale 3 removed) | `production_enabled=false` (unchanged, already truthful — P2) |
| B | qualified candidate, verify_agent_output.v2/CDP active, other 11 + Nevermined inactive | `not_ready` (ALL_SERVICES_PRODUCTION_READY still false) | `true` | 3 unproven items only | `production_enabled=true` (unchanged, already truthful — P2) |
| C | selected route master gate (`PAID_ROUTES_ENABLED`) false | `not_ready` | `false` | 3 unproven items only | `production_enabled=false` |
| D | selected route route-specific gate (`VERIFY_V2_CDP_ROUTE_ENABLED`) false | `not_ready` | `false` | 3 unproven items only | `production_enabled=false` |
| E | any ADR-0055 production gate missing | `not_ready` | `false` | 3 unproven items only | `production_enabled=false` |
| F | required binding missing (signing key or CDP/seller binding) | `not_ready` | `false` | 3 unproven items only | `production_enabled=false` |
| G | selected service active, unrelated future services still incomplete | `not_ready` (by ALL_SERVICES_PRODUCTION_READY) | `true` (by ANY_PRODUCTION_SERVICE_ACTIVE) | 3 unproven items only | `production_enabled=true` |
| H | actual external dependency failure (e.g. DNS genuinely unresolved) | `not_ready` | depends on B independently | includes the genuinely-failing item | unaffected — B is independent of external infra blockers |

`status` staying `not_ready` in cases B/G is a direct, deliberate
consequence of keeping `ALL_SERVICES_PRODUCTION_READY` distinct from
`ANY_PRODUCTION_SERVICE_ACTIVE` (§12) — it is not a design defect; it
reflects that 11 of 12 catalog services remain without a production path,
which is true today regardless of this checkpoint. What changes across the
table is only `production_services_enabled` (B/G) and the three
provably-resolved `blocked_external` entries (A–H, all rows).

## 14. Root-cause classification

Given:
- §5: no established narrower contract for `/ready` exists;
- §6: the one prior investigation that could have supplied one (P1) rested
  on a disproven premise;
- §7: Q's plain-name reading was not a misapplication of any actual
  established semantic;
- §3/§10: `/ready` is proven to be a total static snapshot with zero
  runtime input, of the exact same defect class P1/P2 fixed for
  `/catalog`/agent-card;
- §9: three of six `blocked_external` items are proven stale by direct
  evidence.

```
SUN1220Q1_ROOT_CAUSE_CLASS=A (REAL_READY_IMPLEMENTATION_BUG — /ready's plain-reading contract, the only one this repository's evidence supports, is that it should reflect production reality; it provably does not, because it is a hardcoded literal with no runtime input at all)
SUN1220Q1_ROOT_CAUSE_PROVEN=YES
```

Class B (Q's gate was wrong) is explicitly rejected — §7. Class C ("both")
is rejected because rejecting B leaves only A. Class D (ambiguous) is
rejected because, while the *narrow* semantic question in §5 is formally
ambiguous, the *operative* question — "does the current implementation
correctly reflect any coherent reading of production reality" — is
answered NO by direct proof (§3/§10), independent of which specific
reading among A–G (§5) is chosen.

## 15. Remediation architectures

| Approach | Schema compat | Known-good truthful | Candidate truthful | Version-local | Shared-state race risk | D1 mutation | API compat | Op complexity | Rollback behavior | New candidate needed |
|---|---|---|---|---|---|---|---|---|---|---|
| **A** — fully reuse P2's version-local resolver for the whole response, replacing `status`/`production_services_enabled` wholesale | Yes | Yes | Yes | Yes | None | No | Risk: collapses `status` into meaning only "is the one modeled service active," discarding the ALL_SERVICES_PRODUCTION_READY / external-blocker concepts (§12) — loses information the schema already supports | Low | Trivial (pure function) | Source change → yes |
| **B** — preserve `status`'s broader semantics where legitimate (`ALL_SERVICES_PRODUCTION_READY` / genuinely-modeled), make `production_services_enabled` and `blocked_external` version-local/truthful via the P2 resolver + direct blocker-evidence reconciliation (§9) | Yes | Yes | Yes | Yes | None | No | No | Low-Medium (one resolver call + a small blocker-evidence list, both pure) | Trivial | Source change → yes |
| **C** — separate platform readiness and production-service availability into new, additional fields, keep old fields as deprecated-but-present | Yes (additive) | Yes | Yes | Yes | None | No | No (additive only) | Medium (schema growth, dual-field maintenance) | Trivial | Source change → yes |
| **D** — fix only `blocked_external` staleness, leave `production_services_enabled` hardcoded `false` | Yes | Yes (unchanged) | **No** — candidate remains falsely `production_services_enabled=false` while economically active, i.e. Q's exact failure recurs unchanged | Partial | None | No | No | Low | Trivial | Source change → yes, but does not fix the actual Q failure |
| **E** — no Worker change; correct Q's gate instead | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a — **rejected by §7/§14: `/ready` was not contractually truthful, so Q's gate was not the bug** |
| **F** — evidence-backed alternative | — | — | — | — | — | — | — | — | — | — |

`Approach B` is preferred over `A` because it is the narrowest change that
fixes the proven defect (§14 Class A) without discarding the
schema-supported distinction between "this one service is active" and
"the platform is fully production-ready" (§12) that `A` would erase.
`Approach B` is preferred over `C` because nothing in §16 requires new
fields — the existing four fields already have room to be individually
truthful, and `C` adds maintenance surface (two parallel readiness
concepts) with no proven consumer need for the old fields' exact current
meaning to be preserved unchanged (§16 finds no external contract locking
their *values*, only their *shape*).

## 16. Backward compatibility

- OpenAPI (`catalog.ts:279-292`): references only
  `$ref: '#/components/schemas/ReadinessResponse'` — no baked-in example
  values, no narrative beyond "Readiness check."
- Contract test suite
  (`packages/contracts/src/contracts.test.ts:40-62`): asserts the schema
  accepts both a `not_ready`/`false` shape and a `ready`/`true` shape —
  the schema was written to allow a truthful transition, not to freeze
  today's values.
- No external client examples, no documentation, no other test anywhere in
  the repository asserts a *specific value* for `production_services_enabled`
  or the exact contents of `blocked_external` beyond the two literal test
  fixtures above (which exercise the schema's *shape*, not any client's
  expectation of the *current* values).

```
READY_RESPONSE_SCHEMA_FROZEN=YES (the five-field shape/types are the frozen wire contract — ReadinessResponseSchema)
READY_FIELD_REMOVAL_ALLOWED=NO (no field should be removed under Approach B — all five fields are kept, only their computed values change)
READY_FIELD_MEANING_CHANGE_ALLOWED=YES for production_services_enabled and blocked_external specifically — no repository or external authority commits their *values* to the current hardcoded set (§5), only their *shape* (§16 above); status/phase/reason meanings are preserved unchanged under Approach B
```

This confirms Approach B (§15) stays inside the additive/internally-
consistent preference §16's own governing rule requires.

## 17. Shared-state safety

```
READY_FIX_REQUIRES_D1_WRITE=NO
READY_FIX_REQUIRES_SHARED_MUTABLE_STATE=NO
```

`resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus` (§11) is a pure
function of version-local `env` bindings and a `hasDb` boolean already
passed in by the caller at request time (catalog.ts:98,114) — identical
pattern to how `/catalog` already safely differentiates known-good from
candidate without any shared mutable toggle. `blocked_external`'s
proposed correction (§9) is likewise computable from the same
version-local `env`/binding presence checks already used elsewhere
(`checkProductionBindingsPresent`), not from any new persisted state.
Because runtime activation differs by Worker version (P1 §7's
already-proven finding: a direct D1 write would falsely activate a
gated-off known-good version), version-local computation is not merely
preferred here — it is required, and is exactly what Approach B uses.

## 18. Recommended remediation

```
RECOMMENDED_REMEDIATION_APPROACH=B
RECOMMENDED_ARCHITECTURE=Keep readiness.ts's status/phase/reason literal launch-phase framing where it isn't yet disprovable by any version-local gate (no existing resolver answers ALL_SERVICES_PRODUCTION_READY, so status stays a narrative field rather than being invented a new meaning). Change production_services_enabled to call the existing resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus(env, hasDb) (production-payment.ts:226) -- the identical version-local call catalog.ts already makes -- so it reads true exactly when at least one modeled production service (today: verify_agent_output.v2/CDP) is genuinely active, false otherwise. Change blocked_external to drop the three items proven resolved by direct evidence in this report (cloudflare_account_configuration, seller_wallet, cdp_credentials) and retain the three UNPROVEN items (ionos_dns_migration, nevermined_credentials, registry_publication) unchanged, pending a dedicated evidence source for each -- do not invent new evidence for those three, and do not silently drop them without proof.
```

Required properties, all satisfied by Approach B:

- known-good remains truthful: `production_services_enabled=false`
  (resolver returns `false` — every gate off) — unchanged outcome from
  today, now for a proven reason instead of an accidental one.
- qualified candidate truthful:
  `production_services_enabled=true` once genuinely bound and gated on —
  fixes the exact Q failure.
- other 11 routes remain inactive: the resolver call is scoped to the one
  service P2 already scoped it to (`OVERLAY_SERVICE_ID` /
  `resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus` — no new
  resolver invented for the other 11).
- Nevermined unchanged: not touched by this design at all.
- runtime gates remain execution authority: the resolver is read-only and
  mirrors, never overrides, `production-verify-v2-cdp-route.ts`'s actual
  activation checks (§11) — identical non-mutation guarantee P2 already
  established for `/catalog`.
- no D1 race: §17.
- no payment/economic changes: no route execution, signing, or settlement
  code is touched — see §21.
- no buyer signing code touched.
- no shared mutable toggle: §17.
- no public-schema break unless proven necessary: §16 proves it is not
  necessary — shape is preserved, only two field *values* start being
  computed instead of literal.

## 19. TDD plan (RED tests to write before implementation)

Proposed file: `apps/edge-api/tests/readiness-truthfulness.test.ts`,
mirroring `discovery-truthfulness.test.ts`'s existing letter-case
convention (§ naming precedent: `A`–`U` in that file).

```
A. known-good-equivalent gates (all off) → /ready production_services_enabled=false
B. candidate-equivalent gates (4/4 ADR-0055 + route flags + bindings) → /ready production_services_enabled=true
C. selected route active, other 11 inactive → /ready reflects only the modeled service; other 11 rows have no /ready-visible representation (none exists today either)
D. selected route inactive (both flags true but gates off) → /ready production_services_enabled=false
E. master gate (PAID_ROUTES_ENABLED) false, all else true → production_services_enabled=false
F. route gate (VERIFY_V2_CDP_ROUTE_ENABLED) false, all else true → production_services_enabled=false
G. each individual ADR-0055 gate false in turn → production_services_enabled=false in every case
H. missing required binding (signing key, CDP key, seller wallet, each in turn) → production_services_enabled=false
I. blocked_external retains a currently-unproven item (e.g. ionos_dns_migration) unless/until a dedicated evidence source proves it resolved
J. blocked_external omits a historically-resolved item (cloudflare_account_configuration, seller_wallet, cdp_credentials) once the corresponding binding/preflight evidence is present
K. /ready and /catalog agree on "is verify_agent_output.v2/CDP active" for every gate permutation where their semantics overlap (both call the identical resolver)
L. /ready's status/phase/reason are allowed to differ from /catalog's per-service fields where their semantics are intentionally distinct (§12 — ALL_SERVICES_PRODUCTION_READY vs. per-service ANY)
M. a stale/drifted D1 row cannot override the version-local resolver's answer for production_services_enabled (mirrors N2 in discovery-truthfulness.test.ts)
N. no D1 write occurs while serving /ready under any gate state (mirrors R/S in discovery-truthfulness.test.ts)
O. /ready produces no effect on any route's actual execution eligibility (resolver call is read-only, mirrors production-verify-v2-cdp-route.ts's own checks without calling it)
P. /ready has no effect on price/network/asset/payTo — no economic field is present in or derived for this response at all
Q. other 11 paid routes' isolation: no new gate is invented for them; their absence from /ready's computed fields is unchanged from today
R. Nevermined isolation: NVM_ENVIRONMENT is not read by the proposed change; /ready's fields remain unaffected by Nevermined state
S. existing /ready schema compatibility: ReadinessResponseSchema.parse still succeeds for every case above (shape unchanged)
T. mutation-proof catches a reintroduced hardcoded false/true for production_services_enabled, and a reintroduced stale/dropped blocked_external entry (§20)
```

## 20. Mutation-proof design

```
PROPOSED_READY_TRUTHFULNESS_MUTATION_PROOF=
1. production_services_enabled hardcoded false  -> caught by test B (candidate-equivalent gates must read true)
2. production_services_enabled hardcoded true   -> caught by test A (known-good-equivalent gates must read false)
3. stale blocked_external entry retained         -> caught by test J (resolved items must be absent once evidence-backed)
4. valid blocker accidentally removed            -> caught by test I (unproven/still-valid items must remain present)
5. master gate ignored                           -> caught by test E
6. route gate ignored                            -> caught by test F
7. ADR gate ignored                               -> caught by test G (one sub-case per gate, mirroring discovery-truthfulness.test.ts's H)
8. missing binding ignored                        -> caught by test H
9. /ready incorrectly claims selected service unavailable when executable -> caught by test B
10. /ready incorrectly claims service available when route fail-closed    -> caught by tests D-H (each individually)
11. P2 discovery / readiness overlap divergence   -> caught by test K (cross-surface agreement, mirrors discovery-truthfulness.test.ts's U)
12. D1/static state overriding version-local truth -> caught by test M
13. economic metadata drift                       -> caught by test P (asserts /ready carries no economic field to drift in the first place)
```

## 21. Economic execution path — non-change requirement

```
ECONOMIC_EXECUTION_PATH_MUST_REMAIN_UNCHANGED=YES
```

Approach B touches only `apps/edge-api/src/routes/readiness.ts` (a
read-only GET handler with no economic fields) and adds one import of an
already-existing, already-read-only resolver
(`resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus`) that P2 already
proved does not mutate anything and does not perform network calls (§11's
own doc comment: "does NOT attempt a live CDP account lookup"). No file
under the route-execution path (`production-verify-v2-cdp-route.ts`,
x402 challenge construction, receipt signer, service executor, buyer
client) is touched by this design. Price (`0.019`), amount (`19000`),
network (`eip155:8453`), asset (Base USDC), `payTo`, signature
verification, and settlement logic are all outside this design's proposed
diff entirely.

## 22. Candidate / evidence consequences

Because the recommended fix is a source change to `readiness.ts` (Approach
B is not a zero-diff option — §15 shows only rejected Approach E would
avoid a Worker change, and §14 rules E out):

```
NEW_CANDIDATE_REQUIRED=YES
```

The historical real-payment evidence is unaffected by a discovery/readiness-
only change, since §21 proves the economic execution path is untouched:

```
HISTORICAL_REAL_PAID_E2E_REMAINS_VALID=YES (SUN-1220O's settlement proved the payment path itself works; that path is not touched by this design)
REAL_PAID_E2E_REPEAT_REQUIRED=NO (no economic code changes; repeating the real payment would prove nothing new)
NEW_ZERO_TRAFFIC_QUALIFICATION_REQUIRED=YES (per this checkpoint's own strong-default rule: any new Worker version gets fresh 0%-traffic qualification before any public exposure)
NEW_PUBLIC_CANARY_REQUIRED=YES (same rule — bounded public canary before another 100% promotion, following the P4→P5 pattern already established for the discovery-fixed candidate)
```

## 23. Q promotion authorization state

```
SUN1220Q_PREVIOUS_PROMOTION_AUTHORIZATION_CONSUMED=YES
SUN1220Q_SECOND_PROMOTION_AUTHORIZED=NO
```

Any future 100% promotion requires fresh, standalone human authorization —
this design checkpoint does not supply or imply one.

## 24. Stale wrangler tail processes (recorded only, not touched)

```
$ ps aux | grep -i "wrangler tail" | grep -v grep
meta4ickal  91559  ...  wrangler tail --format json   (started 7:18PM)
meta4ickal  74556  ...  wrangler tail --format json   (started 4:49PM)
meta4ickal  67007  ...  wrangler tail --format json   (started 3:34PM)
```

```
PREEXISTING_STALE_WRANGLER_TAIL_PROCESSES=YES
BACKGROUND_GLOBAL_TAIL_CLEANUP_PERFORMED=NO
```

This checkpoint owned no tail process (no live request of any kind was
made — §2), so there is no Q1-owned process to report stopping. The three
observed processes are unrelated pre-existing background state; cleanup is
left, as instructed, to an independent maintenance checkpoint.

## 25. Mutation accounting

```
SOURCE_RUNTIME_FILES_CHANGED=0
D1_WRITES=0
WORKER_VERSIONS_CREATED=0
DEPLOYMENTS=0
TRAFFIC_SHIFTS=0
LIVE_REQUESTS=0
LIVE_CANDIDATE_REQUESTS=0
LIVE_402_REQUESTS=0
LIVE_SIGN_TYPED_DATA_CALLS=0
PAYMENT_SIGNATURES_CREATED=0
LIVE_PAID_REQUESTS=0
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECTS=0
PROCESS_TERMINATIONS=0
```

Read-only commands actually executed this checkpoint: `git rev-parse`,
source inspection (`grep`/file reads), `pnpm production:preflight`,
`pnpm secrets:scan`, `npx wrangler deployments list` (read-only listing,
zero mutating Cloudflare API calls per its own preflight-equivalent
guarantee), `ps aux` (process listing only).

## 26. Secrets scan

```
$ pnpm secrets:scan
...
Finding: BASESCAN_TOKEN_CONTRACT (docs/reports/SUN-1220O-first-real-paid-e2e.md:159) -- same known public-contract-address heuristic match already disclosed in prior checkpoints (SUN-1220P/P5)
237 commits scanned. leaks found: 1.
```

`NEW_SECRET_FINDINGS=0` — the single finding is the same pre-existing,
already-disclosed public-address heuristic match, not new.

## 27. Final stop packet

```
SUN1220Q1_READY_REMEDIATION_DESIGN=COMPLETE

SUN1220Q_FAILURE_EVIDENCE_COMMIT_SHA=09a7862ec2285629adbe04e7fae6ae400534d127
SUN1220Q1_DESIGN_EVIDENCE_COMMIT_SHA=<set at commit time, below>

CURRENT_PRODUCTION_CONTAINMENT=PASS

READY_PIPELINE=apps/edge-api/src/index.ts:78 -> apps/edge-api/src/routes/readiness.ts:6 -> packages/contracts/src/index.ts:126 (validateReadinessResponse, pass-through only) -> c.json
READY_STATUS_SOURCE=hardcoded literal
READY_PRODUCTION_SERVICES_ENABLED_SOURCE=hardcoded literal
READY_BLOCKED_EXTERNAL_SOURCE=hardcoded literal array

READY_ENDPOINT_SEMANTICS=H (ambiguous by written authority; operative truthfulness question answered independently, see root cause)
READY_STATUS_SEMANTICS=undetermined by written authority
PRODUCTION_SERVICES_ENABLED_SEMANTICS=undetermined by written authority; nearest coherent reading is ANY_PRODUCTION_SERVICE_ACTIVE
BLOCKED_EXTERNAL_SEMANTICS=undetermined by written authority; reads as early-project onboarding checklist

READY_HAS_HARDCODED_SNAPSHOT_DATA=YES
READY_RUNTIME_DIVERGENCE_POINT=apps/edge-api/src/routes/readiness.ts:6-21 (entire handler body -- zero runtime input of any kind)

P2_READY_CHANGE_REQUIRED_DECISION=YES
P2_READY_DECISION_REASON=INCORRECT -- P1 claimed production_services_enabled was "Runtime-local (env.ENVIRONMENT)" via ControlPlaneConfig.productionEnabled, but createControlPlaneConfig has zero callers in the real request path (confirmed dead per SUN-1205 checkpoint K's own prior finding, env.ts:191-196) and readiness.ts never references it or any env value at all

Q_READY_HARD_GATE_WAS_SEMANTICALLY_CORRECT=YES

READY_BLOCKED_EXTERNAL_HAS_STALE_ITEMS=YES
STALE_BLOCKER_COUNT=3 (cloudflare_account_configuration, seller_wallet, cdp_credentials -- proven resolved)
VALID_CURRENT_BLOCKER_COUNT=0 proven; 3 UNPROVEN (ionos_dns_migration, nevermined_credentials, registry_publication)

SUN1220Q1_ROOT_CAUSE_CLASS=A
SUN1220Q1_ROOT_CAUSE_PROVEN=YES

P2_EFFECTIVE_DISCOVERY_RESOLVER=resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus (production-payment.ts:226-236)
CAN_READY_REUSE_P2_EFFECTIVE_STATE=YES (for production_services_enabled; not for the three unproven external blockers, which have no existing resolver)

RECOMMENDED_REMEDIATION_APPROACH=B
RECOMMENDED_ARCHITECTURE=version-local production_services_enabled via the existing P2 resolver; blocked_external corrected only for the 3 items proven resolved by direct evidence; status/phase/reason narrative framing preserved unchanged pending a real ALL_SERVICES_PRODUCTION_READY concept this checkpoint does not invent

READY_RESPONSE_SCHEMA_FROZEN=YES (shape only)
READY_FIELD_MEANING_CHANGE_ALLOWED=YES (for production_services_enabled and blocked_external values specifically; no repository or external authority commits their current values)

READY_FIX_REQUIRES_D1_WRITE=NO
READY_FIX_REQUIRES_SHARED_MUTABLE_STATE=NO

ECONOMIC_EXECUTION_PATH_MUST_REMAIN_UNCHANGED=YES

NEW_CANDIDATE_REQUIRED=YES
HISTORICAL_REAL_PAID_E2E_REMAINS_VALID=YES
REAL_PAID_E2E_REPEAT_REQUIRED=NO
NEW_ZERO_TRAFFIC_QUALIFICATION_REQUIRED=YES
NEW_PUBLIC_CANARY_REQUIRED=YES

SUN1220Q_PREVIOUS_PROMOTION_AUTHORIZATION_CONSUMED=YES
SUN1220Q_SECOND_PROMOTION_AUTHORIZED=NO

PROPOSED_FILES=apps/edge-api/src/routes/readiness.ts (modify); apps/edge-api/tests/readiness-truthfulness.test.ts (new)
PROPOSED_TEST_MATRIX=A-T, section 19 above
PROPOSED_READY_TRUTHFULNESS_MUTATION_PROOF=section 20 above

REMEDIATION_IMPLEMENTATION_ELIGIBLE=YES (design complete, root cause proven, narrowest-correct approach selected -- implementation itself requires a separate, freshly-authorized checkpoint per this checkpoint's own "do not implement" instruction)

NEW_SECRET_FINDINGS=0

SOURCE_RUNTIME_FILES_CHANGED=0
D1_WRITES=0
WORKER_VERSIONS_CREATED=0
DEPLOYMENTS=0
TRAFFIC_SHIFTS=0
LIVE_REQUESTS=0
LIVE_402_REQUESTS=0
LIVE_PAID_REQUESTS=0
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECTS=0
PROCESS_TERMINATIONS=0
```

**STOP.** No fix implemented. No candidate uploaded. No canary repeated.
No promotion performed.

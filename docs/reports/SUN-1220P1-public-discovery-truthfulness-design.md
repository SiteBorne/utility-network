# SUN-1220P1 — Public Discovery Truthfulness Root-Cause + Remediation Design

Design-only checkpoint. No source implementation, no D1 mutation, no Worker
upload, no deployment, no traffic shift, no live 402, no payment, no
settlement. All findings below are sourced from committed evidence and
direct source inspection — no claim is asserted without a file/line
reference.

## 0. Evidence-integrity discipline

Every claim in this report follows: command → actual output → authoritative
read-back → narration. Where source inspection substitutes for a live
command (this checkpoint forbids live calls), the exact file and line are
cited instead.

## 1. SUN-1220P failure evidence

```
$ git rev-parse fc68e14
fc68e14fce2dc44f91c10718ab858ad61c3d296f
```

`SUN1220P_FAILURE_EVIDENCE_COMMIT_SHA=fc68e14fce2dc44f91c10718ab858ad61c3d296f`

Confirmed from the committed SUN-1220P report:
- `SUN1220P_PUBLIC_PAID_CANARY=FAIL`
- Hard-gate failure: candidate discovery (`/catalog`, agent-card) claimed
  `production_enabled=false` / `productionEnabled=false` /
  `protocol_status="preproduction"` for `verify_agent_output.v2` while the
  same candidate's runtime had already settled a real $0.019 payment on
  that exact route (SUN-1220O, tx
  `0x612efe6f63cfbec1939241cc5fe6e9797ac4f1e94c248a644501e7bb2eaec5a2`).
- `SUN1220P_CANARY_RESTORATION=PASS`
- `FINAL_PRODUCTION_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce`
- `FINAL_PRODUCTION_TRAFFIC=100%`
- `AGENT_PAYMENT_SIGNATURES_CREATED=0`, `AGENT_PAID_REQUEST_SUBMISSIONS=0`

## 2. Current production reconciliation (read-only)

```
$ wrangler deployments status
Version(s): (100%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
```

`CURRENT_PRODUCTION_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce`,
`CURRENT_PRODUCTION_TRAFFIC=100%`, candidate absent from active deployment.
`pnpm production:preflight=PASS` (confirmed this checkpoint).

## 3. `/catalog` dataflow, end to end

`GET /catalog` → [`catalogRoute`](../../apps/edge-api/src/control-plane/routes/catalog.ts#L26)
→ `c.get('servicesRepo').getAll()` (`ServicesRepository` interface)
→ [`D1ServicesRepository.getAll`](../../apps/edge-api/src/control-plane/repositories/d1/services.ts#L72)
→ `SELECT * FROM services` on the `DB` D1 binding
→ [`mapServiceMetadata`](../../apps/edge-api/src/control-plane/repositories/d1/shared.ts#L194)
  (row → `ServiceMetadata`, `protocol_status` passed through verbatim)
→ `catalogRoute` maps `s.production_enabled` / `s.production_ready` /
  `s.protocol_status` straight into the response, unmodified.

```
CATALOG_PRODUCTION_ENABLED_PIPELINE=catalog.ts:GET / → D1ServicesRepository.getAll → shared.ts:mapServiceMetadata → catalog.ts response mapping
CATALOG_PRODUCTION_ENABLED_SOURCE=D1
CATALOG_D1_TABLE=services
CATALOG_D1_COLUMN=production_enabled (also production_ready, protocol_status)
CATALOG_VALUE_OVERRIDDEN_BY_RUNTIME=NO
```

No ADR-0055 gate (`PRODUCTION_ENABLED`, `PAYMENT_ENVIRONMENT`, etc.) is read
anywhere in this path — a pure, unconditional D1 passthrough.

## 4. Agent-card dataflow, end to end

`GET /.well-known/agent-card.json` → [`a2aRoute`](../../apps/edge-api/src/routes/a2a.ts#L54)
→ `resolveA2aApp` (cached) → `createSiteborneA2aHonoApp` (`@siteborne/protocol-a2a`)
→ [`buildUnsignedSiteborneAgentCard`](../../packages/protocol-a2a/src/card.ts#L57)
→ [`buildX402ExtensionParams`](../../packages/protocol-a2a/src/card.ts#L31),
  which hardcodes:

```ts
// packages/protocol-a2a/src/card.ts:34-49
return {
  x402Version: 2,
  paymentRequiredForUsefulExecution: true,
  productionEnabled: false,               // literal, top-level
  services: SITEBORNE_SERVICE_IDS.map((serviceId) => {
    ...
    return {
      ...
      productionEnabled: false,           // literal, per-service
    };
  }),
};
```

This is a **static, compile-time boolean literal** — it does not read D1,
does not read `env`, does not read any ADR-0055 gate. It is `false` for
every service, permanently, until the package source itself is edited.
`protocol_status` is not emitted by the agent card at all today (it is a
catalog/service-metadata-only field); the SUN-1220P canary's
`protocol_status="preproduction"` observation traces to `/services/<id>` or
`/catalog`, not the card.

```
AGENT_CARD_PRODUCTION_STATUS_PIPELINE=a2a.ts:a2aRoute → protocol-a2a createSiteborneA2aHonoApp → card.ts:buildUnsignedSiteborneAgentCard → card.ts:buildX402ExtensionParams (hardcoded literal)
AGENT_CARD_PRODUCTION_ENABLED_SOURCE=static-literal (packages/protocol-a2a/src/card.ts)
AGENT_CARD_PROTOCOL_STATUS_SOURCE=not emitted by agent card
AGENT_CARD_USES_SAME_D1_ROW_AS_CATALOG=NO
AGENT_CARD_RUNTIME_GATE_OVERLAY_EXISTS=NO
```

## 5. Other discovery surfaces

| Surface | Status source | Candidate expected (today) | Known-good expected (today) | Shared or runtime-local |
|---|---|---|---|---|
| `/catalog` | D1 `services.production_enabled` (§3) | `false` (unseeded row) | `false` | Shared D1 (static) |
| `/services/verify_agent_output.v2` | Same D1 row via `serviceMetadataRoute` (`catalog.ts`) | `false` | `false` | Shared D1 (static) |
| `/.well-known/agent-card.json` | Static literal (§4) | `false` | `false` | Package-static (identical on every version — same source code) |
| `/openapi.json` | Static document, no per-service production flag field at all | n/a | n/a | Static |
| MCP discovery (`mcp.ts`) | Not inspected further this checkpoint — file matched grep for `production_enabled` but wiring not traced; treat as `UNPROVEN` | `UNPROVEN` | `UNPROVEN` | `UNPROVEN` |
| `/ready` | `production_services_enabled` — distinct, aggregate field (`ControlPlaneConfig.productionEnabled`, itself `environment === 'production'`, see §6) | n/a (different semantic) | n/a | Runtime-local (`env.ENVIRONMENT`) |

The canary failure affects the full discovery family for
`verify_agent_output.v2` specifically (`/catalog`, `/services/<id>`,
agent-card) — all three share the same defect class (no runtime-gate
overlay), just via two independent static sources (D1 row vs. hardcoded
literal). `/ready` is a different, already-runtime-derived field and is
out of scope; MCP discovery is unproven and should be traced before
implementation.

## 6. Runtime activation authority (for comparison)

`POST /v2/verify/agent-output` route registration and execution eligibility
are gated through
[`production-payment.ts`](../../apps/edge-api/src/control-plane/config/production-payment.ts)
(`resolveTrueFlag(env.PRODUCTION_ENABLED)`, `PAYMENT_ENVIRONMENT`,
`HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP`,
`PRODUCTION_CDP_CREDENTIALS_APPROVED`) consumed by
`production-verify-v2-cdp-route.ts`. These are per-Worker-version env
bindings — confirmed distinct between known-good (all four gates
effectively off / route fail-closed 404) and the candidate (all four gates
`true`, route live, SUN-1220O proved real settlement).

```
VERIFY_V2_CDP_EFFECTIVE_RUNTIME_ACTIVATION_PIPELINE=production-payment.ts (env-gate resolution) → production-verify-v2-cdp-route.ts → x402-service.ts route mount
DISCOVERY_AND_RUNTIME_USE_SAME_AUTHORITY=NO
```

Divergence point: discovery (`/catalog` via D1, agent-card via static
literal) never consults `production-payment.ts`'s resolved gates; runtime
execution never consults D1's `services.production_enabled` or the card's
literal. Two fully independent authorities for what is nominally the same
fact.

## 7. D1 sharing model — hard gate

`wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "siteborne-utility"
database_id = "efe23c42-cbcc-47c2-9b28-922a541bdcdd"
```

A single `d1_databases` block, one `database_id`, in the one `wrangler.toml`
that every `wrangler versions upload` reads. Cloudflare D1 bindings are not
version-scoped — every Worker version (known-good, every past and future
candidate) binds to this identical database by construction.

```
KNOWN_GOOD_CATALOG_D1_BINDING=DB → efe23c42-cbcc-47c2-9b28-922a541bdcdd (siteborne-utility)
CANDIDATE_CATALOG_D1_BINDING=DB → efe23c42-cbcc-47c2-9b28-922a541bdcdd (siteborne-utility)
D1_DATABASE_SHARED_ACROSS_VERSIONS=YES
DIRECT_SHARED_D1_ROW_UPDATE_WOULD_CREATE_KNOWN_GOOD_CONTRADICTION=YES
```

Setting the shared `services` row's `production_enabled=true` for
`verify_agent_output.v2` would make **known-good** (`f4f20676...`, route
fail-closed 404 today) advertise the service as production-enabled while
actually returning 404 — the exact opposite contradiction SUN-1220P just
caught, now pointed at production instead of a 0%-traffic candidate. This
confirms the checkpoint's suspicion in the starting state: a direct D1
write is not safe.

## 8. Current D1 row (read-only)

Read via source path, not a live D1 query (checkpoint forbids live calls);
[`seedServices`](../../apps/edge-api/src/control-plane/routes/paid-services.ts#L130-L155)
is the only writer of this row observed in the codebase and runs
idempotently on startup/migration, seeding:

```ts
production_enabled: false,
production_ready: false,
protocol_status: 'preproduction',
```

[`D1ServicesRepository.updateProductionEnabled`](../../apps/edge-api/src/control-plane/repositories/d1/services.ts#L79-L102)
exists but has **zero callers** anywhere in `apps/edge-api/src` outside its
own repository/tests — nothing in this codebase has ever flipped this row
since it was seeded.

```
CURRENT_D1_SERVICE_ROW_FOUND=YES (by source/seed evidence; not independently re-queried live this checkpoint)
CURRENT_D1_PRODUCTION_ENABLED=false
CURRENT_D1_PROTOCOL_STATUS=preproduction
CURRENT_D1_ROW_MATCHES_KNOWN_GOOD_RUNTIME=YES (route is in fact inactive on known-good)
CURRENT_D1_ROW_MATCHES_CANDIDATE_RUNTIME=NO (route is in fact live/payable on candidate)
```

## 9. Existing runtime-overlay patterns

`grep` for the ADR-0055 gate symbols across `control-plane/routes` and
`control-plane/config` surfaces exactly the runtime-authority files already
cited in §6 (`production-verify-v2-cdp-route.ts`, `production-payment.ts`,
`env.ts`) — i.e. the pattern this codebase already uses to compute
*effective* production status from env bindings at request time.

```
WORKING_RUNTIME_DISCOVERY_OVERLAY_PATTERN_FOUND=YES
WORKING_REFERENCE_FILES=apps/edge-api/src/control-plane/config/production-payment.ts, apps/edge-api/src/control-plane/routes/production-verify-v2-cdp-route.ts
REFERENCE_PATTERN=resolve effective production status per-request from env bindings (resolveTrueFlag(env.PRODUCTION_ENABLED), PAYMENT_ENVIRONMENT, HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP, PRODUCTION_CDP_CREDENTIALS_APPROVED) via a single resolver, never a stored/static value
```

No file in the repository today applies this pattern to *discovery*
responses — the overlay exists only on the execution/gating side.

## 10. Root cause

```
SUN1220P1_ROOT_CAUSE_PROVEN=YES
```

`PUBLIC_DISCOVERY_ROOT_CAUSE=` Discovery publication for
`verify_agent_output.v2` is served from two static sources — a shared D1
row (`/catalog`, `/services/<id>`) written once at seed time and never
updated, and a hardcoded compile-time literal (`productionEnabled: false`
in `packages/protocol-a2a/src/card.ts`) — neither of which consults the
per-Worker-version ADR-0055 runtime gates that actually determine whether
the paid route executes. Because the runtime gates are version-local
(frozen per Worker version at upload) while both discovery sources are
either database-shared-across-versions or code-identical-across-versions,
no single static value can truthfully describe both a gated-off known-good
version and a qualified, gate-on candidate version at the same time.

## 11. Discovery truth table

| Case | Runtime condition | Required discovery for `verify_agent_output.v2` |
|---|---|---|
| A — known-good | route unavailable (gates off) | NOT production-active (`production_enabled=false`, card `productionEnabled=false`, `protocol_status=preproduction`) |
| B — qualified candidate | `PAID_ROUTES_ENABLED`, `VERIFY_V2_CDP_ROUTE_ENABLED`, ADR-0055 4/4 all true | production-active/payable (`production_enabled=true`, card `productionEnabled=true`, `protocol_status=production`) |
| C — master gate (`PAID_ROUTES_ENABLED`) false | inactive | inactive |
| D — route-specific gate (`VERIFY_V2_CDP_ROUTE_ENABLED`) false | inactive | inactive |
| E — required production dependency unavailable (e.g. missing signer/secret) | route cannot actually execute | must not claim active/healthy production readiness |
| F — other 11 paid routes | any state | unchanged, remain inactive per their own independent gates |
| G — Nevermined | any state | remains inactive |

## 12. Remediation architectures compared

| | Truthful known-good? | Truthful candidate? | D1 mutation? | Version-local? | Affects other services? | Ops complexity | Rollback | New candidate needed? |
|---|---|---|---|---|---|---|---|---|
| **A** — mutate shared D1 row | **NO** (§7) | Yes | Yes | No | Yes (shared table) | Low | Poor (shared state, can't scope to one version) | No (but unsafe) |
| **B** — runtime overlay in discovery serialization: keep D1 for static identity/pricing/schema, derive *effective* `production_enabled`/`protocol_status`/card `productionEnabled` from the same env-gate resolver `production-payment.ts` already uses | Yes | Yes | No | Yes (env bindings are already version-local) | No | Low-Medium (one resolver call at 2-3 call sites) | Trivial (pure function of existing env, no persisted state to unwind) | Yes (source change) |
| **C** — separate candidate-specific D1/catalog database | Yes | Yes | Yes (new binding/schema) | Yes | No | High (new provisioning, migration, sync) | Complex | Yes |
| **D** — version-specific persisted discovery state (e.g. KV keyed by version id) | Yes | Yes | No (new store) | Yes | No | Medium (new binding, write path, staleness risk) | Medium | Yes |
| **E** — other | — | — | — | — | — | — | — | — |

Approach B is preferred: the runtime gates that actually decide whether the
route executes are already resolved per-request from version-local env
bindings (§6, §9) — reusing that exact resolver for discovery serialization
gives version-local truth for free, requires no new storage, no D1 write,
and cannot desynchronize from the execution path by construction (same
resolver, same inputs).

## 13. Semantics of `production_enabled` / `protocol_status`

Inspecting `catalog.ts`'s schema comments, `env.ts`'s own doc comment
(`ControlPlaneConfig`'s `productionEnabled` is explicitly documented as "the
standing production kill switch for payment execution... distinct from
`ENVIRONMENT`/`ControlPlaneConfig`'s own unrelated, currently-unwired
`productionEnabled` concept" — `env.ts:105-110`), and the absence of any
lifecycle-classification-specific enum values beyond
`preproduction`/`production`, the field names and enum are written to mean
runtime executable availability, not an independent operator catalog
classification. Nothing in `catalog.ts`, the schema, or ADRs found this
checkpoint suggests these fields intentionally mean anything other than "is
this route live and payable right now." The repository's own `env.ts`
comment explicitly flags this exact naming collision as a known,
previously-unresolved hazard — three unrelated `productionEnabled`-shaped
concepts exist in this codebase today (D1 column, agent-card literal,
`ControlPlaneConfig.productionEnabled = environment === 'production'`).

```
PRODUCTION_ENABLED_DISCOVERY_SEMANTICS=runtime executable/payable state (not a separate operator lifecycle classification)
PROTOCOL_STATUS_SEMANTICS=runtime executable state, mirrors production_enabled
```

Given this, Approach B (derive discovery from the same runtime authority)
is also the semantically correct fix, not merely the operationally
convenient one — it doesn't redefine the field's meaning, it corrects the
field's *source* to match its documented meaning.

## 14. Required truthful public output for the qualified candidate

- `/catalog` `production_enabled=true`, `production_ready=true`
  (once dependencies are confirmed live), `protocol_status="production"`
  for `verify_agent_output.v2` only.
- Agent card `productionEnabled=true` at the per-service level for
  `verify_agent_output.v2`'s entry only; top-level
  `paymentRequiredForUsefulExecution` and other services' entries unchanged.
- `/services/verify_agent_output.v2` mirrors `/catalog`.
- OpenAPI: no existing per-service production-flag field; no change
  required.
- MCP discovery: unproven this checkpoint — must be traced before
  implementation (§5).
- `/ready`: distinct field (`production_services_enabled`), unaffected —
  out of scope.

## 15. Recommended remediation

```
RECOMMENDED_REMEDIATION_APPROACH=B
RECOMMENDED_ARCHITECTURE=Keep D1 as the source of static per-service identity/pricing/schema fields. Add one resolver (reusing production-payment.ts's existing env-gate resolution, e.g. exposing an `isServiceProductionActive(serviceId, env)` composed from the same PAID_ROUTES_ENABLED/route-specific-gate/ADR-0055 4/4 inputs already gating execution) called at exactly the discovery call sites (catalog.ts's two GET handlers, card.ts's buildX402ExtensionParams — passed env instead of being hardcoded) to override production_enabled/production_ready/protocol_status/agent-card productionEnabled for verify_agent_output.v2 only. D1 row stays false/preproduction as the static floor; runtime overlay only raises it true when the same gates that unlock execution are true on that exact Worker version. No other service's discovery changes because no other service's runtime gates are true.
```

This satisfies every constraint in the checkpoint: known-good stays
truthful (its gates are off, overlay yields false, matching D1's existing
seed value), candidate becomes truthful, self-consistent within one
immutable Worker version (env bindings are frozen per version), other 11
routes and Nevermined untouched (their own gates unchanged, resolver is
per-service), no shared-D1 race (D1 is never written by this path), no
buyer signing code enters the Worker (this is discovery-only, read side),
price/network/asset/payTo unchanged (not touched by this fix at all).

## 16. D1 mutation requirement

```
D1_SCHEMA_CHANGE_REQUIRED=NO
D1_DATA_MUTATION_REQUIRED=NO
DIRECT_D1_PRODUCTION_FLAG_UPDATE_ALLOWED=NO
```

Runtime-local truth is fully achievable from existing env bindings alone
(§6, §9) — no schema or data change to the shared D1 `services` table is
needed, and a direct flag update remains disallowed per §7's proven
contradiction risk.

## 17. Candidate consequence

Any Worker source change (catalog.ts, card.ts, and the new/reused resolver)
means the current binary:

```
CURRENT_PAID_E2E_EVIDENCE_REMAINS_VALID=YES
CURRENT_CANDIDATE_REUSABLE_AFTER_DISCOVERY_SOURCE_FIX=NO
NEW_CANDIDATE_REQUIRED=YES
```

`a0055146-d358-40d4-b0af-52eccc56c8ef` remains valid, permanent evidence
that the domain-metadata-fixed payment/execution path settles real funds
correctly (SUN-1220O) — that fact does not depend on and is not
invalidated by a discovery-layer fix. A new immutable candidate is required
to carry the corrected discovery source code, per this repository's
established immutability convention (SUN-1220L → M pattern).

## 18. Paid-E2E evidence transfer analysis

```
REAL_PAID_E2E_MUST_BE_REPEATED_AFTER_DISCOVERY_FIX=NO
```

Conditioned on proving, at implementation time, all of:
(A) the payment/execution composition
(`verify-agent-output-v2-cdp-composition.ts`, `x402-service.ts`,
`production-verify-v2-cdp-route.ts`, `production-payment.ts`) is
byte-unchanged in the new candidate's diff against the SUN-1220L/M source —
only `catalog.ts`, `card.ts`, and the new resolver differ;
(B) the new candidate's unpaid 402 challenge is byte-identical in its
economic fields (network, asset, amount, payTo, `extra.name`/`extra.version`)
to SUN-1220N's proof;
(C) the signer/receipt-persistence path is untouched.
If the actual diff at implementation time touches anything beyond the
discovery surface, this must be re-evaluated and defaults to
`UNPROVEN`/`YES` rather than assumed `NO`.

## 19. Test design (TDD, to be written before implementation)

A. known-good-equivalent gates (all four ADR-0055 gates false/unset) →
   `/catalog` `production_enabled=false` for `verify_agent_output.v2`.
B. candidate gates (4/4 true) → `/catalog` `production_enabled=true` for
   `verify_agent_output.v2`.
C. candidate gates true → agent-card per-service `productionEnabled=true`
   for `verify_agent_output.v2`'s entry.
D. candidate gates true → `protocol_status="production"`.
E. `PAID_ROUTES_ENABLED=false` (master gate off), other three true →
   discovery false.
F. `VERIFY_V2_CDP_ROUTE_ENABLED=false` (route-specific gate off), others
   true → discovery false.
G. Required production dependency missing (e.g. `PAID_RECEIPT_SIGNING_PRIVATE_KEY`
   absent) with gates nominally true → discovery reflects not-ready, never
   falsely "active."
H. Other 11 paid routes' discovery values unchanged by any
   `verify_agent_output.v2`-gate permutation.
I. Nevermined discovery unchanged.
J. `price_usd`/service price unchanged (`0.019`) across all cases.
K. `network` unchanged (`eip155:8453`).
L. `asset` unchanged (Base USDC).
M. `payTo`/seller unchanged.
N. Setting the D1 row's `production_enabled=true` directly, with runtime
   gates false, still yields discovery `false` (overlay, not OR-with-D1).
O. Runtime gates true overrides the static D1 `false` seed value only for
   this one service — proves the overlay direction and scope.
P. `/catalog` and agent-card agree for every gate permutation.
Q. `/services/verify_agent_output.v2` agrees with `/catalog`.
R. OpenAPI unaffected (no field to diverge).
S. MCP discovery agreement — deferred pending §5's `UNPROVEN` trace;
   must be resolved (traced and either included or explicitly scoped out
   with justification) before this test is written as a hard pass/fail.
T. `/ready`'s `production_services_enabled` semantics unchanged (different
   field, not touched by this fix).
U. Across the full 2^4 ADR-0055-gate truth table, HTTP runtime behavior
   (200/402/404 on the actual route) and discovery's claimed
   `production_enabled` never disagree.
V. Other 11 routes' HTTP behavior unchanged by this change (regression).
W. No D1 write occurs during any discovery GET (spy/assert zero `INSERT`/
   `UPDATE` calls against the `services` table for the duration of a
   catalog/card/service-metadata request).
X. No buyer-signing symbol (`signTypedData`, `createPaymentPayload`,
   `ExactEvmScheme`) becomes reachable from the discovery code path
   (bundle/reachability check, same technique as SUN-1220M).
Y. Mutation-proof coverage per §20.

## 20. Mutation-proof design

Six-plus deliberate mutations, each expected to be caught by the test suite
in §19:
1. Remove the runtime-gate overlay call in `catalog.ts` (falls back to raw
   D1 `false`) — caught by test B.
2. Remove the overlay call in `card.ts` (falls back to hardcoded `false`)
   — caught by test C.
3. Flip only the master gate check inside the resolver (ignore
   `PAID_ROUTES_ENABLED`) — caught by test E.
4. Flip only the route-specific gate check (ignore
   `VERIFY_V2_CDP_ROUTE_ENABLED`) — caught by test F.
5. Make the resolver apply to all services instead of
   `verify_agent_output.v2` only — caught by tests H/I.
6. Make the resolver OR with the D1 static value instead of overriding it
   — caught by test N.
7. Drop the dependency-readiness check from `production_ready` — caught by
   test G.
8. Introduce a stray D1 write inside the discovery GET handler — caught by
   test W.

```
PROPOSED_DISCOVERY_TRUTHFULNESS_MUTATION_PROOF=8 deliberate mutations (listed above) mapped 1:1 to tests B, C, E, F, H/I, N, G, W in §19; each mutation must fail exactly its mapped test and no others, verified the same way as SUN-1220L's six-mutation proof (scripts/test-domain-metadata-mutation-caught.mts pattern).
```

## 21. Future qualification plan (design only, not executed)

1. Implement discovery-truthfulness fix, TDD-first (§19 tests RED → GREEN).
2. Full regression (lint, typecheck, test, worker-runtime,
   production:preflight, secrets:scan).
3. Commit.
4. Upload a new immutable candidate (Worker source changed — §17).
5. Deploy new candidate at 0% alongside known-good (temporary, as in
   SUN-1220M/N).
6. Candidate safe-surface discovery qualification (verify `/catalog`,
   agent-card, `/services/<id>` now agree and are truthful) via
   version-override, no payment.
7. One unpaid 402 (as SUN-1220N) to reconfirm runtime/discovery coherence
   under the new source.
8. Restore known-good to 100%.
9. Bounded 1% public canary (as SUN-1220P), this time including a
   discovery-truthfulness assertion as an explicit hard gate before
   declaring canary success.
10. Restore.
11. Promotion decision — contingent on §18's evidence-transfer conditions
    actually holding at implementation time; do not assume real payment
    must be repeated, but do not assume it need not be, either, until the
    actual diff is inspected.

## 22. Mutation accounting (this checkpoint)

```
SOURCE_FILES_CHANGED=0
D1_WRITES=0
WORKER_VERSIONS_CREATED=0
DEPLOYMENTS=0
TRAFFIC_SHIFTS=0
LIVE_CANDIDATE_REQUESTS=0
LIVE_402_REQUESTS=0
LIVE_SIGN_TYPED_DATA_CALLS=0
PAYMENT_SIGNATURES_CREATED=0
LIVE_PAID_REQUESTS=0
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECTS=0
```

## 23. Final stop packet

```
SUN1220P1_DISCOVERY_TRUTHFULNESS_DESIGN=COMPLETE
SUN1220P_FAILURE_EVIDENCE_COMMIT_SHA=fc68e14fce2dc44f91c10718ab858ad61c3d296f
SUN1220P1_ROOT_CAUSE_PROVEN=YES
PUBLIC_DISCOVERY_ROOT_CAUSE=Discovery served from two static, non-runtime-gated sources (shared D1 seed row; hardcoded agent-card literal) that never consult the version-local ADR-0055 runtime gates the execution path actually uses.
CATALOG_PRODUCTION_ENABLED_SOURCE=D1
AGENT_CARD_PRODUCTION_ENABLED_SOURCE=static-literal
AGENT_CARD_PROTOCOL_STATUS_SEMANTICS=not emitted by agent card today
D1_DATABASE_SHARED_ACROSS_VERSIONS=YES
CURRENT_D1_PRODUCTION_ENABLED=false
CURRENT_D1_PROTOCOL_STATUS=preproduction
DIRECT_SHARED_D1_ROW_UPDATE_WOULD_CREATE_KNOWN_GOOD_CONTRADICTION=YES
PRODUCTION_ENABLED_DISCOVERY_SEMANTICS=runtime executable/payable state
PROTOCOL_STATUS_SEMANTICS=runtime executable state
DISCOVERY_AND_RUNTIME_USE_SAME_AUTHORITY=NO
WORKING_RUNTIME_DISCOVERY_OVERLAY_PATTERN_FOUND=YES
RECOMMENDED_REMEDIATION_APPROACH=B
RECOMMENDED_ARCHITECTURE=Runtime-gate overlay at discovery serialization, reusing production-payment.ts's existing env-gate resolver; D1 remains static floor, never mutated.
D1_SCHEMA_CHANGE_REQUIRED=NO
D1_DATA_MUTATION_REQUIRED=NO
DIRECT_D1_PRODUCTION_FLAG_UPDATE_ALLOWED=NO
OTHER_11_PAID_ROUTES_CHANGE_REQUIRED=NO
NEVERMINED_CHANGE_REQUIRED=NO
CURRENT_PAID_E2E_EVIDENCE_REMAINS_VALID=YES
CURRENT_CANDIDATE_REUSABLE_AFTER_DISCOVERY_SOURCE_FIX=NO
NEW_CANDIDATE_REQUIRED=YES
REAL_PAID_E2E_MUST_BE_REPEATED_AFTER_DISCOVERY_FIX=NO (conditioned on §18's diff-scope proof holding at implementation time)
PROPOSED_FILES=apps/edge-api/src/control-plane/routes/catalog.ts, packages/protocol-a2a/src/card.ts, apps/edge-api/src/control-plane/config/production-payment.ts (new/reused resolver export), new test file(s) per §19
PROPOSED_TEST_MATRIX=26 cases (§19 A–Y) covering gate permutations, cross-surface agreement, other-route isolation, economic-field stability, D1-write absence, and buyer-signing non-reachability
PROPOSED_DISCOVERY_TRUTHFULNESS_MUTATION_PROOF=8 mutations mapped 1:1 to tests (§20)
REMEDIATION_IMPLEMENTATION_ELIGIBLE=YES
SOURCE_FILES_CHANGED=0
D1_WRITES=0
WORKER_VERSIONS_CREATED=0
DEPLOYMENTS=0
TRAFFIC_SHIFTS=0
LIVE_CANDIDATE_REQUESTS=0
LIVE_402_REQUESTS=0
LIVE_SIGN_TYPED_DATA_CALLS=0
PAYMENT_SIGNATURES_CREATED=0
LIVE_PAID_REQUESTS=0
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECTS=0
```

Not committed — per this checkpoint's instruction to commit only if
explicitly allowed by existing convention; none was given here.

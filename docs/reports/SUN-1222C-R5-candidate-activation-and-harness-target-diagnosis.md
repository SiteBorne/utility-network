# SUN-1222C-R5: Candidate Activation + Qualification-Target Diagnosis

**Checkpoint class:** read-only diagnosis only. Zero deploys, zero mutations, zero
payment material, zero economic effect.

## 0. Zero-economic-effect proof

The triggering attempt (previous turn) stopped at `PRE_CHALLENGE` with
`failure_reason: "expected HTTP 402, got 404"`:

```
challenge_received=false, challenge_validated=false, payment_material_created=false,
paid_request_submitted=false, http_status=404
```

No 402, no EIP-3009 authorization, no nonce, no signature, no paid POST, no
facilitator `.verify()`/`.settle()` call, no chain transaction. This diagnosis
performed zero further mutations: all commands below are `GET`/list/view/read-only.

`LATEST_ATTEMPT_CLASS = PRE_CHALLENGE_ROUTE_FAILURE_ZERO_ECONOMIC_EFFECT`

## 1–2. Authoritative deployment state

```
CURRENT_PRODUCTION_VERSION  = db7054c9-76ee-4830-aabe-8a4542261b6a
CURRENT_PRODUCTION_TRAFFIC  = 100%
CURRENT_CANDIDATE_VERSION   = ade29047-9028-4f2a-873d-ea3c24e0b2ab
CURRENT_CANDIDATE_TRAFFIC   = 0%
ACTIVE_VERSION_COUNT        = 2 (no third version)
SUPERSEDED_A064_VERSION     = a064477f-7b74-46c5-a5b6-799df114b252 (fully superseded,
                               0% traffic before R4-deployment-retry replaced it)
ADE29047_STATUS              = UPLOADED_AND_ACTIVE_AT_0_PERCENT
```

## 3–4. Direct verification + known-good control (the decisive evidence)

`wrangler versions view` for both versions, side by side:

| Field | `a064477f` (known-good) | `ade29047` (current candidate) | Different |
|---|---|---|---|
| `PAID_ROUTES_ENABLED` | `"true"` | **absent** | YES |
| `COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED` | `"true"` | **absent** | YES |
| `DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED` | `"true"` | **absent** | YES |
| `VERIFY_V2_CDP_ROUTE_ENABLED` | `"true"` | **absent** | YES |
| `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED` | `"true"` | **absent** | YES |
| `DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED` | `"true"` | **absent** | YES |
| `PAYMENT_ENVIRONMENT` | `"production"` | **absent** | YES |
| `PRODUCTION_ENABLED` | `"true"` | **absent** | YES |
| `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP` | `"true"` | **absent** | YES |
| `PRODUCTION_CDP_CREDENTIALS_APPROVED` | `"true"` | **absent** | YES |
| `SELLER_WALLET_ADDRESS` | present | present | no |
| `ENVIRONMENT` | `"production"` | `"production"` | no |
| All 13 secret bindings (by name) | present | present | no |
| All 8 resource bindings (D1/KV/Queues/R2/Workflow/AI/Browser) | present | present | no |

`ade29047` has **exactly 6** environment variables (`AGENT_CARD_SIGNING_KEY_ID`,
`ENVIRONMENT`, `LOG_LEVEL`, `NVM_ENVIRONMENT`, `PCC_VERSION`,
`SELLER_WALLET_ADDRESS`) — every one of the 10 activation/cutover variables present
on `a064477f` is missing outright, not merely set to a falsy value.

`ADE29047_ACTIVATION_FAILURE_REPRODUCED = YES` (direct read of deployed metadata,
not inference).

`PRODUCTION_SERVICES_ENABLED_ON_PRODUCTION (db7054c9) = NO` — that version predates
`company_evidence_graph.v2` entirely (it is the September-1 `web_context_verified.v2`
release) and is not a valid same-service control; `a064477f` is the correct control
(same service, same source lineage, immediately prior candidate, previously
confirmed `production_enabled=true` in the R4-D1/D2 turns of this session).

`PRODUCTION_SERVICES_ENABLED_ON_ADE29047 = NO`

## 5. Activation resolver (exact predicate, from
`apps/edge-api/src/control-plane/config/production-payment.ts`)

```
resolveCompanyEvidenceGraphV2CdpEffectiveDiscoveryStatus(env, hasDb):
  hasDb                                                            [BINDING_PRESENT: env.DB]
  AND PAID_ROUTES_ENABLED === 'true'                                [WRANGLER_VAR]
  AND COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED === 'true'        [WRANGLER_VAR]
  AND PAYMENT_ENVIRONMENT === 'production'                          [WRANGLER_VAR, ADR-0055 gate 1]
  AND PRODUCTION_ENABLED === 'true'                                 [WRANGLER_VAR, ADR-0055 gate 2]
  AND HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP === 'true'              [WRANGLER_VAR, ADR-0055 gate 3]
  AND PRODUCTION_CDP_CREDENTIALS_APPROVED === 'true'                [WRANGLER_VAR, ADR-0055 gate 4]
  AND PAID_RECEIPT_SIGNING_PRIVATE_KEY present                      [WORKER_SECRET_PRESENT]
  AND PAID_RECEIPT_SIGNING_KEY_ID present                           [WORKER_SECRET_PRESENT]
  AND SELLER_WALLET_ADDRESS present                                 [WRANGLER_VAR]
  AND CDP_API_KEY_ID present                                        [WORKER_SECRET_PRESENT]
  AND CDP_API_KEY_SECRET present                                    [WORKER_SECRET_PRESENT]
```

The identical two-flag shape (`PAID_ROUTES_ENABLED && <SERVICE>_CDP_ROUTE_ENABLED`)
gates all four v2 services (`isVerifyAgentOutputV2CdpRouteFlagEnabled`,
`isWebContextV2CdpRouteFlagEnabled`,
`isCompanyEvidenceGraphV2CdpRouteFlagEnabled`,
`isDocumentEvidenceJsonV2CdpRouteFlagEnabled`), and `PAID_ROUTES_ENABLED` is the
first, shared, short-circuiting condition for every one of them.

## 6. Activation truth table (company_evidence_graph.v2)

| Predicate | Production (db7054c9) | ade29047 | Match | Source | Load-bearing |
|---|---|---|---|---|---|
| `hasDb` | true | true | YES | BINDING | yes |
| `PAID_ROUTES_ENABLED==='true'` | n/a (old build, no such var/route) | **false (absent)** | — | WRANGLER_VAR | **yes — first false** |
| `COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED==='true'` | n/a | false (absent) | — | WRANGLER_VAR | yes |
| ADR-0055 (4 gates) | n/a | all false (absent) | — | WRANGLER_VAR | yes |
| `PAID_RECEIPT_SIGNING_*` secrets present | n/a | **YES present** | — | SECRET | no (not the failing link) |
| `CDP_API_KEY_ID/SECRET` present | n/a | **YES present** | — | SECRET | no |
| `SELLER_WALLET_ADDRESS` present | n/a | **YES present** | — | WRANGLER_VAR | no |

## 11. Four-service dependency matrix

All four v2 services share the identical `PAID_ROUTES_ENABLED` first condition,
which is absent on `ade29047`. Every one of the four therefore fails at the same
global predicate:

| Service | First false predicate on ade29047 |
|---|---|
| `company_evidence_graph.v2` | `PAID_ROUTES_ENABLED==='true'` |
| `web_context_verified.v2` | `PAID_ROUTES_ENABLED==='true'` |
| `document_evidence_json.v2` | `PAID_ROUTES_ENABLED==='true'` |
| `verify_agent_output.v2` | `PAID_ROUTES_ENABLED==='true'` |

`GLOBAL_FAILING_PREDICATE = PAID_ROUTES_ENABLED === 'true'` (absent, not merely
`'false'`).

## 7–9. Version configuration diff / ADR-0055 vars / secret presence

`DEPLOYED_CONFIG_DIFF_FOUND = YES` — 10 vars present on `a064477f`, absent on
`ade29047`; 0 secret-presence differences (all 13 secrets identical by name on
both); 0 binding differences (all 8 resource bindings identical).

All required secrets (`PAID_RECEIPT_SIGNING_KEY_ID/PRIVATE_KEY`, `CDP_API_KEY_ID`,
`CDP_API_KEY_SECRET`) are present on **both** versions — the defect is entirely in
plain-text `vars`, not secrets, and none of the missing values are
credential-shaped.

## 10. Release-plane boundary

`ACTIVATION_RESOLVER_RESPECTS_RELEASE_PLANE_BOUNDARIES = YES`. Every var/secret
this resolver reads (`PAID_ROUTES_ENABLED`, the four ADR-0055 gates, the receipt
signing key pair, the CDP key pair, `SELLER_WALLET_ADDRESS`) belongs to the public
API Worker's own binding set; none of it is a dedicated-host-only credential (Modal
proxy keys, `PAYMENT_CONTINUATION_ENCRYPTION_KEY`) leaking into the public plane.
No boundary leak — this is a pure configuration-omission defect, not an
architectural one.

## 12. 404-vs-402 route trace

`isCompanyEvidenceGraphV2CdpRouteFlagEnabled` is checked directly inline by
`production-company-evidence-v2-cdp-route.ts` before the route ever constructs a
402 challenge (mirroring the discovery-overlay's identical check). With
`PAID_ROUTES_ENABLED` absent, the flag check fails and the route handler never
registers/serves the paid-POST branch for this request, so Hono falls through to
its default `notFound` handler.

```
ROUTE_FAILURE_STAGE  = pre-402, route-flag gate
ROUTE_FAILURE_BRANCH = isCompanyEvidenceGraphV2CdpRouteFlagEnabled() === false
ROUTE_FAILURE_REASON = PAID_ROUTES_ENABLED wrangler var absent on ade29047
PAYMENT_CODE_REACHED = NO (confirmed)
```

## 13. Candidate provenance

```
SOURCE_COMMIT       = 17d7ba7 (SUN-1222C-R4-D3)
CONFIG_SOURCE       = wrangler.toml (repo-committed, [vars] block, lines 68-88)
DEPLOY COMMAND CLASS = `wrangler versions upload` (bare, no --var overrides)
                        then `wrangler versions deploy db7054c9@100 ade29047@0`
SECRETS_FILE USED    = NO (secrets are pre-existing on the Worker; upload does not
                        touch secrets)
```

`wrangler.toml`'s own `[vars]` block (read directly, lines 80-88) contains an
explicit comment documenting this exact behavior as **intentional, by design**:

> "the five payment/cutover switches... are deliberately absent from the frozen
> pre-upload candidate. Every consumer is fail-closed on absence... An upload of
> this candidate cannot activate paid routes or authorize economics. A later,
> separately authorized cutover must set the exact bounded values it needs in its
> own reviewed commit/version."

This confirms: a **bare** `wrangler versions upload` against the committed
`wrangler.toml` has always produced a paid-routes-disabled candidate by design —
every prior *active* candidate (`a064477f`, `efc5a287`, `8ce8cb66`, ...) must have
had these vars supplied via an **additional, separate step** at upload time (CLI
`--var` overrides) as part of that candidate's own creation checkpoint. The
R4-DEPLOYMENT-RETRY procedure uploaded `ade29047` with the bare command only,
omitting the var-activation step every earlier candidate-creation checkpoint
performed.

`ACTIVATION_REGRESSION_INTRODUCED_BY = VAR_LOSS` (procedural: the var-activation
step was not re-run for this specific upload, not a source or wrangler.toml
regression — the `[vars]` block is unchanged and was never intended to carry these
values).

## 14. R4-deployment-retry false-PASS postmortem

`docs/reports/SUN-1222C-R4-deployment-retry.md` §26 asserts "service activation
truthful" based on the **source diff's semantic scope** ("this checkpoint's diff
never touches service-activation or executor-availability code") — true as a
statement about the diff, but never independently re-verified against the actual
deployed candidate's live `/catalog` response after the upload completed.

```
R4_FALSE_PASS_ROOT_CAUSE                            = the deployment-retry evidence
  verified diff scope and pricing-field coherence, but never re-probed
  production_enabled/production_ready booleans on the newly uploaded candidate
  post-deploy — an assumption that "the diff didn't touch activation" implies
  "activation state is unchanged," which does not follow when vars are dropped
  by the upload command itself, independent of any source diff.
R4_CHECKED_PRICE_COHERENCE                          = YES
R4_CHECKED_ACTIVATION_BOOLEAN                        = NO
R4_CHECKED_READY_PRODUCTION_SERVICES_ENABLED         = NO
```

This is a **verification-gap defect**, separate from and caused by the same
upload event as the activation defect itself.

## 15–16. Harness targeting defect

```
HARDCODED_VERSION_TARGETS = [
  scripts/company-evidence-first-paid-e2e.ts   (CANDIDATE_VERSION_ID = a064477f...),
  apps/edge-api/tests/live/company-evidence-first-paid-e2e-local.test.ts
    (CANDIDATE_VERSION_ID = a064477f...)
]
HARNESS_TARGET_SELECTION_MODEL = a single hardcoded module-level constant, manually
  edited by the operator/agent each time a new candidate is qualified; no
  discovery, no readback, no staleness check.
```

`PROPOSED_HARNESS_TARGETING_MODEL` (design only, not implemented this checkpoint):
require the candidate version ID as an explicit required environment variable or
CLI argument (no default), and before requesting the 402:
1. Resolve full deployment state via a read-only Cloudflare API call (or documented
   manual `wrangler deployments list` paste) and assert the caller's target
   version currently exists as an active version on the Worker (any traffic %).
2. Refuse if the target equals the current 100%-traffic production version, unless
   an explicit `--allow-production` flag is passed.
3. Probe `/catalog` and `/ready` through the version-override header for the exact
   target and assert `production_enabled/production_ready/production_services_enabled`
   are all `true` and the paid route itself returns 402 (not 404) for an unpaid
   request, *before* requesting the real 402.
4. Freeze the resolved full version ID for the remainder of the run (no re-resolution
   after the 402 is received, no "latest" selection at signing time).
5. Fail loudly (not silently fall back) if more than one non-production version is
   active and no explicit target was given.

## 17. Pre-payment activation gate design (not implemented)

A mandatory harness preflight, run immediately before any 402 request, asserting
exactly the four checks in §16 item 3 above against the frozen target version, with
the full version ID printed to the operator before proceeding.

## 18–19. Root cause classification

```
ACTIVATION_DEFECT_CLASS  = DEPLOYMENT_PROCEDURE_ONLY
ACTIVATION_ROOT_CAUSE_PROVEN = YES
```

Proof standard met: **(A)** exact missing deployed config (10 named vars, confirmed
absent via direct `wrangler versions view` read of the live candidate) **plus**
source evaluation (§5's exact boolean expression) proving their absence forces
`resolveCompanyEvidenceGraphV2CdpEffectiveDiscoveryStatus` — and, by the identical
shared `PAID_ROUTES_ENABLED` first condition, all three sibling resolvers — to
return `false`, **plus** direct confirmation that `wrangler.toml`'s own doc comment
documents this exact "bare upload yields routes disabled" behavior as intentional
design, explaining precisely why a plain `wrangler versions upload` without a
var-activation step reproduces exactly the observed candidate state. This uniquely
and completely explains all four observed symptoms (catalog false, ready false, all
four services disabled, paid route 404) and the difference from `a064477f` — no
competing hypothesis is consistent with both the exact var diff and the documented
upload-command design.

## 20. Local reproduction

`LOCAL_ACTIVATION_REPRODUCTION = PASS` — `resolveCompanyEvidenceGraphV2CdpEffectiveDiscoveryStatus`
evaluated locally with `ade29047`'s exact observed var set (the 6 present vars,
the 10 missing ones as `undefined`) yields `false`, matching the live candidate.

`LOCAL_CORRECTED_ACTIVATION = PASS` — the same function evaluated with the 10
missing vars set to `a064477f`'s exact observed values yields `true`, with no
source change, confirming the defect is 100% attributable to the missing vars.

## 21. Required remediation design (not executed)

**A. Activation correction:** re-upload the public API candidate with the same
source (17d7ba7) plus the 10 activation vars supplied via `--var` (or an updated
version-specific var file), matching `a064477f`'s exact values. No source change
required.

**B. Harness correction:** replace the hardcoded `a064477f` constant in both
`scripts/company-evidence-first-paid-e2e.ts` and
`apps/edge-api/tests/live/company-evidence-first-paid-e2e-local.test.ts` with the
new candidate's full ID, and implement the §16/§17 pre-payment activation gate
(TDD: a test asserting the harness refuses to proceed when `production_enabled`/
`production_ready`/`production_services_enabled` are not all true, or when the
paid-route preflight returns anything but 402).

## 22. Deployment count design

```
SOURCE_CHANGE_REQUIRED                   = NO (harness test/script files only —
                                            not Worker source)
PUBLIC_API_CANDIDATE_UPLOAD_REQUIRED     = YES (re-upload with vars; same source)
PUBLIC_API_CANDIDATE_DEPLOYMENT_REQUIRED = YES (deploy the new upload at 0%)
HOST_DEPLOY_REQUIRED                     = NO (host was never the defect; its
                                            89bc86b2 deployment from R4-deployment-
                                            retry is unaffected)
SECRET_MUTATION_REQUIRED                 = NO
VAR_MUTATION_REQUIRED                    = YES (the 10 vars, applied to the new
                                            version only, not wrangler.toml)
R2_MUTATION_REQUIRED                     = NO
D1_MUTATION_REQUIRED                     = NO
```

## 23. Payment qualification status

No 402 was obtained this attempt; the standalone financial authorization already
granted for `SUN-1222C-R4-REAL-PAYMENT` was not consumed by any payment material.
Per that authorization's own terms (no retry after the checkpoint stops) and this
diagnosis's own finding (the failure occurred entirely pre-402, in infrastructure
configuration, not in the request itself), any future real payment attempt still
requires a **new** standalone human financial authorization once the corrected
candidate passes the §17 pre-payment activation gate.

`FRESH_PAYMENT_AUTHORIZATION_REQUIRED_NEXT_TIME = YES`

## Final packet

```
SUN1222C_R5                                          = PASS
LATEST_ATTEMPT_CLASS                                 = PRE_CHALLENGE_ROUTE_FAILURE_ZERO_ECONOMIC_EFFECT
REAL_402_CHALLENGES_RECEIVED                         = 0
PAYMENT_MATERIAL_CREATED                             = 0
SIGNING_ACTIONS                                       = 0
PAID_POSTS                                            = 0
SETTLEMENT_ATTEMPTS                                   = 0
MATCHING_NEW_USDC_TRANSFERS                           = 0
CURRENT_PRODUCTION_VERSION                            = db7054c9-76ee-4830-aabe-8a4542261b6a
CURRENT_PRODUCTION_TRAFFIC                            = 100%
ADE29047_FULL_ID                                      = ade29047-9028-4f2a-873d-ea3c24e0b2ab
ADE29047_TRAFFIC                                      = 0%
ADE29047_ACTIVATION_FAILURE_REPRODUCED                = YES
PRODUCTION_SERVICES_ENABLED_ON_PRODUCTION             = NO (not applicable service on this version)
PRODUCTION_SERVICES_ENABLED_ON_ADE29047               = NO
ACTIVATION_ROOT_CAUSE_PROVEN                          = YES
ACTIVATION_ROOT_CAUSE                                 = 10 required wrangler vars (PAID_ROUTES_ENABLED
  + 3 sibling route flags + DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED + 4 ADR-0055 gates +
  PAYMENT_ENVIRONMENT) present on a064477f are entirely absent from ade29047's deployed
  version metadata; wrangler.toml's committed [vars] block deliberately omits them by
  design, and the R4-deployment-retry upload was run bare, without the var-activation
  step every prior active-candidate checkpoint performed.
ACTIVATION_DEFECT_CLASS                               = DEPLOYMENT_PROCEDURE_ONLY
DEPLOYED_CONFIG_DIFF_FOUND                            = YES
ACTIVATION_RESOLVER_RESPECTS_RELEASE_PLANE_BOUNDARIES = YES
ROUTE_FAILURE_STAGE                                   = pre-402 route-flag gate
PAYMENT_CODE_REACHED                                  = NO
R4_FALSE_PASS_ROOT_CAUSE                              = checked price coherence and diff
  scope only; never re-probed live production_enabled/production_ready booleans post-deploy
HARNESS_STALE_TARGET_FOUND                            = YES
STALE_TARGET_VERSION                                  = a064477f-7b74-46c5-a5b6-799df114b252
CURRENT_TARGET_VERSION                                = ade29047-9028-4f2a-873d-ea3c24e0b2ab (also broken; needs re-upload with vars, see remediation)
HARNESS_TARGET_SELECTION_MODEL                        = hardcoded module constant, manually edited
PROPOSED_HARNESS_TARGETING_MODEL                      = required explicit target + pre-payment
  activation-gate probe + frozen-for-run target, no auto-latest selection (§16)
LOCAL_ACTIVATION_REPRODUCTION                         = PASS
LOCAL_CORRECTED_ACTIVATION                            = PASS
SOURCE_CHANGE_REQUIRED                                = NO
PUBLIC_API_CANDIDATE_UPLOAD_REQUIRED                  = YES
PUBLIC_API_CANDIDATE_DEPLOYMENT_REQUIRED              = YES
HOST_DEPLOY_REQUIRED                                  = NO
SECRET_MUTATION_REQUIRED                              = NO
VAR_MUTATION_REQUIRED                                 = YES
R2_MUTATION_REQUIRED                                  = NO
D1_MUTATION_REQUIRED                                  = NO
FRESH_PAYMENT_AUTHORIZATION_REQUIRED_NEXT_TIME        = YES
PRODUCTION_MUTATIONS                                  = 0
EXTERNAL_MUTATIONS                                    = 0
ECONOMIC_TRANSACTIONS                                 = 0
NEXT_REQUIRED_CHECKPOINT                              = SUN-1222C-R6-ACTIVATION-REMEDIATION
```

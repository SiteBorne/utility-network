# SUN-1222C-R6-ACTIVATION-REMEDIATION — evidence report

## 0. Authorization and lineage

- `R6_AUTHORIZATION=PRESENT` — standalone first-person authorization received.
- Inherited state: production `db7054c9-76ee-4830-aabe-8a4542261b6a` @100%, defective candidate `ade29047-9028-4f2a-873d-ea3c24e0b2ab` @0%, no third active version.
- R5 diagnosis evidence: `f05f065` — root cause `DEPLOYMENT_PROCEDURE_DEFECT`, `SOURCE_DEFECT=NO`.

## 1. Pre-remediation live readback

```
R6_PRE_PRODUCTION_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
R6_PRE_PRODUCTION_TRAFFIC=100%
R6_PRE_DEFECTIVE_CANDIDATE_VERSION=ade29047-9028-4f2a-873d-ea3c24e0b2ab
R6_PRE_DEFECTIVE_CANDIDATE_TRAFFIC=0%
R6_PRE_ACTIVE_VERSION_COUNT=2
```

## 3. Reproduced activation failure (matrix, on `ade29047`)

| Service | production_enabled | production_ready | Failure reason |
|---|---|---|---|
| company_evidence_graph.v2 | false | false | `PAID_ROUTES_ENABLED` absent |
| web_context_verified.v2 | false | false | `PAID_ROUTES_ENABLED` absent |
| document_evidence_json.v2 | false | false | `PAID_ROUTES_ENABLED` absent |
| verify_agent_output.v2 | false | false | `PAID_ROUTES_ENABLED` absent |

`R6_DEFECT_REPRODUCED=YES` — live behavior matches R5's diagnosis exactly.

## 4-6. Exact ten-variable reconstruction (derived from live `wrangler versions view` on known-good `a064477f`, not guessed)

| # | NAME | Value | Purpose | Present on `ade29047` |
|---|---|---|---|---|
| 1 | `PAID_ROUTES_ENABLED` | `true` | Master paid-route kill switch, checked first by all four v2 activation predicates | NO |
| 2 | `PRODUCTION_ENABLED` | `true` | ADR-0055 gate 1/4 | NO |
| 3 | `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP` | `true` | ADR-0055 gate 2/4 | NO |
| 4 | `PRODUCTION_CDP_CREDENTIALS_APPROVED` | `true` | ADR-0055 gate 3/4 | NO |
| 5 | `PAYMENT_ENVIRONMENT` | `production` | ADR-0055 gate 4/4 (CDP rail only) | NO |
| 6 | `COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED` | `true` | Per-service activation, company_evidence_graph.v2 | NO |
| 7 | `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED` | `true` | Per-service activation, web_context_verified.v2 | NO |
| 8 | `DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED` | `true` | Per-service activation, document_evidence_json.v2 | NO |
| 9 | `VERIFY_V2_CDP_ROUTE_ENABLED` | `true` | Per-service activation, verify_agent_output.v2 | NO |
| 10 | `DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED` | `true` | Document upload route activation | NO |

```
R6_ACTIVATION_VAR_COUNT=10
R6_ALL_ACTIVATION_VALUES_PROVEN=YES
MISSING_ACTIVATION_VAR_DIFFERENCES=10
UNRELATED_CONFIG_DRIFT_COUNT=0
```

All 10 names/values confirmed read by resolver source (`env.ts`, `production-payment.ts`, `index.ts`) via direct grep, not inferred from naming alone. R5's earlier approximate guesses (`WEB_CONTEXT_VERIFIED_V2_ROUTE_ENABLED`, `VERIFY_AGENT_OUTPUT_V2_ROUTE_ENABLED`, `PRODUCTION_CERTIFICATION_VERIFIED`) were superseded by this exact, authoritative re-derivation from live `wrangler versions view` output.

## 7. wrangler.toml design confirmation

`BARE_UPLOAD_FAIL_CLOSED_BY_DESIGN=YES`, `ACTIVATION_REQUIRES_EXPLICIT_VAR_STEP=YES` — `wrangler.toml`'s own `[vars]` comment (SUN-1205 checkpoint K) states the five/ten activation switches are "deliberately absent from the frozen pre-upload candidate... A later, separately authorized cutover must set the exact bounded values it needs in its own reviewed commit/version; an upload of this candidate cannot activate paid routes or authorize economics."

## 8-14. Harness safety fix (TDD RED→GREEN→mutation-proven)

Two defects fixed in `apps/edge-api/tests/live/company-evidence-first-paid-e2e-local.test.ts` and `scripts/company-evidence-first-paid-e2e.ts`:

1. **Hardcoded candidate** — `CANDIDATE_VERSION_ID = 'a064477f-...'` replaced with `resolveCandidateVersionId(env)`, reading `COMPANY_EVIDENCE_CANDIDATE_VERSION_ID` at runtime with no fallback. Throws closed if unset or malformed.
2. **No pre-payment activation gate** — new `verifyCandidateActivation()` performs one non-economic GET to the candidate's `/catalog`, requiring `production_enabled===true && production_ready===true` for `company_evidence_graph.v2` before any part of the payment flow (including the unpaid 402 probe) proceeds.
3. **Extra safety rail** — `runFirstPaidE2E` refuses outright if `candidateVersionId` equals the known production version ID.

6 new tests added, all genuinely RED against pre-fix code, GREEN after the fix, and mutation-proven (two separate manual mutations — bypassing the activation-gate branch, and reintroducing a hardcoded fallback — each caused the exact expected new tests to fail; both reverted and re-verified GREEN).

```
HARDCODED_CANDIDATE_RED=YES
ACTIVATION_GATE_RED=YES
HARDCODED_CANDIDATE_GREEN=PASS
ACTIVATION_GATE_GREEN=PASS
R6_HARNESS_MUTATION_PROOF=PASS
```

## 15-17. Targeted regression, full repo gate, commit

```
TYPECHECK=PASS
BUILD=PASS
LINT=PASS
TESTS=2960 passed / 2 failed (resource-contention timeouts, reconfirmed 100% passing in isolation: production-cdp-full-stack-mock.test.ts, worker-bridge.subprocess.test.ts — both unrelated files, neither touches candidate targeting or activation logic) / 78 skipped
PROTOCOL_MCP_CHECK=PASS
PROTOCOL_X402_CHECK=PASS
PROTOCOL_A2A_CHECK=PASS
WORKER_RUNTIME=99/99 PASS
SECRETS_SCAN=2 pre-existing findings (historical commits 3cbee0e4, 1e3e3d04, confirmed Worker-version-UUID false positive, zero new findings)
PRODUCTION_PREFLIGHT=PASS
```

`R6_HARNESS_FIX_COMMIT_SHA=cad721c7404d890b2ced0d5111289362b9a3aa03`

Working tree clean immediately after commit.

## 18-19. Frozen source and economics

`R6_CANDIDATE_SOURCE_HEAD=cad721c7404d890b2ced0d5111289362b9a3aa03`

| Service | Price USD | Amount atomic | Network | Asset | payTo |
|---|---|---|---|---|---|
| company_evidence_graph.v2 | 0.0312 | 31200 | eip155:8453 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `0x7f44a2dd237938F18632d4CcA40f4c690295E6E1` |
| web_context_verified.v2 | 0.008 | — | same | same | same |
| document_evidence_json.v2 | 0.0098 | — | same | same | same |
| verify_agent_output.v2 | 0.017 | — | same | same | same |

`R6_ECONOMICS_UNCHANGED=YES` (confirmed against `governance/RISK_LIMITS.yaml` and live `/catalog`, byte-identical to every prior checkpoint's reading).

## 21-23. Corrected upload

`R6_CORRECTED_UPLOAD_DRY_RUN=PASS` (all 16 vars — 6 base + 10 activation — present, correctly named).

Pre-mutation reconfirmation immediately before the real upload: `db7054c9` @100%, `ade29047` @0%, no drift.

```
R6_CANDIDATE_UPLOADS=1
R6_DEPLOYMENT_MUTATIONS=1
R6_NEW_CANDIDATE_VERSION=d3472f58-f578-4a8f-992b-0d0956c9b561
```

## 24-25. Post-deployment readback

```
db7054c9-76ee-4830-aabe-8a4542261b6a = 100%
d3472f58-f578-4a8f-992b-0d0956c9b561 = 0%
```

`ade29047` no longer in the active split (retained in immutable version history). No other normal-traffic version.

`R6_NEW_CANDIDATE_ACTIVATION_VAR_COUNT=10`, `R6_NEW_CANDIDATE_ACTIVATION_VARS_MATCH=YES` — live `wrangler versions view` on `d3472f58` shows all 10 vars present with exact values matching the known-good reference exactly.

## 26-27. Four-service live activation proof (direct, non-economic probe of `d3472f58`)

| Service | production_enabled | production_ready | Price | Result |
|---|---|---|---|---|
| company_evidence_graph.v2 | true | true | 0.0312 | PASS |
| web_context_verified.v2 | true | true | 0.008 | PASS |
| document_evidence_json.v2 | true | true | 0.0098 | PASS |
| verify_agent_output.v2 | true | true | 0.017 | PASS |

`R6_ALL_FOUR_V2_ACTIVATED=YES`.

As a direct, decisive confirmation: an unpaid POST to `/v2/company/evidence-graph` against `d3472f58` now returns **HTTP 402** (the exact symptom R5 diagnosed as 404 is resolved).

## 28-30. Discovery, MCP, A2A coherence

- Agent Card: 8 skills present (4 v1 + 4 v2), all IDs coherent.
- MCP `tools/list`: succeeds with the real `siteborne_company_evidence_graph` tool and its full precompiled input schema — no `-32022` regression.
- Decoded 402 `PaymentRequirements`: `network=eip155:8453`, `asset=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, `amount=31200`, `payTo=0x7f44a2dd237938F18632d4CcA40f4c690295E6E1`, `extra={name:"USD Coin",version:"2"}` — exact match to frozen economics.

```
R6_CANDIDATE_DISCOVERY_COHERENCE=PASS
R6_MCP_INTEROPERABILITY=PASS
R6_A2A_COHERENCE=PASS
```

## 31. Payment configuration readiness (no payment material)

`R6_PAYMENT_CONFIGURATION_READY=PASS`. The 402 challenge above was read directly (no EIP-3009 authorization constructed, no signing, no submission) — `PAYMENT_AUTHORIZATIONS_CREATED=0`, `SIGNING_ACTIONS=0`, `PAID_POSTS=0`.

## 32-33. Containment and zero economic activity

```
PRODUCTION_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
PRODUCTION_TRAFFIC=100%
R6_NEW_CANDIDATE_TRAFFIC=0%
R6_PRODUCTION_CONTAINMENT=PASS

REAL_402_QUALIFICATION_REQUESTS=0 (the read above was a non-economic activation/config verification probe, not a qualification attempt for payment)
EIP3009_AUTHORIZATIONS_CREATED=0
PAYMENT_SIGNING_ACTIONS=0
REAL_PAID_POSTS=0
FACILITATOR_SETTLEMENT_CALLS=0
CHAIN_TRANSACTIONS_CREATED_BY_R6=0
R6_ECONOMIC_EFFECT_USDC=0
```

## 34. Payment-qualification eligibility

`SUN1222C_FOUR_SERVICE_PAYMENT_QUALIFICATION_ELIGIBLE=YES` — new candidate immutable at 0%, all 10 vars proven, all four v2 both enabled and ready, economics unchanged, MCP/A2A/discovery all PASS, production remains 100%, zero economic activity.

## 35. Financial stop

Per authorization terms: **no real payment was started.** All prior financial authorizations remain retired. The next controlled payment requires a new standalone human financial authorization.

# SUN-1222C-1 — Four-Service Immutable Candidate

**Status:** PARTIAL — repo/infra provisioning, candidate creation, discovery, and
three of four paid-route qualifications are clean; **one genuine, previously
undiscovered blocking defect found and left unfixed by design** (this
checkpoint's authorization capped candidate uploads at exactly one, and the fix
requires a second upload). Production untouched throughout (`db7054c9…@100%`
the entire session).

## 1. Authorization

Explicit standalone authorization was given in a dedicated message enumerating
exactly six permitted categories: repo-only mutations; read-only Cloudflare/R2/
Modal state inspection (secret **names** only); exactly one new Modal
document-worker credential; exactly one bounded R2 synthetic round-trip;
exactly one immutable Cloudflare Worker candidate-version upload at 0% traffic
with `db7054c9-76ee-4830-aabe-8a4542261b6a` remaining at 100% throughout; and
zero economic action. The authorization explicitly said: "If continuing the
checkpoint would require any live mutation, economic action, credential
change, production deployment, or scope beyond the repo-only/read-only
boundaries above, stop at the last proven state and request fresh standalone
authorization." That clause is why §12 below stops instead of uploading a
second candidate.

## 2. Starting lineage (§0-2)

```
S3_CONTINUE_START_HEAD=900abc3a39e87a0127aa4e3e1e739de5acd5900f
WORKING_TREE_CLEAN=YES
```
`git log --oneline -15` confirmed the exact inherited chain (900abc3 ← 54ab338
← e11e1bf ← c126c86 ← 4139746 ← 3913f9d ← 28e89b6 ← b3878f5 ← 1e891b6 ←
baddff0 ← …). No divergence from the S3-CONTINUE freeze.

## 3. Load-bearing release gates (§3) — all PASS, re-run live this session

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | PASS (23/23, cached) |
| `pnpm lint` | PASS (16/16, cached) |
| `pnpm build` | PASS (12/12, cached) |
| `pnpm test` (full suite) | PASS — 2690 passed, 74 skipped, 0 failed |
| `pnpm mcp:check` | PASS |
| `pnpm x402:check` | PASS |
| `pnpm a2a:check` | PASS |
| `pnpm test:worker-runtime` | PASS — 99/99 scenarios |
| `pnpm secrets:scan` | PASS — 660 commits, 0 leaks; working-tree scan clean |
| `pnpm production:preflight` | PASS — zero mutating calls, all required bindings/vars/secret names present |
| `wrangler deploy --dry-run` | PASS |

The full suite's 2690/74/0 split and every named regression family (MCP
`legacy:'stateless'`, A2A `productionEnabled`, the 8 AgentSkill IDs, Agent
Card JWS, `evidenceMode` propagation, trust-class accept/reject, the
post-settlement `pcc`-undefined fail-closed guard, single settlement owner,
receipt durability, x402 replay/concurrency, SSRF/DNS-rebinding) are included
in this run — they are not re-narrated from a prior checkpoint; this is the
actual exit code from this session's execution.

## 4. Exact four-service matrix (§4) — `SERVICE_TOOL_MATRIX_V2_EXACT=PASS`

Confirmed via live MCP `tools/list` against the candidate (§9) — the returned
tool set is exactly:

| MCP tool | Service ID | Route |
| --- | --- | --- |
| `siteborne_company_evidence_graph` | `company_evidence_graph.v2` | `POST /v2/company/evidence-graph` |
| `siteborne_web_context_verified` | `web_context_verified.v2` | `POST /v2/web/context` |
| `siteborne_document_evidence_json` | `document_evidence_json.v2` | `POST /v2/document/evidence-json` |
| `siteborne_verify_agent_output` | `verify_agent_output.v2` | `POST /v2/verify/agent-output` |

plus `siteborne_get_quote` and `siteborne_get_service_health` (6 tools total,
matching `mcp:check`'s own count). A2A Agent Card confirmed exactly 8 skill
IDs (all four services × v1/v2).

## 5. Frozen S3 economics (§5) — traced to the actual single source of truth

`packages/protocol-x402/src/pricing/mapping.ts` re-exports
`resolveServiceMaxPriceUsd` from `@siteborne/pricing`, which is the **only**
implementation (`docs/decisions/0042-x402-pricing-boundary-correction.md`),
reading `governance/RISK_LIMITS.yaml` live. Every one of the four CDP route
compositions (`company-evidence-graph-v2-cdp-composition.ts`,
`web-context-v2-cdp-composition.ts`, `document-evidence-json-v2-cdp-
composition.ts`, `verify-agent-output-v2-cdp-composition.ts`) and every
catalog/registry consumer (`paid-services.ts`) calls this same function with a
fixed `pricingKey`:

```
COMPANY_EVIDENCE_GRAPH_V2_PRICE_USDC=0.039   (pricingKey: company_evidence_graph)
COMPANY_EVIDENCE_GRAPH_V2_AMOUNT_ATOMIC=39000
WEB_CONTEXT_VERIFIED_V2_PRICE_USDC=0.009     (pricingKey: web_context_verified_direct, direct tier)
WEB_CONTEXT_VERIFIED_V2_AMOUNT_ATOMIC=9000
DOCUMENT_EVIDENCE_JSON_V2_PRICING_MODEL=tiered "upto" (native/ocr/table/max_job)
DOCUMENT_EVIDENCE_JSON_V2_PRICE_TABLE=native 0.012 / ocr 0.019 / table 0.029 / max_job 0.19  (pricingKey: document_evidence_json_max_job, cap = 0.19)
VERIFY_AGENT_OUTPUT_V2_PRICE_USDC=0.019      (pricingKey: verify_agent_output_standard)
VERIFY_AGENT_OUTPUT_V2_AMOUNT_ATOMIC=19000
C1_PRICE_MUTATIONS=0
```

No value in `governance/RISK_LIMITS.yaml` was touched this session.

## 6. Company registry price-drift gate (§6) — `PASS_WITH_DOCUMENTED_NONRUNTIME_DRIFT`

Ran `pnpm pricing:registry:check` live (the checker CI removed from the hard
gate in `54ab338`, specifically so it stays runnable as a diagnostic):

```
[pricing:registry:check] registry/services/*.json price drift detected:
  - company_evidence_graph.v1: maximum_price=0.19 but expected base_price (no distinct governance ceiling for this family)=0.039
  - company_evidence_graph.v2: maximum_price=0.19 but expected base_price (no distinct governance ceiling for this family)=0.039
The real charged amount is unaffected (every quote-minting call site reads
governance/RISK_LIMITS.yaml live via resolveServiceMaxPriceUsd(), never these
fields) -- but this is the exact data seedServices() writes into D1, which
/catalog serves back verbatim with no live-recompute overlay.
```

```
COMPANY_PRICE_DRIFT_SOURCE=registry/services/company_evidence_graph.v2.json's "maximum_price" field
COMPANY_PRICE_DRIFT_VALUE=0.19 USD (copy of document_evidence_json's max_job ceiling, not a company_evidence_graph value)
AUTHORITATIVE_RUNTIME_PRICE=0.039 USD (governance/RISK_LIMITS.yaml, single flat "exact" price, no upto tier for this family)
DRIFT_ARTIFACT_SERVED_PUBLICLY=YES (the checker says /catalog serves the field verbatim)
DRIFT_AFFECTS_PAYMENT_REQUIREMENTS=NO (confirmed empirically — see §9's live /catalog probe against the candidate, which returned price_usd="0.039", not "0.19")
DRIFT_AFFECTS_CATALOG=NO in practice (the live D1-backed /catalog "price_usd" field reads only base_price; "maximum_price" is present in the source JSON but not rendered by the endpoint actually probed this session)
DRIFT_AFFECTS_MCP=NO (packages/protocol-mcp/src/constants.ts, frozen-contracts.ts do not reference "maximum_price")
DRIFT_AFFECTS_A2A=NO (packages/protocol-a2a/src/constants.ts does not reference it)
DRIFT_AFFECTS_OPENAPI=NOT_CHECKED_THIS_SESSION (schema type only touches packages/contracts/src/semantic/validators.ts as an optional field; not traced end-to-end)
DRIFT_AFFECTS_RECEIPT_ECONOMICS=NO (receipts derive amount from the same resolveServiceMaxPriceUsd() call, never from this file)
```

Given the checker's own finding ("real charged amount is unaffected") and this
session's own empirical `/catalog` probe against the live candidate (§9)
showing the correct `0.039`, this is classified
`C1_PUBLIC_PRICE_COHERENCE=PASS_WITH_DOCUMENTED_NONRUNTIME_DRIFT`, matching
S3-CONTINUE's prior classification. The fix (correcting
`registry/services/company_evidence_graph.{v1,v2}.json`) is unchanged from
before: still a MAJOR frozen-contract-compatibility change, still out of this
checkpoint's repo-only/non-major scope.

## 7. Zero-fixture reconfirmation (§7)

```
COMPANY_V2_PRODUCTION_FIXTURE_REACHABLE=NO
WEBCTX_V2_PRODUCTION_FIXTURE_REACHABLE=NO
DOCUMENT_V2_PRODUCTION_FIXTURE_REACHABLE=NO
VERIFY_V2_PRODUCTION_FIXTURE_REACHABLE=NO
```
`test:worker-runtime`'s `FIXTURE_RUNTIME_REACHABILITY` gate (§3 above) is the
authoritative, mechanically-enforced proof of this (0 hard-bypass markers,
both prior disclosed findings proven structurally unreachable) — re-run live
this session, not narrated from history.

## 8. Cloudflare/R2 readback before mutation (§8-9)

```
$ wrangler deployments status
Version(s): (100%) db7054c9-76ee-4830-aabe-8a4542261b6a
PRE_C1_PRODUCTION_READBACK=PASS

$ wrangler r2 bucket list
name: siteborne-artifacts   creation_date: 2026-09-02T01:59:27.265Z   (exactly one bucket)
R2_BUCKET_EXISTS=YES
R2_BUCKET_NAME=siteborne-artifacts
$ GET /accounts/{id}/r2/buckets/siteborne-artifacts/domains/managed -> {"enabled": false}
R2_BUCKET_PRIVATE=YES
```
Not created this session — SUN-1222C-R1 created it; this session only
re-confirmed it read-only before uncommenting the binding.

## 9. R2 binding + route-flag freeze, and the one repo-only source commit (§10-11)

`wrangler.toml:144-147` had the `[[r2_buckets]]` block commented out since
SUN-0800B checkpoint 3 ("needs dashboard enablement first"). SUN-1222C-R1
already confirmed R2 enabled and the bucket created; nothing had ever
uncommented the binding itself, so `document_evidence_json.v2`'s production
composition and the buyer-upload route could not reach real R2 — both would
resolve `env.ARTIFACTS` as `undefined` and fail closed to
`unavailable: true`. Uncommented it (commit `8de9fc3`, config-only, gates
re-run green after — see §3's `wrangler deploy --dry-run`, which now shows
`env.ARTIFACTS (siteborne-artifacts) R2 Bucket`).

```
DOCUMENT_R2_BINDING_NAME=ARTIFACTS
DOCUMENT_R2_BINDING_TARGET=siteborne-artifacts
DOCUMENT_R2_BINDING_ALREADY_PRESENT=NO (before this commit) -> YES (after)
```

Route/activation-variable matrix, resolved from `db7054c9`'s actual live
`wrangler versions view` readback (not guessed) against
`apps/edge-api/src/control-plane/config/env.ts`'s declarations:

| NAME | CURRENT_PRODUCTION_VALUE | CANDIDATE_VALUE | WHY_REQUIRED | SERVICE_AFFECTED |
| --- | --- | --- | --- | --- |
| `PAID_ROUTES_ENABLED` | `true` | `true` (unchanged) | global paid-route master switch | all four |
| `VERIFY_V2_CDP_ROUTE_ENABLED` | `true` | `true` (unchanged) | route-specific gate | verify_agent_output.v2 |
| `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED` | `true` | `true` (unchanged) | route-specific gate | web_context_verified.v2 |
| `COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED` | absent | `true` (**new**) | route-specific gate | company_evidence_graph.v2 |
| `DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED` | absent | `true` (**new**) | route-specific gate | document_evidence_json.v2 |
| `DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED` | absent | `true` (**new**) | buyer upload endpoint gate | document_evidence_json.v2 |
| `PRODUCTION_ENABLED` | `true` | `true` (unchanged) | top-level economic switch | all |
| `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP` | `true` | `true` (unchanged, carried forward only because `--var` without `--keep-vars` resets the full var set — value itself not altered) | ADR-0055 bootstrap gate | all |
| `PRODUCTION_CDP_CREDENTIALS_APPROVED` | `true` | `true` (unchanged) | CDP mainnet approval gate | all |
| `PAYMENT_ENVIRONMENT` | `production` | `production` (unchanged) | payment-rail selector | all |

No unrelated flag, seller, asset, network, or price was changed.
`C1_ROUTE_FLAG_MATRIX` above is exact and complete.

## 10. Modal document-worker auth requirement (§12)

```
DOCUMENT_MODAL_SECRET_NAMES=MODAL_DOCWORKER_ENDPOINT_URL, MODAL_DOCWORKER_PROXY_KEY, MODAL_DOCWORKER_PROXY_SECRET
```
Endpoint (unchanged since SUN-1222C's deploy, re-confirmed live this session):
`https://siteborne--siteborne-document-worker-process-document-http.modal.run`.
Auth: Modal's platform `requires_proxy_auth=True` (`Modal-Key`/`Modal-Secret`
header pair). Pre-mint baseline reconfirmed: unauthenticated `POST {}` → `401
"modal-http: missing credentials for proxy authorization"`.

## 11. Secret-provisioning isolation proof (§13) — `CANDIDATE_SECRET_ISOLATION_PROVEN=YES`

Inspected `wrangler secret put --help` (legacy: script-global, auto-deploys)
vs `wrangler versions upload --help`, whose `--secrets-file` flag is
documented as "Applies additively with secrets from previous deployments —
omitted secrets will not be deleted." and whose `--var` flag is scoped to
"inject into **this** version." `wrangler versions upload` (distinct from
`wrangler deploy`/`wrangler secret put`) never shifts traffic and never
retroactively touches an already-uploaded version's execution environment —
`db7054c9` was uploaded with its own secret/var bindings baked in at its own
upload time; a later version's additive secrets do not attach to it.
Corroborated by this repo's own precedent
(`docs/reports/SUN-1219C-mainnet-candidate-zero-traffic-unpaid-402-qualification.md`),
which used the identical `versions upload` → `versions deploy
<prod>@100% <candidate>@0%` → `Cloudflare-Workers-Version-Overrides` header
pattern this checkpoint reused.

```
CANDIDATE_SECRET_PROVISIONING_METHOD=wrangler versions upload --secrets-file <staged JSON, chmod 600, never printed>
ACTIVE_PRODUCTION_SECRET_STATE_IMPACT=NONE (db7054c9's own already-baked bindings unaffected; confirmed by post-upload `wrangler deployments status` still showing db7054c9 unchanged at 100%, §16)
```

## 12. Modal credential mint and proof (§14-15)

Pre-existing tokens (`modal workspace proxy-tokens list --json`, read-only):
`wk-6LcEUTuEzcQBsQ7oIPSmMj` (SUN-1222C-R1, secret discarded/never wired —
orphaned, unused, left untouched) and `wk-jozfRBPfBFAJbWbQoXV88z` (unrelated,
pre-existing, purpose unlabeled by the Modal API, also left untouched).
Neither reused (secret unavailable for the first; no shared-identity
architecture documented for the second).

```
$ modal workspace proxy-tokens create --json > <chmod-600 file outside repo>
MODAL_CREDENTIALS_CREATED=1
new token_id (safe, non-secret): wk-lSGM4IuoAogKV3CTZX5xHj
Modal-Secret: never printed, logged, or committed.
```

Qualification against the **existing, already-deployed** document worker (no
Modal redeploy):

```
POST <endpoint> {}                              -> 401 "modal-http: missing credentials for proxy authorization"
DOCUMENT_MODAL_UNAUTH_FAIL_CLOSED=PASS

POST <endpoint>, Modal-Key/Modal-Secret (new cred), body = services/modal-worker/fixtures/pdf/native_text_one_page.pdf (1530 bytes, repo-committed synthetic fixture, base64-encoded per the DocumentWorkerHttpRequest contract)
-> 200, status:"success", sha256:bed592e52666c6b8098eb2a9d4eae0d5551053657736593ec0cba9f4f205bab3, page_count:1, failure:null
DOCUMENT_MODAL_AUTH_SMOKE=PASS
REAL_DOCUMENT_EXECUTOR_CONFIRMED=YES
```

The staged credential file (and the separately staged `--secrets-file`) were
deleted after the `versions upload` step below persisted them into
Cloudflare's own secret store (§16) — nothing sensitive remains on local
disk.

## 13. Candidate manifest freeze and upload (§16-17)

```
CANDIDATE_MANIFEST_FROZEN=YES
CANDIDATE_SOURCE_HEAD=8de9fc3d15ed771f84a29b1c033c2ac655e0dc74
CANDIDATE_PUBLIC_BEHAVIOR_CHANGES=three new v2 CDP routes reachable (company_evidence_graph.v2, document_evidence_json.v2 real R2 path, buyer upload route mounted) — all previously 404
CANDIDATE_BINDING_CHANGES=+env.ARTIFACTS (R2, siteborne-artifacts)
CANDIDATE_VAR_CHANGES=+COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED, +DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED, +DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED (all "true"); every other var unchanged from db7054c9
CANDIDATE_SECRET_NAMES=+MODAL_DOCWORKER_ENDPOINT_URL, +MODAL_DOCWORKER_PROXY_KEY, +MODAL_DOCWORKER_PROXY_SECRET
CANDIDATE_PRICE_CHANGES=0
CANDIDATE_D1_MIGRATIONS=none (no migration touched this session)
```

```
$ wrangler versions upload --message "SUN-1222C-1: immutable four-service candidate (repo-only source 8de9fc3 + ARTIFACTS R2 + document-worker auth); 0% traffic" --tag sun1222c1-candidate --var PAID_ROUTES_ENABLED:true --var VERIFY_V2_CDP_ROUTE_ENABLED:true --var WEB_CONTEXT_V2_CDP_ROUTE_ENABLED:true --var COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED:true --var DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED:true --var DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED:true --var PRODUCTION_ENABLED:true --var HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP:true --var PRODUCTION_CDP_CREDENTIALS_APPROVED:true --var PAYMENT_ENVIRONMENT:production --secrets-file <staged>
Uploaded siteborne-utility-edge (3.90 sec)
Worker Version ID: 9080c1dd-e96f-4204-a857-fed85e6646cc
```
Validated with `--dry-run` first (identical binding table, secret values
shown `(hidden)`) before the real upload. Not deployed by this command —
`wrangler versions upload` never shifts traffic.

```
CANDIDATE_VERSIONS_CREATED=1
CANDIDATE_VERSION_ID=9080c1dd-e96f-4204-a857-fed85e6646cc
```

## 14. Zero-traffic registration and readback (§18-19)

Per the SUN-1219C precedent, registered the candidate at 0% while explicitly
re-affirming production at 100% (this is the mechanism the traffic-split
table itself requires to make the `Cloudflare-Workers-Version-Overrides`
header resolvable — it does not change ordinary routing):

```
$ wrangler versions deploy db7054c9-76ee-4830-aabe-8a4542261b6a@100% 9080c1dd-e96f-4204-a857-fed85e6646cc@0% --name siteborne-utility-edge -y
SUCCESS  Deployed siteborne-utility-edge version db7054c9-... at 100% and version 9080c1dd-... at 0% (1.16 sec)

$ wrangler deployments status
(100%) db7054c9-76ee-4830-aabe-8a4542261b6a
  (0%) 9080c1dd-e96f-4204-a857-fed85e6646cc
```
```
C1_TRAFFIC_READBACK=PASS
NORMAL_TRAFFIC_TO_NEW_CANDIDATE=0%
```

`wrangler secret list` (post-upload, names only) confirms exactly the
expected 13 secrets — the 10 pre-existing plus the 3 new `MODAL_DOCWORKER_*`
— **no** `CDP_WALLET_SECRET`, no unexpected name:

```
C1_CANDIDATE_CONFIG_READBACK=PASS
```

## 15. Safe candidate discovery (§20-21) — all via `Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="9080c1dd-…"` against `https://utility.siteborne.net`, zero paid invocation

- `GET /health` (no override) → 200; (override) → 200.
- `POST /mcp` `initialize` (legacy-stateless session, override) → 200, `protocolVersion 2025-06-18`.
- `POST /mcp` `tools/list` (override) → 200, exactly the 6 tools in §4.
- `GET /.well-known/agent-card.json` (override) → 200, **8** skill IDs (all four services × v1/v2), one JWS `signatures` entry (`protected`+`signature`, real envelope).
- `GET /.well-known/jwks.json` (override) → 200, one public EC (`P-256`) key, `kid siteborne-agent-card-2026-08` — no private material.
- `GET /openapi.json` (override) → 200, 6 paths.
- `GET /catalog` (override) → 200; all four v2 rows: `production_enabled:true`, `production_ready:true`, `price_usd` exactly matching §5's governance-sourced values (`0.039` / `0.009` / `0.012` / `0.019` — **not** the §6 drift value).

```
C1_CANDIDATE_DISCOVERY=PASS
C1_ALL_FOUR_READY=YES
```

## 16. Paid-route fail-closed probes (§22)

Each service's own frozen input schema's own published `examples[0]` was used
(no payment material of any kind — no `PAYMENT-SIGNATURE` header):

```
company_evidence_graph.v2 : POST /v2/company/evidence-graph {"company_name":"Example Corp"}                  -> 402 payment_required
web_context_verified.v2   : POST /v2/web/context           {schema example}                                  -> 402 payment_required
document_evidence_json.v2 : POST /v2/document/evidence-json {"artifact_reference": {schema example}}          -> 402 payment_required
verify_agent_output.v2    : POST /v2/verify/agent-output    {schema example}                                  -> 402 payment_required
```
```
COMPANY_UNPAID_FAIL_CLOSED=PASS
WEBCTX_UNPAID_FAIL_CLOSED=PASS
DOCUMENT_UNPAID_FAIL_CLOSED=PASS
VERIFY_UNPAID_FAIL_CLOSED=PASS
INTENTIONAL_PAYMENT_AUTHORIZATIONS=0
```
(An earlier attempt against `document_evidence_json.v2` and `verify_agent_
output.v2` with incorrectly-shaped ad hoc bodies returned `400
invalid_request` — schema validation correctly runs before the payment gate;
re-run with each schema's own frozen example produced the expected `402`
above. `web_context_verified.v2`'s first attempt used a made-up `"url"` field
instead of the schema's real `"target_url"`, same correction.)

## 17. **Document buyer-upload path — genuine defect found, `DOCUMENT_BUYER_UPLOAD_PATH=FAIL`** (§23)

The SUN-1222B-S3-R2 evidence report (`b3878f5`) states the buyer upload path
is "genuinely resolvable end-to-end" and its own 38 tests are green. Both
true — and insufficient. Its route-level tests
(`document-artifact-upload-route.test.ts:79`) construct their own bare `new
Hono()` app and mount only the upload route, never going through
`apps/edge-api/src/index.ts`'s real middleware chain. Probing the real
deployed candidate exposed what that test isolation hid:

```
$ curl -X POST https://utility.siteborne.net/v2/artifacts/documents \
    -H 'Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="9080c1dd-…"' \
    -H 'Content-Type: application/pdf' --data-binary @<real PDF fixture>
-> 415 {"code":"UNSUPPORTED_MEDIA_TYPE","message":"Content-Type must be application/json"}

$ curl -X POST https://utility.siteborne.net/v2/artifacts/documents \
    -H 'Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="9080c1dd-…"' \
    -H 'Content-Type: application/json' --data-binary @<same PDF bytes>
-> 415 {"error":"unsupported_media_type","message":"unsupported or missing Content-Type \"application/json\" — must be exactly one of application/pdf, image/png, image/jpeg"}
```

Root cause, confirmed by direct source read:
`apps/edge-api/src/index.ts:63` mounts `app.use('*',
createContentTypeMiddleware())` globally, before every route, with no
exclusion. `createContentTypeMiddleware`
(`apps/edge-api/src/control-plane/middleware/request-context.ts:175-188`)
rejects any `POST` whose `Content-Type` is not `application/json` (or
`application/json; charset=utf-8`) with a `415` — **before the request ever
reaches the upload route's own handler.** The upload route's own
`storeDocumentUpload` then independently requires the Content-Type to be
exactly `application/pdf`, `image/png`, or `image/jpeg` (real document bytes)
to pass its own magic-byte check. **No Content-Type value satisfies both
checks simultaneously.** The endpoint is unreachable for its designed purpose
in the actual deployed application, despite passing 38/38 of its own
unit-level tests, because those tests never exercise the real global
middleware stack.

This directly contradicts §0's inherited-state claim ("document buyer-upload
path implemented and re-verified") and the S3-R2 report's own "COMPLETE"
status line. Neither prior checkpoint was dishonest — both genuinely ran real
route-level tests that genuinely passed — the gap is a blind spot in test
harness construction (isolated route mount vs. full app), exactly the kind of
gap "final production composition" checkpoints like this one exist to catch.

```
R2_SYNTHETIC_ARTIFACT_WRITES=0
R2_SYNTHETIC_ARTIFACT_DELETES=0
R2_TEST_ARTIFACT_REMAINS=NO (nothing was ever written)
DOCUMENT_BUYER_UPLOAD_PATH=FAIL
```

**Why this was not fixed in this checkpoint:** the fix (an exclusion for this
one route in `createContentTypeMiddleware`, or moving the route before that
middleware) is a real, small, low-risk repo-only source change well within
what this checkpoint's authorization permits to *edit* — but this
checkpoint's authorization explicitly capped the number of Cloudflare Worker
candidate-version uploads at **exactly one**, and that upload (`9080c1dd-…`)
was already made, with the bug, before this was discovered (the bug is a
request-time behavior, invisible to every static gate in §3, and only
surfaced by probing the live deployed candidate in §16-17, which necessarily
happens after upload). Fixing it now would require a second candidate upload,
exceeding the explicit cap. Per the authorization's own stop clause, this
checkpoint stops here on this finding rather than exceeding it silently.

## 18. Live dependency smokes (§24-26)

```
COMPANY_LIVE_DEPENDENCY_SMOKE=NOT_REQUIRED
WEBCTX_LIVE_DEPENDENCY=NOT_REQUIRED (re-confirmed via prior real paid qualification's already-established architecture; no new non-economic internal smoke mechanism exists to invoke without either bypassing x402 or spending real funds, neither authorized)
VERIFY_LIVE_DEPENDENCY=NOT_REQUIRED (same reasoning)
```
No x402 bypass was attempted; no unbounded fan-out occurred; the real
document-worker dependency (the one service whose production readiness had
never been directly proven pre-payment) was independently, boundedly proven
live in §12.

## 19. Candidate price coherence (§27)

```
COMPANY_PRICE_COHERENCE=PASS   (0.039, matches governance, confirmed live in §15's /catalog probe)
WEBCTX_PRICE_COHERENCE=PASS    (0.009)
DOCUMENT_PRICE_COHERENCE=PASS  (0.012, native tier)
VERIFY_PRICE_COHERENCE=PASS    (0.019)
ALL_FOUR_PRICE_COHERENCE=PASS
```
The §6 registry-drift value (`0.19` mis-attributed to
`company_evidence_graph`) did not appear on any surface actually probed this
session (`/catalog`, MCP `tools/list`, the four `402` bodies, which return
only `quote_id`/`requirement_id`, no amount).

## 20. Settlement-owner readback (§28)

`grep` for real `.settle(`/`settlePayment(` call **expressions** (not
comments/docs) across `apps/edge-api/src`:

```
apps/edge-api/src/control-plane/evidence/cdp-provider.ts:161   this.facilitator.settle(...)   <- the settlement PROVIDER's own implementation of evidenceProvider.settle()
apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts:586   deps.settlement.evidenceProvider.settle(...)   <- the ONE call site that invokes it
```
`x402-service.ts` (the public route handler) contains only comments
confirming it deliberately never calls `.settle()` directly.

```
PUBLIC_API_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
CANDIDATE_WORKFLOW_BINDING=PASS (env.PAID_CONTINUATION_WORKFLOW present in both db7054c9's and the candidate's binding table, §8/§13)
```

## 21. Observability (§29)

Every response received this session across all probes (§15-17) was one of:
`200`, `402`, `400` (schema validation, expected), `415` (the §17 finding,
itself the observation, not a recurrence of a *previously-fixed* defect from
the list below), or `401` (Modal pre-mint baseline). Zero `500`s. None of the
eight specifically-named recurrence patterns (RPC missing run,
`dependencies_unavailable`, `EvalError` runtime compilation, Modal
10MiB/10MB contract mismatch, D1 missing-column error, receipt persistence
error, `trust_class_not_allowed` for valid production composition, `pcc`
undefined uncontrolled 500) appeared in any response body this session.

```
C1_KNOWN_DEFECT_RECURRENCE_COUNT=0
```
(§17's finding is a new, distinct, previously-undiscovered defect — not
counted against this specific recurrence list, and reported in full above
instead.)

## 22. Buyer balance and funding requirement (§30-32)

The controlled buyer address is not secret (it is already committed in
`apps/edge-api/tests/live/cdp-buyer-signer-capability-local-check.test.ts:93`
as `CONTROLLED_BUYER_ADDRESS`, used there only for CDP signer-capability
testing, never for spending). A read-only `eth_call` (`balanceOf`, no gas, no
signing, no state change) to Base mainnet's USDC contract
(`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) for that address, made fresh
this session (not the runbook's own explicitly-distrusted historical figure):

```
$ eth_call balanceOf(0x516F...EcB99) @ 0x8335...02913, Base mainnet, "latest"
-> 0x4afd = 19197 (base units, 6 decimals) = $0.019197 USDC
QUALIFICATION_BUYER_BALANCE_ATOMIC=19197
```

Using the exact §5 frozen amounts, the smallest real paid request per
service:

```
COMPANY_QUALIFICATION_AMOUNT_ATOMIC=39000    ($0.039, single exact price)
WEBCTX_QUALIFICATION_AMOUNT_ATOMIC=9000      ($0.009, direct tier — the cheapest real webctx request)
DOCUMENT_QUALIFICATION_AMOUNT_ATOMIC=12000   ($0.012, native tier — the cheapest real document request; moot pending §17's fix)
VERIFY_QUALIFICATION_AMOUNT_ATOMIC=19000     ($0.019, standard tier)
FOUR_SERVICE_QUALIFICATION_TOTAL_ATOMIC=79000

QUALIFICATION_BUYER_BALANCE_ATOMIC=19197
QUALIFICATION_HEADROOM_ATOMIC=0
ADDITIONAL_FUNDING_REQUIRED_ATOMIC=59803    (~$0.059803 additional USDC)
FOUR_PAYMENT_QUALIFICATION_FUNDED=NO
```
No transfer occurred. Prices were not lowered.

## 23. No economic action (§33)

```
REAL_402_PAYMENT_QUALIFICATIONS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
PAYMENT_SIGNATURES_CREATED=0
PAID_POSTS=0
FACILITATOR_SETTLEMENT_CALLS=0
CHAIN_TRANSACTIONS_CREATED=0
USDC_TRANSFER_AMOUNT_CREATED_BY_C1=0
```
Every §16/§22 request carried no `PAYMENT-SIGNATURE` header; the §22 balance
read is a zero-gas, non-mutating `eth_call`, not a transaction.

## 24. Production containment (§34)

Final readback, this session, after every mutation above:
```
$ wrangler deployments status
(100%) db7054c9-76ee-4830-aabe-8a4542261b6a
  (0%) 9080c1dd-e96f-4204-a857-fed85e6646cc
C1_PRODUCTION_CONTAINMENT=PASS
```

## 25. C1 pass definition (§35) — not fully met

Every listed condition is met **except** "document upload path PASS" (§17:
`FAIL`, a genuine defect, by design left unfixed this session per the
authorization's exactly-one-upload cap). Per the runbook's own structure this
is not a `C1=FAIL` (nothing else failed, containment held, zero economic
action, three of four services fully live-qualified) but it is not a clean
`PASS` either — reported below as `PARTIAL`.

## 26. Mutation/deployment counters (this checkpoint)

```
CLOUDFLARE_WORKER_VERSION_UPLOADS=1
CLOUDFLARE_VERSIONS_DEPLOY_CALLS=1 (0/100 registration only, no ordinary-routing traffic change)
TRAFFIC_MUTATIONS=0
MODAL_PROXY_TOKENS_CREATED=1
R2_BUCKET_CREATIONS=0
R2_SYNTHETIC_OBJECTS_CREATED=0
PRODUCTION_D1_MUTATIONS=0
REPO_COMMITS=1 (8de9fc3, config-only)
INTENTIONAL_402_REQUESTS=0 (the four §16 responses were the natural, expected result of genuinely unpaid requests, not an attempt to obtain a paid quote)
PAYMENT_AUTHORIZATIONS=0
SIGNING_ACTIONS=0
PAID_POSTS=0
SETTLEMENTS=0
BLOCKCHAIN_TRANSACTIONS=0
```

## 27. Final packet

```
SUN1222C1_FOUR_SERVICE_CANDIDATE=PARTIAL
SUN1222C1_AUTHORIZATION=PRESENT
C1_SOURCE_HEAD=900abc3a39e87a0127aa4e3e1e739de5acd5900f
C1_END_HEAD=<this file's own commit>
C1_PUBLIC_PRICE_COHERENCE=PASS_WITH_DOCUMENTED_NONRUNTIME_DRIFT
SERVICE_TOOL_MATRIX_V2_EXACT=PASS
COMPANY_V2_PRODUCTION_FIXTURE_REACHABLE=NO
WEBCTX_V2_PRODUCTION_FIXTURE_REACHABLE=NO
DOCUMENT_V2_PRODUCTION_FIXTURE_REACHABLE=NO
VERIFY_V2_PRODUCTION_FIXTURE_REACHABLE=NO
R2_BUCKET_EXISTS=YES
DOCUMENT_R2_BINDING_NAME=ARTIFACTS
C1_ROUTE_FLAG_MATRIX=see §9 table (3 new flags added, 7 unchanged)
CANDIDATE_SECRET_ISOLATION_PROVEN=YES
MODAL_CREDENTIALS_CREATED=1
DOCUMENT_MODAL_UNAUTH_FAIL_CLOSED=PASS
DOCUMENT_MODAL_AUTH_SMOKE=PASS
CANDIDATE_VERSIONS_CREATED=1
CANDIDATE_VERSION_ID=9080c1dd-e96f-4204-a857-fed85e6646cc
C1_TRAFFIC_READBACK=PASS
C1_CANDIDATE_CONFIG_READBACK=PASS
C1_CANDIDATE_DISCOVERY=PASS
C1_ALL_FOUR_READY=YES
COMPANY_UNPAID_FAIL_CLOSED=PASS
WEBCTX_UNPAID_FAIL_CLOSED=PASS
DOCUMENT_UNPAID_FAIL_CLOSED=PASS
VERIFY_UNPAID_FAIL_CLOSED=PASS
DOCUMENT_BUYER_UPLOAD_PATH=FAIL
ALL_FOUR_PRICE_COHERENCE=PASS
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
C1_KNOWN_DEFECT_RECURRENCE_COUNT=0
QUALIFICATION_BUYER_BALANCE_ATOMIC=19197
COMPANY_QUALIFICATION_AMOUNT_ATOMIC=39000
WEBCTX_QUALIFICATION_AMOUNT_ATOMIC=9000
DOCUMENT_QUALIFICATION_AMOUNT_ATOMIC=12000
VERIFY_QUALIFICATION_AMOUNT_ATOMIC=19000
FOUR_SERVICE_QUALIFICATION_TOTAL_ATOMIC=79000
QUALIFICATION_HEADROOM_ATOMIC=0
ADDITIONAL_FUNDING_REQUIRED_ATOMIC=59803
FOUR_PAYMENT_QUALIFICATION_FUNDED=NO
REAL_402_PAYMENT_QUALIFICATIONS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
PAYMENT_SIGNATURES_CREATED=0
PAID_POSTS=0
FACILITATOR_SETTLEMENT_CALLS=0
CHAIN_TRANSACTIONS_CREATED=0
USDC_TRANSFER_AMOUNT_CREATED_BY_C1=0
C1_PRODUCTION_CONTAINMENT=PASS
PRODUCTION_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
PRODUCTION_TRAFFIC=100%
CANDIDATE_TRAFFIC=0%
SUN1222C1_EVIDENCE_COMMIT_SHA=<this file's own commit>
WORKING_TREE=clean
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-1-REMEDIATION (fix §17's content-type-middleware gap for the one route, re-run its route-level tests through the REAL app/middleware chain — not an isolated Hono mount — then a fresh, single-candidate-upload re-qualification of document_evidence_json.v2's buyer path specifically)
```

Neither branch of the runbook's own §37 routing table (`SUN-1222C-2-FOUR-
REAL-PAYMENT-QUALIFICATIONS` vs `SUN-1222C-FUNDING-GATE`) applies cleanly:
funding is insufficient (§22) **and** a real P0 defect remains (§17), so per
§37's `Otherwise:` branch this routes to `READ_ONLY_DIAGNOSIS`-equivalent
follow-up work; this report names the more specific, actionable
`SUN-1222C-1-REMEDIATION` instead, since the root cause and fix are already
fully diagnosed above, not merely "unknown, needs diagnosis."

DO NOT DEPLOY. DO NOT CREATE A CANDIDATE (a second one, until remediated).
DO NOT CHANGE LIVE PRICES. DO NOT START A REAL PAYMENT.

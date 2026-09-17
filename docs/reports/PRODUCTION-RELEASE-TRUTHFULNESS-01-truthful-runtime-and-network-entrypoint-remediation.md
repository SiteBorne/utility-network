# PRODUCTION-RELEASE-TRUTHFULNESS-01 — Truthful Runtime and Network Entrypoint Remediation

## 1. Result

`PRODUCTION_RELEASE_TRUTHFULNESS_01=PASS`.

The source now represents the intended initial release truthfully: the public
runtime may be ready while paid service admission remains disabled by policy.
Real release dependencies still fail readiness. Both public host scopes have a
source-controlled RFC 9116 document. The `siteborne.net` apex failure is
isolated to the Cloudflare-to-origin layer and is deliberately retained as a
final cutover action rather than repaired through an unrelated Worker route.

This checkpoint did not build or upload a Worker, deploy, change traffic, change
Cloudflare, activate economics, or invert metadata authority.

## 2. Authoritative provenance

| Item                         | Value                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------- |
| Branch                       | `metadata-vcm-qualification`                                                     |
| Starting local HEAD          | `4e43d9045a315218376b739807bd83e7848beeec`                                       |
| Starting remote HEAD         | `4e43d9045a315218376b739807bd83e7848beeec`                                       |
| Starting provenance          | `PASS`                                                                           |
| Governing audit              | `docs/reports/PRODUCTION-PRECUTOVER-release-gate-inventory-and-critical-path.md` |
| Stable Worker                | `38cbf4dd-52fd-4afc-ad34-626a2e6454d3 @ 100%`                                    |
| Existing qualified candidate | `287bcd9f-98d1-4741-a832-76dfa88b202c @ 0%`                                      |
| Existing deployment          | `7e19fd3e-ccea-4680-9e63-06bcbd0625bd`                                           |

The governing initial release remains a **truthful quiescent public production
runtime** with `PAID_ROUTES_ENABLED=false`. Later economic activation is a
separate service-specific release phase.

## 3. Fresh pre-mutation observations

Read-only probes on 2026-09-17 reproduced the triggering facts:

| Surface                                          | HTTP/content type      | Observed body semantics                                                        |
| ------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------ |
| `utility.siteborne.net/health`                   | `200 application/json` | `status=ok`                                                                    |
| `utility.siteborne.net/ready`                    | `200 application/json` | hardcoded `not_ready`, `phase=foundation`, and three obsolete blocker literals |
| `utility.siteborne.net/`                         | `200 application/json` | `status=preproduction foundation`                                              |
| `utility.siteborne.net/.well-known/security.txt` | `404 text/plain`       | missing                                                                        |
| `siteborne.net/`                                 | `525 text/plain`       | Cloudflare error                                                               |
| `siteborne.net/.well-known/security.txt`         | `525 text/plain`       | same apex failure                                                              |
| `siteborne.net/.well-known/mcp-registry-auth`    | `200 text/plain`       | exact narrow Worker route remains healthy                                      |

These are observations of the unchanged deployed versions. The new local source
was not uploaded, so the deployed stale responses are expected to remain until
the replacement candidate checkpoint.

## 4. Stale release-state source trace

Seven current source or public-document locations carried stale initial-release
semantics.

| Path / symbol                                                        | Publicly exposed              | Consumer                                     | Before                                                                 | Classification / action                                                        |
| -------------------------------------------------------------------- | ----------------------------- | -------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `apps/edge-api/src/routes/readiness.ts` / `readinessRoute`           | YES                           | `/ready` machine clients and OpenAPI clients | static `not_ready`, `foundation`, three resolved/optional blockers     | stale operational truth; replaced by deterministic derivation                  |
| `apps/edge-api/src/index.ts` / root handler                          | YES                           | utility-origin discovery clients             | `preproduction foundation`                                             | stale operational label; now consumes the same derived state                   |
| `apps/edge-api/src/control-plane/routes/catalog.ts` / `openapiRoute` | YES                           | `/openapi.json` clients                      | `0.0.0-preproduction` and preproduction prose                          | stale current control-plane prose; corrected without changing paths or schemas |
| `apps/network-site/index.html`                                       | intended public apex          | machine identity clients                     | foundation, planned protocols, obsolete prices, no-live-services claim | stale static identity content; replaced with paid-disabled production truth    |
| `README.md`                                                          | YES, repository documentation | operators and contributors                   | current Foundation status and implemented packages marked planned      | stale current status; historical ledgers are now labeled historical            |
| `apps/docs/README.md`                                                | YES, repository documentation | documentation readers                        | Preproduction Foundation                                               | stale current status; points to the current pre-cutover audit                  |
| `SECURITY.md`                                                        | YES, repository policy        | vulnerability reporters                      | pre-production qualifier and conditional mailbox                       | stale qualifier; designated contact retained unchanged                         |

Occurrences deliberately left unchanged belong to different time or authority
domains:

- accepted `contracts/releases/*` and the matching generated service-contract
  OpenAPI are frozen release evidence;
- `protocol_status=preproduction`, payment-network preproduction constants, and
  `production_enabled=false` describe paid capability admission rather than
  public-runtime health;
- migration names, historical checkpoint documents, tests, and frozen protocol
  baselines preserve their original context;
- `PROJECT_STATE.yaml` and `TASKS.yaml` remain validated historical ledgers and
  were not converted into current runtime authority.

## 5. Public field semantics and compatibility

| Field                             | Existing contract | Meaning after this checkpoint                            | Initial-release value                                            | Contract change               |
| --------------------------------- | ----------------- | -------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------- | ----------- |
| health `status`                   | literal `ok`      | process/runtime responds and middleware is functioning   | `ok`                                                             | none                          |
| readiness `status`                | `ready            | not_ready`                                               | required public-release dependencies are usable                  | `ready` when predicate passes | values only |
| readiness `phase`                 | string            | configured public release stage                          | `production`; malformed/unset environment becomes `unconfigured` | values only                   |
| `production_services_enabled`     | boolean           | at least one governed paid service is effectively active | `false`                                                          | none                          |
| `blocked_external`                | string array      | concrete public-runtime dependency failures              | empty when ready                                                 | values only                   |
| root `status`                     | string            | same public release result as `/ready`                   | `ready`                                                          | values only                   |
| catalog/service `protocol_status` | `preproduction    | production`                                              | paid service activation/presentation                             | unchanged                     | none        |

`PUBLIC_CONTRACT_CHANGED=VALUES_ONLY_SCHEMA_PRESERVED` and
`NEW_PUBLIC_CONTRACT_REQUIRED=NO`. The contract already represented the needed
truth. No field was added, removed, renamed, or retyped. OpenAPI paths and
response schemas are unchanged; only current control-plane version/prose values
were corrected.

## 6. Deterministic readiness predicate

`derivePublicReleaseState()` is the single current source for the utility root
and `/ready`. Its paid-disabled release predicate is:

1. `ENVIRONMENT` is exactly `production`;
2. the D1 `DB` binding needed by current public request paths is present;
3. the existing Agent Card signing identity is configured and can be resolved by
   the existing signing-identity validator.

Paid activation is derived independently through
`resolveEffectiveProductionStatusByServiceId()`. It never gates public-runtime
readiness. A missing DB binding, missing signing identity, partially configured
identity, malformed key, or unknown environment still produces `not_ready` with
a specific bounded blocker. No active provider call or expensive remote probe
occurs on `/ready`.

The healthy paid-disabled response is:

```json
{
  "status": "ready",
  "phase": "production",
  "production_services_enabled": false,
  "blocked_external": [],
  "reason": "Public production runtime ready; paid services disabled by policy."
}
```

Health remains a liveness response. Readiness covers the intended public
release. Capability activation remains a separate boolean and continues to be
false.

## 7. Implementation commits and exact changes

1. `0eca0c5f510db920674731e709bf19deaf8c0f7d` — derive truthful public runtime
   state, integrate root/readiness, correct the static apex identity, and add
   the release-state matrix.
2. `d8e2cdf91beecb8d74c9fd83c7d1e8173a97a2b2` — publish hostname-scoped RFC 9116
   sources and correct the security policy qualifier.
3. `dddbc4b857999eee2126f44e52c9da17cf2241ca` — correct current OpenAPI and
   repository-facing release prose while preserving frozen release artifacts.

No registry, VCM, protocol, economic, governance, schema, contract-release,
Cloudflare configuration, secret-bearing, migration, queue, workflow, Cron, or
payment execution file changed.

## 8. Strict TDD evidence

### Release state RED

The initial focused run failed 13 of 38 tests for the intended missing behavior:
hardcoded foundation/preproduction values, paid-disabled readiness, real
dependency failures, static apex claims, and current control-plane prose. It did
not fail for imports, fixtures, or syntax.

### Release state GREEN

The focused truthfulness/readiness/routes/edge set passed after minimal
implementation. The final combined focused run passed **44/44** across five
files.

### Security.txt RED

Before implementation, the utility path returned 404, the apex artifact and
static media-type configuration did not exist, and the policy still qualified
the contact as not yet configured. Unsupported POST already followed the
existing 415 request-validation convention and was retained.

### Security.txt GREEN

The focused RFC 9116 suite passed **5/5**. It proves UTF-8, exact media type,
one authorized Contact, exactly one future RFC3339 Expires, host-correct
Canonical, absence of invented Policy/Encryption fields, no secret-like
material, no payment/provider binding access, and no alternate behavior for
unsupported methods.

### Qualification-only timeout classification

The normal concurrent full edge run produced 1,608 passes and two timeout-only
failures: the five-second production CDP mock and the 60-second steady-load
case. Both passed in isolation (**2/2** and **7/7** respectively). The complete
edge suite then passed single-worker with **1,610/1,610**, 72 intentional live
skips. The product assertions and load work completed; the failures were host
contention under concurrent execution, not product defects.

## 9. RFC 9116 design and hostname scope

`SECURITY.md` explicitly authorizes `security@siteborne.net` for vulnerability
reports. The checkpoint did not infer authority from mailbox existence.

| Host                    | Public service | Required | Serving component               | Source                                                       | Canonical                                                |
| ----------------------- | -------------- | -------- | ------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| `utility.siteborne.net` | YES            | YES      | edge Worker                     | `apps/edge-api/src/routes/security-txt.ts`                   | `https://utility.siteborne.net/.well-known/security.txt` |
| `siteborne.net`         | YES            | YES      | intended static identity origin | `apps/network-site/.well-known/security.txt` plus `_headers` | `https://siteborne.net/.well-known/security.txt`         |

Both documents use:

```text
Contact: mailto:security@siteborne.net
Expires: 2027-08-31T23:59:59Z
```

The expiry is a deterministic release-declared value, less than one year after
construction. Every future release qualification must refresh or revalidate it.
Runtime-generated dates were rejected because they would make the artifact
non-deterministic. No Policy, Encryption, Acknowledgments, Hiring, or other
optional field was invented.

The apex file is source-ready but cannot become live until the intended static
origin is attached. The utility file becomes live only in a future replacement
Worker candidate. Current live 404/525 results therefore do not contradict the
local implementation result.

## 10. Apex read-only diagnosis

### Evidence

- `siteborne.net/` and its security path return Cloudflare HTTP 525.
- The browser-facing TLS handshake to Cloudflare succeeds with a currently valid
  `siteborne.net` certificate. This rules out client-to-edge certificate
  failure.
- `siteborne.net/.well-known/mcp-registry-auth` returns 200 because the exact
  path is intercepted by the configured Worker route.
- DNS uses Cloudflare nameservers and proxied A/AAAA responses; MX remains at
  IONOS.
- `wrangler.toml` explicitly records that the proxied apex has no valid origin
  and that only the registry-auth path is intercepted.
- `docs/operations/MCP_PROTOCOL.md` independently says the apex has no other
  origin behind it.
- the master directive defines `siteborne.net` as network identity and
  `utility.siteborne.net` as the canonical machine-service origin;
  `apps/network-site/index.html` is the dedicated machine-first static source.

### Conclusion

```text
SITEBORNE_APEX_INTENDED_OWNER=APPS_NETWORK_SITE_STATIC_NETWORK_IDENTITY_COMPONENT
SITEBORNE_APEX_INTENDED_BEHAVIOR=HTTPS_200_STATIC_NETWORK_IDENTITY_WITH_HOST_SCOPED_SECURITY_TXT
CURRENT_OWNER=CLOUDFLARE_PROXY_TO_UNUSABLE_ORIGIN_WITH_ONE_EXACT_WORKER_ROUTE
CURRENT_BEHAVIOR=525_EXCEPT_EXACT_MCP_REGISTRY_AUTH_INTERCEPT
ARCHITECTURAL_MISMATCH=STATIC_IDENTITY_SOURCE_EXISTS_BUT_NO_VALID_APEX_STATIC_ORIGIN_IS_ATTACHED
APEX_FAILURE_LAYER=CLOUDFLARE_TO_ORIGIN_TLS
APEX_ROOT_CAUSE=PROXIED_APEX_HAS_NO_VALID_TLS_ORIGIN;_ONLY_MCP_REGISTRY_AUTH_IS_WORKER_INTERCEPTED
ROOT_CAUSE_CONFIDENCE=HIGH
APP_SOURCE_FIX_REQUIRED=NO_FOR_525
NETWORK_CONFIG_FIX_REQUIRED=YES
ORIGIN_FIX_REQUIRED=YES_BY_ATTACHING_A_VALID_STATIC_ORIGIN
```

This conclusion does not disclose or assume an origin address. HTTP 525 is an
edge-to-origin class, and repository configuration expressly records the missing
valid origin.

## 11. Remediation options and decision

| Option                                                                                                                                                  | Layer                              | Public effect                                                 | Blast radius / rollback                                                                 | Decision     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------ |
| Publish `apps/network-site` as a static Cloudflare site and attach only the apex custom domain, preserving the exact MCP auth Worker route and mail DNS | static hosting / domain attachment | intended identity page and apex security.txt become HTTPS 200 | bounded to apex web service; detach custom domain and restore previous proxied record   | **selected** |
| Repair an unspecified legacy origin certificate                                                                                                         | origin TLS                         | could remove 525                                              | depends on an origin for which the repository has no current ownership/content evidence | rejected     |
| Redirect apex to utility origin                                                                                                                         | network routing                    | healthy redirect                                              | erases the distinct network-identity surface                                            | rejected     |
| Bind `siteborne.net/*` to the utility Worker                                                                                                            | Worker route                       | removes 525                                                   | hijacks apex namespace and violates the explicit narrow-route architecture              | rejected     |

`NETWORK_DECISION=B`: the static-site custom-domain attachment is a final
cutover mutation and must not be executed during this source checkpoint. The
candidate can be built and qualified at 0% beforehand. The operator command or
exact UI mutation must be precomputed only after the target static-site project
and custom-domain object are fixed in the candidate/cutover plan. Its rollback
is detaching that custom domain and restoring the immediately preceding apex web
routing while leaving MX and the exact MCP authentication route intact.

No network mutation was necessary now, so the human-mutation stop rule was not
triggered.

## 12. DNSSEC

Public DNS inspection returned neither a parent DS record nor a zone DNSKEY.
That is a consistently unsigned delegation, not an incomplete/bogus chain.

```text
DNSSEC_STATUS=DISABLED
INTERNAL_RELEASE_REQUIREMENT=NO_CURRENT_REQUIREMENT;_ONLY_HISTORICAL_TASK_AND_CHECKLIST_ENTRIES
EXTERNAL_PROTOCOL_REQUIREMENT=NONE_FOUND
MARKETPLACE_REQUIREMENT=NONE_FOUND
SECURITY_HARDENING_VALUE=YES
BLOCKS_INITIAL_CUTOVER=NO
DNSSEC_RELEASE_CLASSIFICATION=OPTIONAL_POST_CUTOVER_HARDENING
```

Enabling DNSSEC requires a separate registrar-aware plan, including Cloudflare
signing state, exact DS publication, propagation verification, and a safe
rollback. This checkpoint did not risk creating a broken chain.

## 13. Non-regression and authority boundaries

### Economics

- `PAID_ROUTES_ENABLED` remains false in the qualified deployment and no
  configuration was changed.
- no price, seller wallet, quote construction, production-enable authority,
  payment environment, CDP approval, provider gate, settlement, x402, or
  Nevermined implementation changed;
- security.txt and readiness perform no provider or payment call;
- `ECONOMIC_AUTHORITY_CHANGED=NO`, `ECONOMIC_SIDE_EFFECT_DELTA=NONE`, and
  `PAID_EXECUTION_ACTIVATED=NO`.

### VCM and protocol authority

- no VCM file changed;
- `vcm_primary_compare` remains implemented and `vcm_only` remains unservable;
- legacy builders and comparators remain executable;
- A2A signing still occurs through the existing signer after selection;
- MCP executable handlers are untouched;
- `VCM_ARCHITECTURE_CHANGED=NO`, `AUTHORITY_INVERSION=NO`.

### Stateful systems

No D1 schema, R2, KV, queue, workflow, scheduled handler, storage alert, payment
recovery, artifact-management, or continuation file changed.
`STATEFUL_SIDE_EFFECT_DELTA=NONE` and `CRON_CHANGE=NO`.

## 14. Local qualification

| Gate                                      | Result                                                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused release/readiness/security routes | **44/44 PASS**                                                                                                                                    |
| RFC 9116 focused suite                    | **5/5 PASS**                                                                                                                                      |
| VCM suite (repository-root invocation)    | **143/143 PASS**                                                                                                                                  |
| Package-local VCM command                 | known root-relative discovery limitation: zero files; superseded by repository-root 143/143 run                                                   |
| A2A check                                 | **73/73 executed tests PASS**; fixture validation is intentionally repeated; spec fixture PASS                                                    |
| MCP check                                 | **188/188 executed tests PASS**; spec, metadata, pack/offline-install PASS                                                                        |
| x402/Bazaar check                         | **532/532 PASS**; fixture/spec verification PASS                                                                                                  |
| edge API                                  | concurrent run 1,608 pass plus two contention timeouts; isolated reruns pass; final single-worker **1,610/1,610 PASS**, 72 intentional live skips |
| typecheck                                 | **25/25 tasks PASS**                                                                                                                              |
| lint                                      | **17/17 tasks PASS**                                                                                                                              |
| changed-file formatting                   | PASS for all formatter-supported changed files; plain `security.txt` and `_headers` validated by content tests and `git diff --check`             |
| PCC/service/OpenAPI/input-validator drift | PASS; no drift                                                                                                                                    |
| schema validation                         | PASS                                                                                                                                              |
| registry/economic validation              | pricing registry **8/8**, governed pricing 15 keys PASS                                                                                           |
| governance/state/tasks                    | **77/77**, **30/30**, **252/252 PASS**                                                                                                            |
| contracts                                 | baseline, compatibility, release verification PASS                                                                                                |
| secret scan                               | 857 commits plus working tree scanned; no leaks                                                                                                   |
| `git diff --check`                        | PASS                                                                                                                                              |

The package-local VCM discovery failure and concurrent timeout artifacts are
recorded rather than concealed. Neither reproduces when invoked through the
valid root suite or bounded single-worker execution.

## 15. Remaining pre-cutover path

The repository is ready to build the replacement immutable candidate. Remaining
work is operational and evidence-bearing:

1. build one immutable Worker candidate from the closure commit with the
   already-qualified `vcm_primary_compare` modes and
   `PAID_ROUTES_ENABLED=false`;
2. install it at 0% beside the current stable version and requalify
   exact-version release state, security.txt, A2A, MCP, configuration, bindings,
   and Cron;
3. prepare and human-operate the apex static-site/custom-domain attachment as a
   final cutover action, preserving the narrow MCP auth route and mail records;
4. obtain separate human authorization for the 100% Worker cutover;
5. perform post-cutover public, version-attributed, scheduled, and organic
   traffic validation.

No 12–24 hour pre-cutover organic-traffic wait is reintroduced. Paid economic
activation remains a later, separately authorized release.

## 16. Closure decision

```text
PRODUCTION_RELEASE_TRUTHFULNESS_01=PASS
PUBLIC_RUNTIME_STAGE=production
PUBLIC_RUNTIME_STATUS=ready
PUBLIC_RUNTIME_READY=YES
PAID_ROUTES_ENABLED=false
PAID_CAPABILITIES_ACTIVE=NO
PUBLIC_CONTRACT_CHANGED=VALUES_ONLY_SCHEMA_PRESERVED
NEW_PUBLIC_CONTRACT_REQUIRED=NO
SECURITY_TXT_IMPLEMENTED=YES_SOURCE_READY_BOTH_HOSTS
SECURITY_TXT_RFC9116_VALIDATION=PASS
NETWORK_DECISION=B
NETWORK_MUTATION_PERFORMED=NO
DNSSEC_STATUS=DISABLED
DNSSEC_BLOCKS_INITIAL_CUTOVER=NO
VCM_ARCHITECTURE_CHANGED=NO
VCM_ONLY_SERVABLE=NO
AUTHORITY_INVERSION=NO
A2A_SIGNER_CHANGED=NO
MCP_HANDLER_IDENTITY_CHANGED=NO
ECONOMIC_AUTHORITY_CHANGED=NO
ECONOMIC_SIDE_EFFECT_DELTA=NONE
STATEFUL_SIDE_EFFECT_DELTA=NONE
CRON_CHANGED=NO
CLOUDFLARE_MUTATIONS=0
WORKER_UPLOADS=0
DEPLOYMENTS=0
TRAFFIC_MUTATIONS=0
SAFE_TO_BUILD_REPLACEMENT_IMMUTABLE_CANDIDATE=YES
NEXT_CHECKPOINT_RECOMMENDATION=PRODUCTION-RELEASE-CANDIDATE-01
```

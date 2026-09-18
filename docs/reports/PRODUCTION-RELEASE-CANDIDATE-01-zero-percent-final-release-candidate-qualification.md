# PRODUCTION-RELEASE-CANDIDATE-01 Zero-Percent Final Release Candidate Qualification

## 1. Decision

`PRODUCTION-RELEASE-CANDIDATE-01` **PASS**.

Immutable Worker version `ab9f0ebe-21ea-415a-a770-70f9cf1bec08` was built from
the truthful release source, audited against the previously qualified
primary-compare candidate, installed beside the stable version at zero percent,
and qualified through exact-version live requests. The replacement candidate
serves truthful paid-disabled production readiness, a valid RFC 9116
`security.txt`, a signed A2A Agent Card selected through the successful VCM
primary-compare path, and the exact six MCP tools selected through the
successful VCM primary-compare path.

The active deployment remains stable at 100% and the replacement candidate at
0%. This result qualifies the artifact for a later final cutover preflight. It
does not authorize nonzero traffic, the apex attachment, paid execution,
`vcm_only`, or authority inversion.

```text
FINAL_REPLACEMENT_CANDIDATE_QUALIFIED_AT_ZERO_PERCENT=YES
NORMAL_TRAFFIC_TO_CANDIDATE=0%
PRODUCTION_CUTOVER=NO
AUTHORITY_INVERSION_PERFORMED=NO
```

## 2. Source and checkpoint provenance

| Fact                                      | Value                                      |
| ----------------------------------------- | ------------------------------------------ |
| Repository                                | `SITEBORNE Utility Network`                |
| Branch                                    | `metadata-vcm-qualification`               |
| Starting local HEAD                       | `9ebecc88d2d502cd7de5ae408b872ca85f66f86e` |
| Starting remote HEAD                      | `9ebecc88d2d502cd7de5ae408b872ca85f66f86e` |
| Starting worktree                         | clean                                      |
| Truthfulness checkpoint                   | `PRODUCTION_RELEASE_TRUTHFULNESS_01=PASS`  |
| Truthfulness implementation base          | `4e43d9045a315218376b739807bd83e7848beeec` |
| VCM primary-compare implementation source | `657d30c0c43f262ce110b07b90c58edf05b510b3` |
| Earlier VCM zero-percent evidence         | `0726fd035764b52da8bee53ac55c1e757ff91df3` |
| Candidate source                          | `9ebecc88d2d502cd7de5ae408b872ca85f66f86e` |
| Wrangler                                  | `4.119.0`                                  |

The remote ref was refreshed before the upload gate. Local HEAD and
`origin/metadata-vcm-qualification` were equal, and no uncommitted runtime code
existed. A report-only closure commit at the candidate source does not weaken
runtime provenance: the uploaded bundle was built from that exact clean tree.

The governing truthfulness evidence is
[`PRODUCTION-RELEASE-TRUTHFULNESS-01-truthful-runtime-and-network-entrypoint-remediation.md`](./PRODUCTION-RELEASE-TRUTHFULNESS-01-truthful-runtime-and-network-entrypoint-remediation.md).

## 3. Starting deployment

Read-only Cloudflare status before either human mutation showed:

| Fact                 | Value                                          |
| -------------------- | ---------------------------------------------- |
| Deployment ID        | `7e19fd3e-ccea-4680-9e63-06bcbd0625bd`         |
| Strategy             | `percentage`                                   |
| Stable               | `38cbf4dd-52fd-4afc-ad34-626a2e6454d3` at 100% |
| Prior candidate      | `287bcd9f-98d1-4741-a832-76dfa88b202c` at 0%   |
| Prior candidate mode | A2A and MCP `vcm_primary_compare`              |
| Paid routes          | disabled                                       |

The preflight also reconstructed the prior candidate's actual version metadata:
18 ordinary variables, 14 secret binding names, the expected resource set,
`fetch` and `scheduled` handlers, compatibility date `2026-08-05`,
`nodejs_compat`, and the standard usage model.

## 4. Human-operated immutable upload

The agent ran only a local Wrangler upload dry run. It bundled the candidate
successfully and resolved the intended bindings and 18 variables without
creating a Worker version.

After the preflight stopped at the mutation boundary, the human operator ran the
one authorized immutable version upload. Wrangler reported:

| Candidate fact                  | Value                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Version ID                      | `ab9f0ebe-21ea-415a-a770-70f9cf1bec08`                                                                                          |
| Worker version number           | `97`                                                                                                                            |
| Created on                      | `2026-09-18T01:40:55.61702Z`                                                                                                    |
| Tag                             | `production-release-candidate-01-paid-disabled`                                                                                 |
| Message                         | `PRODUCTION-RELEASE-CANDIDATE-01: truthful paid-disabled production candidate, source 9ebecc88d2d502cd7de5ae408b872ca85f66f86e` |
| Trigger source                  | `version_upload`                                                                                                                |
| Startup time reported by upload | 177 ms                                                                                                                          |

The upload output contained two unchanged `unenv` bundle warnings concerning a
missing default export in `whatwg-url`. Bundling, startup validation, and upload
completed successfully. These warnings did not alter the candidate or its live
qualification result.

The upload created one immutable version. It did not change deployment
membership, traffic, triggers, routes, secrets, or stateful resources.

## 5. Immutable configuration audit

The uploaded version was read back directly from Cloudflare and compared with
candidate `287bcd9f-98d1-4741-a832-76dfa88b202c`.

### 5.1 Ordinary variables

All 18 ordinary variables matched exactly:

| Variable                                      | Qualified value                             |
| --------------------------------------------- | ------------------------------------------- |
| `A2A_METADATA_PROJECTION_MODE`                | `vcm_primary_compare`                       |
| `AGENT_CARD_SIGNING_KEY_ID`                   | `siteborne-agent-card-2026-08`              |
| `COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED` | `false`                                     |
| `DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED`      | `false`                                     |
| `DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED` | `false`                                     |
| `ENVIRONMENT`                                 | `production`                                |
| `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP`       | `true`                                      |
| `LOG_LEVEL`                                   | `info`                                      |
| `MCP_METADATA_PROJECTION_MODE`                | `vcm_primary_compare`                       |
| `NVM_ENVIRONMENT`                             | `sandbox`                                   |
| `PAID_ROUTES_ENABLED`                         | `false`                                     |
| `PAYMENT_ENVIRONMENT`                         | `production`                                |
| `PCC_VERSION`                                 | `1.0.0`                                     |
| `PRODUCTION_CDP_CREDENTIALS_APPROVED`         | `true`                                      |
| `PRODUCTION_ENABLED`                          | `true`                                      |
| `SELLER_WALLET_ADDRESS`                       | unchanged governed public receiving address |
| `VERIFY_V2_CDP_ROUTE_ENABLED`                 | `true`                                      |
| `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED`            | `true`                                      |

`PAID_ROUTES_ENABLED=false` is the operative economic activation gate. The
presence of production configuration and approved credentials does not activate
paid execution while that gate remains false.

### 5.2 Secrets

Cloudflare reported 14 secret bindings. The binding-name set was identical to
the prior candidate. No secret was read, changed, printed, or copied into this
report.

```text
SECRET_BINDING_NAME_COUNT=14
SECRET_BINDING_NAME_SET_DELTA=NONE
```

### 5.3 Resources, runtime, and handlers

| Area                                     | Result                             |
| ---------------------------------------- | ---------------------------------- |
| D1 `DB`                                  | exact parity                       |
| R2 `ARTIFACTS`                           | exact parity                       |
| KV `CATALOG`                             | exact parity                       |
| `JOBS` and `EVENTS` queues               | exact parity                       |
| `PAID_CONTINUATION_WORKFLOW`             | exact parity                       |
| AI and Browser                           | exact parity                       |
| `STORAGE_ALERT_RECEIVER` service binding | exact parity                       |
| Compatibility date                       | `2026-08-05`, exact parity         |
| Compatibility flags                      | `nodejs_compat`, exact parity      |
| Usage model                              | `standard`, exact parity           |
| Entry-point handlers                     | `fetch`, `scheduled`, exact parity |

No trigger deployment occurred. The existing every-minute Cron was not
redeclared or changed.

### 5.4 Delta classification

The repository delta from the earlier primary-compare source to this source
contains the truthfulness work: derived public release state, readiness wiring,
utility-origin RFC 9116 `security.txt`, static apex identity preparation, tests,
documentation, and checkpoint evidence. For the uploaded Worker bundle, the
runtime delta is restricted to truthful public release-state/readiness and
`security.txt` behavior. A2A, MCP, VCM selection, economics, stateful systems,
handlers, and scheduled execution were not changed.

```text
SOURCE_DELTA=TRUTHFUL_RELEASE_STATE_AND_SECURITY_TXT_SOURCE_CHANGES_ONLY
ORDINARY_VAR_DELTA=NONE
SECRET_NAME_DELTA=NONE
RESOURCE_BINDING_DELTA=NONE
COMPATIBILITY_DELTA=NONE
HANDLER_DELTA=NONE
ECONOMIC_CONFIG_DELTA=NONE
PROJECTION_MODE_DELTA=NONE
CANDIDATE_AUDIT=PASS
```

## 6. Human-operated zero-percent deployment

After the immutable audit passed, the agent ran only a Wrangler deployment dry
run. It resolved the exact stable and candidate versions and the 100/0 split.

The human operator then performed the second and final authorized mutation.
Independent readback established:

| Deployment fact       | Value                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| Deployment ID         | `597a9090-329e-45eb-8645-eb3f5858943d`                                                             |
| Created on            | `2026-09-18T01:42:22.857031Z`                                                                      |
| Strategy              | `percentage`                                                                                       |
| Message               | `PRODUCTION-RELEASE-CANDIDATE-01: human-authorized 100/0 truthful release candidate qualification` |
| Stable                | `38cbf4dd-52fd-4afc-ad34-626a2e6454d3` at 100%                                                     |
| Replacement candidate | `ab9f0ebe-21ea-415a-a770-70f9cf1bec08` at 0%                                                       |

Historical version `287bcd9f-98d1-4741-a832-76dfa88b202c` remains immutable
history but is no longer a member of the active deployment. Normal traffic to
the replacement candidate remained zero percent.

## 7. Exact-version observation method

A candidate-only Wrangler tail was attached to
`ab9f0ebe-21ea-415a-a770-70f9cf1bec08`. Every controlled candidate request used
the Cloudflare Workers version-override header naming that exact version.

The tail attributed all six critical requests to the replacement candidate:

- `GET /health`;
- `GET /ready`;
- `GET /.well-known/security.txt`;
- `GET /.well-known/agent-card.json`;
- `GET /.well-known/jwks.json`; and
- `POST /mcp` with method `tools/list`.

Every trace had `outcome=ok`, HTTP status 200, the exact candidate script
version, and no exception. Client addresses, Ray IDs, TLS fingerprints, and
other unnecessary tail fields are deliberately omitted.

## 8. Truthful health and readiness

### 8.1 Health

The exact candidate `/health` response returned HTTP 200 and `application/json`
with process/runtime-liveness semantics:

```json
{
  "status": "ok",
  "version": "0.0.0",
  "uptime_seconds": 0
}
```

The volatile timestamp is omitted. Health no longer communicates a release phase
or obsolete release blockers.

### 8.2 Readiness

The exact candidate `/ready` response returned HTTP 200 and `application/json`:

```json
{
  "blocked_external": [],
  "phase": "production",
  "production_services_enabled": false,
  "reason": "Public production runtime ready; paid services disabled by policy.",
  "status": "ready"
}
```

This is the intended `TRUTHFUL_QUIESCENT_PUBLIC_PRODUCTION_RUNTIME` state.
Runtime readiness and paid activation are separate facts:

```text
PUBLIC_RUNTIME_STAGE=production
PUBLIC_RUNTIME_STATUS=ready
PUBLIC_RUNTIME_READY=YES
PAID_ROUTES_ENABLED=false
PAID_CAPABILITIES_ACTIVE=NO
```

The live health/readiness output contained none of the obsolete public claims:

```text
PREPRODUCTION_FOUNDATION_EXPOSED=NO
FOUNDATION_PHASE_EXPOSED=NO
STALE_NOT_READY_BLOCKER_EXPOSED=NO
```

## 9. RFC 9116 security.txt

The exact candidate utility-origin security policy returned:

| Fact                     | Result                                                   |
| ------------------------ | -------------------------------------------------------- |
| HTTP status              | 200                                                      |
| Content type             | `text/plain; charset=utf-8`                              |
| UTF-8 decoding           | PASS                                                     |
| Contact count            | 1                                                        |
| Contact                  | `mailto:security@siteborne.net`                          |
| Expires count            | 1                                                        |
| Expires                  | `2027-08-31T23:59:59Z`                                   |
| Expires is in the future | YES                                                      |
| Canonical                | `https://utility.siteborne.net/.well-known/security.txt` |
| Validation               | PASS                                                     |

Retrieving this static policy invoked no payment, provider, authentication, or
stateful execution. The apex security policy remains outside this Worker
candidate and must be verified after the static apex identity origin is
attached.

## 10. A2A primary-compare and signing proof

The exact candidate Agent Card returned HTTP 200 with `application/a2a+json`,
eight skills, and exactly one signature. Its companion JWKS returned HTTP 200
with `application/jwk-set+json`, exactly one public P-256 ES256 key, key ID
`siteborne-agent-card-2026-08`, and no private `d` member.

The candidate-only tail recorded two complete A2A success sequences, one for the
Agent Card request and one for the JWKS request:

```text
metadata_projection_legacy_reference_attempt_total surface=a2a mode=vcm_primary_compare
metadata_projection_primary_attempt_total surface=a2a mode=vcm_primary_compare
metadata_projection_compare_total surface=a2a mode=vcm_primary_compare
metadata_projection_match_total surface=a2a mode=vcm_primary_compare
metadata_projection_primary_success_total surface=a2a mode=vcm_primary_compare
```

There was no A2A mismatch, fallback, validation failure, comparator failure,
primary failure, signing failure, or exception. The repository's governed
`verifyAgentCardAgainstTrustedJwks` verifier was run locally against the exact
candidate Agent Card and exact candidate JWKS; cryptographic verification
passed.

The signing implementation and configured key identifier are unchanged from the
qualified primary-compare candidate. The live sequence and source-level
qualification therefore prove that the semantically matched VCM unsigned card
was selected before entering the existing signer.

```text
A2A_EXACT_CANDIDATE_VERSION_PROVEN=YES
A2A_VCM_PRIMARY_SELECTED=YES
A2A_COMPARE_MATCH=YES
A2A_FALLBACK=NO
A2A_SIGNATURE_VALID=YES
A2A_SIGNER_CHANGED=NO
```

## 11. MCP primary-compare and handler boundary

The exact candidate `POST /mcp` request used:

- `MCP-Protocol-Version: 2026-07-28`;
- `Mcp-Method: tools/list`;
- `Content-Type: application/json`;
- `Accept: application/json, text/event-stream`; and
- the governed protocol-version, client-info, and client-capabilities metadata.

The response returned HTTP 200, `application/json`, JSON-RPC `2.0`, and exactly
these six tools:

1. `siteborne_company_evidence_graph`
2. `siteborne_web_context_verified`
3. `siteborne_document_evidence_json`
4. `siteborne_verify_agent_output`
5. `siteborne_get_quote`
6. `siteborne_get_service_health`

The candidate-only tail recorded one complete MCP success sequence:

```text
metadata_projection_legacy_reference_attempt_total surface=mcp mode=vcm_primary_compare
metadata_projection_primary_attempt_total surface=mcp mode=vcm_primary_compare
metadata_projection_compare_total surface=mcp mode=vcm_primary_compare
metadata_projection_match_total surface=mcp mode=vcm_primary_compare
metadata_projection_primary_success_total surface=mcp mode=vcm_primary_compare
```

There was no MCP mismatch, fallback, validation failure, comparator failure,
primary failure, handler-construction failure, or exception. The request used
`tools/list`; it invoked no tool.

The immutable source retains the already-qualified structural boundary: VCM
provides metadata definitions only, and those definitions carry no executable
handler. The unchanged protocol-MCP service, quote, health, provider, and
economic closures remain the executable authorities at the existing
`registerTool` boundary.

```text
MCP_EXACT_CANDIDATE_VERSION_PROVEN=YES
MCP_VCM_PRIMARY_SELECTED=YES
MCP_COMPARE_MATCH=YES
MCP_FALLBACK=NO
MCP_HANDLER_IDENTITY_PRESERVED=YES
MCP_VCM_HANDLER_FREE=YES
MCP_TOOL_INVOCATIONS=0
MCP_PROVIDER_INVOCATIONS=0
```

## 12. Economic and stateful non-effect

Immutable metadata confirmed `PAID_ROUTES_ENABLED=false`. No qualification
request called a paid route, requested a quote purchase, invoked a tool,
contacted a provider, submitted payment, settled payment, or changed a wallet.

The six routes used for candidate qualification are read-only liveness,
readiness, policy, identity, signing-publication, and definition-discovery
paths. Source and prior local qualification prove these paths do not write D1,
R2, KV, queues, or Workflows. No uncertain live operation was attempted merely
to manufacture a zero count.

```text
PAID_EXECUTION_ACTIVATED=NO
ECONOMIC_SIDE_EFFECTS_OBSERVED=0
D1_MUTATIONS=0
R2_MUTATIONS=0
KV_MUTATIONS=0
QUEUE_WRITES=0
WORKFLOW_CREATIONS=0
PROVIDER_INVOCATIONS=0
PAYMENT_EFFECTS=0
STATEFUL_SIDE_EFFECTS_OBSERVED=0
ECONOMIC_AUTHORITY_CHANGED=NO
```

## 13. Stable public non-regression

After candidate qualification, ordinary requests without a version override
returned:

| Surface                                               | Result                               |
| ----------------------------------------------------- | ------------------------------------ |
| `https://utility.siteborne.net/health`                | HTTP 200, `application/json`         |
| `https://utility.siteborne.net/ready`                 | HTTP 200, `application/json`         |
| `https://siteborne.net/.well-known/mcp-registry-auth` | HTTP 200, `text/plain;charset=UTF-8` |

The stable readiness response retained its earlier `foundation` / `not_ready`
values. That is expected until the actual Worker cutover and is not a candidate
failure. Deployment readback proves normal traffic still routes 100% to the
stable version.

```text
STABLE_REACHABLE=YES
STABLE_BEHAVIOR_UNCHANGED=YES
STABLE_TRAFFIC_UNCHANGED=YES
STABLE_TRUTHFUL_RELEASE_STATE=NOT_YET_EXPECTED
CANDIDATE_TRUTHFUL_RELEASE_STATE=PASS
```

## 14. Apex and DNSSEC scope

The `siteborne.net` apex remains outside this Worker candidate's ownership. The
intended identity component is `apps/network-site`; the current apex 525
origin/TLS condition was not changed or retested as a candidate gate. Candidate
qualification does not attach the apex and does not qualify apex `security.txt`.

```text
APEX_REMEDIATION_PENDING=YES
APEX_REMEDIATION_PHASE=FINAL_CUTOVER_ACTION
DNSSEC_STATUS=DISABLED
DNSSEC_BLOCKS_INITIAL_CUTOVER=NO
DNSSEC_CLASSIFICATION=OPTIONAL_POST_CUTOVER_HARDENING
```

## 15. Reused local qualification

No source, test, configuration, contract, schema, or governance input changed
after the truthful-release closure and before this immutable upload. Re-running
the complete local qualification would therefore duplicate the source-exact
evidence already recorded by `PRODUCTION-RELEASE-TRUTHFULNESS-01`:

- focused release/readiness/security routes: 44/44 pass;
- RFC 9116 focused suite: 5/5 pass;
- VCM: 143/143 pass;
- A2A: 73 executed tests pass;
- MCP: 188 executed tests pass;
- x402/Bazaar: 532/532 pass;
- edge API: final single-worker 1,610/1,610 pass, with 72 intentional live
  skips;
- typecheck: 25/25 tasks pass;
- lint: 17/17 tasks pass;
- drift, schema, pricing, governance, state, task, contract, and secret-scan
  gates pass.

This checkpoint adds artifact-level proof: exact immutable configuration,
exact-version routing, truthful live responses, live primary-compare telemetry,
and cryptographic Agent Card verification.

## 16. Final deployment readback

The closing readback still showed:

```text
DEPLOYMENT_ID=597a9090-329e-45eb-8645-eb3f5858943d
STRATEGY=percentage
STABLE_VERSION=38cbf4dd-52fd-4afc-ad34-626a2e6454d3
STABLE_PERCENT=100%
CANDIDATE_VERSION=ab9f0ebe-21ea-415a-a770-70f9cf1bec08
CANDIDATE_PERCENT=0%
CANDIDATE_TAG=production-release-candidate-01-paid-disabled
CANDIDATE_CREATED_ON=2026-09-18T01:40:55.61702Z
```

No normal candidate traffic, nonzero canary, cutover, route mutation, trigger
mutation, secret mutation, paid activation, `vcm_only` activation, or authority
inversion occurred.

## 17. Remaining cutover path

The remaining work is operational and human-gated:

1. preserve this report-only candidate evidence remotely under separate push
   authorization;
2. run a final cutover preflight and human go/no-go using the immutable IDs in
   this report;
3. human-operate the `siteborne.net` static identity origin/custom-domain
   attachment while preserving the narrow MCP registry-auth route and mail
   records;
4. verify the apex identity page and apex RFC 9116 policy;
5. human-operate the Worker promotion from stable to this candidate at 100%;
6. immediately verify public health, readiness, Agent Card, JWKS, MCP,
   registry-auth, exact serving version, configuration, and scheduled behavior;
7. maintain a bounded rollback watch and begin the real organic-traffic
   baseline; and
8. treat paid economic activation as a later, separately authorized release.

The final cutover checkpoint must derive the dependency order between apex
attachment and Worker promotion; this checkpoint does not authorize or assume
that order.

## 18. Closure matrix

| Gate                            | Result                          |
| ------------------------------- | ------------------------------- |
| Exact source provenance         | PASS                            |
| Immutable configuration audit   | PASS                            |
| Secret-name parity              | PASS                            |
| Resource/runtime/handler parity | PASS                            |
| Zero-percent deployment         | PASS                            |
| Exact candidate attribution     | PASS                            |
| Truthful `/health`              | PASS                            |
| Truthful paid-disabled `/ready` | PASS                            |
| Stale release-state absence     | PASS                            |
| Utility RFC 9116 `security.txt` | PASS                            |
| A2A primary selection and match | PASS                            |
| A2A signature                   | PASS                            |
| MCP primary selection and match | PASS                            |
| MCP exact six-tool set          | PASS                            |
| MCP handler boundary            | PASS                            |
| Economic non-activation         | PASS                            |
| Stateful non-effect             | PASS                            |
| Stable public non-regression    | PASS                            |
| Final 100/0 readback            | PASS                            |
| Apex attachment                 | pending final cutover action    |
| DNSSEC                          | optional post-cutover hardening |

```text
PRODUCTION_RELEASE_CANDIDATE_01=PASS
SAFE_TO_RETAIN_FINAL_ZERO_PERCENT_CANDIDATE=YES
FINAL_REPLACEMENT_CANDIDATE_QUALIFIED=YES
SAFE_FOR_FINAL_CUTOVER_PREFLIGHT=YES
NEXT_CHECKPOINT_RECOMMENDATION=PRODUCTION-CUTOVER-FINAL-01
```

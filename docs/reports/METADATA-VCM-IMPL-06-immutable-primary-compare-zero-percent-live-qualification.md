# METADATA-VCM-IMPL-06 Immutable Primary-Compare Zero-Percent Live Qualification

## 1. Checkpoint result

`METADATA_VCM_IMPL_06=PASS`

An immutable Worker version built from the locally qualified
`vcm_primary_compare` implementation was uploaded by the human operator, audited
before deployment, installed beside the stable version at exactly zero percent
normal traffic, and exercised only through exact Cloudflare version overrides.

Both A2A and MCP live requests produced the required primary-selection lifecycle
evidence: the independent legacy reference was attempted, the VCM primary
projection was attempted, normalized comparison ran, semantic equality matched,
and VCM primary selection succeeded. No mismatch, fallback, projection failure,
validation failure, comparator failure, signing failure, handler-construction
failure, or candidate exception was observed.

This checkpoint did not perform a nonzero canary or production cutover. The
stable version remains at 100% and the qualified candidate remains at 0%.

## 2. Source and qualification provenance

| Fact                              | Value                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| Repository branch                 | `metadata-vcm-qualification`                                                                      |
| Local source HEAD                 | `657d30c0c43f262ce110b07b90c58edf05b510b3`                                                        |
| Remote source HEAD                | `657d30c0c43f262ce110b07b90c58edf05b510b3`                                                        |
| Source working tree before upload | Clean                                                                                             |
| Approved architecture commit      | `620ab84dcce95f0d126ad3f02b08ca590c4e810d`                                                        |
| Approved implementation plan      | `30718cb68ca1ac12df1f321070f1079ff0a60adf`                                                        |
| Implementation closure commit     | `657d30c0c43f262ce110b07b90c58edf05b510b3`                                                        |
| Local qualification report        | `docs/reports/METADATA-VCM-IMPL-05-vcm-primary-compare-implementation-and-local-qualification.md` |
| Local implementation result       | `METADATA_VCM_IMPL_05=PASS`                                                                       |
| Wrangler version                  | `4.119.0`                                                                                         |
| Wrangler profile                  | `storage-alert-bootstrap`                                                                         |
| Worker                            | `siteborne-utility-edge`                                                                          |

No uncommitted source was incorporated. The candidate version message records
the exact qualified implementation commit.

## 3. Starting deployment

Read-only preflight confirmed deployment `97a76f46-a580-4529-8c76-36e9ac35383f`
with percentage strategy:

| Role                           | Version                                | Traffic |
| ------------------------------ | -------------------------------------- | ------: |
| Stable production              | `38cbf4dd-52fd-4afc-ad34-626a2e6454d3` |    100% |
| Historical R3 shadow candidate | `1a3ea07b-5885-49d2-9cd0-d176c4313bd0` |      0% |

The repository, remote branch, pinned Wrangler version, and deployment split all
matched the checkpoint's authoritative starting state before either human
mutation was requested.

## 4. Read-only configuration reconstruction

Read-only inspection of the stable and historical candidate versions proved:

- the stable version carried 16 ordinary variables;
- the historical shadow candidate carried the same 16 variables plus
  `A2A_METADATA_PROJECTION_MODE=shadow_compare` and
  `MCP_METADATA_PROJECTION_MODE=shadow_compare`;
- both versions carried the same 14 secret binding names;
- both versions carried identical D1, R2, KV, queue, Workflow, AI, Browser, and
  service-binding identities;
- both versions exposed `fetch` and `scheduled` handlers;
- both versions used compatibility date `2026-08-05`, compatibility flag
  `nodejs_compat`, and usage model `standard`.

The new candidate command therefore explicitly supplied the same 16 governed
ordinary values and changed only the two projection modes to
`vcm_primary_compare`. It did not use `--keep-vars` and did not include secret
values.

A local `wrangler versions upload --dry-run` using the exact proposed
configuration succeeded. The dry run bundled the qualified source and listed the
expected resources and 18 ordinary variables without uploading anything.

## 5. Human-operated immutable upload

After the read-only upload gate passed, the human operator ran the single
authorized version-upload command. Wrangler reported:

| Candidate fact        | Value                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Version ID            | `287bcd9f-98d1-4741-a832-76dfa88b202c`                                                                           |
| Worker version number | `96`                                                                                                             |
| Created on            | `2026-09-17T14:09:41.4102Z`                                                                                      |
| Tag                   | `metadata-vcm-impl-06-primary-compare-candidate`                                                                 |
| Message               | `METADATA-VCM-IMPL-06: immutable vcm_primary_compare candidate, source 657d30c0c43f262ce110b07b90c58edf05b510b3` |
| Trigger source        | `version_upload`                                                                                                 |

The upload created an immutable version only. Read-only deployment status
immediately afterward still showed the original stable 100% / historical
candidate 0% deployment.

## 6. Immutable candidate audit

The uploaded candidate passed every pre-deployment audit gate:

| Audit area                       | Result                                    |
| -------------------------------- | ----------------------------------------- |
| Source-bearing tag/message       | PASS                                      |
| Ordinary variable count          | 18                                        |
| Governed 16-variable base        | Exact match                               |
| A2A projection mode              | `vcm_primary_compare`                     |
| MCP projection mode              | `vcm_primary_compare`                     |
| Paid routes                      | `PAID_ROUTES_ENABLED=false`               |
| Secret binding-name count        | 14                                        |
| Secret binding-name set          | Exact match                               |
| D1                               | Exact binding parity                      |
| R2 `ARTIFACTS`                   | Exact binding parity                      |
| KV `CATALOG`                     | Exact binding parity                      |
| `JOBS` / `EVENTS` queues         | Exact binding parity                      |
| `PaidContinuationWorkflow`       | Exact binding parity                      |
| AI / Browser                     | Exact binding parity                      |
| `STORAGE_ALERT_RECEIVER` service | Exact binding parity                      |
| Compatibility date/flags/model   | `2026-08-05`; `nodejs_compat`; `standard` |
| Entry-point handlers             | `fetch`, `scheduled`                      |

No secret value was queried or displayed. The audit found no unexpected
configuration delta.

```text
CODE_DELTA=METADATA_VCM_IMPL_05_ONLY
ORDINARY_VAR_DELTA=TWO_PROJECTION_MODE_VALUES_ONLY_RELATIVE_TO_SHADOW_CANDIDATE
SECRET_NAME_DELTA=NONE
RESOURCE_BINDING_DELTA=NONE
COMPATIBILITY_DELTA=NONE
HANDLER_DELTA=NONE
TRIGGER_MUTATION=NONE
ECONOMIC_CONFIG_DELTA=NONE
```

## 7. Human-operated 100/0 deployment

After the candidate audit passed, Wrangler's deployment dry run resolved the
intended versions and percentages exactly. The human operator then ran the one
authorized deployment command.

Wrangler reported success, and independent readback confirmed:

| Deployment fact | Value                                                                             |
| --------------- | --------------------------------------------------------------------------------- |
| Deployment ID   | `7e19fd3e-ccea-4680-9e63-06bcbd0625bd`                                            |
| Strategy        | `percentage`                                                                      |
| Message         | `METADATA-VCM-IMPL-06: human-authorized 100/0 primary-compare live qualification` |
| Stable          | `38cbf4dd-52fd-4afc-ad34-626a2e6454d3` at 100%                                    |
| Candidate       | `287bcd9f-98d1-4741-a832-76dfa88b202c` at 0%                                      |

The historical R3 version remains immutable history but is no longer a member of
the active deployment. No normal traffic was routed to the new candidate.

## 8. Exact-version observation method

A bounded candidate-only Wrangler tail was attached before live probes:

```text
worker=siteborne-utility-edge
version-id=287bcd9f-98d1-4741-a832-76dfa88b202c
format=json
```

Every candidate request carried the exact override:

```text
Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="287bcd9f-98d1-4741-a832-76dfa88b202c"
```

The tail independently attributed every candidate probe to the exact immutable
version. This report intentionally omits client addresses, Ray IDs, TLS
fingerprints, and unrelated trace fields.

## 9. A2A controlled live qualification

The exact-version request to `GET /.well-known/agent-card.json` returned:

| Fact                  | Result                  |
| --------------------- | ----------------------- |
| HTTP status           | `200`                   |
| Content type          | `application/a2a+json`  |
| Response size         | 10,998 bytes            |
| Candidate attribution | Exact version confirmed |
| Tail outcome          | `ok`                    |
| Tail response status  | `200`                   |
| Skill count           | 8                       |
| Signature count       | 1                       |

Candidate telemetry for the live path contained one complete success sequence:

```text
metadata_projection_legacy_reference_attempt_total surface=a2a mode=vcm_primary_compare
metadata_projection_primary_attempt_total surface=a2a mode=vcm_primary_compare
metadata_projection_compare_total surface=a2a mode=vcm_primary_compare
metadata_projection_match_total surface=a2a mode=vcm_primary_compare
metadata_projection_primary_success_total surface=a2a mode=vcm_primary_compare
```

No A2A mismatch, fallback, primary failure, validation failure, comparator
failure, or signing failure event appeared. The telemetry sequence plus the
qualified implementation proves that the selected unsigned VCM card entered the
existing signing boundary only after semantic match.

## 10. Agent Card signing and verification

The exact-version JWKS request returned HTTP 200 with
`application/jwk-set+json`. It contained exactly one public P-256 ES256 signing
key with key ID `siteborne-agent-card-2026-08` and no private `d` member.

The repository's `verifyAgentCardAgainstTrustedJwks` verifier was run locally
against the exact fetched candidate Agent Card and exact fetched candidate JWKS.
The helper did not follow the card's `jku`; it used only the supplied, trusted
JWKS. Cryptographic verification succeeded.

The first verifier invocation through the package barrel encountered an
unrelated missing built `protocol-x402/dist` local workspace artifact before
verification began. The same governed verifier was then imported directly from
`packages/protocol-a2a/src/signing.ts`; it completed successfully. This was a
local module-resolution issue, not a candidate or signature failure.

```text
A2A_VCM_PRIMARY_SELECTED=YES
A2A_SELECTION_OCCURRED_BEFORE_SIGNING=SUPPORTED_BY_IMPLEMENTATION_AND_LIVE_PATH
A2A_EXISTING_SIGNER_USED=YES
A2A_SIGNATURE_VALID=YES
A2A_FALLBACK_OBSERVED=NO
```

The JWKS request entered a fresh isolate and produced a second complete A2A
primary-match telemetry sequence before serving the public key set. Across the
bounded tail window, A2A primary attempts, comparisons, matches, and successes
were each observed twice; all A2A failure and fallback counts remained zero.

## 11. MCP controlled live qualification

The exact-version request to `POST /mcp` used:

- `MCP-Protocol-Version: 2026-07-28`;
- `Mcp-Method: tools/list`;
- `Content-Type: application/json`;
- `Accept: application/json, text/event-stream`; and
- the repository's modern per-request protocol, client-info, and
  client-capabilities `_meta` fields.

It invoked no tool. The response was:

| Fact                  | Result                  |
| --------------------- | ----------------------- |
| HTTP status           | `200`                   |
| Content type          | `application/json`      |
| Response size         | 133,834 bytes           |
| JSON-RPC version      | `2.0`                   |
| Result present        | YES                     |
| Candidate attribution | Exact version confirmed |
| Tail outcome          | `ok`                    |
| Tool count            | 6                       |

The exact returned tool set was:

1. `siteborne_company_evidence_graph`
2. `siteborne_web_context_verified`
3. `siteborne_document_evidence_json`
4. `siteborne_verify_agent_output`
5. `siteborne_get_quote`
6. `siteborne_get_service_health`

No tool was missing and no additional tool appeared.

## 12. MCP primary-selection and handler boundary

Candidate telemetry contained one complete MCP primary success sequence:

```text
metadata_projection_legacy_reference_attempt_total surface=mcp mode=vcm_primary_compare
metadata_projection_primary_attempt_total surface=mcp mode=vcm_primary_compare
metadata_projection_compare_total surface=mcp mode=vcm_primary_compare
metadata_projection_match_total surface=mcp mode=vcm_primary_compare
metadata_projection_primary_success_total surface=mcp mode=vcm_primary_compare
```

No MCP mismatch, fallback, primary failure, validation failure, comparator
failure, handler-construction failure, or exception appeared.

The immutable source and local qualification prove that VCM supplies metadata
definitions only. The VCM definition type contains no executable handler, and
the selected definition array is paired with the unchanged protocol-MCP service,
quote, and health closures only at the existing `registerTool` boundary. Live
qualification deliberately did not invoke a stateful or economic tool merely to
reconfirm handler identity.

```text
MCP_VCM_PRIMARY_SELECTED=YES
MCP_COMPARISON_MATCH=YES
MCP_FALLBACK_OBSERVED=NO
MCP_HANDLER_SUBSTITUTION=NO
MCP_HANDLER_IDENTITY_PRESERVED=YES
MCP_VCM_HANDLER_FREE=YES
```

## 13. JSON and SSE representation status

The live MCP response was `application/json`; the primary-comparison path
executed and matched successfully. This directly proves the candidate retains
the R3 JSON representation repair.

No response negotiation was altered to manufacture an SSE response. SSE support
is inherited from the unchanged R3 extractor and the passing local MCP
regression suite recorded in the IMPL-05 qualification report.

```text
MCP_OBSERVER_JSON_SUPPORT=PASS_LIVE
MCP_OBSERVER_SSE_SUPPORT=PASS_LOCAL_REGRESSION_WITH_NO_DELTA
```

## 14. Bounded telemetry acceptance

The candidate-only observation window produced the following bounded counts:

| Surface | Legacy reference | Primary attempt | Compare | Match | Primary success | Mismatch | Fallback | Error |
| ------- | ---------------: | --------------: | ------: | ----: | --------------: | -------: | -------: | ----: |
| A2A     |                2 |               2 |       2 |     2 |               2 |        0 |        0 |     0 |
| MCP     |                1 |               1 |       1 |     1 |               1 |        0 |        0 |     0 |

The A2A count is two because the Agent Card and JWKS requests entered separate
isolates and each constructed the cached signed A2A application. Counts were not
manufactured or normalized to a predetermined value.

## 15. Stable public non-regression

After candidate-specific qualification, bounded ordinary requests without a
version override confirmed the stable 100% path remained healthy:

| Endpoint                                              | Result                               |
| ----------------------------------------------------- | ------------------------------------ |
| `https://utility.siteborne.net/health`                | HTTP 200, `application/json`         |
| `https://utility.siteborne.net/ready`                 | HTTP 200, `application/json`         |
| `https://siteborne.net/.well-known/mcp-registry-auth` | HTTP 200, `text/plain;charset=UTF-8` |

These are stable-path controls and are not represented as candidate tests.

## 16. Scheduled-path and trigger safety

No trigger, route, domain, or Cron mutation occurred. The existing every-minute
Cron definition was not redeployed. No candidate-attributable scheduled
exception, durable corruption, or economic side effect was observed naturally
during the bounded qualification window. No particular version distribution for
scheduled events is inferred from the 100/0 HTTP split.

The previously accepted multiversion scheduled-safety proof remains unchanged;
the IMPL-05 source delta did not alter the scheduled path.

## 17. Economic and stateful non-effect

The immutable candidate readback proved `PAID_ROUTES_ENABLED=false`.

The only candidate requests were Agent Card discovery, JWKS discovery, and MCP
`tools/list`. They performed no tool invocation, provider invocation, payment
authorization, quote execution, settlement, seller-wallet activity, document
processing, artifact write, D1 write, R2 write, KV write, queue write, or
Workflow creation.

```text
PAID_EXECUTION_ACTIVATED=NO
ECONOMIC_SIDE_EFFECTS_OBSERVED=0
STATEFUL_SIDE_EFFECTS_OBSERVED=0
ECONOMIC_AUTHORITY_CHANGED=NO
```

## 18. Authority boundary

The candidate exercised `vcm_primary_compare`, not `vcm_only`. VCM was selected
only after independent legacy construction, VCM construction and validation, and
semantic equality. The independent legacy builders and comparators remain
present and executable; mismatch or VCM failure retains the locally qualified
legacy fallback, while loss of the independent legacy reference fails closed.

The A2A signer and MCP executable-handler authorities were unchanged. No price,
security, protocol, registry, or execution authority moved.

```text
VCM_ONLY_SERVABLE=NO
AUTHORITY_INVERSION=NO
PRODUCTION_CUTOVER=NO
```

## 19. Mutation and traffic accounting

Two Cloudflare mutations occurred, both executed by the human operator at the
explicit checkpoint gates:

1. one immutable version upload;
2. one two-version deployment with stable 100% and candidate 0%.

Codex executed neither mutation. Codex performed only read-only Cloudflare
queries, local dry runs, bounded exact-version metadata probes, local response
verification, and this report edit.

```text
NORMAL_TRAFFIC_TO_CANDIDATE=0%
NONZERO_CANARY_PERFORMED=NO
PRODUCTION_CUTOVER=NO
CRON_TRIGGER_MUTATION=NO
ROUTE_MUTATION=NO
SECRET_MUTATION=NO
RESOURCE_MUTATION=NO
SOURCE_MUTATION_AFTER_CANDIDATE_BUILD=NO
```

## 20. Final deployment readback

The authoritative active deployment at closure is:

| Role      | Version                                | Traffic |
| --------- | -------------------------------------- | ------: |
| Stable    | `38cbf4dd-52fd-4afc-ad34-626a2e6454d3` |    100% |
| Candidate | `287bcd9f-98d1-4741-a832-76dfa88b202c` |      0% |

Deployment ID: `7e19fd3e-ccea-4680-9e63-06bcbd0625bd`

The new candidate is qualified for retention at zero percent. This result does
not authorize a nonzero canary, production cutover, `vcm_only`, or any further
Cloudflare mutation.

```text
SAFE_TO_RETAIN_ZERO_PERCENT_CANDIDATE=YES
SAFE_FOR_NEXT_PRE_CUTOVER_CHECKPOINT=YES
NEXT_CHECKPOINT_RECOMMENDATION=SEPARATE_HUMAN_AUTHORIZED_PRE_CUTOVER_CHECKPOINT
```

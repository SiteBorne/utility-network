# MCP-CANONICAL-TOOL-NAMING-01 — closure

```text
MCP_CANONICAL_TOOL_NAMING_01=REVERTED
MCP_RENAME_ACCEPTED=NO
RENAMES_REVERTED=YES
```

The proposed public rename was implemented locally, generated through the real
production path and scored. It did not reach the hard acceptance gate
(`TDQS_POST_RENAME_OVERALL=5.0`), so every change belonging to this checkpoint
was reverted. The only artifact retained is this report.

## 1. Starting provenance

```text
STARTING_HEAD=35ed3d6dd3755ec424b6c7a614fb5ec6d22ce05a
FINAL_LOCAL_HEAD=(this report's commit; source identical to STARTING_HEAD)
WORKING_TREE_PRE=CLEAN
WORKING_TREE_POST_REVERT=CLEAN (before report commit)
```

## 2. Pre-rename exact tools/list

Generated with `packages/protocol-mcp/scripts/export-tdqs-tools.mjs` (the real
MCP Hono app and client, not hand-built).

```text
PRE_TOOLS_EXPORT_SHA256=063611b171a7292861bce77f0b84ef8bdc06350a01c0d87a60927f9923b50162
MCP_TOOL_COUNT=6
siteborne_company_evidence_graph
siteborne_web_context_verified
siteborne_document_evidence_json
siteborne_verify_agent_output
siteborne_get_quote
siteborne_get_service_health
```

## 3. TDQS scorer and pre-rename result

```text
TDQS_SCORER=mcp-tdqs@0.1.0 (pinned, official hosted mode, https://tdqs.dev)
TDQS_SPEC_VERSION=1.2
LOCAL_MODEL_PROVIDER_USED=NO
```

The hosted API key was already present in the operator shell environment. It was
passed only through the environment and was never printed, logged or persisted.
Only the sanitized tool-definition export (public metadata) was sent.

```text
TDQS_PRE_RENAME_OVERALL=4.6 (tier A)
TDQS_PRE_RENAME_NAMING=4
description quality=4.7  coherence=4.5  disambiguation=5  completeness=4
per-tool: company 4.8, web 4.7, document 4.6, verify 4.8, quote 4.6, health 4.6
report: https://tdqs.dev/reports/y2uyepqn0t
```

Note: the operator previously observed 4.9 for an earlier hosted score. This
checkpoint required not assuming the historical score reproduces under the
current scorer; under `mcp-tdqs@0.1.0` / spec 1.2 the pre-rename baseline is
4.6. Hosted scoring is model-graded, so per-dimension scores can vary between
runs.

## 4. Rename map (experiment)

```text
siteborne_company_evidence_graph   -> siteborne_get_company_evidence_graph
siteborne_web_context_verified     -> siteborne_get_verified_web_context
siteborne_document_evidence_json   -> siteborne_get_document_evidence_json
(unchanged) siteborne_verify_agent_output, siteborne_get_quote,
            siteborne_get_service_health
```

## 5. Name authority and stable identity

```text
MCP_TOOL_NAME_AUTHORITY=packages/protocol-mcp/src/constants.ts#MCP_SERVICE_TOOLS
PARALLEL_MCP_NAME_TRUTH=NO
```

VCM `mcp-real-context`, VCM `current-exposure`, the server registration and
dispatch, and the edge security-publication injection all derive tool names from
this single map, whose values are the stable service IDs (`*.v2`). The rename
therefore touched only the map keys plus cross-reference prose in tool
descriptions (`server.ts`), the spec baseline fixture, tests, scripts, and
`docs/operations/MCP_TOOLS.md`. In the experiment:

```text
CAPABILITY_IDENTITY_CHANGED=NO
SERVICE_IDS_CHANGED=NO
HTTP_ROUTES_CHANGED=NO
PRICING_CHANGED=NO
REQUEST_SCHEMAS_CHANGED=NO
RESPONSE_SCHEMAS_CHANGED=NO
PCC_SEMANTICS_CHANGED=NO
SECURITY_PROFILES_CHANGED=NO
PAID_ADMISSION_CHANGED=NO
```

Proof of scope: the post-rename tools/list export equals the pre-rename export
with only the three names substituted (byte-for-byte after substitution), so
schemas, annotations and descriptions were otherwise unchanged. Security
declaration utility bindings reference only `siteborne_get_quote` /
`siteborne_get_service_health` (unchanged names); service-tool bindings derive
from the map.

## 6. Legacy call alias decision

```text
LEGACY_CALL_ALIAS_STRATEGY=NO_COMPATIBILITY_ALIAS
```

Every registered tool is enumerated by `tools/list`. A hidden alias would need a
bespoke dispatch path outside the registration mechanism, which is meaningful
added complexity, so it was not implemented.

## 7. Post-rename exact tools/list and TDQS result

```text
POST_TOOLS_EXPORT_SHA256=60537d88077258131db49b558bebfd3b4b1e0b169c7b068632e4719b156a52d5 (identical on two generations)
MCP_TOOL_COUNT=6  LEGACY_NAMES_ADVERTISED=0  DUPLICATE_TOOL_NAMES=0
MCP_RENAME_REPRODUCIBLE(tools/list)=PASS

TDQS_POST_RENAME_OVERALL=4.6 (tier A)
TDQS_POST_RENAME_NAMING=4
description quality=4.7  coherence=4.5  disambiguation=5  completeness=4
per-tool: company 4.8, web 4.9, document 4.8, verify 4.8, quote 4.6, health 4.7
report: https://tdqs.dev/reports/z0zt6n5y71
```

Server-level dimensions were unchanged. Per-tool scores did not regress (mean
tool score 4.7 -> 4.8). The grader's naming rationale changed in wording (it now
describes the verb_noun pattern as uniform apart from `verify_agent_output`) but
still scored naming at 4. The rename alone did not move the overall server score
to 5.0.

## 8. Accept / revert decision

Hard condition `TDQS_POST_RENAME_OVERALL=5.0` was not met (4.6). Per the
checkpoint rule, the public compatibility break is not kept for less than the
target result.

```text
MCP_RENAME_ACCEPTED=NO
RENAMES_REVERTED=YES
```

Revert verification: `git checkout -- .` restored all 21 changed files; the
tools/list regenerated after revert has SHA-256 `063611b1...b50162`, identical
to the pre-rename export.

## 9. Steps not run (rename rejected)

Security declaration requalification, artifact-scope comparison,
continuation-host comparison, static qualification and full-suite runs were not
executed against a rename that was reverted. The source is byte-identical to the
previously qualified `35ed3d6`, so the prior qualification stands.

```text
SECURITY_DECLARATION_TOOL_BINDINGS_UPDATED=NO
SECURITY_DECLARATION_REQUALIFICATION=NOT_RUN
MCP_RENAME_ARTIFACT_SCOPE=NOT_RUN
CONTINUATION_HOST_AFFECTED=NO
PRIVATE_SECURITY_IP_LEAKS=NOT_RUN (no source change)
SOURCE_QUALIFICATION=NOT_RUN (source unchanged from 35ed3d6)
NEW_NAME_DISPATCH_PARITY=NOT_RUN
MCP_RELEASE1_NAMES_FROZEN=NO
```

## 10. Observations for governance

- The 5.0 target appears unreachable through naming alone: the grader's other
  dimensions (description quality 4.7, completeness 4) were unaffected by names,
  and completeness cites an unrelated gap ("artifact management"). A 5.0 gate
  would need description/completeness work, which this checkpoint excluded.
- `docs/source/SITEBORNE_UTILITY_NETWORK_MASTER_DIRECTIVE.md` (lines 428-430)
  lists the current names; it was not modified. It would need a governance
  decision if a rename is ever accepted.
- The network-site A2A prose reference mentioned in the impact map was not found
  by repository-wide search of the current names outside `docs/reports`; it
  should be re-located before any future rename.

## 11. Cloud mutation accounting

```text
REAL_PAYMENT_ATTEMPTS=0
WORKER_UPLOADS=0
WORKER_DEPLOYMENT_MUTATIONS=0
PUBLIC_TRAFFIC_MUTATIONS=0
CLOUD_SECRET_MUTATIONS=0
```

External calls: two hosted TDQS scoring requests (public tool definitions only).

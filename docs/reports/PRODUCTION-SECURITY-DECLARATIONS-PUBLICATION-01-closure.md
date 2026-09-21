# PRODUCTION-SECURITY-DECLARATIONS-PUBLICATION-01 — closure

Status: **PASS (0%-traffic candidate qualified; not promoted)**

## Identity

| Item                              | Value                                      |
| --------------------------------- | ------------------------------------------ |
| Candidate Worker version          | `3b35f9e7-6fb8-47e4-acff-c5736eff6da6`     |
| Tag                               | `security-declarations-publication-01`     |
| Source commit                     | `182bfb5f4473c904ddaefb113f69a15979f68144` |
| Ordinary production (100%)        | `369b4bf5-c2f7-4e05-8454-7f5514a3bd45`     |
| Removed old canary (was 0%)       | `0456f44c-1c28-4919-9fdb-ab4673bac8f6`     |
| Continuation host (unchanged)     | `9b1e9b10-beed-4ff3-914c-2221aada9b45`     |
| Deployment created                | 2026-09-21T01:16:52Z                       |

Rollback target (not needed): `369b4bf5` = 100%, `0456f44c` = 0%.

## Deployment

Operator-executed `wrangler versions deploy` placed `369b4bf5@100` and
`3b35f9e7@0`. `wrangler deployments status` confirmed the state read-back.

## Frozen MCP names (candidate, exact-version)

`siteborne_build_company_evidence_graph`, `siteborne_retrieve_verified_web_context`,
`siteborne_extract_document_evidence_json`, `siteborne_verify_agent_output`,
`siteborne_get_quote`, `siteborne_get_service_health` (6 tools).
Ordinary production (no override) still advertises the six historical names.
`tools/call` with a legacy name on the candidate returns `Tool … not found`
(`NO_COMPATIBILITY_ALIAS`, as decided). Legacy names advertised by candidate: 0.

## Gate results

| Gate                                              | Result                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| Exact-version attribution                         | PASS — `wrangler tail --version-id`: 50/50 records `3b35f9e7`, 0 exceptions |
| Health                                            | PASS — `/health` 200                                                   |
| MCP `tools/list` / `tools/call`                   | PASS — 6 frozen names; `get_service_health` call OK                    |
| Security metadata on MCP                          | PASS — `net.siteborne/securityDeclaration` + `/security` on all 6      |
| A2A Agent Card + JWS                              | PASS — signature verified against live JWKS (public key only)          |
| OpenAPI                                           | PASS — `x-siteborne-security-declaration` + 4 `/v2` op extensions      |
| Catalog                                           | PASS — `security_declaration` ref + security block on 8 services       |
| Cross-surface parity                              | PASS — 36 entries, 0 value conflicts; `dataFlow` consistent            |
| Private-IP leak scan (repo `LEAK_PATTERNS`)       | PASS — 1,630 strings, 0 leaks                                          |
| Unpaid admission regression                       | PASS — see below                                                       |
| Carrier flags non-public                          | PASS — flag names absent from all public payloads; diag paths 404      |
| Production invariants                             | PASS — 100% on `369b4bf5`; continuation host unchanged                 |
| Rollback rule                                     | Not triggered                                                          |
| Live TDQS                                         | NOT_YET_OBSERVABLE (not re-run per directive)                          |

### Unpaid admission (candidate via override vs. production)

- `/v1/*` and `/v2/company/*`, `/v2/document/*`: 404 on both.
- `/v2/web/context`, `/v2/verify/agent-output`: schema-invalid body → 400; schema-valid,
  no payment → **402** `payment_required` with x402 v2 `payment-required` header. Production: 404.
- No provider work, no settlement, no payment attempted.

## Findings to carry forward

1. **Candidate carries `PAID_ROUTES_ENABLED=true`** (as did the retired canary).
   Candidate `/ready` reports `production_services_enabled:true` / "paid services
   active"; production reports `false`. Promoting `3b35f9e7` would therefore also
   activate the two paid routes. This is an activation decision, not a
   metadata-only change. Reachable only via version override at 0%.
2. **Legacy MCP tool names return unknown-tool** on the candidate. Revisit only
   if external callers of the old names exist.
3. **Unpaid 402 probes issue quotes** (`qte_…`) which may be persisted; two were
   issued. No payment followed.
4. Declaration reports `company_evidence_graph.v2` `available:false` /
   `UNSUPPORTED`; `web_context_verified.v2/direct` and `verify_agent_output.v2/standard`
   `IMPLEMENTED_ENFORCED`. Declaration matches actual qualification.

## Cloud mutation accounting

```
WORKER_UPLOADS=1
WORKER_DEPLOYMENT_MUTATIONS=1
PUBLIC_TRAFFIC_MUTATIONS=0
CLOUD_SECRET_MUTATIONS=0
REAL_PAYMENT_ATTEMPTS=0
CANDIDATE_ROLLBACK_EXECUTED=NO
```

Next recommended checkpoint: `FINAL-PAID-PRODUCTION-ACTIVATION-01`.

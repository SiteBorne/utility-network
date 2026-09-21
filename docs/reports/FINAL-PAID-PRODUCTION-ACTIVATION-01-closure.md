# FINAL-PAID-PRODUCTION-ACTIVATION-01 — Closure

Status: **PASS — Release-1 paid production ACTIVE**

## Release identity

| Item | Value |
| --- | --- |
| Worker | `siteborne-utility-edge` |
| Activated version | `3b35f9e7-6fb8-47e4-acff-c5736eff6da6` (tag `security-declarations-publication-01`) |
| Source SHA | `182bfb5f4473c904ddaefb113f69a15979f68144` |
| Previous production (rollback target) | `369b4bf5-c2f7-4e05-8454-7f5514a3bd45`, now 0% |
| Continuation host | `siteborne-paid-continuation-runtime` `9b1e9b10-beed-4ff3-914c-2221aada9b45`, 100%, unchanged |
| Activation deployment | created 2026-09-21T01:44:13Z, operator-executed: `3b35f9e7@100 / 369b4bf5@0` |

Rollback (not executed, not needed):

```
pnpm exec wrangler versions deploy --config wrangler.toml 369b4bf5-c2f7-4e05-8454-7f5514a3bd45@100 3b35f9e7-6fb8-47e4-acff-c5736eff6da6@0 -y
```

## Post-activation gates (all read-only, host `utility.siteborne.net`)

| Gate | Result |
| --- | --- |
| Deployment state (`wrangler deployments status`) | 3b35f9e7 = 100%, 369b4bf5 = 0% — PASS |
| Tail attribution, no version override | 24/24 records `scriptVersion.id = 3b35f9e7`, 0 exceptions, all outcome `ok`, all HTTP 200 — PASS |
| `/health` | 200 `ok` — PASS |
| `/ready` | 200 `ready`, `production_services_enabled: true`, "paid services active" — PASS |
| MCP `tools/list` | 6 tools, exactly the frozen names (build/retrieve/extract/verify/get_quote/get_service_health) — PASS |
| Legacy MCP name `siteborne_company_evidence_graph` | `-32602 Tool ... not found` (no alias, as decided) — PASS |
| A2A Agent Card JWS | verified with the repo verifier `verifyAgentCardAgainstTrustedJwks` against the live JWKS (`kid siteborne-agent-card-2026-08`, ES256) — PASS |
| OpenAPI | `x-siteborne-security-declaration` present, 200 — PASS |
| Catalog | 200, 8 service entries, top-level `security_declaration` — PASS |
| Security parity | catalog, MCP (all 6 tools) and card extension carry `security_declaration.v1` / `1.0.0` / ceiling `CONFIGURED` and reference `openapi:x-siteborne-security-declaration`; card lists 18 capability bindings, OpenAPI has 18 — PASS |
| Leak scan (MCP, OpenAPI, card, catalog) | 0 hits for `PAID_ROUTES_ENABLED`, `JWT_RUNTIME_DIAGNOSTIC`, private-key markers, `sk_live`, `secret_key` — PASS |
| Paid admission, unsigned | `POST /v2/verify/agent-output` (standard) → 402; `POST /v2/web/context` (direct) → 402; both with `payment-required` header — PASS |
| Economic parity | 402 amounts: verify standard 17000 (= $0.017), web direct 8000 (= $0.008), both USDC on `eip155:8453`; catalog v2 prices 0.017 / 0.008 match — PASS |
| Continuation host | still `9b1e9b10`, deployment created 2026-09-20T19:13Z (before this release) — PASS |

## Legacy tool-name evidence

`NOT_OBSERVABLE`. No log, D1 column or retained trace records external MCP tool names. Old names now return unknown-tool.

## TDQS

- `TDQS_LIVE_PRE_ACTIVATION_SCORE=4.9/5.0` (source: tdqs.dev live website; authoritative baseline supplied by the operator).
- The 4.6 result from the Claude-run scorer is a non-authoritative diagnostic and is recorded separately.
- Post-activation live score: `NOT_YET_OBSERVABLE` (external site, not re-checked here).

## Cloud mutation accounting

| Counter | Value |
| --- | --- |
| Real payment attempts | 0 |
| Worker uploads (this checkpoint) | 0 |
| Worker deployment mutations | 1 (operator-executed activation) |
| Public traffic mutations | 1 (0% → 100% on 3b35f9e7, the intended activation) |
| Cloud secret mutations | 0 |
| Rollback executed | NO |
| Push | none |

Note: the unsigned admission probes each created a 402 quote/requirement record (`qte_…`/`req_…`). No payment was signed or settled.

## Contract freeze

Release-1 MCP names, tool count, schemas, routes, service IDs, pricing, security declaration, A2A metadata, OpenAPI/catalog semantics and economic admission are frozen as of this activation.

Next checkpoint: `POST-RELEASE-ECONOMIC-AND-OBSERVABILITY-HARDENING-01`.

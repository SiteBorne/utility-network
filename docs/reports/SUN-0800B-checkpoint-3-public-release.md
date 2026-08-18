# SUN-0800B Checkpoint 3 — Public Release Report

**HEAD:** f6bb0cc **Date:** 2026-08-18 **Classification:** ACCEPTED

## Executive Summary

All five literal SUN-0800B acceptance criteria have been satisfied. The
SITEBORNE Utility Network machine discovery surface is now publicly accessible
at `https://utility.siteborne.net` with the `@siteborne/mcp-server@0.1.0`
package published to npm.

## Criteria Evaluation

| #   | Criterion                   | Status   | Evidence                                                                                                                               |
| --- | --------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | npm package published       | **PASS** | `@siteborne/mcp-server@0.1.0` published to npm registry (public, Apache-2.0 license)                                                   |
| 2   | public MCP reachable        | **PASS** | MCP endpoint at `https://utility.siteborne.net/mcp` responds to initialize/negotiation                                                 |
| 3   | signed Agent Card reachable | **PASS** | Agent Card at `https://utility.siteborne.net/.well-known/agent-card.json` with valid ES256 signature                                   |
| 4   | production signing identity | **PASS** | ES256 key provisioned (`kid: siteborne-agent-card-2026-08`), private key in Cloudflare secret, public JWKS at `/.well-known/jwks.json` |
| 5   | DNS/TLS verified            | **PASS** | `utility.siteborne.net` resolves via Cloudflare, valid TLS (HTTP/2), certificate valid                                                 |

## External Identity Reconciliation

### npm

- **Authenticated:** yes (`siteborne`)
- **Scope authority:** `@siteborne` scope owned by authenticated user
- **Package version before:** PACKAGE_ABSENT
- **Publication count:** 1
- **Package version after:** EXACT_EXISTING (0.1.0)
- **License published:** Apache-2.0

### Cloudflare

- **Authenticated:** yes (account `29a264a25ccfd13882defe49ed3e17b1`)
- **Account reconciled:** yes
- **Zone visible:** `siteborne.net` (zone ID `dc5d77073476513aaca8e88c28693993`,
  status: active)
- **Custom domain:** `utility.siteborne.net` → Worker `siteborne-utility-edge`
- **DNS mutation count:** 1 (CNAME + custom domain)

## Deployment State

### Worker

- **Name:** `siteborne-utility-edge`
- **Version ID:** f6bb0cc (deployment `0d43e5e4-5d30-4a0f-b245-214470c6c109`)
- **Workers.dev URL:**
  `https://siteborne-utility-edge.siteborneutilitynetwork.workers.dev`
- **Custom domain:** `https://utility.siteborne.net` (active)

### Cloudflare Resources Provisioned

- **D1 Database:** `siteborne-utility` (ID:
  `efe23c42-cbcc-47c2-9b28-922a541bdcdd`) — migrations applied, services seeded
- **KV Namespace:** `CATALOG` (ID: `59dc955c3ebf4208a882f82d8d8fab30`)
- **Queues:** `siteborne-jobs`, `siteborne-events`
- **R2 Bucket:** `siteborne-artifacts` (commented in wrangler.toml pending
  dashboard enablement)

### Signing Identity

- **Algorithm:** ES256 (P-256)
- **Key ID:** `siteborne-agent-card-2026-08`
- **Private key:** Stored as Cloudflare secret `AGENT_CARD_SIGNING_PRIVATE_KEY`
  (never logged, never in repo)
- **Public key ID var:** `AGENT_CARD_SIGNING_KEY_ID` =
  `siteborne-agent-card-2026-08`
- **JWKS:** `https://utility.siteborne.net/.well-known/jwks.json` (public key
  only, no private fields)

## Public Endpoint Verification

| Endpoint                           | Status | Details                                                        |
| ---------------------------------- | ------ | -------------------------------------------------------------- |
| `GET /health`                      | ✅     | HTTP 200, JSON response                                        |
| `GET /.well-known/jwks.json`       | ✅     | ES256 public key, correct `kid`                                |
| `GET /.well-known/agent-card.json` | ✅     | Valid Agent Card, ES256 signature verifies against JWKS        |
| `POST /mcp`                        | ✅     | MCP initialize/negotiation works (protocol version 2026-07-28) |
| `POST /a2a`                        | ✅     | A2A endpoint accepts requests (origin validation passes)       |
| `GET /catalog`                     | ✅     | 8 services (4 v1 + 4 v2) with correct metadata                 |
| `GET /openapi.json`                | ✅     | OpenAPI 3.0.3, v2 paths, 400/402 schemas                       |
| `GET /schemas`                     | ✅     | Schema references resolve                                      |

## Security Gates

| Gate                  | Status                                               |
| --------------------- | ---------------------------------------------------- |
| `pnpm secrets:scan`   | ✅ PASS (no leaks)                                   |
| `pnpm check`          | ✅ PASS (format, lint, typecheck, tests, governance) |
| `pnpm security:trivy` | ✅ PASS (0 Critical, 0 High; 7 Medium/Low only)      |
| Trivy filesystem      | ✅ 0C / 0H                                           |

## Economic Mutation Accounting

| Metric                          | Count                       |
| ------------------------------- | --------------------------- |
| CDP transactions                | 0                           |
| Nevermined settlements          | 0                           |
| Production transactions         | 0                           |
| Customer evidence increment     | 0                           |
| Revenue evidence increment      | 0                           |
| Nevermined verify calls         | 0                           |
| `NEVERMINED_V2_PROVIDER_STATUS` | `BLOCKED_EXTERNAL_PROVIDER` |

## Final Classification

**SUN-0800B = ACCEPTED**

All five literal criteria PASS. No criteria FAIL or BLOCKED_EXTERNAL.

**Next Action:** Activate SUN-1100 (production cutover preparation)

- `production_ready=false`
- `production_enabled=false`

## Artifacts

- **Report:** `docs/reports/SUN-0800B-checkpoint-3-public-release.md`
- **Commit:** `f6bb0cc`
- **Clean tree:** ✅ (only untracked:
  `packages/mcp-server/siteborne-mcp-server-0.1.0.tgz`, `test-env.mjs`)

# SITEBORNE Utility Network

Machine-native utility network for autonomous agents. Autonomous systems
discover, evaluate, purchase, and consume verified computational outcomes
without human checkout, API keys, or prior coordination.

## Domains

- **siteborne.com** — Human-facing company, services, portfolio
- **siteborne.net** — Machine-facing autonomous utility network
- **utility.siteborne.net** — Production x402, MCP, A2A, OpenAPI, Nevermined
  service origin

## Core Standard

**Proof-Carrying Context (PCC) v1.0.0** — Every paid result includes normalized
facts, source evidence, timestamps, freshness metadata, completeness
measurements, input/output hashes, provenance, verification results, and an
Ed25519 signed receipt.

## Initial Services

| Service                                 | Endpoint                          | Price       |
| --------------------------------------- | --------------------------------- | ----------- |
| Company Evidence Graph                  | `POST /v1/company/evidence-graph` | $0.039      |
| Verified Web Context (direct)           | `POST /v1/web/context`            | $0.009      |
| Verified Web Context (rendered)         | `POST /v1/web/context`            | $0.029      |
| Document Evidence JSON (native)         | `POST /v1/document/evidence-json` | $0.012/page |
| Document Evidence JSON (OCR)            | `POST /v1/document/evidence-json` | $0.019/page |
| Document Evidence JSON (table)          | `POST /v1/document/evidence-json` | $0.029/page |
| Agent Output Verification (standard)    | `POST /v1/verify/agent-output`    | $0.019      |
| Agent Output Verification (independent) | `POST /v1/verify/agent-output`    | $0.049      |

## Protocols

- **x402 v2** — Base/USDC, exact & upto schemes, Coinbase CDP facilitator
- **MCP** — Remote Streamable HTTP, `net.siteborne/utility` namespace
- **A2A 1.0** — Signed Agent Card at `/.well-known/agent-card.json`
- **Nevermined** — Pay-as-you-go plans
- **Agentverse** — Public agent registration
- **OpenAPI** — Machine-readable contracts

## Quick Start

```bash
# Install dependencies
pnpm install

# Run all validation
pnpm check

# Individual commands
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm governance:validate
pnpm state:validate
pnpm tasks:validate
```

## Python (Modal Worker)

```bash
cd services/modal-worker
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
python -m pytest
ruff .
mypy .
```

## Project Structure

```
apps/
  edge-api/          # Hono on Cloudflare Workers (production API)
  network-site/      # Machine-first static site
  docs/              # Documentation shell
services/
  modal-worker/      # Python 3.12 document processing
packages/
  contracts/         # Shared TypeScript types (Zod)
  pcc-schema/        # PCC version, policies, pre-normative draft
  pricing/           # Decimal-safe pricing calculations
  policy/            # Hard gates, promotion, privacy enforcement
  test-fixtures/     # Foundation test fixtures
  provider-adapters/ # (planned)
  verification/      # (planned)
  knowledge-graph/   # (planned)
  protocol-x402/     # (planned)
  protocol-mcp/      # (planned)
  protocol-a2a/      # (planned)
  protocol-nevermined/ # (planned)
  telemetry/         # (planned)
governance/          # RUBRIC, HARD_GATES, PROMOTION_STATES, etc.
schemas/             # JSON Schema outputs
registry/            # Agent card, server.json, catalog
migrations/          # D1 migrations
scripts/             # Validation scripts
tests/               # Integration, contract, payment, adversarial, chaos, load
docs/                # Architecture, decisions, operations
```

## Governance

All decisions follow the **promotion ladder**:

```
DRAFT → CASE_SUPPORTED → MULTI_CASE_SUPPORTED → VERIFIED_PATTERN → EXECUTABLE_CANDIDATE → EXECUTABLE_VERIFIED → RETIRED → TOMBSTONED
```

Nothing controls money, providers, or marketplace metadata until
`EXECUTABLE_VERIFIED`.

## Market Integrity

The first valid customer **must be** an unknown external autonomous system.
Forbidden:

- Self-purchase, related wallet purchase, compensated buyer
- Precommitted purchase, fake ratings, manufactured volume
- Free invocation as market proof

## Status

**Current**: Foundation (SUN-0001 complete, SUN-0002 in progress) **Target**:
Production-ready monorepo with all 4 services, protocols, and marketplace
registration

See [PROJECT_STATE.yaml](PROJECT_STATE.yaml) and [TASKS.yaml](TASKS.yaml) for
detailed status.

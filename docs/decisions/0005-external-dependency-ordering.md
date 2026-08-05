---
id: '0005'
title: 'External Dependency Ordering'
status: 'accepted'
date: '2026-08-05'
question:
  "How should external dependencies (DNS, cloud config, credentials, registry
  publication) be managed so they don't block credential-independent repository
  construction?"
options:
  - label:
      'Represent as blocked_external tasks; continue local work; never require
      credentials for validation suite'
    description:
      'External tasks tracked in TASKS.yaml with state=blocked_external;
      PROJECT_STATE.yaml lists them separately; pnpm check runs without secrets'
  - label: 'Pause development until all external setup complete'
    description:
      'No code written until Cloudflare, IONOS, wallets, registries configured'
  - label: 'Mock external services locally'
    description:
      'Local mocks for CDP, Nevermined, MCP Registry, Agentverse during
      development'
selected:
  'Represent as blocked_external tasks; continue local work; never require
  credentials for validation suite'
rubric_score: 93
evidence:
  - "Master directive section 2.3: 'External phase ordering... must not block
    credential-independent repository construction. Represent them as
    blocked_external tasks.'"
  - "Master directive section 7: 'A clean clone must not require secrets to run
    the validation suite.'"
  - 'SUN-0001 increment spec section 11: PROJECT_STATE.yaml must distinguish
    blocked_external from unimplemented'
  - 'SUN-0001 increment spec section 12: External tasks marked blocked_external'
assumptions:
  - 'All core logic (contracts, pricing, policy, orchestrator, adapters) can be
    built and tested without live credentials'
  - 'Integration tests for x402, MCP, Nevermined use sandbox/testnet or are
    skipped without credentials'
  - 'Deployment scripts exist but require operator to provide secrets at deploy
    time'
  - 'GitHub Actions can run lint/typecheck/test without secrets; deploy jobs
    conditional on secrets presence'
revisit_condition:
  'Credential-independent validation fails or external dependency becomes
  unblocked'
---

# Decision Record 0005: External Dependency Ordering

## Blocked External Tasks (Tracked, Not Blocking Local Work)

| Task ID   | Dependency                                         | Blocker                             | Notes     |
| --------- | -------------------------------------------------- | ----------------------------------- | --------- |
| SUN-0006  | Cloudflare account + siteborne.net zone            | Operator action at Cloudflare       | Phase 1   |
| SUN-0007  | IONOS nameserver migration + DNSSEC                | Operator action at IONOS            | Phase 1   |
| SUN-0008  | Mail DNS records (DKIM CNAME) preservation         | Operator action at Cloudflare       | Phase 1   |
| SUN-0012  | Dedicated seller wallet (Base/USDC)                | Operator wallet creation + funding  | Phase 1   |
| SUN-0009+ | CDP API credentials (facilitator)                  | Coinbase Developer Platform account | Phase 9   |
| SUN-0010+ | Nevermined builder credentials                     | Nevermined platform account         | Phase 11  |
| SUN-0010+ | MCP Registry publication (GitHub/DNS verification) | GitHub org + DNS control            | Phase 10  |
| SUN-0010+ | Agentverse registration                            | Agentverse account                  | Phase 10  |
| SUN-0013+ | Modal deployment token                             | Modal account + token               | Phase 6   |
| SUN-0013+ | Startup program applications                       | Each program approval               | Phase 23+ |

## Credential-Independent Validation

- `pnpm install` → `pnpm check` (lint, typecheck, test, governance:validate,
  state:validate, tasks:validate) **must pass without any secrets**
- Tests use:
  - Local stubs/mocks for x402 facilitator, Nevermined, MCP Registry
  - Test fixtures for SEC EDGAR, GitHub, web content (no live network calls)
  - In-memory D1/R2/KV/Queues (Miniflare or test doubles)
- Integration tests requiring live services: **skipped** when credentials absent
  (not failed)

## Repository Structure for External Config

```
wrangler.toml          # Template with [vars] placeholders
wrangler.secrets.example # Documented secret names
.github/workflows/     # Deploy jobs conditional on secrets
scripts/deploy-*.sh    # Require env vars, not committed
```

## PROJECT_STATE.yaml Distinction

```yaml
implemented:
  - governance_validation
  - pricing_foundation
  - health_endpoint
  # ... credential-independent work

not_implemented:
  - pcc_normative_schema
  - company_evidence_graph
  # ... planned but not started

blocked_external:
  - cloudflare_account_configuration
  - ionos_dns_migration
  - seller_wallet
  - cdp_credentials
  - nevermined_credentials
  - registry_publication
```

## TASKS.yaml Convention

```yaml
- id: SUN-0006
  state: blocked_external
  blocker: 'Requires operator action at Cloudflare'
  # ... no local work possible until unblocked
```

## GitHub Actions

- CI workflow: install → format:check → lint → typecheck → test →
  governance:validate → state:validate → tasks:validate
- **No secret-dependent steps** in CI
- Deploy/publish workflows: separate, manual trigger, require secrets

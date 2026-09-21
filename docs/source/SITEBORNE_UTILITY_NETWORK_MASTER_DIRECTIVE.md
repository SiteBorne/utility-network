# SITEBORNE Utility Network

## Ultimate Production Build Directive

### 1. Mission

Build the complete production-ready SITEBORNE Utility Network: a machine-native
utility network through which unknown external autonomous systems can discover,
evaluate, purchase, invoke and consume verified computational outcomes without
human checkout, API-key creation or prior coordination.

The public production domain is:

- siteborne.net — network identity
- utility.siteborne.net — canonical machine-service origin

The initial network must support:

- x402 v2 payments
- Coinbase CDP facilitator
- Coinbase Bazaar discovery metadata
- Model Context Protocol
- Official MCP Registry publication
- A2A 1.0 with a signed Agent Card
- Nevermined payment plans
- Agentverse registration
- OpenAPI
- Public health, schema, catalog, examples and benchmark endpoints

The first legitimate customer must be an unknown external autonomous buyer. The
system must never manufacture demand through self-purchases, related wallets,
compensated buyers, precommitted purchasers, fake ratings or artificial
transaction volume.

### 2. Execution standard

This is not a request for:

- A plan only
- A mockup
- A prototype containing TODOs
- A single demonstration endpoint
- A human-oriented SaaS dashboard
- A generic LLM wrapper
- A raw compute reseller
- A thin third-party API proxy
- A marketplace with unimplemented sellers
- An architecture document without production code

Deliver a complete, tested, deployable monorepo. Use strict serial development.
Complete, test, document and commit each phase before beginning the next phase.
Do not expose private chain-of-thought. Maintain concise auditable decision
records containing:

- Question
- Options
- Chosen option
- Rubric score
- Assumptions
- Evidence
- Revisit condition

### 3. Product identity

Public product name: SITEBORNE Utility Network Core data standard:
Proof-Carrying Context, version 1.0.0 Every paid result must include:

- Contract
- Input hash
- Output schema hash
- Subject identity
- Claims
- Evidence
- Source locators
- Retrieval timestamps
- Freshness
- Completeness
- Provenance
- Verification results
- Output hash
- Policy hash
- Ed25519 signed receipt

### 4. Initial paid services

Implement exactly these four services.

#### 4.1 Company Evidence Graph

POST /v1/company/evidence-graph Input supports:

- Company name
- Domain
- Ticker
- Requested fields
- Freshness requirement Initial public-data sources:
- SEC submissions
- SEC company facts/XBRL
- Company website
- Public GitHub metadata
- Federal regulatory sources when available
- Buyer-provided URLs Do not promise proprietary or real-time market data. Fixed
  launch price: $0.039 USDC

#### 4.2 Verified Web Context

POST /v1/web/context Modes:

- Direct retrieval: $0.009
- JavaScript-rendered retrieval: $0.029 Output must support:
- Markdown
- Clean text
- Buyer-provided JSON Schema
- Field-level evidence
- Source hash
- Retrieval metadata
- Prompt-injection flags
- Verification receipt

#### 4.3 Document Evidence JSON

POST /v1/document/evidence-json Constraints:

- 10 MB maximum
- 10 pages maximum
- PDF, PNG and JPEG
- Public or buyer-authorized documents only Price:
- Native page: $0.012
- OCR page: $0.019
- Table-heavy page: $0.029
- Maximum launch job: $0.19 Use x402 upto settlement.

#### 4.4 Agent Output Verification

POST /v1/verify/agent-output Price:

- Standard: $0.019
- Independent reproduction: $0.049 Return:
- Pass/fail
- Score
- Failed requirements
- Schema result
- Evidence result
- Reproduction result
- Output hash
- Signed receipt

### 5. Free endpoints

Implement:

- GET /
- GET /health
- GET /ready
- GET /catalog
- GET /openapi.json
- GET /schemas
- GET /examples
- GET /benchmarks
- GET /services/{service_id}
- POST /quotes/{service_id}
- GET /.well-known/agent-card.json
- POST /mcp
- POST /a2a Free endpoints may reveal schemas, fixed fixtures, health and price
  information. They must not perform a useful live customer job for free before
  the first unknown paid transaction.

### 6. Architecture

Use:

- TypeScript strict mode
- pnpm workspaces
- Turborepo
- Hono on Cloudflare Workers
- Cloudflare D1
- Cloudflare R2
- Cloudflare KV
- Cloudflare Queues
- Cloudflare Browser Run
- Cloudflare Workers AI
- Python 3.12 Modal worker
- Pydantic
- Docling
- PyMuPDF
- pdfplumber
- Tesseract/OCRmyPDF
- Polars
- DuckDB
- JSON Schema
- Open Policy Agent/Rego
- OpenTelemetry
- Sentry
- Vitest
- Playwright
- pytest
- Hypothesis
- Schemathesis
- Ruff
- mypy strict
- ESLint
- Semgrep
- Gitleaks
- Trivy
- OSV-Scanner
- Sigstore
- CycloneDX

Do not add a paid database or queue to the production dependency graph.

### 7. Monorepo

Create:

- apps/edge-api
- apps/network-site
- apps/docs
- services/modal-worker
- packages/contracts
- packages/pcc-schema
- packages/provider-adapters
- packages/verification
- packages/knowledge-graph
- packages/protocol-x402
- packages/protocol-mcp
- packages/protocol-a2a
- packages/protocol-nevermined
- packages/pricing
- packages/policy
- packages/telemetry
- packages/test-fixtures
- governance
- schemas
- registry
- migrations
- scripts
- tests
- docs

### 8. Governance files

Create and enforce:

- PROJECT_STATE.yaml
- TASKS.yaml
- governance/RUBRIC.yaml
- governance/HARD_GATES.yaml
- governance/PROMOTION_STATES.yaml
- governance/RESOURCE_POLICY.yaml
- governance/MARKET_INTEGRITY.yaml
- governance/PRIVACY_CLASSES.yaml
- governance/RISK_LIMITS.yaml

Promotion states: DRAFT → CASE_SUPPORTED → MULTI_CASE_SUPPORTED →
VERIFIED_PATTERN → EXECUTABLE_CANDIDATE → EXECUTABLE_VERIFIED → RETIRED →
TOMBSTONED

No route, policy, provider or pricing rule may autonomously affect production
until it reaches EXECUTABLE_VERIFIED.

### 9. Evaluation rubric

Store a 100-point rubric:

- Existing machine demand: 20
- Composability: 12
- Objective verifiability: 12
- Free-resource feasibility: 12
- Replacement-cost margin: 10
- Machine discoverability: 10
- Reliability and latency: 8
- Defensibility: 8
- Terms and data compliance: 5
- Implementation simplicity: 3

Required launch score: 85. Hard-gate failures override score.

### 10. Orchestrator

Implement a deterministic state machine: RECEIVED → VALIDATED → QUOTED →
PAYMENT_CHALLENGED → PAYMENT_VERIFIED → LOCKED → ROUTED → EXECUTING → VERIFYING
→ SETTLING → DELIVERED

Failure states:

- REJECTED
- REQUOTE_REQUIRED
- RETRYABLE
- REFUND_REQUIRED
- QUARANTINED
- TOMBSTONED

Only the orchestrator may:

- Accept a paid job
- Reserve quota
- Assign a worker
- Initiate verification
- Request settlement
- Trigger a refund
- Update production reputation

LLMs may recommend but may not sign payments, modify limits, activate providers
or release settlement.

### 11. Specialized agents

Implement bounded specialized agents:

- Demand Sensor
- Catalog Optimizer
- Contract Compiler
- Quote Agent
- Resource Router
- Company Worker
- Web Worker
- Document Worker
- Verification Worker
- Terms Watcher
- Reputation Agent
- Task Manager
- Memory Compactor
- Risk Guard

Each agent must have:

- Typed input
- Typed output
- Explicit allowed tools
- Explicit forbidden tools
- Maximum token/compute budget
- Timeout
- Retry limit
- Evaluation tests

### 12. Knowledge graph

Implement nodes:

- Service, Capability, Provider, Model, Tool, Source, Policy, Contract,
  BuyerWallet, Job, Receipt, Claim, Evidence, FailureMode, Experiment,
  Marketplace, PricingRule, TermsDocument

Implement typed edges and evidence counts. Every graph rule must carry:

- Promotion state
- Evidence count
- Last verified time
- Confidence
- Source references
- Revisit condition

### 13. Task maintenance

Every task must contain:

- ID, Phase, Owner agent, Dependencies, Current state, Acceptance tests, Rubric
  target, Evidence, Next action, Blocker, Commit reference

The Task Manager may select only one mutation task at a time during the initial
build.

### 14. Provider rules

Provider manifests must include:

- Commercial use allowed
- Automated access allowed
- Raw resale allowed
- Transformed output allowed
- Data-training policy
- Sensitive-data permission
- Quota
- Replacement cost
- Terms hash
- Last review
- Promotion state

Unknown permissions mean disabled. No duplicate accounts, account sharing, quota
multiplication, trial recycling or credential resale.

### 15. Payment implementation

Use current x402 v2 packages. Support:

- Base
- USDC
- exact
- upto
- Coinbase CDP facilitator
- Bazaar discovery extension

Bind each payment to:

- Buyer, Seller, Service ID, Service version, Input hash, Schema hash, Quote ID,
  Price or maximum price, Nonce, Expiration, Idempotency key

Implement unique database constraints preventing duplicate execution. Never
settle before verification for routes where the payment flow allows delayed
settlement.

### 16. Marketplace integrity

Enforce:

- self_purchase: forbidden
- related_wallet_purchase: forbidden
- compensated_buyer: forbidden
- prior_purchase_commitment: forbidden
- fake_rating: forbidden
- manufactured_volume: forbidden
- transaction_time_human_selection: forbidden

Create a first-purchase validator requiring:

- Previously unseen external wallet
- No known relationship
- Autonomous payment
- Useful output
- Valid receipt
- Result delivered

### 17. MCP

Implement remote Streamable HTTP MCP and a public npm shim. Publish under the
domain-verified namespace: net.siteborne/utility Tools:

- siteborne_build_company_evidence_graph
- siteborne_retrieve_verified_web_context
- siteborne_extract_document_evidence_json
- siteborne_verify_agent_output
- siteborne_get_quote
- siteborne_get_service_health

### 18. A2A

Publish a signed Agent Card at:
https://utility.siteborne.net/.well-known/agent-card.json Include exact skills,
endpoint, version, schemas, security and payment capabilities.

### 19. Nevermined

Create pay-as-you-go plans for all four services. Do not enable free live trials
until after the first unknown external paid purchase.

### 20. Agentverse

Publish a public Proxy or Custom agent. Use literal metadata focused on:

- Company evidence, SEC facts, URL to JSON, Web extraction, PDF to JSON, OCR,
  Evidence verification, Agent-output verification, Structured provenance Avoid:
  powerful AI, next-generation intelligence, revolutionary agent, advanced
  reasoning

### 21. Verification

Implement:

- Schema verifier
- Evidence-accessibility verifier
- Claim-to-evidence verifier
- Freshness verifier
- Completeness verifier
- Cross-source verifier
- Provenance verifier
- Prompt-injection verifier
- Receipt signer A deterministic failure cannot be overruled by a model.

### 22. Security

Protect against:

- SSRF, DNS rebinding, Local-network access, Metadata service access, Redirect
  abuse, Zip bombs, PDF bombs, Path traversal, Prompt injection, Oversized
  schemas, Payment replay, Cross-resource payment substitution, Concurrent
  duplicate execution, Unbounded compute, Secret leakage

### 23. Tests

Create at least:

- 200 company fixtures
- 200 web fixtures
- 100 PDF fixtures
- 50 OCR fixtures
- 50 table fixtures
- 100 valid verification fixtures
- 200 invalid verification fixtures
- 100 prompt-injection fixtures
- 100 payment replay tests
- 100 concurrency tests
- 100 provider-failure tests

Required:

- 100% schema validity
- Zero unsupported material claims
- Zero duplicate paid execution
- 100% replay rejection
- 100% refund-path tests
- At least 95% fixture success
- Zero critical security findings
- Zero unbounded-spend paths

### 24. Discovery backtest

Generate 1,000 synthetic machine discovery queries. Require:

- Top-three retrieval at least 90%
- Top-one retrieval at least 65%
- Schema selection at least 95%
- Quote parsing 100%
- Result consumption at least 95%

Record results in the knowledge graph.

### 25. Pricing

Use replacement cost, never temporary free cost. Initial prices:

- Company Evidence Graph: $0.039
- Direct Web Context: $0.009
- Rendered Web Context: $0.029
- Native Document Page: $0.012
- OCR Page: $0.019
- Table Page: $0.029
- Standard Verification: $0.019
- Independent Verification: $0.049 Target gross margin: 70%. Maximum automatic
  price adjustment: 20% per experiment.

### 26. Resource routing

Order:

1. Authorized public cache
2. Deterministic processing
3. Authoritative public data
4. Cloudflare free allocation
5. Voyage free allocation
6. Modal monthly allocation
7. Approved startup credits
8. Authorized paid route
9. Reject or requote

Paid overflow must be disabled at initial launch.

### 27. Deployment

Produce:

- Cloudflare deployment configuration
- D1 migrations
- R2 bindings
- Queue bindings
- Worker secrets checklist
- Modal deployment
- GitHub Actions
- Production rollback
- Disaster recovery
- Key rotation
- Wallet separation guide
- IONOS-to-Cloudflare DNS guide

Do not require credentials for tests. Live tests must skip safely unless
explicitly enabled.

### 28. Public documentation

Publish:

- Product identity, Catalog, Schemas, Examples, Benchmarks, Limits, Pricing,
  Refund rules, Security policy, Privacy policy, Acceptable-use policy, OpenAPI,
  MCP configuration, Agent Card, Service health, Verification methodology The
  site may be minimal for humans, but every critical surface must be
  machine-readable.

### 29. Startup-program package

Generate reusable application materials for:

- Cloudflare for Startups, Google for Startups, AWS Activate, Microsoft for
  Startups, AMD AI Developer Program, NVIDIA Inception, Sentry for Startups,
  MongoDB for Startups, Upstash Open Source, Neon Open Source, GitHub for
  Startups, Runpod, Fireworks

Include:

- 100-word description, 300-word description, Architecture, Credit usage plan,
  Product roadmap, Scalability case, Current traction placeholders, Security
  posture, Open-source strategy, Why the provider is technically necessary

Never describe the company as reselling credits or API access.

### 30. Completion conditions

The build is complete only when:

- Monorepo is clean
- All tests pass
- All schemas are versioned
- OpenAPI drift test passes
- MCP server works
- Agent Card validates and is signed
- x402 testnet payments pass
- Nevermined sandbox passes
- Agentverse metadata is ready
- MCP Registry package is ready
- Production deployment configuration exists
- Startup applications are generated
- No TODOs remain
- No secrets are committed
- No critical security findings remain
- PROJECT_STATE.yaml accurately reflects implementation status
- TASKS.yaml contains only credential-dependent or external launch tasks

At the conclusion, provide:

1. Exact files created
2. Exact commands to install, test and deploy
3. Exact credentials still required
4. Exact IONOS and Cloudflare actions
5. Exact registry-publishing actions
6. Exact remaining risks
7. Final rubric scores
8. Final benchmark report
9. Production-readiness verdict

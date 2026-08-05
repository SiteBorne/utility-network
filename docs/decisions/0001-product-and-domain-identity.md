---
id: '0001'
title: 'Product and Domain Identity'
status: 'accepted'
date: '2026-08-05'
question:
  'What is the product name, domain structure, and initial service portfolio for
  SITEBORNE Utility Network?'
options:
  - label:
      'siteborne.net as machine-facing utility network with 4 core services'
    description:
      'siteborne.com for human-facing company, siteborne.net for machine-facing
      utility network, utility.siteborne.net as production origin'
  - label: 'Single domain for both human and machine traffic'
    description: 'Use siteborne.com for everything with path-based separation'
  - label: 'Separate TLDs for company vs network'
    description: 'siteborne.io for network, siteborne.com for company'
selected: 'siteborne.net as machine-facing utility network with 4 core services'
rubric_score: 88.6
evidence:
  - 'Agentic Market bundle analysis shows demand for composite company profiles'
  - 'IPO Analysis bundle at $0.44 proves autonomous buyer willingness to pay'
  - 'SEC EDGAR, public web, GitHub APIs provide free public data sources'
assumptions:
  - 'SEC EDGAR rate limits (10 req/s) sufficient for launch volume'
  - '$0.039 price point acceptable (1/10 of IPO bundle composite)'
  - 'Cloudflare free tier sufficient for initial traffic'
revisit_condition:
  'First unknown paid transaction not achieved within 30 days of registry
  publication'
---

# Decision Record 0001: Product and Domain Identity

## Frozen Decisions

**Product Identity**

- Public name: SITEBORNE Utility Network
- Human-facing domain: siteborne.com (company, services, portfolio)
- Machine-facing domain: siteborne.net (autonomous utility network)
- Production origin: utility.siteborne.net (x402, MCP, A2A, OpenAPI, Nevermined
  service origin)

**Core Standard**

- Proof-Carrying Context (PCC) version 1.0.0
- Every paid result includes: normalized facts, source evidence, timestamps,
  freshness metadata, completeness measurements, input/output hashes,
  provenance, verification results, signed receipt

**Initial Service Portfolio (4 services sharing PCC schema)**

1. `company_evidence_graph.v1` — POST /v1/company/evidence-graph — $0.039 fixed
2. `web_context_verified.v1` — POST /v1/web/context — $0.009 direct / $0.029
   rendered
3. `document_evidence_json.v1` — POST /v1/document/evidence-json — $0.012 native
   / $0.019 OCR / $0.029 table / max $0.19
4. `verify_agent_output.v1` — POST /v1/verify/agent-output — $0.019 standard /
   $0.049 independent reproduction

**Market Integrity (Non-negotiable)**

- First valid customer = unknown external autonomous system discovering via open
  registry, selecting without coordination, paying without human confirmation,
  consuming result downstream
- Forbidden: self-purchase, related wallet purchase, compensated buyer,
  precommitted purchase, fake ratings, manufactured volume, free invocation as
  market proof

**Privacy Classification**

- Initial: public data or buyer-authorized only
- Sensitive data processing: disabled at launch

**Pricing (decimal-safe strings)**

- company_evidence_graph: "0.039"
- web_context_verified_direct: "0.009"
- web_context_verified_rendered: "0.029"
- document_evidence_json_native: "0.012"
- document_evidence_json_ocr: "0.019"
- document_evidence_json_table: "0.029"
- document_evidence_json_max: "0.19"
- verify_agent_output_standard: "0.019"
- verify_agent_output_independent: "0.049"
- target_gross_margin: "0.70"
- minimum_accepted_margin: "0.60"

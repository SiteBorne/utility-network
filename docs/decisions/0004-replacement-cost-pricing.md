---
id: '0004'
title: 'Replacement-Cost Pricing'
status: 'accepted'
date: '2026-08-05'
question:
  'How should service prices be calculated to ensure sustainable margins after
  free credits expire?'
options:
  - label:
      'Price from replacement cost using decimal-safe arithmetic: minimum_price
      = expected_cost / (1 - target_margin)'
    description:
      'expected_cost = resource_replacement_cost + verification_cost +
      facilitator_cost + expected_retry_cost + refund_reserve + storage_cost.
      All monetary values as integer micro-USD or rational numbers.'
  - label: 'Price from current free-tier cost (zero) plus markup'
    description: 'Use $0 marginal cost while free credits last, add buffer'
  - label: 'Market-based pricing matched to competitors'
    description:
      'Set prices at/below Agentic Market bundle components (~$0.04 for company
      profile)'
selected:
  'Price from replacement cost using decimal-safe arithmetic: minimum_price =
  expected_cost / (1 - target_margin)'
rubric_score: 90
evidence:
  - "Master directive section 16: 'Pricing formula: expected_cost =
    resource_replacement_cost + verification_cost + facilitator_cost +
    expected_retry_cost + refund_reserve + storage_cost; minimum_price =
    expected_cost / (1 - target_margin)'"
  - "Master directive section 16: 'Never price from the temporary free cost.
    Price from replacement cost.'"
  - 'Governance/RESOURCE_POLICY.yaml: target_gross_margin: 0.70,
    minimum_accepted_margin: 0.60'
  - 'Free capacity backtest (directive section 22): facilitator charges
    $0.001/tx after 1000 free/month'
assumptions:
  - 'Replacement costs are measurable and stable (Cloudflare, Modal, Voyage
    published pricing)'
  - 'Decimal-safe: integer micro-USD (1 USD = 1_000_000 µUSD) for all
    calculations; margins as rational {numerator, denominator}'
  - 'Monotonicity: increasing any cost component never decreases expected_cost
    or minimum_price'
  - 'Automatic price adjustment capped at 20% per experiment (directive section
    21)'
revisit_condition:
  'Replacement cost exceeds 50% of current price or margin drops below
  minimum_accepted_margin'
---

# Decision Record 0004: Replacement-Cost Pricing

## Cost Formula (Immutable, Corrected)

```
expected_cost =
  resource_replacement_cost
  + verification_cost
  + facilitator_cost
  + expected_retry_cost
  + refund_reserve
  + storage_cost

minimum_price =
  expected_cost / (1 - target_margin)
```

**Note**: The original directive accidentally showed subtraction. The corrected
formula above uses ADDITION for all cost components.

## Decimal-Safe Arithmetic

- **Internal representation**: integer micro-USD (µUSD), 1 USD = 1,000,000 µUSD
- **Margin representation**: rational { numerator: 70, denominator: 100 } for
  70%
- **Price calculation**:
  `minimum_price_µUSD = ceil(expected_cost_µUSD * denominator / (denominator - numerator))`
- **All monetary YAML/JSON**: string decimals (e.g., "0.039") to avoid binary
  float errors

## Target Margins

- Target gross margin: 70% (0.70 = 70/100)
- Minimum accepted margin: 60% (0.60 = 60/100)
- Automatic price change limit: 20% per experiment

## Free-Tier Awareness

- Free allocations (Cloudflare 100k req/day, Modal $30/mo, Voyage 200M tokens,
  CDP 1000 tx/mo) reduce **effective** cost to $0 during launch
- **Pricing MUST use replacement cost**, not effective free cost
- Scarcity multipliers applied when free quota depleted (RESOURCE_POLICY.yaml):
  - > 75% remaining: 0.10x
  - 50-75%: 0.25x
  - 25-50%: 0.60x
  - 10-25%: 1.00x
  - <10%: 2.00x

## Launch Prices (Replacement-Cost Derived, µUSD)

| Service                              | Price (USD) | Price (µUSD) |
| ------------------------------------ | ----------- | ------------ |
| company_evidence_graph.v1            | 0.039       | 39,000       |
| web_context_verified.v1 (direct)     | 0.009       | 9,000        |
| web_context_verified.v1 (rendered)   | 0.029       | 29,000       |
| document_evidence_json.v1 (native)   | 0.012       | 12,000       |
| document_evidence_json.v1 (OCR)      | 0.019       | 19,000       |
| document_evidence_json.v1 (table)    | 0.029       | 29,000       |
| document_evidence_json.v1 (max job)  | 0.19        | 190,000      |
| verify_agent_output.v1 (standard)    | 0.019       | 19,000       |
| verify_agent_output.v1 (independent) | 0.049       | 49,000       |

## Validation Requirements (Packages/Pricing Tests)

1. Cost components summed correctly (no subtraction)
2. Monotonicity: increasing any input cost never decreases expected_cost or
   minimum_price
3. Margin boundaries enforced (reject if calculated margin <
   minimum_accepted_margin)
4. Price change limit: 20% max per experiment
5. Round-up (ceil) on division ensures margin >= target

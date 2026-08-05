---
id: '0003'
title: 'Serial Execution Model'
status: 'accepted'
date: '2026-08-05'
question:
  'How should the initial build execute to ensure correctness and auditability?'
options:
  - label:
      'Strict serial loop: OBSERVE → DEFINE CONTRACT → SCORE → CREATE TASK →
      EXECUTE → TEST → VERIFY → PROMOTE → UPDATE GRAPH → COMPACT → SELECT NEXT'
    description:
      'One mutation task active at a time; each phase completes before next
      begins; decision records for every rule/provider/service/market hypothesis'
  - label: 'Parallel development with feature branches'
    description: 'Multiple agents work simultaneously on different services'
  - label: 'Hybrid: serial for core, parallel for adapters'
    description: 'Core orchestrator serial; provider adapters parallel'
selected:
  'Strict serial loop: OBSERVE → DEFINE CONTRACT → SCORE → CREATE TASK → EXECUTE
  → TEST → VERIFY → PROMOTE → UPDATE GRAPH → COMPACT → SELECT NEXT'
rubric_score: 95
evidence:
  - "Master directive section 10: 'Use this serial loop... Do not let multiple
    autonomous workers mutate the same state concurrently during the initial
    build'"
  - "Master directive section 13: 'The Task Manager may select only one mutation
    task at a time during the initial build'"
  - "Master directive section 8: 'Promotion ladder... Nothing may control money,
    provider selection or marketplace metadata until it reaches
    EXECUTABLE_VERIFIED'"
assumptions:
  - 'Single-threaded mutation eliminates race conditions on D1, R2, KV, Queues,
    reputation graph'
  - 'Decision records provide audit trail for every promotion'
  - 'Knowledge graph updates are serialized through Task Manager'
  - 'Memory compaction runs after each task completion'
revisit_condition:
  'Concurrency requirement emerges post-launch (e.g., horizontal scaling)'
---

# Decision Record 0003: Serial Execution Model

## Operating Loop (Immutable)

```
OBSERVE
→ DEFINE CONTRACT
→ SCORE AGAINST RUBRIC
→ CREATE TASK
→ EXECUTE
→ TEST
→ VERIFY EVIDENCE
→ PROMOTE OR ROLLBACK
→ UPDATE KNOWLEDGE GRAPH
→ COMPACT MEMORY
→ SELECT NEXT TASK
```

## Constraints

- **Exactly one mutation task active** at any time (enforced by Task Manager,
  validated in TASKS.yaml)
- **No concurrent writers** to D1, R2, KV, Queues, reputation graph during
  initial build
- **Decision record required** for every rule, provider, service, market
  hypothesis promotion
- **Promotion ladder** (section 8): DRAFT → CASE_SUPPORTED →
  MULTI_CASE_SUPPORTED → VERIFIED_PATTERN → EXECUTABLE_CANDIDATE →
  EXECUTABLE_VERIFIED → RETIRED → TOMBSTONED
- **Production activation gate**: Only `EXECUTABLE_VERIFIED` items may control
  money, provider selection, or marketplace metadata

## Task Structure (Every Task Must Contain)

- ID, Phase, Owner agent, Dependencies, Current state
- Acceptance tests (executable, pass/fail)
- Rubric target score
- Evidence references
- Next action, Blocker, Commit reference

## Knowledge Graph

- Node types: Service, Capability, Provider, Model, Tool, Source, Policy,
  Contract, BuyerWallet, Job, Receipt, Claim, Evidence, FailureMode, Experiment,
  Marketplace, PricingRule, TermsDocument
- Edge types: SERVICE_PROVIDES_CAPABILITY, SERVICE_USES_PROVIDER,
  PROVIDER_SUPPORTS_CAPABILITY, PROVIDER_BOUND_BY_POLICY, JOB_INVOKED_SERVICE,
  JOB_USED_PROVIDER, JOB_PRODUCED_RECEIPT, CLAIM_SUPPORTED_BY_EVIDENCE,
  EXPERIMENT_CHANGED_METADATA, EXPERIMENT_AFFECTED_CONVERSION,
  BUYER_REPEATED_SERVICE, RULE_DERIVED_FROM_EVIDENCE, RULE_PROMOTED_TO_STATE
- Every rule carries: promotion_state, evidence_count, last_verified_time,
  confidence, source_references, revisit_condition

## Memory Conservation

- Store hashes/summaries instead of duplicate payloads
- Content-address every R2 artifact
- Deduplicate evidence by content hash
- Keep model outputs only when they affect a decision
- Compact operational events into daily provider summaries
- Never embed raw secrets
- Apply TTL to temporary document data
- Keep public evidence longer than private/buyer-provided inputs

## Explicit Exclusion

- H256/E8 encoding NOT integrated into initial marketplace runtime
- Launch uses: canonical JSON, JSON Schema, SHA-256, Ed25519, Zstandard, Parquet
- H256/E8 evaluation deferred until benchmark demonstrates meaningful
  improvement

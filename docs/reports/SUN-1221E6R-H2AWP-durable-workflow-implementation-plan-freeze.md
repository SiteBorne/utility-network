# SUN-1221E6R-H2AWP — Durable Workflow Implementation Plan Freeze

Plan-only checkpoint. Zero source, zero test, zero external mutation.

## 1. Design approval

Human approval received in-chat for SUN-1221E6R-H2AW architecture at commit
`21d11ab4770c628f0c8132ae842c9c93cf2382a3` (Cloudflare Workflows durable
continuation, deterministic instance ID from `payment_identifier`, Workflow
as sole post-handoff owner, AES-256-GCM envelope, zero blind settlement
retries, unchanged synchronous public contract). Authorization scope:
documentation/planning only — no source, test, Workflow provisioning,
secret, D1, Worker upload, deployment/traffic, real-payment, F, or G action.

## 2. Plan path

`docs/superpowers/plans/2026-08-31-siteborne-durable-paid-continuation-workflow.md`

## 3. Repository recon (grounding, not invention)

| File | Current responsibility | H2AW role | Checkpoint owner |
|---|---|---|---|
| `apps/edge-api/src/control-plane/routes/x402-service.ts` | Paid route: verify → (today) request-local settle → persist | Loses direct settle ownership, gains durable handoff + waiter | H2AWI-3 |
| `apps/edge-api/src/control-plane/routes/production-web-context-v2-cdp-route.ts` | Production route wiring for `web_context_verified.v2`, incl. Modal env forwarding (E6P fix) | Unchanged interface, consumed by `x402-service.ts` | none |
| `apps/edge-api/src/control-plane/production/web-context-v2-cdp-composition.ts` | Builds `ServiceExecutor` for the production route | Reused as-is inside Workflow step 2 | none |
| `apps/edge-api/src/control-plane/production/web-context-v2-production-executor.ts` | Executor + PCC generation | Reused as-is inside Workflow steps 2-3 | none |
| `apps/edge-api/src/control-plane/state-machine/index.ts` | `JobState`, `createStateEvent`, `isTerminal`, `getAllowedTransitions`, `TransitionRules` | Reused unmodified by Workflow steps 5-6 | none |
| `apps/edge-api/src/control-plane/repositories/d1/payment-attempts.ts` | `D1PaymentAttemptRepository`, existing at-most-one settle-confirmation invariant | Reused unmodified by Workflow step 4 | none |
| `apps/edge-api/src/control-plane/evidence/cdp-provider.ts` | `CdpPaymentEvidenceProvider.settle()` | Called exactly once, only from Workflow step 4 after H2AWI-3 | H2AWI-2/3 |
| `apps/edge-api/src/control-plane/evidence/chain-receipt-checker.ts` | Read-only on-chain settlement checker | Reused by settlement-reconciliation module | H2AWI-2 |
| `apps/edge-api/src/control-plane/config/env.ts` | `Env` interface | Gains `PAID_CONTINUATION_WORKFLOW` binding type | H2AWI-4 |
| `wrangler.toml` | D1/Queue/AI/Browser bindings | Gains `[[workflows]]` block | H2AWI-4 |

`DESIGN_REQUIREMENT_COUNT=41` (one per numbered mission section §1-§40 minus
purely procedural §33/§39/§40).
`DESIGN_REQUIREMENT_COVERAGE_TARGET=100%`, achieved: every section §1-§32 has
a corresponding plan section or explicit frozen answer; §33-§40 are the
document/commit/packet mechanics executed by this checkpoint itself.

## 4. Module decomposition

New modules (H2AWI-1, none deployed/wired until H2AWI-3/4):
- `apps/edge-api/src/control-plane/continuation/types.ts`
- `apps/edge-api/src/control-plane/continuation/instance-id.ts`
- `apps/edge-api/src/control-plane/continuation/envelope.ts`
- `apps/edge-api/src/control-plane/continuation/idempotency-keys.ts`
- `apps/edge-api/src/control-plane/continuation/handoff.ts` (H2AWI-3)
- `apps/edge-api/src/control-plane/continuation/waiter.ts` (H2AWI-3)
- `apps/edge-api/src/control-plane/continuation/settlement-reconciliation.ts` (H2AWI-2)
- `apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts` (H2AWI-2)

`PROSPECTIVE_NEW_MODULE_COUNT=8`.

Modified modules: `x402-service.ts`, `config/env.ts`, `wrangler.toml`, Worker
entrypoint export file (H2AWI-3/4 only).

`PROSPECTIVE_MODIFIED_MODULE_COUNT=4`.

No giant orchestration file: the largest new module
(`paid-continuation-workflow.ts`) owns only the 7-step graph; crypto,
instance-ID, idempotency keys, HTTP handoff, and the HTTP waiter are each
separate single-responsibility files.

## 5. Interface freeze

`ContinuationEnvelopeV1`, `ContinuationEnvelopeMetadata`,
`WorkflowContinuationInput`, `WorkflowContinuationResult`,
`SettlementReconciliationResult`, `sealContinuationEnvelope`,
`openContinuationEnvelope`, `deriveWorkflowInstanceId`, and all six
`*IdempotencyKey` helpers are fully typed in plan §H2AWI-1 with exact field
names, encodings, and error taxonomies. H2AWI-2 and H2AWI-3 consume these
exact names without redefinition (verified by cross-reference in plan
Tasks 2.1, 3.1, 3.3).

`ENVELOPE_INTERFACE_FROZEN=YES`
`WORKFLOW_INPUT_INTERFACE_FROZEN=YES`
`WORKFLOW_RESULT_INTERFACE_FROZEN=YES`
`WORKFLOW_INSTANCE_ID_ALGORITHM_FROZEN=YES` (SHA-256, 48 hex chars,
`siteborne-wf-` prefix, explicitly not `computeAttemptHash()`)
`SETTLEMENT_IDEMPOTENCY_CONTRACT_FROZEN=YES` (mapped to existing D1
`payment_attempts` at-most-one invariant + Workflow instance-ID platform
dedup; no new schema required for this specific contract)

## 6. Checkpoint scopes

`H2AWI1_SCOPE_FROZEN=YES` — 5 tasks, local source + tests only.
`H2AWI2_SCOPE_FROZEN=YES` — 8 tasks, local source + tests only, fake
Workflow-step doubles, no live resource.
`H2AWI3_SCOPE_FROZEN=YES` — 7 tasks, local source + tests only; highest-risk
task (3.2, settlement-ownership transfer) has an explicit dedicated
call-count invariant test.
`H2AWI4_SCOPE_FROZEN=YES` — 5 tasks, external mutation, gated on fresh
standalone human authorization before any task begins.
`H2B_SCOPE_FROZEN=YES` — out of scope for this plan; explicitly deferred to
the project's existing human-executed-signing boundary.

## 7. Test coverage map

`DESIGN_TEST_REQUIREMENT_COUNT=19`
`PLANNED_TEST_REQUIREMENT_COUNT=19`
`UNCOVERED_TEST_REQUIREMENTS=0`

Full mapping table is in the plan document's "Test requirement coverage
map" section. 14 additional crypto test vectors (envelope tamper/AAD/key
cases) and 12 crash-matrix cases are enumerated individually, not counted
under the 19 top-level requirements to avoid double-counting, but are listed
in full in plan Tasks 1.4 and 2.8 respectively.

## 8. Security coverage map

10/10 threat-model items from design §27 have a named checkpoint owner (plan
document, "Security control coverage map" section). None deferred without
an owner.

`SECURITY_REQUIREMENT_COVERAGE_PERCENT=100%`

## 9. External authorization gates

| Checkpoint | Gate |
|---|---|
| H2AWI-1 | none (local source only) |
| H2AWI-2 | none (local source only, fake doubles) |
| H2AWI-3 | none (local source only) |
| H2AWI-4 | **fresh standalone human authorization required** before any task (Workflow resource creation, secret creation, D1 migration if needed, candidate build) |
| H2B | **fresh standalone human real-payment authorization required**, human-executed signing per this project's established boundary |
| F | fresh standalone human canary authorization |
| G | fresh standalone human promotion authorization |

## 10. Self-review results

**Placeholder scan:** `grep -niE '\bTBD\b|\bTODO\b|similar to previous|handle
errors appropriately|implement as needed|add tests\b'` against the plan
file → zero matches. `PLACEHOLDER_SCAN=PASS`.

**Type consistency:** manually cross-checked that every type consumed in
H2AWI-2 Task 2.1's table (`WorkflowContinuationInput`,
`ContinuationEnvelopeV1`, `ServiceExecutor`/`ExecutorOutcome`,
`D1PaymentAttemptRepository`, `JobState`-family functions,
`CdpPaymentEvidenceProvider`) is either defined in H2AWI-1 (the new types)
or is an existing, already-located repository export (the reused ones) —
none are invented ad hoc in H2AWI-2's own task text.
`TYPE_CONSISTENCY_REVIEW=PASS`.

**Economic ownership:** searched the plan for every `.settle(` occurrence
(7 matches, listed above) — all seven are either (a) describing the single
call site inside Workflow step 4 (Task 2.4), (b) describing its removal
from `x402-service.ts` (Task 3.2), or (c) referencing the reused
`CdpPaymentEvidenceProvider.settle()` method identity, never a second
production call site. `SETTLEMENT_OWNER_REVIEW=PASS`,
`SINGLE_SETTLEMENT_OWNER=WORKFLOW`.

**Secret exposure:** every logging column in the Task 2.1 step-graph table
explicitly excludes plaintext/signature; Task 1.3's error taxonomy
explicitly forbids plaintext/key/IV/ciphertext in error messages; Task 3.1
seals the envelope before any D1/log write touches the signed payload.
`RAW_SIGNATURE_PLAINTEXT_DURABLE_STORAGE_PLANNED=NO`.

## 11. Zero-effect confirmation

`SOURCE_FILES_CHANGED=0`
`TEST_FILES_CHANGED=0`
`WORKFLOW_DEPLOYMENTS=0`
`WORKER_VERSION_UPLOADS=0`
`SECRET_MUTATIONS=0`
`D1_MUTATIONS=0`
`ECONOMIC_ACTIONS=0`

Only this report and the plan document were written this checkpoint.

## 12. Release state (unchanged)

`FINAL_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0`
`FINAL_PRODUCTION_TRAFFIC=100%`
`H2A_CANDIDATE_TRAFFIC=0%` (candidate `2ca5d120-db79-4b54-8ae3-53e2c91dad87`,
rejected/incomplete, remains non-deployed)
H1 forensic job `de147124-c264-452b-b784-86ee4422ecd1` untouched.
`SUN1221E6R_H2B_REAL_PAYMENT_ELIGIBLE=NO`

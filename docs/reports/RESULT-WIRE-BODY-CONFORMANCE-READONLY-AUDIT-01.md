# RESULT-WIRE-BODY-CONFORMANCE-READONLY-AUDIT-01

Status: **`FAIL_WITH_PRODUCT_FINDING` — Outcome C (runtime body defect).** Mode:
source-backed, read-only audit. Tests and this report only. No production
behavior, contract, schema, migration, secret, or cloud change.

Follows `SECURITY-AUTHORITY-SA1-RESULT-BODY-INTEGRITY-READONLY-AUDIT-01`
(`82a3574`), which raised NS-1 as "UNRATED, not confirmed". This checkpoint
resolves NS-1 from source, from four real executors driven end to end, from the
real MCP SDK, and from existing live evidence.

## Core question, answered first

> Is the object SITEBORNE currently persists and returns actually the result
> object SITEBORNE's governed contract says buyers are supposed to receive?

**No.** The governed contract says the 200 body is a full PCC 1.0.0 document
whose `extensions["net.siteborne.<service>.v1"]` carries the service result. The
runtime persists and returns the flat signed `VerificationReceipt` (23 fields)
for all four production services. It contains no service output, no claims, no
evidence, no `contract`, no `pcc_version`, and it does not validate against the
governed output schema, the public MCP `outputSchema`, or the OpenAPI output
component.

Consequences proven locally, not inferred:

1. The service output is produced, returned to the Workflow, and then **never
   persisted and never returned to the caller** (all four executors).
2. The real MCP SDK **rejects** the real released body with `isError: true`
   ("Output validation error … required property 'pcc_version' …") for all four
   tools. The REST leg has already settled by then.
3. The receipt is real and fully covered by a valid Ed25519 signature, so the
   earlier integrity conclusion is unchanged; it protects the wrong object.

Why this was missed: commit `ac642cb` implemented `body: verificationReceipt` on
the belief that `pccResult.pcc` was the PCC document. `validateExecutorPcc`
returns `outcome.result.receipt`, and its comment ("`result.receipt` IS the
final signed PCC") is wrong. The full document (`signed.document`) exists
in-process (its size is reported as `metrics.output_bytes`, 3.9–4.3 KB) and is
discarded.

## 0. Result block

```
RESULT_WIRE_BODY_CONFORMANCE_READONLY_AUDIT_01=FAIL_WITH_PRODUCT_FINDING (OUTCOME C)

STARTING_HEAD=82a3574d933245751c5ee006d5cef969901b819a
FINAL_LOCAL_HEAD=<the commit that contains this report; a commit cannot embed its own SHA -- see `git log -1` / the checkpoint summary>
WORKING_TREE=clean before this checkpoint (0 status lines); clean after the local commit
BRANCH=metadata-vcm-qualification
82A3574_REACHABLE=YES (it was HEAD)
COMMITS_AFTER_82A3574=0

REAL_EXECUTOR_COUNT=4 (matches the previous report; enumerated from source, section 2)
REAL_EXECUTORS=verify_agent_output.v2, web_context_verified.v2, company_evidence_graph.v2, document_evidence_json.v2

CURRENT_SOURCE_WIRE_BODY=flat signed VerificationReceipt (23 keys) == outcome.result.receipt; identical key set for all four executors
PRIOR_GOVERNED_WIRE_BODY=full PCC 1.0.0 document with the service result at extensions["net.siteborne.<service>.v1"] (SUN-1222C decision a76142e; contracts/releases/2.0.0 schemas; additionalProperties:false)
PUBLIC_CONTRACT_WIRE_BODY=full PCC document (MCP outputSchema, OpenAPI *Output components, Bazaar outputExample, tool `returns` text); A2A default boundary is closed
PERSISTED_WIRE_BODY=x402_service_results.result_json = {status, body: <flat receipt>, settleResponse, durableEvidence:{pcc, receipt (both the same flat receipt), settlement_evidence, payment_service_link}, receipt_persisted, receipt_id, pcc}

WIRE_BODY_IS_FLAT_VERIFICATION_RECEIPT=YES (all four)
WIRE_BODY_IS_FULL_PCC_DOCUMENT=NO (all four)
WIRE_BODY_CONTAINS_SERVICE_OUTPUT=NO (all four)
WIRE_BODY_CONTAINS_CONTRACT=NO (contract_release/service_id/service_version scalars only; no `contract` object)
WIRE_BODY_CONTAINS_PCC_VERSION=NO
WIRE_BODY_CONTAINS_EVIDENCE=NO (evidence_hash scalar only)

SERVICE_OUTPUT_PERSISTED=NO
SERVICE_OUTPUT_REPLAYABLE=NO
SERVICE_OUTPUT_HASH_ONLY=YES (receipt.output_hash = hash of the DRAFT PCC document, which is never persisted; not a hash of the output itself)

SIGNATURE_INPUT=Ed25519 over canonicalize(ReceiptPreimage) (21 fields; receipt_id derived from it); no domain-separation tag
SIGNATURE_COVERS_WIRE_BODY=YES, every field (verifier rejects a mutation of decision, output_hash, service_id, and receipt_id)
SIGNATURE_COVERS_SERVICE_OUTPUT=TRANSITIVELY_ONLY (via output_hash over the draft PCC, whose content is not delivered)

WORKFLOW_BODY_CONFORMANCE=FAIL
REPLAY_BODY_CONFORMANCE=FAIL (same row, same body)
MCP_BODY_CONFORMANCE=FAIL (SDK rejects the real body, all four tools)
EXECUTOR_CONSISTENCY=CONSISTENT_WRONG (all four identical in shape; none conforms)

LIVE_BODY_EVIDENCE=PARTIALLY_CONFIRMED (section 10)

BUYER_RECEIPT_HASH_MATCHES_CURRENT_BODY=YES (independent hash, all four)
BUYER_RECEIPT_HASH_MATCHES_GOVERNED_BODY=NO
NEW_BODY_HASH_REQUIRED=YES if the body becomes the governed PCC document (the existing anchor protects the old representation only)

RESULT_CONTENT_DIGEST_FUTURE_ROLE=BECOME_BODY_ANCHOR (candidate; only after the body decision, section 14)

PROTO_FINDING_RELEVANT_TO_WIRE_BODY=NO for the current flat body; YES-POTENTIAL for the governed body (its extension carries free-form service output)

SECURITY_SEVERITY=no new P0/P1; one LATENT P2 (CW-6); no confidentiality/authorization break; see section 11 for the fund-adjacent caveat
PRODUCT_CONFORMANCE_SEVERITY=HIGH
PUBLIC_CONTRACT_SEVERITY=HIGH
DATA_LOSS_SEVERITY=HIGH (service output paid for, produced, never durably stored)

NS1_STATUS=RUNTIME_CONFORMANCE_DEFECT
RESULT_WIRE_BODY_CONFORMANCE=FAIL_WITH_PRODUCT_FINDING

NEW_P0_FINDINGS=0
NEW_P1_FINDINGS=0
NEW_P2_FINDINGS=1 (security, LATENT: CW-6 unsigned verify_agent_output headline verdict; not exposed by the current flat body). Non-security: CW-1..CW-5 (section 16)

CHARACTERIZATION_TESTS=35/35 (apps/edge-api/tests/result-wire-body-conformance-readonly-audit.test.ts)
AFFECTED_WIDER_TESTS=490/490 (32 files; section 17)
TYPECHECK=edge-api tsc rc=0
ESLINT=clean on the new test
PRETTIER=clean on the new test and this report
SECRET_SCAN=repo working-tree scan OK (1716 files, no leaks)
FULL_REPO_SUITE=NOT_RUN

SOURCE_BEHAVIOR_CHANGES=0
PUBLIC_CONTRACT_CHANGES=0
SCHEMA_CHANGES=0
MIGRATIONS=0

WORKER_UPLOADS=0
WORKER_DEPLOYMENT_MUTATIONS=0
PUBLIC_TRAFFIC_MUTATIONS=0
CONTINUATION_HOST_DEPLOYMENTS=0
ALERT_WORKER_DEPLOYMENTS=0
CLOUD_SECRET_MUTATIONS=0
PRODUCTION_D1_WRITES=0
REAL_PAYMENT_ATTEMPTS=0

REVIEW_RESULT=PASS_WITH_FINDINGS (section 18)
REVIEW_RECOMMENDS_RUNTIME_CHANGE=YES (recorded only; nothing implemented)

REPORT_PATH=docs/reports/RESULT-WIRE-BODY-CONFORMANCE-READONLY-AUDIT-01.md
NEXT_RECOMMENDED_CHECKPOINT=RESULT-WIRE-BODY-DELIVERY-DESIGN-01 (local design and local tests only; section 19)
```

## 1. State

At start: `HEAD=82a3574d933245751c5ee006d5cef969901b819a`, branch
`metadata-vcm-qualification`, `git status` empty. All 13 release-critical files
listed in section 19 are byte-identical (git blob ids) between the deployed
public source `182bfb5` and HEAD, and the MCP SDK dependency pin is unchanged,
so what is characterized here is the deployed logic. That is **source parity,
not observed runtime**; live observation is section 10.

## 2. The four real executors (enumerated from source)

`ROUTE_CONFIG_BUILDERS` in `production-dependencies.ts` builds exactly these
four, and `apps/edge-api/src/control-plane/production/` contains exactly four
`*-production-executor.ts` files.

| EXECUTOR_ID                                                   | SERVICE_ID                  | Wired in production bundle | Observed live paid success                                 |
| ------------------------------------------------------------- | --------------------------- | -------------------------- | ---------------------------------------------------------- |
| `buildVerifyAgentOutputV2ProductionExecutor(signer, reg)`     | `verify_agent_output.v2`    | YES                        | UNKNOWN (not read by this audit)                           |
| `buildWebContextV2ProductionExecutor(signer, reg, http)`      | `web_context_verified.v2`   | YES                        | YES: one real settled payment, 2026-09-20 (closure report) |
| `buildCompanyEvidenceGraphV2ProductionExecutor(…, http, db)`  | `company_evidence_graph.v2` | YES                        | UNKNOWN                                                    |
| `buildDocumentEvidenceJsonV2ProductionExecutor(…, worker, …)` | `document_evidence_json.v2` | YES                        | UNKNOWN                                                    |

Per-route enablement is Cloudflare var/secret state that this audit did not and
must not read: `PRODUCTION_ENABLED=UNKNOWN` per route. All four share:

```
EXECUTOR_RESULT_TYPE=ExecutorOutcome { result: ServiceExecutionResult, actualAmountAtomic?, resourceMetrics? }
SERVICE_OUTPUT_LOCATION=result.output  (= signed.document.extensions["net.siteborne.<service>.v1"]; undefined unless the mesh passed)
RECEIPT_LOCATION=result.receipt        (= signed.receipt, the flat VerificationReceipt)
PCC_LOCATION=in-process only: `signed.document` inside each service.execute(); never returned. Its size survives only as result.metrics.output_bytes
WIRE_BODY_PRODUCED=the flat receipt
```

Other routes: `paid-services.ts` (fixture/dev wiring, imported only by test
entrypoints), the Nevermined rail (not enabled, no production route), and A2A
(default execution boundary closed, `routes/a2a.ts:328-335`) are not production
result-release paths for these services.

## 3. Object-model lineage (identical for all four)

```
service.execute()
  draft PCC document                       (builder.ts: placeholder verification + receipt blocks)
  candidate.output = draft                 (verify-and-sign.ts:76-90)
  verifyAndSign():
    receipt = issueReceipt(candidate...)   output_hash = contentHash(canonicalize(draft))   issue.ts:19
    signed.document = draft + verification + receipt block (lossy projection of `receipt`)
    validated against the output schema -> schemaValidAfterFinalization (computed, consumed by nothing)
  ServiceExecutionResult:
    output  = signed.document.extensions[...]      (only if the mesh passed)
    receipt = signed.receipt                        (flat)
    metrics.output_bytes = JSON.stringify(signed.document).length
executor -> { result }
Workflow step generate-pcc:  validateExecutorPcc -> { valid, pcc: outcome.result.receipt }
Workflow:  verificationReceipt = pccResult.pcc                       (flat receipt)
           cachedResult.body   = verificationReceipt                 (paid-continuation-workflow.ts:1188)
           durableEvidence.pcc = verificationReceipt; .receipt = executorOutcome.result.receipt (same object)
persistResult -> x402_service_results.result_json = JSON.stringify(cachedResult)
persistReceipt -> row rewrite; body untouched
reconstructFromJob -> c.json(cached.body, cached.status)             (x402-service.ts:821-848)
MCP adapter -> result: body (unchanged) -> structuredContent -> SDK validates against outputSchema
```

`result.output` is read in exactly one place downstream: a fallback hash at
`paid-continuation-workflow.ts:1140` when `output_hash` is absent. Nothing wraps
or unwraps between `cachedResult.body` and the HTTP body.

## 4. Four representations, and the field matrix

- **A, current source wire body:** the flat receipt.
- **B, prior governed body:** the full PCC document (SUN-1222C, section 7).
- **C, public machine contract:** MCP `outputSchema`
  (`MCP_SERVICE_OUTPUT_SCHEMAS`), OpenAPI `*Output` components
  (`"Must be a valid PCC 1.0.0 document…"`), Bazaar `outputExample`
  (`bazaar/discovery.ts:155`, `frozenOutputExample`, a full PCC), and MCP tool
  `returns` text ("…with provenance, completeness, verification, and PCC
  context").
- **D, durable stored representation:** `result_json.body` = the flat receipt,
  plus the same receipt twice more under `pcc` / `durableEvidence`.

| Field / semantic object | A Current source                                            | B Prior governed                                                         | C Public contract                 | D Persisted                |
| ----------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------- | -------------------------- |
| decision                | `decision` (top level)                                      | `verification.decision`                                                  | same as B                         | `body.decision`            |
| signed receipt          | the whole body                                              | `receipt` block (8 of the signed fields)                                 | same as B                         | whole body                 |
| service output          | **absent**                                                  | `extensions["net.siteborne.<svc>.v1"]`                                   | same as B (`extensions` required) | **absent**                 |
| claims                  | absent                                                      | `claims[]`                                                               | required                          | absent                     |
| evidence                | `evidence_hash` scalar                                      | `evidence[]`                                                             | required                          | scalar only                |
| contract                | `service_id`, `service_version`, `contract_release` scalars | `contract{service_id, service_version, output_schema_hash, quote_id, …}` | required                          | scalars only               |
| PCC version             | absent                                                      | `pcc_version`                                                            | required                          | absent                     |
| signature               | `signature` (top level)                                     | `receipt.signature`                                                      | same as B                         | `body.signature`           |
| completeness            | number                                                      | object (`score`, vectors)                                                | object                            | number                     |
| durable evidence        | n/a                                                         | n/a                                                                      | n/a                               | settlement + link evidence |
| service/output hash     | `output_hash` (hash of the draft)                           | `receipt.output_hash` (same value)                                       | same as B                         | `body.output_hash`         |

The missing top-level PCC-required fields are computed by the test from the
canonical schema's `required` list (not from the body): `pcc_version`,
`contract`, `subject`, `claims`, `evidence`, `provenance`, `verification`,
`receipt`.

## 5. Flat-receipt finding, re-tested per executor

Each executor was driven as the real production executor, through the real
Workflow, real `validateExecutorPcc`, real `D1ResultReceiptPersistence`, and
real `persistLinkEvidence`. Only edges are faked: HTTP fetch (web-context,
company), a statement-level D1 (SEC rate window, results, link evidence), and
the document worker fixture (a captured real worker result).

| EXECUTOR                    | ACTUAL_BODY_TYPE | ACTUAL_BODY_KEYS | released body | output (in memory) | full PCC `metrics.output_bytes` | OUTPUT_PRESENT in row | SIGNATURE_VALID | REPLAY_BODY_EQUAL |
| --------------------------- | ---------------- | ---------------- | ------------- | ------------------ | ------------------------------- | --------------------- | --------------- | ----------------- |
| `verify_agent_output.v2`    | flat receipt     | 23               | 6,843 B row   | 440 B              | 3,877 B                         | NO                    | YES             | YES               |
| `web_context_verified.v2`   | flat receipt     | 23               | 6,847 B row   | 551 B              | 4,315 B                         | NO                    | YES             | YES               |
| `company_evidence_graph.v2` | flat receipt     | 23               | 6,855 B row   | 809 B              | 4,269 B                         | NO                    | YES             | YES               |
| `document_evidence_json.v2` | flat receipt     | 23               | 6,855 B row   | 406 B              | 4,207 B                         | NO                    | YES             | YES               |

`ACTUAL_BODY_HASH` is deliberately not tabulated: every run uses a fresh random
signing key and timestamps, so the hash differs each run. What is asserted is
that the persisted `buyer_receipt_hash` and `verification_receipt_hash` equal an
independent hash of the released body for every executor. The web-context and
company runs use faked HTTP/SEC inputs, so their output sizes are indicative
only.

The four key sets are identical. The wrong shape is therefore **systemic, not
service-specific**.

Not tested: the HTTP route handler itself (`reconstructFromJob` is the same
function covered by the previous audit), and the deployed Worker.

## 6. Service output durability

```
SERVICE_OUTPUT_CREATED=YES (all four; result_class success; output keys observed)
SERVICE_OUTPUT_RETURNED_TO_WORKFLOW=YES (executor step output)
SERVICE_OUTPUT_INCLUDED_IN_RECEIPT=NO
SERVICE_OUTPUT_INCLUDED_IN_PCC=YES, but the PCC document is not returned or persisted
SERVICE_OUTPUT_PERSISTED=NO in any product store (no leaf string unique to the output appears anywhere in the row); a platform-managed Workflow step copy exists, retention UNKNOWN
SERVICE_OUTPUT_RECONSTRUCTABLE=NO
SERVICE_OUTPUT_RETURNED_TO_CALLER=NO
```

It disappears at `validateExecutorPcc` /
`cachedResult.body = verificationReceipt`. What survives is one commitment:
`receipt.output_hash` = SHA-256 of the JCS form of the **draft PCC document**
(`candidate.output = draft`), not of the service output alone and not of the
released body. A commitment is not delivery: nobody, including SITEBORNE, can
open it, because the draft is not stored.

One non-product copy exists: the `invoke-executor` Workflow step returns the
whole `ExecutorOutcome` (including `result.output`), which Cloudflare keeps in
Workflow engine state. It is platform-managed, has bounded retention, and is not
addressable by the product; the earlier H2B2-R3A finding is that step outputs
are truncated by the describe API. Its retention is `UNKNOWN`. So "not
persisted" holds for every product-level store (D1, artifacts, audit), not
absolutely.

## 7. Governance chronology (from source, in order)

1. `docs/operations/X402_HTTP_VERTICAL_SLICE.md:50` (SUN-0700A): 200 = "service
   output + receipt_id + link_id" (bespoke envelope).
2. Schemas since 1.0.0: each `*-output.schema.json` says "Must be a valid PCC
   1.0.0 document with required net.siteborne.<svc>.v1 extension", `allOf` the
   PCC schema at top level.
3. **SUN-1222C governance decision** (`a76142e`): governed representation = the
   full PCC document; the envelope is `IMPLEMENTATION_BUG`. The document still
   ends at `READY_FOR_IMPLEMENTATION_APPROVAL`; the only record that approval
   was given is the `ac642cb` commit message ("the approved governance
   decision"). That is a missing authority record (CW-5), not evidence against
   approval.
4. **`ac642cb`, 2026-09-09:** "Implements the approved governance decision":
   `body: verificationReceipt`, reasoning that the result must validate as a
   PCC.
5. `74290db`, 2026-09-11 (migration 0010; link evidence): `buyer_receipt_hash`
   etc.
6. Live, 2026-09-20 (`8aecb18`): the harness comment says the 200 body "is the
   signed verification receipt (SUN-1222C)". That is a **test-harness
   accommodation, not a decision**: it appears only in a test file, cites
   SUN-1222C (which decided the opposite), and no ADR, report, or commit
   approves a flat receipt.

```
PRIOR_GOVERNED_RESULT_REPRESENTATION=full PCC document
PRIOR_DECISION_DATE_OR_COMMIT=a76142e (decision); ac642cb 2026-09-09 (implementation)
PRIOR_DECISION_EVIDENCE=docs/reports/SUN-1222C-pcc-wire-result-governance-decision.md; ac642cb commit message
CURRENT_SOURCE_CONFORMS=NO
FLAT_RECEIPT_EVER_INTENTIONALLY_APPROVED=NO (none found in docs/decisions, docs/reports, git log)
LATER_DECISION_SUPERSEDING=NONE FOUND
```

Chronology is therefore not documentation drift (Outcome B) and not ambiguous
(Outcome D) as to intent. It is a defect in delivering an approved contract
(Outcome C). One sub-question is genuinely unresolved and is a design decision,
not an ambiguity of intent: section 12.

## 8. Public contract conformance

| PUBLIC_SURFACE                            | EXPECTED_SUCCESS_BODY                                      | SOURCE_OF_EXPECTATION                                | CURRENT_RUNTIME_MATCHES |
| ----------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------- | ----------------------- |
| MCP tool `outputSchema` (4 tools)         | full PCC document (+ extension)                            | `MCP_SERVICE_OUTPUT_SCHEMAS` (`frozen-contracts.ts`) | NO                      |
| MCP tool `returns` text                   | "evidence graph / web context / … with PCC evidence"       | `protocol-mcp/src/server.ts` 480-522                 | NO                      |
| OpenAPI 2.0.0 `/v2/*` 200 responses       | `*Output` components: "Must be a valid PCC 1.0.0 document" | `contracts/releases/2.0.0/openapi/`                  | NO                      |
| Bazaar `outputExample` (in 402 discovery) | full PCC example                                           | `bazaar/discovery.ts:155`                            | NO                      |
| A2A card / executor                       | n/a: default boundary closed                               | `routes/a2a.ts:328-335`                              | NOT_APPLICABLE          |

**Runtime validation is NOT descriptive only, and it splits by transport:**

- **REST:** the 200 is `c.json(cached.body)` verbatim. Nothing validates the
  wire body against the output schema. (The only validation,
  `schemaValidAfterFinalization` in `verify-and-sign.ts`, checks
  `signed.document`, not the wire body, and no code reads its result.)
- **MCP:** the SDK (`@modelcontextprotocol/server` 2.0.0, `validateToolOutput`,
  `mcp-DXXb3Vv3.mjs:1439-1444`) validates `structuredContent` against the
  registered `outputSchema` for non-error results. The test proves the real body
  fails for **all four tools** with `isError: true` and
  `Output validation error: Invalid structured content for tool <tool>: data must have required property 'pcc_version', …'contract', 'subject', 'claims', 'evidence', 'provenance', 'verification', 'receipt'`.
  A control (the governed example through the same production adapter and SDK)
  passes, so the harness is not what rejects.
- The MCP adapter is wired **unconditionally** to the real paid routes
  (`routes/mcp.ts:287`; the comment there says the routes gate themselves).
  Hence for a paid MCP `tools/call` the REST leg settles first and the caller
  then receives an error. **No live MCP paid call is evidenced** (the observed
  canary used REST), so this is proven by test against the real SDK and real
  adapter, not observed in production: `MCP_LIVE_OBSERVED=NOT_AVAILABLE`.

## 9. Signature semantics

```
SIGNATURE_INPUT=Ed25519 over TextEncoder(canonicalize(ReceiptPreimage)); ReceiptPreimage = 21 fields (models.ts); issue.ts:49-52; no domain tag
SIGNATURE_COVERS_RECEIPT=YES: all 21 preimage fields; receipt_id = computeReceiptId(preimage) and is re-checked (receipt_id_mismatch)
SIGNATURE_COVERS_WIRE_BODY=YES (every field of the flat body)
SIGNATURE_COVERS_SERVICE_OUTPUT=TRANSITIVELY_ONLY: through output_hash over the draft PCC
SIGNATURE_COVERS_CONTRACT=PARTIAL: service_id, service_version, contract_release, input_hash scalars
SIGNATURE_COVERS_EVIDENCE=evidence_hash only (hash of the sorted evidence content-hash list)
```

`verifyServiceReceipt(wire_body)` = PASS for all four with the real verifier and
the production key registry. Mutating `decision`, `output_hash`, `service_id`,
or `receipt_id` fails. No self-referential helper is used.

## 10. Live evidence (no new payment)

Searched tracked reports and git-ignored `.superpowers` for a captured raw body:
none exists. What exists:

- `FIRST-PAID-WEB-DIRECT-REAL-PAYMENT-AUTHORIZATION-01-closure.md` (2026-09-20):
  one real settled payment; the persisted result row's fields are listed as
  **receipt fields** (service_id, decision, completeness, signing_key_id,
  Ed25519/JCS, issued_at), and it notes `retrieval_mode` is "not carried in the
  receipt".
- The corrected client detector (`8aecb18`, `observeServiceExecution`) reports
  `service_execution_observed=true` only for a body with **top-level**
  `service_id`, `receipt_id`, and `decision`, and the old `result_class` check
  was the "false negative". A full PCC document has none of those three at top
  level (`service_id` is under `contract`, `decision` under `verification`, and
  the PCC receipt block has no `receipt_id`), so the client observed the flat
  shape live.

```
LIVE_BODY_EVIDENCE=PARTIALLY_CONFIRMED
```

Not `CONFIRMED`: no raw body was archived, so the absence of
`output`/`extensions` in the live body is inferred from the row description plus
source, not observed. Only `web_context_verified.v2`/direct has live evidence.
Source parity with the deployed Worker is a separate evidence class and is not
counted here.

## 11. Severity, kept separate

```
SECURITY_SEVERITY=no new P0/P1/P2 security finding (see caveat)
PRODUCT_CONFORMANCE_SEVERITY=HIGH: paying buyers do not receive the requested service result
PUBLIC_CONTRACT_SEVERITY=HIGH: four public surfaces promise a PCC document; runtime returns a receipt
DATA_LOSS_SEVERITY=HIGH: service output is produced and paid for, never persisted, unrecoverable on replay
```

The security caveat, stated rather than hidden: money is collected for a service
whose result is not delivered (REST) or is delivered as an error after
settlement (MCP). That is a customer-harm and refund-exposure issue. It is not a
confidentiality, authorization, or integrity breach, so it is not scored on the
P0/P1/P2 security scale here. It does not close or alter the carried P1 (result
release by request-tuple possession).

The receipt also narrows disclosure: because the body lacks the service output,
the carried result-confidentiality P1 currently exposes **less** than the
governed body would. Fixing NS-1 will raise the sensitivity of what the
tuple-possession model releases. Sequencing consequence in section 19.

## 12. The authoritative future body (design only)

Governed by source and specification today: **B, the full PCC document.** The
candidates, against the requested criteria:

| Criterion                              | A flat receipt | B full PCC document                                  | C envelope {output, receipt, PCC}                 |
| -------------------------------------- | -------------- | ---------------------------------------------------- | ------------------------------------------------- |
| Contains the requested output          | NO             | YES (`extensions`)                                   | YES                                               |
| Governed by existing decisions/schemas | NO             | **YES**                                              | NO: `additionalProperties:false` forbids siblings |
| Replay durable                         | n/a            | needs `signed.document` retained (not today)         | same                                              |
| Backward-compatible                    | n/a            | no external consumer per SUN-1222C (unverified live) | no                                                |
| Independently verifiable signature     | YES            | **UNRESOLVED (below)**                               | YES (receipt carried)                             |
| Minimal duplicate state                | YES            | YES                                                  | NO                                                |

Unresolved, and a reason the next step is a design checkpoint, not an immediate
fix:

1. **The PCC `receipt` block is a lossy 8-field projection**
   (`receipt-mapping.ts`: "a pure, lossy projection"). The Ed25519 signature is
   over the 21-field preimage (`request_id`, `verifier_set_hash`,
   `evidence_hash`, `receipt_version`, `contract_release`, …). A buyer holding
   only the PCC document cannot reproduce the signed bytes.
2. **Two receipt-signing schemes exist.** `pcc-schema`'s frozen `signReceipt`
   (`RECEIPT_SIGNATURE_CONTEXT = "SITEBORNE-PCC-RECEIPT-V1"`, different
   preimage, `SIGNING_POLICY.payload = canonical({output_hash, policy_hash})`)
   is defined but used by no production code; production signs
   `canonicalize(ReceiptPreimage)` with no domain tag. A verifier written to the
   frozen PCC spec would reject production signatures. This is `source-derived`,
   not tested against a spec-conformant verifier.
3. **`receipt.output_hash` covers the draft**, with placeholder
   verification/receipt blocks. There is no documented rule for a buyer to
   recompute it from the final document.
4. **CB-1** (CW-3): the receipt block that B would publish carries an all-zero
   `policy_hash`, and the receipt says `contract_release 1.0.0`.
5. **`persistLinkEvidence` would throw after settlement.** It requires top-level
   `pcc.signing_key_id` and `pcc.signature` (`payment-finalization.ts:87-89`)
   and hashes `input.pcc` as `buyer_receipt_hash`. In a full PCC those live
   under `receipt`, so swapping the body without changing this function fails
   the Workflow at finalization, after the money moved. `validateExecutorPcc`
   and the `verificationReceiptId` extraction (`workflow:1093`) are coupled to
   the same shape.
6. **Legacy rows** need a representation discriminator: their
   `buyer_receipt_hash` is a hash of the flat receipt.

So B is governed but not yet standalone-verifiable; C is verifiable but needs a
governed schema change. Choosing between them, or amending the signature scheme,
is a governance decision. This audit does not make it.

## 13. Consequence for the existing receipt hash

```
CURRENT_BUYER_RECEIPT_HASH_STILL_VALID=YES for the current (flat) body; NO for a governed body
CURRENT_VERIFICATION_RECEIPT_HASH_STILL_VALID=same
NEW_BODY_HASH_REQUIRED=YES if the body becomes the PCC document
PERSISTENCE_CHANGE_REQUIRED=YES: the final document must be retained (today discarded); the row body changes
MIGRATION_REQUIRED=NO for the columns as such (new bodies fit result_json); historical rows stay flat and are LEGACY_UNBOUND to any new anchor
```

The previous audit's "no new persisted digest needed" is therefore **scoped**:
true for the currently persisted flat body, false as a forward statement.

## 14. `ResultContentDigest` role

`BECOME_BODY_ANCHOR` is the likely role, **only after** the body decision. It
hashes `{content, domain}` over the stored form of `CachedResult.body`; if the
body becomes the PCC document it is exactly the right representation, and
`buyer_receipt_hash` (bare `hashPaymentObject`) would be the legacy anchor for
flat bodies. Do not wire or remove it now. If the body is instead left flat, it
stays `REMAIN_UNUSED`.

## 15. `__proto__`

`PROTO_FINDING_RELEVANT_TO_WIRE_BODY=NO` for the current body (fixed keys, no
free-form maps). For the governed body it becomes relevant: extensions carry
free-form service output (`http_metadata`, `field_groups`, buyer-influenced
JSON), and `receipt.output_hash` is already computed over such a draft today.
Remediation stays a separate checkpoint; canonicalization is untouched.

## 16. Findings

- **CW-1 (product, HIGH): the released and persisted body is the flat receipt,
  not the governed PCC document, and the service output is not delivered or
  stored.** All four executors. Systemic. Root cause: `validateExecutorPcc`
  returns `result.receipt`, and `signed.document` is discarded. Fix location
  (recorded, not made): service-runtime `ServiceExecutionResult` must carry the
  final document and `validateExecutorPcc` must return it, after the section 12
  decisions.
- **CW-2 (product/customer harm, HIGH): every fulfilled paid MCP call returns
  `isError` after settlement** (real SDK, real adapter, all four tools). Not
  observed live. Money-safe in the ledger sense (the result row and link
  evidence persist), but the buyer is told the call failed.
- **CW-3 (public contract, MEDIUM): the receipt stamps
  `contract_release: 1.0.0`, `pcc_schema_release: 1.0.1`,
  `policy_hash: sha256:0…0`** (defaults of `buildServiceContext`; none of the
  four executors overrides them; only a rejection body hard-codes `2.0.0`). The
  service contract is 2.0.0; an external verifier expecting 2.0.0 gets
  `context_mismatch`. The all-zero `policy_hash` means the signed receipt does
  not bind a real verification policy: a metadata-accuracy defect, not an
  exploitable one, but it weakens the "proof" claim. Called CB-1 in the test
  names.
- **CW-4 (governance, MEDIUM): PCC receipt signature semantics diverge** between
  the frozen spec (`SIGNING_POLICY`, `signReceipt`) and production (section 12,
  items 1-3). Source-derived; not verified with a spec-conformant verifier.
- **CW-5 (process, LOW/MEDIUM): two gaps let CW-1 ship.** (a) The SUN-1222C
  decision document never records the approval it requested. (b) The in-process
  test binding stubs `validatePcc` as `result.verification`
  (`in-process-workflow-binding.ts:174`), so suites and the MCP acceptance
  test's "SECTION 8 FINDING" attributed the schema failure to a fixture-fidelity
  gap that in fact also exists in production. The new test is the first that
  drives the real executors.
- **CW-6 (security, LATENT P2; reviewer-identified, verified from source, not
  test-proven): the `verify_agent_output` headline verdict is unsigned.** The
  service builds `extension` without `outcome`/`score`, passes it by reference
  into the draft (`builder.ts:134`), calls `verifyAndSign` (which hashes the
  draft into `output_hash` and signs), and only afterwards assigns
  `extension.outcome` and `extension.score`
  (`agent-verification/service.ts:228-229`). The delivered `output.outcome`
  (pass/conditional/fail) and `output.score` are therefore outside both hash and
  signature; the signed `decision` is the mesh's decision, a different field. It
  is not exposed today because the flat body carries no `output`, so **fixing
  CW-1 without fixing this would publish an unsigned verdict inside a
  "proof-carrying" document.** Recorded as a prerequisite of the CW-1 fix.
- **Carried, unchanged:** P1 result release by request-tuple possession; the
  canonicalizer `__proto__` P2; Nevermined recovery having no anchor (disabled).

Tally (security scale): new P0 = 0, new P1 = 0, new P2 = 1 (CW-6, latent).
Relevant totals: P0 = 0, P1 = 1, P2 = 5. CW-1..CW-5 are not counted on that
scale (section 11).

## 17. Tests and gates

New: `apps/edge-api/tests/result-wire-body-conformance-readonly-audit.test.ts`,
35 tests. Per executor (×4): settles and persists; exact 23-key body and missing
governed fields (from the schema's `required`); stamped defaults (CW-3); output
absent from the row (only leaves unique to the output, so receipt strings like
"standard" cannot make it vacuous); body fails the contracts/2.0.0 schema and
the MCP `outputSchema` while the governed example passes the same validators;
real signature verification plus four mutations; persisted anchor equals an
independent hash. Plus cross-executor consistency (2) and the real MCP SDK
through the production adapter: 1 control + 4 rejections, each pinning the exact
`isError` text and all eight missing PCC fields.

Independence: expectations come from the schema files, an independent
canonicalizer plus `node:crypto`, and the real verifier. Not driven: the HTTP
route handler itself and the deployed Worker.

Non-vacuity: every negative assertion has a positive control (the governed
example passes the same Ajv validator and the same MCP boundary).

Gates: see section 0; the values below were observed.

```
FOCUSED=35/35
AFFECTED_WIDER=490/490 (32 files: previous audit tests, workflow + pcc-wire-result + acceptance,
  x402 route, MCP adapter, production executors, protocol-mcp, vcm/security)
TYPECHECK=edge-api tsc rc=0
ESLINT=clean
PRETTIER=clean (test and report)
SECRET_SCAN=working-tree scan OK, 1716 files
FULL_REPO_SUITE=NOT_RUN
```

## 18. Independent review

An independent read-only reviewer attacked ten claims. Verdict:
**`PASS_WITH_FINDINGS`, `REVIEW_RECOMMENDS_RUNTIME_CHANGE=YES`** (recorded only;
nothing was implemented).

| Claim                                | Reviewer verdict     | Action                                                                    |
| ------------------------------------ | -------------------- | ------------------------------------------------------------------------- |
| C1 four executors, no missed path    | CONFIRMED            | none (A2A execution not independently verified by the reviewer)           |
| C2 flat receipt is the released body | CONFIRMED            | none                                                                      |
| C3 output not persisted              | PARTIAL              | applied: Workflow step copy disclosed, retention UNKNOWN (section 6)      |
| C4 governance chronology             | CONFIRMED            | applied: approval record gap (CW-5)                                       |
| C5 MCP SDK rejection                 | CONFIRMED, corrected | already `isError` result, not a JSON-RPC error; tests pin exactly that    |
| C6 signature scope                   | CONFIRMED            | exception found: CW-6                                                     |
| C7 stamped defaults                  | CONFIRMED / PARTIAL  | severity kept MEDIUM; contract_release should follow the registry's 2.0.0 |
| C8 live evidence                     | PARTIALLY_CONFIRMED  | none; caveat: canary split, so the serving version is unproven            |
| C9 severity                          | PARTIAL              | applied: fund/consumer-protection exposure stated (section 11)            |
| C10 test quality                     | mostly sound         | limits recorded (below)                                                   |

Reviewer's own answers: the governed representation is B (full PCC document);
and `buyer_receipt_hash` stays a valid anchor only if `pcc` is the same object
as the body, which a full-PCC body breaks at `persistLinkEvidence` (section 12
item 5).

Consequential claims I verified myself before accepting: the by-reference
mutation in CW-6 (source read: initial `extension` lacks `outcome`/`score`;
`builder.ts:134` embeds the same object; assignment follows `verifyAndSign`),
and the `persistLinkEvidence:87-89` precondition. The reviewer's "tests not run"
note is superseded: they ran, 35/35.

Test limits the reviewer noted and I accept: `FakeLinkD1.first()` echoes the
insert args, so the conflict re-read is trivially consistent (only `insertArgs`
is asserted, so this is harmless); and "output absent" inspects the results row,
not Workflow engine state.

## 19. Next checkpoint, change boundary, accounting

**NEXT_RECOMMENDED_CHECKPOINT: `RESULT-WIRE-BODY-DELIVERY-DESIGN-01`**: local
design and local tests only, no deployment. It must decide, in this order:

1. body representation (B vs C) and whether the frozen schema or the signing
   scheme is amended (section 12 items 1-3), as a governance decision;
2. where the final document is retained (returned from `verifyAndSign`) with no
   new write path where possible;
3. CW-3 stamping fixes and CW-6 (sign `outcome`/`score` or compute them before
   signing), since B would publish them; plus the `persistLinkEvidence` /
   `validateExecutorPcc` coupling (section 12 item 5);
4. the anchor for the new body (`ResultContentDigest` vs `buyer_receipt_hash`).

Do **not** resume read-time integrity or Security Authority wiring before step
1: it would entrench the wrong representation. Sequence the release of the
corrected body with the carried result-authorization P1, because the corrected
body discloses more.

Release-critical files compared (blob ids identical between `182bfb5` and HEAD):
`paid-continuation-workflow.ts`, `production-dependencies.ts`,
`x402-service.ts`, `x402-mcp-adapter.ts`, `service-runtime/src/context.ts`,
`pcc/verify-and-sign.ts`, `verification/src/receipt/issue.ts`,
`protocol-mcp/src/server.ts`, `protocol-mcp/src/frozen-contracts.ts`, and the
four `*-production-executor.ts`.

Mutation accounting: files added = 1 test + this report; production source,
public contract, schema, migration, secret, Worker, D1, payment, deployment:
all 0. Nothing was pushed.

# RESULT-FINALIZATION-INTERNAL-ARTIFACT-01

Status: **PASS_WITH_FINDINGS** (independent review PASS_WITH_FINDINGS; every
reviewer finding either fixed or recorded below).

## 1. Provenance

- Starting HEAD: `327278c4fcfc93f77ea750b2836732fa940dee9b` (working tree clean
  at start).
- Scope: first bounded production phase of the approved self-verifying PCC
  result architecture — the INTERNAL finalization boundary only. The released
  successful result body is unchanged.
- No deploy, no payment, no production D1 write, no push.

## 2. Changed files

Production (all in `packages/service-runtime` and `apps/edge-api`; nothing under
`contracts/`, `schemas/`, `migrations/`, `governance/`, `protocol-*`,
`wrangler*`):

| File                                                                                                | Classification                                                                 |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `packages/service-runtime/src/pcc/finalized-result.ts` (new)                                        | internal finalized-result model, semantic snapshot, vNext preimage             |
| `packages/service-runtime/src/pcc/governed-metadata.ts` (new)                                       | governed metadata derivation                                                   |
| `packages/service-runtime/src/pcc/code-vocabulary.ts` (new)                                         | closed finding / failure vocabularies                                          |
| `packages/service-runtime/src/pcc/unicode-scalar.ts` (new)                                          | Unicode-scalar + finite-number validation                                      |
| `packages/service-runtime/src/pcc/verify-and-sign.ts`                                               | finalization ordering (mesh → semantics → freeze → proof)                      |
| `packages/service-runtime/src/services/agent-verification/service.ts`                               | `outcome`/`score` moved into semantic finalization; no post-sign mutation      |
| `packages/service-runtime/src/services/{company-evidence,web-context,document-evidence}/service.ts` | one line each: expose `finalized`                                              |
| `packages/service-runtime/src/types.ts`, `pcc/index.ts`                                             | `finalized?` field, exports                                                    |
| `apps/edge-api/src/control-plane/production/finalized-outcome.ts` (new)                             | projects typed link inputs, drops artifact at the durable step boundary        |
| `apps/edge-api/src/control-plane/production/*-v2-production-executor.ts` (4)                        | route through the projection helper                                            |
| `apps/edge-api/src/control-plane/routes/paid-services.ts`, `routes/x402-service.ts`                 | same helper for the v1 fixture executors; `ExecutorOutcome.linkEvidenceInputs` |
| `apps/edge-api/src/control-plane/workflows/{paid-continuation-workflow,production-dependencies}.ts` | typed link inputs; `validateExecutorPcc` checks them pre-settlement            |
| `apps/edge-api/src/control-plane/repositories/d1/payment-finalization.ts`                           | `persistLinkEvidence` consumes typed inputs only                               |

`PRODUCTION_RUNTIME_BEHAVIOR_CHANGES_TO_PUBLIC_WIRE=0`.
`IMPLEMENTATION_SCOPE=PASS`.

Tests/fixtures:
`packages/service-runtime/src/tests/{internal-result-artifact,result-wire-characterization}.test.ts`,
`four-service-scenarios.ts`, `fixtures/result-wire-characterization/*.json`,
`fixtures/internal-artifact-preimage/*.json`,
`apps/edge-api/tests/result-finalization-internal-artifact.test.ts`; three
existing edge tests/fixtures updated for the typed `persistLinkEvidence` input.

## 3. Artifact design

`INTERNAL_RESULT_ARTIFACT = InternalResultArtifact<K,E>` in
`packages/service-runtime/src/pcc/finalized-result.ts`, attached as
`ServiceExecutionResult.finalized`.

```
serviceOutput   extension as the service produced it (pre verdict-dependent finalization)
finalExtension  final service extension (outcome/score included) — proof-bearing
pccDocument     semantic PCC projection: no top-level receipt, no proof namespace,
                governed input/output schema hashes
verificationReceipt / wireBody   the CURRENT flat receipt, unchanged
verifierResults governed projection {verifier_id, status, findings[{code,severity}], failure_codes}
governed        contract_release, policy_hash, pcc schema release/hash, input/output schema hashes
proofPreimage   UNSIGNED vNext preimage + its JCS text + the receipt_id it would yield
linkEvidenceInputs {receiptId, signingKeyId, signature, buyerReceiptHash}
```

Semantic state (`finalExtension`, `pccDocument`, `verifierResults`,
`proofPreimage`) is separate from the public wire representation (`wireBody`).

## 4. Semantic freeze mechanism

`SEMANTIC_FREEZE_MECHANISM`: builder → finalized-type transition plus defensive
JSON clone plus deep freeze plus re-hash.

- `freezeSemanticSnapshot` is the only producer of a `SemanticSnapshot`
  (module-private `unique symbol` brand).
- It rejects invalid Unicode scalars and non-finite numbers, clones,
  deep-freezes, and hashes the final extension and the semantic document.
- `buildInternalResultArtifact` (proof phase) requires the brand and re-hashes
  the snapshot; a forged or altered snapshot fails with
  `semantic_snapshot_changed_after_freeze`.
- The whole artifact is deep-frozen; `verifyAndSign` hands callers a detached
  mutable copy of the final extension, so mutating it cannot change proof state.

## 5. verify_agent_output ordering fix

Before: `verifyAndSign` ran, then `extension.outcome`/`extension.score` were
assigned to the object shared with the signed draft. Now: `verifyAndSign`
accepts `finalizeSemantics(verdict)`. Order is mesh verdict →
`finalizeSemantics` → `freezeSemanticSnapshot` → legacy receipt + vNext
preimage. `POST_SIGN_RESULT_MUTATIONS=0`: nothing is assigned to any result
object after signing.

## 6. All four executors

`ALL_FOUR_EXECUTORS_USE_INTERNAL_RESULT_ARTIFACT=YES`. All four services call
the same `verifyAndSign`, which builds the artifact; all four production
executors project through the same helper. Service variation is only the
extension and governed codes.

## 7. Legacy receipt basis (deliberate interim design — read this)

The released wire body must stay byte-identical, so the legacy receipt is still
issued over the legacy draft basis (which for `verify_agent_output` predates
`outcome`/`score`). The new vNext preimage binds the final semantic snapshot.
Consequence: until the wire cutover, the _released_ `verify_agent_output`
receipt does not bind `outcome`/`score` — exactly as before this checkpoint. The
internal proof state does. The cutover checkpoint removes the legacy basis.

## 8. Typed link-evidence flow

`persistLinkEvidence` takes `linkEvidenceInputs` (validated fail-closed by
`parseLinkEvidenceInputs`) and never reads `signing_key_id` / `signature` off
any response body. `PERSIST_LINK_EVIDENCE_DEPENDS_ON_WIRE_SHAPE=NO`.

`validateExecutorPcc` now rejects a success that lacks typed inputs
(`missing_link_evidence_inputs`) or whose `buyerReceiptHash` does not equal the
hash of the released receipt (`link_evidence_hash_mismatch`) — both **before
settlement**.

**Durable step boundary:** `invoke-executor` output is persisted by the Workflow
engine (size-limited), so the full artifact is deliberately _not_ carried across
it; only the small `linkEvidenceInputs` is. The cutover checkpoint must decide
where the full PCC is built/stored.

## 9. Real persistLinkEvidence test

`REAL_PERSIST_LINK_EVIDENCE_TYPED_TEST=PASS` —
`apps/edge-api/tests/result-finalization-internal-artifact.test.ts` runs the
real `D1PaymentFinalizationRepository.persistLinkEvidence` over a D1 fake: (A)
typed succeeds; (B) two different wire representations with identical typed
state persist identical rows; (C) a hostile wire-shaped `pcc` is ignored, key id
comes from typed state; (D) missing/malformed/legacy-shaped inputs fail closed
with nothing written. It also runs the real executor + real
`validateExecutorPcc` + real Workflow to `settled`.

## 10. Governed metadata derivation

`INTERNAL_TRUTH_METADATA_READY=YES`. Values are build-time embedded and
re-derived in tests from the authorities:

- `contract_release` ← `contracts/releases/{1.0.1,2.0.0}/CONTRACT_RELEASE.yaml`
- `policy_hash` ← `hashPolicy(loadPolicy())` of
  `governance/VERIFICATION_POLICY.yaml` (`sha256:def2b52c…1401`)
- PCC schema release/hash ← `pcc_dependency` + the release's immutable
  `proof-carrying-context.schema.json` bytes
- input/output schema hashes ← `services[]` entry + the governed schema bytes

An independent reviewer recomputed every constant with `shasum`.

## 11. Placeholder elimination

`NEW_INTERNAL_PLACEHOLDER_HASHES=0`. The artifact walk (excluding only the
legacy receipt/wireBody) finds no repeated-digit hash; the proof phase also
throws if one appears. The legacy wire receipt still carries the legacy defaults
(e.g. all-zero `policy_hash`) — asserted in a test as intentionally unchanged.

Residual, not a hash: the semantic document's `verification.policy` (a `pol_…`
id) still derives from the legacy context; no governed authority for it exists
yet.

## 12. Code vocabularies

`FINDING_CODE_VOCABULARY` / `FAILURE_CODE_VOCABULARY` = new internal closed sets
in `pcc/code-vocabulary.ts`: no prior canonical runtime vocabulary existed
(verifiers emit bare strings). Finding codes (18 verifier codes + 2 mesh codes +
26 `injection_*`), verifier failure codes (13), and the existing
`ServiceFailureCode` union as a runtime set. Unknown values throw
`UnknownCodeError` (reject, no UNKNOWN class). A drift test scans
`packages/verification/src/verifiers/*.ts` and `mesh.ts` so an
emitted-but-unlisted code fails the build. Review finding 1 (mesh
`verifier_timeout`/`verifier_exception` missing) fixed with a test.

## 13. Unicode scalar boundary

`INVALID_UNICODE_SCALAR_REJECTED=YES` at `freezeSemanticSnapshot`, before any
hash or signature: lone high, lone low, nested, object key, claim value outside
the extension all rejected; a valid surrogate pair accepted; no `receipt_signed`
event on rejection. Also rejects NaN/Infinity (which `JSON` would turn into
`null`). Failure surfaces as a closed `internal_error` result before settlement.

## 14. Byte-exact preimage

`SIGNED_PREIMAGE_BYTE_EXACT_RECONSTRUCTION=PASS`: (1) an independent test-side
reconstruction from frozen artifact fields matches the production bytes; (2)
repeated executions match; (3) bytes are pinned per service in
`fixtures/internal-artifact-preimage/`; (4) a Python canonicalizer reproduces
identical bytes for all four; (5) changing extension, claim, or issued_at
changes the bytes. Unsigned; vNext signing is not activated.

## 15. output_hash / pcc_document_hash

`OUTPUT_HASH_DOCUMENT_HASH_SEPARATION=PASS`: distinct for every service; a
change outside the extension moves only `pcc_document_hash`; an extension change
moves both.

## 16. Public body non-regression

`CURRENT_PUBLIC_BODY_SHAPE_CHANGED=NO`, `REST_BODY_BEFORE_EQUALS_AFTER=YES`,
`MCP_CURRENT_BEHAVIOR_BEFORE_EQUALS_AFTER=YES`. Goldens for the whole success
result (incl. flat receipt) of all four v2 services were generated on the
**original** code at `327278c4`, then compared after the change (an independent
reviewer re-ran them against the original tree: pass). The existing
MCP/REST/wire audit suites pass unchanged. The existing MCP conformance defect
is untouched. Limit: goldens cover the success path (verify only
`outcome: pass`).

## 17. Public namespace

`PUBLIC_PCC_PROOF_NAMESPACE_EMITTED=NO` — a test walks all non-test runtime
source (service-runtime, edge-api, protocol-mcp, protocol-a2a) for
`net.siteborne.verification-proof.v1` and inspects every result surface.

## 18. Economics / replay / historical

`PRICING_CHANGED=NO`, `PAYMENT_BEHAVIOR_CHANGED=NO`,
`SETTLEMENT_BEHAVIOR_CHANGED=NO`, `ADMISSION_CHANGED=NO`,
`REPLAY_BINDING_FIELDS_CHANGED=NO`, `BINDING_DIGEST_CHANGED=NO`,
`REPLAY_SEMANTICS_CHANGED=NO`, `HISTORICAL_RESULT_MUTATION=NO` — no pricing,
quote, payment-attempt, settlement, reconciliation, replay/binding, migration or
protocol file is in the diff; the 17-test lifecycle audit passes.
`RESULT_AUTHORIZATION_MODEL=REQUEST_TUPLE_POSSESSION`; the P1 remains open by
design.

## 19. Privacy projection

`PRIVATE_SECURITY_IP_LEAKS=0`. The wire body is asserted equal to the closed
23-field `VerificationReceipt` allowlist; the artifact is scanned for
private-implementation key names (private/secret/credential/api
key/authorization
header/bearer/routing/ranking/margin/treasury/fencing/authority grant/policy
compiler/topology); preimage `limitations` are governed codes only, never raw
verifier prose; the signing key hex is not reachable from the artifact.
`INTERNAL_ARTIFACT_PUBLICLY_EXPOSED=NO`, `PUBLIC_CONTRACT_CHANGES=0` (the
artifact is dropped at the executor boundary; no MCP/A2A/OpenAPI/catalog file
changed).

## 20. Mutation evidence

Each defect was re-introduced against the finished code and the tests failed,
then the code was restored:

| Mutation                                                       | Tests failing |
| -------------------------------------------------------------- | ------------- |
| verify service assigns `outcome`/`score` after `verifyAndSign` | 2             |
| `persistLinkEvidence` reads `pcc.signing_key_id`               | 1             |
| governed `policy_hash` replaced by all-zero placeholder        | 47            |
| vocabulary checks disabled                                     | 2             |
| Unicode-scalar rejection disabled                              | 6             |

## 21. Test results

- `FOCUSED_TESTS` = 89/89 (internal artifact 77, wire characterization 4, edge
  typed link-evidence 8).
- `AFFECTED_TESTS` = 3149/3149 executed passed across service-runtime,
  verification, protocol-mcp, protocol-a2a, protocol-x402, pcc-schema, edge-api
  (73 credential-gated skips not counted).
- Typechecks (`tsc --noEmit`): service-runtime, edge-api, protocol-mcp,
  protocol-a2a, verification, protocol-x402 — clean. ESLint and Prettier clean
  on every changed file (`web-context/service.ts` was already unformatted at
  HEAD; left untouched apart from one line). Secret scan: no leaks.
- Load flakes: across repeated full/affected runs a varying set of time-based
  files (`load-v2`, `production-cdp-*`, `production-route-continuation-wiring`,
  the 10-page OCR subprocess test, `reconcile-payment-attempts.contract`) timed
  out under parallel load; every one passed when re-run in isolation. Not
  verified against the baseline commit under identical load.
  `SOURCE_QUALIFICATION=PASS_WITH_KNOWN_PREEXISTING_LOAD_FLAKE`.

## 22. Independent review

`INDEPENDENT_REVIEW=PASS_WITH_FINDINGS`,
`REVIEW_RECOMMENDS_WIRE_BODY_CHANGE=NO`. Items A–O passed except G. Findings and
disposition:

1. MEDIUM — mesh `verifier_timeout`/`verifier_exception` missing from the
   finding vocabulary (would turn a timed-out verifier into `internal_error`
   pre-settlement): **fixed**, drift test extended to `mesh.ts`, mesh-shaped
   test added.
2. LOW-MEDIUM — a Workflow whose `invoke-executor` step was cached before deploy
   has no typed inputs and fails `missing_link_evidence_inputs` (pre-settlement,
   buyer not charged): **open, operational** — drain in-flight Workflows before
   the deploy that ships this.
3. LOW — lone surrogate reports a generic `internal_error`; NaN/Infinity
   silently nulled: **NaN/Infinity fixed**; generic code accepted.
4. LOW-MEDIUM — reconstruction test only self-consistent: **fixed** with pinned
   goldens, Python cross-check, input-change tests.
5. LOW — `buyerReceiptHash` not checked against the released body at runtime:
   **fixed** in `validateExecutorPcc`.
6. LOW — stale comment reference: **fixed**.
7. INFO — `parseLinkEvidenceInputs` does not validate signature format;
   `receipt_signed` audit event is emitted even if a later throw discards the
   result; `finalized` attached to non-success results: **accepted**.

## 23. Cloud mutation accounting

`WORKER_UPLOADS=0 WORKER_DEPLOYMENT_MUTATIONS=0 PUBLIC_TRAFFIC_MUTATIONS=0 CONTINUATION_HOST_DEPLOYMENTS=0 ALERT_WORKER_DEPLOYMENTS=0 CLOUD_SECRET_MUTATIONS=0 PRODUCTION_D1_WRITES=0 REAL_PAYMENT_ATTEMPTS=0`.

## 24. Next checkpoint

`RESULT-PCC-WIRE-CUTOVER-01`: bound to (a) building/signing the vNext receipt
and delivering the full PCC with
`extensions["net.siteborne.verification-proof.v1"]`, (b) removing the legacy
receipt basis, (c) deciding where the full PCC lives across the durable step
boundary, (d) versioned replay handling for results cached before the cutover,
(e) the MCP conformance fix. Result-authorization enforcement remains a
separate, later checkpoint.

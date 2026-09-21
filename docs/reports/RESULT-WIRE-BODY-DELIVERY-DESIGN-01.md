# RESULT-WIRE-BODY-DELIVERY-DESIGN-01

Status: **PASS_WITH_FINDINGS**. Mode: local design and local reference tests
only. This checkpoint changes no production source, public schema, generated
contract artifact, migration, deployment, secret, traffic, payment, or
production data.

## 0. Result block

```text
RESULT_WIRE_BODY_DELIVERY_DESIGN_01=PASS_WITH_FINDINGS

STARTING_HEAD=8215369dc39c23a5b0efc42f28b1ce990ac1507a
FINAL_LOCAL_HEAD=the local closure commit containing this report (a commit cannot embed its own SHA; read it with git log -1)
WORKING_TREE=clean after the local closure commit is created

WIRE_ROOT_REPRESENTATION=FULL_PCC
OUTER_DELIVERY_ENVELOPE_REQUIRED=NO

CURRENT_PCC_SCHEMA_RELEASE=1.0.1
GOVERNED_PCC_SCHEMA_RELEASE=1.1.0
CURRENT_PCC_SCHEMA_HASH_MATCHES=contracts/releases/1.0.0/schemas/proof-carrying-context.schema.json and contracts/releases/1.0.1/schemas/proof-carrying-context.schema.json
PCC_SCHEMA_TRUTH_GAP=YES

OUTPUT_SCHEMA_HASH_AUTHORITY=contracts/releases/2.0.0/CONTRACT_RELEASE.yaml plus its four immutable schemas/services/*-output.schema.json artifacts
OUTPUT_SCHEMA_HASH_MATCH_MATRIX=company_evidence_graph.v2 PLACEHOLDER; web_context_verified.v2 PLACEHOLDER; document_evidence_json.v2 PLACEHOLDER; verify_agent_output.v2 PLACEHOLDER

FULL_PCC_SCHEMA_VALIDATION_MATRIX=company_evidence_graph.v2 PASS; web_context_verified.v2 PASS; document_evidence_json.v2 PASS; verify_agent_output.v2 PASS

PCC_DELIVERY_SELF_VERIFYING=YES (reference model and target design)
PCC_PROOF_REPRESENTATION=expanded governed verification proof object at extensions["net.siteborne.verification-proof.v1"], containing the complete vNext receipt preimage/signature and the exact public verifier-result material needed to recompute verifier_set_hash; the required PCC receipt remains a checked projection of that proof
SIGNED_PREIMAGE_RECONSTRUCTIBLE_FROM_DELIVERED_PCC=YES

CANONICAL_RECEIPT_SIGNING_MODEL=Ed25519 over RFC8785-JCS canonical bytes of one domain-separated vNext receipt preimage reconstructed from the delivered PCC, with recursive rejection of non-Unicode-scalar strings before canonicalization; receipt_id is rcpt_ plus the first 24 hex characters of SHA-256(JCS(preimage)); signature is unpadded base64url
LEGACY_SIGNING_MODEL_STATUS=retain_for_legacy; deprecate for new-format issuance

POST_SIGN_RESULT_MUTATION_ALLOWED=NO
OUTPUT_HASH_CANONICAL_PREIMAGE=RFC8785-JCS of the single final service extension value (the service-specific value under extensions, excluding the proof namespace)
OUTPUT_HASH_RECOMPUTABLE_FROM_DELIVERED_PCC=YES
PCC_DOCUMENT_INTEGRITY_MODEL=distinct pcc_document_hash over the deterministic PCC projection containing every semantic PCC field except top-level receipt and extensions["net.siteborne.verification-proof.v1"]; the one receipt signature binds both output_hash and pcc_document_hash

INTERNAL_RESULT_MODEL=typed immutable artifact {serviceOutput, finalExtension, pccDocument, verificationReceipt, verifierResults, linkEvidenceInputs, wireBody}; wireBody is a representation, not an operational-data parser input
PERSIST_LINK_EVIDENCE_DEPENDS_ON_WIRE_SHAPE=NO
INITIAL_RESULT_REPRESENTATION_EQUALS_CACHED=YES for SELF_VERIFYING_PCC_VNEXT (design invariant proven in the reference model by serialize/reparse identity plus re-verification; NOT yet a production storage invariant)

CONTRACT_RELEASE_AUTHORITY=contracts/releases/2.0.0/CONTRACT_RELEASE.yaml release.version and service contract_version
POLICY_HASH_AUTHORITY=SHA-256 of RFC8785-JCS canonical parsed governance/VERIFICATION_POLICY.yaml via packages/verification/src/policy.ts
PCC_SCHEMA_HASH_AUTHORITY=contracts/releases/2.0.0/CONTRACT_RELEASE.yaml pcc_dependency plus the exact immutable PCC schema bytes
OUTPUT_SCHEMA_HASH_AUTHORITY=contracts/releases/2.0.0/CONTRACT_RELEASE.yaml service rows plus exact immutable service output schema bytes
ZERO_POLICY_HASH_ALLOWED_IN_RELEASED_PROOF=NO

PUBLIC_SCHEMA_CHANGE_REQUIRED=YES
RECOMMENDED_VERSIONING_CLASS=combined breaking governance release: PCC schema/signing rules major plus Service Contract major/parallel service-major surface; current Release-2 schemas are structurally permissive but are not semantic authority for the new proof
GOVERNANCE_APPROVAL_REQUIRED=YES

ONE_RESULT_DELIVERY_MODEL_FOR_ALL_EXECUTORS=YES
MCP_POST_SETTLEMENT_SCHEMA_VALIDATION_TARGET=PASS (actual MCP SDK, all four proposed PCCs)
WIRE_FIX_RESULT_AUTHORIZATION_DEPENDENCY=SERVICE_SPECIFIC_GATING: public-classified company/web results may proceed independently after the wire/proof release gate; buyer_authorized document/verify results require result-authorization enforcement before cached full-output rollout
HISTORICAL_RESULT_COMPATIBILITY_MODEL=LEGACY_RECEIPT_ONLY remains the truthful flat receipt it is; SELF_VERIFYING_PCC_VNEXT persists/releases an exact full PCC; no historical synthesis or rewrite
SCHEMA_VALIDATION_VS_SETTLEMENT_ORDER=execute -> finalize/freeze -> hash -> sign/embed -> governed schema validation -> cryptographic self-verification -> persistence-readiness checks -> settle -> persist settlement-dependent evidence plus the already-validated exact PCC -> release

PCC_USED_AS_RESULT_AUTHORITY=NO
REFERENCE_MODEL_VALIDATED=YES
PRODUCTION_ENFORCEMENT_IMPLEMENTED=NO
PROOF_VERSION_CROSS_CHECK=PASS
SEMANTIC_SNAPSHOT_FROZEN_BEFORE_PROOF=YES
INVALID_UNICODE_SCALAR_REJECTED=YES (reference model only; no production canonicalizer modified; vNext prerequisite)
PRIVATE_SECURITY_IP_LEAKS=0
PRODUCTION_RUNTIME_FILES_CHANGED=0
SOURCE_BEHAVIOR_CHANGES=0
PUBLIC_CONTRACT_CHANGES=0
AFFECTED_SUITE_FINAL=370/370 (13 files)
TYPECHECKS=PASS
ESLINT=PASS
PRETTIER=PASS
SECRET_SCAN=PASS
LOCAL_REFERENCE_TESTS=107/107 total checkpoint-file tests (98 before the follow-up review test-strength additions)
INDEPENDENT_REVIEW=PASS_WITH_FINDINGS
REVIEW_RECOMMENDS_RUNTIME_CHANGE=YES

WORKER_UPLOADS=0
WORKER_DEPLOYMENT_MUTATIONS=0
PUBLIC_TRAFFIC_MUTATIONS=0
CONTINUATION_HOST_DEPLOYMENTS=0
ALERT_WORKER_DEPLOYMENTS=0
CLOUD_SECRET_MUTATIONS=0
PRODUCTION_D1_WRITES=0
REAL_PAYMENT_ATTEMPTS=0

REPORT_PATH=docs/reports/RESULT-WIRE-BODY-DELIVERY-DESIGN-01.md
NEXT_RECOMMENDED_CHECKPOINT=RESULT-FINALIZATION-INTERNAL-ARTIFACT-01
```

## 1. Provenance and scope

Preflight on 2026-09-21, before any edit:

```text
git rev-parse HEAD
8215369dc39c23a5b0efc42f28b1ce990ac1507a

git status --short
<empty>

git diff --stat
<empty>

git diff
<empty>
```

There was no partial Claude working tree to classify. This checkpoint continues
the source-backed conclusions in
`RESULT-WIRE-BODY-CONFORMANCE-READONLY-AUDIT-01`; it did not repeat broad source
archaeology. Source reading was limited to the two open hash facts, the exact
in-memory-document observation seam, authority files, canonicalization/signing
code, persistence coupling, and versioning policy.

Changed paths are restricted to tests, a test helper, and this report. The
test-only observation hook delegates to the real `verifyAndSign`, captures its
returned object, and changes no behavior. No code beneath a production `src/`
directory is changed.

## 2. Governance decision

The successful result root is the full PCC. There is no new outer
`{ output, receipt, pcc }` envelope.

The local model uses the existing controlled `extensions` container for
`net.siteborne.verification-proof.v1`. It retains the required top-level PCC
`receipt` block as an exact, verifier-checked projection of the complete proof
receipt. The service-specific output remains the other service namespace under
`extensions`.

This shape is structurally accepted today because the PCC extension container
permits bounded reverse-domain extension objects. Structural permission is not
semantic governance. The current public schemas neither require the proof
namespace nor specify its signed preimage, document hash, projection equality,
or verification algorithm. A public release is therefore required before this
model can be production authority.

## 3. PCC schema hash fact

Production executors call `buildServiceContext` without PCC authority overrides.
Its defaults stamp:

```text
pcc_schema_release=1.0.1
pcc_schema_hash=sha256:f664208e387b161ab7897d8544d9c7d987501eba5764e2dde0ea69586e33dbb5
```

Byte hashing established:

| Artifact                                                              | SHA-256                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `contracts/releases/1.0.0/schemas/proof-carrying-context.schema.json` | `f664208e387b161ab7897d8544d9c7d987501eba5764e2dde0ea69586e33dbb5` |
| `contracts/releases/1.0.1/schemas/proof-carrying-context.schema.json` | `f664208e387b161ab7897d8544d9c7d987501eba5764e2dde0ea69586e33dbb5` |
| `contracts/releases/2.0.0/schemas/proof-carrying-context.schema.json` | `d32a8e25eba7a7ae4d7d7f7a14c565c1b92c8d8e10810ff885698ed102fdbcc0` |
| `schemas/proof-carrying-context.schema.json`                          | `d32a8e25eba7a7ae4d7d7f7a14c565c1b92c8d8e10810ff885698ed102fdbcc0` |
| published network-site copy                                           | `d32a8e25eba7a7ae4d7d7f7a14c565c1b92c8d8e10810ff885698ed102fdbcc0` |

`contracts/releases/2.0.0/CONTRACT_RELEASE.yaml` governs the four `.v2` services
and declares PCC schema release `1.1.0` with hash `d32a…`. The current stamp is
not an invented value and is not “no repository artifact”: it exactly matches
the old PCC 1.0.1 artifact. It is nevertheless untruthful for the Release-2
service context.

```text
CURRENT_PCC_SCHEMA_RELEASE=1.0.1
GOVERNED_PCC_SCHEMA_RELEASE=1.1.0
CURRENT_PCC_SCHEMA_HASH_MATCHES=contracts/releases/1.0.0 and 1.0.1 PCC artifacts
PCC_SCHEMA_TRUTH_GAP=YES
```

## 4. Output schema hash fact

The repository’s authority is not an invented canonicalizer. The contract
release records exact SHA-256 values for the immutable schema file bytes, and
`schemas/MANIFEST.json` records the same values. Reference tests re-hash those
exact bytes.

| Service                     | Generated PCC currently stamps | Governed Release-2 output artifact hash                                   | Result      |
| --------------------------- | ------------------------------ | ------------------------------------------------------------------------- | ----------- |
| `company_evidence_graph.v2` | `sha256:` + 64 `9` characters  | `sha256:5593736dfc60089aa3f01de664eb67ccba3a58e03449a66e91f477324e24861b` | PLACEHOLDER |
| `web_context_verified.v2`   | `sha256:` + 64 `4` characters  | `sha256:7d4882e997ec3a3bd97b746de36ed99dfe430d59b4d1c8adc7d9fa83a274b4e0` | PLACEHOLDER |
| `document_evidence_json.v2` | `sha256:` + 64 `7` characters  | `sha256:df91ed115ae0e29d8f4c211d95462ddd96e9714bc5f5e0ce0b820b370e0d5dde` | PLACEHOLDER |
| `verify_agent_output.v2`    | `sha256:` + 64 `2` characters  | `sha256:a9a462b89b290ecba1aa62ec6d2fd030572f326ed79f498a43690244b38ad679` | PLACEHOLDER |

The production composition configs separately advertise hashes. Company,
document, and verify match their Release-2 artifacts there. Web composition
still advertises the v1 hash `138b…`, while the governed v2 schema is `7d488…`.
That composition discrepancy is additional evidence, but it does not change the
matrix above: the generated in-memory PCC obtains its value from service code
and all four values are unmistakable repeated-digit placeholders.

## 5. Real four-executor in-memory PCC validation

The test-only observer wrapped the real shared `verifyAndSign` with
`importOriginal`, retained the returned `signed.document`, and otherwise
delegated unchanged. The existing fixtures then drove the four real production
executors through the real Workflow path.

| Service                     | Governed validator                         | Result | Errors |
| --------------------------- | ------------------------------------------ | ------ | ------ |
| `company_evidence_graph.v2` | Release-2 company output schema            | PASS   | none   |
| `web_context_verified.v2`   | Release-2 web output schema                | PASS   | none   |
| `document_evidence_json.v2` | Release-2 document output schema           | PASS   | none   |
| `verify_agent_output.v2`    | Release-2 agent-verification output schema | PASS   | none   |

The proposed proof extension is also structurally accepted by all four current
Release-2 validators. Therefore the representation can remain PCC-native and
does not require an outer envelope. This result does not waive the semantic
version/governance change described below.

## 6. PCC-native proof representation

The chosen design is option B: an expanded governed verification proof object.

```text
PCC root
├── ordinary semantic PCC fields
├── extensions[service namespace] = final service output
├── extensions["net.siteborne.verification-proof.v1"]
│   ├── proof_version
│   ├── receipt = complete vNext signed receipt
│   └── verification_material.verifier_results
│       = verifier_id/status/failure_codes plus public finding code/severity,
│         the exact material required by the governed verifier-set hash
└── receipt = exact eight-field projection of proof.receipt required by PCC
```

The buyer verifies projection equality; a top-level receipt mutation cannot be
accepted independently from the proof. The public verifier material omits
finding message/subject text and internal fields such as verifier input hashes,
audit references, timings, and private key material. Receipt `limitations` is a
sorted list of governed failure codes, not copied free-form verifier prose.

This carries every input needed to recompute the verifier-set hash. PCC evidence
items carry the inputs needed to recompute the evidence-set hash. The service
output and all semantic document fields are delivered and hashable. No hidden
draft state is required.

## 7. One canonical signing model

Release-next has one authoritative signing model:

- Algorithm: Ed25519 (RFC 8032).
- Key identifier: `signing_key_id`, selecting the published Ed25519 public key.
- Domain separation: literal `SITEBORNE-PCC-VERIFICATION-PROOF-V1` in the signed
  preimage.
- Canonical serialization: RFC 8785/JCS UTF-8 bytes using the repository’s
  existing canonicalization implementation, after recursively rejecting any
  unpaired UTF-16 surrogate so the accepted domain is Unicode scalar values in
  both the TypeScript and Python verifier runtimes.
- Signature encoding: unpadded base64url of the 64-byte Ed25519 signature.
- Receipt identity: `rcpt_` plus the first 24 hexadecimal characters of
  `SHA-256(JCS(preimage))`.
- Verification: reconstruct the preimage from
  `extensions["net.siteborne.verification-proof.v1"].receipt` by removing only
  `receipt_id` and `signature`; recompute identity and all governed hashes;
  require top-level projection equality; then verify Ed25519 with the published
  key.

The exact signed fields are:

```text
domain, proof_version, receipt_version,
job_id, request_id, service_id, service_version, contract_release,
pcc_schema_release, pcc_schema_hash,
input_hash, output_schema_hash,
output_hash, pcc_document_hash, evidence_hash, policy_hash, verifier_set_hash,
decision, completeness, verification_mode, limitations,
signing_key_id, canonicalization_algorithm, signature_algorithm, issued_at
```

The production receipt’s present 21-field JCS-preimage model is retained only
for `LEGACY_RECEIPT_ONLY` verification. The frozen/spec-side
`canonical({output_hash, policy_hash})` description is not mixed into vNext.
Both become deprecated for new issuance once the governed vNext model is
approved.

## 8. Freeze-before-proof order

The authoritative ordering is:

```text
execute
-> construct final service output
-> construct final service extension
-> finalize outcome/score/verdict and every other semantic field
-> deep-freeze semantic result
-> derive output_hash, evidence_hash, verifier_set_hash, pcc_document_hash
-> construct complete receipt preimage
-> derive receipt_id
-> sign
-> embed proof and exact receipt projection
-> finalize/deep-freeze PCC
-> governed schema validation
-> cryptographic self-verification
-> construct typed persistence inputs
-> persistence-readiness checks
-> settle
-> persist/release the exact frozen PCC
```

`verify_agent_output` must compute `outcome` and `score` before the freeze. The
reference test mutates both after proof creation and requires verification to
fail with both output-hash and document-hash mismatches.

```text
POST_SIGN_RESULT_MUTATION_ALLOWED=NO
```

## 9. Output hash semantics

The alternatives were evaluated as follows:

| Candidate                                | Decision                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| A. canonical final service output        | selected                                                                                      |
| B. canonical extension/result payload    | equivalent to A in this architecture: the final service extension value is the service output |
| C. PCC projection excluding proof fields | rejected for `output_hash`; it conflates service output with document integrity               |
| D. deterministic pre-proof projection    | used separately for `pcc_document_hash`, not overloaded into `output_hash`                    |

Exact preimage:

```text
output_hash = SHA-256(
  RFC8785-JCS(
    deliveredPcc.extensions[the one service namespace other than
      "net.siteborne.verification-proof.v1"]
  )
)
```

This is non-circular, service-independent, derived from the frozen final result,
and recomputable from delivered governed material.

## 10. Document-level integrity

`output_hash` does not carry two meanings. Whole-document integrity uses:

```text
pcc_document_hash = SHA-256(RFC8785-JCS(documentProjection))
```

`documentProjection` is the delivered PCC with only these removed:

1. the top-level `receipt` block; and
2. `extensions["net.siteborne.verification-proof.v1"]`.

Every other field and extension remains. The receipt preimage binds both
`output_hash` and `pcc_document_hash`, so one signature proves service-output
integrity and document integrity without recursion. Changing receipt/proof bytes
does not alter either hash preimage; changing any semantic PCC field alters the
document hash.

## 11. Contract, policy, and schema truth

| Field                | Authority                                                                                 | Current value source                           | Current truthful? | Target derivation                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `contract_release`   | `contracts/releases/2.0.0/CONTRACT_RELEASE.yaml`                                          | `buildServiceContext` default `1.0.0`          | NO for `.v2`      | generated immutable service authority passed into execution context                                                      |
| `policy_hash`        | parsed and schema-validated `governance/VERIFICATION_POLICY.yaml`, hashed by `hashPolicy` | `buildServiceContext` all-zero default         | NO                | compute/inject `sha256:def2b52c0b6c5598cb7e95d4d79b3dfe472bb9375edf2330fe8e2ca710de1401` from the active governed policy |
| `pcc_schema_release` | Release-2 `pcc_dependency.schema_release`                                                 | default `1.0.1`                                | NO                | generated release authority, currently `1.1.0`                                                                           |
| `pcc_schema_hash`    | Release-2 `pcc_dependency.schema_sha256` and exact artifact bytes                         | default old-artifact `f664…`                   | NO                | hash/check exact governed artifact, currently `d32a…`                                                                    |
| `output_schema_hash` | Release-2 service row and exact output schema bytes                                       | hard-coded repeated-digit service placeholders | NO                | generated service contract authority, checked against exact artifact bytes                                               |

An all-zero policy hash is a test placeholder, not a truthful released proof. It
is forbidden in vNext successful results.

## 12. Internal typed result architecture

The internal artifact is not the wire object:

```ts
interface FinalizedExecutionArtifact {
  serviceOutput: Readonly<ServiceOutput>;
  finalExtension: Readonly<ServiceExtension>;
  pccDocument: Readonly<PccDocument>;
  verificationReceipt: Readonly<VNextReceipt>;
  verifierResults: ReadonlyArray<PublicVerifierResult>;
  linkEvidenceInputs: Readonly<{
    receiptId: string;
    signingKeyId: string;
    signature: string;
    receiptHash: string;
  }>;
  wireBody: Readonly<PccDocument>;
}
```

`persistLinkEvidence` receives `linkEvidenceInputs` and the typed receipt/PCC
reference directly. It does not inspect top-level wire keys to rediscover
`signing_key_id` or `signature`. Public representation changes therefore cannot
silently break post-settlement operational persistence.

The PCC is not the result authority. The immutable internal artifact is runtime
state; the full PCC is its governed public representation.

## 13. Initial, cached, and historical identity

For a new-format success, the exact frozen `wireBody` object is serialized and
persisted. Initial release and cached replay parse to the same semantic PCC.
There is no reconstruction from a receipt, a projection, or Workflow transient
state.

Historical rows split explicitly:

- `LEGACY_RECEIPT_ONLY`: return the flat receipt that actually exists under a
  legacy compatibility rule/endpoint; label it as legacy; do not claim it is a
  PCC and do not invent missing output.
- `SELF_VERIFYING_PCC_VNEXT`: return the exact persisted, self-verifying PCC.

No historical write or rewrite is part of this design.

## 14. Schema and versioning decision

Two statements are simultaneously true:

1. the current controlled extension container structurally accepts the proposed
   proof namespace, and all four proposed PCCs pass the current Release-2
   validators; and
2. the new proof cannot be shipped as an undocumented optional blob because it
   changes the signature binding, hash semantics, buyer verification rules, and
   required successful-result guarantees.

Repository policy classifies `signature_binding_changed`,
`pcc_dependency_changed`, semantic validator changes, and required-list changes
as major with human review and a parallel service major. The conservative,
policy-conforming recommendation is therefore:

- new PCC signing/schema major governing the proof object and verification
  algorithm; and
- new Service Contract major with a parallel service-major surface whose output
  schemas require the proof namespace.

Exact numeric versions and public service IDs are a governance decision, not
something this local design checkpoint mutates. If governance creates the next
sequential majors, that would be PCC 2.x and Service Contract 3.x / `.v3`.

## 15. One model for four executors

All proof construction, hashing, freezing, persistence typing, replay, and
verification logic is shared. Only the service extension namespace/value and its
governed output-schema hash differ. There is no service-specific proof
architecture.

## 16. MCP post-settlement defect

The actual MCP SDK was exercised with:

- each real production executor fixture;
- the actual service/PCC-generation path;
- the production MCP adapter shape; and
- the proposed successful PCC as `structuredContent`.

All four proposed PCCs were accepted (`isError !== true`) and returned unchanged
as structured content. This is the target that must run before settlement in a
production implementation; the old “settle, then SDK rejects a flat receipt”
sequence is not acceptable.

## 17. Schema validation versus settlement

The existing Workflow already orders `generate-pcc` before `settle`, so the fix
does not require pretending settlement is reversible. The pre-settlement gate
must construct the exact eventual success body, run the governed service schema
validator, independently verify the embedded cryptography, confirm the typed
persistence inputs are complete, and confirm deterministic serialization.

Settlement-dependent actions necessarily remain after settlement:

- recording the transaction reference and settlement evidence;
- building/persisting the payment-service link fields that include settlement
  evidence; and
- transitioning/finalizing lifecycle state.

Those actions must consume the already-finalized typed artifact. They must not
mutate or reconstruct the successful PCC.

## 18. Result-authorization P1 dependency

The carried finding remains:

```text
RESULT_AUTHORIZATION_MODEL=REQUEST_TUPLE_POSSESSION
CURRENT_AUTHENTICATED_CALLER_IDENTITY=absent
```

The normative service metadata classifies:

| Service                     | Result authorization classification | Rollout dependency                                     |
| --------------------------- | ----------------------------------- | ------------------------------------------------------ |
| `company_evidence_graph.v2` | `public`                            | wire/proof gate independent of SA-1 enforcement        |
| `web_context_verified.v2`   | `public`                            | wire/proof gate independent of SA-1 enforcement        |
| `document_evidence_json.v2` | `buyer_authorized`                  | enforcement required before cached full-output release |
| `verify_agent_output.v2`    | `buyer_authorized`                  | enforcement required before cached full-output release |

Therefore the overall dependency is `SERVICE_SPECIFIC_GATING`. SA-1 shadow
deployment is useful evidence but is not enforcement and is not made a blocker
for this design checkpoint. Eventual rollout prerequisite: buyer-authorized
services must have an authenticated caller identity and an authorization check
that binds replay access to the original authorized principal (or an explicitly
approved equivalent capability model), with denial/replay tests. Public services
may progress independently after their wire/proof release gates.

## 19. Local reference evidence

The reference model and tests cover the requested cases:

1. service output freezes before proof;
2. extension semantics freeze before proof;
3. post-proof verify outcome/score mutation fails;
4. complete preimage reconstructs from delivered PCC;
5. signature validates with delivered PCC plus public key;
6. output hash recomputes;
7. modified output fails;
8. modified service ID fails;
9. modified decision fails;
10. modified receipt ID fails;
11. modified outcome/score fails;
12. all four shapes use one representation;
13. all proposed PCCs validate under the intended current structural schema;
14. real MCP SDK accepts all four;
15. typed link evidence is independent of wire parsing;
16. legacy receipt-only record is not upgraded;
17. initial and cached PCC are semantically equal;
18. receipt/document hashes are non-circular;
19. contract release derives from authority;
20. policy hash derives from authority;
21. PCC schema hash derives from the governed artifact;
22. output schema hash derives from each governed service artifact;
23. repeated proof construction is deterministic; and
24. private/internal verifier fields and key material do not enter the public
    proof.

The same file retains the earlier real-body characterization. Prior fresh run
(before follow-up additions; final is 107/107): 98/98 passing tests. The design
additions account for 58/58 cases, including parameterized service cases.

Affected wider evidence:

```text
AFFECTED_SUITE_FINAL=370/370 (13 files; final rerun after the reviewer-driven
  proof-version, freeze-order, privacy and Unicode-scalar changes, from repo root:
  this checkpoint file; paid-continuation-workflow-pcc-wire-result;
  mcp-four-service-acceptance; mcp-route; document-evidence-json-v2 and
  verify-agent-output-v2 production-executor tests; packages/pcc-schema/src (3);
  packages/service-runtime/src/pcc (2); protocol-mcp frozen-contracts and
  transport). The earlier 243/243 figure used a differently composed 13-file
  selection and is superseded, not comparable.
LOCAL_REFERENCE_TESTS=107/107 (final rerun)
TYPECHECKS=PASS (@siteborne/pcc-schema, @siteborne/service-runtime,
  @siteborne/protocol-mcp, @siteborne/edge-api including live-test config)
ESLINT=PASS (both touched TypeScript files)
PRETTIER=PASS (both touched TypeScript files and this report)
SECRET_SCAN=PASS (929 commits, no leaks; 1718 tracked/non-ignored working-tree files, no leaks)
FULL_REPO_SUITE=NOT_RUN (affected suites and package gates were green; no unrelated flake repair attempted)
```

## 20. Implementation and migration phases

1. `RESULT-FINALIZATION-INTERNAL-ARTIFACT-01`: introduce the internal immutable
   artifact, move agent outcome/score before proof, retain full verifier results
   and full PCC internally, and make persistence consume typed proof inputs.
   Keep the public wire body unchanged in this first checkpoint.
2. Govern and publish the vNext PCC proof/signature/hash schema and verification
   rules, including test vectors and key publication rules.
3. Govern and publish the parallel service contract major whose output schemas
   require the proof.
4. Add pre-settlement exact-body schema/cryptographic/persistence-readiness
   gates, still without public traffic mutation.
5. Add storage format classification and exact initial/cached PCC equivalence;
   retain legacy rows without rewriting.
6. Satisfy the service-specific result-authorization prerequisites.
7. Qualify and separately authorize any deployment/canary/cutover.

## 21. Independent review

Verdict: `PASS_WITH_FINDINGS`. The read-only reviewer checked the governed root,
proof reconstructibility, signing coherence, hash circularity, schema/hash
truth, freeze order, typed persistence, MCP validation, settlement ordering,
history, result authorization, versioning, and the zero-runtime-change boundary.

The review found and the reference model resolved two design defects before
closure: the outer proof version is now explicitly checked against the signed
receipt version, and the freeze observer proves that the semantic PCC is frozen
before hashes and signature creation. It also identified a cross-runtime RFC
8785 boundary: the TypeScript canonicalizer accepts lone UTF-16 surrogates while
the repository Python implementation rejects them. The vNext model therefore
requires recursive Unicode-scalar validation before hashing/signing, with a
reference regression.

A targeted follow-up review of the final delta passed all 13 verification points
(`PASS_WITH_FINDINGS`). Its test-strength findings were addressed in test files
only: low-surrogate, nested, key-position and valid-pair Unicode cases, a
verify-path lone-surrogate rejection (fails closed with `non_unicode_scalar`),
an explicit `output_hash != pcc_document_hash` assertion, and a cached-replay
test that reparses the serialized PCC and re-verifies it. Residual low-severity
notes, not changed here: `findings.code`/`failure_codes` have no allowlist in
the reference model, the privacy assertion greps only the literal `privateKey`,
the preimage-reconstruction test checks key absence rather than a byte-level
recompute, and the typed-persistence test does not call the production
`persistLinkEvidence` (production still parses the flat receipt).

Remaining findings are intentionally implementation work, not design-test
failures: current production `validateExecutorPcc` does not yet implement exact
governed schema validation; current persistence still parses the flat wire
receipt; initial/cached PCC identity is a reference target rather than a runtime
invariant; and the proposed pre-settlement validation/readiness sequence is not
yet production-enforced. The reviewer recommends those runtime changes in the
bounded implementation phases below. None is implemented here.

## 22. Recommended next checkpoint

```text
NEXT_RECOMMENDED_CHECKPOINT=RESULT-FINALIZATION-INTERNAL-ARTIFACT-01
```

It is dependency-first and can be bounded to internal behavior: freeze semantic
results before proof creation, retain the full internal PCC/verifier material,
and decouple persistence from wire parsing while deliberately leaving the public
wire body unchanged. The public proof model should not be wired until this
internal invariant exists.

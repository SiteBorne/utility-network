# RESULT-PCC-WIRE-CUTOVER-01

Status: **PASS WITH FINDINGS — local candidate qualified; no deployment or
payment authorized**

Date: 2026-09-21 through 2026-09-22

Starting commit: `4a0bb007c160bbf8da7fffc6db679b232b84f1f7`

Branch: `metadata-vcm-qualification`

## 1. Scope and provenance

This checkpoint continued from the exact clean starting commit named above. It
created a parallel PCC 2.0.0 / Service Contract 3.0.0 candidate, implemented the
vNext result wire and durable replay path, and qualified that work locally. It
did not deploy, upload a Worker, change traffic, mutate cloud secrets, write
production D1, perform a real payment, push, or touch the pre-existing stash.

The carried version decision was not reopened:

- PCC schema release: `2.0.0`
- Service contract release: `3.0.0`
- Service identities: `company_evidence_graph.v3`, `web_context_verified.v3`,
  `document_evidence_json.v3`, and `verify_agent_output.v3`
- Basis: `COMPATIBILITY_POLICY.md` plus the prior `.v2` major-release precedent.
  The signature, proof, output/document hash, and service-contract semantics
  change together and therefore require a major release.

Local implementation commits created during the checkpoint before final report
closure:

- `4546a0fb9e45fd8404e7fc9ce8ab969583321d2c` — candidate release artifacts
- `6c2fd37776ea278821ba40599441c1823d4ca53b` — production vNext proof and
  full-PCC issuance
- `a94c28cf8d874d8a46ba5b6dc59b085edf602d57` — durable vNext result persistence

## 2. Candidate release artifacts

`contracts/releases/3.0.0/` follows the repository release layout and contains
the release declaration, compatibility report, manifest, complete checksum
inventory, common and service schemas, generated OpenAPI, service metadata, and
deterministic full-PCC examples. `SHA256SUMS` covers every release file except
itself, and the release test recomputes every entry from the committed bytes.

The governed candidate PCC artifact is
`contracts/releases/3.0.0/schemas/proof-carrying-context.schema.json`. Its final
SHA-256 is:

`9a93214ebd851f2f7dfa86cd9cec4b81d83d5e78aa857f380fd579ada27c00a5`

The four service output schemas are versioned copies because the governed
identity, contract release, PCC version, and output root semantics are `.v3`
facts even where the semantic service extension is shared with `.v2`. Final
hashes are:

| Service identity            | Output schema artifact                                   | SHA-256                                                            |
| --------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------ |
| `company_evidence_graph.v3` | `schemas/services/company-evidence-output.schema.json`   | `3567477e8ac4e76a57c6baec7cc6e2fa1aa502fca3087ed3753d2e99de036ae1` |
| `web_context_verified.v3`   | `schemas/services/web-context-output.schema.json`        | `34e9ca4c55b071cfaa2f182ecac5d2513a8ec6a4f3c0a6d0cf0b7027eeab1319` |
| `document_evidence_json.v3` | `schemas/services/document-evidence-output.schema.json`  | `058e6d50796d7adffc5deedd5b96679dcff78d98b77c022c06430885546aeff7` |
| `verify_agent_output.v3`    | `schemas/services/agent-verification-output.schema.json` | `7a164cc8bbd34c95608fcc6e420a36d29844ddfbc6c029439e9f4262cedf8a73` |

The candidate OpenAPI generator accepts explicit schema directory, output
directory, service-major, and contract-version inputs. A default invocation was
generated into a temporary directory and compared as parsed JSON against the
committed active v2 output; all three generated documents were semantically
identical. The candidate invocation is isolated and emits only `.v3` identities.
No historical release directory changed relative to the starting commit.

## 3. Validators and truth metadata

The schema registry and verifier recognize all four `.v3` schemas while
preserving the existing v1/v2 lookup and validation paths. Candidate registry
descriptors and VCM imports resolve the exact release files and hashes. Runtime
truth metadata derives these values from the candidate authority:

- `contract_release=3.0.0`
- `pcc_schema_release=2.0.0`
- the final PCC schema SHA-256 above
- the service-specific output schema SHA-256 above
- the governed non-placeholder policy hash

No placeholder hash remains in the candidate release, descriptors, runtime
metadata, or generated examples. The release test explicitly rejects placeholder
patterns.

## 4. Full-PCC proof model

The wire root is the full PCC. There is no outer delivery envelope.

The shared proof core is `packages/service-runtime/src/pcc/vnext-proof.ts`, used
by the common finalization/signing path rather than reimplemented per executor.
It implements:

- RFC 8785 JCS canonicalization through the repository canonicalizer
- Unicode scalar validation before hashing/signing
- canonical final service-extension `output_hash`
- canonical semantic PCC projection `pcc_document_hash`, excluding the top-level
  receipt projection and `extensions["net.siteborne.verification-proof.v1"]`
- the domain-separated receipt preimage
- `receipt_id = "rcpt_" + first 24 hex characters of SHA-256(JCS(preimage))`
- Ed25519 signing and verification
- proof-version, receipt/proof consistency, governed finding-code, and
  failure-code validation

The stable signing domain is:

`SITEBORNE-PCC-VERIFICATION-PROOF-V1`

The proof namespace is:

`extensions["net.siteborne.verification-proof.v1"]`

Issuance is:

`InternalResultArtifact -> frozen final extension -> output_hash -> semantic PCC projection -> pcc_document_hash -> receipt preimage -> receipt_id -> Ed25519 signature -> proof namespace + receipt projection -> schema validation -> cryptographic self-verification`

Every signed input needed to reconstruct the preimage is present in the
delivered PCC. The verifier recomputes `output_hash`, `pcc_document_hash`,
`receipt_id`, and the signature preimage from that body. The verify service’s
`outcome` and `score` are inside the hashed final extension; both pass and
governed non-pass vectors are signed, and tampering either value fails
verification. Legacy `.v2` receipt verification is unchanged.

## 5. Deterministic vectors and privacy projection

The candidate release contains deterministic, schema-valid, cryptographically
self-verifying examples for company, web, document, verify-pass, and
verify-non-pass. The pinned internal preimage fixtures cover the same matrix.
The existing repository Python canonicalizer independently reconstructs the
byte-exact JCS preimages in the internal-artifact test matrix; TypeScript/Python
bytes, hashes, and derived receipt IDs match.

Tamper tests cover output, extension, service identity, receipt ID, signature,
proof version, verify outcome, verify score, unknown finding/failure codes, and
invalid Unicode scalar values.

The strengthened internal/public artifact projection assertions found zero
private-security-IP fields in the candidate full PCC. Routing/scoring equations,
provider ranking, credentials, secrets, policy compiler internals, authority
encoding, fencing/state internals, private evidence-graph schema, secret
topology, and margin/treasury logic remain outside the wire body.

## 6. Durable storage and size qualification

### Model

The exact canonical full PCC is content-addressed in the existing
result-artifact R2 storage under the `results/pcc/` prefix. Workflow and D1
state contain only a bounded reference:

- storage kind: `R2_CONTENT_ADDRESS`
- canonical PCC SHA-256
- byte length
- media type `application/pcc+json`

Before returning from the executor Workflow step, the store canonicalizes the
full PCC, enforces the candidate service-runtime result budget, writes the exact
bytes to R2, verifies metadata readiness, and replaces the large result/output
with the bounded reference. Reads verify metadata, length, content hash, UTF-8
decoding, JSON object shape, and canonical reserialization before release.
Initial result release and cached replay resolve the same content-addressed
object; neither reconstructs a PCC from the flat receipt.

### Measured sizes and ceiling

Canonical compact fixture measurements are:

| Candidate vector | Full PCC bytes | Proof plus receipt projection overhead |
| ---------------- | -------------: | -------------------------------------: |
| company          |          5,912 |                                  2,785 |
| web              |          6,423 |                                  2,783 |
| document         |          6,447 |                                  2,785 |
| verify pass      |          5,928 |                                  2,782 |
| verify non-pass  |          6,038 |                                  2,782 |

The candidate accepts at most `5,000,000` canonical bytes per full PCC, matching
`DEFAULT_SERVICE_BUDGET.maxResultBytes`. This limit is enforced during staging
before settlement eligibility. It applies uniformly to company, web, document,
and verify results; schema-level input/content bounds do not bypass the runtime
result budget.

The storage choice is qualified against current official platform documentation:

- Cloudflare Workflows limits ordinary non-stream step results to 1 MiB, so the
  Workflow persists only the small R2 reference:
  <https://developers.cloudflare.com/workflows/reference/limits/>
- Cloudflare D1 limits a string, BLOB, or row to 2,000,000 bytes, so the full
  candidate PCC is not stored inline in D1:
  <https://developers.cloudflare.com/d1/platform/limits/>
- Cloudflare R2’s object limits are far above the 5,000,000-byte candidate cap
  and are appropriate for the exact durable bytes:
  <https://developers.cloudflare.com/r2/platform/limits/>
- Workers provide a 128 MB memory ceiling; the explicit 5 MB candidate cap
  leaves bounded headroom for the parsed object, canonical string, byte buffer,
  verifier, and response processing:
  <https://developers.cloudflare.com/workers/platform/limits/>

MCP receives the resolved structured object, not a Workflow state value or D1
BLOB. The 5 MB cap is therefore the governing candidate payload maximum. This
checkpoint does not claim that every MCP client or intermediary outside the
tested SDK accepts an arbitrary 5 MB response; activation must retain the
governed cap and operational observation.

Result: `FULL_PCC_MAX_SIZE_QUALIFIED=YES` for the candidate’s actual
5,000,000-byte service execution budget.

## 7. Record versioning, replay, and cutover

Result records explicitly distinguish:

- `LEGACY_RECEIPT_ONLY`: old or explicitly legacy inline body; absence of the
  new discriminator is interpreted only as the historical legacy shape
- `SELF_VERIFYING_PCC_VNEXT`: content-addressed R2 reference to exact canonical
  full-PCC bytes

Historical records are not rewritten, backfilled, or synthesized. Cached replay
branches on the discriminator. A vNext artifact is returned only after the
reference resolves and passes length, content-hash, canonical-JSON, schema, and
proof checks.

Replay binding fields and the binding digest algorithm are unchanged. The `.v3`
service identity naturally participates in the existing bound `service_id`; no
caller identity was added. Pricing keys map `.v3` to the exact `.v2` normalized
economics. Network, asset, payee, payment requirement, and settlement amounts
are unchanged.

Pre-artifact Workflow instances may contain cached executor output without
`linkEvidenceInputs`. New code fails those instances closed with
`missing_link_evidence_inputs` before settlement. The production cutover model
is therefore to drain all old in-flight paid continuations before selecting the
candidate release. No compatibility path silently invents evidence or
reconstructs a PCC.

## 8. Settlement order and failure handling

For candidate execution the enforced order is:

1. execute the shared service implementation;
2. freeze the semantic result;
3. build the complete full PCC;
4. validate the candidate output/PCC schema;
5. cryptographically self-verify proof, signature, output hash, and document
   hash;
6. stage the exact canonical PCC to R2 and confirm the reference is ready;
7. settle;
8. commit the versioned result reference to the durable result record;
9. resolve and release the exact stored PCC.

An oversize body, missing link evidence, failed schema/proof validation, or
unavailable staged artifact fails before settlement.

If final result-record persistence fails after successful settlement, the
Workflow returns the explicit `persistence_failed_after_settlement` state and
retains the job in the retryable settling path. A retry reuses existing
settlement/linkage evidence and the staged content-addressed artifact; it does
not settle again and does not misreport success.

## 9. Protocol and public-surface parity

OpenAPI, MCP definitions, A2A skills, catalog/registry descriptors, Bazaar
examples, generated metadata, VCM projections, and Nevermined declarations all
identify the same `.v3` full-PCC output schemas and release hashes. The external
examples contain complete full PCCs; no `.v3` flat-receipt example remains.

MCP retains the four stable `.v2` tool names and adds four explicit
`_v3_candidate` tool names. Candidate calls require
`releaseSelection: "3.0.0-public-candidate"`. With the real MCP SDK and
production-boundary adapter:

- company and web candidate results are accepted as schema-valid
  `structuredContent` full PCCs;
- document and verify candidate calls fail closed with
  `result_authorization_required` before their execution boundary is invoked.

This is the checkpoint’s single material finding relative to an unconditional
“all four MCP services accepted” statement: the two buyer-authorized services
cannot be safely activated or exposed until a real result-authorization model
exists. The checkpoint explicitly prohibited implementing that model and
prohibited treating payment identity as result authorization. Consequently,
public-class MCP conformance passes; buyer-authorized wire activation remains
intentionally blocked.

Nevermined `.v3` declarations are non-production and
`registration_allowed=false`. No live registration or payment path was
activated.

## 10. Activation gate and default behavior

The existing `.v2` release remains the default everywhere.

The exact governed candidate selector is:

`RESULT_CONTRACT_RELEASE_SELECTION=3.0.0-public-candidate`

Public edge candidate routes are mounted only for company and web, and only when
that exact selector and the existing per-service production/payment gates are
all satisfied. Candidate MCP execution requires the matching typed selector.
Document and verify have no mounted v3 edge route and are rejected at MCP before
execution. This is an additive, explicit release selection—not a casual
boolean—and no environment or cloud configuration was changed by this
checkpoint.

Classification:

- public-class result wire ready locally: **YES**
- buyer-authorized result wire ready for activation: **NO**
- buyer-authorized activation blocked without result authorization: **YES**

## 11. Qualification evidence

The post-review focused regression set passed **104/104** across five files. It
covered precompiled candidate validators, production dependency dispatch,
pre-settlement PCC schema/cryptographic rejection, versioned persistence, the
runtime registry, candidate quoting, health metadata, and the real MCP SDK
transport. A separate end-to-end edge matrix passed **172/172** across 11 files,
covering x402 lifecycle/replay, Workflow settlement, route publication, metadata
shadow comparison, public candidate routes, and both public production
compositions.

Affected suite results:

| Area                                                  |   Files |     Tests | Result   |
| ----------------------------------------------------- | ------: | --------: | -------- |
| contracts, PCC schema, runtime, verification, pricing |      48 |       640 | PASS     |
| x402, MCP, A2A, Nevermined                            |      68 |     1,014 | PASS     |
| VCM                                                   |      24 |       312 | PASS     |
| edge source suites                                    |      50 |       566 | PASS     |
| **Total**                                             | **190** | **2,532** | **PASS** |

Additional gates:

- repository TypeScript gate: 25/25 tasks passed, including the edge live-test
  project
- repository ESLint gate: 17/17 tasks passed
- complete MCP package gate passed: protocol format/lint/typecheck/build,
  114/114 unit tests, 114/114 property-config tests, frozen ten-tool spec, seven
  edge route tests, stdio negotiation, metadata verification, and an offline
  packed-install check reporting ten tools
- changed-file Prettier check: passed
- release checksum inventory and no-placeholder assertions: passed
- default OpenAPI generator semantic comparison against active v2: passed for
  all three generated documents
- historical release mutation check for `1.0.0`, `1.0.1`, and `2.0.0`: no
  changed path
- full-history and working-tree secret scan: passed; 934 commits and 1,792
  tracked/non-ignored-untracked files scanned, no leaks found
- credential-gated live tests were not run and are not counted as passes

Source qualification is **PASS**. No broad-suite timeout or unexplained failure
remained. One metadata mutation test exceeded its original five-second budget
only under the concurrent aggregate run, while repeatedly passing in isolation;
the test now has an explicit 15-second integration budget and subsequently
passed in the same 172-test aggregate matrix. The first core rerun correctly
caught stale checkpoint-owned v3 preimage goldens after the governed PCC schema
byte hash changed; those vectors were regenerated through their guarded update
path and a subsequent non-update full core run passed 640/640. The first
working-tree secret scan correctly caught five synthetic high-entropy fixture
idempotency keys; the fixture path was corrected without scanner allowlisting,
and the subsequent complete scan passed.

## 12. Independent review

The first independent clean-context review returned **FAIL / BLOCKED** with six
important findings. All six were reproduced or confirmed and corrected before
closure:

1. Candidate public routes could enqueue `.v3` jobs, but the production Workflow
   dependency registry only mapped `.v2`. The registry now contains explicit
   company/web `.v3` dispatch entries, with focused dispatch tests.
2. Several x402 lifecycle records used a binary v2/v1 version mapping and could
   label `.v3` quotes, bindings, jobs, and evidence as v1. One shared service-ID
   version function now supplies all of those fields, including the in-process
   Workflow test binding and dispatcher.
3. Worker precompiled output validators omitted the candidate schemas. The
   generator now emits active and candidate validators under distinct export
   names, and generated-equivalence coverage requires all eight governed IDs.
4. Workflow staging and cached replay verified canonical storage/hash integrity
   but not the governed candidate schema and signature. Both paths now call the
   same schema-plus-cryptographic verifier; schema-invalid and bad-signature
   fixtures fail before settlement.
5. MCP exposed `.v3` quotes without the governed release selector. Candidate
   quotes now require `3.0.0-public-candidate`, while buyer-authorized candidate
   quotes remain rejected with `result_authorization_required`.
6. MCP health still reported six tools. Health and route/shadow/publication
   assertions now derive the count and names from the canonical ten-tool set.

The broadened rerun then found and fixed one adjacent publication defect: the
catalog response validator did not yet admit the governed `v3` service version
and `candidate` contract role. The complete public-surface test is green after
that correction.

The re-review found one further packaging defect after the six source blockers
were closed: `npm pack` still included ignored split files left by an older
protocol-MCP build, and those stale files described the former six-tool surface.
The package build now removes only its generated `dist/` directory before
emitting the current bundle. A fresh `npm pack --dry-run --json` contains
`dist/index.js` and no stale split `constants`, `server`, or `frozen-contracts`
artifacts.

Final independent re-review: **PASS**. The reviewer verified the corrected six
source blockers, catalog enum support, focused 104-test set, frozen ten-tool
spec, and clean MCP tarball. No Critical or Important finding remained. The
overall checkpoint remains **PASS WITH FINDINGS** because buyer-authorized v3
activation is intentionally blocked pending real result authorization, not
because of an unresolved implementation defect.

## 13. Cloud mutation accounting

| Mutation class                | Count |
| ----------------------------- | ----: |
| Worker uploads                |     0 |
| Worker deployment mutations   |     0 |
| Public traffic mutations      |     0 |
| Continuation host deployments |     0 |
| Alert Worker deployments      |     0 |
| Cloud secret mutations        |     0 |
| Production D1 writes          |     0 |
| Real payment attempts         |     0 |

## 14. Result and next checkpoint

Local candidate result: **PASS WITH FINDINGS**. The public-class result wire is
implemented and locally qualified. The buyer-authorized services remain blocked
exactly as required because authenticated caller/result authorization is absent.

Next recommended checkpoint: **RESULT-AUTHORIZATION-DESIGN-01 — design and
qualify an authenticated caller-to-result authorization model for
buyer-authorized document and verification results, without activating or
deploying the v3 candidate.**

# RESULT-AUTHORIZATION-ENFORCEMENT-01

## Disposition

`PASS_WITH_FINDINGS` — the buyer-authorized v3 document and verification result
paths are locally implementation-ready and fail closed behind an additional
disabled-by-default activation gate. No production activation, deployment,
payment, cloud secret mutation, production D1 access, or push was performed. The
findings are pre-existing repository-wide qualification baselines described
below; no checkpoint-owned authorization test is failing.

This report is evidence for local qualification only. It is not production
acceptance or deployment authority.

## Provenance and repository safety

- Starting commit: `031c085f88300554165ca76197d89d43974c23e2`
- Branch: `metadata-vcm-qualification`
- Initial working tree: clean
- Preserved stash:
  `stash@{0}: WIP on main: 3c64615 SUN-0300: Complete credential-independent public-data adapters implementation with drift detection, fixture matrix, and comprehensive test coverage`
- The stash was not applied, dropped, or altered.
- The implementation is additive to the inherited checkout. No unrelated
  working-tree content was discarded.

## Canonical subject and verifier boundary

The protocol-neutral `ResultSubjectV1` and `VerifiedPrincipalEvidence` types
live in `apps/edge-api/src/control-plane/security/result-authorization.ts`.
Normalization validates closed subject, authentication-method, assurance, and
credential-binding vocabularies; NFC-normalizes bounded issuer/subject strings;
rejects empty/control-character values; and canonicalizes `authenticated_at`.
The subject contains no email, username, IP address, User-Agent, wallet, raw
JWT, OAuth token, or API key.

`IdentityEvidenceVerifierV1` is defined in
`apps/edge-api/src/control-plane/security/request-principal.ts`. Result
authorization receives only server-created `VerifiedPrincipalEvidence`, never
raw protocol credentials.

### OIDC

`apps/edge-api/src/control-plane/security/oidc-principal.ts` implements the
minimum configured OIDC JWT path. It accepts only three-segment, signed `RS256`
JWTs and validates configured issuer, configured audience, required subject,
expiration, optional not-before, future issued-at, configured key
ID/algorithm/use, and the RSA signature. Unsigned tokens, arbitrary issuers,
unknown keys, invalid signatures, and malformed tokens are rejected. Issuer
configurations and JWKs are explicit runtime configuration; this is not a
general IdP platform.

### Cloudflare-verified mTLS

`apps/edge-api/src/control-plane/security/mtls-principal.ts` consumes the
existing Cloudflare TLS caller-context seam and returns a principal only when
Cloudflare reports a valid client certificate and its issuer DN plus SHA-256
certificate fingerprint match an explicit governed registry entry. Registry
entries map to `workload`, `service_account`, or `agent`; certificate metadata
alone grants no authority.

### Gateway and headers

No Kong/gateway assertion path was activated. Arbitrary `X-User`, `X-Principal`,
`X-Email`, `X-Subject`, MCP initialization metadata, MCP tool `_meta`, and Agent
Card identity are not authentication inputs. The supported request boundary
reads only `Authorization: Bearer ...` for configured OIDC and Cloudflare-owned
`request.cf.tlsClientAuth` for mTLS.

## Keyed subject reference

`canonicalSubjectReference` produces:

`<configured-key-version>:HMAC-SHA256(configured-secret, canonical JSON containing domain=siteborne.subject_digest.v1, key_version, subject_type=authenticated_caller_subject, and a SHA-256 qualification of issuer + subject_id + subject_type)`

The configured HMAC key must be at least 32 bytes and its key version must match
a restricted identifier syntax. The reference is deterministic,
issuer-qualified, versioned, domain-separated, opaque without the key,
independent of credential rotation, and unrelated to payer identity. It is not
projected into PCC.

## Result resource and durable binding

`ResultResourceV1` in
`apps/edge-api/src/control-plane/security/result-authorization.ts` identifies
one finalized result by operation ID, opaque result ID, exact durable artifact
ID, PCC document hash, service ID/version, contract release, confidentiality
class, and immutable result binding ID. `canonicalResourceReference`
domain-separates a digest over all of those fields. It excludes payer, wallet,
quote, payment identifier, and credentials.

`D1ResultAuthorizationRepository` in
`apps/edge-api/src/control-plane/repositories/d1/result-authorization.ts`
persists immutable bindings and finalized resources.
`migrations/0011_result_authorization.sql` adds:

- `result_subject_bindings`, unique by binding and operation, with the opaque
  owner reference, operation-scope reference, binding policy, creation
  authority, AuthorityContextID, PolicyEvaluationID, and timestamp;
- `result_resources`, unique by result, operation, durable artifact, PCC hash,
  and binding, with restrictive foreign keys to the job and binding.

Creation is idempotent for byte-equivalent records and fail-closed on
conflicts/races or substitution. For buyer-authorized v3, a single transactional
D1 batch acquires the payment attempt, creates the job, and creates the
immutable owner binding after authentication and before payment-provider
verification or provider execution. A failure rolls all three writes back; a
retry cannot assign ownership to an unbound acquired attempt. Provider execution
is additionally unreachable unless the binding exists. The production durable
Workflow persists the exact PCC resource after settled-result persistence and
before terminal delivery. Its missing/invalid binding path fails closed.

The migration was exercised against ephemeral local Miniflare D1 in two modes: a
fresh database with the complete ordered migration set, and an upgrade database
with all prior migrations followed by `0011_result_authorization.sql`. Tests
cover transactional payment/job/binding admission and rollback, uniqueness,
idempotent duplicates, conflicting duplicates, resource/binding linkage, missing
binding, artifact substitution, and forbidden columns. No production D1 was
accessed. The migration is forward-only in production: rollback before
activation is to leave the unused additive tables in place and disable the
candidate gate; after data exists, tables must not be dropped or ownership
history rewritten without a separately governed migration.

Readback rejects unsupported stored binding-policy versions and creation
authority values; repository mapping does not replace corrupted persisted
authority fields with current constants.

## Release policy

`evaluateResultReleaseAuthorization` in
`apps/edge-api/src/control-plane/security/result-authorization.ts` is
deterministic and pure. It performs no I/O, mutation, payment/provider call, or
LLM call. It uses the closed decisions `MATCH`, `PUBLIC_RESULT`,
`VALID_DELEGATION`, `NO_AUTHENTICATED_PRINCIPAL`, `SUBJECT_MISMATCH`,
`SUBJECT_REVOKED`, `DELEGATION_INVALID`, `RESOURCE_MISMATCH`, `LEGACY_UNBOUND`,
and `POLICY_ERROR`.

For `BUYER_AUTHORIZED`, release requires the governed resource classification,
supported binding and release policy versions, matching binding ID, matching
operation scope, verified caller, available subject-reference key, non-revoked
owner/caller, and an exact canonical owner match. Payment, wallet, payer, quote,
payment identifier, and replay-tuple possession are never policy inputs.
Delegation types and the closed invalid-delegation decision exist, but
delegation persistence/API and grants are intentionally absent for first
activation.

For `PUBLIC`, governed company and web v3 resources receive `PUBLIC_RESULT`
without caller authentication. Their existing payment, admission, execution, and
settlement requirements remain in force.

Binding policy is fixed at `result_binding_policy.v1`; release policy is
independently fixed at `result_release_policy.v1`. Unsupported versions fail
closed. Revocation is supplied through a current server-owned subject-status
seam and can deny release without altering ownership or invalidating/re-signing
PCC.

Legacy sensitive/unbound results return `LEGACY_UNBOUND` and are externally
collapsed to `result_not_available`. No owner is inferred from historical
payment or replay evidence. Historically authoritative public classification
remains eligible for public policy.

## Initial and replay enforcement

`apps/edge-api/src/control-plane/routes/x402-service.ts` uses one
reconstruction-and-authorization path for both initial completion and replay.
The same finalized resource, immutable binding, revocation set, subject key, and
pure release policy are used in both cases. The replay tuple and its economic
digest are unchanged.

For sensitive v3 routes, authentication happens before request JSON parsing,
quote generation, protected job/result lookup, storage mutation, payment
verification, or provider invocation. Unauthenticated requests return
`authentication_required`. After authentication, missing jobs/resources, wrong
owners, substitutions, revocation, legacy-unbound data, unsupported policies,
and policy/data errors collapse to `result_not_available`; responses disclose no
owner, subject reference, artifact ID, PCC hash, job state, binding ID, or
existence signal.

The first successful operation creates its binding before provider/payment
verification. On replay, the caller must match the immutable operation binding
before any Workflow join/recovery, result-state check, cached body read, R2
read, or PCC validation. The finalized durable PCC reference is persisted as a
result resource before terminal delivery. The release policy then runs before
returning the initial PCC or any replay. A denied release does not trigger
duplicate provider execution or settlement. Missing/pending/corrupt protected
results collapse to the same 404 as wrong-owner results, including on consumed
replay. The replay tuple is used only to locate the operation.

## REST, MCP, and A2A integration

REST candidate routes for `document_evidence_json.v3` and
`verify_agent_output.v3` are mounted but require all existing
candidate/payment/storage/workflow conditions plus the separate
`BUYER_AUTHORIZED_V3_ROUTE_ENABLED` gate and complete result-auth configuration.
That new gate defaults off. Legacy v2 remains the default, and existing public
company/web v3 selector behavior is unchanged.

MCP authenticates at the HTTP `/mcp` boundary before dispatch, stores the
verified principal in a server-owned `WeakMap` request context, and
conditionally exposes buyer-authorized v3 only when the server has configured
result authorization and this request has a verified caller. The same condition
guards `siteborne_get_quote`, so anonymous MCP traffic cannot obtain a protected
candidate quote. Client name/version, initialization metadata, tool `_meta`, and
tool arguments cannot create a principal. The MCP adapter forwards only the
server-owned principal into the same x402 route and release policy used by REST.

A2A currently exposes no buyer-authorized result-release endpoint, so no
endpoint was invented. The existing Cloudflare-verified mTLS ingress seam and
the shared governed registry mapper were qualified as the canonical adapter
boundary. Agent Card identity remains descriptive metadata and cannot
authenticate a caller. Therefore A2A is `NOT_APPLICABLE` for an executable
buyer-result flow, while its required future authentication boundary is locally
qualified.

## Public authentication contract

Candidate release `3.0.0` OpenAPI now declares bearer JWT and mutual TLS
security schemes and applies them only to the document and verify
buyer-authorized operations, with governed `401 authentication_required` and
privacy-collapsed `404 result_not_available` behavior. Those operations also
declare the result-authorization semantics. MCP metadata advertises
authentication only for the two sensitive v3 tools. A2A/catalog surfaces do not
claim an endpoint that does not exist.

The release checksum manifest was regenerated and independently verified. PCC
schemas, proof namespace, signing domain, output hash, PCC document hash,
receipt rules, content-addressed R2 semantics, and PCC examples were not
changed. The PCC contains no caller identity, auth token, subject reference,
revocation state, or private authority state. V2 public contracts are unchanged.

## Security authority bridge and telemetry

The minimal bridge is opaque and internal: existing `jobs.id` is OperationID;
generated opaque values provide AuthorityContextID, PolicyEvaluationID,
ResultBindingID, and the closed ResultReleaseDecision. No future Security
Authority hierarchy or internal authorization context is publicly projected.

Authorization telemetry uses a closed, best-effort event vocabulary and
privacy-safe dimensions for protocol, service/classification, decision,
verifier/auth characteristics, policy versions, initial/replay, coarse latency,
and correlation. It does not include raw JWT/token/key/signature, full subject
ID/digest, wallet-as-identity, PCC, PCC/result hash, artifact reference, or
payment signature. Telemetry failure cannot grant access.

## Payment, workflow, and PCC non-regression

No price table, canonical economic offer, payment requirement, network, asset,
payee, payment verification provider, settlement call, reconciliation rule, or
economic replay binding changed. The paid workflow validates and persists the
executor-measured amount for the already-existing `upto` requirement before PCC
creation/settlement; it rejects a missing or over-authorized measured amount.
Only `document_evidence_json.v3` can use that Workflow path. Existing v1 `upto`
routes retain their explicit pre-Workflow 500 and do not gain settlement
authority. The default v2 executor identities and exact-price behavior remain
unchanged. The verify-v3 composition now uses the canonical v2-inherited
`verify_agent_output_standard_v2` key (USD 0.017), matching MCP quotes; the
published 3.0.0 metadata's older USD 0.019 value remains an activation finding.

No PCC schema or proof implementation changed. Authorization wraps result
release and does not modify cryptographic validity: a PCC remains valid when
current access is denied.

## Adversarial and real-flow coverage

Focused tests cover the required matrix: no-principal replay, payer/owner
separation, shared payer wallet, correct owner, guessed result, arbitrary
headers, wrong OIDC issuer/audience, expiration/not-before/future-issued-at,
invalid signature, valid OIDC, valid and unmapped mTLS, MCP metadata
impersonation, Agent Card non-authority, anonymous public policy, initial/replay
parity, revoked subjects, legacy-unbound data, resource/artifact/hash
substitution, unsupported policy versions, PCC validity under denial, storage
privacy, telemetry privacy, atomic binding-before-provider timing, and public/v2
compatibility.

`apps/edge-api/tests/result-authorization-real-rest-flow.test.ts` exercises
document and verify through their real candidate REST route wiring, including
unauthenticated, correct owner initial delivery, attacker replay, owner replay,
revocation, unchanged PCC, and single payment-provider verification. The same
test exercises document and verify through the MCP adapter/route boundary for
owner initial delivery, attacker replay, client-metadata impersonation, owner
replay, and no provider reinvocation solely due to denied release. It mocks only
the vNext PCC validation function to isolate result-authorization route
integration; the separate result-wire/PCC suites cover real PCC proof and
storage behavior.

## Qualification evidence

The following local, credential-independent gates were run from the repository
root:

- Final affected authorization/security/D1/route/MCP/Workflow/PCC suites:
  `395/395` passed across 18 files. The six direct authorization files account
  for `38/38` tests.
- Real flows: REST document, REST verify, MCP document, and MCP verify: `4/4`
  passed within the focused set.
- An earlier exploratory broad run had `451/455`: two pre-existing v3
  canonical-URL projection assertions and two default five-second aggregate
  timeouts. Both timed-out cases passed on isolated 20-second reruns. The final
  affected run above was green after reviewer remediation.
- TypeScript monorepo typecheck: `25/25` tasks passed.
- ESLint: `17/17` tasks passed.
- Changed-file Prettier qualification: passed. Repository-wide `format:check`
  remains a known pre-existing baseline failure (342 files plus malformed
  historical evidence artifacts); it was not greenwashed or rewritten by this
  checkpoint.
- Contract release checksum verification, release verification, compatibility
  check, and schema checks: passed.
- Secret scan: passed, including tracked history and working tree.
- Local D1 fresh/upgrade migration and repository behavior: `7/7` passed.

Credential-gated and live-cloud tests were not run and are not counted as
passes.

### Baseline findings

1. The broad canonical-URL projection suite retains two assertions already
   documented at the starting checkpoint baseline. This checkpoint updates
   authentication metadata, not canonical URL publication, and does not silently
   rewrite that unrelated contract surface.
2. Two broad-suite tests exceeded their inherited five-second aggregate timeout
   under concurrent load. Each passed when rerun directly with a 20-second
   timeout; no functional failure was reproduced.
3. Repository-wide Prettier remains red from the inherited baseline. Every
   changed text file passes Prettier independently.
4. Published Release 3 verify-v3 metadata says USD 0.019, while the inherited
   canonical economic definition and MCP quote use USD 0.017. The candidate REST
   route now follows that canonical USD 0.017 key; metadata/economic authority
   must be reconciled under a separately authorized contract and pricing
   checkpoint before production activation. This checkpoint did not change
   either governed price table or immutable published metadata price.

## Independent security review

The required clean-context source review examined the working-tree diff before
commit and found eight checkpoint-owned issues. Its P1 findings were protected
result-state reads and Workflow joins before owner authorization, unintended
legacy `upto` settlement activation, verify-v3 REST/MCP pricing-key divergence,
and a non-atomic payment-attempt/job/binding admission gap. P2 findings were an
MCP quote gate keyed only on configuration, unauthenticated D1 audit writes, and
malformed OIDC temporal claims being ignored. A P3 finding was consumed replay
telemetry labeled as initial release. The implementation now checks the bound
owner before protected state/Workflow access, scopes `upto` support to document
v3, uses the canonical v2-inherited verify-v3 price key, batches all three
admission writes, requires a verified caller for protected MCP quotes, omits
unauthenticated durable audit writes, rejects malformed temporal claims, and
labels replay explicitly. The reviewer also prompted the additional production
Workflow registry and finalization-resource binding checks.

The reviewer identified one residual policy-version confusion risk: persisted
binding-policy and creation-authority fields were overwritten by current
constants during row mapping. Readback now validates both stored values and
fails closed on unsupported or corrupted records; a local D1 corruption test
exercises this boundary. A current-tree source recheck found no remaining
mission-owned security blocker. The independent security verdict is `PASS`; the
overall local disposition remains `PASS_WITH_FINDINGS` for the separate
inherited activation and broad-qualification findings. This review was
source-only and made no repository edits.

## Cloud and external-mutation accounting

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
| Git pushes                    |     0 |

## Activation readiness

`BUYER_AUTHORIZED_RESULT_WIRE_READY=YES` means local result-wire enforcement
qualification only. `BUYER_AUTHORIZED_PRODUCTION_ACTIVATED=NO`. Production
activation still requires a separate authorized checkpoint for the verify-v3
metadata/economic-authority discrepancy, secrets/issuer/registry configuration,
production migration, credentialed live acceptance, rollout, and independent
production verification. The recommended next checkpoint is
`PCC-V3-IMMUTABLE-CANDIDATE-QUALIFICATION-01`.

## Required result summary

```text
RESULT_AUTHORIZATION_ENFORCEMENT_01=PASS_WITH_FINDINGS
STARTING_HEAD=031c085f88300554165ca76197d89d43974c23e2
RESULT_SUBJECT_IMPLEMENTATION=apps/edge-api/src/control-plane/security/result-authorization.ts :: ResultSubjectV1 and normalizeResultSubject
SUBJECT_REFERENCE_MODEL=versioned issuer-qualified HMAC-SHA256 authenticated_caller_subject reference
IDENTITY_EVIDENCE_VERIFIER=apps/edge-api/src/control-plane/security/request-principal.ts :: IdentityEvidenceVerifierV1
OIDC_PRINCIPAL_IMPLEMENTED=YES
MTLS_PRINCIPAL_IMPLEMENTED=YES
ARBITRARY_IDENTITY_HEADERS_TRUSTED=NO
KONG_PRINCIPAL_IS_SITEBORNE_AUTHORITY=NO
RESULT_RESOURCE_IMPLEMENTATION=apps/edge-api/src/control-plane/security/result-authorization.ts :: ResultResourceV1 and canonicalResourceReference
RESULT_SUBJECT_BINDING_STORAGE=migrations/0011_result_authorization.sql + D1ResultAuthorizationRepository
RESULT_RESOURCE_BOUND_BEFORE_RELEASE=YES
RESULT_RELEASE_POLICY=apps/edge-api/src/control-plane/security/result-authorization.ts :: evaluateResultReleaseAuthorization
PAYER_CAN_AUTHORIZE_RESULT_RELEASE=NO
TUPLE_POSSESSION_CAN_AUTHORIZE_SENSITIVE_RESULT=NO
PUBLIC_RESULT_REQUIRES_CALLER_AUTH=NO
DELEGATION_IMPLEMENTED=NO
DELEGATION_FIRST_ACTIVATION_REQUIRED=NO
REVOCATION_INVALIDATES_PCC=NO
REVOCATION_CAN_BLOCK_RELEASE=YES
RESULT_AUTH_POLICY_VERSIONING=PASS
INITIAL_RESULT_AUTHORIZATION_ENFORCED=YES
REPLAY_BINDING_DIGEST_CHANGED=NO
REPLAY_RESULT_AUTHORIZATION_ENFORCED=YES
RESULT_EXISTENCE_ORACLE_PROTECTED=YES
REST_V3_AUTHENTICATION=PASS
MCP_V3_AUTHENTICATION=PASS
A2A_V3_AUTHENTICATION=NOT_APPLICABLE
V3_PUBLIC_AUTH_CONTRACT_UPDATED=YES
V2_PUBLIC_AUTH_CONTRACT_UNCHANGED=YES
RESULT_AUTH_CONTEXT_PUBLICLY_EXPOSED=NO
SECURITY_AUTHORITY_BRIDGE_IMPLEMENTED=YES
LEGACY_SENSITIVE_RESULT_FAILS_CLOSED=YES
HISTORICAL_RESULT_MUTATION=NO
PRICING_CHANGED=NO
PAYMENT_REQUIREMENT_CHANGED=NO
SETTLEMENT_CHANGED=NO
ECONOMIC_BINDING_CHANGED=NO
PCC_SCHEMA_CHANGED=NO
PCC_PROOF_CHANGED=NO
PCC_CONTAINS_CALLER_IDENTITY=NO
PCC_CONTAINS_RAW_AUTH_TOKEN=NO
PCC_CONTAINS_PRIVATE_AUTHORITY_STATE=NO
AUTH_TELEMETRY_PRIVACY=PASS
SUBJECT_BINDING_BEFORE_EXECUTION=YES
PAYER_OWNER_SHORTCUTS=0
UNVERIFIED_IDENTITY_HEADER_PATHS=0
PRIVATE_AUTH_STATE_LEAKS=0
LOCAL_AUTH_SCHEMA_MIGRATION=PASS
DEFAULT_V2_UNCHANGED=YES
PUBLIC_V3_COMPATIBILITY=PASS
BUYER_AUTHORIZED_RESULT_WIRE_READY=YES
BUYER_AUTHORIZED_PRODUCTION_ACTIVATED=NO
FOCUSED_AUTH_TESTS=38/38
REAL_FLOW_TESTS=4/4
AFFECTED_TESTS=395/395
TYPECHECKS=PASS
ESLINT=PASS
PRETTIER=PASS
SECRET_SCAN=PASS
INDEPENDENT_SECURITY_REVIEW=PASS
SOURCE_QUALIFICATION=PASS_WITH_FINDINGS
WORKER_UPLOADS=0
WORKER_DEPLOYMENT_MUTATIONS=0
PUBLIC_TRAFFIC_MUTATIONS=0
CONTINUATION_HOST_DEPLOYMENTS=0
ALERT_WORKER_DEPLOYMENTS=0
CLOUD_SECRET_MUTATIONS=0
PRODUCTION_D1_WRITES=0
REAL_PAYMENT_ATTEMPTS=0
REPORT_PATH=docs/reports/RESULT-AUTHORIZATION-ENFORCEMENT-01.md
NEXT_RECOMMENDED_CHECKPOINT=PCC-V3-IMMUTABLE-CANDIDATE-QUALIFICATION-01
```

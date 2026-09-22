# RESULT-AUTHORIZATION-DESIGN-01

Status: **PASS WITH FINDINGS — design and local reference model only**

Date: 2026-09-22

## 1. Provenance and checkpoint boundary

The checkpoint started from the exact required commit:

```text
STARTING_HEAD=2a374c7e7f97baeec2255d268dbe390c5e61cba6
BRANCH=metadata-vcm-qualification
WORKING_TREE_AT_START=CLEAN
PRE_EXISTING_STASH_COUNT=1
```

The pre-existing stash was listed and left untouched. No stash was applied,
dropped, created, or altered.

This report is based on the repository at the starting commit plus the local
test/reference artifacts created by this checkpoint. It makes no new claim about
the currently deployed Worker version or live traffic. The prior
`RESULT-PCC-WIRE-CUTOVER-01` result is carried forward, not reopened:

```text
WIRE_ROOT_REPRESENTATION=FULL_PCC
NEW_PCC_SCHEMA_RELEASE=2.0.0
NEW_SERVICE_CONTRACT_RELEASE=3.0.0
PCC_DELIVERY_SELF_VERIFYING=YES
INITIAL_RESULT_REPRESENTATION_EQUALS_CACHED=YES
ECONOMIC_REPLAY_SAFETY=PASS
EXECUTION_REPLAY_SAFETY=PASS
SETTLEMENT_REPLAY_SAFETY=PASS
PUBLIC_CLASS_RESULT_WIRE_READY=YES
BUYER_AUTHORIZED_RESULT_WIRE_READY=NO
BUYER_AUTHORIZED_ACTIVATION_BLOCKED_WITHOUT_RESULT_AUTH=YES
```

Allowed work was limited to repository reads, one pure test-only reference
model, its tests, this report, local verification, independent review, and a
local commit. No production request path imports the reference model.

## 2. Repository evidence and current gap

The current architecture establishes the following:

- `apps/edge-api/src/control-plane/routes/x402-service.ts` is the common paid
  REST release path. The duplicate/replay branches locate durable results by the
  economic replay tuple and `job_id`; they do not verify a caller subject.
- `apps/edge-api/src/control-plane/mcp/x402-mcp-adapter.ts` translates MCP tool
  calls into calls to those same REST route functions. It does not create a
  separate result-authorization boundary.
- `packages/protocol-mcp/src/server.ts` reads MCP `clientInfo` into an
  informational invocation context. Client name/version are self-described and
  do not become authority.
- `packages/protocol-a2a/src/card.ts` keeps root and skill security requirements
  empty. Its optional mTLS declaration is capability metadata only.
- `apps/edge-api/src/control-plane/security/mtls-caller-context.ts` can derive a
  header-immune identity from Cloudflare-verified `request.cf.tlsClientAuth`,
  but the module explicitly states that it is wired into zero routes.
- `contracts/releases/3.0.0/metadata/*.v3.json` classifies company and web as
  `public`, and document and verify as `buyer_authorized`.
- `migrations/0004_x402_quotes.sql` and `X402ServiceResultRepository`
  persist/retrieve result content by `job_id` and retain `payment_identifier`;
  no subject binding exists.
- `packages/vcm/src/security/vocabulary.ts` reserves `OperationID`,
  `AuthorityContextID`, `PolicyEvaluationID`, and `ResultBindingID`, but does
  not implement the authority hierarchy.
- The v3 OpenAPI document currently has no security scheme or operation security
  declaration.

Therefore the current result-release model remains:

```text
RESULT_AUTHORIZATION_MODEL=REQUEST_TUPLE_POSSESSION
CURRENT_AUTHENTICATED_CALLER_IDENTITY=absent
```

The gap is independent of execution authorization, payment authorization,
settlement authorization, replay idempotency, and PCC validity.

## 3. Security constitution

The design preserves these non-interchangeable concepts:

- authentication is not authorization;
- identity is not trust;
- payment authorization is not identity;
- a payment receipt is not result authorization;
- a payer is not a caller unless independently proven;
- execution authority is not result-release authority;
- result existence is not result authorization;
- a PCC is not permission;
- evidence is not authority;
- wallet ownership is not a SITEBORNE principal identity by definition;
- an external gateway identity is not SITEBORNE authority by definition; and
- no LLM participates in authentication, binding, delegation validation, or a
  release decision.

An identity provider or gateway may produce verified identity evidence.
SITEBORNE's deterministic policy is the sole authority that decides whether that
evidence permits result release.

## 4. Canonical subject model

`RESULT_SUBJECT_MODEL=ResultSubjectV1`

```ts
interface ResultSubjectV1 {
  schema_version: 'result_subject.v1';
  subject_type:
    | 'human'
    | 'organization'
    | 'service_account'
    | 'workload'
    | 'agent';
  issuer: string; // normalized issuer URI or SITEBORNE-controlled issuer id
  subject_id: string; // stable issuer-scoped pseudonymous id
  authentication_method:
    | 'oidc'
    | 'signed_request'
    | 'api_key'
    | 'mtls'
    | 'gateway_assertion';
  assurance_level:
    | 'verified_single_factor'
    | 'verified_multi_factor'
    | 'cryptographic_workload'
    | 'trusted_gateway_assertion';
  authenticated_at: string; // ISO instant from verified evidence
  credential_binding: null | {
    kind: 'jwk_thumbprint' | 'certificate_sha256' | 'key_id';
    value: string; // thumbprint or non-secret key id, never key material
  };
}
```

The subject is protocol-neutral and does not name Kong, Cloudflare, MCP, A2A,
x402, Nevermined, or a wallet implementation.
`issuer + subject_type + subject_id` is canonicalized, domain-separated, and
first reduced to an opaque issuer-qualified principal identifier, then
HMAC-SHA-256 pseudonymized to create the durable `owner_subject_ref`. Logically,
the reference is the existing `{ subject_digest, digest_key_version }` tuple;
the local test fixture uses a compact `key-version:digest` serialization. The
HMAC input uses the governed `authenticated_caller_subject` axis and the
existing `siteborne.subject_digest.v1` key-management/rotation authority.
Production must call the repository's Security Authority primitive rather than
copying the fixture serialization. Comparisons across key versions require the
key resolver described by the existing SA-1 prerequisite; unknown/unavailable
versions fail closed. Email, username, IP, User-Agent, raw JWT, raw OAuth token,
raw API key, raw certificate, raw signature, and mutable profile attributes are
excluded.

`identity != trust`: construction of `ResultSubjectV1` means only that an
accepted verifier produced verified evidence. Release still requires a policy,
resource, and binding match.

## 5. Identity evidence source matrix

`IDENTITY_EVIDENCE_SOURCE_MATRIX`:

| Source                                                                  | Availability                                                                                       | Evidence class                                                                   | Can create a canonical subject? | Conditions / disposition                                                                                                                                    |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP bearer / OIDC principal                                            | `REQUIRES_NEW_INTEGRATION`                                                                         | Cryptographically authenticated                                                  | Yes                             | Verify signature, issuer, audience, time claims, stable `sub`, allowed algorithm, and optional key binding. No current route does this.                     |
| MCP authenticated principal                                             | `REQUIRES_NEW_INTEGRATION`                                                                         | Depends on HTTP ingress: cryptographic or gateway-asserted                       | Yes                             | Authenticate the HTTP transport before MCP dispatch and inject verified evidence through a typed server context. MCP initialization metadata is unsuitable. |
| A2A authenticated principal                                             | `AVAILABLE_WITH_EXISTING_INFRASTRUCTURE`                                                           | Cryptographically authenticated when Cloudflare mTLS is provisioned and verified | Yes                             | Existing mTLS derivation is dormant and must be wired at the A2A ingress. Agent Card/provider/signature identifies SITEBORNE, not the caller.               |
| Kong verified enterprise identity                                       | `REQUIRES_NEW_INTEGRATION`                                                                         | Gateway-asserted                                                                 | Yes                             | Only through an authenticated intermediary and a versioned assertion profile; arbitrary Kong-like headers are rejected.                                     |
| Cloudflare Access identity                                              | `REQUIRES_NEW_INTEGRATION`                                                                         | Gateway-asserted / cryptographically authenticated token                         | Yes                             | Verify Access JWT or authenticated edge assertion, issuer, audience, freshness, and application binding. `CF-*` headers alone are not authority.            |
| Cloudflare edge mTLS identity                                           | `AVAILABLE_WITH_EXISTING_INFRASTRUCTURE`                                                           | Cryptographically authenticated / transport-derived                              | Yes                             | Use only `request.cf.tlsClientAuth` after edge verification; map trusted CA plus certificate fingerprint to a workload/service principal.                   |
| Signed-request principal                                                | `REQUIRES_NEW_INTEGRATION`                                                                         | Cryptographically authenticated                                                  | Yes                             | Verify key registry, signature, canonical request target/body digest, audience, nonce, and freshness.                                                       |
| API-key principal                                                       | `REQUIRES_NEW_INTEGRATION`                                                                         | Cryptographically authenticated secret possession                                | Yes, at a lower assurance       | Store only a salted verifier/key id; bind a key to one service-account subject; support rotation/revocation. A leaked key impersonates that principal.      |
| Wallet-signature principal                                              | `UNSUITABLE_FOR_RESULT_AUTHORIZATION` as a raw wallet proof                                        | Cryptographically authenticated possession proof                                 | Not by default                  | May become identity evidence only after a governed issuer/proofing step maps it to a SITEBORNE subject. Wallet ownership alone is not principal identity.   |
| x402 payer wallet                                                       | `UNSUITABLE_FOR_RESULT_AUTHORIZATION`                                                              | Payment-derived                                                                  | No                              | Payer evidence remains `PayerEvidence`; never silently promoted to owner/caller.                                                                            |
| Nevermined identity/payment subject                                     | `UNSUITABLE_FOR_RESULT_AUTHORIZATION` in the current payment path                                  | Payment-derived / external assertion                                             | Not from payment evidence       | A future non-payment identity assertion would need its own verifier, audience, semantics, and issuer trust.                                                 |
| Service-to-service workload identity                                    | `AVAILABLE_WITH_EXISTING_INFRASTRUCTURE` via Cloudflare mTLS; otherwise `REQUIRES_NEW_INTEGRATION` | Cryptographically authenticated                                                  | Yes                             | Prefer mTLS certificate identity now; signed workload identity is a portable future adapter.                                                                |
| `X-User`, `X-Principal`, `X-Email`, IP, User-Agent, MCP client metadata | `UNSUITABLE_FOR_RESULT_AUTHORIZATION`                                                              | Self-asserted or transport-derived                                               | No                              | Never authority-bearing.                                                                                                                                    |

“Available with existing infrastructure” does not mean active. It means the
repository already contains the trust-preserving primitive or the hosting layer
already provides the verified fact; route wiring, policy, and qualification
remain future work.

## 6. Identity trust boundary

`IDENTITY_TRUST_BOUNDARY`:

```text
protocol credential / authenticated edge fact
  -> protocol-specific ExternalIdentityEvidence adapter
  -> IdentityEvidenceVerifierV1
       verifies issuer, integrity/authenticity, subject, audience,
       freshness, authentication method, and credential binding
  -> VerifiedPrincipalEvidence
       { verification_status: VERIFIED, verifier_id, evidence_type, subject }
  -> ResultAuthorizationContextV1
  -> deterministic SITEBORNE release policy
```

The verifier API accepts typed evidence, not an arbitrary header map. Rejected
evidence carries a closed reason and no principal. Gateway assertions require:

1. an authenticated intermediary channel (mTLS, validated gateway JWT, or an
   equivalent cryptographic binding);
2. a configured intermediary identity;
3. a versioned assertion-semantics profile;
4. issuer and audience validation;
5. freshness/replay validation; and
6. removal or overwriting of all client-supplied identity headers at the trust
   boundary.

```text
KONG_PRINCIPAL_IS_SITEBORNE_AUTHORITY=NO
```

Kong can later implement `ExternalIdentityEvidenceAdapter`; adding it does not
change `ResultSubjectV1`, `ResultResourceV1`, or the policy engine.

## 7. Result resource model

`RESULT_RESOURCE_MODEL=ResultResourceV1`

```ts
interface ResultResourceV1 {
  schema_version: 'result_resource.v1';
  operation_id: string; // current bridge: jobs.id
  result_id: string; // new opaque result record id; not payment id
  artifact_id: string; // exact durable v3 PCC artifact reference
  pcc_document_hash: string; // governed hash, identity not permission
  service_id: string;
  service_version: string;
  contract_release: string;
  confidentiality_class: 'PUBLIC' | 'BUYER_AUTHORIZED';
  result_binding_id: string;
}
```

The canonical `resource_ref` is a domain-separated SHA-256 over every field. It
names one finalized result transaction, not a service family. A
`payment_identifier`, quote, wallet, payer, or request bearer token is never a
resource identity.

At admission, before result bytes exist, the subject binding uses a narrower
immutable operation scope over
`operation_id + service_id + service_version + contract_release + confidentiality_class`.
At finalization, `ResultResourceV1` adds the result/artifact identities and
carries the already-created `result_binding_id`. This permits pre-execution
ownership binding without inventing the later PCC hash.

`confidentiality_class` is derived from the governed immutable service contract,
included in both canonical references, and revalidated against the policy input
before the public branch. A caller/protocol adapter cannot relabel document or
verify as public: a mismatch fails `POLICY_ERROR`.

## 8. Confidentiality classes

`RESULT_CONFIDENTIALITY_CLASS_VOCABULARY=[PUBLIC, BUYER_AUTHORIZED]`

Only the two classes with an immediate repository use are introduced:

| Service                     | Class              | Result-release effect                                                                  |
| --------------------------- | ------------------ | -------------------------------------------------------------------------------------- |
| `company_evidence_graph.v3` | `PUBLIC`           | Release does not require a principal. Payment/admission requirements remain unchanged. |
| `web_context_verified.v3`   | `PUBLIC`           | Same.                                                                                  |
| `document_evidence_json.v3` | `BUYER_AUTHORIZED` | Requires authenticated subject match or valid delegation.                              |
| `verify_agent_output.v3`    | `BUYER_AUTHORIZED` | Requires authenticated subject match or valid delegation.                              |

`AUTHENTICATED`, `ORGANIZATION_SCOPED`, and `SUBJECT_SCOPED` are not added now;
they do not have a necessary first-activation use. Organization and service
accounts are subject types, not new confidentiality classes.

## 9. Subject binding and creation point

`RESULT_SUBJECT_BINDING_MODEL=ResultSubjectBindingV1`

```ts
interface ResultSubjectBindingV1 {
  schema_version: 'result_subject_binding.v1';
  binding_id: string;
  operation_scope_ref: string;
  owner_subject_ref: string;
  binding_policy_version: 'result_binding_policy.v1';
  creation_authority: 'siteborne:request-admission';
  created_at: string;
  authority_context_id: string;
  policy_evaluation_id: string;
}
```

Creation point: on the authenticated, validated first paid submission, after the
replay classifier returns `first_seen`, atomically with operation/job creation
and before any provider invocation or execution. Quote creation is too early
because no authenticated caller currently exists there. Payment authorization is
the wrong authority. Result creation/finalization is too late because ownership
would be reconstructed after execution.

The binding is append-only and immutable. If creation cannot commit, execution
does not start. Finalization must reference the binding; it must not replace or
reinterpret the owner.

## 10. Payer, result subject, and delegation

`PAYER_RESULT_SUBJECT_RELATIONSHIP`:

```text
PayerEvidence != ResultSubject != DelegationEvidence
```

- Caller equals payer: still requires caller authentication and subject binding;
  equality may be observed separately.
- Caller differs from payer: permitted when the caller is the bound owner or a
  valid delegate.
- Organization pays, employee calls: bind the result to the authenticated
  employee or explicitly chosen organization subject; do not infer either from
  the payer.
- Service account pays, agent calls: agent requires its own subject match or a
  delegation.
- Sponsor pays for another principal: bind to the intended authenticated
  beneficiary.
- Anonymous public result: no subject binding required for release.
- Delegated caller: validate the explicit delegation against the owner and exact
  resource.

Payment evidence may be retained for economic audit but is not an input to the
buyer-authorized release predicate.

`RESULT_DELEGATION_MODEL=ResultAccessDelegationV1`

```ts
interface ResultAccessDelegationV1 {
  schema_version: 'result_access_delegation.v1';
  delegation_id: string;
  issuer_subject_ref: string; // must equal bound owner
  delegate_subject_ref: string; // must equal authenticated caller
  resource_ref: string; // exactly one finalized result
  permission: 'result:read';
  not_before: string;
  expires_at: string;
  issuance_authority: 'siteborne:delegation-registry';
  integrity_ref: string;
}
```

Delegation is required for human-to-agent, organization-to-service-account,
buyer-to-downstream-agent, and parent-agent-to-sub-agent access when the caller
is not the bound owner. V1 is result-specific, read-only, expiring, revocable,
and non-transitive. It is not a general IAM system. Contract-scoped delegation
is deferred until a real use requires it.

The evaluator treats this raw grant only as a candidate. Its server-owned
composition root closes over an immutable snapshot from the protected delegation
registry; the request cannot supply or replace that registry. The candidate must
exactly match an active authoritative record. The default evaluator closes over
an empty registry, so a caller-created object—even one claiming
`integrity_verified=true` or copying a verifier name—fails `DELEGATION_INVALID`.
Owner consent is established when the authenticated bound owner creates the
protected registry record; SITEBORNE records that policy evaluation and issuance
authority.

## 11. Deterministic release decision

`RESULT_RELEASE_DECISION_VOCABULARY=[MATCH, PUBLIC_RESULT, VALID_DELEGATION, NO_AUTHENTICATED_PRINCIPAL, SUBJECT_MISMATCH, SUBJECT_REVOKED, DELEGATION_INVALID, RESOURCE_MISMATCH, LEGACY_UNBOUND, POLICY_ERROR]`

The pure function is:

```ts
evaluateResultReleaseAuthorization({
  verified_principal,
  result_resource,
  subject_binding,
  confidentiality_class,
  delegation_evidence,
  policy,
}) -> { decision, resource_ref, policy_version, reason_codes }
```

It uses no LLM, provider, payment call, storage write, environment read, clock,
or randomness. `policy.evaluated_at` is an explicit input. Evaluation order is:

1. unsupported/malformed policy -> `POLICY_ERROR`;
2. policy/resource confidentiality mismatch -> `POLICY_ERROR`;
3. governed `PUBLIC` -> `PUBLIC_RESULT`;
4. buyer-authorized without binding -> `LEGACY_UNBOUND`;
5. operation scope or binding ID mismatch -> `RESOURCE_MISMATCH`;
6. no verified principal -> `NO_AUTHENTICATED_PRINCIPAL`;
7. current caller or bound-owner revocation -> `SUBJECT_REVOKED`;
8. caller equals bound owner -> `MATCH`;
9. no delegation -> `SUBJECT_MISMATCH`;
10. exact, unexpired, registry-verified, non-revoked delegation ->
    `VALID_DELEGATION`; otherwise `DELEGATION_INVALID`.

`BUYER_AUTHORIZED_RELEASE_PREDICATE`:

```text
confidentiality_class == BUYER_AUTHORIZED
AND confidentiality_class == result_resource.governed_confidentiality_class
AND verified_principal.status == VERIFIED
AND subject_binding.resource_scope matches result_resource operation scope
AND subject_binding.binding_id == result_resource.result_binding_id
AND verified_principal.subject is not currently revoked
AND (
  canonical_subject_ref(verified_principal.subject)
    == subject_binding.owner_subject_ref
  OR valid_result_specific_delegation(
       bound_owner,
       verified_principal.subject,
       result_resource,
       current_policy_time,
       current_revocation_state
     )
)
```

Payer evidence, wallet equality, payment receipt, payment identifier, MCP client
metadata, and PCC validity are deliberately absent.

## 12. Existence-oracle policy and public errors

`RESULT_EXISTENCE_ORACLE_POLICY`:

1. On buyer-authorized service endpoints, missing/invalid authentication is
   rejected before any result lookup with the service-level, existence-neutral
   `authentication_required` response.
2. After authentication, result-not-found, owner mismatch, resource mismatch,
   invalid/revoked delegation, sensitive legacy-unbound, revoked subject, and
   policy/data error all map to the same external `result_not_available` shape.
3. External errors contain no job state, result/artifact ID, PCC/hash, owner,
   payer/wallet, binding ID, or “belongs to another user” text.
4. Response size and cache headers are the same across post-auth denial cases.
   Lookup and comparison work should be padded/bucketed where practical; no
   exact constant-time claim is made for D1/R2.
5. Detailed reasons exist only in access-controlled internal telemetry.
6. Public-class results remain anonymous and do not use the protected-result
   locator semantics.

`RESULT_AUTH_ERROR_VOCABULARY=[authentication_required, result_authorization_required, result_not_available, invalid_delegation, authorization_policy_error]`

Protocol adapters may translate transport status, but must preserve the same
safe body code. `invalid_delegation` is suitable only at a delegation-creation
or validation endpoint where the caller already knows the grant; retrieval
collapses it to `result_not_available`.

## 13. Replay composition and initial/replay parity

```text
matching historical replay tuple
  -> locate existing operation/result (economic replay unchanged)
  -> build ResultAuthorizationContextV1
  -> evaluateResultReleaseAuthorization
  -> release exact persisted full PCC or return safe failure
```

```text
REPLAY_BINDING_DIGEST_CHANGE_REQUIRED=NO
```

`ReplayIdentity` remains economic/execution idempotency. It does not become a
subject. Caller identity is not added to the historical payment binding digest,
and replay classification is not modified by this design.

The initial successful response after execution must pass through the same
function and same resource/binding lookup as replay. Settlement completion or
fresh execution does not bypass result authorization.

```text
INITIAL_AND_REPLAY_AUTHORIZATION_MODEL_IDENTICAL=YES
```

Public result release is independent of caller identity, but not of existing
quote/payment/admission/execution rules. The result policy neither satisfies nor
removes those gates.

## 14. Machine, REST, MCP, and A2A principal models

`MACHINE_PRINCIPAL_MODEL`: represent a machine as `workload`, `service_account`,
or `agent`. Prefer the existing Cloudflare-verified mTLS fact for the first
activation. The canonical subject is issuer-qualified and bound to a certificate
SHA-256 thumbprint or registered key thumbprint where appropriate.
Certificate/key rotation may update credential binding while retaining the same
governed subject only through an explicit registry mapping; no automatic “same
organization” inference is allowed. Signed requests are the portable alternative
when mTLS is unavailable. Interactive OAuth is not required for autonomous
callers.

`REST_AUTHENTICATED_PRINCIPAL_MODEL`: an ingress authentication middleware
verifies either (a) OIDC JWT bearer evidence for human/enterprise principals or
(b) Cloudflare mTLS / a signed workload request for machines. It places only
`VerifiedPrincipalEvidence` in a typed request context. Raw credentials are not
forwarded into business handlers or persisted. API keys are deferred from the
minimum set because they add issuance/rotation/incident burden and lower
assurance.

`MCP_AUTHENTICATED_PRINCIPAL_MODEL`: the current remote MCP endpoint has no
authenticated principal. `clientInfo`, `_meta`, tool arguments, client name, and
client version remain untrusted. Add authentication at the HTTP transport
boundary before `createSiteborneMcpHonoApp` dispatch. The verified principal is
injected through a server-owned context and carried unchanged through the MCP
x402 adapter into the shared REST result-release context. Stdio MCP cannot claim
a remote caller; it needs an explicit host-attested local principal or must
remain unable to retrieve buyer-authorized results.

`A2A_AUTHENTICATED_PRINCIPAL_MODEL`: Agent Card provider identity and card JWS
identify SITEBORNE, not the caller. The repository's Cloudflare mTLS context is
the closest existing suitable input. A future A2A ingress must derive it only
from `request.cf.tlsClientAuth`, validate the configured CA/trust domain, map it
to a workload/agent subject, and inject verified evidence. Until that wiring and
production mTLS interface are qualified, A2A supplies no authenticated caller
for buyer-authorized release.

## 15. Internal authorization context

`RESULT_AUTHORIZATION_CONTEXT_SCHEMA`:

```ts
interface ResultAuthorizationContextV1 {
  schema_version: 'result_authorization_context.v1';
  principal: VerifiedPrincipalEvidence | null;
  resource: ResultResourceV1;
  confidentiality_class: 'PUBLIC' | 'BUYER_AUTHORIZED';
  subject_binding: ResultSubjectBindingV1 | null;
  delegation_candidate: ResultAccessDelegationV1 | null;
  binding_policy_version: string | null;
  release_policy_version: string;
  authority_context_id: string;
  policy_evaluation_id: string;
  evaluated_at: string;
}
```

The returned evaluation adds the closed decision and reason codes. This object
is internal. Public responses receive only the service output/PCC or the safe
error vocabulary, never subject/binding/delegation/policy internals.

## 16. Security Authority bridge

`SECURITY_AUTHORITY_RESULT_RELEASE_BRIDGE`:

```text
jobs.id (current operation)
  -> OperationID bridge
  -> AuthorityContextID (authenticated request context)
  -> PolicyEvaluationID (admission/binding evaluation)
  -> ResultBindingID (immutable owner binding)
  -> ResultReleaseDecision (initial and replay)
```

The minimum bridge stores opaque IDs/references only. It does not implement the
complete Security Authority hierarchy or grant model. Current `jobs.id` may be
used as `operation_id` during the bridge, but `AuthorityContextID`,
`PolicyEvaluationID`, and `ResultBindingID` must be newly generated,
domain-specific, and never aliases for a payment identifier.

## 17. Legacy and vNext migration

`LEGACY_RESULT_AUTHORIZATION_MODEL`:

- `LEGACY_PUBLIC_RESULT`: may be released only when the historical record has
  authoritative service/classification evidence proving it public.
- `LEGACY_UNBOUND_SENSITIVE_RESULT`: fail closed as `result_not_available`; do
  not infer an owner from payer, wallet, quote, identifier, or request tuple.
- Ambiguous legacy classification is sensitive and unbound.
- Historical records are not rewritten, backfilled, or re-signed.

The mission states that no production v3 result record exists. Therefore the new
subject binding and resource record can be mandatory from the first
buyer-authorized v3 operation without migrating live v3 rows:

```text
VNEXT_RESULT_BINDING_MIGRATION_REQUIRED=NO
```

Legacy v2 handling remains a separate conservative branch.

## 18. Storage and privacy

`RESULT_AUTHORIZATION_STORAGE_MODEL`:

Minimum additive durable state, to be designed as a future migration:

1. `result_subject_bindings`: `binding_id`, `operation_id`,
   `operation_scope_ref`, `owner_subject_ref`, `binding_policy_version`,
   `creation_authority`, `authority_context_id`, `policy_evaluation_id`,
   `created_at`.
2. `result_resources`: `result_id`, `operation_id`, `artifact_id`,
   `pcc_document_hash`, `service_id`, `service_version`, `contract_release`,
   `confidentiality_class`, `binding_id`, `created_at`.
3. `result_access_delegations` only when delegation is implemented:
   `delegation_id`, issuer/delegate subject refs, resource ref, permission,
   validity interval, integrity/reference metadata, revocation time.
4. A subject-status/credential registry or adapter-owned status lookup for
   revocation. Result tables store the stable subject reference, not a token or
   mutable profile.

Never persist raw OAuth bearer tokens, raw JWTs, passwords, API secrets, raw
gateway authorization headers, raw signatures, private keys, full identity
profiles, or email as a binding key. Raw JWT retention is not required.

```text
PCC_CONTAINS_CALLER_IDENTITY=NO
PCC_CONTAINS_RAW_AUTH_TOKEN=NO
PCC_CONTAINS_PRIVATE_AUTHORITY_STATE=NO
```

The PCC remains a public-verifiability object. Authorization metadata remains
internal and is not added to the PCC schema or signature preimage.

## 19. Revocation and policy versioning

`RESULT_ACCESS_REVOCATION_MODEL`: result cryptographic validity and current
retrieval permission are independent. An immutable owner binding remains true
historically while a current subject-status policy can deny a disabled subject.
Delegations have expiration and explicit revocation. Credential rotation does
not revoke the subject if the identity registry explicitly preserves the subject
mapping; compromise revokes the credential immediately, and may revoke the
subject when identity assurance is no longer sufficient. Organization membership
removal affects organization-issued delegation or subject status, not the PCC
signature.

`RESULT_AUTHORIZATION_POLICY_VERSION_MODEL`:

- `binding_policy_version` is immutable and records how ownership was created.
  Its meaning must remain reproducible.
- `release_policy_version` is evaluated at every delivery using current
  revocation and delegation state.
- Current policy may narrow release due to revocation or newly recognized
  invalid evidence. It may not silently reassign ownership or turn a legacy
  unbound sensitive result into a bound result.
- Every decision records both versions and evaluation time internally.
- Unsupported versions fail `POLICY_ERROR` and externally become
  `result_not_available`.

## 20. Privacy-preserving observability

`RESULT_AUTH_TELEMETRY_MODEL`:

Closed internal events:

```text
result_authentication_succeeded
result_authentication_failed
result_subject_match
result_subject_mismatch
result_delegation_match
result_delegation_invalid
result_legacy_unbound
result_release_succeeded
result_release_denied
result_policy_error
```

Allowed operational fields: event, protocol, service ID/version, confidentiality
class, decision/reason code, verifier ID, subject type, authentication method,
assurance level, binding/release policy versions, coarse latency bucket, request
correlation ID, and whether initial/replay. A protected audit store may carry
binding/delegation IDs when incident response requires them; general logs should
not.

Never log raw JWT/bearer/API key, raw signature, private user payload, email,
wallet as caller identity, subject ID, full subject hash, full PCC, result hash,
artifact reference, payment signature, or gateway authorization header.

## 21. Threat model

| Threat                                                          | Authenticate?                                                         | Locate?                                    | Release?                         | Existence disclosed?                                | Telemetry                                     | Decision/reason                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------ | -------------------------------- | --------------------------------------------------- | --------------------------------------------- | -------------------------------------------------- |
| A. Complete replay tuple, no authenticated identity             | No                                                                    | Not before auth on buyer service           | No                               | No; `authentication_required` is service-level only | auth failed, release denied                   | `NO_AUTHENTICATED_PRINCIPAL`                       |
| B. Payer retrieves result owned by another caller               | Independently authenticate payer-as-caller                            | Yes after auth                             | No absent owner match/delegation | No; generic unavailable                             | subject mismatch                              | `SUBJECT_MISMATCH`                                 |
| C. Principal guesses another result ID                          | Yes                                                                   | Constant-shape lookup                      | No                               | No                                                  | mismatch/not-found bucket without resource id | `RESOURCE_MISMATCH` or external unavailable        |
| D. Compromised gateway injects identity header                  | Intermediary/semantics verification fails or gateway trust is revoked | No                                         | No                               | No                                                  | untrusted intermediary                        | authentication failure                             |
| E. Valid gateway assertion replayed out of context              | Audience/freshness/nonce/channel binding fails                        | No                                         | No                               | No                                                  | audience/freshness failure                    | authentication failure                             |
| F. Delegation used after expiration                             | Caller authenticates                                                  | Yes                                        | No                               | No                                                  | delegation invalid                            | `DELEGATION_INVALID`                               |
| G. Service account retrieves employee result without delegation | Yes                                                                   | Yes                                        | No                               | No                                                  | subject mismatch                              | `SUBJECT_MISMATCH`                                 |
| H. Two users share one payment wallet                           | Each authenticates separately                                         | Yes                                        | Only bound subject/delegate      | No                                                  | match/mismatch, no wallet identity            | `MATCH` or `SUBJECT_MISMATCH`                      |
| I. API key leaks                                                | Attacker may authenticate as that service account until revoked       | Yes                                        | Potentially yes for that subject | No extra disclosure                                 | credential use anomaly, then revocation       | `MATCH` before revocation; `SUBJECT_REVOKED` after |
| J. JWT audience mismatch                                        | No                                                                    | No                                         | No                               | No                                                  | audience mismatch                             | authentication failure                             |
| K. JWT issuer mismatch                                          | No                                                                    | No                                         | No                               | No                                                  | untrusted issuer                              | authentication failure                             |
| L. Public result requested anonymously                          | Not required                                                          | Yes under normal admission/replay rules    | Yes                              | Public result is intentionally disclosed            | public release                                | `PUBLIC_RESULT`                                    |
| M. Legacy sensitive unbound result                              | Caller may authenticate                                               | Yes                                        | No                               | No                                                  | legacy unbound                                | `LEGACY_UNBOUND`                                   |
| N. Result hash/artifact reference leaks                         | Leak is not authentication                                            | Not through protected locator without auth | No                               | No additional metadata                              | denied retrieval attempt                      | `NO_AUTHENTICATED_PRINCIPAL` / mismatch            |

No attack was exercised against production.

## 22. Local reference model and test evidence

The local-only implementation is:

- `apps/edge-api/tests/support/result-authorization-reference-model.ts`
- `apps/edge-api/tests/result-authorization-design-reference.test.ts`

The first focused run failed because the reference module did not yet exist.
After implementing the minimum pure model and repairing the independent
reviewer's adversarial bypass findings, the focused run passed 28/28. The tests
cover all 20 required cases plus resource-scope mismatch, revoked delegation,
revoked delegation issuer/owner, integrity-unverified identity evidence,
issuer-qualified subject references, caller-controlled confidentiality
downgrade, simultaneous resource-and-policy relabeling, and forged delegation
evidence.

The model is test-only. It performs no network, provider, payment, D1, R2,
environment, clock, randomness, or production-route operation. Node SHA-256
creates non-secret resource references. The subject reference uses a visibly
test-only HMAC key and explicit key version solely to exercise the existing
Security Authority digest preimage and logical output tuple; production must use
the repository primitive with managed key injection/rotation. Neither primitive
verifies credentials.

```text
REFERENCE_TESTS=28/28
```

The repository-wide `pnpm test` gate was also run. It did not pass: 4 test files
reported 14 failures while 336 files / 4,477 tests passed and 22 files / 79
tests were skipped. The failures are outside this checkpoint's three changed
paths:

- eleven A2A metadata assertions still expect 8 skills while the current card
  carries 12 after the v3 candidate additions;
- two canonical URL projection assertions do not yet accept/publish the v3
  schema/resource URLs; and
- one isolated D1 reconciliation test exceeded its 5-second timeout during the
  aggregate run.

These aggregate failures are recorded, not repaired here: changing their
production/discovery scope would violate this checkpoint's result-authorization
boundary. The focused reference tests and Edge API typecheck are the applicable
local qualification evidence.

## 23. Minimum authentication set for first buyer-authorized v3 activation

`MINIMUM_V3_AUTHENTICATION_SET`:

1. OIDC JWT verifier for human/enterprise principals: exact issuer allowlist,
   audience, time claims, algorithm/key selection, stable `sub`, and optional
   proof-of-possession/key binding.
2. Cloudflare-verified mTLS workload adapter for machine/service/agent
   principals, reusing the repository's header-immune `request.cf.tlsClientAuth`
   primitive and an explicit CA-to-subject registry.
3. The shared `IdentityEvidenceVerifierV1 -> VerifiedPrincipalEvidence` boundary
   and protocol-neutral result policy.

A gateway assertion adapter is not required for initial direct activation; add
it only when Kong/Access is the selected ingress and the intermediary channel
and assertion semantics are qualified. Signed HTTP requests are the portable
machine fallback. API keys, wallet identity, and Nevermined identity are not in
the minimum set.

## 24. Bounded implementation phases

`RESULT_AUTH_IMPLEMENTATION_PHASES`:

1. Canonical subject, external-evidence verifier interface, OIDC verifier, and
   Cloudflare-mTLS workload adapter; no result release change.
2. Additive D1 schemas/repositories for immutable operation-scoped subject
   binding and finalized result resource; require them only for not-yet-active
   buyer-authorized v3.
3. Pure result-release policy engine, policy versioning, revocation inputs, and
   safe error projection.
4. REST request context plus MCP/A2A transport adapters; reject protocol
   metadata/header bypasses.
5. Route initial v3 response and cached replay through the identical policy;
   preserve historical replay digest/classification.
6. Privacy-preserving telemetry, oracle/timing checks, and incident/audit
   controls.
7. Local and non-production qualification, independent security review, then a
   separate human-authorized buyer-v3 activation checkpoint.

Delegation can be implemented in phase 3 or deferred if initial activation
explicitly supports only owner-subject match. If deferred, callers requiring
delegation remain denied; there is no implicit fallback.

## 25. Public contract and PCC impact

Authenticated buyer-authorized delivery requires public authentication contract
changes:

- OpenAPI: add security schemes and apply them only to buyer-authorized v3
  operations; keep public v3 operations anonymous.
- MCP: publish the remote transport authentication requirement/capability and
  ensure tool calls carry the server-owned verified context, not `_meta`
  identity.
- A2A: declare the active, truthful security scheme and apply a skill-level
  requirement only to buyer-authorized skills. Do not treat the x402 extension
  as authentication.
- Service metadata: state the result authentication requirement separately from
  payment/economic requirements.

The PCC body remains unchanged because identity and release policy are private
delivery controls, not proof contents.

```text
PCC_SCHEMA_CHANGE_REQUIRED_FOR_RESULT_AUTH=NO
PUBLIC_AUTH_CONTRACT_CHANGE_REQUIRED=YES
PAYMENT_SEMANTICS_CHANGE_REQUIRED=NO
```

Pricing, quote economics, amount, network, asset, payee, settlement semantics,
and economic replay binding remain unchanged.

## 26. Findings and activation gates

1. **P1 — no current authenticated principal path.** The design cannot activate
   buyer-authorized v3 until at least the minimum verifier/adapters and public
   contract are implemented and qualified.
2. **P1 — current replay and initial response do not enforce owner binding.**
   This checkpoint deliberately does not change them.
3. **P2 — existing mTLS support is dormant.** It is a strong implementation
   seam, not active protection.
4. **P2 — legacy sensitive rows are unbound.** Conservative denial is required;
   no payer-based backfill is valid.
5. **P2 — delegation is necessary for realistic agent workflows.** It may be
   deferred from the first owner-only activation, but must never be simulated by
   payer equality or shared credentials.

Result: `PASS_WITH_FINDINGS`. The design closes the conceptual gap and the
reference policy behaves as required locally, but production authentication,
storage, enforcement, contract publication, and activation remain a separate
checkpoint.

## 27. Independent review

Independent review must verify:

- identity/authentication remains separate from SITEBORNE authorization;
- payer/payment never becomes caller/owner;
- gateways supply evidence rather than authority;
- operation/result resource naming cannot collide with payment identity;
- binding occurs before execution and is immutable;
- delegation is exact-resource, expiring, integrity-verified, and revocable;
- replay binding remains unchanged;
- initial and replay release share one policy;
- legacy sensitive results fail closed;
- revocation changes permission, not PCC validity;
- no identity enters PCC/public proof;
- REST/MCP/A2A cannot bypass principal verification;
- machine callers do not require interactive OAuth; and
- external denial does not become a result-existence oracle.

The independent reviewer re-ran the 28-test focused suite and Edge API
typecheck, inspected the final three-artifact candidate, and specifically
searched for mission §39 attacks A-G. The reviewer found no remaining actionable
P0, P1, or P2 defect after the governed-class and protected-registry repairs.
Authentication/authorization separation, payer/caller separation, gateway trust,
exact resource naming, immutable binding, bounded delegation, replay separation,
initial/replay parity, legacy denial, revocation/PCC separation, privacy,
protocol portability, machine principals, existence-oracle handling, and
Security Authority compatibility all passed. The findings in §26 remain
activation prerequisites rather than defects in this local design.

`INDEPENDENT_REVIEW=PASS_WITH_FINDINGS`

## 28. Zero-mutation accounting

```text
SOURCE_BEHAVIOR_CHANGES=0
WORKER_UPLOADS=0
WORKER_DEPLOYMENT_MUTATIONS=0
PUBLIC_TRAFFIC_MUTATIONS=0
CONTINUATION_HOST_DEPLOYMENTS=0
ALERT_WORKER_DEPLOYMENTS=0
CLOUD_SECRET_MUTATIONS=0
PRODUCTION_D1_WRITES=0
REAL_PAYMENT_ATTEMPTS=0
```

No v3 activation, deployment, payment, production D1 mutation, replay behavior
change, production authorization enforcement, or push occurred.

## 29. Closure values

```text
RESULT_AUTHORIZATION_DESIGN_01=PASS_WITH_FINDINGS
RESULT_SUBJECT_MODEL=ResultSubjectV1 issuer-qualified pseudonymous principal
RESULT_CONFIDENTIALITY_CLASS_VOCABULARY=[PUBLIC,BUYER_AUTHORIZED]
REPLAY_BINDING_DIGEST_CHANGE_REQUIRED=NO
INITIAL_AND_REPLAY_AUTHORIZATION_MODEL_IDENTICAL=YES
VNEXT_RESULT_BINDING_MIGRATION_REQUIRED=NO
PCC_CONTAINS_CALLER_IDENTITY=NO
PCC_CONTAINS_RAW_AUTH_TOKEN=NO
PCC_CONTAINS_PRIVATE_AUTHORITY_STATE=NO
PCC_SCHEMA_CHANGE_REQUIRED_FOR_RESULT_AUTH=NO
PUBLIC_AUTH_CONTRACT_CHANGE_REQUIRED=YES
PAYMENT_SEMANTICS_CHANGE_REQUIRED=NO
NEXT_RECOMMENDED_CHECKPOINT=RESULT-AUTHORIZATION-ENFORCEMENT-01
```

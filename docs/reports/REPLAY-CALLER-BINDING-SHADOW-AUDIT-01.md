# REPLAY-CALLER-BINDING-SHADOW-AUDIT-01

Date: 2026-09-21  
Mode: security-authority shadow audit; local/ephemeral tests only  
Production mutation authority: none  
Result: `PASS_WITH_FINDINGS`

## 1. Executive answer

When SITEBORNE returns an existing result on replay, the caller is authorized by
**possession of the complete current replay tuple**, not by an authenticated
SITEBORNE identity and not by a freshly verified payer identity.

For the deployed Release-1 CDP routes, the effective result-release rule is:

1. the submitted body passes the frozen input schema and semantic gates;
2. the submitted `PAYMENT-SIGNATURE` decodes structurally;
3. its `accepted.extra.quote_id` selects a still-valid, server-issued D1 quote;
4. the accepted requirement matches that quote and route;
5. the client-supplied Payment Identifier passes only the upstream syntax/length
   rules;
6. the D1 `payment_attempts` row for that identifier has the exact immutable
   binding described below;
7. the existing job and finalized `x402_service_results` row can be
   reconstructed; and
8. for `duplicate_same`, the durable Workflow join settles (or, only when no
   Workflow instance/owner intent exists, the job is `DELIVERED`); for
   `already_consumed`, the payment attempt is already consumed; and
9. the payment attempt and quote are both still unexpired (defaults: 5-minute
   attempt TTL, 300-second quote TTL).

The duplicate branches return before `evidenceProvider.verify()`. They do not
check an authenticated principal, MCP caller identity, HTTP caller identity,
session, payer, wallet, authorization subject, or ownership of the result. The
model is therefore:

`RESULT_AUTHORIZATION_MODEL=REQUEST_TUPLE_POSSESSION`

This is economically and operationally idempotent, but it is not fully
caller-bound for result confidentiality.

## 2. Scope, provenance, and production correspondence

### Reporting lineage

- `git rev-parse HEAD` at audit start:
  `02a2102dc00d7def0b426b6e314b6e407ab42f06`
- Branch: `metadata-vcm-qualification`
- `git status --short` at audit start: empty
- This report and the characterization tests will be committed on this reporting
  lineage only, as a single local commit; nothing is pushed.

### Deployed public Worker source

- Public Worker version: `3b35f9e7-6fb8-47e4-acff-c5736eff6da6` at 100%
- Public rollback version: `369b4bf5-c2f7-4e05-8454-7f5514a3bd45` at 0%
- Source corresponding to the deployed public Worker:
  `182bfb5f4473c904ddaefb113f69a15979f68144`
- Continuation host: `9b1e9b10-beed-4ff3-914c-2221aada9b45` at 100%
- Settlement alert Worker: `465daf70-b3b7-4265-9d69-39cc02d890fe` at 100%

The deployed-source identity comes from the accepted production
activation/publication closure reports. It is not inferred from the current
documentation HEAD.

The following replay-critical blobs are byte-identical between deployed source
`182bfb5...` and reporting HEAD `02a2102d...`:

| File                                                             | Git blob at both revisions                 |
| ---------------------------------------------------------------- | ------------------------------------------ |
| `apps/edge-api/src/control-plane/routes/x402-service.ts`         | `f6775450bebbfa022b63ea517ca4b60862abb75d` |
| `packages/protocol-x402/src/replay/binding.ts`                   | `92a16ee8d40e9ba82809607239a95ee5d3ce7c9e` |
| `packages/protocol-x402/src/replay/idempotency.ts`               | `299f83e6b9a18e46a0ad85094302b139fcca21b3` |
| `packages/protocol-x402/src/identifier/payment-identifier.ts`    | `f3d58093a99801933fa2124d69fa560f224534d9` |
| `apps/edge-api/src/control-plane/repositories/d1/x402-quotes.ts` | `57f1c2cdcbb85b6e2b6108dbb31f741dc96ad0c0` |
| `apps/edge-api/src/control-plane/mcp/x402-mcp-adapter.ts`        | `a844c80abd46d37ce0ace959bdb51f857167af31` |
| `packages/protocol-mcp/src/server.ts`                            | `05a792e17f7a86c2c111ce1d0de15b2b5f7aa377` |

Between deployed source and reporting HEAD, the only non-test source files that
changed are `payment-attempts.ts` and `alerting/settlement-alert-sweep.ts`;
neither is replay-decision logic. `payment-attempts.ts` has one later change,
the already-qualified settlement-alert read-side projection. Its replay
acquisition, lookup, consumption, and binding mapping are unchanged; only
`listUnresolvedSettlements` and its linkage classification differ from
production source.

## 3. Concepts kept separate

| Concept                       | Current meaning                                                                       | Current use in replay release                                          |
| ----------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Request possession            | Ability to reproduce the exact service input                                          | Required indirectly through `request_input_hash`                       |
| Identifier possession         | Knowledge/control of the client-chosen Payment Identifier                             | Required, but not sufficient alone                                     |
| Payment authorization         | Signed x402 authorization supplied in `PAYMENT-SIGNATURE`                             | Structurally decoded on replay; not freshly cryptographically verified |
| Payer identity                | Optional provider-attested wallet/payer in verification or settlement evidence        | Not compared for replay release                                        |
| Authenticated caller identity | SITEBORNE-recognized principal/session                                                | Absent in Release 1                                                    |
| SITEBORNE execution authority | Successful provider verification plus route/workflow gates permitting first execution | Applied on first-seen execution only                                   |
| Result authorization          | Authority to receive an already-created result                                        | Implemented as complete replay-tuple possession                        |
| Result confidentiality        | Protection of returned result content from another caller                             | Not independently caller-bound                                         |

Payment authorization is not identity. A payment receipt is evidence of economic
completion, not a current caller credential. Execution authority is not
result-retrieval authority. The current code keeps several of these types
separate, but it does not yet model a distinct caller-bound result-authorization
subject.

## 4. End-to-end replay trace

### 4.1 HTTP entry and request binding

1. `createX402ServiceRoute` in
   `apps/edge-api/src/control-plane/routes/x402-service.ts` handles the paid
   POST.
2. It parses JSON, applies the frozen input validator, applies service
   semantic/mode gates, and computes `inputHash = hashPaymentObject(body)`.
3. With no payment carrier, it builds a deterministic quote using `buildQuote`
   in `packages/protocol-x402/src/quote/quote.ts`.
4. It builds a requirement using `buildExactPaymentRequirement` or
   `buildUptoPaymentRequirement`, persists both through
   `X402QuoteRepository.create`, and returns a 402 with:
   - the full official `PAYMENT-REQUIRED` carrier;
   - `quote_id` in the JSON body and requirement `extra`;
   - `requirement_id` in the JSON body; and
   - a declaration that Payment Identifier is required.

No caller authentication or payer identity exists at quote issuance.

### 4.2 MCP entry

1. `buildSiteborneMcpHandlers` in `packages/protocol-mcp/src/server.ts` extracts
   the official `_meta["x402/payment"]` carrier.
2. MCP constructs an informational `McpInvocationContext` containing only
   protocol version and optional client name/version.
3. `createMcpX402ServiceBoundary.execute` in
   `apps/edge-api/src/control-plane/mcp/x402-mcp-adapter.ts` intentionally names
   that argument `_context` and does not forward it.
4. The adapter constructs the same paid HTTP request and invokes the exact
   production REST route.

MCP `client_name` and `client_version` are client-supplied metadata, not an
authenticated principal, and they do not enter the replay binding or
response-release decision.

### 4.3 Payment carrier, quote, and identifier

For CDP:

1. `decodePaymentSignatureHeaderSafe` schema-decodes the payment carrier.
2. `accepted.extra.quote_id` selects a row using `X402QuoteRepository.getById`
   from `x402_quotes`.
3. `validatePaymentPayloadStructure` checks x402 version, scheme/network
   support, quote ID, route resource, quote expiry, amount, asset, network, and
   payee.
4. `parsePaymentIdentifier` extracts the official extension ID after syntax
   validation.
5. The route checks quote expiry again.

Validation performed: transport schema, server-issued quote existence,
quote/requirement/resource binding, expiry, Payment Identifier syntax.  
Validation skipped here: payment signature cryptographic validity, current payer
identity, authenticated caller identity, result ownership.

### 4.4 Immutable payment-attempt acquisition

The route constructs a v2 `PaymentAttemptBinding` and calls
`acquirePaymentAttempt` in `packages/protocol-x402/src/replay/idempotency.ts`.

`D1PaymentAttemptRepository.acquire` atomically inserts into `payment_attempts`;
uniqueness of `payment_identifier` is enforced by
`idx_payment_attempts_identifier`. On collision it reads the authoritative
existing row. `acquirePaymentAttempt` returns:

- `first_seen`: insert succeeded;
- `duplicate_same`: unconsumed, unexpired row and exact binding equality;
- `duplicate_conflict`: unconsumed, unexpired row but binding differs;
- `already_consumed`: existing row has `consumed_at`, before generic digest
  comparison;
- `expired`; or
- `repository_error`.

The route adds the necessary consumed-row safety check: `already_consumed`
releases nothing unless `bindingsAreIdentical(existing.binding, candidate)` is
true.

### 4.5 Existing/cached-result release

`reconstructFromJob` performs the durable lookup:

1. `jobsRepo.getByIdempotencyKey(paymentIdentifier)` in `jobs`;
2. for `duplicate_same`, the route first calls
   `driveDurableContinuation('repair_or_join')`; a `settled` Workflow result
   reconstructs with `requireDelivered: false`. The `DELIVERED` requirement
   applies only in the fallback when no owner intent/Workflow instance exists;
3. the already-authoritative `already_consumed` branch does not require
   `DELIVERED`;
4. `X402ServiceResultRepository.getByJobId(job.id)` in `x402_service_results`;
5. reject pending settlement-draft discriminants;
6. encode the cached settlement response into `PAYMENT-RESPONSE`; and
7. return `cached.body` at `cached.status`.

`duplicate_same` first joins/repairs the same deterministic Workflow instance
and may return that settled result; it never creates a second instance. If no
result exists yet, it returns `202 processing`.

`already_consumed` returns the finalized cached result if present, otherwise
`409 already_consumed`.

No duplicate branch calls `evidenceProvider.verify()`. No duplicate branch
checks a caller, session, payer, wallet, principal, or result owner.

### 4.6 First-seen path, for contrast

Only `first_seen` creates the job, calls `evidenceProvider.verify`, transitions
through payment verification, seals the exact payment/verification continuation
payload, persists the encrypted Workflow owner intent, and dispatches the
deterministic continuation Workflow. The Workflow executes, settles, creates the
PaymentServiceLink, persists the finalized `x402_service_results` row, and marks
the attempt consumed.

Therefore replay is economically joined to the original operation, but cached
result release does not re-run the first-seen authorization ceremony.

## 5. Exact replay binding tuple

For the two live Release-1 CDP services, the exact digest/comparison fields are:

`REPLAY_BINDING_FIELDS=[binding_version, payment_rail, payment_provider, nevermined_agent_id, nevermined_plan_id, nevermined_delegation_id, payment_identifier, quote_id, requirement_id, service_id, service_version, contract_release, request_input_hash, resource_id, scheme, network, asset, amount, payee, job_id, idempotency_key]`

Current CDP values use `binding_version=2`, `payment_rail=cdp`, canonical
versioned `payment_provider`, `nevermined_* = null`, and the route currently
supplies neither `job_id` nor a distinct `idempotency_key`, so both normalize to
`null`. Null normalization is part of the digest payload.

The request body is represented by its canonical `request_input_hash`; it is not
stored inline in `payment_attempts`.

Explicit exclusions:

`REPLAY_BINDING_EXCLUDES=[payer_wallet, payer_identity, authenticated_principal, MCP_caller_identity, MCP_client_name, MCP_client_version, HTTP_client_identity, authorization_subject, session_identity, signature_identity, IP_address, User-Agent, Cloudflare_request_metadata, raw_PAYMENT-SIGNATURE, raw_payment_signature_bytes, result_owner]`

## 6. Payment Identifier origin and entropy

`PAYMENT_IDENTIFIER_ORIGIN=CLIENT_CHOSEN`

SITEBORNE requires and parses the official x402 Payment Identifier extension.
The server route does not generate the identifier. The local generator wrapper
is documented and used only by buyer-side tests/fixtures.

Pinned upstream package behavior (`@x402/extensions` 2.21.0):

- minimum length: 16;
- maximum length: 128;
- allowed characters: ASCII letters, digits, underscore, hyphen;
- accepted pattern: `^[a-zA-Z0-9_-]+$`;
- the optional upstream helper uses `crypto.randomUUID`, but the validator does
  not require that helper;
- no randomness, uniqueness probability, UUID structure, prefix, or entropy test
  is performed;
- duplicates are not rejected generically: identical duplicates are replay,
  conflicting duplicates are conflict, consumed identical duplicates may receive
  the cached result.

Therefore:

- `PAYMENT_IDENTIFIER_ENTROPY_ENFORCED=NO`
- `PAYMENT_IDENTIFIER_PREDICTABLE_VALUES_ACCEPTED=YES`

The local characterization proves `aaaaaaaaaaaaaaaa` is valid and first-seen.

## 7. Quote/requirement disclosure and tuple obtainability

IDs are not secrets merely because they are IDs.

| Component                   | Classification                                             | Evidence and consequence                                                                                 |
| --------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `payment_identifier`        | client-chosen; returned-to-caller; potentially low entropy | Present in the payment carrier, processing response, and payment-response metadata; syntax only          |
| `quote_id`                  | returned-to-caller; deterministic; not secret              | 402 JSON and `PAYMENT-REQUIRED`; `qte_` plus 24 hex characters derived from quote binding hash           |
| `requirement_id`            | returned-to-caller; deterministic; not secret              | 402 JSON; `req_` plus 24 hex characters derived from requirement binding hash                            |
| request body/input          | caller-held; sensitivity varies; not automatically public  | Exact content is necessary to reproduce `request_input_hash`; `verify_agent_output` input may be private |
| `request_input_hash`        | durable-internal and derivable from exact input            | Stored in quote and payment attempt; not a confidentiality credential                                    |
| `service_id`                | public/derivable                                           | Public route and MCP tool metadata                                                                       |
| mode                        | public schema; caller-provided; derivable from body        | `standard` or `direct` for the live paid modes                                                           |
| quote/requirement wire body | returned-to-caller                                         | Necessary for a normal x402 retry; no secrecy promise                                                    |

`quote_id` and `requirement_id` are hash-derived identifiers, but both are
intentionally disclosed. The current authority is not a high-entropy
server-secret bearer capability. The hard-to-obtain element can be the exact
request input when it contains private caller material; that is data possession,
not identity.

## 8. Current result-release authorization

`RESULT_RELEASE_CURRENT_AUTHORIZATION=`

`valid_input(body) AND valid_structural_payment_carrier(payload) AND server_issued_unexpired_quote(payload.accepted.extra.quote_id) AND requirement_matches_quote_and_route(payload.accepted) AND valid_client_chosen_payment_identifier(id) AND exact_binding_match(existing_payment_attempt, candidate_binding(body, quote, requirement, id)) AND attempt_unexpired(default 5 min) AND ((duplicate_same AND (durable_join_settled OR (no_workflow_instance AND job.state=DELIVERED))) OR already_consumed) AND finalized_cached_result_exists(job.id)`

The joined durable Workflow reaches the same final reconstruction, and does not
add caller identity or payer comparison.

Time bound: expiry is checked before duplicate/consumed classification
(`idempotency.ts`), and an expired quote is rejected with `402 expired_quote`.
With default TTLs, cached release therefore works for roughly five minutes after
attempt acquisition or quote issuance; a stale replay does not receive the
result. This narrows the exposure window for finding P1-1 but does not remove
the absence of a caller-bound authorization subject.

`RESULT_AUTHORIZATION_MODEL=REQUEST_TUPLE_POSSESSION`

It is not `IDENTITY_BOUND`, `PAYER_BOUND`, or `SIGNED_REQUEST_BOUND`. It is also
not accurately described as `HIGH_ENTROPY_BEARER_CAPABILITY`, because the
Payment Identifier may be predictable and the other IDs are disclosed. A payment
carrier is present, but its cryptographic authorization is not reverified on the
cached branch.

## 9. Security-invariant comparison

| Invariant                                             | Result                | Concrete reason                                                                                                                                 |
| ----------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| payment authorization != identity                     | `SATISFIED`           | Types and first-seen gates keep payment evidence separate; code does not claim that payment is an authenticated SITEBORNE principal             |
| payment receipt != result authorization               | `PARTIALLY_SATISFIED` | Receipt alone does not release a result, but there is no separate result-authorization subject; tuple possession substitutes for it             |
| result existence != result authorization              | `PARTIALLY_SATISFIED` | Existence alone is insufficient because the full binding is required, but the successful predicate is possession-based rather than caller-bound |
| execution success != authorization to retrieve result | `PARTIALLY_SATISFIED` | Success alone is insufficient; nevertheless no independent caller authorization follows success                                                 |
| evidence != authority                                 | `SATISFIED`           | Evidence/PCC/payment-link objects are not accepted as caller identity; payer evidence is not consulted for replay release                       |
| results must be caller-bound                          | `NOT_SATISFIED`       | No authenticated caller subject or payer subject is compared before cached release                                                              |

## 10. Threat matrix

The table describes current source behavior. No production request was
performed.

| Scenario                                                             | New execution                                                                                                                          | New settlement              | Cached result                                                       | Result existence                                                                                  | Conflict                                 | DoS potential                                                                  |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| A. Knows only service and public request shape                       | No, without valid payment verification                                                                                                 | No                          | No                                                                  | No                                                                                                | No targeted conflict without an ID       | Generic unauthenticated 402/quote issuance load only                           |
| B. Guesses `payment_identifier`                                      | If unused, a structurally valid fake carrier can acquire the row before verification, but useful execution still fails at verification | No without valid payment    | No without exact original tuple                                     | Can distinguish allocated/conflicting identifier from unused after constructing a valid new quote | Yes for an existing differently-bound ID | Yes: predictable-ID squatting/reservation can deny later use of that chosen ID |
| C. Learns identifier but not original quote/requirement              | Same as B with a newly issued quote                                                                                                    | No without valid payment    | No                                                                  | Can probe identifier allocation through conflict classification                                   | Yes                                      | Identifier-targeted squatting/conflict pressure                                |
| D. Learns quote + requirement but not exact request body             | No replay execution of original                                                                                                        | No                          | No; current body hash conflicts with stored binding                 | If identifier is also known, conflict reveals mismatch/allocation, not result content             | Yes if ID known                          | Can induce conflict traffic; cannot retrieve the result                        |
| E. Obtains the full replay tuple from logs/browser/client compromise | No second execution                                                                                                                    | No second settlement        | Yes                                                                 | Yes                                                                                               | No for exact tuple                       | Confidentiality loss; economic side effects remain joined                      |
| F. Two independent callers intentionally use the same identifier     | One first owner only; same tuple joins, different tuple loses                                                                          | At most original settlement | Both receive same cached result if they use the same complete tuple | Yes                                                                                               | Different tuple receives conflict        | One caller can reserve/poison the shared identifier for the other              |
| G. Payer and replaying caller differ                                 | No second execution                                                                                                                    | No second settlement        | Yes if replaying caller possesses the tuple; payer is not compared  | Yes                                                                                               | Only if another bound field differs      | Confidentiality/caller-binding risk, not double charge                         |
| H. Proxy/integration replays another caller's complete request       | No second execution                                                                                                                    | No second settlement        | Yes                                                                 | Yes                                                                                               | No                                       | Cross-caller result disclosure is possible inside the integration boundary     |

Rows B/C note: the pre-verification acquire ordering (`acquirePaymentAttempt`
before `evidenceProvider.verify`) is source-confirmed.

Important nuance: the local test demonstrates that a different simulated caller
gets the cached result when it has the complete tuple. It does not prove that an
unaffiliated production attacker can currently obtain a real customer tuple.
That distinction controls severity.

## 11. Local adversarial characterization

Added tests:

- `packages/protocol-x402/src/replay/caller-binding-shadow-audit.test.ts`
- one route-level case in `apps/edge-api/tests/x402-service-route.test.ts`

Covered behaviors:

1. same tuple / same caller fields -> `duplicate_same` (classification only);
2. same tuple / different caller, payer, principal, and client fields injected
   through the real digest/classification path -> identical digest and
   `duplicate_same` (classification only; proves those fields are ignored, not
   just absent from the type); 2a. mutating each of the 21 bound fields changes
   the digest (pins `REPLAY_BINDING_FIELDS`);
3. same Payment Identifier / different input hash -> `duplicate_conflict`;
4. same Payment Identifier / different quote -> `duplicate_conflict`;
5. same Payment Identifier / different requirement -> `duplicate_conflict`;
6. different Payment Identifier / same input -> distinct `first_seen` operation;
7. predictable Payment Identifiers pass format validation;
8. duplicate client-chosen identifier + complete same tuple -> legitimate
   replay;
9. possession of the complete tuple returns the cached result without a second
   `verify()` call (route-level only).

The route-level test uses real local Miniflare D1, all migrations, a real Hono
route, fixture evidence, and an in-process continuation Workflow. Caller A
executes once; caller A replay, caller B replay, and a caller C replay with
different payload signature bytes all receive the identical cached body; the
route payment-verifier call count remains exactly one. Only the pure tests
classify; only the route test proves cached-result release. That test exercises
the finalized-replay path after the Workflow has completed, not solely a
`duplicate_same` classification.

Not test-proven: "no second settlement". In this fixture settlement runs through
the continuation Workflow's own provider, so the route-level provider wrapper
cannot count it. That conclusion is derived from source (consumed-state and
lifecycle guards), not asserted by a test.

Final focused result:

```text
Test Files  2 passed (2)
Tests       47 passed (47)   (9 pure characterization + 38 route)
```

An initial run had the existing route tests passing while eight of the pure
tests rejected their invalid fixture provider label. The fixture was corrected
to use canonical `CDP_PAYMENT_PROVIDER`; no production source was changed.
Independent review then replaced two initial caller tests that only restated
that the API has no caller parameter with tests that push caller/payer fields
through the real digest path, added the per-field digest test, and added the
different-signature route replay. The final clean run above is the qualification
result (initial 46 -> 47 tests).

## 12. Payer binding

Payer information exists in several places, but not as a mandatory replay
subject:

- `ExternalVerificationEvidence.payer` is optional.
- `ExternalSettlementEvidence.payer` is optional.
- The production facilitator cryptographically verifies the signed payment on
  the first-seen path and may return/attest the payer.
- Verified evidence and the signed settlement context are sealed into the
  AES-GCM Workflow continuation envelope stored in
  `payment_workflow_owner_intents.workflow_input_json`.
- The finalized cached result stores `settleResponse`, which may include payer,
  and durable settlement evidence, which may also include payer.
- `payment_attempts` has no payer column, and its binding digest has no payer
  field.
- The replay classifier does not open the owner-intent envelope and does not
  compare payer.
- `reconstructFromJob` reads the cached result to encode the response but does
  not treat cached payer as authorization.

Consequently:

- `PAYER_IDENTITY_AVAILABLE_FOR_SHADOW_COMPARE=PARTIAL`
- `HISTORICAL_REPLAY_BINDING_WOULD_CHANGE_IF_ADDED=YES`

Availability is partial because payer is optional/provider-attested, spread
across encrypted or result artifacts, and there is no trustworthy
replay-candidate payer check. Adding payer directly to `PaymentAttemptBinding`
would change digests and historical compatibility. Payer identity is also not
automatically authenticated SITEBORNE caller identity.

## 13. Authenticated caller identity

`CURRENT_AUTHENTICATED_CALLER_IDENTITY=absent`

- Paid HTTP routes do not establish a SITEBORNE principal/session for this
  decision.
- MCP client name/version is self-described invocation metadata, not
  authentication, and the production adapter discards it.
- IP, User-Agent, Cloudflare request metadata, payment authorization, and wallet
  ownership are not treated as authenticated SITEBORNE caller identity.
- No source-proven authorization subject reaches the replay branch.

## 14. Result sensitivity

### `verify_agent_output.v2 / standard`

Input can include arbitrary user-supplied `candidate_output`, verification
claims, supplied evidence content, required schema, allowed evidence sources,
and verification policy inputs. The returned PCC can expose derived conclusions,
requirement-level outcomes/details, evidence identifiers,
unsupported/conflicting counts, schema errors, limitations, hashes, and
receipt/provenance material. It need not echo the full candidate to disclose
derived private facts. Confidentiality impact is **high for private inputs**,
even though the public schema applies size/shape controls.

### `web_context_verified.v2 / direct`

The live mode targets public HTTP/HTTPS URLs. Output can include canonical text
or markdown up to large limits, structured extraction, final/redirect URLs,
selected HTTP metadata/headers, injection findings, source/content hashes,
freshness, and PCC provenance. The source content is intended to be public-only,
so intrinsic content confidentiality is lower; however, the buyer's target
choice, selectors/schema, timing, and paid evidence/economic metadata may still
be sensitive.

Overall:

`RESULT_CONFIDENTIALITY_IMPACT=MIXED`

This is not classified uniformly low because one live service directly analyzes
caller-supplied content and evidence.

## 15. Authority versus confidentiality

| Dimension                       | Result    | Reason                                                                                           |
| ------------------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| `ECONOMIC_REPLAY_SAFETY`        | `PASS`    | One D1 owner per identifier; exact binding; no second verify/settle on duplicate; consumed guard |
| `EXECUTION_REPLAY_SAFETY`       | `PASS`    | Same tuple joins the same deterministic Workflow/job; different tuple conflicts                  |
| `SETTLEMENT_REPLAY_SAFETY`      | `PASS`    | Durable lifecycle/CAS and consumed state prevent another settlement in the replay branch         |
| `RESULT_AUTHORIZATION_SAFETY`   | `FINDING` | Complete tuple possession substitutes for a caller-bound authorization subject                   |
| `RESULT_CONFIDENTIALITY_SAFETY` | `FINDING` | A different caller or proxy with the tuple receives the result; impact varies by service         |

Economic idempotency does not prove result confidentiality. Conversely, adding
result authorization later must not modify the accepted economic binding or
settlement identity.

## 16. Risk classification

### P0 findings: 0

No public-only path, identifier-only path, or quote-only path was found that
releases a cached result. No production customer payload was inspected, no
production replay was attempted, and no evidence shows an unaffiliated party
currently obtaining complete production tuples. The test proves the authority
weakness once the tuple is possessed; it does not establish a current production
breach.

### P1 findings: 1

1. **Cached results are not caller- or payer-bound.** A different caller with
   the complete tuple gets the existing result without re-verification. This is
   an architectural caller-binding/confidentiality-authority gap, not an
   economic-replay defect and not a demonstrated exploitable breach. It is
   meaningful hardening work, especially for `verify_agent_output`, and is not
   elevated to P0 without demonstrated realistic third-party tuple acquisition
   or a production breach. Exposure is time-bounded to roughly five minutes
   after acquire/quote issuance at default TTLs (section 8).

### P2 findings: 2

1. **Unauthenticated pre-verification acquire.** `acquirePaymentAttempt` runs
   before `evidenceProvider.verify`, so any party holding a valid quote and a
   structurally valid payment carrier can create `payment_attempts`/`jobs` rows
   and trigger facilitator verification calls without paying. This includes
   predictable-identifier squatting: an attacker who anticipates a client-chosen
   identifier can burn that one identifier and observe allocation via conflict
   classification. Impact is availability/resource and a per-identifier
   allocation oracle; the buyer simply chooses another identifier, the row
   expires with its TTL, and no useful execution, settlement, or cached-result
   release follows. This was rated P1 in the working draft and was recalibrated
   to P2 during independent review because it is neither a confidentiality nor
   an economic failure.
2. **Replay-security observability is incomplete.** Conflict/rejection is
   logged, but successful replay and cached-result release are not explicitly
   classified, and no caller/payer mismatch can be observed because no
   comparable subject exists.

## 17. Shadow-only ResultAuthorizationContext design

No enforcement is proposed in this checkpoint.

### Separate envelope

Introduce a future, additive `ResultAuthorizationEnvelopeV1` separate from:

- `PaymentAttemptBinding` and its digest;
- quote/requirement identity;
- PaymentServiceLink and PCC identity;
- settlement identity; and
- public response payload.

Conceptual fields:

```text
authority_version: 1
job_id
payment_identifier
payment_binding_digest
subject_kind: authenticated_principal | verified_payer | signed_request_subject | unavailable
subject_hash: HMAC(subject) | null
subject_evidence_kind: authenticated_session | facilitator_verified_payer | locally_verified_signature | none
subject_evidence_version
created_at
```

Never store raw subject values in shadow telemetry. Use a server-keyed HMAC with
key rotation/version metadata so wallet/principal identifiers cannot be
dictionary-correlated from logs.

### Deterministic shadow evaluator

For each successful current replay:

1. compute `current_decision` using the unchanged current predicate;
2. load the optional result-authorization envelope;
3. derive a replay candidate subject only from source-proven evidence:
   - authenticated SITEBORNE principal, if one exists in a future release;
   - a deterministically and cryptographically verified signed-request subject;
     or
   - a provider-verified payer only if the replay request proves current
     control, not merely claims the payer string;
4. compare closed-form subject kind/version/hash;
5. emit exactly one closed-vocabulary shadow outcome:
   - `match`,
   - `mismatch`,
   - `legacy_no_envelope`,
   - `candidate_subject_unavailable`,
   - `stored_subject_unavailable`, or
   - `evidence_invalid`;
6. return the current response unchanged in every case.

No LLM participates. No free-form subject, payload, signature, result, URL, or
evidence content is logged.

### Current SA-0 expectation

Because Release 1 has no authenticated caller and does not reverify payment on
replay, most current records should classify `legacy_no_envelope` or
`candidate_subject_unavailable`. That is an honest shadow baseline, not a reason
to manufacture authority from IP, User-Agent, MCP client metadata, or payment
evidence.

`SHADOW_RESULT_AUTHORIZATION_MODEL=unchanged current tuple predicate plus additive ResultAuthorizationEnvelopeV1 and deterministic closed-vocabulary subject comparison; observe only, never enforce`

## 18. Backward compatibility

Directly adding payer/principal fields to `PaymentAttemptBinding` is unsafe for
history: it changes binding digests, turns historical same-tuple replays into
conflicts, and conflates result authority with economic identity.

The bounded compatibility strategy is:

- `NEW_RESULT_AUTHORIZATION_ENVELOPE`;
- `FUTURE_REQUESTS_ONLY` for newly captured subject evidence;
- `DUAL_VERSION_BINDING` only within the separate result-authorization envelope,
  not the payment binding;
- `INTERNAL_ONLY` during SA-1 shadow; and
- historical rows classify `legacy_no_envelope` and retain current behavior.

Effects if incorrectly added to historical payment binding:

| Surface                        | Effect                         |
| ------------------------------ | ------------------------------ |
| existing paid records          | digest/field mismatch          |
| historical cached results      | replay compatibility break     |
| existing identifiers           | could become conflict/unusable |
| replay compatibility           | changed                        |
| PCC identity                   | should remain unchanged        |
| payment-attempt binding digest | would change                   |
| quote identity                 | should remain unchanged        |
| settlement identity            | should remain unchanged        |

An eventual enforced caller nonce/auth carrier may be a public-contract change,
but shadow storage and telemetry need not be.

## 19. New retrieval route

`NEW_RESULT_RETRIEVAL_ROUTE_REQUIRED=NO`

The existing paid POST already handles first execution, in-flight join, and
finalized replay. A stronger result-authorization context can be evaluated at
that same boundary. Creating a GET/result endpoint would add a second public
attack surface and duplicate authorization semantics without solving subject
establishment.

## 20. Replay-security observability

| Event/question                        | Current observability                                                    | Gap                                               |
| ------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------- |
| normal replay                         | Partial: structural `payment_payload_received`; no accepted-replay event | Cannot count completed replay release directly    |
| replay conflict                       | Yes: `payment_replay_rejected` with closed reason                        | Adequate for conflict class                       |
| same identifier from multiple callers | No                                                                       | No authenticated/stable caller subject to compare |
| cached result release                 | No explicit event                                                        | Reconstruction return is silent                   |
| payer mismatch                        | No                                                                       | Payer not part of replay candidate/decision       |
| caller mismatch                       | No                                                                       | Caller identity absent                            |
| already-consumed result missing       | Yes: closed rejection reason                                             | Adequate for failure class                        |

`REPLAY_SECURITY_OBSERVABILITY=` the matrix above.

Recommended future telemetry, shadow-only and privacy-preserving:

- `replay_class = duplicate_same | already_consumed`
- `result_release = cached | joined_workflow | processing | missing`
- `shadow_authority = match | mismatch | legacy_no_envelope | candidate_subject_unavailable | stored_subject_unavailable | evidence_invalid`
- `subject_kind = authenticated_principal | verified_payer | signed_request_subject | unavailable`
- versioned keyed pseudonymous correlation only where necessary

Do not log raw input, input hash as a cross-system tracking key, raw Payment
Identifier, raw quote/requirement, wallet, signature, authorization header,
result, or URL.

## 21. SA-0 refinement and SA-1 readiness

SA-0 baseline:

- result binding: exact economic/request binding plus job/result state, no
  caller subject;
- replay authority: complete tuple possession;
- payer evidence: optionally available after first verification/settlement, not
  a replay authority;
- caller identity: absent;
- economic identity: payment attempt binding and PaymentServiceLink,
  intentionally separate from result authority;
- confidentiality: service-dependent and not fully protected against
  cross-caller tuple replay.

`SECURITY_AUTHORITY_SA1_RESULT_SHADOW_READY=YES`

SA-1 is safe only as a no-enforcement shadow checkpoint using a separate
authorization envelope and closed-vocabulary comparisons. It must not alter
response selection, payment binding, execution, settlement, PCC, or historical
replay.

## 21a. Independent review

A separate reviewer read the source, the deployed-source blob lineage, the
tests, and this report.

- Verdict: `PASS_WITH_FINDINGS`; `REVIEW_RECOMMENDS_RUNTIME_CHANGE=NO`.
- Confirmed: the 21-field binding list matches the v2 digest payload exactly;
  duplicate branches return before `verify()`; no caller/payer/principal check
  exists in the replay or cached-release path; acquire precedes verify; all
  seven section 2 blob hashes are correct; the shadow design is deterministic,
  non-enforcing, evidence-based, and grants no authority to an LLM.
- Addressed in this checkpoint (test/report only): the `duplicate_same`/
  `DELIVERED` predicate wording; the omitted attempt/quote expiry bound; the P1
  identifier-squatting severity (recalibrated to P2); two vacuous pure caller
  tests (replaced); coverage-overclaim wording; the different-signature route
  replay; the "committed" wording; and an explicit note that "no second
  settlement" is source-derived rather than test-proven.
- Not changed: production behavior. Any hardening is deferred to separately
  governed checkpoints.

## 22. Mutation accounting

The only repository changes in this checkpoint are characterization tests and
this report.

```text
SOURCE_BEHAVIOR_CHANGES=0
PUBLIC_CONTRACT_CHANGES=0

WORKER_UPLOADS=0
WORKER_DEPLOYMENT_MUTATIONS=0
PUBLIC_TRAFFIC_MUTATIONS=0
CONTINUATION_HOST_DEPLOYMENTS=0
ALERT_WORKER_DEPLOYMENTS=0
CLOUD_SECRET_MUTATIONS=0
PRODUCTION_D1_WRITES=0
REAL_PAYMENT_ATTEMPTS=0
```

No Cloudflare command, production replay, real payment, or production D1
operation was run.

## 23. Final classification

```text
REPLAY_CALLER_BINDING_SHADOW_AUDIT_01=PASS_WITH_FINDINGS

CURRENT_AUTHENTICATED_CALLER_IDENTITY=absent
PAYER_IDENTITY_AVAILABLE_FOR_SHADOW_COMPARE=PARTIAL

ECONOMIC_REPLAY_SAFETY=PASS
EXECUTION_REPLAY_SAFETY=PASS
SETTLEMENT_REPLAY_SAFETY=PASS
RESULT_AUTHORIZATION_SAFETY=FINDING
RESULT_CONFIDENTIALITY_SAFETY=FINDING
RESULT_CONFIDENTIALITY_IMPACT=MIXED

P0_FINDINGS=0
P1_FINDINGS=1
P2_FINDINGS=2

HISTORICAL_REPLAY_BINDING_WOULD_CHANGE_IF_ADDED=YES
NEW_RESULT_RETRIEVAL_ROUTE_REQUIRED=NO
SECURITY_AUTHORITY_SA1_RESULT_SHADOW_READY=YES
```

Next bounded checkpoint:

`SECURITY-AUTHORITY-SA1-RESULT-SHADOW-ENVELOPE-DESIGN-01`

That checkpoint should freeze only the internal envelope schema,
subject-evidence admissibility rules, privacy-preserving telemetry vocabulary,
and deterministic shadow evaluator contract. It must not implement enforcement
or change Release-1 responses.

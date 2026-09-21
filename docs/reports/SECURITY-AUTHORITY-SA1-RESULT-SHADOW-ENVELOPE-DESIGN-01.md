# SECURITY-AUTHORITY-SA1-RESULT-SHADOW-ENVELOPE-DESIGN-01

Status: `PASS_WITH_FINDINGS` (one new P2 design finding, no new P0/P1). Mode:
shadow design and local model only. No production behavior, contract, or cloud
change.

Input: `REPLAY-CALLER-BINDING-SHADOW-AUDIT-01`, final commit
`d6f31b69039a422f55b5af966a2133ffce1a70cc`. Source claims about Release-1
payer/caller evidence are carried from that audit (which was independently
reviewed and source-cited); this checkpoint did not re-open replay source and
changed none of it.

Implementation: `packages/vcm/src/security/result-authorization-shadow.ts` (the
existing canonical shadow-authority package `@siteborne/vcm`, next to the
security declaration). Tests: `result-authorization-shadow.test.ts` (29 tests).
No second security authority was created. Nothing in `protocol-x402` changed.

## 1. Constitutional invariants

| Invariant                                | How this design preserves it                                                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| authentication != authorization          | An authenticated-caller slot is _evidence_. The comparator returns a description, never a verdict.                                              |
| identity != trust                        | Only `VERIFIED_EVIDENCE` on both sides is comparable; unverified claims yield `INSUFFICIENT_EVIDENCE`, never MATCH or MISMATCH.                 |
| payment authorization != identity        | A payer match alone can never produce `MATCH` (`PAYER_MATCH_WITHOUT_AUTHENTICATED_SUBJECT`).                                                    |
| payment receipt != result authorization  | The payer axis is separate from authority-bearing axes.                                                                                         |
| execution authority != commit authority  | Not touched; output is consumed by nothing.                                                                                                     |
| result existence != result authorization | Existence of a result (`result_ref`) is an identity check only.                                                                                 |
| evidence != authority                    | `AUTHORITATIVE` is not an admissible slot class; an envelope claiming it is `ERROR`. Vocabulary contains no ALLOW/DENY/AUTHORIZED/UNAUTHORIZED. |
| PCC != permission                        | PCC is not an input.                                                                                                                            |

## 2. ResultAuthorizationEnvelopeV1 schema

`RESULT_AUTHORIZATION_ENVELOPE_SCHEMA` (internal only, additive, never a
replacement for `PaymentAttemptBinding`):

| Field                                   | Type                                    | Security purpose                                                                                                                             |
| --------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `envelope_version`                      | `result_authorization_envelope.v1`      | Schema gate; unknown versions classify `ERROR`, never guessed.                                                                               |
| `policy_version`                        | `result_authorization_shadow_policy.v1` | Which comparison policy the evidence was captured under; unknown -> `ERROR`.                                                                 |
| `job_id`                                | opaque id                               | Operation identity: which job's result this envelope concerns.                                                                               |
| `payment_identifier_digest`             | 64-hex digest                           | Correlates to the attempt **without storing the Payment Identifier**, which is a bearer capability under the current tuple-possession model. |
| `payment_binding_digest`                | 64-hex digest                           | References the existing 21-field replay digest unchanged; detects an envelope attached to a different binding.                               |
| `result_ref`                            | opaque id                               | Result identity. Release 1: `x402_service_results` is keyed 1:1 by `job_id`.                                                                 |
| `result_content_digest`                 | 64-hex or `null`                        | Optional tamper/identity check on result content. **Not persisted in Release 1** (see §3); `null` on either side is not a mismatch.          |
| `subjects.payer_subject`                | slot                                    | Economic-side evidence about who paid.                                                                                                       |
| `subjects.authenticated_caller_subject` | slot                                    | Future authenticated SITEBORNE principal; ABSENT in Release 1.                                                                               |
| `subjects.request_signer_subject`       | slot                                    | Future locally-verified signature over the replay request; ABSENT in Release 1.                                                              |
| `evidence_captured_at`                  | ISO string                              | Forensic ordering. Carried; the comparator never reads a clock.                                                                              |
| `authority_refs?`                       | opaque optional ids                     | Reserved future references (§16). Ignored by the comparator.                                                                                 |

A **subject slot** is `ABSENT` or
`PRESENT{evidence_class, subject_digest, digest_key_version}`: `subject_digest`
is a 64-hex keyed pseudonymous digest (never the raw wallet/principal),
`digest_key_version` pins the key so digests are only compared within one key
version.

Deliberately **not** included: raw wallet, signatures, authorization headers,
payment payloads, request bodies, quote/requirement bodies, IP, user agent, MCP
client name/version, PCC, settlement transaction, runtime-qualification
reference. Quote/requirement subject evidence was considered and omitted: the
binding digest already covers quote/requirement identity, and the audit found no
quote-issuance subject (no caller authentication exists at quote time). Runtime
qualification is a deployment property, not per-result evidence.

`CurrentReplayContext` (comparator input, all values already known to the replay
branch): `predicate` (existing idempotency outcome), `job_id`,
`payment_identifier_digest`, `payment_binding_digest`, `result_ref`,
`result_content_digest`, `candidate_subjects`. In Release 1 every candidate slot
is ABSENT.

## 3. Evidence classification

| Field                            | Class                                                    | Persisted today?                    | At replay?                                                    | Notes                                                                                   |
| -------------------------------- | -------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `job_id`                         | AUTHORITATIVE (SITEBORNE-internal id)                    | Persisted (`jobs`)                  | AVAILABLE                                                     | Identifies, does not authorize.                                                         |
| `payment_identifier_digest`      | DERIVED_EVIDENCE                                         | Not persisted as a digest           | AVAILABLE (derivable from presented id)                       | Presented identifier is caller-supplied; the digest is computable, not new evidence.    |
| `payment_binding_digest`         | DERIVED_EVIDENCE                                         | Persisted (`payment_attempts`)      | AVAILABLE                                                     | Existing digest, referenced not changed.                                                |
| `result_ref`                     | DERIVED_EVIDENCE (`= job_id`)                            | Persisted (`x402_service_results`)  | AVAILABLE                                                     |                                                                                         |
| `result_content_digest`          | ABSENT                                                   | Not persisted                       | NOT_AVAILABLE_AT_REPLAY                                       | Would be DERIVED_EVIDENCE if computed at result persist time. Not a Release-1 source.   |
| `payer_subject` (stored side)    | VERIFIED_EVIDENCE when facilitator-attested, else ABSENT | Partially (see §8)                  | Stored side reachable only by opening sealed/cached artifacts | Optional in facilitator output; not a column.                                           |
| `payer_subject` (candidate side) | ABSENT                                                   | Ephemeral (first-seen request only) | NOT_AVAILABLE_AT_REPLAY                                       | Replay does not re-verify payment; a claimed payer string would be UNVERIFIED_EVIDENCE. |
| `authenticated_caller_subject`   | ABSENT                                                   | n/a                                 | NOT_AVAILABLE_AT_REPLAY                                       | No authenticated principal exists (§9).                                                 |
| `request_signer_subject`         | ABSENT                                                   | n/a                                 | NOT_AVAILABLE_AT_REPLAY                                       | No request-signing scheme exists.                                                       |
| `evidence_captured_at`           | DERIVED_EVIDENCE                                         | n/a (new)                           | n/a                                                           |                                                                                         |
| `authority_refs`                 | NOT_APPLICABLE                                           | n/a                                 | n/a                                                           | Reserved names only.                                                                    |

Every slot class inside the model is `VERIFIED_EVIDENCE` or
`UNVERIFIED_EVIDENCE`. `AUTHORITATIVE` is excluded on purpose.

## 4. Subject model

`RESULT_AUTHORIZATION_SUBJECT_MODEL`:

| Subject                        | Meaning                                                                   | Release 1                            |
| ------------------------------ | ------------------------------------------------------------------------- | ------------------------------------ |
| `payer_subject`                | Who the facilitator says paid (wallet-derived)                            | PARTIAL (stored side only, optional) |
| `authenticated_caller_subject` | A cryptographically authenticated SITEBORNE principal                     | ABSENT                               |
| `request_signer_subject`       | Signer of the replay request itself                                       | ABSENT                               |
| `economic_subject`             | Reserved: party bearing economic liability if it ever diverges from payer | Not modeled (no source)              |
| `result_subject`               | Reserved: who a result is _for_ (owner)                                   | Not modeled (no source)              |

A wallet is a `payer_subject` and is never a SITEBORNE caller. Only
`authenticated_caller_subject` and `request_signer_subject` are
authority-bearing axes in the comparator. `economic_subject` and
`result_subject` are reserved names, not V1 slots, to avoid inventing identity
with no source. No synthetic identity is created for absent subjects.

## 5. Shadow decision vocabulary

`SHADOW_DECISION_VOCABULARY=[MATCH, MISMATCH, INSUFFICIENT_EVIDENCE, NOT_APPLICABLE, LEGACY_UNBOUND, ERROR]`

| Value                   | Meaning (descriptive only)                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `MATCH`                 | Same operation/result identity, no comparable mismatch, and at least one authority-bearing subject matched.                        |
| `MISMATCH`              | Envelope refers to a different operation/binding/result, or a comparable subject differs. Dominates a match on another axis.       |
| `INSUFFICIENT_EVIDENCE` | An envelope has subjects but the replay side cannot supply comparable, verified, same-key-version evidence, or only payer matched. |
| `NOT_APPLICABLE`        | Existing predicate is not a cached-result release (first_seen, conflict, expired, repository_error).                               |
| `LEGACY_UNBOUND`        | No envelope, or an envelope with no stored subjects: the result was never subject-bound (Release-1 baseline).                      |
| `ERROR`                 | Malformed/unsupported context or envelope. Never thrown; never MATCH.                                                              |

Intentionally absent: ALLOW, DENY, AUTHORIZED, UNAUTHORIZED. A test asserts no
classification or reason code contains those terms (or GRANT/PERMIT).

Closed reason codes (25, emitted in canonical order, deduplicated):
`CURRENT_PREDICATE_NOT_RESULT_RELEASE, MALFORMED_REPLAY_CONTEXT, NO_ENVELOPE, MALFORMED_ENVELOPE, UNSUPPORTED_ENVELOPE_VERSION, UNSUPPORTED_POLICY_VERSION, MALFORMED_SUBJECT_SLOT, ENVELOPE_OPERATION_MISMATCH, ENVELOPE_PAYMENT_BINDING_MISMATCH, ENVELOPE_PAYMENT_IDENTIFIER_MISMATCH, RESULT_IDENTITY_MISMATCH, STORED_SUBJECTS_ABSENT, PAYER_SUBJECT_MISMATCH, AUTHENTICATED_CALLER_SUBJECT_MISMATCH, REQUEST_SIGNER_SUBJECT_MISMATCH, PAYER_SUBJECT_MATCH, AUTHENTICATED_CALLER_SUBJECT_MATCH, REQUEST_SIGNER_SUBJECT_MATCH, PAYER_MATCH_WITHOUT_AUTHENTICATED_SUBJECT, PAYER_CANDIDATE_ABSENT, AUTHENTICATED_CALLER_CANDIDATE_ABSENT, REQUEST_SIGNER_CANDIDATE_ABSENT, SUBJECT_EVIDENCE_UNVERIFIED, SUBJECT_KEY_VERSION_INCOMPARABLE, NO_AUTHORITY_BEARING_SUBJECT_COMPARED`.

## 6. Pure deterministic comparator

`evaluateResultAuthorizationShadow(currentReplayContext, envelope)` accepts
`unknown` for both (so malformed persisted data becomes `ERROR`, not an
exception) and returns only
`{classification, reason_codes, evidence_completeness, axes, policy_version, envelope_version}`,
frozen.

Evaluation order (first hit wins):

1. context malformed -> `ERROR`
2. predicate not `duplicate_same`/`already_consumed` -> `NOT_APPLICABLE`
3. envelope null/undefined -> `LEGACY_UNBOUND (NO_ENVELOPE)`
4. envelope malformed / unsupported version / bad slot -> `ERROR`
5. job, binding digest, identifier digest, result ref/content digest differ ->
   `MISMATCH` (structural identity)
6. all stored subjects ABSENT -> `LEGACY_UNBOUND (STORED_SUBJECTS_ABSENT)`
7. per-axis compare; both must be `VERIFIED_EVIDENCE` and the same key version,
   else `INCOMPARABLE`
8. any comparable mismatch -> `MISMATCH`; else authority-bearing match ->
   `MATCH`; else `INSUFFICIENT_EVIDENCE`

`evidence_completeness`: `COMPLETE` when payer and authenticated-caller axes
were both compared; `PARTIAL` when any axis was compared; `NONE` otherwise.

It has no imports, no clock, no randomness, no I/O, no environment, no LLM, no
provider, no storage, no settlement. A test scans the source for these tokens.

## 7. Expected Release-1 outcomes

`EXPECTED_RELEASE1_SHADOW_OUTCOMES` (candidate slots all ABSENT):

| Scenario                                                            | Outcome                 |
| ------------------------------------------------------------------- | ----------------------- |
| first-seen request                                                  | `NOT_APPLICABLE`        |
| binding conflict / expired / repository error                       | `NOT_APPLICABLE`        |
| legacy `duplicate_same` replay, no envelope (all current records)   | `LEGACY_UNBOUND`        |
| legacy `already_consumed` replay, no envelope                       | `LEGACY_UNBOUND`        |
| envelope present with no stored subjects                            | `LEGACY_UNBOUND`        |
| envelope backfilled with facilitator payer, replay has no candidate | `INSUFFICIENT_EVIDENCE` |

Release-1 traffic never yields `MATCH`, `MISMATCH`, or `ERROR` (tested). The
model does not manufacture failure because Release 1 predates result binding.
The realistic Release-1 steady state is overwhelmingly `LEGACY_UNBOUND`.

## 8. Payer evidence for result shadow

`PAYER_EVIDENCE_FOR_RESULT_SHADOW` (source claims carried from audit §12):

| Evidence                                                        | Where it exists                                           | Persisted                                                                                                                                                       | Survives replay                                                 |
| --------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Facilitator-verified payer (`verification.payer`)               | Verification evidence at first-seen; optional field       | Sealed only, inside the AES-GCM Workflow continuation envelope (`payment_workflow_owner_intents.workflow_input_json`)                                           | Not opened by the replay classifier                             |
| Settlement payer (`settleResponse.payer`, `settlement.payer`)   | Settlement result / durable settlement evidence; optional | Persisted in cached result and settlement evidence                                                                                                              | Present in the cached artifact; not compared, not authorization |
| Wallet/address in the signed payment payload                    | Client-supplied `PAYMENT-SIGNATURE`                       | Raw payload not persisted outside the sealed continuation envelope (audit: "signed settlement context" is sealed; exact payload retention not re-verified here) | Not available to the replay path                                |
| Provider identity (`verifier_identity`, `facilitator_identity`) | Verification/settlement evidence                          | Persisted with evidence                                                                                                                                         | Survives; identifies the facilitator, not the payer             |
| Raw signature                                                   | Request header                                            | Not persisted outside the sealed envelope                                                                                                                       | Never exposed; never enters the shadow model                    |
| `payment_attempts` payer column                                 | Does not exist                                            | No                                                                                                                                                              | n/a                                                             |

Consequence: a stored `payer_subject` slot could be **derived** later from
already-persisted settlement evidence without changing retention, but Release 1
has **no replay-side candidate payer** because replay does not re-verify. This
is exactly why payer match alone is `INSUFFICIENT_EVIDENCE` and why payer
availability is `PARTIAL`. Raw signatures and payloads are never carried.

## 9. Authenticated caller evidence

`AUTHENTICATED_CALLER_EVIDENCE_FOR_SHADOW` (claims carried from audit §13):

| Candidate source                         | Cryptographically authenticated SITEBORNE principal? | Usable as `authenticated_caller_subject`? |
| ---------------------------------------- | ---------------------------------------------------- | ----------------------------------------- |
| IP address                               | No                                                   | No                                        |
| User-Agent                               | No                                                   | No                                        |
| Cloudflare request metadata              | No                                                   | No                                        |
| MCP `client_name`/`client_version`       | No (self-described; discarded by adapter)            | No                                        |
| `payment_identifier`                     | No (a bearer capability)                             | No                                        |
| Payment authorization / wallet ownership | No (payment != identity)                             | No; payer axis only                       |
| Any paid-route session/principal         | None exists                                          | n/a                                       |

Confirmed: **no current protocol path provides an authenticated principal**.
`authenticated_caller_subject` is ABSENT in Release 1 and is not invented.

## 10. Historical compatibility and storage

The envelope modifies none of: the replay digest, `payment_attempts` binding,
historical quotes/requirements, PCC identity, settlement identity, result
identity. It references the binding digest; it does not join it.

`SHADOW_STORAGE_RECOMMENDATION`: **`DERIVED_ON_DEMAND` for SA-1, promoted to
`ADDITIVE_INTERNAL_RECORD` only when a candidate-side subject source exists.**
Reasoning: today the candidate side is always ABSENT and the stored payer is
derivable from already-persisted settlement evidence, so a stored envelope would
be nearly all `LEGACY_UNBOUND` and add a table and retention surface with no
evidence value. `EPHEMERAL_ONLY` is rejected as the long-term shape because
stored-vs-candidate comparison needs a durable stored side. No migration is
added or proposed in this checkpoint.

## 11. Privacy / minimization

`RESULT_SHADOW_DATA_MINIMIZATION=PASS`

- Subjects are keyed pseudonymous 64-hex digests with a key version; raw wallets
  (e.g. `0x`+40 hex) are rejected as malformed (tested), not stored.
- Payment Identifier stored only as a digest.
- No signature, authorization header, payment payload, request body, IP, user
  agent, or wallet metadata field exists in the schema; extra fields injected
  into an envelope are ignored by parsing and cannot reach telemetry (tested).
- Reasons are closed codes; no free text.

## 12. Telemetry design

`SHADOW_TELEMETRY_SCHEMA`: events `result_shadow_match`, `_mismatch`,
`_legacy_unbound`, `_insufficient_evidence`, `_not_applicable`, `_error` (six;
`not_applicable` is added to the five suggested because `NOT_APPLICABLE` is a
distinct classification).

Record fields, allowlisted:
`event, classification, reason_codes, evidence_completeness, axes, policy_version, envelope_version, job_id`.
`projectResultShadowTelemetry(evaluation, jobId)` receives only the closed
evaluation and a job id (null unless it matches the opaque-id shape). It never
receives envelope/context content, so subject digests, payment identifiers,
signatures, results, IP, user agent, and headers cannot enter (tested with
injected sentinels). This is an in-memory projection only; **no emitter exists
and none was wired.**

## 13. Test evidence

29 tests in `result-authorization-shadow.test.ts`, covering directive cases A-N
plus additional trust rules:

- A-C, F, J, Release-1 matrix: outcomes and completeness as in §7.
- D, E, H, I: payer/caller/result-identity mismatch dominate matches.
- G: 12 malformed envelope shapes (non-object x3, empty object, wrong version,
  wrong policy, bad digest, empty id, raw wallet as digest, `AUTHORITATIVE`
  class, missing slot, bad key version) plus malformed contexts, all `ERROR`,
  none throws.
- K: deep-frozen inputs are unchanged; output carries no release field;
  non-release predicates are `NOT_APPLICABLE`.
- L, M: repeatability incl. key-order independence; vocabulary snapshot;
  canonical reason ordering; forbidden authority words absent.
- N: telemetry allowlist and sentinel non-leakage; job id shape filter; 1:1
  classification to event mapping.
- Extra: unverified evidence never MATCH/MISMATCH; key-version-incomparable;
  request-signer axis supports MATCH.

**Non-vacuity.** Writing the non-interference scan initially exposed a real
defect in my own test: the file-count counter was never incremented, so the
"scanned > 200 files" assertion failed with 0. After fixing it, planting a
reference to the envelope in `packages/protocol-x402/src/` and
`apps/edge-api/src/` made 2 gate tests fail; removing the plants restored 29/29.
The scan now also skips symlinks.

Gates: `packages/vcm` vitest 22 files / 262 tests pass (includes the 29 new);
`protocol-x402/src/replay` 62/62 pass (unchanged); `tsc --noEmit` on
`packages/vcm` rc=0; eslint on touched files clean; prettier clean; secret scan
of touched files clean. No broad-suite load flake was encountered. The full repo
test suite was not run: only `packages/vcm` and the replay tests were exercised,
since no other package changed.

## 14. Formal non-interference gate

Structural claims, each enforced by a test:

1. The module imports nothing and uses no
   clock/random/crypto/fetch/process/console.
2. No file under `packages/`, `apps/`, `services/`, `scripts/` (other than the
   module and its test) references the module, comparator, projection, or
   `ResultAuthorizationEnvelopeV1`.
3. It is not re-exported from `security/index.ts` or the vcm barrel.
4. `protocol-x402` non-test source does not mention it.
5. `edge-api`, `protocol-mcp`, `protocol-a2a`, `mcp-server` sources do not
   mention it.

Therefore its output cannot reach HTTP or MCP response release, payment
admission, execution, provider invocation, commit, PCC, settlement, result
persistence, or reconciliation: it has no caller.

`SHADOW_RESULT_USED_FOR_ENFORCEMENT=NO` `SHADOW_RESULT_USED_FOR_EXECUTION=NO`
`SHADOW_RESULT_USED_FOR_SETTLEMENT=NO`

Limit of this proof: it is a source-text guarantee at this commit. A future
wiring checkpoint must replace, not weaken, this gate.

## 15. Public contract

The envelope appears in no MCP, A2A, OpenAPI, catalog, PCC, HTTP response, or
public metadata; the source scan above covers those sources.
`PUBLIC_SECURITY_METADATA_CHANGED=NO`, `PUBLIC_CONTRACT_CHANGES=0`. The existing
security declaration was not modified.

## 16. Future authority reference model

`authority_refs` reserves four opaque, optional names, unused by the comparator:

- `operation_id` - the OperationID the result belongs to; would supersede using
  `job_id` as the operation identity.
- `authority_context_id` - the AuthorityContextID under which the result was
  produced/released.
- `policy_evaluation_id` - the PolicyEvaluationID of the evaluation that bound
  (or would bind) the result.
- `result_binding_id` - the ResultBindingID tying the result to its subject and
  operation.

They are references, not embeddings; their encoding, derivation, and signatures
are intentionally undefined here so this checkpoint does not pre-empt the
Security Authority hierarchy. Comparators must treat unknown reference fields as
inert.

## 17. SA-2 enforcement prerequisites

`SA2_ENFORCEMENT_PREREQUISITES` (not scheduled; all must hold first):

1. A real authenticated caller identity (or verified request-signing scheme)
   producing `authenticated_caller_subject` with `VERIFIED_EVIDENCE`.
2. A ratified payer/caller relationship policy (may payer != caller retrieve?
   delegated agents?).
3. A backward-compatibility rule for `LEGACY_UNBOUND` records (which are ~all
   current ones): explicit grandfathering or expiry, decided before any deny
   path exists.
4. Historical record handling with no digest change; any backfill additive.
5. Service confidentiality classification per capability (audit §14) so
   enforcement severity is proportionate.
6. Measured SA-1 shadow data: a stable, near-zero false-`MISMATCH` rate on
   legitimate retries, with `INSUFFICIENT_EVIDENCE` explained.
7. Operational observability: the telemetry in §12 emitting and dashboarded,
   plus alerting for `ERROR`.
8. Migration strategy for a stored envelope (§10) including key rotation.
9. A key-management design for subject digests (`digest_key_version`).
10. A fail-open/fail-closed decision for comparator `ERROR` and a rollback plan.

## 18. Findings

Carried forward, not reopened: `P0=0, P1=1, P2=2`.

New design finding:

- **NEW P2 - No durable result content digest.** Release 1 persists no result
  content hash, so `result_content_digest` is unavailable and a future
  stored/replayed result cannot be integrity-checked against what was originally
  bound. Not exploitable on its own (results are not user-mutable), but SA-2
  result binding is weaker without it. Remediation is a future additive capture
  at result-persist time; not done here.

`NEW_P0_FINDINGS=0`, `NEW_P1_FINDINGS=0`, `NEW_P2_FINDINGS=1`.

Design caveat (not a finding): the payer axis alone can never yield `MATCH`.
This is deliberate but is a policy choice that SA-2 prerequisite 2 must ratify.

## 19. Change boundary and mutation accounting

Source files added: `result-authorization-shadow.ts`,
`result-authorization-shadow.test.ts`, this report. Existing files modified:
none. `SOURCE_BEHAVIOR_CHANGES=0` (nothing imports the new module).

No worker upload, deployment, traffic, host, alert-worker, secret, D1, or
payment action was performed. Nothing was pushed.

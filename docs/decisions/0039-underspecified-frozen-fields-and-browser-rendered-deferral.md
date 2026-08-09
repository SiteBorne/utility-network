# SITEBORNE Utility Network — ADR 0039: Underspecified Frozen-Field Interpretations and Browser-Rendered Deferral (SUN-0600)

## Context

Two frozen input/output contracts leave a real ambiguity SUN-0600 had to resolve
without modifying the frozen schemas: (1) `web_context_verified.v1` input's
`retrieval_mode` enum includes `rendered`, a capability this increment cannot
implement without live Cloudflare Browser Rendering credentials; (2)
`verify_agent_output.v1` input's `verification_contract.claims[]` objects have
no explicit JSON-path/field selector, only
`claim_id`/`predicate`/`expected_value`/`tolerance`.

## Decision

**Browser-rendered mode.** `web-context/service.ts` checks
`input.retrieval_mode === 'rendered'` before touching any dependency and returns
`result_class: 'dependency_unavailable'` with a truthful limitation string
naming Browser Rendering as the blocked_external dependency — it never falls
back to a direct-mode fetch under the `rendered` label (that would misrepresent
what was actually retrieved). `service.test.ts` and
`scripts/verify-fixtures.ts`'s `web-rendered-mode-dependency-unavailable`
scenario both assert the underlying HTTP client's call count stays `0` for this
path, proving direct and rendered modes cannot be confused with each other even
by accident.

**`verification_contract.claims[].claim_id` as a field selector.**
`agent-verification/claim-evaluation.ts::evaluateClaim` interprets `claim_id` as
the top-level property name to read from `candidate_output`
(`candidateOutput[claim.claim_id]`). This is a deliberate, documented reading of
an underspecified frozen field — not a schema mutation, since no property of the
frozen schema was added, removed, or retyped. It should be revisited if a future
contract revision adds an explicit path/field selector; until then, buyers
constructing a `verification_contract` should name each claim's `claim_id` after
the exact top-level `candidate_output` property it checks.

**`deterministic_requirements[].check` coverage.** Of the six frozen `check`
enum values (`schema_valid`, `hash_match`, `signature_valid`,
`evidence_resolves`, `no_pii`, `no_secrets`), this increment implements
`schema_valid` (a real, per-request ajv compile against the buyer-supplied
`required_schema`) and `hash_match` (a real SHA-256 comparison against a
caller-supplied `parameters.expected_hash`) genuinely. The remaining four are
recognized by the input schema but return a failed, explicitly
`unverifiable_assertions`-flagged result rather than a silent pass —
`service.ts::evaluateDeterministicRequirement`'s default branch. This mirrors
the same truthful-underimplementation discipline used for
`company_evidence_graph.v1`'s unimplemented field groups (ADR 0037) and document
evidence's `upload_reference`/`document_url` input modes.

## Status

Accepted (SUN-0600). Implementing `signature_valid`/`evidence_resolves`/
`no_pii`/`no_secrets`, live Browser Rendering, and a genuine
`upload_reference`/`document_url` document intake path are all future
increments, not silently claimed here.

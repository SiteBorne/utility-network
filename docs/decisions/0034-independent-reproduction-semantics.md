# SITEBORNE Utility Network — ADR 0034: Independent Reproduction Semantics (SUN-0500)

## Context

`schemas/proof-carrying-context.schema.json`'s `contract_mode` enum includes
`offline_verification`, and `governance/VERIFICATION_POLICY.yaml` declares an
`independent_reproduction.required_for: ['verify_agent_output.v1']` policy — the
frozen contract surface anticipates a verification mode where a candidate's
claims are checked against an independently reproduced result, not merely
against its own cited evidence. `reproduction_verifier` (ADR 0030) implements
this mode. SUN-0500 does not perform any live reproduction (no credentials, no
external calls, no Modal — that remains SUN-0400B/future scope); it defines the
verifier's contract and decision semantics so a future increment can supply a
real reproduction source without changing this boundary.

## Decision

`ReproductionVerifier` takes a `ReproductionInput | null` at construction time —
the caller (not the verifier) is responsible for producing the reproduction
result, keeping SUN-0500 independent of _how_ reproduction is performed (a
second worker run, a cached historical result, a different provider — all out of
scope here).

Its `verify()` behavior is mode-gated, not input-gated:

- In `standard` mode, it returns `status: 'skipped_by_policy'` regardless of
  whether a `ReproductionInput` was supplied — reproduction is simply not
  applicable outside `independent_reproduction` mode, and `mesh.ts`'s
  mandatory-verifier set for `standard` mode does not include
  `reproduction_verifier` at all (see ADR 0031), so a `skipped_by_policy` result
  here can never affect the standard-mode decision.
- In `independent_reproduction` mode with `reproduction: null`, it returns
  `status: 'fail'`, `severity: 'blocking'`,
  `failure_codes: ['reproduction_unavailable']`. This is the specific invariant
  the directive's "never invent nine arbitrary verifiers" note and the "one
  mandatory deterministic failure ... cannot be overruled" note both bear on
  together: a caller cannot silently request `independent_reproduction` mode and
  have the mesh quietly fall back to standard-mode semantics when no
  reproduction source is actually available — that would defeat the purpose of
  requesting the stronger mode in the first place. `indeterminate` was
  deliberately rejected for this case (it would only force `conditional`, not
  `fail` — see ADR 0031) because "reproduction mode requested but impossible to
  perform" is a deterministic, known failure, not an ambiguous one.
- In `independent_reproduction` mode with a `ReproductionInput` supplied, each
  candidate claim with a matching `claim_id` in the reproduction set is compared
  via `compareNormalized` — exact identity for primitives, set equality
  (order-independent) for arrays, deep JSON equality otherwise. Decimal-string
  values compare as strings, never coerced through floating point. Any mismatch
  is a blocking finding (`code: 'reproduction_mismatch'`); the verifier's
  `score` is `matched / compared` and only informs the reported metric, not the
  pass/fail decision (which is `fail` the moment any mismatch exists).

## Status

Accepted (SUN-0500). Supplying a real, non-null `ReproductionInput` from an
actual second execution is out of this increment's scope.

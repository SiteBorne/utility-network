# SITEBORNE Utility Network — ADR 0031: Non-Voting, Fail-Closed Mesh Aggregation (SUN-0500)

## Context

The SUN-0500 directive states explicitly: "A key design constraint for this
phase is that a 'mesh' should not become a voting system. Verification should be
dependency-aware and fail-closed: one mandatory deterministic failure must
remain a failure regardless of how many other verifiers pass." This directly
constrains how `packages/verification/src/mesh.ts::runMesh` may aggregate the
eight (or nine, in `independent_reproduction` mode) verifier results into one
`VerificationDecision`.

## Decision

`runMesh` never computes a score-based or count-based majority. The decision
algorithm is:

1. Compute the verifier execution order as dependency "waves"
   (`graph.ts::computeWaves`) — verifiers within a wave have no edge between
   them and run in parallel via `Promise.all`; each wave only depends on results
   from earlier waves. This makes the mesh dependency-aware without making
   dependency success a vote either: a verifier only _runs_ after its
   dependencies, but a passing dependency does not make a downstream verifier
   more likely to pass — each verifier's own logic still fails closed
   independently.
2. Any of the following forces the decision away from `pass`, unconditionally:
   - a mandatory verifier ID from `governance/VERIFICATION_POLICY.yaml`'s
     `required_verifiers[mode]` list is absent from the supplied verifier set
     (`missing_mandatory_verifier:<id>`);
   - a mandatory verifier's result has `status: 'fail'` and
     `severity: 'blocking'`;
   - a mandatory verifier's result is `indeterminate` or `skipped_by_policy`
     when the verifier is mandatory for the active mode (forces `conditional`,
     not `pass`).
3. If any mandatory verifier had a blocking failure, the decision is
   `quarantined` when the prompt-injection verifier's result is `confirmed`,
   else `fail`. Both are non-`pass` decisions distinguished only by injection
   severity, never adjusted based on how many _other_ verifiers passed.
4. Only when none of the above triggers does the decision become `pass`. The
   numeric `score` field (an average of the four scored dimensions — evidence
   accessibility, freshness, completeness, cross-source agreement) is populated
   _after_ the decision is already fixed at `pass`, and is `0` for any
   non-`pass` decision — the score can never retroactively change a
   `fail`/`conditional`/`quarantined` decision to `pass`, closing off the one
   place a numeric aggregate could otherwise smuggle in vote-like behavior.

`packages/verification/src/tests/mesh.test.ts` and
`src/tests/properties.test.ts` both assert this directly: a stub set with 7 of 8
verifiers passing and 1 mandatory blocking failure still produces `fail` (never
`pass`), and a fast-check property sweeps every combination of
pass/blocking-fail across the 8 mandatory verifier slots, asserting the decision
is `pass` if and only if zero of them had a blocking failure.

## Status

Accepted (SUN-0500).

# Independent Reproduction Mode (SUN-0500)

See [ADR 0034](../decisions/0034-independent-reproduction-semantics.md) for full
rationale. This document is the operational summary.

## What it is

A second verification mode
(`VerificationContext.mode: 'independent_reproduction'`), required by
`governance/VERIFICATION_POLICY.yaml`'s
`independent_reproduction.required_for: ['verify_agent_output.v1']`, in which
`reproduction_verifier` becomes a ninth mandatory verifier that compares the
candidate's claim values against an independently supplied reproduction result.

## Scope of this increment

SUN-0500 defines the verifier's contract and fail-closed semantics only. It does
**not** perform any live reproduction — no second worker invocation, no external
call, no Modal. `ReproductionVerifier` is constructed with a
`ReproductionInput | null` supplied by the caller; producing a real, non-null
`ReproductionInput` (by re-running the original extraction, or by any other
means) is out of scope and left to a future increment.

## Behavior contract

| Mode                       | `reproduction` supplied? | Result                                                                                                 |
| -------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `standard`                 | any                      | `skipped_by_policy` — not mandatory in this mode                                                       |
| `independent_reproduction` | `null`                   | `fail`, blocking, `reproduction_unavailable` — never silently falls back to standard-mode verification |
| `independent_reproduction` | `ReproductionInput`      | claim-by-claim comparison; any mismatch is a blocking `reproduction_mismatch` finding                  |

The `null`-input case is deliberately `fail`, not `indeterminate` — requesting
the stronger mode and getting no reproduction source is a known, deterministic
failure, not an ambiguous one, so it must force the mesh decision to `fail`
rather than merely `conditional` (see ADR 0031's mandatory-indeterminate vs.
mandatory-blocking-failure distinction).

## Value comparison

`compareNormalized` (`src/verifiers/reproduction-verifier.ts`): exact identity
for primitives; order-independent set equality for arrays; deep JSON-structural
equality otherwise. Decimal-string claim values (e.g. monetary amounts) always
compare as strings — never coerced through floating point.

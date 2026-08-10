# SITEBORNE Utility Network — ADR 0040: Runtime Receipt-Verification Boundary (SUN-0600 closure)

## Context

A SUN-0600 closure pass
(`test(services): verify receipts across all local services`, commit `5525f31`)
added real `verifyReceipt()` coverage for every service's successful path via a
shared boundary function, `verifyServiceReceipt()`
(`src/pcc/receipt-verification.ts`), delegating entirely to
`@siteborne/verification`'s own `verifyReceipt()`.

A follow-up audit found that coverage proved only that a _test_ could call
`verifyServiceReceipt()` on a receipt a service had already returned — not that
the runtime execution boundary itself (`executeLocalService(...)` ->
`service.execute(...)` -> `verifyAndSign(...)`) refused to report `success` when
the receipt it had just issued failed cryptographic verification. Every service
computed its `result_class` purely from `signed.verdict.decision`, which
`verifyAndSign` set from the mesh's verdict alone — the receipt's own
cryptographic validity was never itself a precondition for `success`.

## Decision

`verifyAndSign()` (`src/pcc/verify-and-sign.ts`), the one shared finalization
step every service calls directly and identically, now self-verifies the receipt
it just issued immediately after `issueReceipt()`, using the same
`verifyServiceReceipt()` boundary every test already used — never a second
Ed25519 implementation:

```
draft -> mesh verdict -> issueReceipt() -> verifyServiceReceipt(receipt, keyRegistry, ...)
                                                    |
                                     invalid -----> forces verdict.decision = 'fail'
                                     valid   -----> verdict unchanged
```

`VerifyAndSignParams` gained a required `keyRegistry: KeyRegistry` — the
registry the caller's `signer` is (or, for a deliberately-broken test fixture,
is not) registered in. Every one of the four services' `Deps` interfaces gained
a matching `keyRegistry: KeyRegistry` field, threaded identically to how
`signer` already was; `wiring.ts::buildFixtureRegistry` threads one shared
`keyRegistry` to all four services it constructs.

Because every service derives `result_class` from `signed.verdict.decision`
(pre-existing code, unchanged), forcing the verdict itself to `'fail'` when the
receipt fails self-verification means **no service-specific code had to change
its success/failure decision logic** — the enforcement is entirely concentrated
in the one shared step, satisfying "do not duplicate this logic across four
services if one finalizer can enforce it."

`VerifyAndSignResult` gained `receiptCryptographicallyValid: boolean` and
`receiptVerificationStatus: string` for introspection/testing, and a synthetic
entry (`receipt_cryptographic_verification_failed: <status>`) is appended to the
frozen PCC `verification.deterministic_failures` array on failure, so the reason
is visible in the returned document, not just silently swallowed.

This boundary is reached both by `executeLocalService(...)` (the dispatcher)
**and** by calling any service's `execute()` directly — the self-check lives
inside `verifyAndSign`, which every service's `execute()` calls itself, not
merely inside the dispatcher wrapper. There is no service-specific path that can
report `success` without passing through it.

## Consequences

- The runtime invariant now holds: `success` implies frozen output AND valid PCC
  AND passing mesh AND a receipt that cryptographically self-verifies against
  the registry the signer's key is (supposed to be) registered in.
- Proven by a parameterized runtime failure-injection test
  (`src/tests/receipt-verification.test.ts`) across all four registry services:
  a signer whose key doesn't match its declared registry entry, and a key
  registry that doesn't contain the signing key, both force
  `result_class: 'internal_verification_failed'` — never `success`.
- A genuine runtime _context_ mismatch (wrong `service_id`/`contract_release`
  reaching the self-check) cannot be manufactured through normal service
  execution, since `verifyAndSign`'s self-check derives its expected values
  directly from the same candidate that was just signed — self-consistent by
  construction. That failure mode is proven at `verifyServiceReceipt()`'s own
  unit level instead (`src/pcc/receipt-verification.test.ts`), the exact same
  function the runtime self-check calls.
- No production key custody is implemented here or anywhere in this package (see
  ADR 0033) — `keyRegistry` in this increment is always a fixture-only registry
  built by `createFixtureSigner()`/`buildFixtureRegistry()`.

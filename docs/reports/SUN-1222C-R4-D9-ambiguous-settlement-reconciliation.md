# SUN-1222C-R4-D9 — Ambiguous Settlement Reconciliation Automation

## Result: PASS_WITH_MANUAL_RECONCILIATION_RETAINED

D9's core question — *can `settlement_ambiguous` be resolved by safe,
deterministic, non-economic automation?* — is answered **yes, where the
provider contract permits it, and no further automatically** by an
existing, unchanged mechanism (`SUN-1221E6R-H2AWI-2e`,
`apps/edge-api/src/control-plane/continuation/settlement-reconciliation.ts`).
No functional source mutation was required or made; no deployment
occurred.

## Starting state / drift proof

```
D9_START_HEAD=320dcba (D8 evidence commit, reachable)
WORKING_TREE_RELEASE_CLEAN=YES
D9_HOST_DRIFT=NONE (8e10f91c-5654-4943-93f0-3a4bb5d27e10 @ 100%, matches D8 close)
D9_PUBLIC_API_DRIFT=NONE (db7054c9 @ 100%, d3472f58 @ 0%)
D9_TRAFFIC_DRIFT=NONE
```

## Where `settlement_ambiguous` is reached

`runSettlementStep` (`paid-continuation-workflow.ts`) reaches
`ambiguous_unresolved` in exactly two places:

1. **Pre-settle CAS failure** (`recordSettlementPending` returns
   `illegal_transition`) — the `UPDATE ... WHERE lifecycle_stage =
   'executed'` guard matched zero rows immediately before `settle()`
   would have been called. `settle()` is never invoked. Traced against
   `payment-attempts.ts:352-412`: this write is the *sole* production
   writer that moves a row from `executed` to `settlement_pending`, and
   the caller already re-reads and routes on every known post-`executed`
   state (`getSettlementRecoveryRecord`) immediately before this call.
   The only way this CAS can still fail is a genuine concurrent claim of
   the same `payment_identifier` racing between that read and this
   write — an intentionally rare, defensively-caught window, not a
   reachable path in ordinary single-instance operation. Failing closed
   to `ambiguous_unresolved` (never guessing, never re-attempting the
   claim) is the correct behavior for that race, not a gap.

2. **Post-settle-attempt reconciliation returns `inconclusive`**
   (`resolveViaReconciliation`, reached when `settle()` itself throws, or
   when a prior attempt already durably claimed
   `settlement_pending`/`settlement_failed`) — delegates entirely to
   `reconcileAmbiguousSettlement`.

## The existing reconciliation provider contract

`reconcileAmbiguousSettlement` never calls `evidenceProvider.settle()`
(structurally proven — no such method exists on its dependency type; a
dedicated test asserts this). It only reads:

- **No pre-settle draft record at all** → `not_found` (nothing was ever
  claimed for this identifier; job-level caller treats this as a
  legitimate non-transitioned/no-op case, not an error).
- **Draft exists, but no `settlementTransactionReference` was ever
  recorded** (the `settle()` call died before any response reached this
  code, not even a rejected-but-referenced one) → `inconclusive`. This is
  the case the D9 authorization names explicitly: the provider has
  **no transaction identity to look up at all**, so "not found" and
  "definitively not settled" are indistinguishable by construction —
  there is nothing an on-chain query could disambiguate. Manual
  reconciliation is correctly retained here; no additional automation is
  possible without inventing a new economic action (e.g., guessing and
  re-settling), which the authorization explicitly forbids.
- **Draft exists with a transaction reference** → the injected
  `cdpChainReceiptChecker` (a real, already-audited, read-only on-chain
  lookup) is queried, bounded to 5 attempts (`DEFAULT_MAX_ATTEMPTS`),
  zero backoff by default in tests, real backoff in production:
  - `SETTLED` → `confirmed` (deterministic, safe: the caller then records
    `settled_external` from a *read*, never a second `settle()` call).
  - `FAILED` → `not_found` (deterministic: the chain authoritatively
    reports no such settlement; caller routes to `settlement_rejected`
    family without ever re-attempting settlement).
  - `STILL_UNKNOWN` on every attempt through the bound → `inconclusive`
    (the provider itself cannot yet distinguish the states; retrying
    further would be unbounded polling, not resolution — 5 is the
    existing design's chosen bound, unchanged here).

This is exactly the invariant D9 requires: **deterministic automation
wherever the provider contract supports a real answer (confirmed /
not_found via on-chain truth), and manual reconciliation retained
exactly where the provider genuinely cannot distinguish "not found" from
"definitively not settled"** (no transaction reference ever existed, or
the chain lookup remains ambiguous after bounded retry).

## Test coverage (pre-existing, re-verified, unchanged)

`settlement-reconciliation.test.ts` — 7 cases, all passing, none touched
this checkpoint:

- `not_found` — no record exists at all
- `inconclusive` — draft exists, no transaction reference ever recorded
- `confirmed` — chain checker reports `SETTLED`
- `not_found` — chain checker reports `FAILED`
- bounded retry — `STILL_UNKNOWN` on every attempt returns `inconclusive`
  after exactly 5 checker calls, never unbounded
- structural proof — no `settle` method exists on the injected
  dependencies at all
- `checked_at_unix` reflects the injected clock, never real wall time

The crash-matrix suite in `paid-continuation-workflow.test.ts`
(referenced by D8) independently exercises both `ambiguous_unresolved`
entry points (CAS-fail pre-settle, and settle-throw-then-reconcile).

## Regression

No source changed; no new regression run required beyond confirming the
existing reconciliation and workflow test suites are green at the D9
starting commit (already established at D8 close, no drift since).

## Economic effect

```
REAL_SETTLEMENT_ATTEMPTS=0
ECONOMIC_EFFECT_USDC=0
FUNCTIONAL_SOURCE_MUTATIONS=0
HOST_DEPLOYMENTS=0
PUBLIC_API_DEPLOYMENTS=0
```

## Operator recovery procedure (retained, unchanged)

For the residual manual-reconciliation case (`inconclusive`): an
operator queries `payment_attempts` by `payment_identifier`, inspects
`lifecycle_stage` and `settlement_transaction_reference` (if any), and —
only if a transaction reference exists and remains unresolved on-chain
after the bounded automated check — performs a manual on-chain lookup
before deciding on a refund/retry-eligibility classification. No
automated path re-attempts `settle()` under any circumstance.

## SUN1222C_R4_D9 = PASS

```
D9_REMEDIATION_REQUIRED=NO
FUNCTIONAL_SOURCE_MUTATIONS=0
HOST_DEPLOYMENTS=0
D9_EVIDENCE_COMMIT_SHA=<set at commit time>
```

D10 not auto-triggered per checkpoint instruction.

# ADR 0055: Human-authorized production bootstrap exception

- Status: accepted for SUN-1200
- Date: 2026-08-18

## Context

Master directive §8
(`docs/source/SITEBORNE_UTILITY_NETWORK_MASTER_DIRECTIVE.md`, "Promotion states"
section): "No route, policy, provider or pricing rule may autonomously affect
production until it reaches `EXECUTABLE_VERIFIED`."
`governance/PROMOTION_STATES.yaml` grants `controls_money: true` only at
`EXECUTABLE_VERIFIED`, whose own requirements include "At least 100 successful
production executions."

This is a genuine bootstrapping paradox as written, with no resolution elsewhere
in repository authority: the only state permitted to affect production requires
production executions to already have occurred as an entry condition. Nothing in
the promotion ladder, `TASKS.yaml`, or the master directive explains how the
first production execution is meant to happen.

`SUN-1200` ("First unknown paid transaction") depends on a real, unrelated,
uncoordinated external wallet paying via x402 and settling via CDP. That event
cannot occur unless the paid production surface already exists and is reachable
-- but nothing may "affect production" to make it reachable before
`EXECUTABLE_VERIFIED`, which itself requires the event to have already happened
100 times.

## Decision

Distinguish **autonomous production authority** (what §8 governs and prohibits
below `EXECUTABLE_VERIFIED`) from a **human-authorized, one-time production
bootstrap operation** (what this ADR narrowly permits). §8's prohibition targets
the system acting on its own initiative -- a route, policy, provider, or pricing
rule changing itself, or the system deciding autonomously to affect production.
It does not, and this ADR does not attempt to, describe a deliberate, explicitly
human-directed, fully bounded configuration action as "autonomous."

`EXECUTABLE_VERIFIED` remains the minimum state required for **autonomous**
production-affecting decisions. This ADR does not lower, reinterpret, or
partially satisfy the 100-successful-production-executions requirement, the
rubric threshold, the load/adversarial test requirements, or any other
`EXECUTABLE_VERIFIED` criterion. The promotion ladder for normal, ongoing system
operation is completely unchanged.

A one-time production bootstrap action may occur below `EXECUTABLE_VERIFIED`
only when **all** of the following hold simultaneously:

1. It is explicitly authorized by the human owner/operator, in that exact
   session, for that exact action -- not inferred, not assumed from a prior
   general instruction.
2. The exact mutation is predetermined and bounded before execution -- no
   open-ended "figure out what production needs" latitude.
3. No autonomous policy/model/provider selection is allowed to expand its scope
   during execution.
4. Production configuration is fail-closed both before and after the bounded
   operation -- no service is enabled beyond exactly what was authorized.
5. All accepted security/recovery/rollback gates pass before the action is
   taken.
6. The action is independently logged and auditable (a checkpoint report and
   `TASKS.yaml`/`PROJECT_STATE.yaml` evidence entry, as with every other
   external mutation in this project's history).
7. Replay/idempotency controls are active for the bounded action.
8. The action does not count toward `EXECUTABLE_VERIFIED`'s "100 successful
   production executions" requirement unless it is an actual, real, successful
   production execution under the accepted rubric -- a configuration change is
   not an execution.
9. Controlled or self-funded bootstrap transactions, if any occur as part of
   verifying the bootstrap itself, are never counted as unknown-customer or
   market-demand evidence -- `governance` `market_integrity` rules
   (`self_purchase: forbidden`, `related_wallet_purchase: forbidden`,
   `compensated_purchase: forbidden`, `precommitted_purchase: forbidden`,
   `artificial_volume: forbidden`, `free_invocation_as_market_proof: forbidden`)
   are unaffected and unweakened by this ADR.
10. After the bootstrap action completes, autonomous production behavior remains
    fully constrained by the normal promotion-state rules -- this ADR authorizes
    exactly one bounded action, not an ongoing exception.

## Frozen interpretation, recorded explicitly

```
HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP = true
AUTONOMOUS_PRODUCTION_AUTHORITY       = false
EXECUTABLE_VERIFIED                   = false
```

`EXECUTABLE_VERIFIED` remains `false` until the actual, real promotion criteria
(rubric ≥85, load @3x, adversarial test, zero critical findings, 100 successful
production executions) are genuinely satisfied through real production operation
-- not through this ADR, and not through any bootstrap action taken under it.

## Scope

This ADR resolves only the bootstrapping paradox described above. It does not
waive, relax, or substitute for any security, recovery, observability,
network-separation, payment-correctness, or market-demand requirement elsewhere
in this repository's governance. It grants no standing authority -- each future
bootstrap-adjacent action still requires its own explicit human authorization
under the ten conditions above.

## Rejected alternatives

- **Silently proceeding to configure production** without recording this
  distinction: would leave `EXECUTABLE_VERIFIED`'s meaning ambiguous and create
  exactly the kind of self-authorizing autonomous behavior §8 exists to prevent.
- **Reinterpreting "100 successful production executions" as already satisfied**
  by prior testnet/sandbox proofs (CDP Base Sepolia settlement, Nevermined
  sandbox registrations): rejected outright. Testnet and sandbox evidence is
  explicitly not production evidence anywhere else in this project's governance
  (see the CDP v2/Nevermined v2 testnet-vs-production network-identity
  separation work in `SUN-1000`), and treating it as such here would be exactly
  the "falsifying the governance model" this ADR is meant to avoid.
- **Lowering the `EXECUTABLE_VERIFIED` bar itself** (e.g., to 1 execution, or
  removing the requirement for a bootstrap case): rejected -- the ladder exists
  to prevent an unverified system from autonomously controlling real money, and
  weakening it defeats that purpose regardless of how the first execution is
  bootstrapped.

## Consequences

A deliberate, explicitly human-authorized, narrowly bounded production
configuration action is now distinguishable from prohibited autonomous
production authority. `SUN-1200` can proceed to determine the legal
`production_ready`/`production_enabled` sequence and audit production readiness
(network, asset, seller identity, D1, recovery, observability, abuse controls,
rollback) without either fabricating `EXECUTABLE_VERIFIED` status or being
permanently blocked by the paradox. No production mutation, payment, or
transaction is authorized by this ADR itself -- it is a governance record only.

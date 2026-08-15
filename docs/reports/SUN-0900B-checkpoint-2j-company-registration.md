# SUN-0900B Checkpoint 2J — Company Evidence Nevermined Registration

Date: 2026-08-15

Accepted baseline: `0d0c02406ce241fb071674941df344d6e0c347d6`

Task state: `SUN-0900B=active`

Production: `production_ready=false`, `production_enabled=false`

Classification: sandbox registration evidence; not revenue, customer activity,
payment evidence, or production evidence.

## Outcome

Checkpoint 2J performed exactly one reconcile-first, builder-only Nevermined
sandbox registration for `company_evidence_graph.v1`. Before mutation, six
bounded read-only reconciliation passes found zero matching canonical company
agents and zero matching canonical company plans and classified the external
state as `NO_MATCH`.

The one guarded `registerAgentAndPlan` operation created:

- agent ID:
  `63058244394774357835944659628164807563769006924765007721830897155339294179447`
- plan ID:
  `61176543225966665382887590264143689398477975837289843272089835781341158489584`

The IDs are now immutable reconciliation anchors. Authoritative Nevermined GET
read-back passed `validateNeverminedFixedPaygPlan` and final reconciliation
returned `EXACT_EXISTING`. A subsequent independent builder-only reconciliation
found the same registration on its first pass. No second company registration is
necessary while this state continues to reconcile exactly.

This checkpoint proves registration only. It did not execute the company service
or create any subscriber/payment lifecycle state.

## Canonical repository declaration

The registration request was derived from the accepted repository declaration
and pricing registry:

```text
service:             company_evidence_graph.v1
agent name:          Company Evidence Graph
plan name:           Company Evidence Graph — PAYG plan
endpoint:            POST https://utility.siteborne.net/v1/nevermined/company/evidence-graph
scheme:              nvm:erc4337
network:             eip155:84532 (Base Sepolia)
gross price:         39000 atomic USDC
token:               0x036CbD53842c5426634e7929541eC2318f3dCF7e
seller receiver:     0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
payment semantics:   fixed PAYG / exact
credits:             1 granted, min 1, max 1
access:              credits
trial:               false
recurring:           false
registration_allowed:true
```

This is not the document dynamic-credit model. No 190000-credit grant,
12000-190000 variable document redemption range, document UsageResult, or
document-payment behavior was applied to the company service.

## Validator and reconciliation boundary

The credential-independent authoritative read-back validator is:

`packages/protocol-nevermined/src/fixed-payg-plan-validator.ts`

Public APIs:

- `resolveNeverminedFixedPaygPlanRequirements`
- `validateNeverminedFixedPaygPlan`
- `reconcileNeverminedFixedPaygRegistration`

It imports no Nevermined SDK and performs no network or credential operations.
It validates fetched public agent/plan structures and fails closed on missing or
malformed IDs, identities, endpoint, plan linkage, price components, receiver
cardinality, token, credits configuration, access policy, trial status, or
recurrence. It also rejects document dynamic-credit and fixed-credit shapes at
this fixed-PAYG boundary.

Credential-free tests cover exact acceptance; wrong agent, plan, endpoint,
price, token, seller, platform receiver, cardinality, access, trial, recurrence,
and credit semantics; free/zero price; malformed/fractional/unsafe numeric
values; unknown read-back; exact-existing reconciliation; wrong-economics
conflict; ambiguous registry states; and frozen document/web/verify-agent/CDP
declarations.

## Reconcile-first evidence

The initial GET-only builder reconciliation ran the complete bounded absence
schedule:

```text
matching canonical agents: 0
matching canonical plans:  0
agent listing passes:       6
plan listing passes:        6
classification:             NO_MATCH
```

The guarded registration command was then invoked exactly once with
`NEVERMINED_REGISTER_COMPANY=1` set only for that process. The subscriber key
and all live payment/probe flags were removed from the child environment. The
harness called at most one logical `registerAgentAndPlan` operation and did not
retry it.

After the mutation, authoritative read-back validated the returned IDs. A later
independent reconciliation observed:

```text
matching canonical agents: 1
matching canonical plans:  1
agent listing passes:       1
plan listing passes:        1
validator:                  valid
classification:             EXACT_EXISTING
registration mutations:    0
```

## Authoritative agent read-back

```text
id:
  63058244394774357835944659628164807563769006924765007721830897155339294179447
metadata.main.name:
  Company Evidence Graph
metadata.agent.endpoints:
  POST https://utility.siteborne.net/v1/nevermined/company/evidence-graph
registry.plans:
  61176543225966665382887590264143689398477975837289843272089835781341158489584
```

The agent exposes exactly one canonical POST endpoint and exactly one intended
plan linkage.

## Authoritative plan and economics read-back

```text
id:
  61176543225966665382887590264143689398477975837289843272089835781341158489584
metadata.main.name:
  Company Evidence Graph — PAYG plan
metadata.plan.accessLimit:
  credits
metadata.plan.isTrialPlan:
  false
metadata.plan.recurringSubscription:
  false
```

The request used the installed SDK's accepted fixed-PAYG helpers. Nevermined's
persisted GET representation—not an assumed request object—is authoritative.
That read-back contained two aligned price components:

```text
component 1:
  amount:   38610 atomic
  receiver: 0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
component 2:
  amount:   390 atomic
  receiver: 0x2020949c1B565421AC21b76e70340266c4CA9A90
total:
  39000 atomic
token:
  0x036CbD53842c5426634e7929541eC2318f3dCF7e
isCrypto:
  true
```

The 99/1 persisted normalization was characterized from the already-frozen web
registration immediately before company mutation and then independently
confirmed by the actual company GET read-back. Platform components were not
manually inserted into the registration request.

The persisted fixed-PAYG credits representation was:

```text
amount:                       1
minAmount:                    1
maxAmount:                    1
isRedemptionAmountFixed:      false
redemptionType:               4
onchainMirror:                false
durationSecs:                 0
```

The term `PAYG` here describes Nevermined's accepted fixed-service 1/1/1
configuration. It does not import the document prepaid dynamic-credit model.

## Mutation and no-payment record

```text
logical company registration attempts: 1
company agents created:                 1
company plans created:                  1
subscriber delegations created:         0
authorization tokens created:           0
verifyPermissions calls:                0
company service executions:             0
settlePermissions calls:                0
Payment-Identifier creations:           0
service jobs created:                    0
payment transactions:                    0
USDC movement:                            0
```

The builder credential was the only credential passed to the registration
process. `RUN_LIVE_NEVERMINED` and `RUN_LIVE_X402` remained absent. The company
guard was command-scoped and was not persisted.

## Frozen unrelated state

The document registration and accepted live lifecycle remain unchanged:

```text
document agent:
  109760621961288696094411057321700210583752765344624386042713081041578011828571
document plan:
  64977106381472769302826211192910538031161833107493020584806963732279386695975
Checkpoint 2H:                 accepted
Checkpoint 2I:                 accepted
sandbox_capability_verified:   true
dynamic_live_allowed:          true
```

`verify_agent_output.v1` was not reconciled for mutation, registered, executed,
or paid in this checkpoint.

## State decision and next checkpoint

Checkpoint 2J freezes:

```text
company registration_allowed: true
company registered:           true
company agentId:              63058244394774357835944659628164807563769006924765007721830897155339294179447
company planId:               61176543225966665382887590264143689398477975837289843272089835781341158489584
SUN-0900B:                    active
production_ready:             false
production_enabled:           false
```

The next checkpoint is separately authorized Checkpoint 2K: reconcile and, only
after authoritative `NO_MATCH`, register `verify_agent_output.v1`, then freeze
its IDs and authoritative read-back. It must not start automatically.

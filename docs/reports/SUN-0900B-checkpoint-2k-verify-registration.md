# SUN-0900B Checkpoint 2K — Verify Agent Output Nevermined Registration

Date: 2026-08-15

Accepted baseline: `1c952c964fd73bcff936e9de665bb663b61d821d`

Task state: `SUN-0900B=active`

Production: `production_ready=false`, `production_enabled=false`

Classification: sandbox registration evidence; not revenue, customer activity,
payment evidence, or production evidence.

## Outcome

Checkpoint 2K performed exactly one reconcile-first, builder-only Nevermined
sandbox registration for `verify_agent_output.v1`. Six bounded read-only passes
first established authoritative `NO_MATCH`, with zero canonical agent matches
and zero canonical plan matches.

The single guarded `registerAgentAndPlan` operation created:

- agent ID:
  `75096875289866166059253207097165867959384005104090226106621988801798698661167`
- plan ID:
  `106105151389083481380363516765690985250481102170794631056207896452064676707220`

Authoritative GET read-back passed the reused fixed-PAYG validator and final
reconciliation returned `EXACT_EXISTING`. A later independent builder-only
reconciliation found one exact agent and plan on its first pass and made zero
mutations. No second registration is necessary while this state remains exact.

This checkpoint proves registration only. It performed no verification service
execution and created no subscriber/payment lifecycle state.

## Canonical repository declaration

```text
service:              verify_agent_output.v1
agent name:           Agent Output Verification
plan name:            Agent Output Verification — PAYG plan
endpoint:             POST https://utility.siteborne.net/v1/nevermined/verify/agent-output
scheme:               nvm:erc4337
network:              eip155:84532 (Base Sepolia)
gross price:          19000 atomic USDC
token:                0x036CbD53842c5426634e7929541eC2318f3dCF7e
seller receiver:      0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
payment semantics:    fixed PAYG / exact
credits:              amount 1, min 1, max 1
access:               credits
trial:                false
recurring:            false
registration_allowed: true
```

The repository declaration and pricing registry agree on `19000` atomic. No
document dynamic-credit values or usage tiers were applied.

## Validator reuse and credential-free coverage

Checkpoint 2K reused the generic credential-independent APIs in
`packages/protocol-nevermined/src/fixed-payg-plan-validator.ts`:

- `resolveNeverminedFixedPaygPlanRequirements`
- `validateNeverminedFixedPaygPlan`
- `reconcileNeverminedFixedPaygRegistration`

No verify-specific validator was created. The module imports no Nevermined SDK,
reads no credentials, and performs no network operation.

The verify-specific credential-free matrix covers exact requirements and
authoritative acceptance; wrong agent, plan, endpoint, linkage, price, token,
seller, platform receiver, cardinality, access, trial, recurrence, crypto
classification, and credits semantics; zero/free price; malformed or unsafe
numbers and unknown shapes; document-dynamic and fixed-credit substitution;
exact-existing reconciliation; wrong-economics conflict; and unchanged company,
web, and document declarations. Fourteen verify-focused tests pass, while the
guarded external harness skips normally.

## Reconcile-first evidence

Initial builder-only GET reconciliation:

```text
matching canonical agents: 0
matching canonical plans:  0
agent listing passes:       6
plan listing passes:        6
classification:             NO_MATCH
```

`NEVERMINED_REGISTER_VERIFY=1` was then set for exactly one command. The
subscriber key and all payment/live/probe flags were removed from that child
environment. The harness permits one logical registration only after proven
absence and cannot retry an ambiguous mutation.

Independent post-registration reconciliation:

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
  75096875289866166059253207097165867959384005104090226106621988801798698661167
metadata.main.name:
  Agent Output Verification
metadata.agent.endpoints:
  POST https://utility.siteborne.net/v1/nevermined/verify/agent-output
registry.plans:
  106105151389083481380363516765690985250481102170794631056207896452064676707220
```

The authoritative agent exposes exactly one canonical POST endpoint and one
intended plan linkage.

## Authoritative plan and economics read-back

```text
id:
  106105151389083481380363516765690985250481102170794631056207896452064676707220
metadata.main.name:
  Agent Output Verification — PAYG plan
metadata.plan.accessLimit:
  credits
metadata.plan.isTrialPlan:
  false
metadata.plan.recurringSubscription:
  false
```

Nevermined persisted two aligned price components:

```text
seller component:
  amount:   18810 atomic
  receiver: 0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
platform component:
  amount:   190 atomic
  receiver: 0x2020949c1B565421AC21b76e70340266c4CA9A90
gross:
  18810 + 190 = 19000 atomic
token:
  0x036CbD53842c5426634e7929541eC2318f3dCF7e
isCrypto:
  true
```

The request used the canonical gross/seller through the installed SDK helper.
The backend-normalized platform component was validated only from authoritative
GET state; it was not manually injected into the request.

Persisted fixed-PAYG credits:

```text
amount:                       1
minAmount:                    1
maxAmount:                    1
isRedemptionAmountFixed:      false
redemptionType:               4
onchainMirror:                false
durationSecs:                 0
```

The complete authoritative `1/1/1` configuration is the accepted Nevermined
fixed-PAYG representation. `isRedemptionAmountFixed=false` alone does not turn
this into the document dynamic-credit plan.

## Zero-payment and frozen-state record

```text
logical verify registration attempts: 1
verify agents created:                1
verify plans created:                 1
subscriber delegations created:       0
authorization tokens created:         0
verifyPermissions calls:              0
service executions:                   0
settlePermissions calls:              0
Payment-Identifier creations:         0
service jobs created:                 0
payment transactions:                 0
USDC movement:                         0
```

The frozen company registration independently reconciled `EXACT_EXISTING` with
its accepted IDs and zero mutations. The document IDs and accepted Checkpoints
2H/2I were not changed or targeted by any mutation. A one-off document GET
command failed locally during ESM workspace resolution before an SDK client was
constructed; it made no external call and does not alter the accepted document
evidence.

## State and next checkpoint

```text
verify registration_allowed: true
verify registered:           true
verify agentId:              75096875289866166059253207097165867959384005104090226106621988801798698661167
verify planId:               106105151389083481380363516765690985250481102170794631056207896452064676707220
SUN-0900B:                   active
production_ready:            false
production_enabled:          false
```

All four canonical Nevermined registrations are now frozen. The next separately
authorized checkpoint is the SUN-0900B final completeness audit. It must
reconcile all registrations and accepted capability evidence against the master
directive, identify only genuine gaps, and decide whether SUN-0900B can be
accepted. It must not invent another payment checkpoint automatically.

# SUN-0900B Checkpoint 2G — Document Dynamic-Credit Registration

Date: 2026-08-15

Accepted baseline: `6de1ae85db8a9dd64cb22f5da34fb615bba560e2`

Task state: `SUN-0900B=active`

Production: `production_ready=false`, `production_enabled=false`

## Outcome

Checkpoint 2G performed exactly one reconcile-first, builder-side Nevermined
sandbox registration for `document_evidence_json.v1`. Before mutation, six
bounded read-only absence passes found zero matching document agents and zero
matching document plans and classified the external state as `NO_MATCH`.

The one guarded `registerAgentAndPlan` operation created:

- agent ID:
  `109760621961288696094411057321700210583752765344624386042713081041578011828571`
- plan ID:
  `64977106381472769302826211192910538031161833107493020584806963732279386695975`

Both IDs are now immutable reconciliation anchors. A subsequent independent,
builder-authenticated GET read the exact agent and plan on its first direct
attempt. `validateNeverminedDocumentDynamicPlan(agent, plan)` returned
`{ valid: true }`, and document-specific reconciliation returned
`EXACT_EXISTING` with those IDs. No second registration is necessary.

This checkpoint proves registration only. It did not create subscriber payment
state or execute the document lifecycle. `sandbox_capability_verified=false` and
`dynamic_live_allowed=false` remain unchanged.

## Guard and mutation record

The baseline required a clean tree at the accepted Checkpoint 2F commit,
`NVM_ENVIRONMENT=sandbox`, builder and subscriber credential presence without
value disclosure, and all registration/live/probe flags absent. The
credential-stripped pre-registration Nevermined, x402, state, task, governance,
and secret-scan gates passed.

Only the single registration process received `NEVERMINED_REGISTER_DOCUMENT=1`,
command-scoped. It received the builder credential and explicitly did not
receive the subscriber credential. It did not receive `RUN_LIVE_NEVERMINED`,
`RUN_LIVE_X402`, or either capability-probe flag. The registration test ran once
and was not retried.

External mutation totals for this checkpoint:

```text
logical document registration attempts: 1
document agents created:                 1
document plans created:                  1
subscriber delegations created:          0
subscriber tokens created:               0
verifyPermissions calls:                 0
document service executions:             0
settlePermissions calls:                 0
Payment-Identifier creations:            0
service jobs created:                     0
document monetary settlements:            0
```

## Reconciliation and eventual consistency

Initial reconciliation used authoritative identity and plan economics rather
than name alone. Across the accepted bounded schedule it observed:

```text
document-matching agents: 0
document-matching plans:  0
total agents in page:     2
total plans in page:      2
classification:           NO_MATCH
```

The registration harness spent six bounded passes proving absence before the one
mutation. After registration, the harness obtained both IDs and completed its
bounded authoritative read-back within its 120-second timeout. The later
independent known-ID reconciliation required one direct agent read and one
direct plan read and returned `EXACT_EXISTING`. There was no ambiguous timeout
and no retry.

## Authoritative agent read-back

The persisted agent identity was:

```text
id:
  109760621961288696094411057321700210583752765344624386042713081041578011828571
metadata.main.name:
  Document Evidence JSON
metadata.agent.endpoints:
  POST https://utility.siteborne.net/v1/nevermined/document/evidence-json
registry.plans:
  64977106381472769302826211192910538031161833107493020584806963732279386695975
```

The endpoint list contained the one expected POST endpoint with no additional
service methods, and the plan linkage contained the intended plan ID.

## Authoritative plan read-back

The persisted plan identity and policy fields were:

```text
id:
  64977106381472769302826211192910538031161833107493020584806963732279386695975
metadata.main.name:
  Document Evidence JSON — PAYG plan
metadata.plan.x402Scheme:
  nvm:erc4337
metadata.plan.accessLimit:
  credits
metadata.plan.isTrialPlan:
  false
metadata.plan.recurringSubscription:
  false
```

Nevermined normalized the registration request into two aligned price
components, exactly matching the accepted Checkpoint 2F validator:

```text
component 1:
  amount:   188100 atomic
  receiver: 0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
component 2:
  amount:   1900 atomic
  receiver: 0x2020949c1B565421AC21b76e70340266c4CA9A90
total:
  190000 atomic
token:
  0x036CbD53842c5426634e7929541eC2318f3dCF7e
isCrypto:
  true
```

The persisted dynamic-credit configuration was:

```text
amount:                       190000
minAmount:                    12000
maxAmount:                    190000
isRedemptionAmountFixed:      false
redemptionType:               4
onchainMirror:                false
durationSecs:                 0
```

## Exact economic round-trip

All monetary and credit arithmetic uses `bigint`, never the backend floating
`pricePerCredit:number`:

```text
gross price:       188100n + 1900n = 190000n
credits granted:   190000n
remainder:         190000n % 190000n = 0n
acquisition ratio: 190000n / 190000n = 1n atomic acquisition value per credit
```

The frozen usage-value mapping therefore round-trips exactly:

```text
native:  12000 credits  -> 12000 atomic acquisition value
OCR:     19000 credits  -> 19000 atomic acquisition value
table:   29000 credits  -> 29000 atomic acquisition value
maximum: 190000 credits -> 190000 atomic acquisition value
```

This is the accepted Nevermined prepaid dynamic-credit model: an acquisition or
automatic top-up purchases a reusable 190000-credit pool, and a job burns its
measured usage value. It is not a claim that every job moves fresh USDC.

## State decision and next checkpoint

Checkpoint 2G records:

```text
registration_allowed:        true
registered:                  true
sandbox_capability_verified: false
dynamic_live_allowed:        false
production_ready:            false
production_enabled:          false
```

The next separately authorized checkpoint must reuse the frozen IDs and prove
the normal zero-credit path: automatic 190000-credit acquisition/top-up, one
native document execution, exact 12000-credit burn, durable recovery, and
authoritative replay with no duplicate charge or execution. It must not create
another document plan.

The positive-but-insufficient balance case remains deliberately separate. For
example, starting with 5000 credits for a 12000-credit native job still requires
an isolated live proof of the provider's precise top-up behavior. Checkpoint 2G
does not guess or encode that result.

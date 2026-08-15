# SUN-0900B Checkpoint 2F — Document Dynamic-Credit Registration Validator

Date: 2026-08-15

Task state: `SUN-0900B=active`

Production: `production_ready=false`, `production_enabled=false`

External mutation: none

## Outcome

Checkpoint 2F adds a credential-independent, fail-closed validator for the
authoritative Nevermined read-back of the accepted `document_evidence_json.v1`
prepaid dynamic-credit plan. The validator and reconciliation matrix pass, so
`registration_allowed` is now `true` for this one exact shape. This is
permission to attempt a guarded registration, not a claim that registration or
the live document lifecycle has occurred.

`sandbox_capability_verified=false` and `dynamic_live_allowed=false` remain
unchanged. The controlled document registration, live credit burn, settlement
evidence, replay, and partial-balance behavior belong to the next checkpoint.

## Validator boundary

Implementation:

- `packages/protocol-nevermined/src/document-dynamic-plan-validator.ts`
- exported through `packages/protocol-nevermined/src/index.ts`
- credential-free matrix in
  `packages/protocol-nevermined/src/document-dynamic-plan-validator.test.ts`

Public APIs:

- `validateNeverminedDocumentDynamicPlan(agent, plan)`
- `reconcileNeverminedDocumentDynamicRegistration(reconciliation, agent, plan)`
- `computeCreditAcquisitionValueAtomic(grossPriceAtomic, creditsGranted)`
- `DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS`
- `DOCUMENT_USAGE_TIER_VALUES_ATOMIC`

The protocol package has no runtime dependency on `@nevermined-io/payments`. SDK
clients perform bounded reads; the pure protocol boundary validates only the
returned structure.

## Authoritative read-back shape

One permitted, builder-authenticated GET inspected the retained Checkpoint 2D
capability-probe plan. No mutation occurred. The observed load-bearing paths
were:

- agent name: `metadata.main.name`
- agent endpoints: `metadata.agent.endpoints`
- agent-plan linkage: `registry.plans`
- plan name: `metadata.main.name`
- access/trial/recurrence: `metadata.plan`
- persisted price components: `registry.price`
- persisted credit configuration: `registry.credits`

The backend exposes the requested ERC-20 price as two aligned components: a 99%
SITEBORNE seller amount and a 1% Nevermined platform amount. This is the
registration `priceConfig` read-back, not a later inferred settlement split. For
the document plan the validator therefore requires exactly:

```text
amounts:
  188100
  1900
receivers:
  0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
  0x2020949c1B565421AC21b76e70340266c4CA9A90
total:
  190000
token:
  0x036CbD53842c5426634e7929541eC2318f3dCF7e
isCrypto:
  true
```

Unexpected, missing, reordered, or additional amount/receiver components fail
closed.

The exact credit read-back is:

```text
accessLimit: credits
amount: 190000
minAmount: 12000
maxAmount: 190000
isRedemptionAmountFixed: false
redemptionType: 4
onchainMirror: false
durationSecs: 0
isTrialPlan: false
recurringSubscription: false
```

The service identity is bound by the exact agent name, exact plan name, a single
POST endpoint at
`https://utility.siteborne.net/v1/nevermined/document/evidence-json`, non-empty
agent/plan IDs, and an exact one-plan linkage containing that same plan ID.

## Normalization policy

Economic values accept only:

- non-negative `bigint`;
- non-negative JavaScript safe-integer numbers; or
- canonical unsigned base-10 strings matching `0|[1-9][0-9]*`.

Fractional values, unsafe numbers, `NaN`, infinity, scientific notation, leading
zeroes, signs, whitespace, missing fields, and unknown shapes are rejected.
There is no truncation, coercion, rounding, or permissive normalization.

## Exact unit economics

The validator proves with `bigint` arithmetic:

```text
190000n / 190000n = 1n atomic acquisition value per credit
190000n % 190000n = 0n
```

It never treats the backend floating `pricePerCredit:number` as monetary
authority. Frozen usage values remain:

```text
native:  12000
OCR:     19000
table:   29000
maximum: 190000
```

These are accepted service usage/economic values and credit burns. They do not
claim fresh USDC movement on every request.

## Credential-free rejection matrix

The dedicated 36-test suite proves:

- the exact read-back passes;
- PAYG `1/1/1` and fixed-credit shapes fail;
- wrong prices `189999`, `190001`, `12000`, and `0` fail;
- wrong grants, minimums, maximums, and `min > max` fail;
- wrong token, missing/wrong/multiple receivers, and component mismatches fail;
- wrong endpoint, agent identity, plan identity, IDs, or linkage fail;
- trial, recurring, time-access, expirable, mirrored, and wrong-redemption
  shapes fail;
- non-integral, non-unit, and zero-denominator acquisition ratios fail;
- fractional, unsafe, non-finite, and non-canonical numeric forms fail;
- missing or malformed authoritative shapes fail closed;
- an exact identity plus exact economics reconciles as `EXACT_EXISTING`;
- an identity match with wrong economics reconciles as `CONFLICT`;
- positive full-schedule absence maps to `NO_MATCH`; ambiguous registry states
  map to `CONFLICT`;
- fixed Nevermined declarations are unchanged;
- the CDP/x402 document rail remains `upto` at the 190000 ceiling.

## Registration harness

`apps/edge-api/tests/live/nevermined-register-document.test.ts` is prepared but
was not executed. It remains guarded by `NEVERMINED_REGISTER_DOCUMENT=1`, uses
the builder credential only, reconciles before mutation, registers only after
`NO_MATCH`, performs at most one `registerAgentAndPlan`, waits through the
existing bounded eventual-consistency schedule, then requires the authoritative
GET read-back to reconcile as `EXACT_EXISTING`.

The registration request uses
`getERC20PriceConfig(190000, Base Sepolia USDC, SITEBORNE seller)` plus
`getDynamicCreditsConfig(190000, 12000, 190000)`. The disproven PAYG helper is
not used. Partial, conflicting, timeout, or malformed states stop without
guessing.

## State decision and open runtime question

`registration_allowed=true` now means exactly: safe to authorize one guarded
registration attempt for this validated shape.

It does not change:

- `sandbox_capability_verified=false`;
- `dynamic_live_allowed=false`;
- `production_ready=false`;
- `production_enabled=false`.

The partial-balance case remains deliberately open: if a subscriber starts with
5000 credits and a native job needs 12000, the exact automatic top-up quantity
is unproven. The validator does not encode or guess that runtime behavior. The
next live document lifecycle checkpoint must test it.

## Mutation and security record

This checkpoint made zero document registrations, delegations, token mints,
permission verifications, settlements, or service executions. One sanitized,
GET-only inspection of the already-retained capability-probe plan established
the authoritative read-back paths. Live/probe/registration flags remained
absent. No credential value or authorization material was printed or stored.

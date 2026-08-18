# ADR 0056: `verify_agent_output` SITEBORNE JSON Schema Profile 1

**Status:** Accepted **Date:** 2026-08-18 **Decision Makers:** Human governance
(SUN-1200 checkpoint F, VALIDATION RUNTIME CLOSURE) **Consulted:** ADR 0013
(contract compatibility classification), ADR 0039 (underspecified frozen
fields), SUN-1200 checkpoint F incident reports

## Context

`verify_agent_output.v1`/`.v2`'s `schema_valid` deterministic requirement
validates the buyer-supplied `candidate_output` against a buyer-supplied
`required_schema` — a genuinely dynamic, per-request JSON Schema, contractually
unconstrained (`agent-verification-input.schema.json`'s `required_schema` is
`{"type": "object", "additionalProperties": true}`, confirmed by ADR 0039 to be
a deliberate SUN-0600 decision, not an oversight).

Implementing this with a real, request-time
`new Ajv(...).compile(required_schema)` call is a request-time-eval risk: the
same class of defect that caused SUN-1200 checkpoint F's second mainnet cutover
500 (`EvalError: Code generation from strings disallowed for this context`).
SUN-1200 checkpoint F's VALIDATION RUNTIME CLOSURE report classified this as
`VERIFY_DYNAMIC_DECISION = C — CONTRACT_AMBIGUOUS` and stopped, per its own
governance instruction, rather than unilaterally choosing an architecture. This
ADR records the human governance decision that resolved that ambiguity.

## Decision

`verify_agent_output` validates `required_schema` against **SITEBORNE JSON
Schema Profile 1** (`siteborne-json-schema-profile-1`,
`packages/service-runtime/src/services/agent-verification/schema-profile-1.ts`)
instead of unrestricted AJV. Profile 1 is:

- **Closed-world.** Only the keywords enumerated below are recognized. Any other
  keyword — including every currently-known 2020-12 keyword not on this list —
  is REJECTED, never silently ignored.
- **Eval-free.** Interpreted by `@cfworker/json-schema`'s `Validator`, a pure
  JSON Schema interpreter with no `eval`/`new Function`/runtime codegen anywhere
  in its own implementation (confirmed by direct bundle inspection, not merely
  its documentation — see the SUN-1200 checkpoint F closure report's bundle
  re-audit).
- **Local-only.** `$ref` is supported only as a same-document JSON Pointer (`#`
  or `#/a/b/c`). Remote/external/dynamic refs are rejected outright, and a
  recursive local `$ref` cycle (direct or mutual) is rejected rather than
  attempting to bound its validation-time recursion.
- **Resource-bounded**, checked structurally BEFORE the interpreter ever runs:
  schema byte size, nesting depth, node count, local `$ref` count, properties
  per object / total property declarations, combinator branch count, enum size,
  and `prefixItems` length.
- **Pre-economic.** An unsupported or over-limit `required_schema` is rejected
  with a deterministic 400 (`unsupported_required_schema` /
  `required_schema_limit_exceeded`) BEFORE any x402 payment challenge is minted
  — a buyer never pays for a request SITEBORNE already knows it cannot execute.

### Supported keywords

Core: `type`, `enum`, `const`, boolean schemas (`true`/`false`). Objects:
`properties`, `required`, `additionalProperties`, `minProperties`,
`maxProperties`. Arrays: `items`, `prefixItems`, `minItems`, `maxItems`,
`uniqueItems`, `contains`, `minContains`, `maxContains`. Strings: `minLength`,
`maxLength`. Numbers: `minimum`, `maximum`, `exclusiveMinimum`,
`exclusiveMaximum`, `multipleOf`. Composition: `allOf`, `anyOf`, `oneOf`, `not`,
`if`, `then`, `else`. Definitions/references: `$defs`, `$ref` (local JSON
Pointer only). `$schema` is accepted only at the schema root and, if present,
MUST equal `https://json-schema.org/draft/2020-12/schema`. Annotation-only
(never affect validation, always allowed): `title`, `description`, `default`,
`examples`, `$comment`, `deprecated`, `readOnly`, `writeOnly`.

### Explicitly unsupported keywords (rejected, not silently dropped)

`$dynamicRef`, `$dynamicAnchor`, `$anchor`, `$id`, `$recursiveRef`,
`$recursiveAnchor`, `$vocabulary`, `unevaluatedProperties`, `unevaluatedItems`,
`pattern`, `patternProperties`, `format`, `contentEncoding`, `contentMediaType`,
`contentSchema`, `dependentRequired`, `dependentSchemas`, `dependencies`,
`propertyNames`, `additionalItems`.

`pattern`/`patternProperties`/`format`/`content*` are excluded from the first
production profile specifically to avoid introducing regex/ReDoS or ambiguous
format semantics into the first production interpreter integration — they may be
introduced in a future profile revision after explicit resource/security
testing. `dependentRequired`/`dependentSchemas` are omitted by explicit
governance decision (this ADR), not because they proved incompatible.
`$id`/`$anchor`/`$dynamicRef`/`$dynamicAnchor` are excluded to keep Profile 1's
"`$ref` is always a same-document JSON Pointer" rule unambiguous — a root `$id`
reassigns the schema's base URI, which this profile deliberately never has to
reason about.

### Resource limits (frozen)

| Limit                                 | Value |
| ------------------------------------- | ----- |
| `MAX_CANONICAL_SCHEMA_BYTES`          | 32768 |
| `MAX_SCHEMA_DEPTH`                    | 32    |
| `MAX_SCHEMA_NODES`                    | 2048  |
| `MAX_LOCAL_REF_COUNT`                 | 128   |
| `MAX_PROPERTIES_PER_OBJECT_SCHEMA`    | 256   |
| `MAX_TOTAL_PROPERTY_DECLARATIONS`     | 1024  |
| `MAX_COMBINATOR_BRANCHES_PER_KEYWORD` | 32    |
| `MAX_ENUM_VALUES`                     | 256   |
| `MAX_PREFIX_ITEMS`                    | 128   |

No remote fetches; validating a schema against Profile 1 requires zero network
access.

## Governance classification (ADR 0013)

`agent-verification-input.schema.json`'s `required_schema` field is
byte-for-byte **unchanged** by this decision — it was, and remains,
`{"type": "object", "additionalProperties": true}`. No JSON Schema file in
`schemas/` or any `contracts/releases/*` directory changed. Confirmed by running
the real tooling against this change: `pnpm contracts:baseline:verify`,
`pnpm contracts:compat:check`, and `pnpm contracts:release:verify` all pass with
zero detected drift.

Per ADR 0013's taxonomy, this qualifies as **security hardening rejecting
already-forbidden behavior** and a **validator correction enforcing
already-documented (contractually unconstrained, never contractually "anything
AJV can compile") behavior** — both explicitly PATCH-classified (no required
version bump), not `minor_candidate` or `major`. No wire-level contract change
occurred; this ADR is the record of a service-implementation behavior narrowing
within an already-unconstrained field, not a contract revision. Accordingly,
**no new `contracts/releases/2.1.0` directory was minted** — the compat tooling
itself confirms there is nothing for such a directory to describe. If a future
change to `required_schema`'s JSON Schema shape itself is ever proposed (for
example, adding an explicit `enum: ["siteborne-json-schema-profile-1"]`-style
profile-selector field), that would be a real wire-level change and must go
through `contracts:compat`/`contracts:release:verify` normally.

## Consequences

- `verify_agent_output`'s `schema_valid` check is eval-free end-to-end: zero
  `Ajv.compile()`, zero `new Function()`, zero request-time schema-loading
  filesystem reads, for any request whose `required_schema` this profile
  supports.
- A buyer whose `required_schema` uses an unsupported keyword or exceeds a
  resource limit is rejected before paying, with a deterministic, honest error
  naming the unsupported keyword or exceeded limit.
- A buyer whose `required_schema` needs `pattern`/`format`/`dependentSchemas`/
  remote refs/etc. cannot use `verify_agent_output` today. This is a real,
  disclosed capability reduction versus the old (unsafe) unrestricted-AJV
  behavior — traded deliberately for eval-free, bounded, Workers-safe execution.
- Differential equivalence between Profile 1 (`@cfworker/json-schema`) and a
  fresh AJV 2020-12 runtime compile is proven for every supported keyword
  (`schema-profile-1.test.ts`), so Profile 1's behavior is not merely assumed
  compatible with what buyers previously experienced for supported schemas.

## Revisit Condition

If a real buyer need for `pattern`/`format`/`dependentSchemas`/remote refs
against `verify_agent_output` emerges, evaluate adding that specific keyword to
a Profile 2 only after explicit security/complexity testing (ReDoS corpus for
`pattern`, format-injection review, etc.) — never by silently relaxing Profile
1's closed-world rejection.

# ADR 0057: x402 Payment-Identifier Extension Schema Sanitization

**Status:** Accepted **Date:** 2026-08-19 **Decision Makers:** Human governance
(SUN-1202 checkpoint H) **Consulted:** SUN-1201 checkpoint G closure report
(original `FUNCTIONAL_BLOCKER` finding), ADR 0056 (SITEBORNE JSON Schema Profile
1 — the same request-time-eval-under-`workerd` failure class)

## Context

SUN-1201 checkpoint G discovered, live under real Cloudflare `workerd`, that a
structurally valid Payment-Identifier extension (the `payment-identifier` x402
extension, `@x402/extensions/payment-identifier`) was rejected as
`malformed_payment_signature` whenever the buyer echoed the server-declared
extension's `schema` field back — exactly what SITEBORNE's own official buyer
helper (`buildBuyerPaymentIdentifierExtensions`,
`packages/protocol-x402/src/identifier/payment-identifier.ts`) produces, and
what any spec-compliant buyer that echoes the full declared extension object (a
normal, unremarkable pattern) would also produce.

**Root cause.** `@x402/extensions`' own `declarePaymentIdentifierExtension`
unconditionally attaches a `schema` field (`paymentIdentifierSchema`, a small
JSON Schema describing the extension's own `info` shape) to every
server-declared extension — confirmed by reading the installed package source
directly, both the pinned version (2.21.0) and the latest published version at
the time of this fix (2.23.0): identical in this regard, so this is not a
version-skew defect. `@x402/extensions`' own `validatePaymentIdentifier` does a
real, request-time `new Ajv2020().compile(ext.schema)` whenever a buyer echoes
that field back, wrapped in the package's own `try/catch`. Under real `workerd`,
that compile throws
`EvalError: Code generation from strings disallowed for this context`
(request-time dynamic code generation is disallowed — the same runtime
restriction class as ADR 0056's `verify_agent_output` finding and SUN-1200
checkpoint F's two production incidents); the `try/catch` converts that
exception into `{valid: false}`, silently misreporting an otherwise perfectly
valid identifier as malformed.

`FAULT_OWNER = UPSTREAM`. `@x402/extensions` does real, request-time AJV
compilation inside a validator meant to run in arbitrary HTTP server runtimes,
including ones (like Cloudflare Workers) that forbid dynamic code generation
during request handling. This is not a SITEBORNE bug, not a version-skew issue
(confirmed against both the pinned and latest published versions), and not
caused by SITEBORNE's own wrapper code doing anything non-standard.

## Decision

`ext.schema` is **optional** from `validatePaymentIdentifier`'s own perspective
(`if (ext.schema) { ...validate... }` runs only when the field is present) and
carries **no payment-identity, signature, or settlement meaning** — it is pure
self-descriptive JSON Schema metadata a buyer MAY use to locally validate `info`
before sending. `info.id`/`info.required` (the fields this repository's own
idempotency binding, `packages/protocol-x402/src/replay/binding.ts`, actually
depends on) never depend on `schema` being present.

SITEBORNE therefore normalizes every incoming `PaymentPayload` by dropping (and
_only_ dropping) the `payment-identifier` extension's `schema` field before it
reaches `@x402/extensions`' `extractAndValidatePaymentIdentifier` —
`sanitizePaymentIdentifierExtensionForValidation`, applied unconditionally
inside `parsePaymentIdentifier` itself (the one, single real entry point every
payload passes through, so no future caller can forget to apply it). This is
**Preferred A** from this checkpoint's own governing directive: "If the official
helper output is semantically valid but requires deterministic normalization
before entering an upstream runtime-hostile path, add a narrowly scoped
adapter."

**Governing rule for future maintenance:** SITEBORNE must not let a buyer-echoed
`payment-identifier` extension's `schema` field reach `@x402/extensions`'
`validatePaymentIdentifier` inside a Cloudflare Worker request handler, because
that upstream function depends on runtime dynamic code generation
(`ajv.compile`) which real `workerd` forbids during request processing. Use
`sanitizePaymentIdentifierExtensionForValidation` (or, if `@x402/extensions` is
ever upgraded to a version that no longer does request-time AJV compilation for
this field, re-verify this ADR's premise before removing the adapter — do not
remove it merely because a newer version exists).

## Why this is not a wire-format change

SITEBORNE's own public wire contract is unchanged: no schema file in
`contracts/releases/*` or `schemas/` was touched, no HTTP request/response shape
SITEBORNE documents changed. What changed is purely implementation-internal
request handling — an already-optional field a buyer might or might not include
is now deterministically ignored server-side before validation, exactly as if
that buyer had simply chosen not to send it (a choice the protocol already
permits). `pnpm contracts:baseline:verify`, `compat:check`, and `release:verify`
all confirm zero detected drift.

## Consequences

- A real, spec-compliant buyer using SITEBORNE's own official buyer helper (or
  any other client that echoes the declared extension, schema included) now
  succeeds under real `workerd`, exactly as they already did under Node.
- A malformed identifier (bad `id` pattern/length, or a buyer that tampers with
  `info.required`) is still rejected exactly as before — sanitization never
  touches `info`, only `schema`.
- If `@x402/extensions` is ever upgraded and no longer does request-time AJV
  compilation for this field, `sanitizePaymentIdentifierExtensionForValidation`
  becomes an inert no-op (it only acts when a `schema` field is present) — safe
  to leave in place, or remove after re-confirming this ADR's premise no longer
  holds.

## Revisit Condition

If `@x402/extensions` publishes a version that resolves this defect upstream
(confirmed by reading its source, not merely a changelog claim), revisit whether
the adapter is still needed. If a future protocol revision makes `schema`
load-bearing for payment-identity or settlement semantics, this adapter would
need to change accordingly — re-open this ADR before removing it in that case.

# SITEBORNE Utility Network — ADR 0044: `upto` Authorization vs. Usage Binding (SUN-0700A checkpoint 2)

## Context

`upto` is a usage-based x402 scheme: the buyer authorizes a maximum before the
resource is served; SITEBORNE settles the actual amount used, which can only be
known **after** the service executes. A naive design that tries to bind the
"final amount" into the pre-execution buyer authorization is self-contradictory
— the authorization necessarily happens before the actual usage is known.
Directive §26 requires these to be two separate, explicit bindings.

## Decision

**Authorization binding** (`src/requirements/upto.ts`): what the buyer
authorized _before_ execution. `buildUptoPaymentRequirement` builds an x402
`PaymentRequirements` (`scheme: 'upto'`) whose single `amount` field is the
**authorized maximum** — never an actual charge.
`validateUptoRequirementBinding` checks a candidate authorization against the
quote it must have come from (amount = maximum, asset, network, payee, expiry) —
structurally identical in shape to `exact`'s equivalent function, deliberately,
so the two schemes share a discipline without sharing wire semantics.

**Usage binding** (`src/pricing/document-usage.ts`): what SITEBORNE actually
measured _after_ execution, for `document_evidence_json.v1` specifically (the
service directive §10 identifies as `upto`-priced). `calculateDocumentUsage`
maps a document's per-page metrics (`ocr_used`, `table_count`) into a
deterministic cost using the same `governance/RISK_LIMITS.yaml`-sourced per-page
rates (`document_evidence_json_native`/`_ocr`/`_table`), summed and capped at
`document_evidence_json_max_job` — SITEBORNE's own accepted ceiling, never
exceeded regardless of document size. This calculation is pure arithmetic over
already-measured page metrics; it does not itself run the document worker, and
it never settles anything.

**The bridge**: `validateUptoAuthorization` (`src/requirements/upto.ts`) is the
one function that brings the two together — given an authorization requirement,
a quote, and a proposed `actualAmount` (which would come from a usage
calculation like the one above), it proves the actual amount is structurally
consistent with what was authorized (`0 <= actual <= maximum`, canonical
atomic-unit integer strings only, never a JS `Number()` parse — scientific
notation, signs, and non-integer strings are all rejected by
`isCanonicalAtomicAmount`). This function returns a **structural** outcome
(`valid` / `actual_exceeds_maximum` / ... ) — it does not, and cannot, mean the
payment was cryptographically verified or settled. That remains SUN-0700B.

**Replay implication** (see ADR 0043): because the authorization binding never
contains an actual-usage amount, `PaymentAttemptBinding.amount` for an `upto`
attempt is always the authorized maximum. There is therefore no "changed actual
usage" scenario at the replay-binding layer by construction — usage is a
separate, later binding that this checkpoint models the shape of but does not
persist or settle.

## Consequences

- A buyer's pre-execution authorization is never invalidated by SITEBORNE's own
  post-execution measurement — the two are structurally independent until
  `validateUptoAuthorization` explicitly bridges them.
- SITEBORNE cannot inflate a charge after the fact: `actual_exceeds_maximum`
  fails closed regardless of what the usage calculation produces.
- When SUN-0700B implements real settlement, it consumes both bindings (the
  authorization the buyer signed, and the usage SITEBORNE measured) rather than
  inventing a new representation — this ADR's split is the contract that later
  work builds on.

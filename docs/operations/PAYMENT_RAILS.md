# Payment rail selection and shared lifecycle

## Frozen routing policy

SITEBORNE selects the payment rail from the buyer-facing route before any
external verification. It does not auto-detect a rail from authorization
material.

| Service                     | Open CDP route               | Nevermined-only route                   |
| --------------------------- | ---------------------------- | --------------------------------------- |
| `company_evidence_graph.v1` | `/v1/company/evidence-graph` | `/v1/nevermined/company/evidence-graph` |
| `web_context_verified.v1`   | `/v1/web/context`            | `/v1/nevermined/web/context`            |
| `document_evidence_json.v1` | `/v1/document/evidence-json` | `/v1/nevermined/document/evidence-json` |
| `verify_agent_output.v1`    | `/v1/verify/agent-output`    | `/v1/nevermined/verify/agent-output`    |

Open routes select `cdp` only. Nevermined-prefixed routes select `nevermined`
only. An unknown route selects neither. Provider rejection is terminal for that
attempt; there is no fallback branch.

## Common authority and lifecycle

The two external protocols converge only after the selected provider's
verification response is accepted:

```text
route-selected rail
  -> structural authorization and requirement validation
  -> D1 Payment-Identifier acquisition with v2 rail binding
  -> selected external verification gate
  -> shared service runtime (once)
  -> PCC result and signed SITEBORNE receipt
  -> receipt self-verification
  -> UsageResult for variable-price work
  -> selected external settlement gate
  -> rail-aware PaymentServiceLink v2
  -> D1 consumed state
  -> paid HTTP response
```

D1 is the sole replay authority. There is no Nevermined replay database or
second service lifecycle. `Payment-Identifier` is reused across transports and
is never derived from the opaque Nevermined access token.

## Version boundaries

Historical payment-attempt bindings and PaymentServiceLink records remain v1.
They omit rail fields and retain their accepted digests. Every new open/CDP or
Nevermined attempt is v2 and binds:

- payment rail;
- versioned provider identity;
- Nevermined agent and plan IDs when the rail is Nevermined;
- all pre-existing quote, requirement, service, input, resource, network, asset,
  amount, and payee fields.

Changing rail/provider/agent/plan with the same Payment-Identifier is a
conflict. It does not expose or reconstruct the earlier result.

PaymentServiceLink v2 adds the same rail fields to the existing job, output,
receipt, UsageResult, verification-evidence, and settlement-evidence chain. PCC
receipts remain unchanged and rail-agnostic.

## Evidence and secrets

External trust classification is independent of rail selection. A selected
provider must still return evidence accepted as `external_verified`; fixtures
cannot manufacture that trust class through the public protocol constructor.

Nevermined access tokens and API keys are ephemeral inputs. They are excluded
from D1, evidence hashes, links, fixtures, reports, logs, and errors. Sanitized
evidence retains only bounded public fields such as provider, rail, payment
identifier, plan/agent, payer, network, result, public transaction reference,
amount redeemed, and a bounded reason code.

## Current state

The CDP rail has accepted live Base Sepolia exact and upto evidence. The
Nevermined rail now has a deterministic Edge provider, official-SDK adapter, and
exactly four explicit local fixture-test routes through the shared lifecycle.
Its fixture provider cannot produce external trust, and the default application
fails closed without an authenticated sandbox provider. No Nevermined account,
credential, registration, network verification, or settlement has occurred.
Production remains disabled and not ready.

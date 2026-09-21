# MCP Tool Contracts

The MCP server name is `net.siteborne/utility`, version `0.1.0`. Its tool
inventory is immutable for SUN-0800A checkpoint 1: exactly four paid utility
tools plus quote and health.

| Tool                                       | Contract boundary                                     | Local behavior                                                                                                                                |
| ------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `siteborne_build_company_evidence_graph`   | `company_evidence_graph.v1` frozen input/output       | Calls the injected paid-service boundary; closed default returns `payment_required`                                                           |
| `siteborne_retrieve_verified_web_context`  | `web_context_verified.v1` frozen input/output         | Calls the injected paid-service boundary; closed default returns `payment_required`                                                           |
| `siteborne_extract_document_evidence_json` | `document_evidence_json.v1` frozen input/output       | Calls the injected paid-service boundary; closed default returns `payment_required`                                                           |
| `siteborne_verify_agent_output`            | `verify_agent_output.v1` frozen input/output          | Calls the injected paid-service boundary; closed default returns `payment_required`                                                           |
| `siteborne_get_quote`                      | Canonical pricing and x402 quote/requirement builders | Returns an exact charge or an `upto` authorization ceiling; never claims an actual `upto` charge before execution                             |
| `siteborne_get_service_health`             | Local protocol and production-state boundary          | Reports protocol readiness and each service's effective version-local production state from the same governed resolver used by REST discovery |

## Naming convention

Every tool name is `siteborne_<verb>_<noun phrase>`. The verb states what the
call does and matches the verb that opens the tool description:

| Tool verb  | Meaning                                                                               |
| ---------- | ------------------------------------------------------------------------------------- |
| `build`    | synthesize a company evidence graph across sources                                    |
| `retrieve` | fetch and verify one public web URL                                                   |
| `extract`  | extract evidence from one authorized document                                         |
| `verify`   | evaluate a supplied agent output                                                      |
| `get`      | read-only lookups that neither execute nor charge (`get_quote`, `get_service_health`) |

`get_` is reserved for the two tools annotated `readOnlyHint: true`. The four
paid service tools are `readOnlyHint: false` (they persist governed payment,
audit and job state), so they must not use `get_`.

## Frozen service schemas

Service inputs are the exact bundled schemas exported by
`@siteborne/protocol-x402`, which derives them from the frozen `1.0.0` service
contracts. Service outputs are the same frozen `1.0.0` output schemas with the
PCC and money references embedded under `$defs`, so each MCP output schema is
self-contained. Tests compile all four schemas and validate their accepted
frozen examples.

Schema metadata uses the accepted SITEBORNE service schema URIs. No second
MCP-specific service wire shape is maintained.

## Quote semantics

`siteborne_get_quote` accepts:

- a frozen service ID;
- `exact` or `upto`;
- the service input to bind.

It resolves the accepted pricing key from `@siteborne/pricing`, hashes the input
through the accepted x402 canonicalization boundary, constructs a canonical
quote, and constructs the selected payment requirement. The result binds the
quote, requirement, service, input, pricing source, network, asset, payee,
resource, issue time, and expiration.

For `exact`, `amount_kind` is `exact`. For `upto`, `amount_kind` is
`authorized_maximum` and `actual_amount` is `null`: actual usage can only be
known after the paid service executes. The quote tool does not verify or settle
a payment.

## Health semantics

`siteborne_get_service_health` reports:

- `status: ready_local`;
- MCP protocol `2026-07-28`;
- six tools;
- `implementation: real_executor` only for services with a governed Worker
  production composition; the older `local_fixture_verified` value remains for
  services without one;
- `production: production_enabled` only when that service's version-local route,
  production-authorization, binding, signing, and credential-presence gates all
  pass; otherwise `production_disabled`;
- `external: configured` when those synchronous external-dependency presence
  gates pass, without performing a live provider call from discovery;
- `external_publication: blocked_external`;
- `production_ready: false`;
- `production_enabled: true` when at least one governed production service is
  effectively active, otherwise `false`.

Callers must not interpret local MCP health as deployment, registry publication,
customer use, revenue, or production readiness.

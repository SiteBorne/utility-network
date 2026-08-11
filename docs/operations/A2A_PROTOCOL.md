# SITEBORNE A2A protocol

## Status and scope

SITEBORNE implements the credential-independent A2A 1.0 JSON-RPC foundation at
`POST /a2a`. The implementation uses `@a2a-js/sdk` 1.0.1 and the SDK's official
framework-neutral request handler, executor, task store, transport handler,
client, card canonicalization, and signing/verification APIs. The edge adapter
is Hono; there is no Express or Node HTTP server dependency.

This is local protocol evidence only. `production_ready` and
`production_enabled` remain `false`; the canonical
`https://utility.siteborne.net/a2a` identity is not claimed publicly deployed.

## Wire binding

- Binding: A2A v1 `JSONRPC`
- Route: `POST /a2a`
- Required version: `A2A-Version: 1.0`
- Request content type: `application/json` or `application/a2a+json`
- Response content type: `application/a2a+json`
- Supported operation: `SendMessage`
- v0.3 compatibility: disabled
- Streaming/push/extended-card support: disabled

Protocol version is declared on `supportedInterfaces[]`, not as a legacy
top-level Agent Card field. Wire `Part` objects use member presence (`data`,
`text`, `raw`, or `url`) and never emit a legacy `kind` discriminator.

## Structured invocation

SITEBORNE selects a service only from a current A2A `DataPart`. A minimal v1
JSON-RPC request has this semantic shape:

```json
{
  "jsonrpc": "2.0",
  "id": "request-1",
  "method": "SendMessage",
  "params": {
    "message": {
      "messageId": "caller-message-1",
      "role": "ROLE_USER",
      "parts": [
        {
          "data": {
            "skillId": "company_evidence_graph.v1",
            "serviceVersion": "v1",
            "input": {}
          },
          "mediaType": "application/json"
        }
      ]
    }
  }
}
```

The example's `input` is illustrative; actual requests must satisfy the frozen
schema for the selected skill. Exactly one structured DataPart is required.
Natural-language `TextPart` selection fails closed rather than guessing a paid
service.

The exact skills are:

1. `company_evidence_graph.v1` — exact x402 policy
2. `web_context_verified.v1` — exact x402 policy
3. `document_evidence_json.v1` — upto x402 policy
4. `verify_agent_output.v1` — exact x402 policy

Card skill metadata is composed from the accepted registry. Input validation
uses the frozen service schemas. Payment-mode mapping uses the accepted
executable Bazaar policy rather than the stale broad `pricing_schemes` arrays.

## Payment and no-free-use boundary

A2A authentication and x402 payment authorization are separate. The local route
has no identity authentication requirement, so the card declares empty
`securitySchemes` and `securityRequirements`. It does not fabricate OAuth or an
API-key scheme.

The caller may carry opaque payment context in the SITEBORNE invocation
envelope, but only the accepted x402/D1 execution boundary may verify it. The
default edge route always returns a structured A2A task with
`TASK_STATE_INPUT_REQUIRED`, `payment_required`, no artifact, and zero useful
service execution. A spoofed `verified` or `production_enabled` value cannot
bypass the boundary.

Fixture execution exists only through an explicitly injected test boundary. A
fulfilled fixture request returns a terminal `TASK_STATE_COMPLETED` task and a
structured artifact. It is not production execution.

## State, duplicates, and isolation

Each POST constructs a fresh SDK executor, task store, request handler, and
transport handler. The app caches only immutable discovery signing material.
Independent clients therefore cannot read another client's task, message,
artifact, request metadata, or injected context.

A2A does not create another payment replay store. `messageId` is propagated for
correlation, while the accepted Payment-Identifier/D1 layer remains the sole
authority for a paid duplicate. Tests inject a D1-style reconstructing boundary
and prove the same logical message yields one service execution and the prior
result.

## Bounds and errors

The adapter rejects malformed JSON, unsupported A2A versions, v0.3 methods,
invalid Part oneofs, hostile object keys, structured data over 64 KiB, requests
over 256 KiB, unknown skills, wrong schemas, hostile hosts/origins, and payment
bypass attempts. Boundary exceptions become the sanitized `repository_error`;
raw provider diagnostics, stack traces, credentials, and payment authorizations
are not returned.

## Validation

```sh
pnpm a2a:test
pnpm a2a:fixtures:verify
pnpm a2a:spec:verify
pnpm a2a:check
```

All normal commands are credential-free and network-free.

Primary protocol references: the official
[A2A specification](https://github.com/a2aproject/A2A/blob/main/docs/specification.md),
[A2A JS SDK releases](https://github.com/a2aproject/a2a-js/releases), and
[`@a2a-js/sdk` package](https://www.npmjs.com/package/@a2a-js/sdk).

# ADR 0053: A2A v1 Hono transport, local signing, and x402 extension

- Status: accepted for SUN-0800A credential-independent implementation
- Date: 2026-08-10

## Context

The immutable SITEBORNE directive requires a signed A2A Agent Card, four exact
skills, `POST /a2a`, and discovery at `/.well-known/agent-card.json`. The
accepted edge runtime is Hono on Cloudflare Workers. The official `@a2a-js/sdk`
1.0.1 server package exposes framework-neutral `AgentExecutor`,
`DefaultRequestHandler`, `JsonRpcTransportHandler`, and task-store primitives,
while its packaged web adapter is Express-oriented. A2A core does not define a
native payment field, and the repository did not freeze an A2A x402 extension
URI.

The project must not duplicate its accepted x402 payment, Payment-Identifier, D1
replay, service-runtime, PCC, or receipt boundaries. It must also avoid
committing or inventing a production Agent Card key while SUN-0800B remains
externally blocked.

## Decision

1. Use A2A 1.0 JSON-RPC at the single immutable `POST /a2a` route. Only current
   operation names such as `SendMessage` are accepted; the v0.3 compatibility
   layer is disabled.
2. Wrap the official framework-neutral JSON-RPC handler in a minimal Hono
   adapter. No Express or Node HTTP server is added to edge execution.
3. Build the Agent Card from the existing frozen service registry, OpenAPI
   routes, and executable Bazaar payment policy. The card advertises exactly the
   four immutable service IDs and no authentication scheme that does not exist.
4. Identify SITEBORNE's A2A payment declaration with the versioned product URI
   `https://siteborne.net/extensions/a2a/x402/v1`. This is explicitly a
   SITEBORNE-owned binding carried by the standard `AgentExtension` mechanism,
   not a claim that A2A or x402 standardized the URI. It is optional
   (`required: false`) and truthfully states x402 v2, exact/upto service
   mapping, payment-required execution, and production-disabled status.
5. Use a dedicated ephemeral P-256/ES256 A2A signing identity for local tests.
   The private key is non-exportable and closure-scoped. Publish only the public
   JWK at the local `/.well-known/jwks.json` route. The protected JWS header
   uses a meaningful `kid` and the canonical future SITEBORNE `jku`.
6. Use the SDK's Agent Card signing, verification, normalization, and RFC
   8785/JCS canonicalization path. Do not sign ordinary `JSON.stringify` output.
7. Cache only the immutable local signer/card/JWKS per Hono app instance.
   Construct a fresh executor, `InMemoryTaskStore`, request handler, and
   JSON-RPC handler for every POST so clients cannot share task state.
8. Use a structured `DataPart` envelope containing `skillId`, `serviceVersion`,
   and `input`. The input is validated against the accepted frozen service
   schema. Natural-language selection is not inferred.
9. Keep the default service boundary closed. A missing/claimed payment returns
   `TASK_STATE_INPUT_REQUIRED`, no artifact, and zero useful work. A caller's
   opaque `payment` member cannot manufacture verification.
10. Do not create an A2A replay ledger. Paid deduplication remains authoritative
    at the existing Payment-Identifier/D1 boundary injected behind the execution
    interface. A2A `messageId` is carried into that boundary for correlation.

## Artifact separation

- A2A Agent Card JWS proves integrity of advertised agent metadata.
- A SITEBORNE PCC receipt proves a service result's verification evidence.
- x402 `PAYMENT-RESPONSE` and settlement evidence prove payment settlement.

None substitutes for another, and the implementation uses distinct types and
modules for each.

## Consequences

- Deterministic tests need no network, account, wallet, CDP, Nevermined, DNS, or
  public JWKS fetch.
- The local canonical URLs are identity declarations only; they are not evidence
  of public deployment.
- Production key custody, rotation, public TLS/DNS reachability, and publication
  remain SUN-0800B work.
- Streaming, push notifications, extended Agent Cards, and A2A authentication
  remain unadvertised and unimplemented.

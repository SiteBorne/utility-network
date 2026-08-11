# MCP Protocol Foundation

SITEBORNE's credential-independent MCP checkpoint implements the final Model
Context Protocol revision `2026-07-28` with the official TypeScript SDK v2
packages:

- `@modelcontextprotocol/server@2.0.0`
- `@modelcontextprotocol/client@2.0.0`
- `@modelcontextprotocol/hono@2.0.0`

The normative drift fixture is
`packages/protocol-mcp/fixtures/mcp-spec-baseline.json`. It pins the protocol
revision, SDK versions, server name, six-tool surface, required mirrored
headers, and official source URLs. `pnpm mcp:spec:verify` fails if
implementation constants or package declarations drift from that fixture.

## HTTP transport

The local Edge API mounts the remote transport at `POST /mcp`. It uses the
official Hono adapter and the modern per-request Streamable HTTP model. Each
request creates a fresh `McpServer`; no transport session or prior-client state
is reused.

Modern requests must carry:

- `MCP-Protocol-Version: 2026-07-28`
- `Mcp-Method` matching the JSON-RPC method
- `Mcp-Name` matching the requested tool for `tools/call`

Header/body disagreement fails with the protocol `HeaderMismatch` code `-32020`.
Missing mirrored headers, unsupported versions, unknown methods, malformed JSON,
hostile object keys, disallowed hosts/origins, and oversized Edge API bodies
fail before service execution. The transport does not enable legacy fallback.

The implementation follows the official
[2026-07-28 Streamable HTTP transport](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx)
and
[TypeScript SDK v2 migration guidance](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md).

## Isolation and security boundary

The client name and version are read only from the validated
`io.modelcontextprotocol/clientInfo` envelope field. They are diagnostic
invocation context, never authorization input. Concurrent clients receive fresh
server instances and cannot recover another client's metadata or results.
Repeated stateless health calls reconstruct the same public result without
creating shared session state.

The four utility tools cross one injectable `McpServiceExecutionBoundary`. The
Edge API deliberately uses its closed default: a useful invocation returns
`payment_required`; it cannot execute a production service for free. A
configured seller address enables canonical quote construction only. It does not
enable verification, settlement, fulfillment, external publication, deployment,
or production.

No normal MCP test uses a network payment call. The tests use the official
client against in-process Hono fetch, or a child-process stdio transport with an
environment reduced to `PATH`. `RUN_LIVE_X402` is explicitly removed from all
validation commands.

## Local validation

Run:

```sh
pnpm mcp:test
pnpm mcp:test:property
pnpm mcp:spec:verify
pnpm mcp:check
```

`pnpm mcp:check` validates the protocol package, the actual Edge API `/mcp`
route, registry metadata, a real stdio child process, `npm pack`, and an offline
install of the produced tarball.

Production remains `production_ready: false` and `production_enabled: false`.
There is no public MCP endpoint claim in this checkpoint.

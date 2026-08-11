# SUN-0800A Checkpoint 1 — MCP Foundation Report

## Outcome

SUN-0800A checkpoint 1 implements the credential-independent MCP foundation. It
does not implement A2A, publish an npm package, contact the MCP Registry, deploy
a public endpoint, call Nevermined, or change production state.

The preceding governance correction is recorded separately as commit `c6f8124`
(`chore(tasks): split MCP A2A implementation from publication`). SUN-0800A
remains the only active task. SUN-0800B retains external publication and
deployment blockers. SUN-0900 retains Nevermined.

## Protocol baseline

- MCP protocol: `2026-07-28`
- Server SDK: `@modelcontextprotocol/server@2.0.0`
- Client SDK: `@modelcontextprotocol/client@2.0.0`
- Hono adapter: `@modelcontextprotocol/hono@2.0.0`
- Server name: `net.siteborne/utility`
- Server version: `0.1.0`
- Transport: modern per-request Streamable HTTP
- Local route: `/mcp`
- npm shim: `@siteborne/mcp-server@0.1.0`, prepared locally and not published

The spec fixture pins the final revision, SDK packages, headers,
`HeaderMismatch` code, official sources, server identity, and exact tool
inventory.

## Tool and boundary evidence

The server lists exactly:

1. `siteborne_company_evidence_graph`
2. `siteborne_web_context_verified`
3. `siteborne_document_evidence_json`
4. `siteborne_verify_agent_output`
5. `siteborne_get_quote`
6. `siteborne_get_service_health`

The four utility tools use the accepted frozen input/output schemas and cross
one injected service execution boundary. The production-facing Edge route
supplies no free fixture executor: its closed default returns
`payment_required`. Targeted tests prove accepted fixture results can cross the
seam and invalid inputs or invalid outputs fail closed without reaching or
escaping the service boundary.

The quote tool uses `@siteborne/pricing` and `@siteborne/protocol-x402` for
canonical prices, hashes, quotes, exact requirements, and `upto` requirements.
It preserves the distinction between an `upto` authorization ceiling and an
execution-derived actual charge. The health tool reports all four services and
production false.

## Transport and adversarial evidence

The official modern client drives both the in-process Hono route and the
child-process stdio shim. Coverage proves:

- exact six-tool discovery;
- all four frozen utility tool calls through the injected boundary;
- canonical exact and `upto` quotes;
- truthful health;
- fresh server creation per request;
- two-client metadata isolation and deterministic stateless reconstruction;
- mirrored method/name mismatch rejection with `-32020`;
- missing mirrored header rejection;
- unsupported protocol rejection;
- unknown tool and RPC rejection;
- malformed JSON rejection;
- invalid input and output-schema rejection;
- hostile object-key rejection;
- disallowed Origin rejection;
- Edge API 10 MiB body ceiling enforcement;
- no ambient network calls;
- property coverage over mismatched tool-name headers.

## Packaging evidence

`packages/mcp-server/server.json` uses the MCP Registry schema dated
`2025-12-11`. Its name, version, npm identifier, stdio transport, and package
`mcpName` are checked for exact agreement. The Registry preparation follows the
official
[server publication quickstart](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx),
but no publication or registry request is performed.

The stdio entry is bundled as a self-contained executable. The package gate
builds it, runs a real official-client child process, creates an npm tarball,
installs that tarball in a fresh temporary directory with npm's offline mode,
launches the installed binary, and verifies all six tools. Temporary install
state is removed after the proof.

The PCC schema source now uses a static JSON import rather than a
repository-relative runtime file read. Its content and public API are unchanged,
while the npm shim can carry the accepted canonical schema without depending on
the monorepo's directory layout. All 117 targeted PCC schema tests remain green.

## State and exclusions

- SUN-0800A: active; MCP checkpoint complete, A2A not started
- SUN-0800B: blocked external; no npm/public endpoint/Agent Card publication
- SUN-0900: pending; Nevermined not contacted
- production ready: false
- production enabled: false
- live x402 flag: disabled for validation
- mainnet activity: none
- external publication/deployment: none
- customer/revenue claim: none

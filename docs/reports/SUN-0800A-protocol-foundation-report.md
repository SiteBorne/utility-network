# SUN-0800A credential-independent protocol foundation report

## Acceptance scope

SUN-0800A was decomposed from the original coarse SUN-0800 task so locally
provable MCP/A2A implementation would not be falsely blocked on Nevermined. This
report joins the two credential-independent checkpoints:

- Checkpoint 1: accepted MCP foundation, implementation commit
  `12cd3e21a5302a378448099b96010dd5fb6d9e3f`; detailed evidence remains in
  `docs/reports/SUN-0800A-checkpoint-1-mcp-report.md`.
- Checkpoint 2: A2A v1 JSON-RPC, signed local Agent Card, official client round
  trip, structured four-skill dispatch, and closed payment boundary.

External npm publication, public MCP/Agent Card reachability, production A2A key
custody, TLS/DNS, and registry evidence remain SUN-0800B. Nevermined remains
SUN-0900 and was not contacted.

## A2A baseline

- Specification: A2A 1.0
- Official SDK: `@a2a-js/sdk@1.0.1`
- Binding: JSON-RPC
- Operation: `SendMessage`
- Edge route: local Hono `POST /a2a`
- Discovery: local Hono `GET /.well-known/agent-card.json`
- Key discovery: local Hono `GET /.well-known/jwks.json`
- v0.3 compatibility: disabled
- Streaming/push/extended card: disabled
- Authentication schemes: none declared
- Production: not ready and not enabled

The Hono adapter uses official framework-neutral SDK primitives and adds no
Express or Node HTTP server. Every POST receives a fresh executor, task store,
request handler, and JSON-RPC handler.

## Immutable skills and payment mapping

| Skill                       | Executable x402 mode | Default A2A behavior          |
| --------------------------- | -------------------- | ----------------------------- |
| `company_evidence_graph.v1` | exact                | payment required; no artifact |
| `web_context_verified.v1`   | exact                | payment required; no artifact |
| `document_evidence_json.v1` | upto                 | payment required; no artifact |
| `verify_agent_output.v1`    | exact                | payment required; no artifact |

Names, descriptions, tags, schema links, limitations, and production-disabled
status are composed from accepted registry/OpenAPI/x402 sources. The A2A card
does not copy a contradictory broad pricing array.

## Agent Card signature evidence

- Algorithm/curve: ES256 / P-256
- Key separation: dedicated runtime-only A2A key, not CDP, payer/payTo, PCC, or
  Nevermined material
- `kid`: `siteborne-a2a-local-es256-v1`
- JWKS: one public signing key, no private key member
- Canonicalization: official SDK v1 round trip, signature exclusion, RFC
  8785/JCS
- Valid card: local verification passes
- Unsigned/tampered/unknown-key/wrong-key/malicious-JKU/malformed-signature:
  fail closed
- Property order preserving semantic content: verification passes

The card JWS, PCC receipt signature, and x402 settlement evidence remain
separate proof domains.

## Transport and security evidence

The official `ClientFactory`, `DefaultAgentCardResolver`, and
`JsonRpcTransportFactory` discover the actual local Hono card, select the v1
JSON-RPC interface, send a structured DataPart, invoke the single SITEBORNE
dispatch boundary, and receive a valid A2A Task. Explicit fixture mode returns a
completed task artifact. The default edge route returns
`TASK_STATE_INPUT_REQUIRED`, `payment_required`, zero artifacts, and zero useful
work.

Coverage includes every skill; frozen input-schema enforcement; wrong-skill
rejection; malformed JSON-RPC; unsupported version; v0.3 shape; zero/multiple
Part alternatives; legacy `kind`; hostile keys; oversized data; unknown skill;
wrong schema; production spoofing; fake-payment bypass; malicious host/origin;
card/interface tampering; boundary failure sanitization; and service failure
mapping.

Two official clients receive distinct task/context IDs and only their own
artifact data. Duplicate paid-operation proof uses an injected D1-style
authoritative boundary: two calls with the same logical identity reconstruct the
first result and produce one useful execution. A2A does not create a second
payment replay ledger.

The edge discovery test also requests the Agent Card and JWKS concurrently and
verifies the fetched card against the fetched public key through the official
SDK. This caught and closed a first-request initialization race: the edge cache
now stores one shared app-initialization promise, so concurrent discovery can
never observe different ephemeral signing identities.

## Offline drift and validation gates

Machine-readable baselines:

- `packages/protocol-a2a/fixtures/a2a-agent-card-baseline.json`
- `packages/protocol-a2a/fixtures/a2a-spec-baseline.json`

Commands:

- `pnpm a2a:test`
- `pnpm a2a:fixtures:verify`
- `pnpm a2a:spec:verify`
- `pnpm a2a:check`

All deterministic A2A tests inject local key resolution and local Hono fetch.
They need no network, credentials, wallet, blockchain RPC, Nevermined, CDP, npm,
MCP Registry, DNS, public JWKS, or Cloudflare deployment.

Final pre-commit validation on 2026-08-10:

- A2A package: 30 deterministic tests passed; 6 bounded property tests passed;
  one machine Agent Card fixture verification passed; one offline spec drift
  verification passed.
- Edge A2A route: 2 tests passed, including concurrent card/JWKS verification
  and official-client no-free-use round trip.
- Root Vitest: 107 files passed, 2 live-x402 files skipped; 1,274 tests passed,
  12 skipped.
- Python PCC: 91 passed.
- Python modal/document worker: 81 passed.
- MCP regression: 30 protocol tests, 4 edge tests, one packed stdio test, and
  metadata/pack/spec verifiers passed.
- Full `pnpm check`: exit 0 with `RUN_LIVE_X402` absent.
- Secret scan: 730 tracked files covered before commit; git history ~4.72 MB and
  full directory ~11.57 MB, no leaks.

The implementation and bookkeeping commit hashes are recorded in
TASKS/PROJECT_STATE after their respective commits exist.

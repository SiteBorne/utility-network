# SUN-1221E5Q6B — HEADER_PARSE_EOF socket-lifecycle root cause

## §1 Lifecycle map (read-only, confirmed by direct source inspection)

`packages/provider-adapters/src/http/socket-http-client.ts`,
`SafeSocketHttpClient.fetch()`:

1. `validateUrl` (literal check, no network).
2. `connectIp` resolved via `resolveSafeAddress` (a separate DoH `fetch()`,
   not the socket).
… [elided ~13073 chars — call bookmark_read("bm_1c37fce908eb00c4") for the full content] ⟦bm_1c37fce908eb00c4⟧
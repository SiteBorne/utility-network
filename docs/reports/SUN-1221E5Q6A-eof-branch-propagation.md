# SUN-1221E5Q6A — safe EOF-branch propagation

## Source proof of the two branches (Q6, read-only)

`packages/provider-adapters/src/http/socket-http-client.ts` throws
`WEBCTX_HTTP_PREMATURE_EOF` from exactly two sites, both reacting to a
*clean* `reader.read()` → `done: true` (the platform's own signal that the
peer closed normally) arriving before this parser has what it needs:

| ID | Function | Condition | Message (verbatim) |
|---|---|---|---|
| `HEADER_PARSE_EOF` | `readResponse`'s header loop (line 229) | `done` while `headerEnd === -1` (CRLFCRLF never seen) | `WEBCTX_HTTP_PREMATURE_EOF: connection closed before response headers completed` |
| `CHUNKED_BODY_EOF` | `readChunkedBody`'s `ensure()` (line 323) | `done` while `buffered.length < minBytes` | `WEBCTX_HTTP_PREMATURE_EOF: connection closed mid-chunk` |

(`readUntil`/`readUntilClose` — the Content-Length and close-delimited body
paths — treat a clean `done` as the normal end of body, not an error; only
these two sites throw.)

## Why raw-message forwarding was rejected

`errors.ts`'s `toAdapterResult()` already preserves the full `error.message`
verbatim (both branch messages above survive unmodified into
`result.error.message`); only `error.code` is intentionally collapsed to the
generic `WEBCTX_HTTP_PREMATURE_EOF` tag. The observability gap was never in
the adapter layer — it was that `service.ts`'s failure-detail construction
(`httpDiagnosticDetails`, and the outer `message` template one line below it)
never read `result.error.message` at all, so the distinction that already
existed was silently dropped before reaching any diagnostic surface.

The approved scope for this checkpoint explicitly rejected exposing
`result.error.message` as a general passthrough (`result.error.message` is
not a closed enum across every adapter failure mode — DNS errors, TLS
errors, decompression errors, and others all flow through the same field,
and a generic diagnostic field carrying arbitrary platform text would widen
the production-facing surface indefinitely). Instead, this checkpoint adds
one new, closed, two-value field derived narrowly from only the two known,
source-verified `WEBCTX_HTTP_PREMATURE_EOF` message suffixes — everything
else maps to `undefined`, including any future third premature-EOF throw
site that doesn't match either known suffix (fails closed, never guesses).

## Implementation layer

```
EOF_BRANCH_PROPAGATION_IMPLEMENTATION_LAYER=B (adapter-result normalization boundary)
WHY_THIS_LAYER=
```

Chosen at `toAdapterResult()`'s generic-`Error` branch in `errors.ts`, via a
new exported `deriveEofBranchId(error: Error)` function, rather than:

- **(A) tagging at the two throw sites** — both currently `throw new
  Error(...)`, not `AdapterError` subclasses; giving them `AdapterError`'s
  `details` field would mean converting two `socket-http-client.ts` throw
  statements to a different error class, touching the file the approved
  scope explicitly protects ("no parser behavior change", "no socket
  behavior change") for a change that is purely about how an *already-
  thrown, already-classified* message is labeled downstream — disproportionate
  for what's needed.
- **(C) deriving it in `service.ts`** — would duplicate the classification
  rule `errors.ts` already owns in one place (`classifyGenericAdapterErrorReason`),
  risking future drift between `error.code` and `eof_branch_id` if either is
  edited without the other.

Layer B keeps exactly one function owning "what does this message mean",
consistent with the existing `classifyGenericAdapterErrorReason` pattern it
sits beside and delegates to.

## Contract

```ts
export type EofBranchId = 'HEADER_PARSE_EOF' | 'CHUNKED_BODY_EOF';
export function deriveEofBranchId(error: Error): EofBranchId | undefined;
```

`toAdapterResult()`'s generic-`Error` branch now includes
`error.eof_branch_id` **only** when `deriveEofBranchId` returns a value —
absent (not `null`, not `''`) for every other code, and for `AdapterError`
subclasses and non-`Error` throws (both untouched). `AdapterResultSchema`
(`types.ts`) gained one matching optional enum field, additive-only. No
existing field's name, type, or presence changed.

Propagation path: `errors.ts` → `public-http-adapter.ts` (unchanged,
forwards `error` as-is) → `service.ts`'s `httpDiagnosticDetails` (new
conditional spread, only present when `result.error?.eof_branch_id` is set)
→ `apps/edge-api/src/dev-diagnostics/webctx-remote-diagnostic.ts`'s JSON
response (new `eof_branch_id` field, read from `failure.details`).

## TDD RED (proven against unmodified source, not merely asserted)

Verified genuinely RED by `git stash`-ing all four source-changed files
(`errors.ts`, `types.ts`, `service.ts`, `webctx-remote-diagnostic.ts`) while
keeping the new tests, then running them against the stashed (original)
source:

```
provider-adapters: 5 failed | 30 passed (35)  — deriveEofBranchId is not a function (×3),
                                                  toAdapterResult never sets eof_branch_id (×2)
service-runtime:   2 failed | 37 passed (39)  — failure.details lacks eof_branch_id for both
                                                  known branches (the two negative-case tests
                                                  passed trivially, since the field never existed)
```

`git stash pop` restored the implementation; both suites re-run GREEN (below).

```
EOF_BRANCH_PROPAGATION_TDD_RED=YES
```

## GREEN

```
provider-adapters/src/tests/web-context-diagnostic-classification.test.ts: 35 passed (35)
service-runtime/src/services/web-context/service.test.ts:                  12 passed (12)
```

Covers: header-EOF → `HEADER_PARSE_EOF`; chunk-EOF → `CHUNKED_BODY_EOF`;
unrelated known code (`WEBCTX_UPSTREAM_CONNECTION_FAILED`) → absent;
genuinely unrecognized message → absent; `AdapterError` subclass → absent;
success path → absent; `resultClass`/`error.code`/`error.message`/existing
`diagnostic_reason_code`/`diagnostic_stage` all unchanged byte-for-byte.

```
EOF_BRANCH_PROPAGATION_GREEN=PASS
```

## Mutation-proof coverage

`web-context-diagnostic-classification.test.ts`'s new `describe` block is
this checkpoint's mutation-proof surface — it independently catches:

- either `HEADER_PARSE_EOF` or `CHUNKED_BODY_EOF` string literal removed or
  swapped with the other (both direct-equality assertions on
  `deriveEofBranchId`'s return value, plus a round-trip through
  `toAdapterResult`);
- the guard widened past `WEBCTX_HTTP_PREMATURE_EOF` (the "coincidental
  substring" test: a message containing `mid-chunk` that does *not* classify
  as `WEBCTX_HTTP_PREMATURE_EOF` must still return `undefined`);
- a generic/unrelated error accidentally acquiring an `eof_branch_id`
  (`Malformed status line`, `WEBCTX_UPSTREAM_CONNECTION_FAILED`, and
  `PolicyBlockedError` cases);
- the parent `WEBCTX_HTTP_PREMATURE_EOF` code itself changing (asserted
  alongside `eof_branch_id` in the same `toMatchObject`).

```
EOF_BRANCH_PROPAGATION_MUTATION_PROOF=PASS
```

## Compatibility / security proof

- `resultClass` stays `'permanent_failure'` for every generic-Error case —
  unchanged (SUN-1221E2D §7 invariant, re-verified by the same tests this
  checkpoint extends).
- `error.code`, `error.message`, `diagnostic_reason_code`,
  `diagnostic_stage`, `error_detail`, `failure.message` — all byte-for-byte
  unchanged for every existing case (existing test suites re-run GREEN,
  zero modifications to their assertions).
- No response field removed. No HTTP status mapping touched. No retry
  logic touched (`retryAfterMs` untouched; `isRetryableError` in
  `public-http-adapter.ts` not modified).
- `socket-http-client.ts` was not edited at all — zero diff. Its own four
  dedicated test files (`socket-http-client-premature-eof`,
  `socket-http-client-read-diagnostics`, `socket-http-client-fragmentation`,
  `web-context-transport-diagnostics`, 29 tests) re-run GREEN unmodified,
  proving no parser/socket/TLS/write/read/DNS/SSRF behavior changed.
- `result.error?.message` (the raw platform text) is never read, forwarded,
  or exposed anywhere in this diff — `eof_branch_id` is derived from it
  internally, purely to select one of two fixed string literals, and the
  raw text itself never crosses any new boundary.
- No headers, response bodies, or credentials touched by this change (none
  of the four edited files reference them).

```
EOF_BRANCH_CHANGE_ADDITIVE_ONLY=YES
ARBITRARY_ADAPTER_ERROR_MESSAGE_EXPOSED=NO
DIAGNOSTIC_SECRET_REACHABILITY=0
```

## Regression before live

```
pnpm test                          → 2439 passed | 38 skipped (198 files), 0 failed
pnpm --filter provider-adapters typecheck → clean
pnpm --filter service-runtime typecheck   → clean
apps/edge-api: tsc --project tsconfig.json (main app, excl. live-test project) → clean
pnpm lint                          → PASS (all packages)
pnpm test:worker-runtime           → 93/93 scenarios passed, including:
  ✓ production dry-run bundle does NOT contain the SUN-1221E5Q dev-only diagnostic seam
  ✓ zero hard-bypass fixture markers in production runtime
pnpm production:preflight          → PASS (before AND after the remote session)
pnpm secrets:scan                  → 2 pre-existing findings, both in old commits
  (a755620, 322852a, docs/reports/SUN-1221E2R*.md and SUN-1220O*.md) predating
  this checkpoint by two days and unrelated to any file this checkpoint
  touched; not newly introduced (confirmed absent from this diff's four
  changed source files and two new report/test additions)
```

`apps/edge-api`'s `tsconfig.live-tests.json` project independently fails
typecheck on `tests/live/web-context-first-paid-e2e-local.test.ts` (x402
`PaymentRequirements` branded-type mismatches) — reproduced identically with
this checkpoint's four source changes fully `git stash`-ed out, confirming
it is pre-existing and untouched by this checkpoint.

```
PRODUCTION_BUNDLE_DEV_DIAGNOSTIC_ISOLATION=PASS
```

## One remote read-back

`wrangler dev --remote` against the Q4/Q5R-proven corrected invocation
(override config: production's real bindings/vars, minus `routes` and
`[queues]`; `--var DIAGNOSTIC_SEAM_ENABLED:true`; `main` pointed at the
never-production-imported `webctx-remote-diagnostic.ts`). Inert control
first, then exactly one executor call against the fixed non-economic target:

```json
{
  "safe_socket_connect_called": true,
  "safe_socket_connect_returned": true,
  "service_execute_reached_verify_and_sign": true,
  "diagnostic_reason_code": "WEBCTX_HTTP_PREMATURE_EOF",
  "diagnostic_stage": "direct_public_http_fetch",
  "eof_branch_id": "HEADER_PARSE_EOF",
  "result_class": "internal_verification_failed",
  "elapsed_ms": 6
}
```

Real `cloudflare:sockets` connect to `172.66.147.243:443` (example.com's
resolved IP) succeeded in 5ms; the failure that follows is
`HEADER_PARSE_EOF` — the connection closed cleanly before a complete
response header block (`\r\n\r\n`) was ever seen.

## Branch-based fork

```
HTTP_ADAPTER_EOF_BRANCH_ID=HEADER_PARSE_EOF
NEXT_REQUIRED_CHECKPOINT=HEADER_EOF_SOCKET_LIFECYCLE_ROOT_CAUSE
```

Per the approved scope, this checkpoint does not speculate about *why* the
connection closed before headers completed (write half-close ordering,
partial-request delivery, peer behavior, etc.) — only that it does, and
specifically at the header-parse stage rather than mid-chunk. That causal
question is explicitly out of scope here and deferred to the named next
checkpoint.

## Zero economic effect

No 402 issued, no payment signature created, no EIP-3009 authorization, no
settlement, no worker version upload, no production deployment, no
production traffic change. Production stayed at
`de70bf98-f304-4d7f-b189-4ae2401041a0` @100% throughout, preflight PASS
before and after. The ephemeral diagnostic PCC signer (in-memory,
non-economic self-check only) ran as it has in every prior Q5/Q5R
checkpoint; nothing new was authorized or exercised on that path.

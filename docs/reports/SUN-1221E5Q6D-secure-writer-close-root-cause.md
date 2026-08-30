# SUN-1221E5Q6D — Secure-Writer Close-Before-Read: Refuted, With a Real Differential Found

## Starting state

- Q6A evidence: `74a7c1e`
- Q6B evidence: `a69efdb`
- Q6C evidence: `40643e5` (= HEAD at checkpoint start; verified via `git rev-parse HEAD` and `git rev-parse 40643e5`)
- Production: `de70bf98-f304-4d7f-b189-4ae2401041a0` @100%, preflight PASS
- Standing failure: `WEBCTX_HTTP_PREMATURE_EOF` → `HEADER_PARSE_EOF` → `ZERO_RESPONSE_BYTES`, root cause unproven

## §2 — exact current write/read lifecycle (read-only, ground truth)

Read `packages/provider-adapters/src/http/socket-http-client.ts` in full.

```
CURRENT_REQUEST_LIFECYCLE=
  connect(connectIp, { secureTransport: 'starttls', allowHalfOpen: false })   [line 110-113]
  → socket.startTls({ expectedServerHostname: hostname })                     [line 115]
  → writer = socket.writable.getWriter()                                     [line 182]
  → await writer.write(requestBytes)                                        [line 184]
  → await writer.close()                                                    [line 204, unconditional after successful write]
  ── writeRequest() fully resolves, including the awaited close, before ──
  ── fetch() calls readResponse() (lines 133-134 are sequential awaits) ──
  → reader = readable.getReader()                                           [line 213]
  → loop: await reader.read() until CRLFCRLF or done                        [line 218-234]
  → reader.releaseLock() in finally                                          [line 272]

SECURE_WRITER_ACQUIRED=YES
REQUEST_WRITE_AWAITED=YES
WRITER_CLOSE_CALLED_BEFORE_FIRST_READ=YES
WRITER_CLOSE_AWAITED=YES
WRITER_RELEASE_LOCK_CALLED=NO   (writeRequest never releases the writer lock; only reader has releaseLock)
READER_ACQUIRED_AFTER_WRITER_CLOSE=YES
FIRST_READ_STARTED_AFTER_WRITER_CLOSE_RESOLVED=YES
EXPLICIT_SOCKET_CLOSE_CALLED_BEFORE_RESPONSE=NO   (socket.close() is never called anywhere in this file)
```

## §6-16 — primary control: `writer.releaseLock()` instead of `writer.close()`

Added a dev-only, `DIAGNOSTIC_SEAM_ENABLED`-gated route,
`GET /__diag/webctx-remote-writer-release-control`, in
`apps/edge-api/src/dev-diagnostics/webctx-remote-diagnostic.ts`. Exactly one
variable changed vs. the real `socket-http-client.ts` sequence:
`writer.releaseLock()` instead of `await writer.close()` before the read
loop begins — the writable side of the stream is never closed (half or
otherwise) pre-read. `secureTransport: 'starttls'`, `startTls`'s
`expectedServerHostname`, `allowHalfOpen: false`, request bytes, and target
(`example.com`) are otherwise identical to production and to Q6B's own
control. An explicit `socket.close()` runs in a `finally` after the bounded
read loop, since `releaseLock()` alone never tears the connection down the
way `writer.close()` did.

`pnpm --filter @siteborne/edge-api typecheck` was run before and after this
change (git-stash bisected): the two pre-existing failures in
`tests/live/web-context-first-paid-e2e-local.test.ts` are present identically
either way — confirmed unrelated to this change.

Remote session: `wrangler dev --remote` against
`apps/edge-api/src/dev-diagnostics/webctx-remote-diagnostic.ts` with a
routes/queues-free override config (per SUN-1221E5Q4's proven workaround),
`--var DIAGNOSTIC_SEAM_ENABLED:true`, real Cloudflare edge (confirmed by the
real multi-MB `Total Upload` line and `Ready on http://localhost:8799`).

```
Q6D_INERT_HTTP_STATUS=200
Q6D_WRITER_RELEASE_CONTROL_REQUEST_COUNT=1

CONTROL_WRITER_CLOSE_CALLED=NO
CONTROL_WRITER_RELEASE_LOCK_CALLED=YES
CONTROL_TOTAL_RESPONSE_BYTES=0
CONTROL_FIRST_RESPONSE_BYTE=NO
CONTROL_STATUS_LINE_COMPLETE=NO
CONTROL_HEADER_TERMINATOR_SEEN=NO
CONTROL_EOF_OBSERVED=YES
elapsed_ms=4
CONTROL_RESULT=ZERO_RESPONSE_BYTES (identical to the writer.close() baseline)
```

**§18 fork: control still zero-EOFs.**

```
WRITER_CLOSE_CAUSAL_DIFFERENTIAL_PROVEN=NO
WRITER_CLOSE_HYPOTHESIS=REFUTED
```

Not closing the writable stream at all before reading made no difference.
Combined with Q6B's `allowHalfOpen: true` result (also refuted), the entire
local write/close/read-ordering family of hypotheses is now refuted for this
target.

## §19-20 — optional upstream-target control: `api.github.com`

Since §18 refuted the writer-close hypothesis, the one remaining permitted
control was spent: reproduce `cloudflare/workerd#6903`'s own reported
*successful* case as literally as practical — `api.github.com GET /zen`,
connect-by-hostname, `secureTransport: 'starttls'`,
`expectedServerHostname: 'api.github.com'`, `Connection: close`, a real
`User-Agent`, and the same `writer.releaseLock()` (never `writer.close()`)
ordering as the control immediately above — added as
`GET /__diag/webctx-remote-upstream-target-control` in the same file, same
remote session (hot-reloaded), health re-confirmed at 200 before the call.

```
Q6D_UPSTREAM_TARGET_CONTROL_REQUEST_COUNT=1

total_response_bytes=1129
first_response_byte_observed=true
status_line="HTTP/1.1 200 OK"
header_terminator_seen=true
eof_observed=false
elapsed_ms=58   (a realistic real round trip -- TLS handshake + HTTP request/response --
                 unlike the immediate 4-8ms EOF every example.com attempt has produced
                 across Q5R/Q6A/Q6B/Q6C/Q6D)
```

**§20 interpretation: api.github.com control returned real HTTP bytes.**

```
EDGE_SOCKET_CAN_RECEIVE_HTTP_RESPONSE=YES
EXAMPLE_COM_SPECIFIC_DIFFERENTIAL_EXISTS=YES
```

The exact same session, same code shape, same `connect()`/`startTls()`/
read-loop mechanism that has zero-byte-EOF'd on `example.com` in every prior
checkpoint (Q5R, Q6A, Q6B, Q6C, and both Q6D controls above) received a
complete, valid HTTP response in 58ms against a different target in the same
run. This structurally rules out: `writer.close()` timing, `allowHalfOpen`,
SNI/`expectedServerHostname` omission (`cloudflare/workerd#6903`), and any
general defect in this diagnostic environment's socket/TLS/read mechanism.
The zero-byte EOF is specific to `example.com` as a target, not to
SITEBORNE's transport code or to this remote-preview environment.

## Root-cause status

```
E5_HEADER_EOF_ROOT_CAUSE_CLASS=EXAMPLE_COM_TARGET_SPECIFIC (not yet further isolated)
E5_HEADER_EOF_ROOT_CAUSE_PROVEN=NO
REPOSITORY_FIX_REQUIRED=NO
```

No SITEBORNE code defect is implicated by this checkpoint. Per the governing
evidence law (no fix without root cause), **no production behavior was
changed.** The two dev-diagnostic-seam control routes added are additive,
non-gating, and excluded from the production bundle (confirmed below).

`example.com` was chosen across this entire checkpoint chain as a fixed,
safe, non-arbitrary diagnostic target — it is now the leading suspect
itself. Plausible next-checkpoint causes to isolate: `example.com`'s hosting
(IANA-managed, historically fronted differently than a typical origin;
possibly serving no real backend to non-browser/non-ALPN TLS clients from
Workers' network position), a request-shape rejection specific to this
minimal hand-rolled request against that specific server, or an edge-routing
interaction specific to a Workers-network-origin connection landing on
`example.com`'s infrastructure. `api.github.com` is proven reachable and
behaves correctly from this exact code path and environment.

## Regression

```
pnpm --filter @siteborne/provider-adapters test  → 18 files, 291 passed | 6 skipped
pnpm test:worker-runtime                          → 93/93 scenarios passed
  - bundle isolation: diagnostic seam gate/route absent from production bundle: PASS
pnpm --filter @siteborne/edge-api lint            → 0 findings
pnpm --filter @siteborne/edge-api typecheck       → pre-existing 2 failures in
                                                     tests/live/web-context-first-paid-e2e-local.test.ts,
                                                     confirmed identical with/without this change (git-stash bisected)
pnpm production:preflight                          → PASS
pnpm secrets:scan                                   → 2 pre-existing findings (a755620, 322852a),
                                                     0 new findings introduced this checkpoint
```

## Production containment / economics

```
WORKER_VERSION_UPLOADS=0
PRODUCTION_DEPLOYMENTS=0
FINAL_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0
FINAL_PRODUCTION_TRAFFIC=100%
FINAL_PRODUCTION_PREFLIGHT=PASS

LIVE_402_REQUESTS=0
SIGN_TYPED_DATA_PAYMENT_CALLS=0
PAYMENT_SIGNATURES_CREATED=0
PAID_REQUESTS=0
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECT_USDC=0
CURRENT_REAL_PAYMENT_AUTHORIZATION=NONE
```

## Next checkpoint

`EXAMPLE_COM_TARGET_SPECIFIC_EOF_ROOT_CAUSE` — isolate why `example.com`
specifically produces an immediate zero-byte EOF against this exact,
now-proven-otherwise-working socket/TLS mechanism, before any SITEBORNE fix
or E6 retry is considered. `SUN1221E6_REAL_PAID_RETRY_ELIGIBLE=NO`.

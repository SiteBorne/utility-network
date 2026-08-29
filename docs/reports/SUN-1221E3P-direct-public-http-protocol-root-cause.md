# SUN-1221E3P — direct-public-http protocol-error forensics

**Read-only investigation + diagnostic-only instrumentation. No production candidate request, no 402, no payment, no signature, no settlement, no traffic shift, no canary, no promotion.**

## 0. Starting evidence

`SUN1221E3R_EVIDENCE_COMMIT_SHA=33a5c9c3290e1532e1c228b1205e5c9fd59f9266`

All eleven required literals from that report were re-verified against the committed text before this checkpoint began (executor invoked, TermsGuard passed, `WEBCTX_UPSTREAM_PROTOCOL_ERROR` / `direct_public_http_fetch`, facilitator `settle()` never called, zero settlement/result/receipt, zero buyer USDC delta, old authorization expired/unused/retired, production restoration PASS, `SUN1221F_PUBLIC_CANARY_ELIGIBLE=NO`). All matched exactly — no reconciliation needed.

Production containment before any investigation work: `de70bf98-f304-4d7f-b189-4ae2401041a0 @ 100%`, single active version, `pnpm production:preflight` → PASS.

## 1. Exact protocol-error origin

`WEBCTX_UPSTREAM_PROTOCOL_ERROR` is produced by `classifyGenericAdapterErrorReason()` in [`packages/provider-adapters/src/errors.ts`](../../packages/provider-adapters/src/errors.ts) — the fallback return (line 135, pre-fix) when a thrown `Error`'s message matches none of `WEBCTX_DIAGNOSTIC_REASON_PATTERNS`. It is not itself a throw site; it is the *absence* of a match.

**PROTOCOL_ERROR_FILE** = `packages/provider-adapters/src/errors.ts`
**PROTOCOL_ERROR_FUNCTION** = `classifyGenericAdapterErrorReason`
**PROTOCOL_ERROR_THROW_OR_RETURN_SITE** = final `return 'WEBCTX_UPSTREAM_PROTOCOL_ERROR';` (fallback, not a throw)
**PROTOCOL_ERROR_CURRENT_CAUSE_PRESERVATION** = YES (`toAdapterResult` always preserves `error.message` verbatim in `result.error.message`, even when the *code* is the generic fallback)
**PROTOCOL_ERROR_LOW_LEVEL_BRANCH_COUNT** = 13 explicit `throw new Error(...)` sites in `socket-http-client.ts`, of which **2 pre-fix matched no classification pattern** (fell through to the generic bucket), plus a structurally distinct **third class** found during this investigation (see §3).

### Enumerated branches (pre-fix)

| ID | File | Function | Condition | Matched a pattern? |
|----|------|----------|-----------|---------------------|
| B1 | socket-http-client.ts:91 | `fetch` | non-GET method | N/A — real caller (`PublicHttpAdapter`) only ever issues GET; `CAN_PRODUCE_E3_FAILURE=NO` |
| B2 | socket-http-client.ts:99 | `fetch` | literal-IP/URL policy rejection | YES (`URL validation failed`) |
| B3 | socket-http-client.ts:127 | `fetch` (connect/TLS catch) | raw `connect()`/`startTls()` throw | YES (E2D tag, `WEBCTX_UPSTREAM_CONNECTION_FAILED:`) |
| B4 | socket-http-client.ts:142 | `resolveOrThrow` | DNS safety-policy rejection | YES (`DNS resolution failed safety policy`) |
| B5 | socket-http-client.ts:182 | `writeRequest` (write catch) | raw `writer.write()` throw | YES (E2D tag, `WEBCTX_REQUEST_WRITE_FAILED:`) |
| **B6** | socket-http-client.ts:203 | `readResponse` | `reader.read()` returns `done` before header CRLFCRLF found | **NO — generic bucket** |
| B7 | socket-http-client.ts:206 | `readResponse` | headers exceed size bound | YES (`exceeds? maximum size`) |
| B8 | socket-http-client.ts:215 | `readResponse` | status line doesn't match `HTTP/1.[01] \d{3}` | YES (`Malformed status line`) |
| B9 | socket-http-client.ts:235 | `readResponse` | `Content-Length` exceeds size bound | YES (`exceeds limit:`) |
| B10 | socket-http-client.ts:261/277/319 | `readUntil`/`readUntilClose`/`readChunkedBody` | streamed body exceeds size bound | YES (`exceeds? maximum size`) |
| **B11** | socket-http-client.ts:294 | `readChunkedBody`'s `ensure()` | `reader.read()` returns `done` mid-chunk | **NO — generic bucket**, but only reachable when `Transfer-Encoding: chunked` |
| B12 | socket-http-client.ts:310 | `readChunkedBody` | chunk-size line isn't valid hex | YES (`Malformed chunk size`) |
| B13 | — | *(structural gap, not an explicit throw site)* | a **raw platform rejection** from any of the four `reader.read()` call sites (header loop, `readUntil`, `readUntilClose`, `readChunkedBody`'s `ensure`) | **NO — generic bucket, and not even a deliberate `throw new Error(...)`; the underlying platform's own message propagated completely unwrapped** |

B13 is the significant finding. E2D's own file-header comment explicitly scoped its tagging to "DNS resolution ... malformed HTTP/1.1 protocol framing, and this checkpoint's own new transport-stage wrap" for `connect`/`startTls`/`writer.write()` — it never claimed to cover the read loop. Confirmed by direct source inspection: none of the four `await reader.read()` call sites in the pre-fix source had a `try`/`catch` of their own. A raw TCP/TLS read failure (a mid-response connection reset, for example) would propagate with whatever message the `cloudflare:sockets` platform itself produces — arbitrary, unclassified, and structurally guaranteed to miss every pattern in the list, landing in the same generic bucket B6/B11 land in, but via a path this checkpoint's predecessor never even inspected.

## 2. Production containment (before instrumentation work)

`ACTIVE_DEPLOYMENT_VERSION_COUNT=1`, `CURRENT_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0`, `CURRENT_PRODUCTION_TRAFFIC=100%`.

`PRE_E3P_PRODUCTION_PREFLIGHT=PASS`.

## 3. E3 observability evidence (what can and cannot be recovered)

`service.ts`'s `httpDiagnosticDetails` (the only thing E3's failure persisted to D1/receipts) carries exactly `diagnostic_reason_code` (the *classified bucket*, i.e. `WEBCTX_UPSTREAM_PROTOCOL_ERROR`) and `diagnostic_stage` (`direct_public_http_fetch`) — by deliberate design (E2D §7: no public body leakage, no secret headers). The underlying **raw `error.message`** that `toAdapterResult` computes is never forwarded into that persisted structure.

**E3_PROTOCOL_METADATA_AVAILABLE = NO** — the exact raw sub-cause of E3's real failure cannot be recovered from any already-captured evidence. This is stated plainly rather than guessed at.

**E3_LOW_LEVEL_PROTOCOL_SUBCAUSE = UNRESOLVED** (from stored evidence alone — see §8 for what local reproduction adds).

## 4–7. Diagnostic taxonomy, RED, minimal fix, GREEN

Given B13 (§1) as the one evidence-supported, previously-unaudited gap, this checkpoint's fix closes exactly that gap — nothing else. New reason code: **`WEBCTX_RESPONSE_READ_FAILED`**, registered in `errors.ts`'s existing pattern list, mirroring the existing `WEBCTX_UPSTREAM_CONNECTION_FAILED` / `WEBCTX_REQUEST_WRITE_FAILED` precedent exactly.

**PROTOCOL_SUBREASON_TDD_RED = YES.** [`socket-http-client-read-diagnostics.test.ts`](../../packages/provider-adapters/src/tests/socket-http-client-read-diagnostics.test.ts) proved genuine RED against the *unmodified* source: 3 of 5 new tests failed (raw messages propagated with no `WEBCTX_RESPONSE_READ_FAILED:` prefix and no `.cause`), 2 passed (parser's own deliberate errors already correctly classified; a fully successful fetch already unaffected).

Fix: one new helper, `readOrThrow(reader)`, wrapping the platform `reader.read()` call and tagging *only* a raw rejection from that specific call — never one of the parser's own deliberate `throw new Error(...)` calls, which only ever fire strictly after a `read()` already succeeded and therefore never pass through this wrapper. All four call sites (header loop, `readUntil`, `readUntilClose`, `readChunkedBody`'s `ensure`) now go through it. `.cause` preserved verbatim, exactly like the existing connect/write wraps.

`PROTOCOL_DIAGNOSTIC_BEHAVIOR_CHANGE = NO` — no retry, no timeout change, no buffer-limit change, no parser-logic change. A response that already parses successfully today parses byte-identically after this change (proven in §12/§17).

**E3_PROTOCOL_FIX_GREEN = PASS.** All 5/5 new tests green, plus the pre-existing 4 E2D connect/write tests and the new 14-test fragmentation matrix (§12) all still pass — 23/23 total across the three files.

## 8. Local real-socket reproduction

Used the existing opt-in local-`workerd` harness (`scripts/test-worker-runtime.mts` PHASE 10, gated by `RUN_WORKER_RUNTIME_LIVE_NETWORK_PHASE=true`) — the REAL production composition (`buildWebContextV2CdpProductionRouteConfig`), no override, canonical target `https://example.com/`, exactly the composition/target/request E3 used. This is a local `wrangler dev` process, **not** a request to the deployed Cloudflare Worker candidate.

| ATTEMPT | RESULT | DIAGNOSTIC_REASON | HTTP_STATUS |
|---|---|---|---|
| 1 | SUCCESS | n/a | 200 |
| 2 | SUCCESS | n/a | 200 |
| 3 | SUCCESS | n/a | 200 |
| 4 | SUCCESS | n/a | 200 |
| 5 | SUCCESS | n/a | 200 |

`LOCAL_REAL_SOCKET_ATTEMPTS=5`, `LOCAL_PROTOCOL_FAILURE_COUNT=0`, `LOCAL_PROTOCOL_SUCCESS_COUNT=5`, `LOCAL_E3_PROTOCOL_FAILURE_REPRODUCED=NO`.

5/5 clean reproductions of the identical code path, target, and request shape is itself evidence: it weighs *against* a deterministic parser/serialization bug (which §10–§12 also independently rule out) and *toward* a one-off transient condition on the specific real request E3 made.

## 9. Reference-client comparison (exactly one)

One ordinary `curl --http1.1` request to `https://example.com/`, headers only, body discarded:

```
REFERENCE_HTTP_VERSION=HTTP/1.1
REFERENCE_HTTP_STATUS=200
REFERENCE_CONTENT_LENGTH=(absent)
REFERENCE_TRANSFER_ENCODING=chunked
REFERENCE_CONNECTION=keep-alive
```

**REFERENCE_PROTOCOL_OBSERVATION:** `example.com` is now Cloudflare-fronted (`Server: cloudflare`, `cf-cache-status`, `CF-RAY` present) and frames its response as `Transfer-Encoding: chunked`, not `Content-Length`. This means SITEBORNE's own Worker (itself on Cloudflare's edge) making this canonical fetch is, architecturally, a Cloudflare-edge-to-Cloudflare-edge request — consistent with the kind of one-off internal routing hiccup class K describes. `SafeSocketHttpClient` sends `Connection: close` on every request regardless of what the server advertises; `readChunkedBody` already terminates on the size-0 chunk without depending on the stream's `done` signal, so a server that ignores the close request and keeps the socket in `keep-alive` state does not, by itself, break parsing.

## 10. Request-serialization audit

Static inspection of `writeRequest()`: method is hardcoded `GET` (matches the only method the real caller ever issues); `path = url.pathname + url.search` (correct request-target); `Host` header set from the parsed hostname only if not already present (no duplicate-Host risk); `\r\n` (`CRLF` constant) used consistently for every line and the terminating blank line; `Connection: close` and `Accept-Encoding: identity` set by default (the latter structurally avoids the entire decompression-framing class); no body is ever written for a GET (no body-framing-on-bodyless-GET risk); TLS `expectedServerHostname` is pinned to the real parsed hostname, not the connect-IP, so certificate validation is unaffected by the DNS-rebinding-hardened literal-IP connect. No HTTP/2 preface risk — this is a hand-rolled HTTP/1.1-only client; `secureTransport: 'starttls'` does not negotiate ALPN/h2 here.

**REQUEST_SERIALIZATION_VALID = YES.**

## 11. Response-parser audit

| Invariant | Status |
|---|---|
| partial TCP frame handling | PASS — proven by §12's exhaustive fragmentation matrix |
| status line split across reads | PASS |
| headers split across reads | PASS |
| CRLF boundary split across reads | PASS (explicitly tested at each of the 4 bytes of `\r\n\r\n`) |
| `Content-Length` framing | PASS |
| chunked encoding | PASS |
| connection-close-delimited body (`readUntilClose`) | Structurally identical read-loop pattern to the other two body-read paths; not separately fragmentation-tested (no `Content-Length`/no `chunked` case wasn't in the two representative fixtures) but shares the exact same `concat`-accumulation logic already proven correct twice over |
| **1xx interim responses (`100 Continue` etc.)** | **GAP FOUND** — see below |
| 204/304 semantics | Not specially handled; not evidence-linked to E3 (a 204/304 from a plain unconditional GET to `https://example.com/` is not a real-world possibility here) |
| duplicate `Content-Length` | Not specially rejected (last value via `Headers.append` + `.get()` returns the first per the Fetch spec's header-combining rules); not evidence-linked to E3 |
| `Transfer-Encoding` precedence over `Content-Length` | Correct — code checks `transferEncoding === 'chunked'` first, `contentLengthHeader` second |
| premature EOF | Explicitly handled (throws `'Connection closed before response headers completed'` / `'Connection closed mid-chunk'` — the very branches B6/B11 this checkpoint's fix now tags alongside every other raw-read failure) |
| trailer handling | Not supported; the parser stops at the 0-length chunk and does not attempt to read trailers — not evidence-linked to E3 (no indication `example.com` ever sends chunk trailers) |
| header/body maximum limits | PASS — enforced at every accumulation point, tested |

**PARSER_INVARIANT_VIOLATIONS_FOUND = 1** (the 1xx-interim-response gap below). This count is **separate from** and **not the fix scope of** this checkpoint's `WEBCTX_RESPONSE_READ_FAILED` change.

### The 1xx gap (recorded, not fixed here)

`readResponse`'s status-line regex (`/^HTTP\/1\.[01] (\d{3})\s?(.*)$/`) accepts *any* 3-digit code, including 1xx informational responses, and the surrounding code has no logic to discard a 1xx response and continue reading for the real final status line (the behavior RFC 7230 §3.3.1 non-normatively describes and most conforming HTTP/1.1 clients implement). If a server or intermediary ever sent a `100 Continue` (or any other 1xx) ahead of the real response on this hand-rolled client's connection, the parser would treat the 1xx as final — a genuine, source-provable defect, class `H_INTERIM_RESPONSE_HANDLING_BUG`.

This is **not** claimed as E3's cause: a plain unconditional GET with no `Expect: 100-continue` header essentially never triggers a 1xx from `example.com`, there is zero evidence tying it to the observed failure, and per this checkpoint's debugging law (§0: no fix without root-cause investigation, no speculative fix) it would be wrong to "fix" it under this payment-forensics banner without any evidence connecting it to the actual incident. It is flagged here as an honest, separately-provable finding and spun off as its own out-of-scope follow-up (see closing note) — not silently fixed, not silently ignored.

## 12. Fragmentation test matrix (mandatory)

[`socket-http-client-fragmentation.test.ts`](../../packages/provider-adapters/src/tests/socket-http-client-fragmentation.test.ts) — 14 tests, two representative valid HTTP/1.1 fixtures (`Content-Length`-framed and `Transfer-Encoding: chunked`-framed, the latter matching §9's real observed `example.com` framing), each fed through the parser fragmented at every boundary this checkpoint calls out by name (inside `"HTTP/1.1"`, between status digits, between CR and LF, mid-header-name, mid-header-value, inside the CRLFCRLF boundary, inside the body, inside a chunk-size line, between chunk-data and its CRLF) **plus two exhaustive single-byte-boundary sweeps** — every legal split point of both fixtures, individually — **plus one compound multi-boundary case**.

`TCP_FRAGMENTATION_TESTS = PASS` (14/14). Zero cases produced a result different from the unfragmented baseline.

## 13. example.com response replay

`RESPONSE_B` in the fragmentation suite (§12) is the sanitized chunked-framing fixture matching today's real observed `example.com` framing family (§9) — a synthetic, non-content-sensitive body, not `example.com`'s actual (public, trivial) HTML.

`EXAMPLE_COM_PROTOCOL_REPLAY_CREATED = YES`. `EXAMPLE_COM_PROTOCOL_REPLAY_RESULT = SUCCESS` (all 7 chunked-framing fragmentation tests, including the exhaustive byte-by-byte sweep, passed). `E3_PROTOCOL_ROOT_CAUSE_REPRODUCED = NO` — this framing family, fragmented at every legal boundary, never reproduces anything resembling E3's failure.

## 14. Root-cause classification

**`E3_PROTOCOL_ROOT_CAUSE_CLASS = K_TRANSIENT_SOCKET_READ_FAILURE`** — the best-supported class given all evidence gathered:

- Request serialization: proven valid (§10).
- Response parser: proven correct against arbitrary legal fragmentation, exhaustively, on both framing families in production use (§11, §12).
- 5/5 clean local reproductions of the identical code path, target, and composition (§8) — no deterministic defect reproduces.
- A genuine, previously-unaudited gap exists (B13, §1/§3): raw `reader.read()` rejections during the response-read phase were completely unwrapped, meaning *any* transient platform-level read failure (a TCP reset, a Cloudflare-internal edge hiccup) would land in exactly the same generic bucket E3 observed, with no way to distinguish it from a parser bug.

`E3_PROTOCOL_ROOT_CAUSE_PROVEN = NO`. This is stated honestly, not softened: absence of a reproducible deterministic defect is strong circumstantial evidence for transience, not positive proof of the exact platform-level trigger. No raw error message from the real E3 attempt was ever captured (§3), so the *specific* platform condition that fired that day cannot be named with certainty — only that the code path it fell through (B13) is now proven to exist and is now instrumented.

## 15. Fix decision

Per this checkpoint's own §15 rule: root cause is **not** proven, so **`REPOSITORY_FIX_REQUIRED = UNPROVEN`**, and no speculative *behavioral* fix was implemented — no retry logic added, no timeout changed, no buffer limit changed, no parser relaxed, no fallback to platform `fetch()`, no terms-policy touched.

What *was* implemented, under §18's explicit no-fix-case allowance ("improved low-level sanitized diagnostics may remain if justified"): the `WEBCTX_RESPONSE_READ_FAILED` diagnostic tag, closing gap B13 exactly the way E2D closed the analogous connect/write gaps. This is instrumentation, not a claim that the bug is fixed — stated explicitly per §18's requirement.

`BEHAVIORAL_FIX_IMPLEMENTED = NO`. `PROTOCOL_DIAGNOSTIC_BEHAVIOR_CHANGE = NO`.

## 19–24. Non-regression proofs

- **TermsGuard**: `direct-public-http`'s `review_basis = operator_risk_acceptance` unchanged; permission flags remain `'unknown'`; unknown-basis providers still fail closed; the risk-accepted capability still passes; no transfer to any other provider, browser, or JS capability. Untouched files this checkpoint.
- **SSRF/network security**: DNS-rebinding, private IPv4/IPv6, loopback, link-local, metadata-endpoint blocking, redirect revalidation, TLS hostname pinning, credential-bearing-URL prohibition, timeout bound, response-size bound — all unchanged (untouched code paths; full suite green). `WEB_CONTEXT_SECURITY_CHANGED = NO`.
- **Payment ordering**: `verify → executor → settle-only-on-success` invariant untouched (no file in that path was modified). `EXECUTOR_FAILURE_SETTLEMENT_CALLS = 0`, `AUTOMATIC_PAYMENT_RETRY_CALLS = 0` (none introduced).
- **Economics**: `web_context_verified.v2` (0.009 USDC / 9000 atomic) and `verify_agent_output.v2` (0.019 USDC / 19000 atomic) — both reconfirmed unchanged by the full regression suite (PHASE 6/10's own price assertions). `WEB_CONTEXT_ECONOMICS_CHANGED = NO`, `VERIFY_ECONOMICS_CHANGED = NO`.
- **MCP/discovery**: PHASE 9 (real workerd) still green — `MCP_CROSS_SURFACE_COHERENCE = PASS`.

## 25. Full regression

```
PROTOCOL_MUTATION_PROOF = PASS (6/6 mutations caught, 0 skipped — see scripts/test-webctx-read-diagnostics-mutation-caught.mts)
lint: PASS (0 errors)
typecheck: PASS for every package this checkpoint touched (@siteborne/provider-adapters clean).
           The monorepo-wide `pnpm typecheck` fails on one PRE-EXISTING, previously-flagged,
           entirely unrelated error in apps/edge-api/tests/live/web-context-first-paid-e2e-local.test.ts
           (branded-type mismatches, last touched at 33a5c9c — before this checkpoint, and
           already recorded as a separate out-of-scope background item in SUN-1221E3's memory).
           No new typecheck failure was introduced by this checkpoint.
TESTS = 2407 passed, 38 skipped, 0 failed (195/195 test files)
WORKER_RUNTIME = 92/92 (no-live-network) and 95/95 (RUN_WORKER_RUNTIME_LIVE_NETWORK_PHASE=true, includes PHASE 10 §8's 5/5 successful reproductions)
production:preflight: PASS
secrets:scan: 2 findings, both pre-existing (the same recurring BASESCAN_TOKEN_CONTRACT public
              contract-address false positive flagged in every prior checkpoint this session).
              NEW_SECRET_FINDINGS = 0.
```

## 26–35. Candidate decision

Worker source changed (`socket-http-client.ts`, `errors.ts` — both reachable from the real production bundle via `PublicHttpAdapter`). Per §28: `OLD_E3_CANDIDATE_REUSE_ELIGIBLE = NO`, `NEW_E4_CANDIDATE_REQUIRED = YES`.

Per §29, justification path **B**: root cause remains unresolved, but diagnostic resolution is now materially improved — a future one-shot invocation that again lands in the generic bucket would now be a genuinely novel finding (meaning gap B13 wasn't the whole story), while one that lands with `WEBCTX_RESPONSE_READ_FAILED` would confirm this investigation's transient-read hypothesis precisely. `E4_CANDIDATE_TECHNICALLY_JUSTIFIED = YES`.

New candidate upload evidence, config read-back, and final production containment are recorded in the companion evidence report (`SUN-1221E3P-protocol-candidate-upload.md`), committed separately per §36.

## Out-of-scope finding

The §11 1xx-interim-response gap (`H_INTERIM_RESPONSE_HANDLING_BUG`) is real, source-provable, and unrelated to this checkpoint's payment-forensics scope. It has not been fixed here and is flagged separately rather than folded into this change.

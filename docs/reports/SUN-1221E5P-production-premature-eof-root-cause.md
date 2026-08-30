# SUN-1221E5P — Production `WEBCTX_HTTP_PREMATURE_EOF` Root-Cause Investigation (BLOCKED)

Status: **BLOCKED**. No repository defect proven. No fix implemented. No E6 candidate created.

## Lineage

- SUN-1221E5 evidence: `00c7cf0c6b6cb6102221241380cd12bece96826b`
- SUN-1221E5P evidence (this report): recorded below at commit time
- Investigation performed against unmodified `de70bf98-f304-4d7f-b189-4ae2401041a0` production source. Zero source files were changed by this checkpoint — it is analysis-only.

## A. PROVEN

- E5's one real paid attempt against `web_context_verified.v2` for `https://example.com/` (direct mode) returned an ambiguous HTTP 502, with `facilitator.verify()` succeeding and `facilitator.settle()` never invoked. Zero settlement, zero on-chain effect, buyer balance unchanged (already established and committed in SUN-1221E5's own report).
- The real executor's diagnostic classification for that failure was exactly `WEBCTX_HTTP_PREMATURE_EOF` at stage `direct_public_http_fetch`.
- `WEBCTX_HTTP_PREMATURE_EOF` is produced from exactly **two** source locations in `packages/provider-adapters/src/http/socket-http-client.ts`:
  1. The header-accumulation loop, when `reader.read()` returns `done: true` before `\r\n\r\n` has been found (headers incomplete).
  2. The chunked-body `ensure()` helper, when `reader.read()` returns `done: true` while still accumulating bytes for a declared chunk (chunk incomplete).
- Both conditions are standards-correct rejections per RFC 7230 — an HTTP/1.1 message that closes before headers finish, or mid-declared-chunk, is genuinely truncated by definition. Neither throw site is a misclassification of legal termination.
- The two *legal* termination paths already exist and already succeed on clean EOF:
  - `readUntilClose` (no `Content-Length`, no chunked encoding): `done: true` is treated as the correct signal of a connection-close-delimited body completing. **CONNECTION_CLOSE_DELIMITED_BODY_SUPPORTED = YES.**
  - `readUntil` (declared `Content-Length`): loop exits cleanly at `done: true` without throwing.
- Buffer-vs-`done` ordering was audited in all four read loops (header loop, `readUntil`, `readUntilClose`, chunked `ensure`): each loop only classifies EOF from a `read()` call that itself returned `done: true`; any bytes from a prior `read()` are concatenated and re-scanned for framing markers before the next `read()` is issued. This matches the WHATWG Streams contract, under which `{done:true}` never carries a nonempty `value`. **BUFFER_DONE_ORDER_AUDIT_COMPLETE = YES**, no bug found.
- `packages/provider-adapters/src/tests/socket-http-client-premature-eof.test.ts`, `socket-http-client-fragmentation.test.ts`, and `socket-http-client-read-diagnostics.test.ts` (25 tests total, carried forward unmodified from SUN-1221E4P) all PASS against current source, exercising: Content-Length-complete success, connection-close-delimited success, byte-by-byte fragmentation across header/body/chunk boundaries, header-incomplete EOF, chunk-incomplete EOF, and raw `read()` rejection staying distinct from premature EOF.
- Cloudflare's own `TlsOptions` type (`@cloudflare/workers-types@4.20260702.1`) exposes exactly one field, `expectedServerHostname` — there is no ALPN negotiation control surface in the `cloudflare:sockets` API at all. **TLS_ALPN_CONTROL_AVAILABLE = NO** — this is a platform boundary, not something our code configures right or wrong.
- No non-payment route or harness in the repository invokes `SafeSocketHttpClient`/the real executor on Cloudflare's live network outside of the paid `web_context_verified.v2` request path. **CLOUDFLARE_NONPAYMENT_REPRO_HARNESS_AVAILABLE = NO.**

## B. DISPROVEN / RULED OUT

- Header-loop and chunked-loop EOF classification being a parser bug — ruled out; both are RFC 7230-correct.
- Buffer being discarded/mishandled before EOF classification — ruled out by direct code audit; ordering is correct in all four loops.
- Legal connection-close-delimited bodies being misclassified as errors — ruled out; `readUntilClose` already treats `done` as success.
- Raw `read()` rejection (transport-level throw) being conflated with premature EOF — ruled out; SUN-1221E3P's `WEBCTX_RESPONSE_READ_FAILED` tag remains structurally distinct and did not fire on this E5 attempt, confirming E5's failure is a framing-level EOF, not a raw socket read rejection.

## C. UNPROVEN

- Whether the upstream target (`https://example.com/`) or an intermediate network path genuinely truncated the TCP/TLS stream on Cloudflare's production edge.
- Whether Cloudflare's `cloudflare:sockets` `readable` stream exhibits any production-only closure/backpressure/timing behavior that differs from the local/workerd harness used in E4P's fragmentation matrix.
- Whether target-specific or IP-specific routing on Cloudflare's egress network is implicated.
- Whether this is a rare, non-reproducible transient network event rather than a systemic defect at all.

None of the above can be confirmed or ruled out without either a proven repository defect (not found) or a non-payment reproduction on Cloudflare's actual network (not available). This checkpoint answers "where the parser noticed the EOF," not "why production produced that EOF" — those are different facts, and only the first is proven.

## D. UNRELATED KNOWN DEFECTS

- The 1xx interim-response handling gap characterized in SUN-1221E4P (`WEBCTX_HTTP_INVALID_RESPONSE_STATUS`, platform `Response` constructor rejecting 1xx status codes) remains a real, separately-tracked defect. `E5_CAUSED_BY_INTERIM_1XX = NOT_PROVEN` — nothing in E5's diagnostic evidence ties this attempt to a 1xx response; it is not implicated and was not fixed here.
- `tests/live/web-context-first-paid-e2e-local.test.ts` has two pre-existing branded-type TypeScript errors (`Promise<string>` vs `` Promise<`0x${string}`> ``, and a `network: string` union not narrowing to `` `${string}:${string}` ``) at lines 528 and 611. This file was not touched by E5P; the failure is unrelated to this checkpoint's scope and was not fixed inline, per instruction.

## SUN1221_E5P_EXTERNAL_BLOCKER

> Production Cloudflare SafeSocket execution repeatedly observes a premature HTTP response EOF that cannot currently be reproduced using the available non-economic workerd/local harnesses. The repository's identified EOF checks are standards-correct, and no existing authorized Cloudflare-network non-payment reproduction seam exists. A fifth paid attempt is not justified without either a proven repository defect or a safe Cloudflare-network reproduction mechanism.

## Path decisions

- **PATH A** (root cause proven + repository behavior proven wrong + RED + minimal fix + GREEN): **NO.** No repository defect was found; both EOF throw sites are standards-correct.
- **PATH B** (exact failure reproduced non-economically on Cloudflare's actual network, root cause proven there, fix proven there): **NO.** No non-payment reproduction harness exists, and none was fabricated for this checkpoint.
- **E6 candidate decision:** Since Path A = NO and Path B = NO, **no E6 candidate is technically justified.** Uploading a candidate that only adds more logging/diagnostics without behavioral change would not be sufficient evidence for a fifth paid attempt.

## Next required capability

`NEXT_REQUIRED_CAPABILITY = CLOUDFLARE_NONPAYMENT_EXECUTOR_REPRODUCTION_SEAM` — a way to invoke the real `SafeSocketHttpClient`/direct-public-http fetch path on Cloudflare's production network without creating payment material, without exposing a public arbitrary-fetch endpoint, without weakening auth, and without affecting paid routing or shifting production traffic.

`NEXT_REQUIRED_CAPABILITY_IS_ARCHITECTURE_CHANGE = YES` — any such seam is a new authenticated/internal-only diagnostic capability touching production routing and requires its own design and explicit human approval before implementation. It is not designed or implemented here.

## Regression evidence

- `pnpm lint`: PASS (16/16 tasks)
- `pnpm typecheck`: FAIL — pre-existing, unrelated `tests/live/web-context-first-paid-e2e-local.test.ts` branded-type errors (lines 528, 611), not touched by this checkpoint
- `pnpm test`: 2416 passed, 38 skipped, 0 failed
- `pnpm test:worker-runtime`: 92/92 scenarios passed
- `pnpm production:preflight`: PASS
- `pnpm secrets:scan`: 2 findings, both pre-existing known false positives (`OLD_AUTH_PAYMENT_ATTEMPT_ID` label text in SUN-1221E2R at commit a755620, `BASESCAN_TOKEN_CONTRACT` public USDC contract address in SUN-1220O at commit 322852a). NEW_SECRET_FINDINGS = 0.
- Targeted E5P suites (`socket-http-client-premature-eof.test.ts`, `socket-http-client-fragmentation.test.ts`, `socket-http-client-read-diagnostics.test.ts`): 25/25 passed.

## Production containment

- `ACTIVE_DEPLOYMENT_VERSION_COUNT = 1`
- `FINAL_PRODUCTION_VERSION = de70bf98-f304-4d7f-b189-4ae2401041a0`
- `FINAL_PRODUCTION_TRAFFIC = 100%`
- `FINAL_PRODUCTION_PREFLIGHT = PASS`
- Zero source changes made; zero candidates uploaded; zero deployments; zero traffic shifts.

## Zero economic actions

`LIVE_CANDIDATE_REQUESTS=0`, `LIVE_402_REQUESTS=0`, `BUYER_BALANCE_QUERIES=0`, `SIGN_TYPED_DATA_CALLS=0`, `EIP3009_AUTHORIZATIONS_CREATED=0`, `PAYMENT_SIGNATURES_CREATED=0`, `PAID_REQUESTS=0`, `SETTLEMENTS=0`, `TRANSACTIONS=0`, `REAL_ECONOMIC_EFFECT_USDC=0`. `CURRENT_REAL_PAYMENT_AUTHORIZATION=NONE`.

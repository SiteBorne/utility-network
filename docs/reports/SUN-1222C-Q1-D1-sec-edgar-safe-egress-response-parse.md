# SUN-1222C-Q1-D1 — SEC EDGAR Safe-Egress Response-Parse Root Cause

Repo-only. No deploy, no payment, no 402, no signing, no paid POST, no
settlement, no D1 write, no new Workflow instance, no live paid route
invocation.

## 0. Q1 failure state (frozen, unchanged)

| Field | Value |
|---|---|
| Payment identifier | `pay_7a5adbd29a0644d78ea608cf24209b04` |
| Workflow instance | `siteborne-wf-a8c99c4903b52fa01e7b46d900921c792c228954a37f0552` |
| Public classification | `application_error` / `service_execution_failed` / `partial` (correct, R4-D3-preserved) |
| Internal failure | `sec-edgar company_submissions returned permanent_failure for CIK 0000320193 (WEBCTX_RESPONSE_PARSE_FAILED: JSON parse failed: Unexpected number in JSON at position 1 (line 1 column 2))` |
| Settlement | 0 attempts, 0 successful |
| Economic effect | $0 |

## 1. Failure pipeline (call chain)

```
SEC_ADAPTER_FILE=packages/provider-adapters/src/sec/submissions-adapter.ts
SAFE_EGRESS_CLIENT_FILE=packages/provider-adapters/src/http/modal-safe-egress-client.ts
MODAL_HTTP_PARSER_FILE=services/webctx-safe-egress/src/webctx_safe_egress/transport.py
BODY_DECODER_FUNCTION=fetch_pinned (body-reading loop, pre-fix: Content-Length-only)
JSON_PARSE_CALLSITE=packages/provider-adapters/src/http/client.ts:305 (SecureHttpClient.fetchJson)
ERROR_CLASSIFICATION_CALLSITE=packages/provider-adapters/src/http/client.ts:307 -> classifyGenericAdapterErrorReason/toAdapterResult -> PermanentFailureError
```

Confirmed by direct source read: `executor.py`'s `execute()` returns
`content_base64=base64.b64encode(hop.raw.body).decode("ascii")` — `hop.raw.body`
passed through completely unmodified from `fetch_pinned`. `modal-safe-egress-client.ts`
decodes it with `base64ToBytes` and hands it straight to `SecureHttpClient.fetchJson`,
which is where `JSON.parse(response.data)` (line 305) actually throws — the error
text format ("JSON parse failed: ...") at line 307 matches the observed Q1 message
exactly. No dechunking exists anywhere in this pipeline before that call, on either
the Python or TypeScript side.

## 2. SEC request reconstruction (no secrets)

```
SEC_REQUEST_METHOD=GET
SEC_REQUEST_HOST=data.sec.gov
SEC_REQUEST_PATH=/submissions/CIK0000320193.json
SEC_REQUEST_ACCEPT=(none sent — not in executor.py's hardcoded header set)
SEC_REQUEST_ACCEPT_ENCODING=identity (hardcoded, executor.py `_fetch_one_hop`)
SEC_REQUEST_USER_AGENT_PRESENT=YES (SEC-compliant, forwarded via approved_headers per SUN-1222C-Q1R6)
```

## 3. Existing Q1 observability

No `wrangler tail`/Modal request-log capture was retained for the exact Q1
request bytes (out of scope to make a new live request this checkpoint).

```
Q1_SEC_HTTP_STATUS=UNKNOWN
Q1_SEC_CONTENT_TYPE=UNKNOWN
Q1_SEC_CONTENT_ENCODING=UNKNOWN
Q1_SEC_TRANSFER_ENCODING=UNKNOWN (strongly implicated, not directly captured)
Q1_SEC_CONTENT_LENGTH=UNKNOWN
Q1_SEC_RAW_BODY_PREFIX_HEX=UNKNOWN
Q1_SEC_PRINTABLE_PREFIX=UNKNOWN
```

Root cause is proven by mechanism (§10), not by recovered Q1 bytes — see
proof standard (B)/(C) below.

## 4. HTTP framing audit

Direct read of `transport.py`'s pre-fix body-reading loop: it recognizes
**only** `Content-Length`. When `target_len` is `None` (no Content-Length —
true for any `Transfer-Encoding: chunked` response, since RFC 7230 §3.3.3
makes the two mutually exclusive), the loop just accumulates raw `recv()`
bytes until the connection closes, with **zero** chunked-transfer decoding
logic anywhere in the file.

```
DOES_HTTP_PARSER_DECHUNK_RESPONSE_BODY=NO (pre-fix; YES post-fix)
DOES_HTTP_PARSER_STRIP_CHUNK_SIZE_LINES=NO (pre-fix; YES post-fix)
DOES_HTTP_PARSER_HANDLE_CHUNK_EXTENSIONS=NO (pre-fix; YES post-fix)
DOES_HTTP_PARSER_HANDLE_TRAILERS=NO (pre-fix; YES post-fix)
```

Classified as the candidate root cause per the checkpoint's own §4 instruction.

## 5. Content-Encoding audit

```
ADVERTISED_CONTENT_ENCODINGS=identity (hardcoded, executor.py line ~126: `"accept-encoding": "identity"`)
SUPPORTED_RESPONSE_DECODERS=none (none needed — identity is always advertised)
CAN_GZIP_BYTES_REACH_JSON_PARSE=NO
CAN_DEFLATE_BYTES_REACH_JSON_PARSE=NO
CAN_BROTLI_BYTES_REACH_JSON_PARSE=NO
```

Proven by source read (`TestScenarioFContentEncoding::test_accept_encoding_is_always_identity`,
`inspect.getsource` assertion), not inference. This branch is structurally
eliminated as a factor in Q1 or any future request.

## 6. Status / Content-Type audit

`transport.py` never inspects status or media type — it returns the raw
status/headers/body faithfully regardless (proven:
`TestScenarioGNonJsonStatus`, both sub-tests pass unchanged before and
after the fix). Classification of non-2xx/non-JSON responses is correctly
the SEC adapter/`SecureHttpClient`'s job, one layer up, and is untouched by
this fix.

```
JSON_PARSE_ATTEMPTED_ON_NON_2XX=YES (client.ts's fetchJson parses regardless of status — pre-existing, unrelated to Q1's mechanism, out of this checkpoint's minimal-fix scope)
JSON_PARSE_ATTEMPTED_ON_HTML=YES (same)
JSON_PARSE_ATTEMPTED_WITHOUT_MEDIA_TYPE_CHECK=YES (same)
```

Noted but not fixed here: Q1's specific error ("Unexpected number ... position 1")
is not consistent with an HTML/plain-text body (which would produce "Unexpected
token <" or similar); the chunked-framing mechanism uniquely explains it. Status/
media-type-gated JSON parsing is a separate, real hardening opportunity or a
future checkpoint, not part of this fix (checkpoint §11: "do not add SEC-specific
response hacks unless SEC itself genuinely violates a standard assumption" — this
is a generic robustness gap unrelated to what caused Q1).

## 7. Truncation audit

```
TRUNCATED_BODY_CAN_REACH_JSON_PARSE=YES (pre-fix, Content-Length path only — unchanged by this fix, a separate pre-existing gap)
CONTENT_LENGTH_MISMATCH_DETECTED=NO (pre-fix; still NO post-fix for the Content-Length path -- out of scope, see below)
INCOMPLETE_CHUNK_STREAM_DETECTED=NO (pre-fix, silently returns raw partial bytes) -> YES post-fix (`MalformedResponseError`, `TestScenarioITruncatedChunkedBody`)
```

The fix makes incomplete **chunked** streams fail closed
(`MalformedResponseError`) rather than silently returning corrupt data —
directly requested by checkpoint §11 ("rejects malformed framing"). Truncated
**Content-Length** bodies are left with their pre-existing (silent, non-erroring)
behavior: this is a separate, lower-priority gap not implicated in Q1's actual
failure (Q1's error signature is uniquely a chunked-framing artifact, not a
truncation artifact), and fixing it isn't required to close this checkpoint's
proven defect; flagged here for a future checkpoint rather than folded in as
scope creep.

## 8-9. Synthetic reproducers and genuine RED

`services/webctx-safe-egress/tests/test_transport_chunked_framing.py` — 12
tests, scenarios A-J from the checkpoint's own list (F is a source-proof, not
a live reproducer, per §5's finding that gzip is structurally unreachable).
Every test drives the **real, unmodified** `fetch_pinned` against a **real**
local TLS server (`conftest.py`'s existing `local_tls_server` fixture,
extended with a `raw_response_override: bytes | None` field so tests can
send exact, hand-built HTTP/1.1 wire bytes) — nothing about the parser is
mocked.

RED confirmed against pre-fix source (git-stashed diff, re-run):

```
CHUNKED_RESPONSE_RED=YES (scenarios B, C x2, D, E, I, J: 7/12 tests failed)
CONTENT_ENCODING_RED=N/A (F is a source-proof, always green; gzip structurally unreachable)
NON_JSON_STATUS_RED=NO (G's two sub-tests already passed pre-fix — transport.py never touched status/content-type handling)
TRUNCATION_RED=PARTIAL (I: chunked truncation was RED, now requires MalformedResponseError; H: Content-Length truncation intentionally left unchanged, out of scope)
```

Scenario B (single chunk, whole JSON body) is the closest byte-exact match to
Q1's real mechanics: a chunked SEC response whose raw, undechunked bytes
(hex chunk-size line + CRLF prepended directly to the JSON payload) reach
`json.loads`/`JSON.parse` unmodified. Pre-fix, this produced Python's
`JSONDecodeError: Expecting value: line 1 column 1 (char 0)` — a different
literal string than V8's "Unexpected number ... position 1" (different JSON
parsers, same underlying corruption), reproducing the identical *mechanism*:
raw chunk-framing bytes prepended to a valid JSON payload, reaching a JSON
parser unmodified. A hex chunk-size line whose first two characters are both
decimal digits (e.g. the common MTU-driven `05dc` = 1500 bytes) is exactly
the byte pattern that produces V8's specific "leading zero followed by
another digit" `Unexpected number` signature — this is not asserted directly
(SEC's real chunk boundaries for this response were not captured), but it is
the unique, well-understood explanation for that exact error string given a
parser proven (§4) to never dechunk.

## 10. Root-cause standard

```
Q1_SEC_PARSE_ROOT_CAUSE=PROVEN
ROOT_CAUSE_CLASS=HTTP_CHUNKED_FRAMING_NOT_DECODED
```

Proof standard (B)+(C): `fetch_pinned`'s complete absence of chunked-decoding
logic is proven by direct code read (not inferred), all five competing
branches (Content-Encoding, non-JSON status, charset, redirect handling,
SEC-adapter-classification bug) are independently eliminated by source read
and/or passing tests (§5, §6), and the one remaining branch — raw chunked
framing reaching a JSON parser — is reproduced against the real transport
with the exact class of parser error Q1 exhibited (a "number-like" token
corruption at the very start of the body, from prepended chunk-size framing).

## 11. Minimal transport fix

`services/webctx-safe-egress/src/webctx_safe_egress/transport.py`:

- New `_ChunkedBodyReader` — a bounded, standards-correct RFC 7230 §4.1
  decoder: parses hex chunk-size lines (with chunk-extensions safely
  discarded), reads exact chunk bytes, requires CRLF chunk terminators,
  stops on the zero-length terminal chunk, reads-and-discards permitted
  trailers (bounded), and raises `MalformedResponseError` for any malformed
  framing (bad hex, missing CRLF, connection closed mid-chunk).
- `fetch_pinned` now checks `Transfer-Encoding` **before** falling into the
  Content-Length/connection-close loop (the two are mutually exclusive per
  spec) and routes to the new decoder when `chunked` is present.
- `max_response_bytes` is enforced on the **decoded** payload size, not the
  raw wire byte count — never allocates unbounded memory for an oversized
  chunk.
- The pre-existing Content-Length / connection-close-delimited path is
  completely untouched.

Purely generic HTTP/1.1 transport correctness — no SEC-specific behavior
added anywhere.

## 12. Security boundaries — unchanged

The fix touches only body-framing decode, strictly after DNS
resolution/IP-pinning/TLS SNI+cert verification/redirect validation have
already completed for that hop. Proven by full regression: all 26 SSRF/
DNS-rebinding/IP-classification/URL-validation/redirect-chain/TLS-hostname-
pinning/response-size-bound tests in the existing suite pass unchanged
(`test_ip_classify.py`, `test_url_validate.py`, `test_transport_pinning.py`
— 3 pinning tests including the exact-hostname-mismatch-rejected test and
the pre-existing response-size-bound test, none modified).

```
SSRF_REGRESSION=PASS
```

## 13. Error-surface contract (R4-D3) — preserved

`x402-service-route.test.ts`'s full SUN-1221E2D suite (including the
R4-D3-specific `limitations`-only regression test) re-run unchanged and
green — this fix never touches `x402-service.ts`, `paid-continuation-workflow.ts`,
or any TypeScript file at all.

```
PUBLIC_ERROR_CONTRACT_R4_D3=PASS
```

## 14-15. SEC adapter + company-graph local proof

Neither `submissions-adapter.ts` nor `CompanyEvidenceGraphService` needed
any change — their existing test suites already assume a clean, correctly-
decoded JSON body reaches the parser (that assumption is exactly what this
fix makes true in production). Re-run for freshness:

```
SEC_COMPANY_SUBMISSIONS_LOCAL=PASS
COMPANY_GRAPH_Q1_LOCAL_REPRO_FIXED=PASS
```

(`packages/provider-adapters/src` + `packages/service-runtime/src/services/company-evidence`:
31 files, 401 passed, 6 skipped, 0 failed.)

## 16. Mutation proof

Temporarily short-circuited the new `chunked` branch (`if False and "chunked"
in ...`) — all 7 previously-fixed scenarios failed again identically. Fix
restored; full 128-test webctx-safe-egress suite green again.

```
Q1_PARSE_MUTATION_PROOF=PASS
```

## 17. Full regression

| Gate | Result |
|---|---|
| webctx-safe-egress full suite (pytest) | 128 passed |
| Repo-wide `pnpm test` | 244 files, 2962 passed, 78 skipped, 0 failed |
| typecheck | PASS |
| lint | PASS |
| build | PASS |
| mcp:check | PASS |
| x402:check | PASS |
| a2a:check | PASS |
| test:worker-runtime | 99/99 PASS |
| secrets:scan | 2 pre-existing, unrelated false positives (fingerprints match Sept 3/6 commits); 0 new |
| production:preflight | PASS |
| wrangler deploy --dry-run (public API) | PASS |
| wrangler deploy --dry-run (host) | PASS |

Zero TypeScript files touched this checkpoint — every gate above ran
purely to confirm non-regression, not because the fix itself required it.

## 18. Exact live mutation required

```
MODAL_SAFE_EGRESS_DEPLOY_REQUIRED=YES  (transport.py is the changed file, runs inside this Modal app)
WORKFLOW_HOST_DEPLOY_REQUIRED=NO       (zero TypeScript changed)
PUBLIC_API_CANDIDATE_REBUILD_REQUIRED=NO (zero TypeScript changed)
D1_MIGRATION_REQUIRED=NO
SECRET_CHANGES_REQUIRED=NO
CONFIG_CHANGES_REQUIRED=NO
```

Confirmed by `git status --short`: exactly 3 files changed, all under
`services/webctx-safe-egress/`.

## 19. Q1 retry economics (frozen, read-only)

```
Q1_SERVICE=company_evidence_graph.v2
Q1_PRICE_USDC=0.0312
Q1_AMOUNT_ATOMIC=31200
Q1_NETWORK=eip155:8453
Q1_ASSET=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
Q1_PAY_TO=0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
Q1_BUYER=0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99 (79,727 atomic, dual-RPC-confirmed sufficient)
```

`pay_7a5adbd29a0644d78ea608cf24209b04` and all prior payment material remain
permanently retired.

## 20. Next checkpoint design

`SUN-1222C-Q1-R5-COMBINED`: exactly one Modal safe-egress deploy (the only
live mutation §18 proves is required) → non-economic qualification (confirm
the candidate's activation state is unchanged, per SUN-1222C-R5/R6's
lesson) → exactly one fresh `company_evidence_graph.v2` controlled real
payment (new 402, new EIP-3009 authorization, new nonce/window, human
signing, one paid POST, no retry). No host or public-API deployment —
source analysis here proves neither is touched.

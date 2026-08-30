# SUN-1221E4P — Eliminate Generic HTTP-Protocol Failure Collapse

## Why this checkpoint exists

SUN-1221E3 and SUN-1221E4 each independently made one real, signed, paid
submission to `web_context_verified.v2 / CDP` and each independently failed
at the same high-level stage: the real executor invoked the direct-public-http
adapter, TermsGuard's `operator_risk_acceptance` path passed, the SafeSocket
transport executed, but the canonical target (`https://example.com/`) was
never successfully fetched. Both attempts produced the same generic
diagnostic reason: `WEBCTX_UPSTREAM_PROTOCOL_ERROR` at stage
`direct_public_http_fetch`. E4 additionally proved the raw-reader tag
(`WEBCTX_RESPONSE_READ_FAILED`) did **not** fire, ruling out a raw platform
`read()` rejection and narrowing the fault to this parser's own HTTP/1.1
framing logic — a "generic collapse" bucket that could not, on its own,
distinguish *which* framing branch actually failed.

This checkpoint's job was to eliminate that generic collapse: enumerate
every branch that could fall into the same bucket, give each a distinct,
evidence-backed diagnostic tag, and — only if a genuine bug were proven —
fix it. No live request, no 402, no signature, no payment, no settlement,
no traffic shift, no canary, no promotion.

## Generic-collapse inventory

The hand-rolled HTTP/1.1 parser in `SafeSocketHttpClient` had exactly three
places where a failure would previously produce an **untagged** `Error`,
all falling into the same undifferentiated `WEBCTX_UPSTREAM_PROTOCOL_ERROR`
bucket at the executor layer:

1. Header-read loop: `if (done) throw new Error('Connection closed before response headers completed')`
2. Chunked-body read loop: `if (done) throw new Error('Connection closed mid-chunk')`
3. Final `Response` construction: no wrapping — a platform-thrown error
   (e.g. `RangeError` on some status codes) propagated raw.

Each of these three collapse points is now a separately tagged, separately
testable diagnostic:

- `WEBCTX_HTTP_PREMATURE_EOF` — the remote peer cleanly closed the
  connection (`done: true`, no error) before the parser had what it needed
  (headers not yet terminated by `\r\n\r\n`, or an announced chunk not yet
  fully read). This is distinct in kind from a raw platform read
  *rejection*, which already had its own tag
  (`WEBCTX_RESPONSE_READ_FAILED`, proven **not** to have fired in E3 or E4).
- `WEBCTX_HTTP_INVALID_RESPONSE_STATUS` — the assembled status/headers
  could not be used to construct a platform `Response` object.

## The 1xx characterization (found, not fixed)

Investigating branch 3 above turned up a real, reproducible defect: the
platform's `Response` constructor throws an unwrapped `RangeError` when
given an informational (1xx) status code, and this parser has **no loop to
discard a 1xx interim response and keep reading for the real final status
line** — it treats the first status line it reads as final, unconditionally.
A characterization test proves this reproduces today, independent of any
live request.

This is a real defect. It is **not** fixed in this checkpoint, per this
checkpoint's own evidence law: there is no evidence tying E3 or E4's actual
failure to a 1xx response — `example.com` does not send interim responses
in any protocol trace obtained, and nothing in E3/E4's diagnostic trail
narrows to this branch specifically. Fixing an unproven-relevant bug on
spec-conformance grounds alone, under a live-payment-forensics checkpoint,
would be exactly the "guessed fix" this checkpoint's debugging law
prohibits. It is recorded here as a known, separately-trackable gap:
`E4_CAUSED_BY_INTERIM_1XX=NOT_PROVEN`.

## What this checkpoint did NOT do

- No behavioral change to any successful-response code path. A response
  that already constructs successfully today is byte-for-byte unaffected.
- No fix to the 1xx-skip gap (see above).
- No change to TermsGuard, SSRF/DNS-rebinding protections, economics,
  discovery, or MCP surfaces.
- No live request against any candidate, no 402, no signature, no payment.

## Verification

- **Fragmentation/conformance regression**: existing
  `socket-http-client-fragmentation.test.ts` suite extended and re-run —
  all byte-split, chunked, and malformed-framing scenarios still pass
  unchanged.
- **New characterization tests**: `socket-http-client-premature-eof.test.ts`
  (both premature-EOF branches) and additions to
  `web-context-diagnostic-classification.test.ts` (both new diagnostic
  prefixes correctly classified, and the pre-existing prefixes unaffected).
- **Mutation proof** (`scripts/test-webctx-premature-eof-mutation-caught.mts`,
  hardened with a 90s per-mutation timeout + automatic worker sweep after an
  earlier run hung on a silently-accepted mutant): 7/7 deliberate mutations
  independently caught, 0 skipped:
  1. header-loop premature-close message reverted to untagged — CAUGHT
  2. chunk-loop premature-close message reverted to untagged — CAUGHT
  3. `Response`-construction `RangeError` wrap removed — CAUGHT
  4. `errors.ts` stops classifying `WEBCTX_HTTP_PREMATURE_EOF` — CAUGHT
  5. `errors.ts` stops classifying `WEBCTX_HTTP_INVALID_RESPONSE_STATUS` — CAUGHT
  6. `WEBCTX_HTTP_PREMATURE_EOF` given the wrong reason string (precision-loss, not just removal) — CAUGHT
  7. chunk-loop premature-close silently accepted instead of thrown (framing error ignored) — CAUGHT
- **Final sanity re-run** against fully-restored (un-mutated) source: GREEN.
- **Full regression**: `pnpm lint` PASS; production `tsconfig.json`
  typecheck PASS (the only typecheck failure is a pre-existing,
  already-flagged branded-type issue in
  `apps/edge-api/tests/live/web-context-first-paid-e2e-local.test.ts`,
  gated under the separate `tsconfig.live-tests.json`, untouched by this
  checkpoint, and outside the deployed Worker bundle); `pnpm test`: 2416
  passed, 38 skipped, 0 failed (196/215 files, 19 correctly skipped);
  `scripts/test-worker-runtime.mts`: 92/92 real-workerd scenarios passed.
- **Secrets scan**: 2 findings, both confirmed non-secret false positives
  (the recurring `BASESCAN_TOKEN_CONTRACT` public contract address, and a
  non-reusable internal `OLD_AUTH_PAYMENT_ATTEMPT_ID` tracking identifier
  from a prior forensic report). Zero real secret findings.

## Root-cause classification

`E4_502_ROOT_CAUSE_CLASS` remains **unproven at the specific-branch level**
for the actual E3/E4 incidents — no evidence (request/response capture,
executor diagnostic, or reproduction) ties either incident to any one of
the three now-distinguished branches. What this checkpoint changes is
**diagnostic resolution going forward**: the next live attempt that hits
this same collapse will report exactly which of `WEBCTX_HTTP_PREMATURE_EOF`,
`WEBCTX_HTTP_INVALID_RESPONSE_STATUS`, `WEBCTX_RESPONSE_READ_FAILED`, or (if
none of those) a genuinely novel bucket occurred — collapsing the
diagnostic search space from "somewhere in HTTP parsing" to one exact
branch, deterministically.

## Decision: PATH A (diagnostic-only), no behavioral fix

No proven bug was found that plausibly explains E3/E4. The one real defect
found (1xx handling) is not evidenced as the cause. Per this checkpoint's
own gate, only a **proven** root cause justifies a behavioral fix; a
diagnostic-only candidate is therefore the correct and complete output of
this checkpoint.

## E5 candidate

Justification: the next real-paid retry, if it fails at the same
high-level stage again, will now be diagnostically decisive rather than
another instance of the same generic bucket. That alone justifies carrying
this diagnostic improvement into a fresh candidate ahead of any future
retry authorization.

Candidate build/upload, config read-back, and production-containment
verification follow in the evidence section of the companion upload report.

## Governance note

During this checkpoint's mutation-proof work, a background harness run hung
on a silently-accepted mutant (the chunk-loop mutation from the list
above), and a subsequent recovery step included one `git checkout` command
that inadvertently reverted the working tree to a pre-checkpoint commit,
discarding the in-progress (uncommitted) implementation. Both the
diagnostic implementation and its test coverage were reconstructed
byte-for-byte from a diff captured immediately before the checkout, and
re-verified GREEN (53/53) before the mutation-proof harness was re-run to
completion. No live, economic, or production-affecting action was
implicated in either incident.

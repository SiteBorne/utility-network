# SUN-1221E5Q6C — Cloudflare edge startTls/SNI root-cause confirmation

## Lineage

- Q6A evidence: `74a7c1e` — closed two-value `eof_branch_id` enum
  (`HEADER_PARSE_EOF` | `CHUNKED_BODY_EOF`) propagated to the diagnostic
  surface without exposing raw error text.
- Q6B evidence: `a69efdb` — `HEADER_PARSE_EOF` is `ZERO_RESPONSE_BYTES`;
  secure socket opened, request write resolved, no first response byte, no
  header terminator; `allowHalfOpen` hypothesis refuted (both `true`/`false`
  reproduce the same zero-byte EOF).
- Production throughout: `de70bf98-f304-4d7f-b189-4ae2401041a0` @100%,
  preflight PASS before and after this checkpoint.

## External evidence: cloudflare/workerd#6903

Verified live (not taken on faith from the prompt): **open**, filed by
`latentharbor`, title `startTls({ expectedServerHostname }) is ignored on
the production edge — no SNI is sent`. Reproduction: `connect()` given an
IP literal, `startTls({ expectedServerHostname: originalHostname })`,
local `workerd` succeeds, real edge returns `EOF - no data received`. A
packet capture on the issue shows the resulting `ClientHello` carries no
`server_name` extension at all — RFC 6066 forbids IP literals in SNI, and
the edge does not fall back to `expectedServerHostname` to fill it in, so
SNI is omitted outright and the peer's default-cert handshake is rejected
with a reset. The issue's own `?control=1` (connect by hostname) run
succeeds 3/3 on the same edge.

## SITEBORNE's exact API shape

`packages/provider-adapters/src/http/socket-http-client.ts:102-115`:

```
const connectIp = isIpLiteral(hostname) ? hostname : await this.resolveOrThrow(hostname);
...
socket = this.config.connect({ hostname: connectIp, port }, { secureTransport: 'starttls', allowHalfOpen: false });
socket = socket.startTls({ expectedServerHostname: hostname });
```

| Field | Value |
|---|---|
| `CONNECT_HOST_ARGUMENT_CLASS` | `IP_LITERAL` (pre-resolved, SSRF-validated) |
| `CONNECT_SECURE_TRANSPORT` | `starttls` |
| `START_TLS_CALLED` | YES |
| `START_TLS_EXPECTED_SERVER_HOSTNAME_SET` | YES (original request hostname) |
| `TLS_NAME_EQUALS_ORIGINAL_REQUEST_HOST` | YES |
| `CONNECT_ADDRESS_EQUALS_TLS_NAME` | **NO** — exactly the shape #6903 reports as broken |

## Fingerprint matrix

| Criterion | SITEBORNE | Upstream #6903 | Match |
|---|---|---|---|
| Real Cloudflare edge only | YES (Q4–Q6B: local fake-socket harness never reproduces; only `wrangler dev --remote`) | YES | ✓ |
| Connect address is IP literal | YES | YES | ✓ |
| TLS peer name differs from connect address | YES | YES | ✓ |
| `secureTransport=starttls` | YES | YES | ✓ |
| `expectedServerHostname` supplied | YES | YES | ✓ |
| Secure socket opened | YES (Q6B) | YES | ✓ |
| Request write resolves | YES (Q6B) | n/a (their repro reads before checking write) | ✓ |
| Zero response bytes | YES (Q6B) | YES | ✓ |
| EOF before HTTP headers | YES (Q6A/Q6B) | YES | ✓ |
| `allowHalfOpen` doesn't change result | YES (Q6B, refuted) | YES (issue states "not allowHalfOpen") | ✓ |

`CF6903_FINGERPRINT_MATCH_COUNT=10`, `CF6903_FINGERPRINT_TOTAL=10`,
`CF6903_STATIC_FINGERPRINT_MATCH=YES`.

`CF6903_STATUS=OPEN`, `CF6903_FIX_PR_IDENTIFIED=NO`,
`CF6903_RELEASED_FIX_IDENTIFIED=NO`, `CF6903_WORKAROUND_DOCUMENTED=YES`
(connect-by-hostname, per the issue's own control case).

`INITIAL_SOCKET_CLOSURE_AFTER_STARTTLS_EXPECTED_BY_CONTRACT=YES`,
`ALLOW_HALF_OPEN_DIRECTION_CONFIRMED=YES`.

## The one causal control

Added `/__diag/webctx-remote-hostname-control` to the existing dev-only,
never-bundled, never-production-imported diagnostic seam
(`apps/edge-api/src/dev-diagnostics/webctx-remote-diagnostic.ts`, confirmed
absent from the production dry-run bundle by `test:worker-runtime`'s bundle
isolation gate both before and after this change). It changes exactly one
variable versus the real sequence above — `connect()`'s own `hostname` is
the hardcoded diagnostic target's hostname (`example.com`) instead of a
pre-resolved IP literal — holding `secureTransport`, `expectedServerHostname`,
`allowHalfOpen: false`, the write-then-close-before-read ordering, and the
request bytes identical to `socket-http-client.ts`. Guarded by the same
`DIAGNOSTIC_SEAM_ENABLED` var, no user-controlled target, no production
reachability.

TDD/regression before the live call: typecheck clean, lint clean, full
suite 2447 passed, `test:worker-runtime` 93/93 scenarios passed (bundle
isolation still excludes the diagnostic seam and the new route from the
production bundle), production preflight PASS.

One `wrangler dev --remote` session (routes/queues-free override config,
per Q4), inert control first (`Q6C_INERT_HTTP_STATUS=200`), then exactly
one call to the new hostname-control route:

```json
{
  "total_response_bytes": 0,
  "first_response_byte_observed": false,
  "status_line": null,
  "header_terminator_seen": false,
  "eof_observed": true,
  "elapsed_ms": 8
}
```

## Decisive differential

| | Q6B (IP-literal, failing side, reused, not re-run) | Q6C (hostname control) |
|---|---|---|
| Connect address | validated IP | `example.com` (hostname) |
| Secure socket / write | opened, resolved | (not independently instrumented this route — no exception was thrown, so all of connect/startTls/write/close completed) |
| Response bytes | 0 | 0 |
| Result | `HEADER_PARSE_EOF` | zero-byte EOF, identical shape |

`CONNECT_ADDRESS_CAUSAL_DIFFERENTIAL_PROVEN=NO`. Changing only the connect-
address identity — the one variable #6903 identifies as the trigger — did
**not** change the outcome. The hostname control reproduces the exact same
zero-byte EOF as the IP-literal path.

## #6903 match classification

`SITEBORNE_CF6903_MATCH_PROVEN=NO`. The static API-shape fingerprint matches
exactly, but the one causal control that would confirm the mechanism
falsifies it: if omitted SNI on IP-literal connects were SITEBORNE's cause,
connecting by hostname (correct SNI by construction, no `expectedServerHostname`
mismatch possible) should have received real HTTP bytes, as it did 3/3 in
the upstream issue's own reproduction. It did not.

`SITEBORNE_PACKET_CAPTURE_PERFORMED=NO` —
`PLATFORM_PACKET_CAPTURE_EVIDENCE_SOURCE=cloudflare/workerd#6903` (their
capture only, never claimed as SITEBORNE's own).

## Root cause classification

`E5_HEADER_EOF_ROOT_CAUSE_CLASS=UNRESOLVED` (not
`CLOUDFLARE_EDGE_STARTTLS_EXPECTED_SERVER_HOSTNAME_SNI_FAILURE` — the
control disproves that class for this target).
`E5_HEADER_EOF_ROOT_CAUSE_PROVEN=NO`.

## Open confound, not resolved here

`example.com` (IANA reserved test domain) is SITEBORNE's fixed diagnostic
target throughout Q4–Q6C; the upstream issue's own repro target is
`api.github.com`. It is possible `example.com` itself behaves atypically
against the real edge (rate limiting, `Connection: close` handling,
User-Agent sensitivity, TLS session behavior) independent of the SNI
question, in a way that would mask or mimic a zero-byte EOF regardless of
connect-address identity. Changing the fixed target is outside this
checkpoint's Target Rule and is not exercised here — flagged as an open
line of inquiry for the next checkpoint rather than resolved unilaterally.

## Repository vs. platform responsibility

Since `SITEBORNE_CF6903_MATCH_PROVEN=NO`, §18–21 (safe-workaround audit,
architecture-change evaluation) do not apply this checkpoint —
`REPOSITORY_PROTOCOL_LOGIC_DEFECT=UNPROVEN`,
`CLOUDFLARE_PLATFORM_DEFECT=UNPROVEN`, `REPOSITORY_FIX_REQUIRED=UNPROVEN`.
No production code was touched; `SHARED_TRANSPORT_BEHAVIOR_CHANGED=NO`,
`HTTP_PARSER_BEHAVIOR_CHANGED=NO`, `SSRF_BEHAVIOR_CHANGED=NO`,
`TLS_SECURITY_BEHAVIOR_CHANGED=NO`, `PAYMENT_BEHAVIOR_CHANGED=NO`.

## Economic zero / production containment

`LIVE_402_REQUESTS=0`, `SIGN_TYPED_DATA_PAYMENT_CALLS=0`,
`PAYMENT_SIGNATURES_CREATED=0`, `PAID_REQUESTS=0`, `SETTLEMENTS=0`,
`TRANSACTIONS=0`, `REAL_ECONOMIC_EFFECT_USDC=0`,
`CURRENT_REAL_PAYMENT_AUTHORIZATION=NONE`. `WORKER_VERSION_UPLOADS=0`,
`PRODUCTION_DEPLOYMENTS=0`. `FINAL_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0`,
`FINAL_PRODUCTION_TRAFFIC=100%`, `FINAL_PRODUCTION_PREFLIGHT=PASS`.

## Cleanup

`Q6C_REMOTE_SESSION_STOPPED=YES` (session PID confirmed terminated).
`TEMP_Q6C_ARTIFACTS_REMOVED=YES` (no scratch artifacts beyond the reused
routes/queues-free override config, which is not repository state).

## Next checkpoint

#6903 is ruled out as sufficient explanation for this target. The next
checkpoint should either (a) rerun an equivalent hostname-vs-IP control
against `api.github.com` (or another non-`example.com` target) to rule the
target-specific confound in or out before discarding the SNI hypothesis
entirely, or (b) return to remaining lifecycle/request hypotheses with the
connect-address-identity hypothesis now marked refuted for `example.com`.
`SUN1221E6_REAL_PAID_RETRY_ELIGIBLE=NO` either way, pending a proven root
cause and a deployed fix.

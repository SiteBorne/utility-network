# SUN-1221E5Q6G — Dedicated Modal Safe-Egress Executor Implementation

## Human approval

Standalone human approval, distinct from any pasted checkpoint spec, was
obtained via an explicit `AskUserQuestion` decision before any implementation
began: *"Yes, approved — proceed with Q6G"*, answering "Do you approve:
Approach C ... a new dedicated Modal App, authenticated Modal Web Function,
and dedicated environment-scoped Modal proxy credentials?"

`ARCHITECTURE_HUMAN_APPROVAL_PRESENT=YES`

## Lineage

- `SUN1221E5Q6F_DESIGN_COMMIT_SHA=3fe075e7b173ac4f38688340b757668cc00fb5e0`
- Reconciled at checkpoint start: `git status --short` clean, `git rev-parse HEAD` ==
  `3fe075e...`.
- Production baseline unchanged throughout: `de70bf98-f304-4d7f-b189-4ae2401041a0` @100%.

## What was built

### 1. `services/webctx-safe-egress/` — the dedicated off-Cloudflare executor (Python)

A brand-new package, structurally isolated from `services/modal-worker` (the
unrelated OCR app) — separate `pyproject.toml`, separate Modal App identity
(`siteborne-webctx-safe-egress` vs. `siteborne-document-worker`), separate
credentials. Mirrors ADR 0029's discipline: only `app.py` imports `modal`
(`tests/test_no_modal_leakage.py` proves this via AST inspection of every
source file).

```
src/webctx_safe_egress/
  security/
    ip_classify.py    — pure IP classification, ported line-by-line from
                          network-policy.ts (read in full, not from memory)
    url_validate.py     — scheme/port/hostname/redirect-chain validation,
                            ported from network-policy.ts's validateUrl/
                            validateRedirectChain
    dns_resolve.py        — safe DNS resolution, fail-closed on mixed/
                              prohibited answers, ported from
                              safe-dns-resolve.ts's resolveSafeAddress
  transport.py               — IP-pinned TLS HTTP/1.1 client: dials the
                                 VALIDATED IP (socket.create_connection never
                                 re-resolves a literal IP), TLS SNI and
                                 certificate hostname verification bound to
                                 the ORIGINAL hostname via server_hostname=
  executor.py                  — per-hop orchestration implementing the
                                   directive's §5 20-step algorithm; single_hop
                                   mode for the TS integration (see below)
  schemas.py                    — versioned pydantic request/response
                                    contract, structurally payment-material-free
  app.py                         — Modal App + requires_proxy_auth=True Web
                                     Function entrypoint (real modal SDK 1.5.3
                                     API, confirmed by direct inspection of
                                     modal/_partial_function.py, not assumed)
```

**86 tests, all real, none mocked at the security-boundary level:**

- `test_ip_classify.py` (23) — every classifier, including a dedicated proof
  that 100.64.0.0/10 CGNAT is NOT blocked (SafeSocket's own policy doesn't
  block it either — using Python stdlib's broader `ipaddress.is_private`
  would have silently over-blocked and broken parity; caught by this test
  during development).
- `test_url_validate.py` (26) — scheme/port/localhost/IPv4/IPv6/mapped-IPv4
  rejection, redirect-chain limits/loop/private-target rejection. **A real
  bug found and fixed during TDD**: Python's `urlsplit(...).hostname` strips
  IPv6 brackets (unlike WHATWG's `URL.hostname`, which retains them — the TS
  source's own comment says so); the naive port of the TS substitution logic
  left stray brackets and made `urlsplit` reject the *rewritten* URL as
  malformed. Fixed to strip brackets explicitly before substituting.
- `test_dns_resolve.py` (10) — zero-answer/mixed-answer fail-closed
  semantics, and a **DNS-rebinding pinning proof**: a resolver double
  returning a public address on the first call and a private one on any
  later call proves (by call-count assertion) the executor never calls it
  twice.
- `test_transport_pinning.py` (4) — **against a real local TLS server**
  (self-signed cert via `openssl`, not a mock): proves the actual dial-by-IP
  + SNI/cert-verify-by-hostname behavior, proves a hostname MISMATCH is
  rejected by real `ssl` verification, proves response-size truncation.
- `test_executor.py` (12, includes single-hop mode) — private-target/mixed-
  DNS rejected before any transport call, redirect-to-private rejected,
  redirect loop/limit rejected, successful multi-hop chain, and **the
  Cloudflare-not-special-cased proof**: a real Cloudflare-owned IP
  (104.16.0.1, inside the `104.16.0.0/13` range SUN-1221E5Q6E verified live)
  passes every classifier and reaches the transport layer exactly like any
  other public address.
- `test_no_payment_material.py` (3), `test_no_modal_leakage.py` (3),
  `test_schemas.py` (11) — structural proofs, not promises.

**Mutation proof (§28), all 9 caught, harness bugs (not proof bugs) found
and fixed along the way** (a `| tail` pipe losing pytest's real exit code,
and macOS's bash 3.2 rejecting negative array indices — both fixed by
switching to explicit sequential mutation blocks reading pytest's literal
"N failed" output):

| # | Mutation | Result |
|---|---|---|
| M1 | `is_private_ip` always False | 9 tests failed |
| M2 | mixed-DNS rejection removed | 6 tests failed |
| M3 | dial by hostname instead of validated IP | 2 tests failed (real DNS error on `.invalid` TLD) |
| M4 | SNI set to the IP instead of the hostname | 2 tests failed (real cert verify failure) |
| M5 | `check_hostname=False`/`CERT_NONE` | 1 test failed (mismatch no longer rejected) |
| M6 | redirect-chain revalidation skipped | 1 test failed (caught by the INDEPENDENT per-hop `validate_url` check — a real defense-in-depth property this mutation surfaced) |
| M7 | response-size enforcement disabled | 1 test failed |
| M8 | `requires_proxy_auth=False` | 1 test failed |
| M9 | a `facilitator` reference introduced | 1 test failed |

`SAFE_EGRESS_MUTATION_PROOF=PASS`. `ruff check` and `mypy --ignore-missing-imports`:
both clean (one genuine mypy finding — `socket.getaddrinfo`'s `str | int`
sockaddr element type — fixed with an explicit `str()`, not suppressed).

### 2. `packages/provider-adapters/src/http/modal-safe-egress-client.ts` — the Worker-side client

Drop-in `InjectedHttpClient` implementation. The one architectural
correction made during implementation, found by reading `client.ts` in full
rather than assuming: `SecureHttpClient` (the layer `PublicHttpAdapter`
already wraps every injected client in) owns a well-tested, Worker-side
redirect loop — it calls `.fetch()` once per hop with `redirect: 'manual'`
and independently revalidates every redirect target itself with the same
`validateUrl`/`validateRedirectChain` it already runs today. `SafeSocketHttpClient`
matches that single-hop contract; a naive port of the executor's own
multi-hop redirect-following would have silently double-handled redirects.
Fixed by adding `single_hop: bool = False` to the Python request contract
(default preserves the executor's own complete redirect-following for any
future direct caller) — `ModalSafeEgressClient` always sets `single_hop:
true`, so `SecureHttpClient`'s existing, unchanged redirect loop keeps
driving the multi-hop sequence, with the Worker validating each hop
BEFORE asking the executor to fetch it (defense-in-depth) and the executor
independently revalidating it AGAIN (authoritative for the actual
connection) — stronger than either layer alone.

Error mapping requires zero changes to `errors.ts`'s existing
`WEBCTX_HTTP_PREMATURE_EOF`/etc. classification — the executor's own
`reason_code` values are the literal same strings already in
`WEBCTX_DIAGNOSTIC_REASON_PATTERNS`. Two new, narrowly-scoped, additive
patterns were added for a genuinely distinct failure LAYER (reaching/
authenticating the executor itself, not the target site):
`WEBCTX_EXECUTOR_UNAVAILABLE` (network/timeout/5xx reaching the executor)
and `WEBCTX_EXECUTOR_AUTH_FAILED` (401/403 — wrong/missing proxy credential).
12 new TS tests (`modal-safe-egress-client.test.ts`), all offline (fake
`fetchImpl`, no real network, no real credentials), including a proof the
proxy secret never appears in any thrown error message.

### 3. Production wiring

`web-context-v2-cdp-composition.ts`'s ONE real production call site
(`buildWebContextV2CdpProductionRouteConfig`) now calls
`buildWebContextV2ModalSafeEgressClient(env)` instead of
`buildWebContextV2SafeHttpClient(connectFnOverride)` — unconditional, no
hybrid/CIDR-based routing split (Approach C, as approved). Fails closed
(`unavailable: true`, never falls back to `SafeSocketHttpClient`) when any
of `MODAL_WEBCTX_ENDPOINT_URL`/`MODAL_WEBCTX_PROXY_KEY`/
`MODAL_WEBCTX_PROXY_SECRET` is absent — exactly the same pattern already
established for `PAID_RECEIPT_SIGNING_PRIVATE_KEY`/CDP credentials.
`buildWebContextV2SafeHttpClient` itself is UNCHANGED and still exported —
retained for the dev-diagnostic seam (SUN-1221E5Q4-Q6D) and its own tests,
never called from the production path anymore. `connectFnOverride` (now
genuinely dead — nothing calls the production composition with a real
socket transport anymore) was removed from the function signature (caught
by ESLint's `no-unused-vars`, not silently left).

Three new optional `Env` fields added (`env.ts`), all fail-closed when
absent, never fabricated: `MODAL_WEBCTX_ENDPOINT_URL`, `MODAL_WEBCTX_PROXY_KEY`,
`MODAL_WEBCTX_PROXY_SECRET`.

**A pre-existing opt-in test (`test-worker-runtime.mts` PHASE 10, gated
behind `RUN_WORKER_RUNTIME_LIVE_NETWORK_PHASE=true`, skipped by default and
skipped in every run this checkpoint) historically proved the real
SafeSocket-based production composition end-to-end, including a real paid
settlement.** That premise is now obsolete — SafeSocket is no longer the
production transport. Rewrote it to prove the new, correct, honest
behavior instead: fails closed with a `configuration_error` mentioning
`MODAL_WEBCTX`, before any 402/payment/settlement code path — using a plain
`fetch()` call, not `get402`/`payAndFetch`, so there is no route left to
real payment execution in this phase at all. A future checkpoint that
legitimately provisions a deployed Modal executor should restore a genuine
end-to-end proof here.

## Regression

```
LINT=PASS (16/16 packages)
TYPECHECK=PASS (edge-api + provider-adapters clean; the 2 pre-existing
  tests/live/web-context-first-paid-e2e-local.test.ts errors are
  unrelated and pre-existing -- confirmed identical via git stash in
  SUN-1221E5Q4/Q5/Q6D, not re-litigated here)
TESTS=2462 passed, 38 skipped, 0 failed (pnpm test, full monorepo)
WORKER_RUNTIME=93/93 scenarios passed (PHASE 10 correctly skipped by
  default; bundle isolation intact; dev-diagnostic seam still absent
  from the production bundle)
PRODUCTION_PREFLIGHT=PASS (12/12 paid routes structurally unavailable
  before economics -- web-context now correctly included in that count,
  fail-closed on missing MODAL_WEBCTX_* credentials)
NEW_Q6G_SECRETS_FINDINGS=0 (2 pre-existing findings unchanged, in
  unrelated historical report files, commits a755620/322852a)
```

### Payment-ordering regression (§21/§22)

No code in `x402-service.ts`'s settlement-ordering/facilitator-dispatch
logic was touched — `ModalSafeEgressClient` sits entirely behind the SAME
`InjectedHttpClient`/`ServiceExecutor` abstraction boundary
`SafeSocketHttpClient` already sat behind. `apps/edge-api/tests/
x402-service-route.test.ts`'s existing executor-failure/settlement-ordering
suite (SUN-1221E2D, "executor failures surface a sanitized diagnostic audit
event, never new detail in the public 502 body") passed unchanged as part
of the full 2462-test run — direct, real evidence the shared settlement
gate is unaffected, not merely an assumption.

`EXECUTOR_ECONOMIC_CAPABILITY=0` — structural, not a promise:
`InjectedHttpClient` has exactly one method (`fetch`), and
`services/webctx-safe-egress`'s own `test_no_payment_material.py` proves
by AST inspection that no source file in that package imports anything
payment-related and the request schema has no field for any of it.

## Cost model (§30)

Real, published Modal pricing (fetched live this checkpoint, not
fabricated): CPU $0.0000131/core/sec (0.125-core minimum), memory
$0.00000222/GiB/sec. `app.py`'s `fetch` function specifies no explicit
`cpu=`/`memory=`, so Modal's platform default applies (exact default
memory allocation for an unspecified-resource function is the one pricing
fact this estimate could not directly verify this checkpoint — flagged
honestly, not assumed).

At the 0.125-core minimum and an assumed-conservative 256MiB (0.25 GiB):
`(0.125 × $0.0000131) + (0.25 × $0.00000222) ≈ $0.00000219/sec` of
container runtime. A realistic single-hop fetch (DNS + TCP + TLS + a
modest HTTP response) completing in **1 second** costs **≈$0.0000022** —
about **0.024% of the $0.009 USDC service price**. Even a pessimistic
**10-second** duration (slow target, large page, near the request's own
30s ceiling) costs **≈$0.000022**, still under 0.3% of the price.

```
ESTIMATED_EXECUTOR_COMPUTE_COST_PER_REQUEST=~$0.0000022-$0.000022 (1s-10s@0.125 core/256MiB assumption)
MARGIN_COMPATIBLE_WITH_0_009_USDC=YES
```
The only genuinely missing fact (Modal's exact unspecified-memory default)
would need to be ~40x larger than assumed before it meaningfully changed
this conclusion — not treated as blocking given that margin.

## What was deliberately NOT done — the provisioning boundary

Per §33's own explicit escape valve: a real non-economic live verification
(§34-37) requires a genuinely deployed Modal App and real, environment-scoped
`MODAL_WEBCTX_*` proxy credentials. Neither was created this checkpoint —
`modal deploy` was never run, no Cloudflare secret was ever set, no value
was fabricated anywhere in the repository (`NEW_SECRET_VALUES_COMMITTED=NO`).
This is a real, outward-facing, hard-to-reverse action against a live third-
party account (creating a real Modal App and issuing real credentials) that
the human architecture approval covered as a design decision, not as a
standing authorization to execute that specific external provisioning step
autonomously — consistent with every other checkpoint in this chain never
touching real external account state without it being the explicit subject
of the turn.

```
LIVE_EXECUTOR_VERIFICATION_BLOCKED_ON_PROVISIONING=YES
CF_HOSTED_TARGET_RESULT=NOT_EXECUTED
NON_CF_TARGET_RESULT=NOT_EXECUTED
UNSAFE_TARGET_REJECTION=NOT_EXECUTED (structurally proven instead, offline,
  by test_executor.py's TestPrivateTargetRejectedBeforeConnect — the real
  live-target hard gate in §37 specifically requires a DEPLOYED executor,
  which does not exist yet)
FULL_PUBLIC_WEB_ARCHITECTURE_PROVEN=NO (§37's hard gate requires the live
  dual-target result, not offline proof alone)
```

Per §40's own hard gate, this means:

```
E6_CANDIDATE_TECHNICALLY_JUSTIFIED=NO
WORKER_VERSION_UPLOADS=0
```

No preupload manifest, no version upload, no candidate read-back — §41-43
are `NOT_EXECUTED`, correctly, per §40's own explicit "If any fail: STOP."

## Next checkpoint

Provisioning a real, dedicated Modal App and its proxy credentials — an
explicit, standalone human decision distinct from this checkpoint's
architecture approval — followed by exactly the non-economic dual-target
live verification (§34-37) this checkpoint's implementation is now ready
for.

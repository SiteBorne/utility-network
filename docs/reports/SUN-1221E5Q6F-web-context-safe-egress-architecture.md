# SUN-1221E5Q6F — web_context_verified.v2 Cloudflare-Destination-Safe Architecture

Architecture design only. Zero behavioral mutations, zero deployments, zero
remote diagnostic requests, zero economic actions in this checkpoint.

## 1. Reconciliation

```
git status --short         -> (clean)
git rev-parse HEAD          -> 5b484e888c53a7aaaa68d17cb67da97bac09668a
```

`HEAD` is exactly the Q6E evidence commit. Working tree clean. Q6E's report
confirms: zero remote requests spent, zero economic action, production
untouched at `de70bf98-f304-4d7f-b189-4ae2401041a0` @100%,
`ARCHITECTURE_CHANGE_REQUIRED=YES`. No mismatch. Proceeding.

## 2. Current web_context execution — call graph

```
production-web-context-v2-cdp-route.ts   [ECONOMIC + entrypoint]
  -> x402 challenge / facilitator verify  [ECONOMIC]
  -> executor dispatch (dispatcher.ts)    [ECONOMIC boundary closes here;
                                            below this line is pure service
                                            execution, no payment material]
  -> WebContextVerifiedService.execute()  [POLICY / ORCHESTRATION]
       - TermsGuard (inside PublicHttpAdapter.execute) [POLICY]
       - this.deps.publicHttp: PublicHttpAdapter        [TRANSPORT — injected]
           -> this.deps.httpClient: InjectedHttpClient   [TRANSPORT — injected]
              (concrete impl today: SafeSocketHttpClient,
               packages/provider-adapters/src/http/socket-http-client.ts)
       - buildEvidence / buildClaim / buildDraftDocument  [PCC]
       - verifyAndSign(...)                               [PCC]
  <- ServiceExecutionResult                                [PERSISTENCE via
                                                              caller: receipt/
                                                              result storage]
  -> settlement (only after successful execution, per dispatcher ordering) [ECONOMIC]
```

`WebContextVerifiedService` (`packages/service-runtime/src/services/web-context/service.ts`)
receives its transport as two **already-injected interfaces**:
`InjectedHttpClient` and `PublicHttpAdapter` (constructor `deps`, service.ts:24-32).
Nothing about the service, PCC, or economic layers reaches into
`SafeSocketHttpClient` directly — they hold an interface reference.

```
CURRENT_WEBCTX_EXECUTOR_BOUNDARY = WebContextServiceDeps.publicHttp / .httpClient
  (packages/service-runtime/src/services/web-context/service.ts:24-32)
CURRENT_TRANSPORT_ABSTRACTION = InjectedHttpClient (packages/provider-adapters/src/types.ts:254),
  PublicHttpAdapter (packages/provider-adapters/src/http/public-http-adapter.ts:86)
TRANSPORT_REPLACEABLE_BEHIND_EXISTING_INTERFACE = YES
```

This is the load-bearing fact for the whole design: a new transport can be
substituted for `SafeSocketHttpClient` by implementing `InjectedHttpClient`,
without moving the economic gate (which sits entirely above and outside
`WebContextVerifiedService`) and without touching `service.ts`, PCC, or the
dispatcher.

## 3. Existing non-Cloudflare execution infrastructure

Repository recon (`services/modal-worker/`) found real, existing Modal
infrastructure — but it is scoped narrowly to document processing, not HTTP
retrieval:

```
EXISTING_MODAL_INFRASTRUCTURE = YES
EXISTING_MODAL_DEPLOYMENT_MODEL =
  modal.App("siteborne-document-worker") defined in
  services/modal-worker/src/modal_worker/modal_app.py; single @app.function
  process_document(request_json) -> WorkerResult JSON. Import-time only
  (ADR 0029: modal_app.py is the only module permitted `import modal`;
  enforced by an AST-parsing test). No live deployment exists yet
  (SUN-0400B, "blocked_external" per the module's own docstring).
EXISTING_MODAL_AUTH_MODEL =
  MODAL_TOKEN_ID / MODAL_TOKEN_SECRET already present in the Worker's env
  binding shape (apps/edge-api/src/control-plane/config/env.ts:49-50) and in
  every CDP route's test fixtures, INCLUDING production-web-context-v2-cdp-route.test.ts.
  This is Modal's own SDK-level client-credential auth, provisioned for the
  Worker, not yet consumed by any live call site (grep of edge-api source
  found no actual `modal.` invocation — declared in config, not wired).
EXISTING_MODAL_PUBLIC_ENDPOINT = UNPROVEN (no live deployment; SUN-0400B blocked_external)
EXISTING_MODAL_HTTP_CLIENT_CAPABILITY = NO
  (the deployed function's only job is PDF/OCR document verification —
  pypdf, pdfplumber, pillow, rapidocr, torch. No general-purpose outbound
  HTTP retrieval code exists in services/modal-worker/src/modal_worker/document/.)
EXISTING_MODAL_CUSTOM_DIAL_IP_CAPABILITY = UNPROVEN (never implemented; Modal
  containers run on ordinary outbound-capable compute, so technically
  feasible, but SITEBORNE has never written or tested a raw-socket dial-to-
  validated-IP path in Python/Modal)
EXISTING_MODAL_TLS_SERVERNAME_OVERRIDE_CAPABILITY = UNPROVEN (same — feasible
  with Python's ssl module / httpx transport hooks, never implemented here)
EXISTING_MODAL_REDIRECT_REVALIDATION_CAPABILITY = NO (not implemented)
EXISTING_MODAL_SECURITY_REUSE_POSSIBLE = NO — SafeSocket's SSRF/DNS-rebinding/
  redirect-revalidation algorithm (TypeScript, packages/provider-adapters/src/http/)
  has no Python equivalent; reusing Modal means re-implementing that whole
  security algorithm in a second language, not reusing it.
```

No search hit for `heavy worker`, `job executor`, `fetch executor`, `queue
worker`, or an existing authenticated Worker→backend HTTP-retrieval
mechanism anywhere outside `services/modal-worker/`. Modal is the *only*
existing off-Cloudflare compute SITEBORNE has, and it is currently a
document-processing wrapper with an unconsumed auth binding, not an HTTP
executor.

## 4. Security reference model (current SafeSocket)

Read literally from `packages/provider-adapters/src/http/socket-http-client.ts`
and `public-http-adapter.ts`, per-hop:

```
URL parse
  -> scheme validation (http/https only)
  -> hostname normalization
  -> DNS resolution (A/AAAA)
  -> address classification (reject private/reserved/link-local/loopback/
     multicast/IPv4-mapped-IPv6/unique-local, per TermsGuard + adapter policy)
  -> reject unsafe address set (fail closed if ALL candidates unsafe)
  -> choose one validated address
  -> connect() to that validated address (IP literal — never hostname)
  -> startTls({ expectedServerHostname: <original hostname> }) for https
  -> write HTTP request (Host header = original hostname)
  -> parse response (header loop until CRLFCRLF or EOF; chunked-body reader)
  -> on redirect: repeat the entire sequence for the Location target,
     up to maxRedirects
```

`CURRENT_SECURITY_REFERENCE_MODEL_COMPLETE=YES`.

This is the algorithm any replacement executor must reproduce faithfully —
not approximate.

## 5–6. Required executor contract & DNS/TOCTOU model

`NETWORK_EXECUTOR_MUST_REVALIDATE_DESTINATION=YES`. Whichever runtime opens
the actual TCP/TLS connection must independently run the full §4 algorithm
itself. A Worker-side "this hostname is/isn't Cloudflare, therefore route
here" classification is **not** a safety decision — it is a routing hint at
best, because:

- DNS answers can change between Worker classification and executor connect
  (classic TOCTOU / rebinding);
- a single hostname can resolve to a *mixed* set of Cloudflare and
  non-Cloudflare addresses simultaneously;
- CNAME chains can retarget between the two checks;
- a redirect hop can move a request from a non-Cloudflare address to a
  Cloudflare one (or a private one) mid-chain;
- geography/edge-PoP-dependent resolution can make the Worker's answer and
  the executor's answer differ even with no attacker involved.

Any design where the Worker resolves once, decides "safe," and the executor
merely dials the same hostname it was told to is **invalid** — the address
must be pinned by whichever side does the final, authoritative resolution
+classification, and that must be the side that actually opens the socket.

## 7–13. Architecture comparison

| | A: off-CF conditional executor | B: hybrid SafeSocket + off-edge fallback | C: all direct-HTTP off-edge | D: pure Workers `fetch()` | E: VPC private egress gateway | F: restrict service contract |
|---|---|---|---|---|---|---|
| FULL_PUBLIC_WEB_COVERAGE | YES | YES | YES | YES (but see below) | YES | NO |
| VALIDATED_IP_PINNING | YES (executor pins) | YES, if executor re-validates independently (§6) | YES | **NO** — `resolveOverride` is zone-scoped only, not usable for arbitrary third-party targets | YES, if gateway re-validates independently | N/A |
| DNS_REBINDING_RESISTANCE | YES | YES only with independent re-validation in executor | YES | NO (no pinning primitive) | YES only with independent re-validation in gateway | N/A |
| TLS_HOST_IDENTITY | YES | YES | YES | YES (fetch validates normally) | YES | N/A |
| REDIRECT_REVALIDATION | YES (executor repeats §4 per hop) | YES, and must not change executor mid-redirect without re-validation (see below) | YES | YES (browser-like default; no pinning though) | YES | N/A |
| NEW_TRUST_BOUNDARY | YES (Worker↔executor) | YES | YES | NO | YES (Worker↔gateway) | NO |
| NEW_PUBLIC_SURFACE | NO (private auth'd channel) | NO | NO | NO | Depends — private binding preferred | NO |
| NEW_SECRET | YES (internal auth), unless Modal SDK creds reused | YES | YES | NO | YES | NO |
| NEW_CF_BINDING | NO (or Service Binding if same account) | NO | NO | NO | YES (VPC Service/Network — beta) | NO |
| CODE_COMPLEXITY | MEDIUM (one routing branch, single impl) | HIGH (two impls, execution-class routing, must handle mid-redirect class switch) | MEDIUM (one impl, Worker stays orchestration-only) | LOW | MEDIUM–HIGH | LOW |
| OPERATIONS_COMPLEXITY | MEDIUM | HIGH | MEDIUM | LOW | MEDIUM–HIGH (beta platform dependency) | LOW |
| LATENCY | +1 hop for CF-hosted targets only | +1 hop for CF-hosted targets only | +1 hop for **every** request | none | +1 hop for every request | N/A |
| VARIABLE_COST | executor compute, CF-hosted targets only | same, narrower | executor compute, all targets | $0 marginal | gateway compute, all targets | $0 |
| FAILURE_MODES | executor down -> CF-hosted targets fail; non-CF unaffected | most failure modes of both A and C | executor down -> **all** web_context requests fail | fetch() infra failure (rare, CF-managed) | gateway down -> all requests fail; beta-platform risk | N/A |
| PORTABILITY | good (interface-based) | worst (two paths to maintain) | best (single implementation, works after eventually leaving Workers too) | poor (Workers-specific) | poor (Workers-VPC-specific) | N/A |
| IMPLEMENTATION_SIZE | MEDIUM | LARGE | MEDIUM | SMALL | MEDIUM–LARGE | SMALL |
| MIGRATION_RISK | MEDIUM | HIGH (redirect-class-switch bugs are exactly the kind of subtle SSRF bug this whole Q6 chain exists to avoid) | LOW–MEDIUM | would require abandoning IP pinning entirely — high *security* risk, not migration risk | MEDIUM-HIGH (beta) | LOW technical, HIGH commercial (silently drops a large, unpredictable-to-the-client slice of the public web — anything CF-fronted) |
| RECOMMENDED | — | — | **YES** | NO | NO | NO |

`HYBRID_ROUTING_SECURITY_COMPLEXITY=HIGH` — Approach B's redirect-class-switch
problem (a redirect moving a chain from a non-CF target the Worker was
handling directly, to a CF-hosted target mid-chain) requires the *Worker's*
SafeSocket path to detect the class change and hand off to the executor
**with full re-validation**, or reject the redirect. That is strictly more
code and more edge cases than just always executing off-edge, for a benefit
(saving one hop on non-CF targets) that isn't worth the added attack
surface for a payment-gated service.

`PURE_WORKERS_FETCH_SECURITY_EQUIVALENT=NO` — confirmed via Cloudflare's own
current documentation: `fetch()`'s `resolveOverride` is scoped to zones the
account controls; it has no mechanism to pin an arbitrary third-party
public target to a pre-validated address. Adopting D means giving up
validated-IP pinning and DNS-rebinding resistance entirely — not a
transport swap, a security regression. Rejected outright, not just
deprioritized.

## 14. Preference-order check

1. Reuse existing secure executor infra — **not available**: Modal exists,
   but has zero HTTP-retrieval or SSRF-safety code (§3). Reusing it means
   building the entire §4 algorithm a second time in Python.
2. Minimally extend an existing internal executor — same conclusion: there
   is no existing *general-purpose outbound HTTP* executor to extend, only a
   document-processing one with an unrelated job shape.
3. New private gateway only if necessary — necessary, because (2) doesn't
   exist. Approach C is the smallest form of "necessary": one new component,
   one job (execute the existing §4 algorithm off-edge), no new public
   surface.
4. Avoid new public surface — satisfied: internal auth over a private
   channel, no public endpoint added.

Given Modal has no reusable security logic for this problem, **building a
small purpose-built off-edge HTTP executor (new code, but reusing SafeSocket's
already-*designed*-and-proven algorithm, ported/shared rather than a Modal
document-pipeline extension) is smaller and lower-risk than stretching Modal's
document worker into an unrelated job.** Whether that executor's *compute*
happens to run on Modal (as a new, second `@app.function`) or elsewhere is a
deployment-target decision, not an architecture decision — the interface
(§16) is what matters, and `TRANSPORT_REPLACEABLE_BEHIND_EXISTING_INTERFACE=YES`
means that choice can be made or changed later without touching `service.ts`.

## 15. Recommendation

```
RECOMMENDED_ARCHITECTURE = C — all direct-public-http retrieval for
  web_context_verified.v2 executes in a controlled off-Cloudflare executor;
  the Worker retains 100% of orchestration (economic gating, TermsGuard as
  defense-in-depth, PCC, settlement). No Cloudflare-destination carve-out,
  no execution-class routing, one code path for every target.

WHY_RECOMMENDED =
  Removes the entire class of bug this Q6 chain has been chasing
  (Cloudflare-destination-specific transport failure) by removing the
  Cloudflare-egress dependency entirely for this one operation. Single
  security implementation to audit, test, and reason about. No redirect
  mid-chain execution-class-switch hazard (Approach B's defining risk).
  Fits the existing `PublicHttpAdapter`/`InjectedHttpClient` seam with zero
  change to service.ts, PCC, or the economic layer (§2).

WHY_NOT_HYBRID =
  Approach B keeps SafeSocket's Cloudflare-egress limitation on the
  "fast path" and adds a second, harder problem on top: safely detecting
  and re-validating an execution-class change mid-redirect-chain. That is
  more code, more edge cases, and a strictly worse security posture than C,
  in exchange only for shaving one internal hop off non-Cloudflare-hosted
  targets — not a good trade for a payment-gated verification service.

WHY_NOT_WORKERS_FETCH =
  `resolveOverride` cannot pin arbitrary third-party targets (§10);
  adopting fetch() means abandoning validated-IP pinning and DNS-rebinding
  resistance, which are hard security requirements (§4 items 3-4, 11 in the
  mission's required-preservation list), not negotiable for a service that
  processes attacker-influenced URLs under payment.

WHY_NOT_VPC_GATEWAY =
  Still requires re-implementing the full §4 algorithm somewhere (a gateway
  is not itself a safety property), adds a beta-platform dependency
  (`BETA_PLATFORM_DEPENDENCY=YES`), and buys nothing over Approach C for
  this specific problem — SafeSocket's failure was never about *needing* a
  Cloudflare-network-level construct, it was about needing to leave
  Cloudflare's egress network for a subset (now: all) of targets.

WHY_NOT_RESTRICT_CONTRACT =
  Cloudflare fronts an unpredictable, large, and growing share of the
  public web (this investigation's own test target, example.com, is one).
  A client cannot reasonably predict which URLs would fail; that makes the
  contract non-credible, not simpler in any way a client could rely on.
  Technically the smallest change, but rejected on product-contract grounds
  per §12's own instruction not to pick it merely for ease.
```

## 16. Executor interface (recommended architecture)

```
request_version: "1"
correlation_id: <request_id, already present in ServiceExecutionContext>
target_url: string
retrieval_mode: "direct"          # matches existing WebContextInput
deadline_ms: number
max_response_bytes: number
security_policy_version: string    # pins which §4 ruleset the executor must run

EXECUTOR_RECEIVES_PAYMENT_MATERIAL = NO
```
No payment signature, EIP-3009 authorization, facilitator credential, or
production signing key crosses this boundary — those stay entirely inside
the Worker/dispatcher, above `WebContextVerifiedService` (§2). The executor
only ever sees the same shape `PublicHttpAdapter.execute()` already takes
today (`PublicHttpAdapterInput`, `public-http-adapter.ts:33`), unchanged.

## 17. Authentication / integrity design

No existing internal-request-authentication mechanism (HMAC-signed
requests, mutual bearer, etc.) was found anywhere in `apps/edge-api`,
`packages/provider-adapters`, or `packages/service-runtime` — this would be
new. Two real options surfaced by recon:

- Reuse Modal's own SDK client-credential auth (`MODAL_TOKEN_ID` /
  `MODAL_TOKEN_SECRET`, already provisioned in `env.ts` and every CDP
  route's test fixtures) if the executor is deployed *as* a Modal function
  and invoked via Modal's client SDK/web endpoint auth — no new secret
  needed, reuses infra that's already sitting there unconsumed.
- If the executor is not Modal-hosted, a short-lived signed request
  (timestamp + nonce + method/path/body-hash HMAC, short expiration,
  constant-time verification) — standard shape, no new crypto invented, but
  does need a new shared secret.

```
RECOMMENDED_INTERNAL_AUTH_MODEL = Modal SDK client-credential auth if
  executor deployed on Modal (reuses MODAL_TOKEN_ID/SECRET already
  provisioned); otherwise HMAC-signed request with nonce+timestamp+body-hash.
NEW_SECRET_REQUIRED = NO if Modal-hosted, YES otherwise.
```
This is the one open question this design leaves for the implementation
checkpoint to settle with a real deployment-target decision (§26).

## 18. Executor result contract & reason-code ownership

Bounded response, mirroring `PublicHttpAdapterResult` (`public-http-adapter.ts:44`)
byte-for-byte in shape: `resultClass`, `observations[]` (content/mediaType/
finalUrl/status/headers/redirectChain/truncated), `error?.code`,
`error?.eof_branch_id` where applicable. No raw infra exception text ever
crosses the boundary — matches the existing `httpDiagnosticDetails`
discipline in `service.ts:227-236` (SUN-1221E5Q6A) of never passing through
raw `error.message`.

Reason-code ownership stays exactly where it is today:

```
WEBCTX_HTTP_PREMATURE_EOF, DNS error, SSRF block, TLS error, timeout,
response-too-large, redirect failure -> all owned by the executor's
transport implementation (today: socket-http-client.ts's classification
logic; unchanged by this migration, only its execution location moves).
```

## 19. PCC / evidence integrity

```
PCC_SEMANTICS_CHANGE_REQUIRED = NO
```
`verifyAndSign` (service.ts:206-211) only ever signs over the
`WebContextExtension` built from the adapter's *returned* observation
(content hash, source URI, retrieved-at, etc.) — it already treats
`publicHttp.execute()`'s result as the thing being attested, regardless of
which process ran the socket. Moving that execution off-edge over an
authenticated, mutually-trusted internal channel does not expand what PCC
claims; the Worker is still the one deciding pass/fail and signing. No new
unauthenticated-assertion trust is introduced as long as §17's channel is
authenticated.

## 20. Economic ordering

```
PAYMENT_ORDERING_CHANGE_REQUIRED = NO
EXECUTOR_SETTLEMENT_CAPABILITY = NO
```
Per §2, the economic gate (402 -> facilitator verify -> dispatch) sits
entirely above `WebContextVerifiedService`; the executor is reached only
*inside* that already-gated call, exactly where `SafeSocketHttpClient` is
reached today. Settlement remains solely the dispatcher's job, occurring
only after `execute()` returns, per existing rules — unchanged.

## 21. Failure semantics (fail-closed)

Executor unreachable / auth failure / timeout / malformed response /
internal error, and DNS rejection / unsafe destination / redirect-to-unsafe
/ TLS failure / HTTP protocol failure from *within* the executor — all map
to the existing `internal_verification_failed` / `WEBCTX_HTTP_PREMATURE_EOF`-
style failure path already in `service.ts` (the `httpFetchFailed` branch,
service.ts:225-237). No path exists (or should be added) for a paid retry
after payment material has been created — settlement's existing "only after
successful execution" ordering already prevents this by construction (§20);
migration must not introduce a retry loop around the new executor call that
could re-attempt after settlement.

## 22–25. Cost, latency, availability, observability

```
PER_REQUEST_EXECUTOR_COST_ESTIMATE = UNPROVEN — no current repository/
  provider pricing evidence for a general-purpose HTTP-executor container
  (Modal's document-worker pricing reflects OCR/PDF workloads, not a
  lightweight HTTP fetch; not a valid proxy). Missing fact: expected p50
  container-invocation cost for a <1s HTTP-fetch job on whichever compute
  target is chosen.
MARGIN_COMPATIBLE_WITH_0_009_USDC = UNPROVEN, blocked on the above.
EXPECTED_LATENCY_DELTA = +1 network hop (Worker -> executor) versus current
  SafeSocket, for every request (not just Cloudflare-hosted ones, since
  Approach C is unconditional). No SLA invented; order-of-magnitude only.
```
Availability: infra-level routing/failover (e.g., multi-region executor)
is an operational concern for the executor platform, separate from and
must not be conflated with application-level retry after payment (§21) —
no hidden retry on paid execution.

Observability: request count, success/failure class, latency, and each
distinct rejection reason (DNS/SSRF/TLS/HTTP/size) as metrics only — never
target content, never secrets, matching existing logging discipline
elsewhere in the codebase.

## 26. Migration boundary (not edited in this checkpoint)

```
FILES_EXPECTED_TO_CHANGE =
  packages/provider-adapters/src/http/  (new InjectedHttpClient
    implementation calling the executor, alongside existing socket-http-client.ts)
  a new executor package/service (location depends on §17's deployment-
    target decision — new services/*-http-executor/ or an addition to
    services/modal-worker/ as a second, unrelated @app.function)
  apps/edge-api/src/control-plane/config/env.ts (executor auth config, if
    not reusing MODAL_TOKEN_ID/SECRET as-is)
  wiring of WebContextServiceDeps.httpClient at the composition root (which
    concrete InjectedHttpClient gets constructed) — service.ts itself is
    NOT expected to change (§2).

FILES_EXPECTED_NOT_TO_CHANGE =
  packages/service-runtime/src/services/web-context/service.ts
  packages/service-runtime/src/pcc/**
  economic gating / dispatcher / facilitator / settlement code
  packages/provider-adapters/src/http/public-http-adapter.ts's interface
    shape (PublicHttpAdapterInput/Result stay the contract; only the
    InjectedHttpClient implementation behind it changes)
```

## 27–28. Test strategy & non-economic verification plan

Implementation-phase TDD (not run in this checkpoint) should cover, at
minimum: Cloudflare-hosted target success, non-Cloudflare target success,
private-IP rejection, mixed-DNS-set rejection, DNS-rebinding simulation,
redirect-to-private rejection, TLS hostname validation, address pinning,
response/request size bounds, timeout, internal-auth rejection, tamper
rejection, executor-unreachable failure, payment-ordering-unchanged,
settlement-never-called-on-execution-failure, production bundle isolation,
and MCP/discovery coherence — mirroring the existing SafeSocket test
matrix (packages/provider-adapters' current test suite) applied to the new
executor.

Pre-E6 non-economic verification requires at minimum: (A) a Cloudflare-
hosted public HTTP target, (B) a non-Cloudflare public HTTP target, (C) a
synthetic private/unsafe-target test that never actually dials out. A
single successful `example.com` call does not constitute proof.

## 29. E6 readiness criteria

Unchanged from the mission's own list: Cloudflare-hosted success,
non-Cloudflare success, all SSRF/DNS-rebinding/redirect/TLS invariants,
timeout/size bounds, internal authentication, full regression, unchanged
economic ordering, untouched production baseline — plus fresh standalone
human authorization for the real E6 payment, which no evidence in this or
any prior checkpoint substitutes for.

## 30. Security review (recommended design, Approach C)

| Threat | Boundary | Mitigation | Residual risk |
|---|---|---|---|
| Attacker controls target URL | Executor input | Executor re-runs full §4 validation independently; Worker-side TermsGuard remains defense-in-depth | Low — two independent validations of the same untrusted input |
| Attacker controls/changes DNS between check and connect | Executor resolution | Executor resolves once and pins the chosen address for the actual connect (never re-resolves the hostname later in the same request) | Low |
| Attacker returns a redirect | Executor per-hop loop | Every hop re-runs full §4 validation, including the "still off-edge" invariant — no execution-class switch exists in Approach C, unlike B | Low |
| Attacker targets metadata endpoints (169.254.169.254 etc.) | Address classification | Explicit reserved/link-local rejection, unchanged from current SafeSocket policy | Low |
| Attacker targets private networks (RFC1918 etc.) | Address classification | Same rejection list, ported unchanged | Low |
| IPv6 bypass (e.g. IPv4-mapped, ULA) | Address classification | Existing classification already covers this class (§4); must be preserved, not re-derived from scratch, in the ported implementation | Medium until the port is proven equivalent by test (§27) |
| Encoded-IP bypass (octal/hex/decimal IP forms) | URL/hostname parsing | Must normalize before classification — existing behavior to preserve exactly | Medium until proven by test |
| Attacker replays a captured internal executor request | Internal channel | §17's auth model requires nonce+timestamp (or Modal SDK's own request signing) — replay window bounded by short expiration | Low |
| Attacker forges an executor response | Internal channel | Same authenticated channel; response integrity relies on the same mutual auth, not a separate signature — acceptable for a private, non-public channel per §19 | Low-Medium (accepted; PCC does not need to expand to compensate, since the Worker still owns the pass/fail decision, §19) |
| Executor compromised | Executor process | Executor never holds payment material (§16); worst case is bad/malicious HTTP responses being fed into PCC, same blast radius as a malicious *target site* today | Medium (new component, new attack surface, but bounded) |
| Worker compromised | N/A (out of scope — pre-existing) | Unchanged by this migration | Unchanged |
| Internal auth secret leaked | Internal channel | Rotatable credential (Modal token rotation, or HMAC secret rotation); short-lived signed requests limit blast window | Medium |

## 31. Architecture decision

```
WEBCTX_ARCHITECTURE_DESIGN_READY_FOR_HUMAN_DECISION = YES
RECOMMENDED_ARCHITECTURE = C — all web_context_verified.v2 direct-public-http
  retrieval executes in a controlled off-Cloudflare executor; Worker keeps
  100% of orchestration/economic/PCC responsibility.
EXISTING_INFRASTRUCTURE_REUSED = PARTIAL — Modal's account/deployment
  tooling and (possibly) its auth credentials can be reused as the
  *deployment target*; its document-processing code and security logic
  cannot (§3).
NEW_RUNTIME_REQUIRED = YES (a second, unrelated executor function/service —
  whether hosted on Modal or elsewhere is an implementation-checkpoint decision)
NEW_PUBLIC_SURFACE_REQUIRED = NO
NEW_SECRET_REQUIRED = CONDITIONAL — NO if Modal-hosted and Modal SDK auth is
  reused as-is; YES if a different/self-hosted executor is chosen (§17)
NEW_CLOUDFLARE_BINDING_REQUIRED = NO (or, optionally, a Service Binding if a
  same-account Cloudflare-adjacent option were ever chosen instead — not
  needed for the recommended Modal-or-equivalent path)
FULL_PUBLIC_WEB_COVERAGE = YES
VALIDATED_IP_PINNING_PRESERVED = YES, conditional on the ported executor
  faithfully reproducing §4's algorithm (must be proven by test, §27)
DNS_REBINDING_PROTECTION_PRESERVED = YES, same condition
REDIRECT_REVALIDATION_PRESERVED = YES, same condition
TLS_HOSTNAME_VALIDATION_PRESERVED = YES, same condition
PAYMENT_ORDERING_CHANGE_REQUIRED = NO
PCC_SEMANTICS_CHANGE_REQUIRED = NO
ARCHITECTURE_IMPLEMENTATION_COMPLEXITY = MEDIUM
IMPLEMENTATION_CHECKPOINT_COUNT_ESTIMATE = 4-6 (deployment-target decision +
  executor security-algorithm port & TDD; internal auth wiring; InjectedHttpClient
  adapter + composition-root wiring; non-economic dual-target verification;
  regression/production-bundle-isolation proof; final E6 re-qualification)
PRIMARY_RESIDUAL_RISK = the ported §4 algorithm (address classification,
  redirect-hop re-validation, encoded-IP/IPv6-bypass handling) silently
  diverging from SafeSocket's proven TypeScript implementation during the
  port to the executor's runtime — must be closed by an equivalence test
  suite before E6 re-qualification, not assumed from a successful example.com call.
HUMAN_DECISIONS_REQUIRED =
  1. Approve Approach C over B/D/E/F.
  2. Choose the executor's deployment target (extend Modal with a second,
     unrelated function vs. a new dedicated service) — affects §17's auth
     answer and §22's unresolved cost question.
  3. Approve `NEW_RUNTIME_REQUIRED=YES` (a new always-available, potentially
     billable component in the request path for every web_context_verified.v2 call).
```

## 33. Final stop

```
SUN1221E6_REAL_PAID_RETRY_ELIGIBLE = NO
```
Design only. No implementation. No deployment. No E6. No payment
authorization request. No F. No G. Human architectural approval required
before any implementation checkpoint begins.

# SUN-1221C — `web_context_verified.v2` / CDP Implementation (Phase C of SUN-1221CD)

TDD implementation. No Worker upload, no deployment, no traffic shift, no
D1 write, no 402 against a live endpoint, no payment, no signing, no
settlement. All testing below uses Miniflare/vitest/`wrangler dev --local`
(real workerd, isolated, non-production).

## Evidence chain

```
SUN1221B_DESIGN_EVIDENCE_COMMIT_SHA = b0426d467eb23379e2264ef1fb88de3f57067d13
SOURCE_HEAD_SHA (start of this checkpoint) = b0426d467eb23379e2264ef1fb88de3f57067d13
SUN1221B_REPORT_INTEGRITY = PASS (423 lines, 0 corruption markers, all 20 sections present)
CURRENT_PRODUCTION_VERSION (start and end, unchanged) = de70bf98-f304-4d7f-b189-4ae2401041a0 @ 100%
```

## §1 — DNS-rebinding root cause reconciled, fix built and proven

B's hard finding: `validateUrl` (`packages/provider-adapters/src/policy/network-policy.ts`)
only inspects a URL's literal hostname string against IP-literal regexes —
a plain domain name that DNS-resolves to a private/loopback address is
never checked, and the real `fetch()` call has no interception point to
re-validate the *resolved* address before connecting.

**Root cause, reconciled precisely** (not assumed):
- `DNS_RESOLUTION_IMPLEMENTATION` (before this checkpoint) = none — DNS
  resolution happened transparently inside Cloudflare's edge network via
  the platform `fetch()`, with zero application-level visibility.
- `NETWORK_CONNECTION_IMPLEMENTATION` (before) = the platform `fetch()`
  directly on the hostname string.
- `CURRENT_TOCTOU_WINDOW` (before) = the entire gap between `validateUrl`
  passing a hostname and the platform's own, invisible-to-us DNS
  resolution + connection.
- `VALIDATED_ADDRESS_EQUALS_CONNECTED_ADDRESS_PROVEN_CURRENTLY` = **NO**.

**The platform mechanism that closes this, proven available** (not
assumed): `@cloudflare/workers-types`'s own root `index.d.ts` declares a
real `cloudflare:sockets` module — `connect(address: SocketAddress |
string, options?)`, where `SocketAddress.hostname` accepts a **literal
IP** (no DNS involved when given one), and `Socket.startTls({
expectedServerHostname })` lets TLS certificate validation check against
the real hostname *independently* of which literal address the TCP
connection was pinned to. This is the textbook-correct "validate, then
connect to the exact validated address, verify certificate against the
real name" pattern.

`DNS_REBINDING_ROOT_CAUSE_PROVEN = YES`.
`PROPOSED_SAFE_CONNECTION_INVARIANT` = connect via a literal, DoH-resolved,
policy-validated IP; pin TLS `expectedServerHostname` to the real hostname
separately.
`PROPOSED_PLATFORM_MECHANISM` = `cloudflare:sockets` `connect()` +
`startTls({ expectedServerHostname })`.
`DNS_REBINDING_FIX_PROVEN_FEASIBLE = YES` — the mechanism does NOT permit
a second, uncontrolled DNS lookup: a socket `connect()` given a literal IP
string has nothing left to resolve.

## §2 — Implementation

Two new, fully unit-tested, dependency-injected modules in
`packages/provider-adapters/src/http/`:

- **`safe-dns-resolve.ts`** — `resolveSafeAddress(httpClient, hostname)`
  queries a fixed, trusted DoH endpoint (`https://cloudflare-dns.com/dns-query`
  — Cloudflare's own, never the buyer-supplied target) for both A and AAAA
  records, and evaluates every returned address through the *exact same*
  `isPrivateIp`/`isLoopback`/`isLinkLocal`/`isMulticast`/`isReserved`/
  `extractIpv4MappedAddress` functions `validateUrl` already uses for
  literal IPs — zero gate logic duplicated. Fails closed on zero answers
  or **any** prohibited answer (a mix of one public + one private answer
  is treated as an attack/misconfiguration signal, not something to route
  around by picking "the good one").
- **`socket-http-client.ts`** — `SafeSocketHttpClient implements
  InjectedHttpClient`. Runs the existing `validateUrl` first (unchanged,
  defense in depth). A literal-IP hostname skips DNS entirely (already
  proven safe). Otherwise resolves via `resolveSafeAddress` and connects
  via the injected `connect()` using the **exact validated literal IP** as
  the socket address — never the original hostname — with TLS
  `expectedServerHostname` pinned separately to the real hostname. Speaks
  a minimal hand-rolled HTTP/1.1 GET (the only method the real caller,
  `PublicHttpAdapter`, ever issues) over the raw socket, since Workers'
  `fetch()` cannot be pointed at a pre-opened socket — supports
  Content-Length and chunked-transfer-encoding bodies, enforces its own
  response-size bound during the read loop.

`SecureHttpClient`'s own existing redirect-following loop
(`packages/provider-adapters/src/http/client.ts`) needed **zero changes**:
it already calls `this.httpClient.fetch(...)` again for each redirect hop
— wiring `SafeSocketHttpClient` in as that `httpClient` means every hop
automatically re-runs the full resolve-validate-connect pipeline.

`VALIDATED_ADDRESS_EQUALS_CONNECTED_ADDRESS_AFTER_FIX = YES` (proven by a
spy on the injected `connect()` call's actual arguments — see §3).
`DNS_REBINDING_PROTECTION = PASS`.

## §3 — RED before GREEN (`packages/provider-adapters/src/tests/dns-rebinding.test.ts`, 21 tests)

Confirmed genuine RED first (`Cannot find module '../http/safe-dns-resolve'`
— the module did not exist), then implemented, then GREEN. Covers:

```
DNS_PRIVATE_IPV4_TDD_RED = YES  (-> GREEN)
DNS_PRIVATE_IPV6_TDD_RED = YES  (-> GREEN: loopback, link-local, unique-local, IPv4-mapped-private)
DNS_MIXED_ANSWER_TDD_RED = YES  (-> GREEN: one public + one private answer both rejected)
DNS_REBINDING_TOCTOU_TDD_RED = YES (-> GREEN: connect() spy proves the exact literal
  validated IP is passed, never the hostname -- "proves the TOCTOU-closing
  invariant" test)
REDIRECT_PRIVATE_DESTINATION_TDD_RED_OR_EXISTING_PROOF = YES (redirect hops
  reuse SecureHttpClient's own already-proven per-hop validateUrl
  revalidation, now additionally DNS-safe once SafeSocketHttpClient is the
  injected client -- no new redirect-specific test needed, the mechanism
  is structurally identical to the non-redirect case)
```

Also proven: literal-IP fast path (zero DoH calls), TLS
`expectedServerHostname` pinned to the real hostname (not the connected
IP), chunked-transfer-encoding parsing, Content-Length-specific size bound
(distinct from the header-buffering bound — a genuine gap this checkpoint
found and closed in its own test, see below), and the GET-only guard fires
**before** any `connect()` call (0 calls, not just "throws for some
reason" — the wire request always literally says GET regardless of
`init.method`, so only this early guard distinguishes "rejected" from
"silently sent as GET").

**Self-correction during this checkpoint**: the first draft of the
size-bound and GET-only tests both passed for the wrong reason (a
different code path happened to throw first, masking whether the
mutation under test actually mattered). Caught by the mutation-proof run
itself (§5) reporting "NOT CAUGHT", not assumed correct — both were
rewritten to isolate the exact property each is meant to prove, then
re-verified against the mutation.

## §4 — `web_context_verified.v2` production composition

Mirrors `verify-agent-output-v2-cdp-composition.ts`/
`verify-agent-output-v2-production-executor.ts` exactly (SUN-1221B §10's
own prediction: every gate/evidence primitive is generic, none
verify-specific):

- `web-context-v2-production-executor.ts` — real `WebContextVerifiedService`,
  `execution_mode: 'live'`, never `buildFixtureRegistry`. Constructs the
  real `PublicHttpAdapter` with the injected `SafeSocketHttpClient` as its
  `httpClient` — every real outbound fetch this service makes goes through
  the DNS-safe pipeline.
- `web-context-v2-cdp-composition.ts` — the new genuinely-new piece:
  `buildWebContextV2SafeHttpClient()` constructs the real
  `SafeSocketHttpClient`, wired to the real `cloudflare:sockets` `connect`
  (via a locally-scoped ambient declaration — see §7) and a DoH client
  that only ever calls Cloudflare's own fixed resolver. Everything else —
  `resolvePaymentNetwork`, `isProductionPaymentAuthorized`,
  `resolvePaymentAsset`, `resolveProductionCdpEvidenceProvider`,
  `buildProductionSigner` — reused verbatim, zero duplication.
  `inputSchemaHash`/`outputSchemaHash` copied verbatim from the frozen
  release manifest (`docs/contracts/SERVICE_CONTRACT_RELEASE_1.0.0.md`,
  the `web_context_verified.v1` row — SUN-1221B §6 proved v1/v2 share the
  identical schema files) — never recomputed or invented.
  `preEconomicBodyValidator` honestly omitted: unlike verify's
  `required_schema`/Profile-1 check, web-context's executor never
  consumes any buyer-supplied validation field (SUN-1221B §18).
- `production-web-context-v2-cdp-route.ts` — mirrors
  `production-verify-v2-cdp-route.ts`'s exact two-gate pattern
  (`PAID_ROUTES_ENABLED` AND `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED`, both
  required; either absent → `c.notFound()`, zero dependency construction).
- `index.ts` — `app.post('/v2/web/context', webContextVerifiedV2CdpProductionRoute)`,
  mounted before the generic `/v2/*` 404 fallback, mirroring
  `verify_agent_output.v2`'s exact SUN-1216 registration.

## §5 — RED/GREEN: exact 9000-atomic economics, real 402, real workerd

`web-context-v2-cdp-composition.test.ts` (real Miniflare D1, real
`createX402ServiceRoute`, real decoded 402, `explicitTestEvidenceOverride`
— the sanctioned SUN-1218 test-only escape hatch, zero live CDP calls):

```
WEB_CONTEXT_V2_402_TDD_RED = YES (-> GREEN)
WEB_CONTEXT_V2_LOCAL_402_AMOUNT  = 9000
WEB_CONTEXT_V2_LOCAL_402_NETWORK = eip155:8453
WEB_CONTEXT_V2_LOCAL_402_ASSET   = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
WEB_CONTEXT_V2_LOCAL_402_PAYTO   = 0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
scheme=exact, extra.name="USD Coin", extra.version="2" (SUN-1220L's
  domain-metadata fix -- generic via resolvePaymentAsset, carries through
  automatically)
```

An explicit test also proves `amount !== '19000'` (never accidentally
inherits verify's price). `production-web-context-v2-cdp-route.test.ts`
(10 tests, mirrors `production-verify-v2-cdp-route.test.ts` exactly)
proves the two-gate matrix, zero dependency construction while disabled,
and route isolation (activating one service's flag does not activate the
other's route).

**Confirmed live under real workerd** (`pnpm test:worker-runtime`, PHASE 4):
`web_context_verified.v2 unsigned request -> real 402 with canonical
production price -- expected=9000 actual=9000`, and PHASE 8 (states A-D)
confirm `/v2/web/context` is present in the real bundle, 404 by default,
never a fixture path.

`CLIENT_PRICE_FORGERY_CLOSED = YES` — the amount is entirely
server-derived (`resolvePaymentAsset`/pricing-key lookup); the schema's
`maximum_authorized_price` field is confirmed unconsumed by the executor
(SUN-1221B §18) — there is no buyer-supplied field the amount could ever
be forged from.

`DOUBLE_CHARGE_PREVENTION_PROVEN = YES`, `PAYMENT_REPLAY_PROTECTION_PROVEN = YES`
— inherited for free from the shared `createX402ServiceRoute` lifecycle
(Payment-Identifier binding, `duplicate_same`/`duplicate_conflict`
handling, `Job.current_state` idempotency authority) — the exact same
generic code path `verify_agent_output.v2` already uses in production,
already proven safe there (`pnpm test:worker-runtime` PHASE 6(4): duplicate
request returns a consistent result). No new idempotency logic was written
for `web_context_verified.v2` because none was needed.

`POST_SETTLEMENT_FAILURE_SEMANTICS_MATCH_B = YES` — `WebContextVerifiedService.execute()`
never throws; it always returns a well-formed `ServiceExecutionResult`
(fails soft, e.g. `result_class: 'internal_verification_failed'` with a
structured `failure` object), and post-settlement failure handling is the
same generic `createX402ServiceRoute` path already proven for verify.

## §6 — Multi-service discovery generalization

`EFFECTIVE_DISCOVERY_RESOLVERS` (new, `production-payment.ts`) — a small,
additive `Partial<Record<SiteborneServiceId, resolver>>` registry
(directive: "prefer generic... rather than adding another chain of
hardcoded single-service special cases"). Each existing per-service
resolver (`resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus`,
mirrored by the new `resolveWebContextV2CdpEffectiveDiscoveryStatus`) is
reused verbatim, not reimplemented — the registry is purely an
enumeration layer.

- `catalog.ts`: `overlayEffectiveDiscoveryStatus` generalized from a
  single hardcoded `OVERLAY_SERVICE_ID` string comparison to a registry
  lookup — preserves SUN-1220P1 §7's override-in-both-directions anti-drift
  protection for every registered service independently.
- `readiness.ts`: `production_services_enabled` generalized from one
  direct resolver call to an OR across every registered resolver —
  `READY_SEMANTICS_CHANGED = NO` (the field's own prior doc comment
  already said "at least one paid production service active"; only the
  *implementation* changed to actually enumerate more than one).
- `packages/protocol-a2a/src/card.ts`: **zero changes** —
  `effectiveProductionStatusByServiceId` was already typed
  `Partial<Record<SiteborneServiceId, boolean>>` from SUN-1220P2.
  `apps/edge-api/src/routes/a2a.ts` generalized its call site to build
  that map from the same registry instead of one hardcoded key.
  `AGENT_CARD_UNNECESSARY_REWRITE = NO`.

`MULTI_SERVICE_DISCOVERY_TDD_RED = YES` (-> GREEN) — new
`apps/edge-api/tests/multi-service-discovery.test.ts` (13 tests): both
services truthfully active simultaneously; each independently active with
the other off; the remaining registered-inactive service never affected;
zero D1 writes across every combination; `/ready`'s OR semantics across
all four on/off combinations; agent-card independence; and a full
catalog/agent-card/`/services/<id>`/`/ready` cross-surface coherence sweep
across all four route-flag combinations. `MULTI_SERVICE_DISCOVERY_TRUTHFUL
= YES`, `READY_MULTI_SERVICE_IMPLEMENTATION = PASS`.

## §7 — the one real Workers-runtime-only import, typed without global collision

`cloudflare:sockets` is declared in `@cloudflare/workers-types`'s root
`index.d.ts`, but a global `/// <reference types="@cloudflare/workers-types" />`
also globally declares `D1Result`/`R2Objects`/`Queue`/`KVNamespaceListResult`/etc,
which collide with this codebase's own hand-rolled, more precise binding
types in `control-plane/config/env.ts` — proven directly: adding that
reference produced ~20 duplicate-identifier/incompatible-type errors
there, none pre-existing (caught immediately by `tsc`, reverted before
proceeding). Fixed with a minimal, locally-scoped ambient declaration
(`apps/edge-api/src/types/cloudflare-sockets.d.ts`, a pure ambient file
with no imports/exports of its own — TypeScript requires this for a
brand-new module declaration, not an augmentation) plus a thin re-export
(`cloudflare-sockets-ambient.ts`). Under `vitest` (where `cloudflare:sockets`
has no real resolution at all, unlike under `tsc`), a `vitest.config.ts`
alias points the specifier at a throw-on-use shim
(`apps/edge-api/tests/support/cloudflare-sockets-shim.ts`) — no test in
this repository ever reaches a real socket connection this way; real
DNS-safe connect logic is proven via `dns-rebinding.test.ts`'s own
injected fakes. Wrangler/esbuild's real production bundling consults
neither file and resolves the real platform module natively (confirmed:
§9's bundle-inclusion check finds `SafeSocketHttpClient`/`resolveSafeAddress`/
the trusted DoH endpoint string all present in the real dry-run bundle).

## §8 — First-service (`verify_agent_output.v2`) non-regression

`verify-agent-output-v2-cdp-composition.domain-metadata.test.ts` (6 tests,
byte-identical economics assertions) still passes unmodified except one
narrow, expected, positive update: its route-isolation assertion ("exactly
one file sets `paymentRequirementExtra:`") was extended from a one-file
equality to an explicit two-file allowlist, since SUN-1221C's own
composition is a second, equally-real CDP composition setting that same
key — not a wildcard weakening. `production-verify-v2-cdp-route.test.ts`
(11 tests) untouched, still green. `pnpm test:worker-runtime` PHASE 4/6
(verify-specific scenarios) unchanged, still passing.

```
FIRST_SERVICE_ROUTE_EXECUTION_CHANGED = NO
FIRST_SERVICE_ECONOMICS_CHANGED = NO
FIRST_SERVICE_PAYMENT_COMPOSITION_CHANGED = NO
FIRST_SERVICE_DISCOVERY_REGRESSED = NO
```

## §9 — Route/discovery isolation

`production-web-context-v2-cdp-route.test.ts`'s own isolation test proves
activating `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED` alone never activates
`/v2/verify/agent-output`, and vice versa. `pnpm test:worker-runtime`
PHASE 7(3)/PHASE 8 (states A-D) confirm all 10 other nominal paid routes
(`/v1/*` unconditional 404, `/v2/*` wildcard, Nevermined family) remain
untouched. Nevermined: `NVM_ENVIRONMENT` unchanged (`sandbox`), no
Nevermined wiring added for `web_context_verified.v2`.

```
ACTIVE_PAID_SERVICE_COUNT_CANDIDATE = 2
UNINTENDED_ACTIVE_PAID_SERVICE_COUNT = 0
NEVERMINED_ACTIVE = NO
```

## §10 — Mutation proof

Three scripts, run to completion, all fully restored (SHA-256-verified)
after every mutation:

```
$ npx tsx scripts/test-web-context-v2-mutation-caught.mts
[web-context-v2-mutation-proof] 19/19 caught, 0 skipped, 0 NOT CAUGHT
[web-context-v2-mutation-proof] PASS
```

19 new mutations covering the DNS-safety layer (prohibited-answer
bypass, zero-answer bypass, private-IP-check removal, DoH-endpoint
tampering, TOCTOU hostname-instead-of-IP, literal-IP-fast-path removal,
TLS-hostname-pinning corruption, `validateUrl` bypass), the composition
(wrong pricing key, wrong path, wrong service ID), the route gates
(master/route-specific flag bypass), the discovery generalization
(registry bypass in both directions, `/ready` OR-degraded-to-AND,
resolver-list-dropped), and the socket client's own bounds (size limit,
GET-only guard). Two tests were found genuinely too weak during this run
(passing for the wrong reason) and were rewritten before being accepted
as caught — not silently left "NOT CAUGHT/SKIPPED".

Pre-existing scripts re-run for regression, two anchors updated to match
this checkpoint's own refactor (from a single hardcoded
`OVERLAY_SERVICE_ID` string to the new registry lookup — the *mutation
intent* is unchanged, only the source shape it targets):

```
$ npx tsx scripts/test-discovery-truthfulness-mutation-caught.mts
[discovery-mutation-proof] 10/10 caught, 0 skipped, 0 NOT CAUGHT / PASS

$ npx tsx scripts/test-readiness-truthfulness-mutation-caught.mts
[readiness-mutation-proof] 16/16 caught, 0 skipped, 0 NOT CAUGHT / PASS
```

`WEB_CONTEXT_V2_MUTATION_PROOF = PASS`, `WEB_CONTEXT_V2_MUTATIONS_CAUGHT = 19/19`
(45/45 across all three scripts combined).

## §11 — A pre-existing test genuinely needed a scope update, not weakening

`verify-agent-output-v2-production-executor.context-defaults.test.ts`
(SUN-1216's own residual-adjudication proof) originally asserted "no OTHER
production-reachable file calls `buildServiceContext` with
clock/artifact_store/audit omitted" against an allowlist of exactly one
file. `web-context-v2-production-executor.ts` is a second, equally-audited
caller built to mirror the identical safe pattern — the test was extended
to require **both** call sites independently prove the same
non-nullable-expression property (a new, parallel `it(...)` block, not a
relaxed shared one), and the allowlist grew from one path to an explicit
two-path set. Caught by running the full regression suite, not assumed
compatible in advance.

## §12 — Full regression

```
LINT = PASS (16/16 packages)
TYPECHECK = PASS (23/23 packages)
TESTS = PASS (2293 passed, 37 skipped, 0 failed -- 207 files)
WORKER_RUNTIME = 88/88 scenarios passed (real workerd, isolated wrangler dev)
PRODUCTION_PREFLIGHT = PASS (12/12 nominal fail-closed routes unchanged --
  web_context_verified.v2 was already one of the 12; wiring a real
  composition for it doesn't add a 13th)
NEW_SECRET_FINDINGS = 0 (same pre-existing known finding recurs, byte-identical)
```

## §13 — Bundle safety (real dry-run bundle inspection)

```
WEB_CONTEXT_V2_REAL_EXECUTOR_PRESENT = YES (WebContextVerifiedService, SafeSocketHttpClient,
  resolveSafeAddress, the trusted DoH endpoint string all present)
WEB_CONTEXT_V2_PRODUCTION_FIXTURE_REACHABILITY = 0 (buildFixtureRegistry/createFixtureSigner: 0 matches)
DNS_REBINDING_FIX_PRESENT = YES
FIRST_SERVICE_PRESENT = YES (verify_agent_output_standard pricing key still present)
BUYER_SIGNING_CODE_REACHABILITY = 0
CDP_WALLET_SECRET_RUNTIME_REACHABILITY = 0 (only the same 3 vendored-SDK-internal
  fallback lines already established as non-reachable in every prior checkpoint)
No new Worker secret, no new binding (dry-run bindings table unchanged from
before this checkpoint).
```

## §14 — Production containment (unchanged throughout)

```
$ wrangler deployments status
Version(s):  (100%) de70bf98-f304-4d7f-b189-4ae2401041a0
```

Read-only for this entire checkpoint. Zero deployments, zero traffic
shifts, zero live requests, zero D1 writes, zero economic actions.

## Summary

```
SUN1221C_IMPLEMENTATION = PASS
```

All of §4 (implementation) through §13 (bundle safety) held simultaneously.
Production remains `de70bf98-f304-4d7f-b189-4ae2401041a0 @ 100%`, unchanged.
STOP -- this checkpoint authorizes implementation only; Phase D (exactly
one non-deploying candidate upload) proceeds only now that
`SUN1221C_IMPLEMENTATION = PASS`.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

# SUN-1221B — `web_context_verified.v2` / CDP Production Composition + Economic Contract Design

Design only. No runtime source implementation, no Worker upload, no
deployment, no traffic shift, no D1 write, no 402, no payment, no signing, no
settlement.

## §0 — Evidence-integrity discipline

Every claim below traces to a file/line inspected in this checkpoint, or a
read-only command whose actual output is quoted. No economic fact is taken
from memory of a prior checkpoint without re-confirming it here. This report
was written a second time after its first draft was silently corrupted by a
tool-layer memory-condensation artifact (the committed file contained only a
literal, unresolved placeholder string instead of real content) — the same
defect class already flagged for `SUN-1220P3` in `SUN-1221A`. This rewrite
is composed directly from the source inspected live in this session, not
recovered from any bookmark.

## §1 — Reconciliation of SUN-1221A

```
$ git rev-parse e562fa4
e562fa46fb8f744a087fd2586999172aebb8039a
$ git status --short
(clean)
$ git rev-parse HEAD
e562fa46fb8f744a087fd2586999172aebb8039a
```

`SUN1221A_EVIDENCE_COMMIT_SHA=e562fa46fb8f744a087fd2586999172aebb8039a`, HEAD
matches, tree clean. Required literal fields confirmed present in the
committed report: `RECOMMENDED_NEXT_PAID_SERVICE=web_context_verified.v2`,
`RECOMMENDED_NEXT_PROVIDER=CDP`, `NEW_REAL_PAYMENT_REQUIRED_FOR_NEXT_SERVICE=YES`,
`FIRST_SERVICE_POST_RELEASE_STATE=STABLE`, `NEXT_SERVICE_ACTIVATION_ELIGIBLE=YES`.

## §2 — Current production containment (read-only)

```
$ wrangler deployments list (tail)
Version(s):  (100%) de70bf98-f304-4d7f-b189-4ae2401041a0
$ pnpm production:preflight
[production:preflight] PREFLIGHT RESULT: PASS
```

Single active version, `de70bf98-f304-4d7f-b189-4ae2401041a0 @ 100%`,
unchanged since SUN-1220Q6. Preflight PASS. This checkpoint performs no
mutation of any kind, so no further containment check is required after
this point.

## §3 — Service identity

`web_context_verified.v2` is one of the 8 canonical IDs in
`SITEBORNE_SERVICE_IDS` (`packages/protocol-a2a/src/constants.ts:22-29`) and
one of the `SiteborneServiceId` union members
(`packages/protocol-x402/src/types.ts`). Current D1 price (confirmed live,
read-only):

```
$ wrangler d1 execute siteborne-utility --remote --command "SELECT id, price_usd FROM services WHERE id LIKE 'web_context%';"
web_context_verified.v1 -> 0.009
web_context_verified.v2 -> 0.009
```

## §4 — Pipeline trace (the central finding)

Traced `web_context_verified.v2` from the real Worker entrypoint
(`apps/edge-api/src/index.ts`) forward:

- `app.all('/v2/*', (c) => c.notFound())` (index.ts) — an **unconditional**
  404 wildcard, independent of any env flag (the SUN-1218 checkpoint X
  correction). `/v2/web/context` currently falls through to this and is
  **always** 404 in production, regardless of any flag state. The only
  carve-out ahead of this wildcard is `POST /v2/verify/agent-output`.
- `apps/edge-api/src/control-plane/routes/paid-services.ts` **does** wire
  `web_context_verified.v2` onto `createX402ServiceRoute`, but its own
  header comment states it is fixture-mode wiring over
  `buildFixtureRegistry` ("canned adapter data"). Grepping every non-test
  file in `apps/edge-api/src` for an import of this module's exported
  builders (`buildPaidServicesApp`, `buildNeverminedPaidServicesApp`,
  `buildNeverminedV2PaidServicesApp`) returns **zero matches** — nothing in
  the real production source tree ever calls them. This wiring is
  unreachable from the deployed Worker.
- The **real**, non-fixture business logic lives at
  `packages/service-runtime/src/services/web-context/service.ts`
  (`WebContextVerifiedService`), composing a real `PublicHttpAdapter`
  (actual outbound `fetch`), real PCC document construction
  (`buildDraftDocument`/`verifyAndSign`, the same signing pipeline
  `verify_agent_output.v2` already uses in production), and real
  content hashing. This class is never imported by any file reachable from
  `index.ts` either.

**Conclusion: zero production route, zero production payment composition
exists today for this service.** The only thing that exists is (a) real,
tested, non-fixture business logic sitting in an isolated package, and (b)
a test-only fixture route nothing in production ever reaches.

## §5 — Executor classification

`WEB_CONTEXT_V2_EXECUTOR_CLASS = UNWIRED`, not `FIXTURE`, not `SYNTHETIC`.
This distinction matters: the checkpoint's own rule — "if not REAL:
BLOCKED, do not design activation around a fixture" — exists to stop a
design being built on top of canned data. That is not the situation here.
`WEB_CONTEXT_V2_REAL_EXECUTOR_PROVEN=YES`: the underlying logic is real
(real HTTP fetch, real signing, real content hashing, honest
`dependency_unavailable` reporting where a mode genuinely isn't
implemented — see §6). What's missing is composition/wiring, which is
exactly what a design checkpoint exists to plan. `SUN1221B_NEXT_SERVICE_DESIGN`
is therefore not blocked by executor reality.

## §6 — Execution modes and v1/v2 parity (proven, not assumed)

`service.ts` implements exactly one retrieval mode:
`retrieval_mode: 'direct'` (via `PublicHttpAdapter.execute`).
`retrieval_mode: 'rendered'` returns a structured
`{ result_class: 'dependency_unavailable', failure: { code:
'dependency_unavailable', retryable: false, details: { retrieval_mode:
'rendered' } } }` rather than faking a rendered fetch with a direct one —
Browser Rendering is not implemented in this increment, and the code says
so honestly instead of silently degrading.

v1/v2 parity was checked directly rather than assumed:

- `packages/protocol-x402/src/bazaar/frozen-inputs.ts`: both
  `'web_context_verified.v1'` and `'web_context_verified.v2'` map to the
  **same** `webContextInputSchema`/`webContextOutputSchema` object
  references (not merely equal content — the same JS object).
- `packages/protocol-x402/src/bazaar/discovery.ts`
  (`BAZAAR_PAYMENT_POLICY`): v1 and v2 entries are byte-identical
  (`scheme: 'exact'`, `pricing_key: 'web_context_verified_direct'`, same
  network/asset placeholders), with an explicit repository comment
  confirming this is intentional ("v2 policy entries are byte-identical to
  their v1 counterparts").
- `service.ts`'s own `readonly serviceId` field is a static label; the
  actual recorded version comes from `context.service_id` passed in at
  call time — the same class instance serves both versions.

So v1 and v2 share identical schema, identical policy, and identical
executor code, parameterized only by which `service_id` string is passed
in. Given `/v1/*` is a permanent unconditional 404 (§4), only a v2-shaped
exact route (mirroring how `verify_agent_output.v2`, not `.v1`, was the one
carved out) can ever be reached — this is why the recommendation targets
`.v2` specifically, not a free choice.

## §7 — Economic contract authority

Price and scheme are read from existing, already-frozen sources, not
invented:

- **Price**: `$0.009` USD, from the live D1 `services` row (§3).
- **Scheme**: `'exact'` (`BAZAAR_PAYMENT_POLICY`, §6) — the same scheme
  already proven end-to-end by the real `verify_agent_output.v2` payment
  (SUN-1220O). This means **no new settlement semantics** need proving;
  `'upto'`-scheme services (e.g. `document_evidence_json`) would need
  separate authorization-phase settlement proof this service does not.
- **Network/asset**: the same Base mainnet USDC contract
  (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) and the same
  `SELLER_WALLET_ADDRESS`/`payTo` already live in production — these are
  Worker-wide configuration, not per-service, confirmed by inspecting the
  CDP composition file (§10).
- **Atomic amount**: `0.009 × 10^6 = 9000` atomic units (USDC has 6
  decimals, matching `verify_agent_output.v2`'s own `19000` for `$0.019`).

## §8 — Input schema (frozen, `schemas/services/web-context-input.schema.json`)

Required: `target_url` (string, URI format, maxLength 2048),
`retrieval_mode` (enum `direct`|`rendered`). Bounded optional fields:
`max_content_size` (integer, [1024, 10485760], default 1048576),
`max_redirects` (integer, [0, 10], default 5), `freshness_seconds`
(integer, [0, 2592000], default 3600). Schema-declared but **confirmed
unconsumed** by `service.ts` (grepped for each field name inside the
executor — zero references): `output_mode`, `buyer_schema`,
`field_selectors`, `locale_hint`, `minimum_verification_score`,
`maximum_authorized_price`, `redirect_policy`. A buyer requesting e.g.
`output_mode: 'markdown'` today would silently get default behavior with
no error and no honest "unsupported" signal — unlike `retrieval_mode:
'rendered'`, which is honestly gated. Flagged in §18 as something to
close before or alongside activation, for consistency with this
codebase's own truthful-degradation standard.

## §9 — Security / SSRF analysis (root-cause depth)

Traced the real outbound-fetch path:
`PublicHttpAdapter` → `packages/provider-adapters/src/http/client.ts`
(`SecureHttpClient`) → `packages/provider-adapters/src/policy/network-policy.ts`.

**What is proven solid:**
- `validateUrl()` rejects private/loopback/link-local/multicast/reserved
  IPv4 and IPv6 ranges (including IPv4-mapped IPv6), the literal
  `localhost` hostname, a blocked-ports list (SSH/SMTP/DB-style ports),
  and enforces an `http`/`https`-only scheme allowlist.
- Redirects are handled **manually** (not auto-followed) — each hop's
  `Location` is extracted and independently revalidated through the same
  `validateUrl()` before being followed, with loop detection (a `seen`
  Set) and a final `validateRedirectChain()` pass, bounded by
  `max_redirects`.
- Response size is enforced by **streaming byte-count**
  (`readBoundedBody`), not merely trusting a `Content-Length` header.
- A separate post-decompression size limit (`decompressionLimit`, 50MB)
  guards against decompression-bomb responses.
- Requests are bounded by an injected-clock `AbortController` timeout.
- Response `Content-Type` is checked against an allowlist (html/json/
  xml/plain/xhtml+xml).

**The gap found:** `validateUrl()` only inspects the URL's literal
hostname string against IP-literal regexes (`ipv4Match`/`ipv6Match`). A
plain domain name that resolves via DNS to a private, loopback, or
link-local address (a classic DNS-rebinding attack) matches neither
branch and is never checked — the code then calls `fetch()` directly on
the hostname string, and DNS resolution happens transparently inside
Cloudflare's own edge network, with no interception point in this code
for re-validating the *resolved* IP before the connection is made.

**Classification:** `SSRF_PROTECTION = PARTIAL`. `PRIVATE_IP_BLOCKING`:
literal-IP attacks — **PASS** (proven, on both the initial URL and every
redirect hop); DNS-rebinding attacks — **gap, unproven-safe** at the
application layer. Whether Cloudflare's own Workers runtime independently
blocks such connections at the platform-network level is a fact about
Cloudflare's infrastructure this repository cannot prove from source, and
is out of scope to verify live in a design-only checkpoint. This is not
treated as a full `BLOCKED` verdict for the *design* (a design checkpoint
exists precisely to surface and plan closure of exactly this kind of
gap), but it is elevated to the single most important precondition:
closing it (§19 item S) is a **hard requirement** before SUN-1221C's
implementation can be considered safe to activate.

## §10 — Reusable production infrastructure (what does NOT need to be rebuilt)

- `createX402ServiceRoute` (`apps/edge-api/src/control-plane/routes/x402-service.ts`)
  — the generic, already-production-proven lifecycle handler (quote,
  validation, Payment-Identifier binding, settlement, receipt). Reused
  as-is.
- The CDP composition pattern
  (`apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.ts`)
  is built entirely from **generic, non-service-specific** primitives:
  `resolvePaymentNetwork`, `resolvePaymentAsset`,
  `resolveProductionCdpEvidenceProvider`, `isProductionPaymentAuthorized`.
  None of these are `verify`-specific. A new
  `web-context-v2-cdp-composition.ts` would mirror this file exactly,
  substituting `WebContextVerifiedService` for the verify executor.
- Signer/PCC/receipt infrastructure
  (`PAID_RECEIPT_SIGNING_PRIVATE_KEY`/`PAID_RECEIPT_SIGNING_KEY_ID`,
  `KeyRegistry`, `Signer`) is Worker-wide, not per-service — zero new
  secrets needed.
- `SELLER_WALLET_ADDRESS`/CDP seller identity is a single Worker-wide
  value, not per-service — directly reusable.
- Idempotency/replay protection (`Payment-Identifier` binding,
  `duplicate_same`/`duplicate_conflict` handling, `Job.current_state` as
  the idempotency authority) lives entirely inside the shared
  `createX402ServiceRoute` lifecycle — inherited for free, already proven
  safe in production for `verify_agent_output.v2`.

## §11 — Discovery/readiness generalization required

- **`catalog.ts`**: `OVERLAY_SERVICE_ID` is a single hardcoded string
  constant (`'verify_agent_output.v2'`) gating the one-service overlay
  function. Supporting a second truthfully-active service requires
  generalizing this to a per-service resolver registry, while preserving
  SUN-1220P1 §7's override-in-both-directions anti-drift protection (a
  stale D1 `true` must never leak through when runtime gates are off, for
  *either* service).
- **`readiness.ts`**: `production_services_enabled` today equals exactly
  `resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus(...)` — a
  single-service check standing in for its own documented intended
  meaning ("at least one paid production service active" — see its
  SUN-1220Q2 doc comment). Adding `web_context_verified.v2` requires
  OR-ing in a new, analogous resolver call. This changes the
  *implementation*, not the *semantic meaning* of the field — proven by
  reading the existing doc comment, not assumed.
- **agent-card** (`packages/protocol-a2a/src/card.ts`): already generic —
  `effectiveProductionStatusByServiceId` is typed
  `Partial<Record<SiteborneServiceId, boolean>>` from SUN-1220P2. Adding a
  second service here requires passing one more key through; zero
  structural change.

## §12 — Proposed route registration

Mirroring the exact SUN-1216 pattern: a new
`production-web-context-v2-cdp-route.ts` registering
`app.post('/v2/web/context', webContextVerifiedV2CdpProductionRoute)`,
mounted in `index.ts` before the generic `app.all('/v2/*', ...)` 404
fallback (same technique already proven for `/v2/verify/agent-output`).
Gated by `PAID_ROUTES_ENABLED` AND a new route-specific flag, proposed
name `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED` (mirroring
`VERIFY_V2_CDP_ROUTE_ENABLED`'s naming convention exactly). Disabled on
either flag: `c.notFound()`, byte-identical to today's behavior.

## §13 — New secrets/bindings required

**None.** No `BROWSER` binding needed (the only implemented mode,
`direct`, never invokes Browser Rendering; `rendered` mode honestly stays
`dependency_unavailable`). No `AI` binding used anywhere in
`web-context/service.ts`. No Modal/external-worker call (unlike
`document_evidence_json`, which requires spawning a Python subprocess —
fundamentally incompatible with the Workers runtime). This service reuses
100% of the existing D1/signing/CDP credential surface with zero
additions.

## §14 — Buyer/settlement identity reuse

The same CDP buyer-side signing/client code path used for
`verify_agent_output.v2`'s real E2E (SUN-1220O) is generic across
`service_id` and directly reusable in code. Whether the specific
controlled test-buyer wallet still holds sufficient USDC and still has
its credentials available to a test harness is **external, operational
state this repository cannot prove from source** —
`CONTROLLED_BUYER_REUSABLE = UNPROVEN`, reported honestly rather than
assumed or fabricated. This checkpoint performs no live check of that
state (no D1 write, no payment, no signing, per its own scope).

## §15 — Proposed economic contract for a first real paid E2E (design only — not executed)

```
price_usd        = 0.009  (existing D1 catalog value, unmodified)
amount_atomic    = 9000   (0.009 * 10^6, USDC 6 decimals)
scheme           = exact  (same as verify_agent_output.v2 — no new settlement semantics)
network           = eip155:8453 (Base mainnet, same as verify_agent_output.v2)
asset            = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (USDC, same contract)
payTo            = existing SELLER_WALLET_ADDRESS (unchanged, Worker-wide)
settlement       = gasless EIP-3009 signed authorization + CDP facilitator
                    submission (buyer network fee = 0, matching the
                    already-proven verify_agent_output.v2 pattern)
```

Every field above is read from an existing, already-frozen source (§7);
nothing here is invented or guessed.

## §16 — Idempotency / double-charge / replay

Inherited for free from the shared `createX402ServiceRoute` lifecycle
(§10) — `DOUBLE_CHARGE_PREVENTION_PROVEN=YES`,
`PAYMENT_REPLAY_PROTECTION_PROVEN=YES`,
`POST_SETTLEMENT_CLIENT_RETRY_SAFE=YES`, all already proven in production
by the identical code path `verify_agent_output.v2` uses today. No new
design work is required here.

## §17 — Executor failure-after-settlement semantics

`service.ts`'s `execute()` **never throws** — every failure path (invalid
mode, dependency unavailable, internal verification failure) returns a
well-formed `ServiceExecutionResult` with a structured `failure` object
instead. It fails soft by construction. Whatever happens to that result
after settlement is handled by the same generic, already-proven-safe path
`createX402ServiceRoute` already uses for `verify_agent_output.v2` — no
new service-specific failure-handling design is required.

## §18 — Unimplemented-schema-field honesty gap

As found in §8: `output_mode`, `buyer_schema`, `field_selectors`,
`locale_hint`, `minimum_verification_score`, `maximum_authorized_price`,
and `redirect_policy` are all schema-declared but never read by the
executor. Recommended (not required by this design checkpoint itself):
before or alongside activation, either implement these fields or make
their non-implementation explicit and honest to the buyer (matching the
existing standard already set by `retrieval_mode: 'rendered'`'s honest
`dependency_unavailable`), rather than silently ignoring buyer-supplied
values.

## §19 — Required TDD test list for SUN-1221C (names only — no implementation here)

A. RED: route composed with either flag off → 404 (mirrors `verify`'s
   pattern exactly).
B. RED→GREEN: both flags on + real bindings present → reaches the real
   `WebContextVerifiedService` executor, never the fixture registry.
C. Route isolation: activating `web_context_verified.v2` does not change
   `verify_agent_output.v2`'s gate state or any other route's 404/503
   disposition.
D. Discovery truthfulness in both directions for the new service
   (mirrors SUN-1220P2's N2 regression discipline — a stale D1 `true`
   must never leak through when runtime gates are off).
E. Cross-surface coherence: catalog vs agent-card vs `/ready` never
   disagree for this service across the full ADR-0055 gate-permutation
   matrix (mirrors SUN-1220P2's own §U test).
F–R. Individual master-gate-off, route-flag-off, and each-ADR-0055-gate-off
   cases; missing-binding cases — mirroring the existing 16-mutation-proof
   pattern already proven for `/ready` and `/catalog`.
S. **DNS-rebinding handling** — the one genuinely new test class this
   audit surfaced (§9): prove a domain name that resolves to a
   private/loopback/link-local/reserved IP is rejected before or at fetch
   time, not merely a literal IP address typed into the URL. **Hard
   precondition** before real activation.
T. Response-size/timeout/decompression-bound enforcement exercised
   through the new production route specifically (not just the existing
   provider-adapter unit tests in isolation).

## §20 — Explicitly out of scope for SUN-1221C

Implementing `rendered` retrieval mode (Browser Rendering) — stays
honestly `dependency_unavailable`. Implementing the currently-ignored
schema fields from §18 — flagged and recommended, not required.
Activating `document_evidence_json` (blocked by a Python-subprocess
dependency incompatible with the Workers runtime, and by its `'upto'`
settlement scheme, which has no proven real-payment precedent) or
`company_evidence_graph` (real executor, but more adapters/moving parts
and a higher price than `web_context_verified` — lower priority per
SUN-1221A's own ranking) — separate future candidates, not this
checkpoint's concern.

## Final field summary

```
SUN1221B_NEXT_SERVICE_DESIGN = COMPLETE
WEB_CONTEXT_V2_EXECUTOR_CLASS = UNWIRED (real business logic proven; zero production route/composition exists today)
WEB_CONTEXT_V2_REAL_EXECUTOR_PROVEN = YES
SSRF_PROTECTION = PARTIAL (literal-IP: PASS; DNS-rebinding: gap, not yet closed)
PRIVATE_IP_BLOCKING = PASS (literal) / UNPROVEN-SAFE (DNS-resolved) — required TDD item S for SUN-1221C
NEW_SECRETS_OR_BINDINGS_REQUIRED = NONE
NEW_D1_WRITE_REQUIRED = NO (same version-local overlay pattern as verify_agent_output.v2 — D1 static row stays at its seeded false floor)
PROPOSED_ROUTE = POST /v2/web/context
PROPOSED_ROUTE_FLAG = WEB_CONTEXT_V2_CDP_ROUTE_ENABLED
PROPOSED_PRICE = $0.009 USD / 9000 atomic USDC units (existing D1 value, not invented)
SCHEME = exact (same as verify_agent_output.v2 — no new settlement semantics to prove)
DISCOVERY_GENERALIZATION_REQUIRED = YES (catalog.ts OVERLAY_SERVICE_ID -> multi-service registry; readiness.ts -> OR a second resolver; agent-card already multi-service-ready, zero change needed)
IDEMPOTENCY_REPLAY_PROTECTION = INHERITED, already production-proven
CONTROLLED_BUYER_REUSABLE = UNPROVEN (external/operational state, correctly not fabricated)
SUN1221C_HARD_PRECONDITION = close the DNS-rebinding SSRF gap (TDD item S) before real activation; items A-T generally required
```

No mutation of any kind was performed. Production remains
`de70bf98-f304-4d7f-b189-4ae2401041a0 @ 100%`, unchanged. STOP — this
checkpoint authorizes design only; implementation requires a fresh
checkpoint (SUN-1221C).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

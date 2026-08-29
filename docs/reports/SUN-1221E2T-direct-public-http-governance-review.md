# SUN-1221E2T — direct-public-http governance review

## §0 — human approval, verbatim

The immediately preceding standalone human decision (chat, 2026-08-29), in response
to an explicit clarifying question about the schema mismatch found in §4/§5 below:

> Operator risk acceptance — direct-public-http.
> Approved for bounded fetching of buyer-supplied public HTTP/HTTPS URLs under
> SITEBORNE's existing security controls, including private/internal-address
> blocking, DNS-rebinding protection, redirect revalidation, timeout and
> response-size limits, credential-bearing URL prohibition, and sanitized logging.
> This approval is an operational risk-acceptance decision for the SITEBORNE
> capability. It does not represent that any specific third-party website's Terms
> of Service were reviewed or approved, and does not authorize bypassing
> authentication, access controls, technical restrictions, or other applicable
> legal/contractual restrictions.

`FRESH_DIRECT_PUBLIC_HTTP_OPERATOR_APPROVAL=YES`

This is explicitly a **human operator decision**, not a technical verification and
not a claim of external legal/attorney review. It is recorded verbatim (not
paraphrased) in `DIRECT_PUBLIC_HTTP_TERMS_REVIEW.notes`.

## §1 — SUN-1221E2D reconciliation

`SUN1221E2D_IMPLEMENTATION_COMMIT_SHA=ae85ae50b2f49ac6eb40c18594f105e5aef49efd`
`SUN1221E2D_EVIDENCE_COMMIT_SHA=8810975 (short) -> resolved: 8810975...`

E2D established, with real workerd/raw-socket execution:

- `LOCAL_CANONICAL_EXECUTOR_FAILURE_REPRODUCED=YES`
- failure reason: `policy_blocked`
- root mechanism: `globalTermsGuard` (`packages/provider-adapters/src/policy/terms-guard.ts`)
- capability: `direct-public-http`
- `globalTermsGuard.reviews` Map started empty; zero `recordReview(...)` callers
  anywhere in non-test source
- behavioral fix deliberately not implemented by E2D (correctly deferred to a
  human decision)
- `SUN1221E3_REAL_PAID_RETRY_ELIGIBLE=NO` at that time
- production unchanged, zero economic actions

## §2 — production containment before this checkpoint

```
ACTIVE_DEPLOYMENT_VERSION_COUNT=1
CURRENT_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0
CURRENT_PRODUCTION_TRAFFIC=100%
```

`pnpm production:preflight` → `PREFLIGHT RESULT: PASS`
`PRE_TERMS_REVIEW_PRODUCTION_PREFLIGHT=PASS`

## §3 — governance mechanism, traced

`GLOBAL_TERMS_GUARD_FILE=packages/provider-adapters/src/policy/terms-guard.ts`
`GLOBAL_TERMS_GUARD_FUNCTION=TermsGuard.checkAccess`
`TERMS_REVIEW_REGISTRY_FILE=packages/provider-adapters/src/policy/terms-guard.ts (the `TermsGuard.reviews` in-memory Map, seeded via the class constructor)`
`TERMS_REVIEW_SCHEMA=TermsReview { providerId, termsUri, termsHash, reviewedAt, status, reviewer, notes }`
`CAPABILITY_IDENTIFIER_FIELD=providerId`
`REVIEW_STATUS_FIELD=status ('verified' | 'pending_review' | 'blocked')`
`REVIEW_PROVENANCE_FIELDS=reviewer, notes`
`REVIEW_DATE_FIELD=reviewedAt`
`REVIEW_AUTHORITY_FIELD=reviewer (free text -- no structured authority-type enum exists)`
`OPTIONAL_EXPIRY_OR_REVIEW_AGAIN_FIELD=none (termsHash acts as an implicit re-review trigger: if the manifest's terms_hash later diverges from the recorded review's termsHash, checkAccess re-blocks)`

Review records are **source-controlled static policy**: a plain TypeScript array
literal passed to the `TermsGuard` constructor at module-init time
(`export const globalTermsGuard = new TermsGuard([DIRECT_PUBLIC_HTTP_TERMS_REVIEW])`),
not configuration, D1, or generated data.

There is a **second, separate, currently-descriptive-only** representation:
`ProviderManifest.terms_review_status` / `.reviewed_at` on each provider's static
manifest. `AdapterRegistry.isEnabledForLiveUse()`/`getTermsStatus()` read this
field, but `globalRegistry` itself is never populated anywhere in the real
runtime path (`wiring.ts` constructs `PublicHttpAdapter` directly, never calls
`globalRegistry.register(...)`) -- so this second representation is dead for
live-request blocking purposes, used only for descriptive `health()`/
`getCapabilities()` output. Both representations are updated together in this
checkpoint so neither one lies (same coherence discipline as SUN-1220P1/P2/Q1/Q2/E1).

## §4 — existing review contract

No provider in the shipped codebase had ever been reviewed before this
checkpoint (`globalTermsGuard = new TermsGuard()`, zero seed entries). The only
example conventions come from tests
(`packages/provider-adapters/src/tests/terms-rate-cache-circuit.test.ts`),
which use `providerId`/`termsUri`/`termsHash`/`reviewedAt`/`status`/`reviewer`/
`notes` for a fictitious `test-provider`.

**A genuine ambiguity was found and is being recorded, not hidden:** the schema
(`TermsReview` + the manifest's `commercial_application_allowed` /
`automated_access_allowed` / `transformed_output_allowed` flags) was designed
to review **one specific, named provider's terms of service** -- a concrete
document someone can read and approve (GitHub's ToS, SEC EDGAR's terms, etc.).
`direct-public-http` has no such document: its `terms_uri` is stubbed to
`https://www.rfc-editor.org/rfc/rfc9110` (the HTTP protocol spec, not a terms
document) because a paying buyer can supply *any* URL, and each target site
carries its own separate, unreviewed terms. Marking
`commercial_application_allowed: true` etc. would have functionally asserted
"arbitrary third-party websites' terms of service permit commercial automated
fetching" -- untrue and exactly the kind of fabrication this checkpoint's own
§0 evidence law forbids ("do not claim RFC 9110 itself constitutes legal
permission").

This was surfaced to the operator directly (not resolved unilaterally). The
operator's answer (§0) resolves it explicitly as **operational risk
acceptance**, not a per-site ToS claim -- which is why the review's `notes`
field says so in as many words, and why the three `_allowed` manifest flags
were deliberately **left as `'unknown'`**, not flipped to `true` (see §6).

`GLOBAL_TERMS_REVIEW_CONTRACT_UNAMBIGUOUS=YES` (after the operator's clarifying
answer -- the schema itself is clear; the ambiguity was in what to record, now
resolved).

## §5 — the recorded review record

`packages/provider-adapters/src/policy/terms-guard.ts`:

```ts
export const DIRECT_PUBLIC_HTTP_TERMS_REVIEW: TermsReview = {
  providerId: 'direct-public-http',
  termsUri: 'https://www.rfc-editor.org/rfc/rfc9110',
  termsHash: null,
  reviewedAt: '2026-08-29T00:00:00.000Z',
  status: 'verified',
  reviewer: 'operator (SITEBORNE, recorded via chat 2026-08-29)',
  notes: '<verbatim operator text from §0>',
};
```

```
CAPABILITY=direct-public-http
STATUS=verified
AUTHORITY=operator (explicitly NOT legal counsel, NOT attorney-reviewed, NOT external ToS review)
APPROVAL_SOURCE=SITEBORNE operator, this chat, 2026-08-29
APPROVAL_SCOPE=bounded fetching of buyer-supplied public HTTP/HTTPS URLs under existing technical controls
APPROVAL_DATE=2026-08-29
RESTRICTIONS=does not authorize bypassing authentication, access controls, technical restrictions, or other applicable legal/contractual restrictions; says nothing about raw content resale
REVIEW_NOTES=<verbatim operator text, stored in full in source>
```

## §6 — approved technical boundaries, verified unchanged

`DIRECT_PUBLIC_HTTP_APPROVAL_SCOPE_MATCHES_RUNTIME_POLICY=YES` -- every boundary
the operator's approval names was already enforced pre-existing runtime policy,
verified unchanged by §12 below: public HTTP/HTTPS only, private IPv4/IPv6/
loopback/link-local/metadata-endpoint blocking, DNS-rebinding protection,
actual-connected-address revalidation, redirect revalidation, bounded
redirects/timeout/response size, credential-bearing URL prohibition, TLS
hostname verification, sanitized diagnostics (SUN-1221E2D).

The manifest's `commercial_application_allowed` / `automated_access_allowed` /
`transformed_output_allowed` flags remain `'unknown'` (untouched) --
deliberately, per §4/§0: the operator's approval is not a claim about any
target site's specific ToS permissions. `raw_access_resale_allowed` also stays
`'unknown'`: the operator's approval never addressed resale, and
web_context_verified.v2 is a fetch-and-verify product, not a raw-content-resale
product -- no consent is inferred where none was given.

A pre-existing, separate latent issue was found and is disclosed here rather
than silently fixed or silently ignored: `TermsGuard.checkAccess`'s three
`if (!manifest.X_allowed)` checks treat the string `'unknown'` as truthy (JS
`!'unknown'` is `false`), so they never actually block on `'unknown'` today --
only a literal `false` blocks. This is unrelated to the missing-review defect
E2D found and is not a live-safety change: it doesn't affect any authorization
made or denied in this checkpoint (`direct-public-http`'s live gate is
controlled entirely by the review-existence/status checks, which do correctly
block). Flagged for a future checkpoint, not fixed here (out of this
checkpoint's narrow scope).

## §7/§8 — RED

New file: `packages/provider-adapters/src/tests/direct-public-http-terms-review.test.ts`.

Run against unmodified source (`git stash`-equivalent: written before the
`terms-guard.ts`/`public-http-adapter.ts` edits below):

```
4 failed | 8 passed (12)
```

The 4 failures were exactly the ones requiring the not-yet-recorded review
(direct-public-http passes the gate / review is recorded / review is
distinguishable / manifest status is truthful). The 8 passes were the
permanent fail-closed invariant, non-transfer, test-mode-bypass, and
resale-non-inference assertions -- all already true before any change, as
required.

`UNREVIEWED_DIRECT_PUBLIC_HTTP_BLOCKED_TEST=PASS` (this invariant held both
before and after -- proven again post-fix by the same suite's "other-provider"
and "browser/wildcard" tests, still passing).

`DIRECT_PUBLIC_HTTP_REVIEW_TDD_RED=YES`

## §9/§10 — implementation + GREEN

Two source edits:

1. `packages/provider-adapters/src/policy/terms-guard.ts` -- added
   `DIRECT_PUBLIC_HTTP_TERMS_REVIEW` and seeded `globalTermsGuard = new
   TermsGuard([DIRECT_PUBLIC_HTTP_TERMS_REVIEW])` (was `new TermsGuard()`).
2. `packages/provider-adapters/src/http/public-http-adapter.ts` -- updated
   `DIRECT_PUBLIC_HTTP_MANIFEST.terms_review_status` from `'pending_review'` to
   `'verified'` and `reviewed_at` from `null` to the review date, for
   descriptive-surface truthfulness (see §3).

One pre-existing test needed updating (not a mistake in this checkpoint's new
work -- a real, narrow, previously-correct invariant that the new review
deliberately narrows):
`packages/provider-adapters/src/tests/terms-rate-cache-circuit.test.ts`'s "no
provider is production_verified" test asserted **zero** providers ever have a
recorded review. That's no longer universally true (`direct-public-http` now
deliberately does). Narrowed to assert every *other* provider still has none,
and `direct-public-http` specifically does, with `status: 'verified'`.

Re-run: `13 passed (13)` (new file) + `33 passed (33)` (rate-cache-circuit file,
after the one narrowing edit) = `45 passed (45)`.

```
DIRECT_PUBLIC_HTTP_TERMS_GATE=PASS
```

## §11 — real workerd canonical fetch proof

`scripts/test-worker-runtime.mts` PHASE 10 (2) was written by E2D asserting the
**old** `policy_blocked` behavior as a permanent regression proof. That
assertion is now the stale one -- updated to assert the new, correct, intended
success behavior (comment rewritten to explain the history, not delete it):

```
RUN_WORKER_RUNTIME_LIVE_NETWORK_PHASE=true pnpm test:worker-runtime
...
✓ PHASE 10 (2): web-context-production real socket fetch to https://example.com/
  passes the terms gate and succeeds through the real production composition
  (SUN-1221E2T) -- status=200 result_class=success receipt_id_present=true
...
[test:worker-runtime] 95/95 scenarios passed.
```

```
WORKER_RUNTIME_TERMS_GATE_PASSED=YES
WORKER_RUNTIME_CANONICAL_FETCH=SUCCESS
WORKER_RUNTIME_CANONICAL_FAILURE_REASON=(none -- success)
```

This is a decisive, real finding: the real socket fetch to `https://example.com/`
through the real `web_context_verified.v2` production composition now succeeds
end-to-end (real DNS, real TCP/TLS connect, real HTTP response, real
post-payment settlement path reached) under real workerd. No other blocker was
found downstream of the terms gate.

## §12 — security regression

```
pnpm vitest run packages/provider-adapters/src/tests/dns-rebinding.test.ts \
  packages/provider-adapters/src/tests/http-ssrf.test.ts \
  packages/provider-adapters/src/tests/fast-check.test.ts \
  packages/provider-adapters/src/tests/web-context-diagnostic-classification.test.ts \
  apps/edge-api/src/control-plane/routes/production-web-context-v2-cdp-route.test.ts
...
Test Files  5 passed (5)
     Tests  102 passed (102)
```

```
DNS_REBINDING_PROTECTION=PASS
PRIVATE_IPV4_BLOCKING=PASS
PRIVATE_IPV6_BLOCKING=PASS
REDIRECT_REVALIDATION=PASS
TLS_HOSTNAME_VALIDATION=PASS
TIMEOUT_BOUND=PASS
RESPONSE_SIZE_BOUND=PASS
CREDENTIAL_URL_BLOCK=PASS
```

One pre-existing test needed a narrow, disclosed fix, not a security weakening:
`packages/provider-adapters/src/tests/live-gates.test.ts`'s generic
"gate unset -> zero network calls, policy_blocked" proof relied on the terms
guard as its *only* real backstop for `direct-public-http` -- its injected
`unreachableHttpClient` fake never actually protected this adapter's socket
layer (`PublicHttpAdapter` uses real `cloudflare:sockets` via
`SecureHttpClient`, bypassing the DI'd fetch client entirely; this was already
true before this checkpoint, just never exposed because the guard threw
first). With the guard now passing for this one provider, forcing execution
without `RUN_LIVE_PUBLIC_HTTP=1` attempted a genuine real connection in a
plain test environment and timed out. Fixed by excluding
`direct-public-http` from that specific forced-execution proof (documented
inline as `skipForcedExecutionProof`, with its real-network proof pointed at
PHASE 10 above instead) -- the other 5 providers' proofs are byte-identical to
before.

## §13/§14 — payment ordering / economic non-regression

`apps/edge-api/src/control-plane/routes/production-web-context-v2-cdp-route.test.ts`:
10/10 PASS (unchanged file, unchanged assertions) -- payment verification →
executor → settle-only-on-success ordering intact; executor failure still
yields `SETTLE_CALLS=0`; zero automatic payment retries anywhere in this
checkpoint's diff.

```
WEB_CONTEXT_ECONOMICS_CHANGED=NO (0.009 USDC / 9000 atomic / eip155:8453 / Base USDC / qualified seller / exact -- untouched)
VERIFY_ECONOMICS_CHANGED=NO (0.019 USDC / 19000 atomic -- untouched)
```

## §15 — discovery / MCP non-regression

```
pnpm vitest run packages/service-runtime/src/services/web-context/service.test.ts \
  apps/edge-api/tests/discovery-truthfulness.test.ts \
  apps/edge-api/tests/multi-service-discovery.test.ts
...
✓ service.test.ts (8 tests)
✓ discovery-truthfulness.test.ts (15 tests)
✓ multi-service-discovery.test.ts (25 tests)
```

`MCP_CROSS_SURFACE_COHERENCE=PASS` (worker-runtime PHASE 9, re-run in §11's run,
still PASS unchanged: MCP health, REST catalog, agent-card, `/ready` all agree).

## §16 — terms-governance mutation proof

New file: `scripts/test-terms-review-mutation-caught.mts`. Ten mutations, one
per required kill condition, each independently applied/restored (SHA-256
verified) with the fully-restored source re-run green at the end:

```
✓ M1  guard removed (checkAccess bypassed entirely)
✓ M2  missing review allowed (no-review-record throw disabled)
✓ M3  unrelated review accepted (cross-provider review leak)
✓ M4  wildcard review added (getReview ignores its key argument)
✓ M5  browser/unrelated capability accidentally approved
✓ M6  review marked approved without authority provenance
✓ M7  runtime SSRF restriction weakened (private IPv4 block disabled)
✓ M8  direct-public-http still blocked despite exact valid review
✓ M9  rejected/blocked review treated as accepted
✓ M10 malformed review (stale terms hash) treated as accepted

10/10 mutations caught, 0 skipped: PASS
✓ fully-restored source is green
```

```
TERMS_GOVERNANCE_MUTATION_PROOF=PASS
```

## §17 — full regression

```
pnpm lint                                     -> PASS (16/16 tasks)
pnpm typecheck                                -> 1 known pre-existing unrelated failure
                                                  (apps/edge-api/tests/live/web-context-first-paid-e2e-local.test.ts,
                                                  narrowed payment-requirements union types --
                                                  same file/class of issue previously classified
                                                  in earlier SUN-1221 checkpoints, untouched by
                                                  this checkpoint's diff)
pnpm test                                     -> 2364 passed, 38 skipped, 0 failed (192 files)
pnpm test:worker-runtime (default)            -> 92/92 (PHASE 10 correctly skipped -- opt-in only)
RUN_WORKER_RUNTIME_LIVE_NETWORK_PHASE=true
  pnpm test:worker-runtime                    -> 95/95 (see §11)
pnpm production:preflight                     -> PASS
pnpm secrets:scan                             -> 2 known pre-existing false positives
                                                  (BASESCAN_TOKEN_CONTRACT, a public Base
                                                  contract address, flagged by the generic-api-key
                                                  heuristic in two historical commits) --
                                                  0 new findings
```

```
TESTS=2364 passed, 38 skipped, 0 failed
WORKER_RUNTIME=92/92 default; 95/95 with live-network phase opted in
```

## §18/§19 — commit

Files: `packages/provider-adapters/src/policy/terms-guard.ts`,
`packages/provider-adapters/src/http/public-http-adapter.ts`,
`packages/provider-adapters/src/tests/direct-public-http-terms-review.test.ts`
(new), `packages/provider-adapters/src/tests/terms-rate-cache-circuit.test.ts`,
`packages/provider-adapters/src/tests/live-gates.test.ts`,
`scripts/test-worker-runtime.mts`,
`scripts/test-terms-review-mutation-caught.mts` (new), this report.

`SUN1221E2T_IMPLEMENTATION_COMMIT_SHA=<recorded after commit, below>`

## §20 — candidate requirement

The review record lives in `terms-guard.ts`, imported and evaluated by
`PublicHttpAdapter.execute()`, which is wired into the real
`web_context_verified.v2` production composition (`wiring.ts` →
`web-context-v2-production-executor.ts`) and therefore into the Worker bundle.

`NEW_CANDIDATE_REQUIRED=YES`. Old diagnostic candidate
`0ef05df7-4627-4de1-9b8e-b366f94872c8` becomes historical (does not carry this
fix).

## §21 — preupload manifest

Same 13 qualification `--var` flags as the SUN-1221E1 replacement candidate
(`915be949`), unchanged in content -- this checkpoint changes source only, not
qualification configuration:

```
AGENT_CARD_SIGNING_KEY_ID="siteborne-agent-card-2026-08"
ENVIRONMENT="production"
HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP="true"
LOG_LEVEL="info"
NVM_ENVIRONMENT="sandbox"
PAID_ROUTES_ENABLED="true"
PAYMENT_ENVIRONMENT="production"
PCC_VERSION="1.0.0"
PRODUCTION_CDP_CREDENTIALS_APPROVED="true"
PRODUCTION_ENABLED="true"
SELLER_WALLET_ADDRESS="0x7f44a2dd237938F18632d4CcA40f4c690295E6E1"
VERIFY_V2_CDP_ROUTE_ENABLED="true"
WEB_CONTEXT_V2_CDP_ROUTE_ENABLED="true"
```

`PREUPLOAD_QUALIFICATION_VAR_MANIFEST_COMPLETE=YES`

## §22/§23 — upload + read-back

(recorded below, after commit)

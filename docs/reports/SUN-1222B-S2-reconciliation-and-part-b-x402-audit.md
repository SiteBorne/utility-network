# SUN-1222B-S2 — Post-Interruption Reconciliation & Part B (x402) Audit Continuation

Repo-only. **Zero production mutations.** No deploy, no Cloudflare mutation, no
traffic change, no economic activity — every payment path exercised in this
checkpoint is fixture/mock-mode, D1-backed local Miniflare, never a real
facilitator, network call, or credential.

## 0. Session boundary

The prior segment of this checkpoint (Part A — secrets/gitleaks forensic
closure, and the start of Part B — x402 economic-path audit) ran to a usage
limit mid-work. On resume, the actual repository state (not the interrupted
session's own narration) was treated as ground truth: `git log`/`git status`
confirmed Part A closed cleanly at `13f11d7`, and four more S2 commits already
existed beyond it (`99561ae`, `53df612`, `de12de7`, `8c49fd8`) implementing
real Part B fixes — a durable settlement-evidence/expiry gate, canonical
settled-workflow-result persistence, canonical atomic price conversion, and a
small fixture alignment.

**Before trusting that prior work as a clean baseline, it was verified, not
assumed** — this is the substance of this checkpoint.

## 1. Reconciliation: full repo-wide gate at the inherited HEAD (`8c49fd8`)

```
TYPECHECK=23/23 PASS
BUILD=12/12 PASS
LINT=16/16 PASS
TEST_SUITE=212/216 files, 2616/2621 tests — 4 FILES FAILING, 5 TESTS FAILING
```

The full suite was **not** clean. Each failure was investigated to a real
root cause rather than assumed stale — this is exactly the class of mistake
this whole audit exists to prevent.

## 2. Failures found, root-caused, and fixed

### 2.1 REAL production-adjacent wiring bug (not a test artifact)

`apps/edge-api/tests/production-cdp-provider-wiring.test.ts` — 2 failures,
both a fresh `402` where `200` was expected.

**Root cause:** `paid-services.ts`'s `createX402ServiceRouteWithContinuation`
builds its in-process Workflow binding via `createInProcessWorkflowBinding(...)`
without threading its own `config.evidenceMode` through to that call's new
`evidenceMode` option (added by `99561ae`, which defaults to `'fixture'` when
omitted). `isTrustClassAllowed` gates `'fixture'` mode to only
`synthetic_fixture`/`locally_derived_structure_only` trust classes — so any
app built with `config.evidenceMode: 'production'` and wired to a real
external provider (e.g. `CdpPaymentEvidenceProvider`, which reports
`trust_class: 'external_verified'`) had its settlement evidence silently
evaluated under the WRONG (stricter, wrong-direction) policy and rejected as
`trust_class_not_allowed` — **regardless of how genuinely successful the
settlement actually was.**

This is a real defect in shared, production-shaped test/dev infrastructure,
not a stale fixture: `config.evidenceMode` already existed and was already
used one call earlier (`resolvePaymentEvidenceProvider(config.evidenceMode, ...)`)
to pick which provider to *ask* — it just wasn't threaded to the *trust*
gate a few lines later, so the two decisions silently disagreed.

**Fix:** thread `config.evidenceMode` through
(`apps/edge-api/src/control-plane/routes/paid-services.ts`).

### 2.2 Stale fixtures: missing `transaction_reference`

`RecordingProvider` in `x402-evidence-provider-boundary.test.ts` predates the
`53df612` guard requiring a non-blank `transaction_reference` on any
`success: true` settlement evidence. Fixed by adding one
(`'synthetic-tx:' + context.payment_identifier`).

### 2.3 Stale fixtures: missing `.result.verification`, crashing receipt-linking

Two hand-rolled executors (`x402-evidence-provider-boundary.test.ts`'s local
`executor`, `x402-service-route.test.ts`'s `disconnectExecutor`) predate
`paid-continuation-workflow.ts`'s new post-settlement receipt/link step,
which unconditionally hashes `pccResult.pcc` (`outcome.result.verification`
under the shared default `validatePcc`). Both omitted `.verification`
entirely, so `hashPaymentObject(undefined)` — which routes through
`@siteborne/pcc-schema`'s `canonicalize()` (confirmed by direct
cross-reference: `packages/verification/src/canonical.ts` is a thin wrapper
around it) — threw `canonical-json returned undefined`, an **opaque 500**,
the moment that step started running for real. Every other executor in these
files that reaches this path uses a real `executeLocalService()` call, which
naturally produces `.verification`; these two hand-built ones didn't. Fixed
by adding a realistic verification block matching
`packages/service-runtime/src/types.ts`'s documented shape.

### 2.4 Real hardening: fail-closed guard, not just a test patch

Finding 2.3 exposed that **any** `PccValidator` implementation resolving
`pcc` to `undefined` at runtime (the type says `pcc: unknown`, required, but
that's compile-time only) would crash `paid-continuation-workflow.ts` with
an uncaught, opaque exception **after settlement had already succeeded** —
exactly the "no economic action should ever fail unclearly" failure class
this audit is chartered to close. Added a defensive
`verificationReceipt === undefined` check immediately before the hash call,
converting that failure into the same clean, already-established
`persistence_failed_after_settlement` terminal state (with a new
`missing_verification_receipt` error code) used one check above it for the
sibling `missing_verification_receipt_id` case — never a silent free
execution, never an opaque crash, a legible terminal state that matches the
architecture's existing settled-but-not-fully-persisted reconciliation
pattern.

All four fixed and verified GREEN together, then committed as one focused
regression-fix commit distinct from the inherited Part B work:
`82cc5b2`.

### 2.5 Formatting straggler

`packages/protocol-mcp/src/transport.test.ts` had prettier drift left over
from SUN-1222A's own legacy-handshake test addition (`88078b9`), blocking
`protocol-mcp`'s package-level `check` script at its first step before
lint/typecheck/build/test/test:property/spec:verify ever ran. Whitespace-only
fix, committed separately: `a48dc2c`.

## 3. Full package-level `check` scripts (not just root-level gates)

Per-package `check` scripts chain format/lint/typecheck/build/test/
test:property/fixtures-or-spec-verify — a stricter bar than the root
`typecheck`/`test`/`lint` tasks alone, and the exact gate the interrupted
session's own plan called for running before declaring Part B's x402/MCP/A2A
sections done.

```
protocol-mcp check   = PASS (format, lint, typecheck, build, 33/33 tests
                        [test + test:property, same suite under 2 configs],
                        spec:verify: "2026-07-28, 3 SDK pins, 6 tools")
protocol-x402 check  = PASS (format, lint, typecheck, 20/20 property tests,
                        fixtures:verify: x402-spec-baseline, Bazaar
                        extension baseline, and all 38
                        X402_SCENARIO_MATRIX.yaml test_reference entries
                        resolve to real files)
protocol-a2a check   = PASS (confirmed earlier this same checkpoint chain,
                        SUN-1222B: 46 unit + 6 property tests, fixture/spec
                        baseline)
```

## 4. Final repo-wide gate at this checkpoint's HEAD

```
HEAD=a48dc2c733695857e2ae74bb4d1bc65193fa8f5a
WORKING_TREE=clean
TYPECHECK=23/23 PASS
BUILD=12/12 PASS
LINT=16/16 PASS
TEST_SUITE=216/216 files, 2621/2621 tests (74 intentional live-gated skips)
SECRETS_SCAN=clean (git-history 643 commits / working-tree 1289 tracked+
  non-ignored-untracked files, both "no leaks found")
WRANGLER_DEPLOY_DRY_RUN=clean (bundle builds, no deploy)
```

## 5. Commits this checkpoint segment

```
82cc5b2  SUN-1222B-S2: fix real trust-class wiring gap + fail-closed PCC guard
a48dc2c  SUN-1222B-S2: format protocol-mcp/transport.test.ts
```

(Inherited from before the interruption, reconciled and verified rather than
re-done: `13f11d7` Part A gitleaks closure, `99561ae` settlement/expiry gate,
`53df612` canonical settled-workflow-result persistence, `de12de7` canonical
atomic price conversion, `8c49fd8` x402 hardening fixture alignment.)

## 6. What Part B has NOT yet covered

The interrupted session's own plan named these as still open when it hit its
usage limit — carrying them forward accurately rather than either silently
dropping them or claiming them done:

- SSRF/document-abuse adversarial re-verification specific to this
  checkpoint's changes (the underlying suite was independently re-run and
  confirmed passing during the earlier SUN-1222B checkpoint, but no NEW
  adversarial cases were added this segment)
- Cryptographic/JWKS audit (§21 of the original hardening brief)
- Supply-chain/dependency review (§23)
- CI gate wiring for the new invariants this checkpoint added (§36)
- Fuzz/property expansion beyond what already exists (§40)
- The full adversarial "hostile reviewer" pass (§41)
- Documentation/registry-prep sections (§43-45)

## 7. Governance

Per this checkpoint's own authorization: repo-only, zero deployments, zero
economic activity, zero production mutations — held throughout. No traffic
allocation touched (production remains exactly where SUN-1221G left it,
unverified-but-unchanged this checkpoint since no Cloudflare/wrangler mutating
command was ever run — only `--dry-run`). Any further continuation needs its
own explicit scope from here; this report is the accurate stopping point, not
a claim of the full 55-section brief's completion.

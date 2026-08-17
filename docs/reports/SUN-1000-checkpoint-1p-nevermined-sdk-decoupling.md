# SUN-1000 Checkpoint 1P — Nevermined SDK Decoupling / Trivy Blocker Elimination

Accepted HEAD parent `2cee37c`. **INTERNAL remediation checkpoint. Zero live
Nevermined provider calls, zero CDP transactions, zero production mutations.**
Result: **Trivy HIGH findings 3 → 0.** SUN-1000's 12 required
security-release-gate criteria now individually PASS (12/12) — see the
`next_action` note on scope: this reflects the 12 literal `acceptance_tests`,
not a self-declared formal SUN-1000 acceptance, and is entirely separate from
Nevermined's still-open provider issue.

## §2: complete SDK usage inventory

`grep -rl "@nevermined-io/payments"` across the repository, classified:

**A. Production runtime (4 real call sites, all in `apps/edge-api/src/`):**

| Symbol                                                 | File                     | Purpose                    | Mutation?           | Already wrapped?                   |
| ------------------------------------------------------ | ------------------------ | -------------------------- | ------------------- | ---------------------------------- |
| `Payments.getInstance().facilitator.verifyPermissions` | `nevermined-provider.ts` | real verify call           | no (soft rejection) | yes, `NeverminedFacilitatorClient` |
| `Payments.getInstance().facilitator.settlePermissions` | `nevermined-provider.ts` | real settle call           | **yes**             | yes, `NeverminedFacilitatorClient` |
| `buildPaymentRequired`                                 | `x402-service.ts`        | pure 402-challenge builder | no                  | no (direct call)                   |
| `getEnvironmentFromApiKey`                             | `index.ts`               | pure key-prefix parser     | no                  | no (direct call)                   |

**B/C. Sandbox/live-proof + registration tooling (14 files, all
`apps/edge-api/tests/live/*.test.ts`):** every one gated by its own
`describe.skipIf` on a dedicated env var (`RUN_LIVE_NEVERMINED`,
`RUN_LIVE_X402`, or a checkpoint-specific probe flag) — never executed by
`pnpm test`/`pnpm check`/CI. Imports `Payments`, `PaymentsError`,
`buildPaymentRequired`, `PlanRedemptionType`.

**D. Deterministic tests (2 files):** `nevermined-provider.test.ts` (mocked the
SDK directly — rewritten this checkpoint to mock `fetch` instead) and
`nevermined-credits-config-mechanism.test.ts` (credential-free, part of
`pnpm check`, uses `Payments.getInstance()` only to reach pure builder methods
like `getPayAsYouGoCreditsConfig()` — zero network call even with a real
instance, since construction only parses the key locally).

**E. Types/comments only:** `nevermined-sdk-parameters.ts` (see F),
`registry-reconciliation.ts` (doc comment only).

**F. Unused/dead:** `nevermined-sdk-parameters.ts` —
`toNeverminedVerifyPermissionsParams`/ `toNeverminedSettlePermissionsParams`,
referenced only by their own dedicated test, never imported by any real caller.
**Removed** along with its test.

## §3: transitive security chain (re-confirmed)

`@nevermined-io/payments@1.10.0` → `@traceloop/node-server-sdk@0.26.0` → pins
`@opentelemetry/sdk-node`/`exporter-prometheus` at `^0.203.0` and
`propagator-jaeger` at `2.0.1`. Checked the registry directly:
`@traceloop/node-server-sdk`'s latest published release (`0.27.0`) **still**
declares `"@opentelemetry/sdk-node": "^0.203.0"` — unchanged. No patched point
release exists for either vulnerable line (`0.203.0`/`2.0.1` are each the only
release in their line). No other direct or transitive dependency in this
repository requires those vulnerable versions.

## §4-5: protocol surface / primary-source cross-check

Traced the installed SDK down to its actual HTTP boundaries
(`dist/x402/facilitator-api.js`, `dist/api/base-payments.js`) and cross-checked
against Nevermined's current official documentation (fetched live this
checkpoint: "x402 Facilitator Overview", "How the x402 Facilitator Works", "API
Versioning"):

| Operation                                      | Method/Path                                                                           | Economic mutation?   | Reconciliation GET?                                                | Classification                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Verify                                         | `POST /api/v1/x402/verify`                                                            | no                   | —                                                                  | **DOCUMENTED_STABLE**                                                                                           |
| Settle                                         | `POST /api/v1/x402/settle`                                                            | **yes**              | `GET /delegation/{id}/transactions` (tooling-side, unchanged)      | **DOCUMENTED_STABLE**                                                                                           |
| Auth                                           | `Authorization: Bearer <key>`                                                         | —                    | —                                                                  | **DOCUMENTED_STABLE**                                                                                           |
| Version                                        | `Nevermined-Version` header, `MAJOR.MINOR`, resolution order header > key pin > floor | no                   | `GET /api/v1/meta/versions`                                        | **DOCUMENTED_STABLE** (matches the SDK's own `LOCKED_API_VERSION`/`options.version` mechanism exactly)          |
| `PaymentRequired` shape                        | —                                                                                     | no                   | —                                                                  | **DOCUMENTED_STABLE** (`x402Version`, `resource.url`, `accepts[0].{scheme,network,planId,extra}`, `extensions`) |
| Delegation create-first + `getX402AccessToken` | —                                                                                     | creates a delegation | `listDelegations`/`GET /delegation/{id}` (tooling-side, unchanged) | **DOCUMENTED_STABLE**                                                                                           |

**One flagged discrepancy, deliberately not acted on:** current docs list the
facilitator's base URL as `https://facilitator.sandbox.nevermined.app`; the
installed SDK's `environments.js` hardcodes
`https://api.sandbox.nevermined.app/` — the host this codebase has **empirically
proven correct** via multiple real settlements, most recently `2cee37c`. This
checkpoint makes no live call (per its own directive), so the discrepancy cannot
be resolved by testing here — the new client intentionally keeps the SDK's own
proven host.

No mutation-critical operation was UNDOCUMENTED or AMBIGUOUS; nothing was
implemented by guesswork.

## §6: feasibility classification — B

**B. RUNTIME_DECOUPLING_FEASIBLE_TOOLING_STILL_REQUIRES_SDK.**

Full A (eliminating the SDK from all 14 live-proof/registration test files too)
was considered and rejected: those files are inherently operator-invoked,
rarely-run diagnostic/registration tools that deliberately preserve
byte-for-byte fidelity to real economic mutation code paths this project's
entire governance history has been built around never touching casually.
Rewriting them carries real risk for zero additional Trivy benefit, because
**Trivy's own pre-existing, unmodified default behavior already excludes
`devDependencies`** (confirmed both in this checkpoint's and every prior
checkpoint's own `security:trivy` output:
`"Suppressing dependencies for development and testing"`). Reclassifying
`@nevermined-io/payments` from `dependencies` to `devDependencies` — once
production runtime genuinely no longer imports it — achieves the identical
scanner-clean outcome without touching Trivy's scope, config, or flags in any
way. This satisfies the directive's own explicit B-acceptance clause.

## §7-8: architecture / API versioning

New file:
[`apps/edge-api/src/control-plane/evidence/nevermined-http-client.ts`](../../apps/edge-api/src/control-plane/evidence/nevermined-http-client.ts)
— placed in `apps/edge-api`, not `packages/protocol-nevermined`, matching the
codebase's own established architectural boundary (`cdp-provider.ts`'s identical
precedent; `protocol-nevermined` stays network-free by design, enforced by its
own `no-network.test.ts`).

- `NeverminedHttpFacilitatorClient` — real `fetch`-based
  `verifyPermissions`/`settlePermissions`, implementing
  `NeverminedFacilitatorClient` directly (no wrapper adapter needed — the
  previous `OfficialNeverminedSdkAdapter` class is now entirely removed).
- Centralizes: base URL/environment resolution, `Authorization` construction,
  `Nevermined-Version` handling, safe error parsing (`NeverminedHttpError` with
  `code`/`category`/`hint`/`correlationId`/ `httpStatus`), a 30s timeout via
  `AbortController`, response shape validation (fails closed on
  malformed/missing required fields), and redaction (`Authorization` never
  enters any thrown error, log, or return value).
- `buildNeverminedPaymentRequiredLocal`/`resolveNeverminedEnvironmentFromApiKey`
  — pure, non-network replicas of the SDK's two pure helper functions, verified
  field-for-field against the SDK's own source.
- `NEVERMINED_LOCKED_API_VERSION = '1.1'` — the same value as the SDK's own
  `LOCKED_API_VERSION`, the backend generation every real settlement in this
  repository's history has actually been proven against. Visible in non-secret
  exported configuration, overridable per-instance (`apiVersion` option), fails
  closed (throws) on a malformed value at construction time rather than silently
  sending an invalid header — no provider call was made to select this value; it
  is the same one already empirically proven, not a new choice.

## §9: contract tests (25 new, zero live calls)

[`apps/edge-api/tests/nevermined-http-client.test.ts`](../../apps/edge-api/tests/nevermined-http-client.test.ts)
— fixture bodies are either the SDK's own exact construction shape or **real
captured responses from checkpoint 1O-B2A's live differential probes** (the
exact `"Cannot order pay-as-you-go plan"` rejection envelope, the real
`BCK.HTTP.404` error envelope). Covers: successful verify/settle, the real
rejection shape, malformed success body, missing transaction reference, 401/403,
provider 5xx, malformed (non-JSON) error and success bodies, network error,
timeout, version override, and malformed-version construction-time failure.
`nevermined-provider.test.ts` was also rewritten (fetch-mocked instead of
SDK-mocked) to assert the exact real wire shape (URL, method, headers, body) the
provider now sends.

## §10-12: mutation safety / Model-D / registrations — all preserved

- Mutation safety unchanged: the settle path still requires the caller
  (`nevermined-provider.ts`) to have already passed verification; ambiguous
  results still classify via the existing `validateNeverminedSettlementResult`
  normalizer (untouched); ambiguity still reconciles via the existing external
  `GET /delegation/{id}/transactions` recovery path (tooling-side, untouched);
  no retry logic was added or changed anywhere.
- Model-D: `apps/edge-api/tests/model-d-v2-nevermined.test.ts` re-run, 4/4
  passing — v2 Nevermined-rail route isolation from CDP unaffected.
- Registrations: zero touched. The four canonical v2 registrations and all
  historical v1/probe registrations are untouched by this checkpoint —
  registration tooling still uses the (now-devDependency) SDK unchanged.

## §14: dependency reclassification

`apps/edge-api/package.json`: `@nevermined-io/payments` moved from
`dependencies` to `devDependencies`. Lockfile regenerated mechanically via
`pnpm install` (no manual edit, no override):

```diff
 importers:
   apps/edge-api:
     dependencies:
-      '@nevermined-io/payments': 1.10.0
     devDependencies:
+      '@nevermined-io/payments': 1.10.0
```

## §15: Trivy decisive recheck

|                            | Before                         | After          |
| -------------------------- | ------------------------------ | -------------- |
| CRITICAL                   | 0                              | 0              |
| HIGH (blocking)            | **3** (all `@opentelemetry/*`) | **0**          |
| Total vulnerabilities      | 14                             | 7              |
| `security:trivy` exit code | 1 (fails)                      | **0 (passes)** |

The 7 remaining findings (LOW/MEDIUM, never blocking) are unrelated: `ajv`
(MEDIUM), `body-parser` (LOW), `qs` ×3 (MEDIUM/LOW), `uuid` (MEDIUM), `yaml`
(MEDIUM) — none touch the OpenTelemetry/Traceloop chain this checkpoint
targeted.

## §16: full regression

| Gate                    | Result                                                         |
| ----------------------- | -------------------------------------------------------------- |
| `security:load`         | PASS (7/7)                                                     |
| `security:chaos`        | PASS (18/18)                                                   |
| `security:schemathesis` | PASS (exit 0)                                                  |
| `security:semgrep`      | PASS (0 findings)                                              |
| `security:osv`          | PASS (0 critical)                                              |
| `security:trivy`        | **PASS (0 critical, 0 high)**                                  |
| `x402:check`            | PASS                                                           |
| `nevermined:check`      | PASS                                                           |
| `mcp:check`             | PASS                                                           |
| `a2a:check`             | PASS                                                           |
| `pnpm check`            | PASS (full suite, ~1870 tests, zero regressions from the swap) |

One real defect caught and fixed during this pass: the pre-existing
`verify-spec-fixture.ts` acceptance script asserted the SDK's presence in
`apps/edge-api/package.json`'s `dependencies` — a now-stale frozen fact. Updated
it (and `spec-baseline.json`, `schema_version` 1→2) to assert the new, correct
`devDependencies` placement instead of weakening or removing the check.

## §17: Nevermined provider blocker status — unchanged

`NEVERMINED_V2_PROVIDER_STATUS=BLOCKED_EXTERNAL_PROVIDER`, exactly as classified
in checkpoint 1O-B2A. **This checkpoint proves nothing about the PAYG verify
rejection itself** — it only removes the vulnerable dependency chain from the
production runtime surface. No provider verification of any kind was performed.

## §18: SUN-1000 state

Trivy reached `CRITICAL=0, HIGH=0`. The 12 required security criteria:

```
PASS                12 / 12
FAIL_INTERNAL         0 / 12
BLOCKED_EXTERNAL      0 / 12
```

`SUN-1000`'s `state` remains `active` — this checkpoint does **not**
self-declare formal acceptance, consistent with every prior checkpoint in this
arc. Separately, and not one of the 12:
`Nevermined Phase-2 provider: BLOCKED_EXTERNAL_PROVIDER` (unrelated to and
unresolved by this checkpoint). `production_ready=false`,
`production_enabled=false`.

## §21: stop report

1. Initial HEAD/tree: `2cee37c`, clean
2. SDK usages found: 4 production runtime, 14 live-proof/registration tooling
   files, 2 deterministic tests, 1 dead-code file (removed)
3. Runtime usages: 4 (2 real network calls, 2 pure functions) — all migrated
4. Tooling usages: 15 files, unchanged, still use the (now-dev) SDK
5. Required HTTP operations: verify, settle (both DOCUMENTED_STABLE)
6. Officially documented operations: verify, settle, versioning, delegation
   create-first, `PaymentRequired` shape — all DOCUMENTED_STABLE
7. Undocumented/ambiguous operations: **0**
8. Feasibility classification: **B**
9. Direct HTTP client implemented: **yes** (`nevermined-http-client.ts`)
10. `@nevermined-io/payments` removed: **no** — reclassified to
    `devDependencies` (still used by tooling)
11. Traceloop removed: no (transitively, only reachable via the now-dev SDK — no
    longer Trivy-scanned)
12. Vulnerable OpenTelemetry packages removed: **effectively yes from the
    scanned surface** (still present in `node_modules` for the devDependency
    tree, but Trivy's own default scope excludes it)
13. Trivy before: 3 HIGH, blocking
14. Trivy after: **0 HIGH, 0 CRITICAL, passing**
15. OSV: PASS (0 critical)
16. Semgrep: PASS (0 findings)
17. Load: PASS (7/7)
18. Chaos: PASS (18/18)
19. Schemathesis: PASS (exit 0)
20. x402: PASS
21. Nevermined deterministic tests: PASS (all, including 25 new + rewritten
    `nevermined-provider.test.ts`)
22. Model-D result: PASS (4/4, unaffected)
23. Existing v1 registrations preserved: **yes**, untouched
24. Existing v2 registrations preserved: **yes**, untouched
25. Nevermined live provider calls: **0**
26. Nevermined mutations: **0**
27. CDP transactions: **0**
28. Security criteria PASS count: **12/12**
29. BLOCKED_EXTERNAL count: **0/12**
30. Nevermined PAYG blocker status: `BLOCKED_EXTERNAL_PROVIDER`, unchanged
31. `production_ready`: **false**
32. `production_enabled`: **false**
33. Report path: this file
34. Commit: pending this checkpoint's own commit (parent `2cee37c`)
35. Clean tree: yes, confirmed via `pnpm check`/`secrets:scan`
36. Exact next production-critical action: send the 1O-B2A support packet to
    Nevermined and await their response before any further live Nevermined
    mutation attempt; separately, decide whether to formally accept SUN-1000's
    now-12/12 security tally.

STOP.

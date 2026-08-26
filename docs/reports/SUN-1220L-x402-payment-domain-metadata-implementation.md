# SUN-1220L — x402 EIP-712 payment-requirement domain metadata (implementation)

TDD + regression + commit only. **No Worker version upload, no deployment,
no live 402, no live CDP call, no signTypedData, no EIP-3009 authorization,
no payment signature, no paid SITEBORNE request, no settlement, no
transaction, no buyer funding.**

## 0. SUN-1220K authority

```
SUN1220K_DOMAIN_METADATA_DESIGN = COMPLETE
SUN1220K_ROOT_CAUSE_PROVEN      = YES
RECOMMENDED_REMEDIATION_APPROACH = B
```

`docs/reports/SUN-1220K-x402-payment-requirement-domain-metadata-design.md`
was inspected in full and confirmed to preserve every required field this
checkpoint's directive lists in §1 (`PAYMENT_REQUIREMENT_EXTRA_CURRENTLY_SET=NO`,
`EXACT_EVM_REQUIRED_EXTRA_FIELDS=name,version`,
`BASE_USDC_EIP712_NAME=USD Coin`, `BASE_USDC_EIP712_VERSION=2`,
`RECOMMENDED_REMEDIATION_APPROACH=B`, `ECONOMIC_CONTRACT_CHANGE_REQUIRED=NO`,
`OTHER_11_PAID_ROUTES_CHANGE_REQUIRED=NO`, `NEVERMINED_CHANGE_REQUIRED=NO`,
`NEW_PAID_CANDIDATE_REQUIRED=YES`, `SUN1220J_CLIENT_CHANGE_REQUIRED=NO`).
Every claim below was independently re-verified against the actual source
and the actual installed `@x402/evm@2.21.0` package (not re-derived from
the report's prose alone) -- see §2.

## 1. Reconciliation against the checkpoint's assumed starting state

The checkpoint's own §1 assumed HEAD = `09d41efc51e5abfa59db2aa42bae44cde03dee43`
(SUN-1220J) with the SUN-1220K report still uncommitted. Actual state at
the start of this checkpoint:

```
$ git rev-parse HEAD
e59be29a917e2f87fc5b7ce876455f9eaa3b0022

$ git status --short
?? docs/reports/SUN-1220H-paid-e2e-economic-preflight.md

$ git log -5 --oneline
e59be29 SUN-1220K: record x402 payment domain metadata design
09d41ef SUN-1220J: add one-shot local paid E2E client
12ecbbd SUN-1220I: record first paid E2E challenge preflight
6eaa135 SUN-1220G: record local CDP signer capability proof
ea89b80 SUN-1220F: add local-only CDP buyer signer-capability tool
```

**SUN-1220K was already committed** (`e59be29`) before this checkpoint
began -- §§1-2 of the directive (reconcile + commit the SUN-1220K report)
were already satisfied by a prior turn; this checkpoint proceeded directly
to §3 (frozen implementation scope) using `e59be29` as the base.

`SUN1220K_DESIGN_EVIDENCE_COMMIT_SHA = e59be29a917e2f87fc5b7ce876455f9eaa3b0022`

**Known, deliberate tree exception**: `docs/reports/SUN-1220H-paid-e2e-economic-preflight.md`
is a pre-existing untracked file, predating SUN-1220I/J/K (it references a
stale `HEAD = ea89b80...`), unrelated to this checkpoint's scope. The user
was asked how to handle it (discard / backfill-commit / leave untouched)
and dismissed the question without selecting an option. Per the safest,
least-destructive default (deleting an untracked file is unrecoverable;
committing it rewrites history the user did not explicitly approve), it
was left untouched. It is **not** part of this checkpoint's commit (§20).

## 2. Root-cause re-verification (independent of SUN-1220K's prose)

Read directly from source and from the installed, pinned library:

- `apps/edge-api/src/control-plane/config/production-payment.ts` (pre-fix):
  `ResolvedPaymentAsset = { address: string; decimals: number }`;
  `resolvePaymentAsset(network)` returns `getDefaultAsset(network)`
  verbatim (imported from `@x402/evm`) but the TYPE narrows away
  `name`/`version`, which the runtime value already carries.
- `apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.ts`
  (pre-fix): `asset: resolvePaymentAsset(network).address` -- only
  `.address` read; no `paymentRequirementExtra` key anywhere in the file.
- `node_modules/@x402/evm/dist/cjs/index.d.ts`: `getDefaultAsset(network: Network): ExactDefaultAssetInfo`,
  where `DefaultAssetInfo = { address: string; name: string; version: string; decimals: number }`.
- `node_modules/@x402/evm/dist/cjs/index.js`, `DEFAULT_STABLECOINS["eip155:8453"]`:
  `{ address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", name: "USD Coin", version: "2", decimals: 6 }` --
  confirmed byte-for-byte.
- `node_modules/@x402/evm/dist/cjs/index.js`, `signEIP3009Authorization`
  (called by `ExactEvmScheme.createPaymentPayload` -> `createEIP3009Payload`):

  ```js
  if (!requirements.extra?.name || !requirements.extra?.version) {
    throw new Error(
      `EIP-712 domain parameters (name, version) are required in payment
       requirements for asset ${requirements.asset}`
    );
  }
  ```

  confirmed to throw **before** `signer.signTypedData(...)` is ever called.

```
PAID_E2E_BLOCKER_ROOT_CAUSE (confirmed) = verify-agent-output-v2-cdp-composition.ts's
  returned X402ServiceRouteConfig never set paymentRequirementExtra, so the
  official ExactEvmScheme.createPaymentPayload throws before signTypedData
  for any real signing attempt against this route.
```

## 3. TDD RED evidence

New test file:
`apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.domain-metadata.test.ts`

Exercises the REAL production pipeline (SUN-1220K §5):
`buildVerifyAgentOutputV2CdpProductionRouteConfig` -> the real
`X402ServiceRouteConfig` -> `createX402ServiceRoute` (real route handler,
real D1 via Miniflare, same convention as
`apps/edge-api/tests/x402-service-route.test.ts`) -> the real
`buildExactPaymentRequirement` helper `x402-service.ts` already calls ->
the real, decoded `PAYMENT-REQUIRED` `PaymentRequirements` -> fed into the
real, official `ExactEvmScheme.createPaymentPayload` with a deterministic,
synthetic fake signer. Zero live CDP calls (evidence resolved via the
sanctioned `explicitTestEvidenceOverride` test-only escape hatch, SUN-1218
checkpoint X's own mechanism). Zero network calls. Zero real signatures
(the fake signer returns a fixed, non-recoverable synthetic byte string).

Command and actual output, run against the **unfixed** source:

```
$ pnpm exec vitest run apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.domain-metadata.test.ts

 × A/B/C/D/E/F/G/H/I: ... AssertionError: expected undefined to be 'USD Coin'
    at .../verify-agent-output-v2-cdp-composition.domain-metadata.test.ts:199:25
 × J/K: the real requirement is accepted by the official ExactEvmScheme...
   Error: EIP-712 domain parameters (name, version) are required in payment
   requirements for asset 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
     at signEIP3009Authorization .../@x402/evm/dist/esm/chunk-3QTA5JH4.mjs:46:11
     at createEIP3009Payload .../chunk-3QTA5JH4.mjs:33:27
     at ExactEvmScheme.createPaymentPayload .../chunk-3QTA5JH4.mjs:133:12
 × route isolation: paymentRequirementExtra is set in exactly one production
   composition file ... AssertionError (target file did not yet contain
   'paymentRequirementExtra:')
 ✓ L: extra.name stripped fails closed before the fake signer is reached
 ✓ M: extra.version stripped fails closed before the fake signer is reached
 ✓ N/O: official ExactEvmScheme checks only presence, not exact value

 Test Files  1 failed (1)
      Tests  3 failed | 3 passed (6)
```

```
TDD_RED_PROVEN = YES
FAKE_SIGN_TYPED_DATA_CALLS (before fix) = 0 (the throw in
  signEIP3009Authorization occurs strictly before signer.signTypedData is
  ever invoked -- confirmed by the call stack above, which never descends
  into the fake signer)
```

(L/M/N/O pass unmodified in both RED and GREEN phases -- they assert real,
version-independent `@x402/evm` library behavior given an explicitly
stripped/altered `extra`, not the production fix itself; this is expected
and consistent with SUN-1220K §12.)

## 4. Minimal implementation

Exactly the two files SUN-1220K/the checkpoint scoped, nothing else:

### `apps/edge-api/src/control-plane/config/production-payment.ts`

```diff
 export interface ResolvedPaymentAsset {
   address: string;
+  /** EIP-712 domain name ... */
+  name: string;
+  /** EIP-712 domain version ... */
+  version: string;
   decimals: number;
 }
```

Type-only widening. `resolvePaymentAsset`'s implementation is byte-for-byte
unchanged (`return getDefaultAsset(network);`) -- it already returned an
object with `name`/`version` at runtime; only the declared TYPE previously
discarded them.

### `apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.ts`

```diff
+  const asset = resolvePaymentAsset(network);
+
   return {
     serviceId: 'verify_agent_output.v2',
     scheme: 'exact',
     pricingKey: 'verify_agent_output_standard',
     rail: 'cdp',
     network,
-    asset: resolvePaymentAsset(network).address,
+    asset: asset.address,
+    paymentRequirementExtra: { name: asset.name, version: asset.version },
     payTo: env.SELLER_WALLET_ADDRESS,
```

No hardcoded `"USD Coin"`/`"2"` anywhere in production source -- both
values are read from the already-called, pinned `getDefaultAsset(network)`
return value.

```
ROOT_CAUSE_FIXED_IN_SOURCE                    = YES
RESOLVED_PAYMENT_ASSET_EXPOSES_NAME           = YES
RESOLVED_PAYMENT_ASSET_EXPOSES_VERSION        = YES
PRODUCTION_METADATA_VALUES_DERIVED_FROM_PINNED_X402 = YES
PRODUCTION_METADATA_VALUES_HARDCODED          = NO
```

## 5. Generated PaymentRequirements shape (real pipeline, mainnet)

Via the real production requirement pipeline (§3), with the four ADR-0055
gates set true only inside an in-process test env object (no real
Cloudflare secret/binding; the network resolver is a pure function of
these four plain booleans -- see the new test file's own doc comment for
the full reasoning) and `evidenceMode: 'fixture'` supplied only through
the sanctioned `explicitTestEvidenceOverride`:

```json
{
  "scheme": "exact",
  "network": "eip155:8453",
  "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "amount": "19000",
  "payTo": "0x7f44a2dd237938F18632d4CcA40f4c690295E6E1",
  "maxTimeoutSeconds": 60,
  "extra": {
    "quote_id": "qte_<...>",
    "name": "USD Coin",
    "version": "2"
  }
}
```

## 6. GREEN proof (official ExactEvmScheme, real requirement, fake signer)

Command and actual output, run against the **fixed** source:

```
$ pnpm exec vitest run apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.domain-metadata.test.ts

 ✓ apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.domain-metadata.test.ts (6 tests) 465ms

 Test Files  1 passed (1)
      Tests  6 passed (6)
```

```
PAYMENT_REQUIREMENT_EXTRA_NAME             = USD Coin
PAYMENT_REQUIREMENT_EXTRA_VERSION          = 2
FAKE_SIGN_TYPED_DATA_CALLS (after fix)     = 1
OFFICIAL_EXACT_EVM_REQUIREMENT_ACCEPTANCE  = PASS
```

No real signing, no network, no economically valid payment material: the
fake signer returns a fixed, non-recoverable synthetic 65-byte pattern
(`0x` + `"11"` repeated 65 times), never derived from any private key.

## 7. Test matrix (SUN-1220K A-W)

| Case | Proof |
|---|---|
| A/B | `extra.name`/`extra.version` present in the real generated requirement |
| C/D | exactly `"USD Coin"` / `"2"` |
| E/F/G/H/I | network/asset/amount/payTo/scheme unchanged (see §8) |
| J/K | official `ExactEvmScheme.createPaymentPayload` accepts the real requirement; fake `signTypedData` reached exactly once |
| L/M | missing name / missing version fails closed before the fake signer is reached |
| N/O | official library checks only *presence*, not exact value, of name/version (documented split -- see test's own comment); SITEBORNE's separate hard invariant is SUN-1220J's `validateChallengeAgainstExpectations`, unmodified and independently re-run green (§9) |
| P | disabled route stays 404 -- `production-verify-v2-cdp-route.test.ts` (unmodified, rerun green) |
| Q | missing deps stay 503 -- same file, unmodified, rerun green |
| R | other 11 paid routes retain prior contract -- `test:worker-runtime` PHASE 3/4/5/8 (88/88 green), route-isolation grep proof (below) |
| S | Nevermined unchanged -- `test:worker-runtime` PHASE 5 (green), no file under Nevermined's own path touched |
| T | wildcard `/v1/*`/`/v2/*` 404s -- `test:worker-runtime` PHASE 7/8 (green) |
| U/V | synthetic-evidence/fixture reachability = 0 -- `test:worker-runtime`'s `FIXTURE_RUNTIME_REACHABILITY` gate (green) |
| W | no buyer-signing code in Worker bundle -- `test:worker-runtime` bundle-isolation checks (green) |

## 8. Economic invariant proof (byte/field stability)

Asserted directly in the new test's case A/B/C/D/E/F/G/H/I against the
real generated requirement:

```
SERVICE  = verify_agent_output.v2   (unchanged -- serviceId literal untouched)
PRICE_USD = 0.019 -> AMOUNT_ATOMIC = 19000   (requirement.amount === '19000')
NETWORK  = eip155:8453              (requirement.network === EXPECTED_NETWORK)
ASSET    = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913  (requirement.asset === EXPECTED_ASSET)
PAYTO    = 0x7f44a2dd237938F18632d4CcA40f4c690295E6E1  (requirement.payTo === EXPECTED_PAYTO)
SCHEME   = exact                    (requirement.scheme === 'exact')
```

```
ECONOMIC_CONTRACT_CHANGED = NO
```

Only new semantic output: `extra.name`, `extra.version`.

## 9. Route isolation

New structural test (`route isolation: paymentRequirementExtra is SET...`):
greps the entire `apps/edge-api/src` tree for `paymentRequirementExtra:`
(an object-literal key assignment -- deliberately excludes the interface's
own `paymentRequirementExtra?:` optional declaration in `x402-service.ts`,
which has a `?` before the colon) and requires the match set to be
**exactly** `['apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.ts']`.

```
OTHER_11_PAID_ROUTES_RUNTIME_CHANGED = NO
NEVERMINED_RUNTIME_CHANGED           = NO
```

## 10. Mutation proof

New script: `scripts/test-domain-metadata-mutation-caught.mts` (follows
the existing `scripts/test-*-caught.mts` convention -- lightweight,
`vitest run` against the target integration test, not full-`workerd`).

Command and actual output:

```
$ npx tsx scripts/test-domain-metadata-mutation-caught.mts

[domain-metadata-mutation-proof: Mutation 1 (remove extra.name propagation)] PASS: mutant caught (expected undefined to be, 'USD Coin'), source restored byte-for-byte, restored source passes again.
[domain-metadata-mutation-proof: Mutation 2 (remove extra.version propagation)] PASS: mutant caught (expected undefined to be, '2'), source restored byte-for-byte, restored source passes again.
[domain-metadata-mutation-proof: Mutation 3 (resolved name drifts from official "USD Coin")] PASS: mutant caught ('Wrong Name', 'USD Coin'), source restored byte-for-byte, restored source passes again.
[domain-metadata-mutation-proof: Mutation 4 (resolved version drifts from official "2")] PASS: mutant caught ('99', '2'), source restored byte-for-byte, restored source passes again.
[domain-metadata-mutation-proof: Mutation 5 (paymentRequirementExtra leaks onto an unintended route)] PASS: mutant caught (route isolation, toEqual), source restored byte-for-byte, restored source passes again.
[domain-metadata-mutation-proof: Mutation 6 (payTo drifts while touching this same code region)] PASS: mutant caught (payTo, H), source restored byte-for-byte, restored source passes again.
[domain-metadata-mutation-proof] PASS: all six mutations were caught and every target was restored byte-for-byte.
```

```
$ git status --short
 M apps/edge-api/src/control-plane/config/production-payment.ts
 M apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.ts
?? apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.domain-metadata.test.ts
?? docs/reports/SUN-1220H-paid-e2e-economic-preflight.md
?? scripts/test-domain-metadata-mutation-caught.mts
```

(no leftover mutant diff -- every target restored byte-for-byte, confirmed
by SHA-256 comparison inside the script itself, and independently by the
clean `git status --short` above showing only the intended edits.)

```
DOMAIN_METADATA_MUTATION_PROOF = PASS
```

## 11. SUN-1220J local-client preservation

`apps/edge-api/tests/live/first-paid-e2e-local.test.ts` was not modified.
Rerun after the seller-side fix:

```
✓ apps/edge-api/tests/live/first-paid-e2e-local.test.ts (28 tests | 1 skipped)
```

```
SUN1220J_CLIENT_CHANGE_REQUIRED       = NO
SUN1220J_LOCAL_CLIENT_TESTS           = PASS
LIVE_PAYMENT_TEST_SKIPPED_BY_DEFAULT  = YES  (the one `RUN_LOCAL_FIRST_PAID_E2E`-gated describe block, unset in this run)
LIVE_PAYMENT_NETWORK_CALLS            = 0
```

## 12. Worker bundle isolation

`pnpm test:worker-runtime` (88/88 scenarios, real `workerd`, real dry-run
bundling) -- relevant excerpts:

```
✓ bundle isolation: real wrangler.toml dry-run bundle does NOT contain the test-only entrypoint
✓ bundle isolation: real wrangler.toml dry-run bundle does NOT contain the Nevermined test-only client factories
✓ bundle isolation: production runtime contains zero fixture BYPASS markers
✓ FIXTURE_RUNTIME_REACHABILITY (the real gate): hardBypassMarkers=0
✓ bundle inclusion (SUN-1218 central deliverable): ... SELLER_ADDRESS_LOOKUP_IN_NEW_BUNDLE=YES ACCOUNT_LOOKUP_CLIENT_FACTORY_IN_NEW_BUNDLE=YES
✓ bundle inclusion (SUN-1216 central deliverable): ... VERIFY_V2_CDP_COMPOSITION_IN_NEW_BUNDLE=YES
```

```
BUYER_SIGNING_CODE_ADDED_TO_WORKER            = NO
SUN1220J_LOCAL_CLIENT_IN_WORKER_BUNDLE        = NO (SUN-1220J's own test AA already greps for this; unaffected by this checkpoint)
CDP_WALLET_SECRET_NEW_RUNTIME_REACHABILITY    = 0
PRODUCTION_SYNTHETIC_PAYMENT_EVIDENCE_REACHABILITY = 0
PRODUCTION_FIXTURE_REACHABILITY               = 0
```

## 13. Full regression (sequential)

```
$ pnpm lint            -> 16/16 tasks successful
$ pnpm typecheck        -> 23/23 tasks successful (edge-api freshly checked, not cached)
$ pnpm test             -> 182 test files passed | 19 skipped (201); 2211 tests passed | 37 skipped (2248); 0 failed
$ pnpm test:worker-runtime -> 88/88 scenarios passed
$ pnpm production:preflight -> PREFLIGHT RESULT: PASS
$ pnpm secrets:scan     -> gitleaks (git): "no leaks found" (220 commits, ~11.05MB); gitleaks (dir): "no leaks found" (~21.38MB)
```

No suite failed at any point in this checkpoint; no failed-run history to
preserve.

```
SECRETS_SCAN            = PASS
SIGNATURE_VALUES_IN_REPORT = 0
SECRET_VALUES_IN_REPORT    = 0
PAYMENT_MATERIAL_VALUES_IN_REPORT = 0
```

## 14. Read-only live production containment

```
$ wrangler deployments status
Version(s):  (100%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
                 Created:  2026-08-22T07:06:16.667Z
                 Message:  SUN-1209 frozen candidate e5d061e2
```

Live, read-only fetch (`POST` with an empty `{}` body, no `PAYMENT-SIGNATURE`
header, zero payment, zero economic action) against the real deployed
Worker for all 12 paid routes:

```json
{
  "/v1/company/evidence-graph": 404,
  "/v1/web/context": 404,
  "/v1/document/evidence-json": 404,
  "/v1/verify/agent-output": 404,
  "/v2/company/evidence-graph": 404,
  "/v2/web/context": 404,
  "/v2/document/evidence-json": 404,
  "/v2/verify/agent-output": 404,
  "/v2/nevermined/company/evidence-graph": 404,
  "/v2/nevermined/web/context": 404,
  "/v2/nevermined/document/evidence-json": 404,
  "/v2/nevermined/verify/agent-output": 404
}
```

```
CURRENT_PRODUCTION_VERSION = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CURRENT_PRODUCTION_TRAFFIC = 100%
ordinary 12/12 paid routes = 404
WORKER_VERSIONS_CREATED = 0
DEPLOYMENTS = 0
TRAFFIC_SHIFTS = 0
```

## 15. Historical candidate invalidation

```
HISTORICAL_PAID_CANDIDATE = 9a18898a-f08b-4543-8e00-8bccf2dfc52a
HISTORICAL_PAID_CANDIDATE_REUSABLE = NO   (source changed; Worker versions are immutable)
NEW_PAID_CANDIDATE_REQUIRED = YES
```

The historical candidate was not touched, reused, or uploaded anywhere in
this checkpoint. No new candidate was uploaded either -- that step is
explicitly out of scope here (§20/§22 of the directive).

## 16. No live economic action occurred

Throughout this entire checkpoint: zero live 402 requests against the real
production Worker beyond the twelve read-only 404 checks in §14 (which
carry no payment header and reach no economic code path); zero live CDP
calls; zero calls to a real `signTypedData` (every `signTypedData` call in
every new test is answered by an in-process, synthetic, non-recoverable
fake signer); zero EIP-3009 authorizations; zero payment signatures; zero
paid SITEBORNE requests; zero settlements; zero transactions; zero Worker
version creations; zero deployments; zero traffic shifts.

## 17. Commit scope

```
apps/edge-api/src/control-plane/config/production-payment.ts
apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.ts
apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.domain-metadata.test.ts
scripts/test-domain-metadata-mutation-caught.mts
docs/reports/SUN-1220L-x402-payment-domain-metadata-implementation.md
```

`docs/reports/SUN-1220H-paid-e2e-economic-preflight.md` (pre-existing,
unrelated, untracked -- §1) is deliberately **not** included in this
commit.

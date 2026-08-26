# SUN-1220K — x402 payment-requirement EIP-712 domain metadata (design only)

Root-cause confirmation + bounded remediation design. **No source was
edited, no Worker version created, no deployment, no live 402, no CDP call,
no signing, no payment material, no settlement.**

> Provenance note: this file was originally written in the SUN-1220K
> checkpoint turn and was found truncated to 468 bytes at the start of the
> SUN-1220L checkpoint (cut off mid-sentence by a context-condensation
> event, not by any deliberate edit). It has been reconstructed here from
> the complete, intact tool-call evidence trail of that same turn (every
> command and its actual output, plus the full final stop packet reported
> to the user at the time) — nothing below is new invention.

## 0. Starting state

```
HEAD before this checkpoint = 09d41efc51e5abfa59db2aa42bae44cde03dee43
git status --short = ?? docs/reports/SUN-1220H-paid-e2e-economic-preflight.md
git log -5 --oneline:
  09d41ef SUN-1220J: add one-shot local paid E2E client
  12ecbbd SUN-1220I: record first paid E2E challenge preflight
  6eaa135 SUN-1220G: record local CDP signer capability proof
  ea89b80 SUN-1220F: add local-only CDP buyer signer-capability tool
  3489054 SUN-1220F: record CDP wallet-secret remediation design
```

HEAD matched the expected `09d41efc51e5abfa59db2aa42bae44cde03dee43`
(SUN-1220J implementation identity). Working tree clean except the
pre-existing untracked `SUN-1220H` report (unrelated to this checkpoint).
Per SUN-1220K's own instruction: the SUN-1220J report's self-embedded
commit SHA is stale (a structural fixed-point artifact of a report
referencing its own commit hash); `09d41efc51e5abfa59db2aa42bae44cde03dee43`
is treated as authoritative for SUN-1220J's identity regardless.

## 1. Route mounting

```
apps/edge-api/src/index.ts:28:
  import { verifyAgentOutputV2CdpProductionRoute } from './control-plane/routes/production-verify-v2-cdp-route';
apps/edge-api/src/index.ts:148:
  app.post('/v2/verify/agent-output', verifyAgentOutputV2CdpProductionRoute);
```

## 2. Trace seller-side payment requirement construction

`production-verify-v2-cdp-route.ts` (144 lines): two-flag gate
(`PAID_ROUTES_ENABLED` then `VERIFY_V2_CDP_ROUTE_ENABLED`, both must be the
literal `'true'`, else `c.notFound()`), then calls
`buildVerifyAgentOutputV2CdpProductionRouteConfig(...)` from
`verify-agent-output-v2-cdp-composition.ts` and forwards the request into a
cached `Hono` sub-app built via `createX402ServiceRoute`.

`verify-agent-output-v2-cdp-composition.ts` (228 lines) —
`buildVerifyAgentOutputV2CdpProductionRouteConfig(env, db, explicitTestEvidenceOverride?)`
returns, on success, this literal `X402ServiceRouteConfig`:

```ts
return {
  serviceId: 'verify_agent_output.v2',
  scheme: 'exact',
  pricingKey: 'verify_agent_output_standard',
  rail: 'cdp',
  network,
  asset: resolvePaymentAsset(network).address,
  payTo: env.SELLER_WALLET_ADDRESS,
  path: '/v2/verify/agent-output',
  inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS['verify_agent_output.v2'] as Record<string, unknown>,
  contractRelease: '2.0.0',
  inputSchemaHash: 'sha256:66d459905cd1a18b57ccb3fc40043a4e4c1a77bc7dba40676fcaf674cacb0f34',
  outputSchemaHash: 'sha256:a9a462b89b290ecba1aa62ec6d2fd030572f326ed79f498a43690244b38ad679',
  pccDependency: '1.1.0',
  db,
  clock: () => new Date().toISOString(),
  evidenceMode: cdpEvidence.evidenceMode,
  evidenceProvider: cdpEvidence.evidenceProvider,
  preEconomicBodyValidator: verifyAgentOutputPreEconomicCheck,
  executor,
};
```

**No `paymentRequirementExtra` key appears anywhere in this object literal
or anywhere else in the file.**

```
PAYMENT_REQUIREMENT_CONSTRUCTION_PIPELINE =
  index.ts:148 POST /v2/verify/agent-output
  → production-verify-v2-cdp-route.ts (2-flag gate)
  → verify-agent-output-v2-cdp-composition.ts:
      buildVerifyAgentOutputV2CdpProductionRouteConfig
      (asset: resolvePaymentAsset(network).address — .name/.version
       discarded; paymentRequirementExtra never set)
  → x402-service.ts:574 buildExactPaymentRequirement({ extra: config.paymentRequirementExtra })
  → protocol-x402 exact-requirement builder: extra = {...(input.extra ?? {}), quote_id}

PAYMENT_REQUIREMENT_EXTRA_CURRENTLY_SET = NO
```

`resolvePaymentAsset` (production-payment.ts:72-74):

```ts
export function resolvePaymentAsset(network: Network): ResolvedPaymentAsset {
  return getDefaultAsset(network);
}
```

`ResolvedPaymentAsset` (production-payment.ts:63-66, current/pre-fix):

```ts
export interface ResolvedPaymentAsset {
  address: string;
  decimals: number;
}
```

`getDefaultAsset` is imported `from '@x402/evm'` (production-payment.ts:16)
— the pinned official library, not a SITEBORNE-authored function.

All real call sites of `resolvePaymentAsset` in the repo (excluding tests):

```
apps/edge-api/src/control-plane/config/production-payment.ts   (definition)
apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.ts
apps/edge-api/src/control-plane/routes/paid-services.ts   (fixture-only —
  SUN-1206 already excluded this file from the real production entrypoint;
  index.ts never imports it)
```

Only 2 real call sites; only 1 (`verify-agent-output-v2-cdp-composition.ts`)
is production-reachable.

## 3. Trace client-side requirement (installed `@x402/evm@2.21.0`)

`node_modules/@x402/evm/dist/cjs/index.js` — the exact/EIP-3009 signing
path (`signEIP3009Authorization`, invoked by
`ExactEvmScheme.createPaymentPayload`) throws before calling
`signer.signTypedData(...)` if `requirements.extra?.name` or
`requirements.extra?.version` is missing:

```
"EIP-712 domain parameters (name, version) are required in payment
requirements for asset ..."
```

```
EXACT_EVM_REQUIRED_EXTRA_FIELDS = extra.name, extra.version
EXACT_EVM_NAME_REQUIRED = YES
EXACT_EVM_VERSION_REQUIRED = YES
OTHER_REQUIRED_EXTRA_FIELDS = none additional identified for the base
  exact/EIP-3009 path (the Permit2/EIP-2612 path reads
  extra.verifyingContract/assetTransferMethod but is not this route's path)
MISSING_EXTRA_FAILURE_STAGE = signEIP3009Authorization, local validation,
  before any signTypedData call
SIGN_TYPED_DATA_REACHABLE_WITH_CURRENT_CHALLENGE = NO
```

No live signature was created or attempted to establish this — it is a
direct read of the installed library's own source.

## 4. Confirm SUN-1220I challenge shape (no new live 402 issued)

From the already-committed `SUN-1220I` report:

```
docs/reports/SUN-1220I-first-paid-e2e-challenge-preflight.md:162:
  quote_id (extra) = qte_221238b196a8eb7a45e16f2c
```

```
SUN1220I_EXTRA_PRESENT = YES (the extra object itself is present)
SUN1220I_EXTRA_NAME    = (absent)
SUN1220I_EXTRA_VERSION = (absent)
CURRENT_LIVE_REQUIREMENT_SATISFIES_EXACT_EVM_CLIENT = NO
```

Sufficient to classify from committed evidence alone — no new live 402 was
requested.

## 5. Authoritative name/version source

`node_modules/@x402/evm/dist/cjs/index.js`, `DEFAULT_STABLECOINS` table:

```js
"eip155:8453": {
  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  name: "USD Coin",
  version: "2",
  decimals: 6
},
// Base mainnet USDC
```

```
BASE_USDC_EIP712_NAME        = "USD Coin"
BASE_USDC_EIP712_VERSION     = "2"
BASE_USDC_CHAIN_ID           = 8453
BASE_USDC_VERIFYING_CONTRACT = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
```

Source: the exact same official pinned library the client (`@x402/evm`)
already uses for `getDefaultAsset` — not an independent or hardcoded guess.
Matches SUN-1220J's client-side hard-validation constants exactly.

## 6. Server contract for `extra`

`x402-service.ts`, `X402ServiceRouteConfig.paymentRequirementExtra` doc
comment:

```ts
/** Official scheme/asset metadata carried in PaymentRequirements.extra
 * (for example an EVM token's EIP-712 domain name/version). The route
 * remains protocol-generic; its CDP/EVM integration supplies values
 * from the official x402 implementation rather than duplicating them. */
paymentRequirementExtra?: Record<string, unknown>;
```

Propagation: `x402-service.ts:574` —
`buildExactPaymentRequirement({ quote, resource_id, maxTimeoutSeconds, extra: config.paymentRequirementExtra })`.

```
PAYMENT_REQUIREMENT_EXTRA_API = Record<string, unknown>, optional, on
  X402ServiceRouteConfig
PAYMENT_REQUIREMENT_EXTRA_PROPAGATION_PATH = config.paymentRequirementExtra
  → buildExactPaymentRequirement({extra}) → requirement.extra =
  {...extra, quote_id}
EXTRA_NAME_SEMANTICS = EIP-712 domain name for the asset
EXTRA_VERSION_SEMANTICS = EIP-712 domain version for the asset
IS_EXTRA_INTENDED_FOR_EIP712_DOMAIN_METADATA = YES (per the field's own
  doc comment, verbatim)
```

Correct server-side shape confirmed: `{ name: "USD Coin", version: "2" }`
merged with the existing `quote_id`.

## 7. Working references

```
WORKING_REFERENCE_FOUND = YES
WORKING_REFERENCE_LOCATIONS = apps/edge-api/tests/live/x402-live-exact.test.ts
```

```ts
// line 90
const BASE_SEPOLIA_ASSET_INFO = getDefaultAsset(NETWORK);
...
// lines 253-261
pricingKey: 'web_context_verified_direct',
network: NETWORK,
asset: BASE_SEPOLIA_USDC,
paymentRequirementExtra: {
  name: BASE_SEPOLIA_ASSET_INFO.name,
  version: BASE_SEPOLIA_ASSET_INFO.version,
  ...(BASE_SEPOLIA_ASSET_INFO.assetTransferMethod
    ? { assetTransferMethod: BASE_SEPOLIA_ASSET_INFO.assetTransferMethod }
    : {}),
```

```
REFERENCE_EXTRA_SHAPE = { name, version, ...optional assetTransferMethod }
  derived directly from getDefaultAsset(network)
```

Difference from SITEBORNE's current production composition: this exact
pattern already exists in-repo but only for Base Sepolia inside a live
test file (`x402-live-exact.test.ts`); it has never been applied to the
real production Base-mainnet composition
(`verify-agent-output-v2-cdp-composition.ts`), which still discards
`.name`/`.version` and only reads `.address`.

Two other files also reference `paymentRequirementExtra`
(`x402-live-upto.test.ts`, `x402-live-exact-v2.test.ts`,
`x402-service-route.test.ts`) — consistent with the same pattern, not
separately re-derived here.

## 8. Root cause

```
SUN1220K_ROOT_CAUSE_PROVEN = YES

PAID_E2E_BLOCKER_ROOT_CAUSE = verify-agent-output-v2-cdp-composition.ts's
  returned X402ServiceRouteConfig never sets paymentRequirementExtra, so
  ExactEvmScheme.createPaymentPayload's signEIP3009Authorization throws
  before signTypedData ("EIP-712 domain parameters (name, version) are
  required...") for any real signing attempt against this route.

FAILED_FUTURE_PIPELINE_STAGE = signEIP3009Authorization (local validation,
  pre-network, before any signTypedData call) — structurally analogous in
  kind to SUN-1220E's missing-walletSecret finding, but on the seller/
  requirement side rather than the buyer/credential side.
```

## 9. Scope the smallest correct fix

Compared A (global), B (route-specific only), C (derive in a lower-level
helper), D (other).

The evidence in §2 already shows the cleanest option is a hybrid: the
lower-level helper (`resolvePaymentAsset`/`ResolvedPaymentAsset`) already
computes `name`/`version` via the pinned `getDefaultAsset(network)` call —
it simply narrows its own return type down to `{address, decimals}` and
the composition file only reads `.address`. Widening the helper's type to
expose fields it already computes, and having *only*
`verify-agent-output-v2-cdp-composition.ts` actually consume them into
`paymentRequirementExtra`, requires zero new lookup table and zero
hardcoding.

```
RECOMMENDED_REMEDIATION_APPROACH = B, implemented via a C-style shared
  helper: widen production-payment.ts's ResolvedPaymentAsset/
  resolvePaymentAsset to also expose the name/version @x402/evm's
  getDefaultAsset() already computes (currently discarded — only
  .address is read today), then have ONLY
  verify-agent-output-v2-cdp-composition.ts add
  paymentRequirementExtra: { name: asset.name, version: asset.version }.
```

Rationale: the shared helper has exactly 2 real call sites in the whole
repo (itself, and the fixture-isolated `paid-services.ts` that `index.ts`
never imports) — widening its type changes no other route's runtime
behavior. `paymentRequirementExtra` itself would be set in exactly one
file.

## 10. Route-isolation requirement

Confirmed unaffected by this design: `PAID_ROUTES_ENABLED` two-level gate,
`VERIFY_V2_CDP_ROUTE_ENABLED` gate, `/v1/*`/`/v2/*` unconditional wildcard
404s (per `index.ts`'s SUN-1218 comment), production synthetic payment
evidence reachability, production fixture reachability, and
`ServiceRegistry.productionEnabled` are all untouched by this design — the
fix only adds two fields to one already-called function's return value and
reads them at one already-existing call site.

## 11. Economic invariants

```
ECONOMIC_CONTRACT_CHANGE_REQUIRED = NO
```

The fix does not touch price, network, asset, payTo, or scheme — those
five fields in the returned `X402ServiceRouteConfig` are untouched by this
design; only a new `paymentRequirementExtra` key is added.

## 12. Candidate consequence

```
HISTORICAL_PAID_CANDIDATE   = 9a18898a-f08b-4543-8e00-8bccf2dfc52a
REUSABLE_AFTER_SOURCE_CHANGE = NO (Worker versions are immutable; a source
  change requires a new version)
NEW_PAID_CANDIDATE_REQUIRED = YES
```

The historical candidate must not be modified or reused once source
changes; a new immutable 0%-normal-traffic candidate is required after
implementation, regression, and commit — not created in this checkpoint.

## 13. Test design (TDD, not yet implemented)

At minimum, the A–W matrix specified by the checkpoint prompt: extra.name/
version present and exactly "USD Coin"/"2"; network/asset/amount/payTo/
scheme unchanged; the official `ExactEvmScheme.createPaymentPayload`
accepts the actual generated requirement via a deterministic fake signer,
reaching `signTypedData` exactly once; missing/wrong name or version fails
closed before the fake signer is reached; disabled route stays 404;
missing dependencies stay 503; other 11 paid routes, Nevermined, wildcard
404s, synthetic-evidence and fixture-executor unreachability, and
no-buyer-signer-in-bundle all remain unchanged; existing price/network/
asset/payTo mutation proof remains effective; a new metadata mutation
proof is added.

```
PROPOSED_TEST_MATRIX = 23 cases (A–W) covering: extra.name/version present
  and correct; ExactEvmScheme accepts the real generated requirement via a
  deterministic fake signer, signTypedData reached exactly once; wrong/
  missing name or version fails closed client-side; all 12-route/
  Nevermined/wildcard/fixture/synthetic containment invariants unchanged;
  price/network/asset/payTo mutation proof still effective; new metadata
  mutation proof added.
```

Prefer an integration test that constructs the actual generated
`PaymentRequirements` (via the real production requirement pipeline) and
feeds it into the real, official `ExactEvmScheme` with a deterministic
fake signer — no real signature, no live CDP call.

## 14. Mutation-proof design (not yet written)

```
PROPOSED_METADATA_MUTATION_PROOF = a script proving: removing extra.name,
  removing extra.version, or changing either value away from
  "USD Coin"/"2" on verify_agent_output.v2/CDP is caught by the new test
  matrix; and that applying paymentRequirementExtra to any OTHER route's
  composition, or changing amount/network/asset/payTo, is also caught.
```

## 15. Live qualification plan after implementation (design only)

1. implement metadata fix; 2. regression; 3. commit; 4. upload one NEW
immutable paid candidate; 5. candidate 0% normal traffic; 6. candidate
attribution; 7. exactly one unpaid 402; 8. decode challenge; 9. prove
`extra.name`/`extra.version` present; 10. mandatory restoration; 11.
freeze evidence; 12. only then first real paid-E2E authorization. Metadata
qualification is deliberately kept separate from the real payment, so a
second challenge-shape problem (if any) surfaces before economic payment
material is ever created.

## 16. SUN-1220J client impact

```
SUN1220J_CLIENT_CHANGE_REQUIRED = NO
```

The already-committed local client (`09d41efc51e5abfa59db2aa42bae44cde03dee43`)
already hard-validates `extra.name === "USD Coin"` and
`extra.version === "2"` as part of its own challenge validation — it was
built anticipating exactly this gap. Once the seller-side fix lands and a
fresh challenge actually contains these fields, the client's existing
validation simply starts passing; no client source change is required. It
is preserved byte-identically by this design.

## 17. Mutation accounting (this checkpoint)

```
SOURCE_FILES_CHANGED = 0
WORKER_VERSIONS_CREATED = 0
DEPLOYMENTS = 0
TRAFFIC_SHIFTS = 0
LIVE_402_REQUESTS = 0
LIVE_CDP_CALLS = 0
LIVE_SIGN_TYPED_DATA_CALLS = 0
EIP3009_AUTHORIZATIONS_CREATED = 0
PAYMENT_SIGNATURES_CREATED = 0
LIVE_PAID_REQUESTS = 0
SERVICE_EXECUTIONS = 0
SETTLEMENTS = 0
TRANSACTIONS = 0
REAL_ECONOMIC_EFFECTS = 0
```

## 18. Final stop packet (as originally reported)

```
SUN1220K_DOMAIN_METADATA_DESIGN = COMPLETE
SUN1220K_ROOT_CAUSE_PROVEN = YES
PAYMENT_REQUIREMENT_EXTRA_CURRENTLY_SET = NO
EXACT_EVM_REQUIRED_EXTRA_FIELDS = name, version
SUN1220I_EXTRA_PRESENT = YES
BASE_USDC_EIP712_NAME = USD Coin
BASE_USDC_EIP712_VERSION = 2
BASE_USDC_CHAIN_ID = 8453
BASE_USDC_VERIFYING_CONTRACT = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
IS_EXTRA_INTENDED_FOR_EIP712_DOMAIN_METADATA = YES
WORKING_REFERENCE_FOUND = YES
RECOMMENDED_REMEDIATION_APPROACH = B
ECONOMIC_CONTRACT_CHANGE_REQUIRED = NO
OTHER_11_PAID_ROUTES_CHANGE_REQUIRED = NO
NEVERMINED_CHANGE_REQUIRED = NO
NEW_PAID_CANDIDATE_REQUIRED = YES
SUN1220J_CLIENT_CHANGE_REQUIRED = NO
REMEDIATION_IMPLEMENTATION_ELIGIBLE = YES
SOURCE_FILES_CHANGED = 0
WORKER_VERSIONS_CREATED = 0
DEPLOYMENTS = 0
TRAFFIC_SHIFTS = 0
LIVE_SIGN_TYPED_DATA_CALLS = 0
EIP3009_AUTHORIZATIONS_CREATED = 0
PAYMENT_SIGNATURES_CREATED = 0
LIVE_PAID_REQUESTS = 0
SETTLEMENTS = 0
TRANSACTIONS = 0
REAL_ECONOMIC_EFFECTS = 0
```

Secrets scan of this report at the time: `pnpm secrets:scan` → "no leaks
found" (gitleaks, ~21.34 MB scanned). `git status --short` showed only
this report and the pre-existing untracked `SUN-1220H` file; `git
rev-parse HEAD` remained `09d41efc51e5abfa59db2aa42bae44cde03dee43`
(unchanged) — confirming zero source mutation during this design
checkpoint.

Not committed at the time, per instruction ("Do not commit automatically
unless separately authorized").

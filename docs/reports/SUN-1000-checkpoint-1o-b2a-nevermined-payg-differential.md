# SUN-1000 Checkpoint 1O-B2A — Nevermined PAYG Version/Provider Differential Diagnosis

Interim checkpoint 1O-B2 accepted at `3ed172b`. This checkpoint performed a
bounded, read-only (plus non-settling-verify-only) differential diagnosis of the
real Nevermined sandbox rejection ("Cannot order pay-as-you-go plan") found
there. **Zero registrations, zero delegations created, zero orders, zero
settlements, zero CDP calls.**

## Method

Two new diagnostic-only test files, each gated by its own dedicated env var
(never `RUN_LIVE_NEVERMINED`):

- [nevermined-1o-b2a-version-differential-probe.test.ts](../../apps/edge-api/tests/live/nevermined-1o-b2a-version-differential-probe.test.ts)
  (`NEVERMINED_PROBE_1O_B2A_DIFFERENTIAL=1`) — two tests: (1) pure read-only
  version/plan/agent/delegation metadata capture; (2) proof that `verify` is
  non-settling, then exactly 2 `verifyPermissions` calls (default SDK version,
  then an explicit `1.19` override) against the **same already-existing**
  delegation, each additionally captured via a raw HTTP POST to the same
  endpoint to recover the complete response envelope. Every call checked the
  delegation's transaction count before and after (required to stay `0`/`0`).

## §1-3: baseline / SDK version

- Clean tree, `HEAD=3ed172b` confirmed before starting.
- `governance:validate`/`state:validate`/`tasks:validate` all passing before any
  read.
- `INSTALLED_SDK_VERSION = 1.10.0` (`@nevermined-io/payments` package.json).
- `SDK_LOCKED_API_VERSION = 1.1` (`common/api-version.js`'s `LOCKED_API_VERSION`
  constant — sent verbatim as the `Nevermined-Version` header on every request
  unless `options.version` overrides it per instance; never inferred from the
  SDK package version number).

## §2: frozen external state (unchanged, zero mutation)

- `company_evidence_graph.v2`: agent
  `8945215415179810337511916177281451484220450532075244586308753062965582716389`,
  plan
  `10268032069987826322514735824876788768903142706079143267509577311063526800318`
  — both reconcile `existing`, byte-identical to the frozen 1O-B1 evidence.
- Delegation `ed698611-eb73-4a1b-a441-78e20a6564c6` (created during 1O-B2):
  `status: Active`, `transactionCount: 0`, `remainingBudgetCents: 1` — real
  external state, preserved throughout this checkpoint, never recreated.

## §4-6: version metadata

`GET /api/v1/meta/versions` (read-only, confirmed 200):

| Field                                                     | Value     |
| --------------------------------------------------------- | --------- |
| `current` (backend)                                       | `1.20`    |
| `floor`                                                   | `1.0`     |
| `gatedVersions`                                           | `["1.1"]` |
| `yourPinnedVersion` (the NVM_API_KEY's own dashboard pin) | `1.19`    |
| `yourEffectiveVersion` (this request)                     | `1.1`     |
| `yourVersionResolvedFrom`                                 | `header`  |

**Classification: `KEY_BEHIND_SDK` is wrong; the correct read is
`SDK_BEHIND_KEY`** — the installed SDK's hardcoded `LOCKED_API_VERSION=1.1`
header **overrides** the key's own, much newer, dashboard-configured pin
(`1.19`) whenever it's sent (`yourVersionResolvedFrom: "header"` — header wins
over key-tag pin). `1.1` is additionally listed in the backend's own
`gatedVersions` — a version the backend flags specially (legacy/quarantined
behavior). This looked like a strong, well-evidenced candidate root cause.

A normal authenticated `GET /api/v1/protocol/plans/{planId}` (§5) confirmed the
same resolution mechanics: `nevermined-version-resolved-from: header`.

## §7: plan differential (read-only, via `payments.plans.getPlan`)

Compared the failed `company_evidence_graph.v2` plan against the historical
known-working `web_context_verified.v1` plan (the same plan class that produced
two independently-confirmed real settlements in earlier checkpoints). **No
material semantic difference found**:

| Field                                      | company_evidence_graph.v2 | web_context_verified.v1      |
| ------------------------------------------ | ------------------------- | ---------------------------- |
| `billingModel`                             | `pay-as-you-go`           | `pay-as-you-go`              |
| `metadata.plan.x402Scheme`                 | `nvm:erc4337`             | `nvm:erc4337`                |
| `metadata.plan.accessLimit`                | `credits`                 | `credits`                    |
| `registry.price.isCrypto`                  | `true`                    | `true`                       |
| `registry.price.tokenAddress`              | `0x036C...dCF7e`          | `0x036C...dCF7e` (identical) |
| `registry.credits.redemptionType`          | `4`                       | `4`                          |
| `registry.credits.isRedemptionAmountFixed` | `false`                   | `false`                      |
| `registry.credits.durationSecs`            | `"0"`                     | `"0"`                        |
| `network`                                  | `84532`                   | `84532`                      |
| `registry.owner`                           | `0xCa7DD9...`             | `0xCa7DD9...` (identical)    |

Only the amounts differ, appropriately (`38610`/`390` vs `8910`/`90`, matching
each plan's own registered price). **Rules out (C)
PROVIDER_PLAN_METADATA_DIFFERENCE.**

Agent metadata (§7, agent side): same structural shape for both agents
(`registry.owner`/`creator` identical, `metadata.agent.endpoints` correctly
differing per service, `authentication.type: none` both). No material
difference.

## §8: delegation differential (read-only)

Compared the current 1O-B2 delegation against a real historical delegation
(`f2c64337-3bb7-4109-a99a-bb3642addffb`) that produced a confirmed real settled
transaction in an earlier, already-accepted checkpoint (`0x847a6da0...`,
`status: succeeded`, per its own transactions endpoint):

| Field                               | Current (blocked) | Historical (succeeded)    |
| ----------------------------------- | ----------------- | ------------------------- |
| `provider`                          | `erc4337`         | `erc4337`                 |
| `currency`                          | `usdc`            | `usdc`                    |
| `spendingLimitCents`                | `1`               | `1`                       |
| `planId` (delegation-level binding) | `null`            | `null`                    |
| `bindingId`                         | `null`            | `null`                    |
| `providerPaymentMethodId`           | `0xCa7DD9...`     | `0xCa7DD9...` (identical) |

**No material structural difference. Rules out (D) DELEGATION_DIFFERENCE.**
Notably, the delegation-level `planId` field is `null` on _both_ the failed and
the historically-successful delegation — this is normal, not a defect (the SDK's
own `create-first` flow only threads `planId` into the delegation creation
_payload_, which the backend evidently does not echo back onto the delegation
record itself, for either case).

## §9: documented flow match

Nevermined's current x402 guide documents exactly the flow used here:
create-first delegation →
`getX402AccessToken(planId, agentId, {delegationConfig:{delegationId}})` →
verify → (if valid) execute → settle. `token.d.ts`'s own JSDoc example matches
our code call-for-call. **Classification: `DOC_FLOW_MATCH`.**

## §10: verify is non-settling — proven, not assumed

- Separate documented purpose: README's own example treats `verifyPermissions`
  ("Verify if subscriber has sufficient permissions/credits") and
  `settlePermissions` ("settle (burn) the credits") as two independent steps,
  the second gated on `verification.isValid`.
- Separate backend endpoints: `/api/v1/x402/verify` vs `/api/v1/x402/settle`
  (`facilitator-api.js`'s own `API_URL_VERIFY_PERMISSIONS`/
  `API_URL_SETTLE_PERMISSIONS` constants).
- `verifyPermissions()`'s own implementation (`facilitator-api.js`) does nothing
  but `POST` to the verify endpoint and return its JSON body — it contains no
  call to the settle endpoint or any other mutating call.
- Confirmed empirically in this checkpoint: every verify call's delegation
  transaction count stayed `0`/`0` (before/after), including two calls made
  under two different resolved API versions.

**`VERIFY_ECONOMICALLY_NON_SETTLING: yes` — proven, §11 proceeds.**

## §11-12: version-differential verify (bounded — exactly 2 attempts)

Both attempts reused the SAME already-existing delegation (`ed698611-...`), the
same plan/agent, and produced fresh ephemeral (non-mutating) x402 access tokens.
Full raw HTTP response body captured for each:

**Attempt A — SDK default (effective version `1.1`, the gated version):**

```json
{
  "isValid": false,
  "invalidReason": "Cannot order pay-as-you-go plan",
  "payer": "0xCa7DD940B5071Bbcb238901794B900CF9db376E7",
  "agentRequest": {
    "balance": {
      "planId": "10268032069987826322514735824876788768903142706079143267509577311063526800318",
      "holderAddress": "0xCa7DD940B5071Bbcb238901794B900CF9db376E7",
      "balance": "0",
      "isSubscriber": true,
      "pricePerCredit": 0.039
    }
  }
}
```

HTTP status: `201`. Delegation transactions: `0` before, `0` after.

**Attempt B — explicit override to the key's own pinned version (`1.19`), via
the SDK's own documented `options.version` mechanism (never touching the
dashboard-stored pin):**

Byte-identical result: `isValid: false`,
`invalidReason: "Cannot order pay-as-you-go plan"`, same `payer`, same
`balance.holderAddress`, same `balance: "0"`. HTTP status `201`. Delegation
transactions `0` before, `0` after.

**The API-version axis makes zero difference. Hypothesis (A)
API_VERSION_MISMATCH is FALSIFIED** — a currently-supported, non-gated version
(`1.19`, the key's own real pin) produces the exact same rejection as the gated
`1.1`.

### A genuinely new lead surfaced by the raw envelope

Both attempts' full response body includes
`balance.holderAddress: "0xCa7DD940B5071Bbcb238901794B900CF9db376E7"` with
`balance: "0"` — this is the **plan owner's own address** (`registry.owner` on
both plans, confirmed identical in §7), not a distinct subscriber wallet. The
backend appears to be evaluating the request against the owner's own zero
balance on their own plan, which is exactly the situation a "cannot order your
own PAYG plan" rejection would describe.

This is **not**, on its own, disqualifying: the historical
`web_context_verified.v1` success used the **identical** address
(`providerPaymentMethodId: 0xCa7DD9...`, confirmed in §8) and it settled for
real (`0x847a6da0...`, `status: succeeded`). So the same address successfully
transacted before under the same "owner-address-as-subscriber" sandbox setup.
What changed is not the identity — it's that the identical call shape, against
the identical address, on a structurally identical plan, now fails where it
previously succeeded.

## §13: historical success reconciliation

- Historical delegation `f2c64337-3bb7-4109-a99a-bb3642addffb`:
  `status: Exhausted`, `transactionCount: 1`, `amountSpentCents: "1"`,
  `createdAt: 2026-08-15T04:34:03Z`, `lastUsedAt: 2026-08-15T04:34:11Z`.
- Its transactions record: 1 `succeeded` transaction,
  `providerTransactionId: 0x847a6da0a6a63f1f12838bbe9269b8fd9798997b0680b0146b7147fcb715f417`,
  `amountCents: "1"`, `currency: USDC`.
- This is a **second, independent, real confirmed PAYG settlement** (distinct
  from the `0x59a8bd0b...` transaction referenced in the 1O-B2 report), from
  **2026-08-15** — roughly 2 days before this checkpoint's blocked attempt
  (**2026-08-17**).

Given identical plan semantics, identical delegation semantics, identical payer
identity, and a documented-flow-match, the ~2-day gap between the historical
success and the current failure is the most concrete distinguishing fact
available.

## §14: classification

Evaluated against §16's exact four preconditions, all four independently
confirmed above:

1. Provider metadata matches historical working PAYG semantics — **yes** (§7).
2. Delegation semantics match — **yes** (§8).
3. SITEBORNE flow matches current documentation — **yes** (§9), and this
   checkpoint additionally bypassed all SITEBORNE route/provider code entirely
   (called the raw SDK facilitator directly) and still reproduced the identical
   failure — ruling out a SITEBORNE-side flow defect even more strongly than
   doc-comparison alone.
4. Supported API-version differential does not resolve it — **yes**, falsified
   directly (§11).

**Final classification: E. `NEVERMINED_BACKEND_REGRESSION_OR_DEFECT`.**

Not `F. INSUFFICIENT_EVIDENCE` — every alternative axis (A/B/C/D) was tested and
affirmatively ruled out with real evidence, not merely unexamined.

## §15/§16: next action

Per §16, since this is provider-defect-classified, **no re-registration, no
SDK/API-version realignment action, no further mutation**. The four v2
registrations are preserved exactly as-is. A concise support packet (below) is
ready for Nevermined support — **no API key, no token, no secret, no
session/private material** included anywhere in this report or the packet.

### Support packet (safe to share externally)

```
Sandbox environment: sandbox (api.sandbox.nevermined.app)
SDK version: @nevermined-io/payments@1.10.0
SDK locked API version (header sent): 1.1 (gated)
Key's own dashboard-pinned version: 1.19
Backend current version: 1.20
Effective version confirmed via /api/v1/meta/versions: resolved from header, both 1.1 and 1.19 tested explicitly via SDK instance override
Agent ID: 8945215415179810337511916177281451484220450532075244586308753062965582716389
Plan ID: 10268032069987826322514735824876788768903142706079143267509577311063526800318
Plan billingModel: pay-as-you-go (registry.credits.redemptionType=4, isRedemptionAmountFixed=false)
Delegation ID: ed698611-eb73-4a1b-a441-78e20a6564c6 (provider=erc4337, currency=usdc, status=Active, transactionCount=0, unaffected by any of the below attempts)
Error (both version attempts): {"isValid":false,"invalidReason":"Cannot order pay-as-you-go plan"}, HTTP 201
agentRequest.balance.holderAddress in both responses resolves to the plan OWNER's own address, balance "0"
Zero settlements attempted; zero delegation transactions before or after (confirmed via GET /delegation/{id}/transactions both times)
Historical comparison: an earlier delegation (2026-08-15) with the identical provider/currency/spendingLimit/payer-address configuration, against a structurally identical PAYG plan (same billingModel/redemptionType/scheme), settled successfully for real (1 succeeded transaction on record) two days before this rejection first appeared.
```

## §17: regression

`pnpm check` full run: clean (format, lint, typecheck [after one real fix: two
`string | undefined` narrowing errors in the new probe file, corrected by
hoisting a validated `const apiKey: string`/`subscriberApiKey: string`], all
unit/integration suites, PCC/services/OpenAPI generation, Python tests,
governance/state/tasks validate, contracts baseline/compat/release verify,
migrations, D1/control-plane/adapters/document-worker/
verification/services-runtime checks, x402/mcp/a2a/nevermined checks,
secrets:scan). No contract/PCC/payment-semantic mutation.

## §19: stop report

1. SDK version: `@nevermined-io/payments@1.10.0`
2. SDK locked API version: `1.1`
3. Backend current version: `1.20`
4. Key pinned version: `1.19`
5. Effective request version (default): `1.1`, resolved from `header`
6. Version resolution source: `header` (SDK's sent header wins over the key's
   own dashboard pin)
7. Gated versions: `["1.1"]`
8. Failed v2 provider plan semantics: real PAYG (`billingModel: pay-as-you-go`,
   `redemptionType: 4`, `isRedemptionAmountFixed: false`,
   `x402Scheme: nvm:erc4337`, network `84532`)
9. Historical working provider plan semantics: identical shape (same fields,
   same values except the appropriately-different price)
10. Material plan differences: **none found**
11. Failed delegation semantics: `erc4337`/`usdc`/`spendingLimitCents:1`/
    `planId:null`/`status:Active`/`transactionCount:0`
12. Historical delegation semantics: identical shape, `status:Exhausted`
    (post-use), `transactionCount:1` (`succeeded`)
13. Material delegation differences: **none found**
14. Official documented flow matches: **yes**
15. Verify economically non-settling: **yes** — proven, not assumed
16. Version differential attempts: **2** (default `1.1`; explicit override
    `1.19`, via the SDK's own `options.version`, dashboard pin untouched)
17. Delegation transactions before/after: **0/0** both attempts
18. Machine-readable provider error: no `BCK.*` code in the verify response body
    (only `isValid`/`invalidReason`/`agentRequest` — the version-metadata
    endpoint's own 404 responses **did** show the `BCK.*` envelope shape, e.g.
    `BCK.HTTP.404`, confirming the backend has that machine-readable convention
    available; the verify endpoint's `201` "soft rejection" simply doesn't use
    it)
19. Correlation ID available: **yes**, on the `/meta/versions` and 404 probe
    calls (`x-correlation-id` header); not present on the verify endpoint's
    response body/headers captured here
20. Historical successful PAYG version evidence: a real settled transaction
    (`0x847a6da0...`, delegation `f2c64337-3bb7-4109-a99a-bb3642addffb`) on
    2026-08-15, ~2 days before this rejection first appeared, under the same
    account/address/plan configuration
21. Final classification: **E. NEVERMINED_BACKEND_REGRESSION_OR_DEFECT**
22. Existing four v2 registrations preserved: **yes**, unchanged, confirmed
    reconciling `existing` throughout
23. New registrations: **0**
24. Settlements: **0**
25. CDP transactions: **0**
26. Next exact action: prepare and send the support packet above to Nevermined;
    no further live Nevermined mutation attempt until either Nevermined
    confirms/fixes the regression or provides guidance. Do not re-register, do
    not change credential rotation state, do not begin
    SUN-0800B/SUN-1100/SUN-1200.
27. Commit hash: pending this checkpoint's own commit (parent `3ed172b`)
28. Clean tree: yes, confirmed via `pnpm check` and `secrets:scan` both green
    before this report's commit

STOP. No settle performed. No re-registration performed.

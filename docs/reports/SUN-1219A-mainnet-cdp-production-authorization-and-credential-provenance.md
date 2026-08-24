# SITEBORNE Utility Network — SUN-1219A

## Base Mainnet / CDP Production Authorization & Credential-Provenance Gate

**Date:** 2026-08-24 **Classification:** analysis/decision checkpoint — no
mutation. **Starting HEAD:** `c5c745ae439030da883cbb6a2e6a20c2d4f83813` (working
tree clean before and after). **Ending HEAD:** unchanged — no source or config
was modified by this checkpoint.

This is an evidence/decision report only. It sets no ADR-0055 gate, creates no
Worker version, performs no deployment, and makes no CDP or mainnet call.

---

## 1. Starting reconciliation

```text
START_HEAD=c5c745ae439030da883cbb6a2e6a20c2d4f83813
WORKING_TREE=CLEAN
CURRENT_PRODUCTION_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CURRENT_PRODUCTION_TRAFFIC=100%
/health=200
/ready=200
12/12 paid REST routes=404 (reconfirmed with matching content-type/body; an initial no-body
  probe returned 415 from media-type validation preceding the route match — a probe-methodology
  artifact, not a route defect, and superseded by the matching re-run below)
SUN1219A_START_PREFLIGHT=PASS (pnpm production:preflight, read live)
```

No deployment mutation occurred to establish this baseline.

---

## 2. ADR-0055 re-read literally — critical scoping finding

`docs/decisions/0055-human-authorized-production-bootstrap-exception.md` was
re-read in full, not from a prior summary. Its own "Frozen interpretation,
recorded explicitly" block literally names and defines exactly **one** of the
four gates:

```text
HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP = true
AUTONOMOUS_PRODUCTION_AUTHORITY       = false
EXECUTABLE_VERIFIED                   = false
```

`PAYMENT_ENVIRONMENT`, `PRODUCTION_ENABLED`, and
`PRODUCTION_CDP_CREDENTIALS_APPROVED` do **not** appear anywhere in the ADR's
text. They are defined and enforced in adjacent source
(`packages/protocol-x402/src/network/preproduction.ts`,
`apps/edge-api/src/control-plane/config/production-payment.ts`) that explicitly
invokes ADR-0055's authority and its ten bootstrap conditions, but they are
implementation-level gates, not ADR-0055 text itself. This distinction matters
for who may authorize each one and is preserved in the table below rather than
collapsed.

| Gate                                         | Exact semantic meaning                                                                                                                                                                                                              | Who may authorize                                         | Precondition/attestation                                                                                                | Reversible    | Effect of `true`        | Effect of `false`                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------------- | ----------------------------------------------------------------- |
| `PAYMENT_ENVIRONMENT=production`             | Explicit environment selector; fails closed to `preproduction` on anything but the exact literal `'production'` — never inferred from hostname, `NODE_ENV`, `ENVIRONMENT`, or secret presence                                       | Human operator (by project convention; not ADR-0055 text) | Human attestation                                                                                                       | YES (env var) | No effect alone (ANDed) | Forces preproduction unconditionally                              |
| `PRODUCTION_ENABLED=true`                    | "The standing, deliberately-set kill switch" (code doc)                                                                                                                                                                             | Human operator                                            | Human attestation                                                                                                       | YES           | No effect alone         | Production economically unreachable regardless of the other three |
| `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true` | ADR-0055's own per-action authorization: "explicitly authorized by the human owner/operator, in that exact session, for that exact action — not inferred, not assumed from a prior general instruction" (ADR condition 1, verbatim) | Human owner/operator, per-session, per-action             | Explicit human attestation (only gate ADR-0055 itself defines)                                                          | YES           | No effect alone         | Blocks production regardless of the other three                   |
| `PRODUCTION_CDP_CREDENTIALS_APPROVED=true`   | "Whether the CDP credentials currently configured have been explicitly approved for MAINNET use. Previously-exposed sandbox/testnet credentials never automatically satisfy this" (code doc, verbatim)                              | Human operator, credential-specific                       | Explicit human attestation — code doc is explicit that technical validity or prior sandbox exposure does not satisfy it | YES           | No effect alone         | Blocks production regardless of the other three                   |

```text
ADR0055_AUTHORITY_RESOLVED=YES
```

---

## 3. Mainnet network-selection proof

Traced `isProductionPaymentAuthorized`/`resolvePaymentNetwork`
(`packages/protocol-x402/src/network/preproduction.ts`) directly:

```text
MAINNET_SELECTION_BOOLEAN=
  input.environment === 'production'
  && input.productionEnabled === true
  && input.humanBootstrapAuthorized === true
  && input.productionCredentialsApproved === true
MAINNET_NETWORK=eip155:8453
NON_MAINNET_NETWORK=eip155:84532
```

Repo-wide search (`grep -rn "eip155:8453|PRODUCTION_NETWORK"`, excluding tests)
confirms the only place `PRODUCTION_NETWORK` is ever assigned/returned is
`resolvePaymentNetwork` itself. Every other reference either imports the
constant for an equality check (`chain-receipt-checker.ts` classifies an
already-known network) or is a comment. No independent code path can select Base
mainnet.

```text
MAINNET_SELECTION_AUTHORITY_RESOLVED=YES
```

---

## 4. Four distinct concepts, not collapsed

| Property                        |          Proven? | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                        | Can code prove it? |                                                                           Requires human attestation? |
| ------------------------------- | ---------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----------------: | ----------------------------------------------------------------------------------------------------: |
| A. Credential presence          |              YES | `wrangler secret list` shows `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` present (names only)                                                                                                                                                                                                                                                                                                                                         |                YES |                                                                                                    No |
| B. Syntactic validity           |              YES | `production-verify-v2-cdp-composition.ts` constructs `new CdpClient({apiKeyId, apiKeySecret})` and `createCdpFacilitatorClient` from these bindings without type/shape errors                                                                                                                                                                                                                                                   |                YES |                                                                                                    No |
| C. Technical mainnet capability | PARTIAL — see §7 | `evm.getAccount()` is network-agnostic (no `network` parameter in its own signature); CDP Secret API Keys are Project-scoped, not network-scoped (SDK/README never ties `apiKeyId`/`apiKeySecret` to a specific network — `network` is only a per-operation parameter on transfer/faucet/balance calls). Whether _this Project_ has mainnet enabled/limited at the CDP dashboard level is invisible to source or SDK inspection |     NO (not fully) | Effectively yes — only a live economic-capable call or the user's own dashboard knowledge resolves it |
| D. Human production approval    |               NO | No report, ADR, or config anywhere states "these exact credentials are approved for Base mainnet production use"                                                                                                                                                                                                                                                                                                                |                 NO |                                                                                                   YES |

---

## 5. Credential provenance — no values read

Resolved entirely from
`docs/reports/SUN-1200-checkpoint-e-credentials-disabled-deploy.md`
(already-accepted history) plus this session's own `wrangler secret list` (names
only, unchanged since):

```text
CDP_CREDENTIAL_PROVENANCE={
  key_id_secret_name_present: YES,
  secret_secret_name_present: YES,
  originally_provisioned_checkpoint: "SUN-1200 checkpoint E (2026-08-18)",
  original_declared_purpose: "user's own pre-existing CDP credentials, explicitly reused by
    user override rather than a fresh production-specific key ('im using same keys push im
    overriding this') — disclosed as a deviation from that checkpoint's own directive, not
    presented as a fresh mainnet-scoped provisioning",
  known_environment_scope: "the two CDP accounts resolved under this Project
    (0x516F57e1... / 0x7f44a2dd...) trace back to a real SANDBOX account pair used in an
    earlier accepted checkpoint's Base-Sepolia live-CDP proof (SUN-0700B) — same explicit
    disclosure recorded in checkpoint E",
  known_project_scope: "single CDP Project, confirmed via cdp.evm.listAccounts() returning
    exactly two accounts, both already known fixture constants (PAYER/SELLER)",
  provenance_confidence: HIGH
}
```

Checkpoint E already performed (by the user, in their own shell — this agent
never had or has credential values) two real, read-only CDP calls:
`listAccounts()` and `getAccount()` against
`0x7f44a2dd237938F18632d4CcA40f4c690295E6E1`, both succeeding and matching the
configured `SELLER_WALLET_ADDRESS`. That already establishes technical
authentication validity. It was never represented, then or since, as a mainnet
economic-capability or mainnet-approval proof.

```text
SECRET_VALUES_NEED_NOT_BE_READ=YES
```

No secret value was read, displayed, or logged at any point in this checkpoint.

---

## 6. Credential scope model

```text
CDP_CREDENTIAL_SCOPE_MODEL=
  Project-scoped Secret API Key (apiKeyId/apiKeySecret). The installed SDK never ties this
  credential pair to a specific network; `network` is a per-call parameter on
  transfer/faucet/listTokenBalances/etc., never a client-construction argument. The two SITEBORNE
  call sites (`evm.getAccount`, CDP x402 facilitator `.verify()`/`.settle()`) authenticate via
  apiKeyId/apiKeySecret only.
CDP_CREDENTIAL_NETWORK_RESTRICTION=
  Not restricted by SDK/credential type. The same Secret API Key can, in principle, authenticate
  calls against both Base Sepolia and Base mainnet if the underlying CDP Project has mainnet
  enabled. Whether this specific Project has mainnet enabled, and under what limits, is a CDP
  Portal/dashboard-level fact this repository's source cannot see and a read-only `getAccount`
  call would not reveal either (that call takes no network parameter and would succeed
  identically regardless of mainnet enablement).
CDP_CREDENTIAL_ENVIRONMENT_RESTRICTION=
  None enforced by the SDK. Environment separation in this repository is enforced entirely by
  SITEBORNE's own ADR-0055 gates and `resolvePaymentNetwork`, not by any CDP-side credential
  scoping.
```

---

## 7. What "credentials approved" must mean

`preproduction.ts`'s own doc comment is unambiguous and was treated as
authoritative rather than weakened:

```text
PRODUCTION_CDP_CREDENTIALS_APPROVED_MEANS=
  D — operator has reviewed and explicitly approved use of these exact credentials for
  SITEBORNE's production/Base-mainnet flow. Explicitly NOT satisfied by (A) mere presence,
  (B) successful authentication, or (C) technical mainnet capability alone — the source
  comment states this directly: "Previously-exposed sandbox/testnet credentials never
  automatically satisfy this."
```

---

## 8. Technical capability — proven vs. not, without a live call

```text
TECHNICALLY_PROVEN_WITHOUT_LIVE_CALL=[
  "getAuthenticatedSellerAddress is wired for real in production-verify-v2-cdp-composition.ts
   (buildCdpSellerAddressLookup + buildProductionCdpAccountLookupClientFactory) — confirmed by
   direct source read this checkpoint, correcting an earlier-session note that it was unwired;
   SUN-1218 checkpoint X wired it",
  "CdpClient construction is side-effect-free (no I/O) per SDK doc comment and existing
   accepted-checkpoint reconciliation",
  "evm.getAccount is a GET, read-only, no signing/creation/submission (source-level, reconfirmed
   §9 below)",
  "resolvePaymentAsset(network) derives the payment asset strictly from the resolved network, so
   a mainnet/asset mismatch is structurally impossible",
  "isProductionPaymentAuthorized is the sole gate for both network selection and evidence-mode
   selection — no bypass path exists"
]
CANNOT_BE_PROVEN_WITHOUT_LIVE_CALL=[
  "Whether the CDP Project currently has Base mainnet enabled/limited at the dashboard level",
  "Whether the API key itself is still valid/unrevoked at the moment a future candidate runs
   (checkpoint E's authentication proof is from 2026-08-18, not from today)",
  "Whether a real CDP facilitator .verify()/.settle() call would succeed on mainnet — untested by
   any accepted checkpoint at any network"
]
```

---

## 9. Seller-address lookup safety — reconfirmed

Re-read
`buildCdpSellerAddressLookup`/`buildProductionCdpAccountLookupClientFactory`
(`apps/edge-api/src/control-plane/config/production-payment.ts:216-266`)
directly:

```text
SELLER_ADDRESS_LOOKUP={
  method: "GET (client.evm.getAccount({address}))",
  path_shape: "/v2/evm/accounts/{address} (per SDK internal HTTP client)",
  read_only: YES,
  mutates_account: NO,
  creates_key: NO,
  signs_transaction: NO,
  submits_transaction: NO,
  economic_effect: NO
}
SELLER_ADDRESS_LOOKUP_SAFETY=READ_ONLY
```

---

## 10. Live call necessity — evaluated, not executed

```text
LIVE_CDP_CALL_REQUIRED_BEFORE_HUMAN_APPROVAL=NO
```

Reasoning: `getAccount()` cannot prove mainnet capability (§6/§8 — it takes no
network parameter), so performing it again would only re-prove what checkpoint E
already proved (authentication + address match). It would not resolve the actual
open question, which is provenance/authorization, not authentication.

### Options compared

**A — human approves existing credentials + four gates now; first authenticated
call happens in next 0%-candidate checkpoint.** Fastest. But the credential's
own documented provenance traces to a sandbox/testnet-proof account pair reused
by casual override, not a deliberate mainnet provisioning decision — approving
it now would satisfy the gate's _name_ without satisfying the gate's own
documented _meaning_ (§7, meaning D).

**B — separate one-call credential-validation micro-checkpoint before gate
authorization.** Adds no new information: the only available read-only call
(`getAccount`) was already run twice in checkpoint E and does not test mainnet
capability at all (§10 reasoning above). Recommending it again would create
audit noise without resolving the actual open question.

**C — provision separate, production-specific CDP credentials before
proceeding.** Slower (a new CDP Project or explicitly mainnet-designated key),
but produces exactly the artifact §7's "approved" meaning requires: a credential
the operator reviewed and designated for SITEBORNE production/mainnet from its
own provisioning, not a repurposed sandbox-proof pair. Clean audit separation;
the sandbox pair remains available for continued Base-Sepolia preproduction work
without ambiguity.

```text
RECOMMENDED_PATH=C
```

**Why not A:** ADR-0055 condition 1 requires authorization "not inferred, not
assumed from a prior general instruction." Checkpoint E's credential-reuse
override was a key-management convenience decision, explicitly disclosed as a
deviation from a _different_ directive (fresh production keys) — it was never
framed to the user as "these keys, used for real Base mainnet money." Asking for
that approval now, on a credential whose own provenance is documented as
sandbox-origin, risks exactly the provenance ambiguity ADR-0055 and this
checkpoint's own §19 stop condition warn against. **Why not B:** it does not
produce new evidence (§10). **Why C:** it is the only option that produces an
approval statement matching the gate's own documented meaning, at the cost of
one additional credential-provisioning step outside this checkpoint's mutation
boundary.

This is a recommendation, not a decision — §18 requires not choosing on speed
alone, and the actual choice belongs to the human operator.

---

## 11. Mainnet economic-semantics call graph

Starting at `isProductionPaymentAuthorized=true`:

| Step                                                                              | Classification                                                                            |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `resolvePaymentNetwork` → `eip155:8453`                                           | Immediate, read-only, no I/O                                                              |
| `resolveProductionCdpEvidenceProvider` gate #2 (`checkProductionBindingsPresent`) | Immediate, read-only, no I/O                                                              |
| gate #3 `getAuthenticatedSellerAddress()` → real `CdpClient.evm.getAccount()`     | **Live CDP call**, read-only, no economic effect                                          |
| gate #4 `assertSellerIdentityConsistent`                                          | Immediate, read-only, no I/O                                                              |
| `createCdpFacilitatorClient()` construction                                       | No I/O (construction only)                                                                |
| Route mounts with `evidenceMode: 'production'`                                    | Immediate — route becomes reachable                                                       |
| A real caller sends a request with valid payment material                         | **Requires a separate, later, explicit action** — never triggered by the four gates alone |
| `.verify()` / `.settle()`                                                         | Mutating, economic — only reachable via the step above                                    |

Setting the four gates causes exactly one live effect by itself once a request
reaches the route: one read-only CDP account lookup. It causes no settlement,
transaction, or economic effect on its own — but it does **authorize** all of
those for any subsequent request that supplies valid payment material, which is
the distinction §13 of the directive requires making explicit.

---

## 12. Decision matrix

| Question                                         | Answer                                                                              | Consequence                                                                                                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Existing CDP secret names present?               | YES                                                                                 | —                                                                                                                                                      |
| Proven intended for SITEBORNE?                   | YES (checkpoint E, seller address matches)                                          | —                                                                                                                                                      |
| Proven technically appropriate credential type?  | YES (Project-scoped Secret API Key, matches SDK's expected shape)                   | —                                                                                                                                                      |
| Proven Base-mainnet capable without live auth?   | NO — cannot be proven without a portal-level fact or an actual mainnet-capable call | Mainnet capability remains genuinely unknown                                                                                                           |
| Human approval currently documented?             | NO                                                                                  | Gate cannot truthfully be set today                                                                                                                    |
| Separate credential validation needed?           | NO (§10 — adds no information)                                                      | Skip option B                                                                                                                                          |
| Separate production credential recommended?      | YES                                                                                 | Recommend option C                                                                                                                                     |
| Safe to create mainnet-qualified candidate next? | NOT YET                                                                             | Requires either a §14-style explicit approval of existing credentials (accepting the provenance caveat) or fresh production-specific credentials first |

---

## 13. Draft future authorization packets (not executed)

### If the operator chooses Path A anyway

```text
AUTHORIZED_SOURCE_HEAD=c5c745ae439030da883cbb6a2e6a20c2d4f83813 (or later, if further commits land)
AUTHORIZED_CANDIDATE_ONLY_VARS=[
  PAID_ROUTES_ENABLED=true
  VERIFY_V2_CDP_ROUTE_ENABLED=true
  PAYMENT_ENVIRONMENT=production
  PRODUCTION_ENABLED=true
  HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true
  PRODUCTION_CDP_CREDENTIALS_APPROVED=true
]
AUTHORIZED_NETWORK=eip155:8453
AUTHORIZED_LIVE_CDP_READ_ONLY_LOOKUPS=1  (the seller getAccount() call, triggered by the first
  request that reaches the route with these gates set)
AUTHORIZED_VALID_PAYMENT_MATERIAL=NO
AUTHORIZED_SETTLEMENT=NO
AUTHORIZED_TRANSACTION=NO
AUTHORIZED_NORMAL_TRAFFIC_PERCENT=0
```

This packet, if authorized, is an explicit statement that the operator approves
the existing sandbox-provenance credentials for mainnet use, provenance caveat
and all.

### If the operator chooses Path C

No packet yet — the next checkpoint's scope would be limited to provisioning a
fresh, explicitly-designated production CDP credential pair (new
`wrangler secret put`, no other mutation), after which this same §13-A packet
would apply to the new credentials instead.

No packet for Path B is drafted — not recommended, and §10 already establishes
it would add no evidence.

---

## 14. Source-change classification

```text
RUNTIME_SOURCE_CHANGES_REQUIRED=NO
CONFIG_SOURCE_CHANGES_REQUIRED=NO
```

The seller-address lookup is already wired for real
(`production-verify-v2-cdp-composition.ts`, confirmed by direct source read this
checkpoint — SUN-1218 checkpoint X completed this wiring; an earlier note in
this session's condensed history describing it as unwired reflected a
pre-SUN-1218 state and is superseded here). No architectural blocker, ambiguous
network switch, or isolation gap was found. The four gates, if and when
authorized, require only env/secret changes at candidate-upload time — no code
change.

---

## 15. Production containment — final

```text
/health=200
/ready=200
12/12 paid REST routes=404 (reconfirmed with matching content-type/body)
SUN1219A_FINAL_PREFLIGHT=PASS (pnpm production:preflight, read live)
Final `wrangler deployments status`: single deployment, f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce @ 100%
```

---

## 16. Mutation accounting

```text
WORKER_VERSIONS_CREATED=0
DEPLOYMENTS=0
TRAFFIC_SHIFTS=0
PRODUCTION_SECRET_CHANGES=0
PRODUCTION_VAR_CHANGES=0
PRODUCTION_BINDING_CHANGES=0
LIVE_CDP_CALLS=0
LIVE_BASE_MAINNET_CALLS=0
REAL_PAYMENT_MATERIAL_SENT=NO
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECTS=0
SECRET_VALUES_NEED_NOT_BE_READ=YES (and none were read)
```

Every command run this checkpoint was read-only: `git`, `curl` against public
production endpoints, `wrangler deployments status`, `wrangler secret list`
(names only), `pnpm production:preflight`, and source/doc reads.

---

## 17. Addendum — Path C reversed by explicit operator attestation (post-commit)

After this report was committed (`b1de50159c0da28a59945c99ab084bb2c879453b`)
recommending Path C (provision fresh, explicitly production-designated CDP
credentials), the operator was asked directly whether to keep Path C or reverse
course and approve the existing sandbox-origin credential pair instead. The
operator selected:

```text
"Reverse to existing credentials — Explicitly approve the existing
sandbox-origin CDP_API_KEY_ID/SECRET for production/mainnet use, overriding
SUN-1219A's Path C recommendation, and record that reversal with reasoning."
```

This is recorded as the explicit human attestation ADR-0055 and
`PRODUCTION_CDP_CREDENTIALS_APPROVED`'s own code doc require — not inferred, not
assumed from credential presence or prior sandbox use. No reasoning beyond the
quoted decision was supplied by the operator; none is invented here.

```text
PRODUCTION_CDP_CREDENTIALS_APPROVED_GATE_AUTHORIZED=YES (as of this addendum)
ATTESTED_CREDENTIAL_PAIR=CDP_API_KEY_ID / CDP_API_KEY_SECRET (existing
  Cloudflare secrets; sandbox-Proof provenance per SUN-1200 checkpoint E,
  reused for production per that checkpoint's separate override)
FRESH_PRODUCTION_CREDENTIAL_PROVISIONING=NO LONGER REQUIRED (Path C superseded)
EXISTING_CDP_CREDENTIALS_PRODUCTION_APPROVED=YES (by this addendum's attestation)
```

**What this addendum does not do:** it does not itself set
`PRODUCTION_CDP_CREDENTIALS_APPROVED=true` (or any of the other three gates) in
any Worker version, `wrangler.toml`, or secret. No runtime or config mutation
occurred in this turn. Actually setting the four gates into a real, 0%-traffic
mainnet candidate — and reaching a genuine unpaid 402 boundary against Base
mainnet — requires its own bounded checkpoint (freeze, dry run, hard stop,
single authorized upload), following the same pattern SUN-1219 already
established, since it is the first checkpoint that would make a real live CDP
mainnet call.

```text
MAINNET_CANDIDATE_CREATION_ELIGIBLE=YES (attestation now on record for all
  four gates: PAYMENT_ENVIRONMENT, PRODUCTION_ENABLED,
  HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP already established in prior
  checkpoints' operator instructions; PRODUCTION_CDP_CREDENTIALS_APPROVED
  as of this addendum)
NEXT_CHECKPOINT_SCOPE=SUN-1219B — create and freeze a new immutable Worker
  candidate with all four ADR-0055 gates set, prove the real unpaid 402
  boundary against Base mainnet with at most one live read-only CDP call,
  send no valid payment material, restore known-good.
```

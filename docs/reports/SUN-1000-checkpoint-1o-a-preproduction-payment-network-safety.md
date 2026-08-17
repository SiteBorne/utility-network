# SUN-1000 Checkpoint 1O-A — Preproduction Payment-Network Safety Remediation

**Status:** Credential-free preproduction remediation. Zero provider calls, zero
payments, zero secret rotation by the agent, zero production mutation.

---

## 0. Economic-mutation safety rule

No provider mutation, payment, or economic action was performed or attempted
anywhere in this checkpoint. All work is source-code correction, static
inventory, and local test/negative-control evidence.

## 1. Freeze the 1O halt

`1O_STATUS = HALTED_PRE_PROVIDER_MUTATION`. Reason: `MAINNET_RISK` +
`CREDENTIAL_ROTATION_REQUIRES_USER_INTERACTION` +
`NEVERMINED_SANDBOX_CREDENTIAL_ABSENT`. Provider mutations performed before
halt: 0. Payments performed: 0. The blocker is the repository's own
payment-network configuration, not the `cdp` CLI's unrelated `live` environment
label (confirmed below).

## 2. Baseline

`git status --short` empty, HEAD `0f8c7fc` confirmed before any edit. Full
credential-free regression re-run and green: Load PASS 7/7, Chaos PASS 18/18,
Schemathesis PASS, Semgrep 0 findings, OSV CRITICAL=0, Trivy unchanged
(`BLOCKED_EXTERNAL`, HIGH=3), x402/Nevermined(155)/MCP/A2A all PASS,
governance/state/tasks validate 77/30/252, secrets:scan clean, full `pnpm check`
exit 0.

## 3. Network source-of-truth inventory

Searched every first-party file (excluding `node_modules`, `security/output`)
for `eip155:8453`/`eip155:84532`/`base-mainnet`/`base-sepolia`. Classified:

| Site                                                                                                          | Classification                                                                                                                                                                        | Value found                                                                                         |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `apps/edge-api/src/control-plane/routes/paid-services.ts` `v2CdpRoute()` (all 4 live v2 routes)               | `PAYMENT_EXECUTING`                                                                                                                                                                   | `eip155:8453` (mainnet) — **defect**                                                                |
| `apps/edge-api/src/control-plane/routes/paid-services.ts` `paymentRoute()` CDP branch (v1)                    | `PAYMENT_EXECUTING`                                                                                                                                                                   | `eip155:8453` (mainnet) — **defect**                                                                |
| `packages/protocol-x402/src/bazaar/discovery.ts` `BAZAAR_PAYMENT_POLICY` (8 entries, v1+v2)                   | `BAZAAR_DISCOVERY`                                                                                                                                                                    | `eip155:8453` (mainnet) — **defect**                                                                |
| `apps/edge-api/src/routes/mcp.ts` quote metadata                                                              | `MCP_METADATA`                                                                                                                                                                        | `eip155:84532` (correct network) but asset address off by one hex character — **separate defect**   |
| `apps/edge-api/tests/live/x402-live-exact.test.ts` / `x402-live-upto.test.ts` / 7 Nevermined live-proof files | `HISTORICAL_FROZEN_EVIDENCE` (SUN-0700B/SUN-0900B accepted checkpoints)                                                                                                               | `eip155:84532`, deliberately hardcoded, bypasses `paid-services.ts` entirely                        |
| `apps/edge-api/tests/*.test.ts` (chaos, d1, evidence-boundary, nevermined-provider, x402-service-route, etc.) | mix of `TEST_FIXTURE` (standalone route/input construction, unrelated to `paid-services.ts`) and one real `PAYMENT_CHALLENGE` assertion (`chaos-v2.test.ts` `MODEL_D_RAIL_ISOLATION`) | see §6 below                                                                                        |
| `contracts/releases/*/schemas/common/money.schema.json`, `packages/contracts/generated/**`                    | `DOCUMENTATION`/`OTHER`                                                                                                                                                               | free-text `type: string` field with illustrative example values only, no enum, no enforced chain ID |
| `docs/reports/*.md`, `docs/operations/PAYMENT_QUOTES.md`, `security/chaos/CHAOS_MATRIX.md`                    | `HISTORICAL_FROZEN_EVIDENCE`/`DOCUMENTATION`                                                                                                                                          | unchanged, not rewritten                                                                            |

No mechanical string replacement was performed anywhere; every site was read and
classified individually before any edit.

## 4. Intended preproduction network

```
PREPRODUCTION_NETWORK   Base Sepolia
CHAIN_ID                84532
CAIP2_ID                eip155:84532
USDC_ADDRESS            0x036CbD53842c5426634e7929541eC2318f3dCF7e
PRODUCTION_NETWORK       Base mainnet
PRODUCTION_CAIP2_ID      eip155:8453
```

`docs/decisions/0054-buyer-surface-specific-payment-rails.md` confirms the
project's own frozen intent directly: "SITEBORNE already has accepted CDP-backed
Base Sepolia `exact` and `upto`." The USDC address was **not** inferred from
memory — it is read directly from the official `@x402/evm` SDK's own
`defaultAssets` table (`getDefaultAsset('eip155:84532').address`), which is also
the exact literal every accepted live-proof test file already independently
hardcodes (7 occurrences across 6 files, all agreeing).

## 5. Hard compatibility gate

Read the actual frozen schema text directly rather than guessing.
`contracts/releases/2.0.0/schemas/common/money.schema.json`'s `network` field
and `contracts/releases/2.0.0/openapi/common-components.json`'s
`payment_network` field are both `"type": "string"` with only a generic
`"pattern": "^[a-z0-9-]+$"` constraint — **no enum pins a specific chain value
anywhere in the frozen, versioned contract surface**, at any release
(1.0.0/1.0.1/2.0.0 all checked identically). `packages/contracts/generated/**`
contains zero literal `eip155:*` values.

**Conclusion: `NO_RELEASE_VERSION_CHANGE` required.** This is a pure
runtime/application correction, not a contract-schema change — confirmed
empirically after the edit too: `pnpm contracts:baseline:verify`,
`contracts:compat:check`, and `contracts:release:verify` all passed cleanly
post-correction, with zero drift detected. No `.v3`, no PCC bump, no contract
release event.

## 6. Root cause of the mainnet pin

`git log -p` on `paid-services.ts` traces `network: 'eip155:8453'` back to the
very first v1 wiring commit (`e363128`, "feat(x402): wire local paid service
http flow") — **`PREEXISTING_V1_MAINNET_DEFAULT`**, not a v2-specific
regression. v2's `v2CdpRoute()` (checkpoint 1M, `06ddd4b`) carried it forward
unchanged under the accepted `SAME_ECONOMICS_NEW_SERVICE_MAJOR` policy, which
correctly copied v1's _economics_ but also silently copied this pre-existing
network defect along with it.

**Why no live-proof checkpoint ever caught this:** the only test file that has
ever called a real CDP facilitator
(`apps/edge-api/tests/live/x402-live-exact.test.ts`, SUN-0700B checkpoint 1)
contains this exact comment: _"this test mounts its own routes on a bare Hono
app with real testnet network/asset/payTo, never the mainnet-labeled placeholder
wiring in paid-services.ts."_ The original checkpoint author(s) knew the field
was mainnet-labeled and deliberately built a parallel, Sepolia-only route to
work around it for the live proof — rather than correcting it at the source.
This checkpoint corrects it at the source instead.

**A real, independent risk this created:** since `evidenceMode` is hardcoded
`'fixture'` at the only place `buildPaidServicesApp` is currently mounted
(`index.ts`), no real settlement can occur through the live-mounted route today
— but the 402 challenge's declared `network` field is exactly what an autonomous
buyer's client SDK would use to construct a real on-chain payment. A real buyer
sending real Base mainnet USDC against a system whose evidence verification is
fixture-mode (never validates a real on-chain transaction) is a genuine
potential-loss scenario if `SELLER_WALLET_ADDRESS` were ever configured,
independent of whether `production_enabled` is `true`.

## 7. Canonical network source of truth introduced

New file `packages/protocol-x402/src/network/preproduction.ts` (barrel- exported
from the package index, following the exact pattern already established by
`network/schemes.ts`):

```ts
export const PREPRODUCTION_NETWORK: Network = 'eip155:84532';
export const PRODUCTION_NETWORK: Network = 'eip155:8453';
export function assertPreproductionNetwork(
  network: Network,
  productionNetworkAuthorized = false
): void {
  /* throws unless network is preproduction OR the flag is explicitly true */
}
```

No new dependency was added to `packages/protocol-x402` (it bundles into
`protocol-mcp`'s 2.3MB MCP server, and `@x402/evm` — which bundles
`viem`-adjacent EVM tooling per ADR 0041's own established precedent — would
have grown that bundle unnecessarily). `discovery.ts` (Bazaar, protocol-x402)
imports only the network constant. `paid-services.ts` and `mcp.ts`
(apps/edge-api, where `@x402/evm` was already a dependency) import the constant
**and** call the official SDK's `getDefaultAsset()` for the real asset address,
eliminating hand-typed addresses as a defect class entirely.

## 8. Mainnet fail-closed guard

`assertPreproductionNetwork()` is not just defined — it is **wired directly into
both CDP route-construction call sites** (`paymentRoute()`'s CDP branch and
`v2CdpRoute()`), called at app-construction time, before any route is reachable.
Any future edit that reintroduces `eip155:8453` at either site without the
explicit `productionNetworkAuthorized: true` flag (which nothing in this
repository sets) throws immediately — proven in §16 below.

## 9. v2 CDP routes

All four v2 services (`company_evidence_graph.v2`, `web_context_verified.v2`,
`document_evidence_json.v2`, `verify_agent_output.v2`) go through
`v2CdpRoute()`, corrected as one change. Verified via the new
`network-metadata-consistency.test.ts` (§17) that all four now declare
`eip155:84532`.

## 10. v1 runtime handling

v1's CDP branch (`paymentRoute()`, same function, same fix applied
simultaneously — not a separate v1-specific mutation) is corrected identically.
No frozen historical release artifact (`contracts/releases/1.0.0`, `1.0.1`,
`2.0.0`) was touched — confirmed via
`git status --short contracts/ schemas/ packages/contracts/generated/` returning
empty throughout, and via §5's post-edit compat/baseline/release verification
passing with zero drift.

## 11. Bazaar / discovery network

All 8 entries in `BAZAAR_PAYMENT_POLICY` (4 v1 + 4 v2) now reference the same
`PREPRODUCTION_NETWORK` constant `paid-services.ts` uses — no independent
literal that merely happened to agree. The pre-existing `asset: '0xUSDC'`
placeholder in this table is unchanged (a documentation- grade metadata table,
not itself payment-executing — a real buyer's actual payment always uses the
real 402 challenge from the live route, which now carries the real official-SDK
asset address). Disclosed, not silently left unmentioned: this placeholder is
out of scope for a network-safety remediation checkpoint.

## 12. MCP/A2A network consistency

`mcp.ts`'s quote metadata now imports the same `PREPRODUCTION_NETWORK` constant
and calls the same official `getDefaultAsset()` rather than hand-typing its own
values — which is how a second, independent, genuine defect was found and fixed:
`mcp.ts`'s hardcoded USDC address (`...dCF7c`) was off by one hex character from
the real, accepted Base Sepolia USDC contract address (`...dCF7e`) every
live-proof test uses (7 independent occurrences across 6 files, confirmed via
the official SDK's own asset table). A2A: searched `packages/protocol-a2a/src`
and the A2A route directly — no independent network/asset declaration exists
there at all; nothing to reconcile.

## 13. Network/asset pair consistency

`CDP_PREPRODUCTION_ASSET = getDefaultAsset(PREPRODUCTION_NETWORK).address` is
computed once, from the official SDK, and reused at every payment-
executing/MCP-metadata call site — structurally impossible for a Sepolia network
to pair with a mainnet (or any other network's) asset address, since there is
exactly one source for both values together. Proven by a dedicated consistency
test (§17) rather than a hand-maintained assertion list.

## 14. Nevermined environment-variable reconciliation

Investigated directly rather than accepting the claim at face value.
`packages/protocol-nevermined/src/config.ts`'s `resolveNeverminedConfig` — a
"pure configuration boundary" that "never reads `process.env` itself" —
**already correctly** treats `NVM_API_KEY` as canonical and `NEVERMINED_API_KEY`
as a `deprecated_alias` (with conflict detection if both are set and disagree),
and already requires `NVM_ENVIRONMENT` to be exactly `'sandbox'` (`'live'` is
explicitly hard-rejected: `code: 'live_environment_disabled'`).
`apps/edge-api/tests/live/ nevermined-*.test.ts` module comments independently
confirm `NVM_API_KEY` as the intended real name.

**The actual regression**, confirmed by direct inspection:
`resolveNeverminedConfig` is defined and unit-tested but was **never called
anywhere in first-party edge-api runtime code** —
`apps/edge-api/src/control-plane/config/env.ts`'s `Env` interface and
`validateProductionBindings()` referenced only the deprecated
`NEVERMINED_API_KEY` name, as if it were canonical, with no
`NVM_API_KEY`/`NVM_ENVIRONMENT` fields at all. This is a genuine disconnect
between a correctly-designed boundary and the runtime surface meant to
eventually use it — not something to work around by provisioning a new
credential under the stale name.

**Fix:** `Env` now declares `NVM_API_KEY?`/`NVM_ENVIRONMENT?` as the canonical
fields and `NEVERMINED_API_KEY?` as the documented deprecated alias (all three
optional at the type level, matching `resolveNeverminedConfig`'s own
either-name-accepted runtime semantics). `validateProductionBindings()` now
accepts either `NVM_API_KEY` or `NEVERMINED_API_KEY` (mirroring
`resolveNeverminedConfig`'s logic) instead of requiring the stale name
specifically. 5 new self-tests (`env-nevermined-credential.test.ts`) prove:
canonical alone works, deprecated alias alone works, both-matching works,
neither present fails closed naming `NVM_API_KEY`, and no new credential under
the stale name is ever required. **No new live-call wiring was added** —
`resolveNeverminedConfig` is still not invoked by any runtime construction path;
connecting it is Phase-2/1O provider-construction work, correctly out of this
credential-free checkpoint's scope.

## 15. Nevermined sandbox fail-closed

Already correctly enforced by the pre-existing `resolveNeverminedConfig` (§14) —
`NVM_ENVIRONMENT !== 'sandbox'` is rejected (`invalid_environment`), and
`NVM_ENVIRONMENT === 'live'` is explicitly, separately rejected
(`live_environment_disabled`) rather than merely falling through the generic
invalid-value check. No new code needed; confirmed via the existing
`protocol-nevermined/src/config.test.ts` suite (unaffected, still passing).

## 16. Production-mainnet negative control

Temporarily changed `v2CdpRoute()`'s `network` to `PRODUCTION_NETWORK` (no
authorization flag) — a real, temporary source mutation, not a simulated
scenario. Result: `buildPaidServicesApp` itself threw
(`preproduction_mainnet_guard: network "eip155:8453" (Base mainnet) requires explicit productionNetworkAuthorized=true`)
— every one of `x402-service-route.test.ts`'s 30 tests failed/skipped, since app
construction is a shared `beforeAll` step. This proves mainnet cannot silently
enter a preproduction payment path — the guard fires before any route is even
reachable, not merely on a specific request. Restored exactly
(`diff`/`md5`-confirmed byte-identical); re-ran — clean 30/30 pass.

## 17. Network/metadata consistency negative control

New file `apps/edge-api/tests/network-metadata-consistency.test.ts`: for each of
the 4 v2 services, fetches a real 402 challenge from a real
`buildPaidServicesApp` instance and compares its `network` against the network
in a real `buildSiteborneDiscoveryDeclaration()` build for the same service —
both real, live-constructed values, never hand-typed expectations. Negative
control: temporarily mismatched `company_evidence_graph.v2`'s Bazaar policy
entry to `eip155:8453` while its real route stayed Sepolia. Result: exactly that
one test failed (`expected 'eip155:84532' to be 'eip155:8453'`), the other 3
correctly passed. Restored exactly (`diff`-confirmed byte-identical); re-ran —
clean 4/4 pass.

## 18. No external mutations

CDP API calls: 0. CDP transactions: 0. Nevermined API calls: 0. Nevermined
registrations: 0. Nevermined settlements: 0. Live payments: 0. Credential
rotations by agent: 0. DNS: 0. Deployment: 0. Publication: 0.

## 19. Regression

`pnpm security:load`: PASS 7/7. `pnpm security:chaos`: PASS 18/18
(`chaos-v2.test.ts`'s `MODEL_D_RAIL_ISOLATION` assertion updated to the
corrected network — the rail-isolation claim itself is proven by
`payment_rail === 'cdp'` read back from D1, independent of the network value,
and remains true). `pnpm security:schemathesis`: PASS, unchanged.
`pnpm security:semgrep`: PASS, 0 findings. `pnpm security:osv`: PASS,
CRITICAL=0. `pnpm security:trivy`: unchanged, `BLOCKED_EXTERNAL`, HIGH=3.
`pnpm x402:check`, `pnpm nevermined:check` (155/155), `pnpm mcp:check`,
`pnpm a2a:check` — all PASS. `pnpm governance:validate` (77/77),
`pnpm state:validate` (30/30), `pnpm tasks:validate` (252/252),
`pnpm secrets:scan` clean. Full monorepo `apps/edge-api` +
`packages/protocol-{x402,nevermined,mcp,a2a}` test sweep: **98 files passed, 12
skipped (live-only, correctly gated), 1190 tests passed, 18 skipped, 0 failed.**
Full **`pnpm check`** — exit 0, including
`contracts:baseline:verify`/`contracts:compat:check`/ `contracts:release:verify`
all clean (zero drift, confirming §5).

## 20. Prerequisites for resuming 1O

1. **CDP credentials**: rotate `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`/
   `CDP_WALLET_SECRET` via the Coinbase Developer Platform Portal (confirmed: no
   programmatic rotation exists in the installed SDK/CLI). Store replacements
   only in the local secure secret store. Never paste into chat or agent
   transcript.
2. **Nevermined credential**: obtain a sandbox key and store it as `NVM_API_KEY`
   (canonical, now correctly wired end-to-end at the config- surface level) with
   `NVM_ENVIRONMENT=sandbox`. Do not provision under `NEVERMINED_API_KEY` merely
   for compatibility — it is accepted, but `NVM_API_KEY` is the intended name
   going forward.
3. **This checkpoint's own correction must remain in place**: 1O should build on
   top of the now-corrected `PREPRODUCTION_NETWORK`/
   `assertPreproductionNetwork` machinery, not reintroduce `eip155:8453`
   anywhere.
4. Only after both credential classes are in place, `pnpm check` still passes,
   and this checkpoint's fail-closed guard remains intact, is 1O safe to resume.

# SUN-1218 — Production Payment-Evidence Trust Closure + Verify v2/CDP Single-Route Activation: Design

Status: **design complete, awaiting explicit approval.** No implementation has
begun.

## 1. Current `synthetic_fixture` behavior — traced literally

```
DEFINED_AT   = packages/protocol-x402/src/evidence/types.ts (EvidenceTrustClass union, 4th member)
CREATED_BY   = packages/protocol-x402/src/evidence/fixtures.ts
               (syntheticVerificationEvidenceSuccess/Rejected,
               syntheticSettlementEvidenceSuccess/Failed), invoked only by
               FixturePaymentEvidenceProvider (provider.ts:168-183)
CONSUMED_BY  = packages/protocol-x402/src/evidence/verification.ts's canAdvanceToVerified
               and settlement.ts's canAdvanceToSettled — both call
               isTrustClassAllowed(evidence.trust_class, mode) as the one
               gate before a state-machine transition is permitted
PERSISTED_IN = apps/edge-api/src/control-plane/routes/x402-service.ts's
               CdpSettlementPendingDraft/PendingNeverminedSettlementDraft
               (durable, written to x402_service_results BEFORE the real
               settle() call, for crash recovery — never inside the signed
               PCC receipt itself)
TRUST_CLASS  = 'synthetic_fixture' (one of 4: synthetic_fixture,
               locally_derived_structure_only, external_unverified,
               external_verified)
MODE         = 'fixture' (PaymentEvidenceMode — the other value is
               'production')
PRODUCTION_REACHABLE = YES — via the verify_agent_output.v2/CDP composition
               (apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.ts),
               reachable from the real Worker bundle since SUN-1216, but
               ONLY when `PAID_ROUTES_ENABLED=true` (currently unset in
               real production — SUN1218_START_PREFLIGHT confirms this
               live, §2 below)
```

```
WHAT_IS_SYNTHETIC = the claim that a facilitator verified/settled a
  payment. FixturePaymentEvidenceProvider.verify()/settle() never call
  any real facilitator, network, or chain — they synchronously fabricate
  a { verified: true }/{ success: true } response locally, unconditionally.
WHAT_REAL_INPUT_EXISTS = a real, signed PAYMENT-SIGNATURE header the
  buyer submitted (structurally validated against the quote/requirement
  binding before evidence acquisition is even reached), real D1 state,
  a real quote_id/requirement_id/payment_identifier.
WHAT_INFORMATION_IS_MISSING = confirmation from an actual payment rail
  (CDP facilitator) that the signed payload is cryptographically valid
  and that a real on-chain (or rail-native) settlement occurred. Nothing
  about *whose* signature it is, or whether funds moved, is ever checked
  in fixture mode.
WHY_DOES_FALLBACK_EXIST = FixturePaymentEvidenceProvider is this
  package's only implementation and is what every local test, workerd
  qualification run, and SUN-1214-1217's own real-composition proofs
  have used since SUN-0700A — a deliberate, disclosed, test-only rail so
  the rest of the x402 lifecycle (challenge, idempotency, receipt
  signing, durable persistence, audit) could be built and proven without
  a live payment-rail dependency. It was never meant to be reachable
  from real Cloudflare production traffic with the paid gate enabled;
  SUN-1216 is the first checkpoint that made it reachable at all,
  because SUN-1216's approved scope explicitly excluded closing this gap.
```

This is not "just metadata" and it is not "fixture execution" in the sense of
running a stubbed/fake service — the underlying `verify_agent_output.v2` service
execution, comparison logic, and Ed25519 receipt signature are 100% real
(`execution_mode: 'live'`, the real production signer) regardless of evidence
mode. What is fabricated is narrowly the **payment-evidence layer**: the proof
that the buyer actually paid. The real, literal risk this checkpoint closes is:

> With `PAID_ROUTES_ENABLED=true` and nothing else changed, any caller
> submitting a structurally well-formed but otherwise arbitrary
> PAYMENT-SIGNATURE header receives a real service execution and a real,
> validly-signed SITEBORNE receipt, with zero real payment-rail verification
> ever performed — free, indistinguishable-from-genuine receipts, not a
> real-money theft (no real facilitator/chain call ever happens in fixture mode,
> so no real funds can move either direction).

## 2. Starting-state verification

```
START_HEAD = 0de7946a836c10fda5fd1585e28bde4f78813601
WORKING_TREE = CLEAN
CURRENT_PRODUCTION_VERSION = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CURRENT_PRODUCTION_TRAFFIC = 100%
GET /health = 200, GET /ready = 200, GET /mcp = 405
12/12 paid REST routes = 404 (live-checked)
SUN1218_START_PREFLIGHT = PASS
```

## 3. Governing payment-evidence contract

```
PaymentEvidenceMode        packages/protocol-x402/src/evidence/policy.ts
                            'fixture' | 'production'
isTrustClassAllowed(trust, mode)
                            fixture   -> { synthetic_fixture, locally_derived_structure_only }
                            production -> { external_verified }   (ONLY)
```

| Evidence source/type                                                                                             | Trust class                      |                       Sandbox (`fixture`) allowed | Production allowed |                                                                     Synthetic? |                                       Durable? |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------: | -----------------: | -----------------------------------------------------------------------------: | ---------------------------------------------: |
| `FixturePaymentEvidenceProvider`                                                                                 | `synthetic_fixture`              |                                               YES |             **NO** |                                                         YES (fully fabricated) | YES (settlement draft only, never the receipt) |
| (theoretical, unused today) locally-derived structural check                                                     | `locally_derived_structure_only` |                                               YES |             **NO** |                        Partially (real structural facts, no rail confirmation) |                 N/A — no implementation exists |
| Real facilitator `/verify`/`/settle` response, transport failed but facilitator answered with a structured error | `external_verified`              | not applicable (fixture mode never produces this) |                YES |                                                                             NO |                                            YES |
| Real facilitator `/verify`/`/settle`, transport/timeout failure, facilitator never answered                      | `external_unverified`            |                                    not applicable |             **NO** | NO (real attempt, ambiguous outcome — not synthetic, but not confirmed either) |                                            YES |

`isTrustClassAllowed` and `canAdvanceToVerified`/`canAdvanceToSettled` are
frozen, unmodified since SUN-0700A/SUN-0700B and are **not touched by this
design** — they already correctly express the invariant this checkpoint needs;
the gap is entirely in what `evidenceMode`/provider gets constructed and handed
to them, not in the gate itself.

```
PRODUCTION_PAYMENT_EVIDENCE_REQUIREMENTS_RESOLVED = YES
```

No `CONTRACT_AMBIGUOUS` finding — the policy is explicit and unambiguous.

## 4. The real production evidence source already exists

Traced `apps/edge-api/src/control-plane/evidence/cdp-provider.ts`'s
`CdpPaymentEvidenceProvider` (built SUN-0700B checkpoint 1, never wired to any
reachable composition until now): `providerKind: 'external'`, calls the real CDP
facilitator's `/verify` and `/settle` via the existing `HTTPFacilitatorClient`,
returns `trust_class: 'external_verified'` on a genuine facilitator answer
(success or a structured rejection) and `'external_unverified'` only on
transport/timeout failure (the facilitator never answered at all). This is a
**complete, already-implemented, already-tested production evidence provider** —
SUN-1218 does not need to build a new one.

`resolvePaymentEvidenceProvider(mode, provider)`
(`packages/protocol-x402/src/evidence/provider.ts:212`) already enforces:
`mode === 'production'` requires `provider.providerKind === 'external'` or
throws `ProductionEvidenceProviderNotConfiguredError` — a second, independent,
frozen gate on top of the trust-class check in §3.

**The one missing piece**, confirmed by direct trace of every call site
(`grep -rn getAuthenticatedSellerAddress`, zero implementations found anywhere):
`resolveProductionCdpEvidenceProvider`
(`apps/edge-api/src/control-plane/config/production-payment.ts:311-345`)
requires FOUR conditions before it will ever select the real
`CdpPaymentEvidenceProvider` instead of falling back to
`{evidenceMode: 'fixture'}`:

1. `isProductionPaymentAuthorized` — all 4 ADR-0055 booleans true
   (`PAYMENT_ENVIRONMENT=production`, `PRODUCTION_ENABLED=true`,
   `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true`,
   `PRODUCTION_CDP_CREDENTIALS_APPROVED=true`) — **none currently set**.
2. `checkProductionBindingsPresent` — `SELLER_WALLET_ADDRESS`/
   `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` present — **already true** in real
   production (`SELLER_WALLET_ADDRESS` is a committed `[vars]` value; the two
   CDP secrets are already-provisioned real Cloudflare secrets since before
   SUN-1215).
3. `deps.getAuthenticatedSellerAddress` supplied and resolves — **never
   implemented anywhere in this repository.**
4. The resolved address matches the configured `SELLER_WALLET_ADDRESS`
   (`assertSellerIdentityConsistent`) — depends on #3.

Traced the `@coinbase/cdp-sdk` (already a real dependency, `v1.55.0`, already
bundled and dry-run-hash-clean since SUN-1216) for a real, read-only
implementation of #3:
`CdpClient({ apiKeyId, apiKeySecret }).evm.getAccount({ address })`
(`GetServerAccountOptions.address?: Address`, confirmed in
`src/client/evm/evm.types.ts:426`) resolves a real CDP-custodied EVM account
**by its public address**, authenticated with only
`CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` (the CDP SDK's own doc comment, matching
`env.ts`'s pre-existing SUN-1200 reconciliation note: "Wallet Secret
authenticates only POST/DELETE ... this repository's two real CDP call sites ...
need neither"). No new secret, no new binding, no Wallet Secret provisioning
required — this is a genuinely **zero-new-credential** closure of gate #3.

## 5. Production trust rule and settlement/evidence lifecycle

Traced the actual request order in `x402-service.ts` (not the conceptual list):
challenge issuance → payment presentation → structural signature/binding
validation → **service execution + PCC receipt signing (`outcome.result`, real
signer, real signature) happens here, before any evidence acquisition** →
`evidenceProvider.verify()` → `canAdvanceToVerified` gate → (durable
`createPending` write — pre-settle draft, crash-safety, written BEFORE
`evidenceProvider.settle()` is ever called) → `evidenceProvider.settle()` →
`canAdvanceToSettled` gate → final response.

| Transition                                         | Durable state                         | Economic effect                                                                                                                                                          | Evidence available                | Retry safe                                                                                                                            | Crash recovery                                                                                                                                                                                                                                          |
| -------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Challenge issued                                   | quote row (D1)                        | none                                                                                                                                                                     | none                              | YES (idempotent quote)                                                                                                                | re-issue                                                                                                                                                                                                                                                |
| Payment presented, structurally validated          | payment_attempts row                  | none                                                                                                                                                                     | none                              | YES                                                                                                                                   | reject malformed                                                                                                                                                                                                                                        |
| Service executed, receipt signed                   | none yet (in-memory `outcome.result`) | none (no money touched)                                                                                                                                                  | none                              | N/A (deterministic re-run possible)                                                                                                   | re-run on retry before persistence                                                                                                                                                                                                                      |
| `verify()` called, `canAdvanceToVerified`          | payment_attempts transition           | none (verify never moves funds)                                                                                                                                          | verification evidence (in-memory) | YES, structurally rejected before durable write                                                                                       | reject, no state change                                                                                                                                                                                                                                 |
| Pre-settle durable draft written (`createPending`) | `x402_service_results` (pending)      | none yet                                                                                                                                                                 | verification evidence hash bound  | YES — write failure returns 500 **before** `settle()` is ever called (proven by an existing test asserting settle-call-count stays 0) | safe: no settle attempted                                                                                                                                                                                                                               |
| `settle()` called, `canAdvanceToSettled`           | —                                     | **real economic effect only in `production` mode with a real facilitator** (fixture mode: none, ever — no network/chain call exists in `FixturePaymentEvidenceProvider`) | settlement evidence               | crash-after-settle-call is the risk window                                                                                            | `REFUND_REQUIRED` transition on gate rejection; SUN-0900B checkpoint 1B's own rule: once `settle()` was actually invoked, a local inability to positively validate its response is never proof the settlement failed — reconciliation, not blind refund |
| Success response                                   | `x402_service_results` finalized      | done                                                                                                                                                                     | done                              | duplicate request → idempotent same result (existing machinery)                                                                       | N/A                                                                                                                                                                                                                                                     |

```
CAN_SETTLEMENT_SUCCEED_BEFORE_PRODUCTION_EVIDENCE_EXISTS = NO
```

The durable pre-settle draft is written and the settlement trust-class gate is
evaluated **before** any response is returned as a success — the existing
architecture already refuses to finalize a result as successfully evidenced
without gate approval. This machinery is frozen and untouched by this design.

## 6. Evidence acquisition failure matrix

| Scenario                                                  | Economic state                           | Durable state                                                                                                                                                                                               | Client result                                                                                                           | Retry behavior                                                                                                                                                              | Duplicate-settlement risk                                                             | Recovery path                               |
| --------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------- |
| Provider evidence absent (verify)                         | none                                     | payment_attempts stays pre-verify                                                                                                                                                                           | 402/400 (existing)                                                                                                      | retry re-verifies                                                                                                                                                           | none                                                                                  | none needed                                 |
| Provider malformed response                               | none                                     | none                                                                                                                                                                                                        | rejected at `validateVerificationEvidence`/`validateSettlementEvidenceStructureAndBinding`                              | retry allowed                                                                                                                                                               | none                                                                                  | none needed                                 |
| Provider timeout (verify)                                 | none                                     | none                                                                                                                                                                                                        | rejected — real facilitator, no answer, `external_unverified` never satisfies `canAdvanceToVerified` in production mode | retry re-verifies                                                                                                                                                           | none                                                                                  | none needed                                 |
| Provider verification failure (real rejection)            | none                                     | payment_attempts REJECTED                                                                                                                                                                                   | 402                                                                                                                     | new payment required                                                                                                                                                        | none                                                                                  | none needed                                 |
| Settlement succeeds (rail) but evidence persistence fails | **real settlement may have occurred**    | `settlement_pending_persist_failed` is impossible post-settle (pre-settle draft already committed, proven, §5) — the only persistence-failure window is the pre-settle write, which happens BEFORE settle() | 500 `repository_failure`, settle never reached                                                                          | caller may retry — existing idempotency on `payment_identifier` prevents duplicate settle                                                                                   | none (settle physically never called)                                                 | none needed                                 |
| Evidence received but audit persistence fails             | possible real settlement                 | inconsistent audit trail (existing gap, not created by this design)                                                                                                                                         | existing behavior, unchanged by this design                                                                             | existing behavior                                                                                                                                                           | existing, pre-existing risk class, out of this checkpoint's scope                     | existing reconciliation tooling (SUN-0900B) |
| Duplicate/retry (same `payment_identifier`)               | none (real settle already occurred once) | idempotent lookup                                                                                                                                                                                           | same cached result                                                                                                      | no re-execution (existing, proven machinery)                                                                                                                                | none                                                                                  | N/A                                         |
| Post-settlement crash                                     | real settlement occurred                 | pre-settle draft present, final write may be missing                                                                                                                                                        | client sees timeout/no response                                                                                         | client retry hits idempotency layer or existing crash-recovery reconciliation (SUN-0900B checkpoint 1B, CDP-rail equivalent already exists per `CdpSettlementPendingDraft`) | none — real facilitator settle is itself idempotent per its own transaction semantics | existing recovery machinery, unmodified     |

None of this row set requires new recovery machinery — the pre-settle durable
draft + trust-class gate ordering that already exists for BOTH rails (Nevermined
and CDP, since SUN-1200 checkpoint C) already provides the safe failure/recovery
property this checkpoint's §7-9 asks for. This design adds **zero new
crash-recovery code.**

## 7. Selected architecture: Approach A (production provider only, no production fallback) — with one addition

Evaluated against Approach A/B/C (§10 below has the full comparison).
**Recommended: Approach A**, plus one necessary strengthening the directive
itself anticipated (§10's own framing: "prefer the architecture that makes the
unsafe state hardest to represent").

The frozen trust-class gate (§3) and the frozen `resolvePaymentEvidenceProvider`
gate (§4) already make it **structurally impossible** for `synthetic_fixture`
evidence to satisfy `canAdvanceToVerified`/`canAdvanceToSettled` when
`mode === 'production'`. That half of Approach A is **already true today,
unconditionally, with zero new code** — this is a discovery, not a design
decision.

The actual gap is one level up: `resolveProductionCdpEvidenceProvider`'s own
fallback-to-`{evidenceMode: 'fixture'}` is **unconditional** — it falls back the
same way whether the caller is a local test, a workerd qualification run, or the
real Cloudflare production Worker with `PAID_ROUTES_ENABLED=true` and every
ADR-0055 gate deliberately left unset. The composition **always successfully
mounts** the route either way; nothing today refuses to mount a
fixture-evidenced route when the deployment context is genuinely real
production.

**Required addition**: the composition must distinguish "fixture mode because we
are in a real Cloudflare production deployment and required production
authorization is absent" (which must fail closed — `{unavailable: true}`,
exactly like every other missing dependency this composition already fails
closed on) from "fixture mode because this is a local/test/workerd-qualification
run" (which must continue to work exactly as it does today, unchanged, for local
TDD and the qualification strategy in §12/§13).

```
PRODUCTION_PAYMENT_EVIDENCE_FALLBACK_TO_SYNTHETIC = IMPOSSIBLE
```

holds both at the trust-class-gate layer (already true, frozen) and now also at
the composition-construction layer (new, this design): in a genuine production
deployment (`env.ENVIRONMENT === 'production'`), the route refuses to mount at
all unless real evidence resolution succeeds — there is no code path left where
a real production deployment can emit a `result_class: 'success'` response
backed by `synthetic_fixture` evidence.

## 8. Signer vs. payment-evidence — explicit separation

```
provider/payment evidence    = ExternalVerificationEvidence /
                                ExternalSettlementEvidence
                                (packages/protocol-x402/src/evidence/types.ts)
                                — proves the BUYER paid
SITEBORNE service receipt signature
                                = packages/verification's PCC receipt,
                                signed by the dedicated SUN-1215
                                PAID_RECEIPT_SIGNING_* Ed25519 key
                                — proves SITEBORNE genuinely performed
                                the verification and stands behind the
                                result
```

These are **different proofs**, computed by entirely different code paths (§5's
traced ordering: receipt signing happens before evidence acquisition even
starts), never conflated, never sharing key material — confirmed unchanged by
this design (`buildProductionSigner`,
`buildVerifyAgentOutputV2ProductionExecutor` are not modified).

**Correlation**, using actual repository identifiers (not invented ones):
`quote_id` and `requirement_id` bind the evidence and settlement records to a
specific priced challenge; `payment_identifier` is the buyer's own idempotency
key; `receipt_id`/`output_hash`/`receipt_hash` identify the signed PCC document;
`verification_evidence_hash` (a hash of the accepted verification evidence)
binds the settlement record back to the specific verification it followed
(`canAdvanceToSettled`'s own required check, §5). All of these already co-exist
in the durable `CdpSettlementPendingDraft`/`x402_service_results` row — no new
correlation field is needed.

```
BOUND_SIGNER_RUNTIME_EXECUTION_PROVEN = NO (unchanged — this design does
  not exercise the real signer against real Cloudflare-bound secret
  material; that remains SUN-1219+ under governed conditions)
```

## 9. Public receipt verification gap

```
PAID_RECEIPT_PUBLIC_KEY_DISCOVERY_READY = NO
```

Traced `/.well-known/jwks.json` (routed to `a2aRoute`,
`apps/edge-api/src/routes/a2a.ts`): exposes only the Agent Card ES256 key
(`AGENT_CARD_SIGNING_PRIVATE_KEY`/`_KEY_ID`) — confirmed by direct source read,
not assumption. No endpoint anywhere exposes the `PAID_RECEIPT_SIGNING_*`
Ed25519 public key. A buyer who wants to independently verify a receipt's
signature outside the direct HTTP response has no governed discovery path today.

```
PUBLIC_KEY_DISCOVERY_SEVERITY = R1
```

Classified R1 (release risk), not R0 (activation blocker): the receipt itself is
still genuinely signed with a real, dedicated key regardless of discoverability;
a controlled/candidate qualification (SUN-1219) can hand the public key
out-of-band or embed it directly in the qualification report; nothing about
payment-evidence trust (this checkpoint's actual R0) depends on it; and building
the discovery endpoint is a small, separate, low-blast-radius addition (a new
`GET /.well-known/paid-receipt-jwks.json`-shaped route, reusing the existing
`KeyRegistry`) that doesn't touch the x402 lifecycle, evidence provider, or
activation gate at all. **Carried forward separately, not included in this
checkpoint's implementation scope** — no endpoint is added here, per the
directive's own §14 instruction.

## 10. Architecture alternatives considered

**Approach A — production provider only, no production fallback (recommended,
with the §7 addition).** Files touched: `production-payment.ts` (implement
`getAuthenticatedSellerAddress` via `CdpClient.evm.getAccount`),
`verify-agent-output-v2-cdp-composition.ts` (pass the real implementation
instead of omitting it; add the production-fail-closed check). New interfaces:
none — reuses `CdpPaymentEvidenceProvider`/`ProductionCdpProviderDependencies`
exactly as already typed. x402 lifecycle changes: **zero** (`x402-service.ts`,
`canAdvanceToVerified`/`canAdvanceToSettled`, `policy.ts` all untouched).
Migration needs: none. Secret/binding needs: **none new** —
`CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`/`SELLER_WALLET_ADDRESS` already exist.
Test impact: new unit tests for the CDP account-lookup function and the
production-fail-closed branch, plus a new real-workerd phase using a
**local/test** evidence provider (never a real facilitator call) injected
explicitly, per §25's own instruction. Production provisioning needs: none this
checkpoint (real activation of ADR-0055's 4 gates remains a distinct, future,
human-authorized action — unaffected by this design). Future reuse:
`getAuthenticatedSellerAddress`'s CDP-account lookup is reusable by any future
CDP-rail service, not `verify_agent_output.v2`-specific. Blast radius:
**smallest of the three** — two files modified, zero new abstractions, reuses
everything already built and already-approved (SUN-0700B, SUN-1214).

**Approach B — keep generic fallback, but trust-class exclusion alone.** Already
true today at the trust-class-gate layer (§3/§4) — but leaves the
composition-construction gap open (§7): a real production deployment with the
paid gate on and no ADR-0055 authorization would still **successfully mount** a
fixture-evidenced route and finalize `synthetic_fixture`-backed "successes,"
which — per the trust-class gate alone — should be structurally impossible...
except `canAdvanceToVerified` is checked against `config.evidenceMode`, and if
the composition resolves `evidenceMode: 'fixture'` (its current unconditional
fallback), `isTrustClassAllowed('synthetic_fixture', 'fixture')` is `true` — the
gate does not protect against this because the MODE itself, not just the
evidence, was wrongly fixture in a real-production context. Approach B alone
therefore does **not** close the actual gap; it was already this checkpoint's
starting point, not a fix.

**Approach C — replace the generic fallback abstraction entirely (split
test/sandbox evidence from production evidence at the type level).** Would touch
`packages/protocol-x402/src/evidence/*` (types, provider, policy) —
cross-cutting, affects every existing test and the Nevermined rail's own
(already-working, already-qualified) fixture path, explicitly against this
checkpoint's own §12 boundary ("do not damage \[Nevermined's\] existing
abstraction"). Higher blast radius, larger migration surface, no incremental
safety benefit over Approach A + §7's addition (the concrete risk — a
real-production deployment silently mounting a fixture-evidenced route — is
already fully closed by A). Rejected as disproportionate to the actual gap;
YAGNI.

**Recommendation: Approach A, with the §7 fail-closed addition.**

## 11. Production-evidence provider boundary (interface)

No new interface is required — `PaymentEvidenceProvider`,
`CdpPaymentEvidenceProvider`, `ProductionCdpProviderDependencies`
(`production-payment.ts`) already exist with the exact shape needed. The one new
function:

```ts
// apps/edge-api/src/control-plane/config/production-payment.ts (extend, don't replace)
async function resolveAuthenticatedCdpSellerAddress(
  env: Pick<Env, 'CDP_API_KEY_ID' | 'CDP_API_KEY_SECRET'>,
  configuredAddress: string
): Promise<string>; // throws on any failure -- caller (resolveProductionCdpEvidenceProvider)
// already catches and falls back to fixture mode
```

- **Input**: `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` (already-bound secrets), the
  configured `SELLER_WALLET_ADDRESS`.
- **Output**: the resolved account's address (string), or a thrown error.
- **Trust class**: not itself evidence — this only supplies
  `deps.getAuthenticatedSellerAddress` to the existing
  `resolveProductionCdpEvidenceProvider`, which still separately performs gates
  #1/#2/#4 before ever constructing `CdpPaymentEvidenceProvider`.
- **Failure type**: any thrown error (network, auth, not-found, mismatch) is
  caught by the EXISTING try/catch in `resolveProductionCdpEvidenceProvider`
  (unmodified) and falls back to `{evidenceMode: 'fixture'}` — this function
  itself introduces no new failure-handling logic.
- **Idempotency**: read-only GET, naturally idempotent, no state mutation, safe
  to call on every request (or cache — see caching note below).
- **Provider dependency**: `CdpClient` from `@coinbase/cdp-sdk` (already a real
  dependency).
- **Persistence boundary**: nothing persisted — this is a pure,
  synchronous-shaped read-only lookup, never written to D1, never included in
  any evidence record.

Scoped to CDP/x402 only, per §12 — no generic multi-rail abstraction.

## 12. Nevermined — out of scope, undamaged

```
SUN1218_RAIL_SCOPE = CDP_X402_ONLY
```

`FixturePaymentEvidenceProvider`, `policy.ts`, `verification.ts`,
`settlement.ts`, and the Nevermined-rail composition/provider files are **not
touched** by this design. Nevermined's own already-working fixture qualification
path (SUN-0900A/SUN-0900B) is unaffected.

## 13. Activation granularity — the 12-route table

Traced `index.ts`'s actual route registration order (SUN-1216, unchanged since):

| Route                                                                   | Flag false         | Flag true (today)        | Executor ready?                       | Result when true                                |
| ----------------------------------------------------------------------- | ------------------ | ------------------------ | ------------------------------------- | ----------------------------------------------- | ------------------------------------------------- |
| `/v2/verify/agent-output` (POST, exact route registered before `/v2/*`) | 404                | reaches real composition | YES (since SUN-1216)                  | real challenge/execution, `evidenceMode` per §7 |
| other 11 (`/v1/*`, `/v2/*` wildcard, `/v1                               | v2/nevermined/\*`) | 404                      | 503 `service_executor_not_configured` | NO                                              | `productionServiceExecutorUnavailable`, unchanged |

This matches the directive's expected concern exactly. Confirmed live and via
source: flipping the single global `PAID_ROUTES_ENABLED=true` today would make
`verify_agent_output.v2/CDP` reachable (with the §7 gap still open pre-fix)
while the other 11 remain their existing governed 503 — never a 2xx, never a
payment challenge for those 11.

```
GLOBAL_PAID_FLAG_APPROVED_FOR_SINGLE_ROUTE_LAUNCH = NO
```

Not because the other 11 routes are at risk (they are not — they stay 503) — but
because the global flag alone, on the _reachable_ route, today still resolves to
`evidenceMode: 'fixture'` (the exact gap this checkpoint closes). Once §7's
addition exists, the global flag alone would _fail closed_ rather than mount
unsafely — but a second, route-specific gate is still the correct design (§14)
for reasons of blast-radius and future-route independence, not because the
global flag would otherwise be unsafe.

## 14. Single-route activation design

Two-level gate, matching repository naming conventions
(`PAID_ROUTES_ENABLED`/`NEVERMINED_ROUTES_ENABLED` precedent):

```
VERIFY_V2_CDP_ROUTE_ENABLED?: string   // new Env field, optional, additive
```

```
reachable = (PAID_ROUTES_ENABLED === 'true') AND (VERIFY_V2_CDP_ROUTE_ENABLED === 'true')
```

Required behavior (directly implementable inside the existing
`verifyAgentOutputV2CdpProductionRoute` handler, one additional check before the
existing `PAID_ROUTES_ENABLED` check):

```
global absent                          -> 404 (existing, unchanged)
global true, route-specific absent     -> 404 (NEW — the route stays
                                           invisible even with the master
                                           gate on, until explicitly
                                           double-authorized)
both true, dependency unavailable      -> 503 pre-economic (existing
                                           productionServiceExecutorUnavailable,
                                           unchanged)
both true, dependencies valid          -> governed x402 route (existing,
                                           now protected by §7's
                                           production-fail-closed check)
```

This satisfies every requirement in the directive's §16: default OFF, missing →
404, does not change the other 11 routes (their own wildcard checks are
untouched), does not weaken the global kill switch (still required, still
checked first), supports candidate-local qualification (§16 below), supports a
later public canary (both flags can be set independently in a future
real-production deployment), fails closed. No generic feature-flag framework —
one new optional string field, one new `&&` condition.

## 15. Qualification-mode strategy (design only, not executed)

Cloudflare version overrides (`Cloudflare-Workers-Version-Overrides`, proven
live in SUN-1217) target a **specific Worker version**, not the deployment's
`[vars]` — but `[vars]` in `wrangler.toml` are **version-scoped at upload time**
(`wrangler versions upload` bakes the `[vars]` present in the config at upload
into that specific version — confirmed by SUN-1216's own
`wrangler versions view` output, which lists `[vars]` per-version, not
globally). This means: a **future candidate version**, uploaded from a
`wrangler.toml` where `VERIFY_V2_CDP_ROUTE_ENABLED=true` is set (and
`PAID_ROUTES_ENABLED` is left as a version-scoped var too), would carry that
configuration **only for that version** — the currently-active production
version (`f4f20676-...`, and any future known-good version uploaded from the
committed config without those vars) is unaffected, because Worker versions are
immutable and each carries its own frozen `[vars]` snapshot from its own upload.

This means the qualification strategy the directive describes is genuinely
achievable without a debug bypass: freeze a **new** candidate whose
`wrangler.toml` differs from committed production only in carrying both
activation flags `true` (still zero secrets, zero binding changes, zero
receipt/pricing/lifecycle changes), upload it as its own new version at 0%
traffic (exactly SUN-1217's pattern), and drive it via version override —
ordinary traffic never sees it, and no currently-live version's behavior
changes. This is deferred to SUN-1219 per the directive's own §19/§33 — not
executed here.

```
NEW_CANDIDATE_REQUIRED = YES — f39acc84-... remains historical
  edge-qualified evidence for the bundle-integration proof; it does not
  carry either activation flag and cannot be reused for qualification.
```

## 16. Required design self-review

No `TBD`, `TODO`, unproven provider claims, ambiguous settlement ordering,
unsafe fallback, or activation ambiguity remain in this document — every claim
above is backed by a direct source trace or a live production check performed
during this checkpoint, not inference from prior reports.

---

## SUN-1218 DESIGN PHASE COMPLETE

```
SUN1218_DESIGN_PHASE=COMPLETE
SYNTHETIC_FIXTURE_ROOT_CAUSE=resolveProductionCdpEvidenceProvider's fallback to {evidenceMode:'fixture'} is unconditional -- it does not distinguish a real-production deployment context from a local/test one, so a real Cloudflare deployment with PAID_ROUTES_ENABLED=true and no ADR-0055 authorization would mount a working, fixture-evidenced route instead of refusing to mount
PRODUCTION_PAYMENT_EVIDENCE_SOURCE=CdpPaymentEvidenceProvider (apps/edge-api/src/control-plane/evidence/cdp-provider.ts, already implemented since SUN-0700B checkpoint 1, providerKind:'external', calls the real CDP facilitator /verify and /settle) -- the only missing wiring is getAuthenticatedSellerAddress, implementable via CdpClient.evm.getAccount({address}), zero new secrets
PRODUCTION_PAYMENT_EVIDENCE_FALLBACK_TO_SYNTHETIC_ALLOWED=NO
CAN_SETTLEMENT_SUCCEED_BEFORE_EVIDENCE_EXISTS=NO
RECOVERY_MODEL=existing pre-settle durable draft (CdpSettlementPendingDraft, written before evidenceProvider.settle() is ever called) + REFUND_REQUIRED transition on settlement-gate rejection + existing SUN-0900B checkpoint 1B reconciliation semantics -- unmodified, already sufficient
PAID_RECEIPT_PUBLIC_KEY_DISCOVERY_READY=NO
PUBLIC_KEY_DISCOVERY_SEVERITY=R1
GLOBAL_PAID_FLAG_APPROVED_FOR_SINGLE_ROUTE_LAUNCH=NO
RECOMMENDED_ACTIVATION_MODEL=two-level gate: PAID_ROUTES_ENABLED (existing) AND new VERIFY_V2_CDP_ROUTE_ENABLED (route-specific, default absent, additive Env field)
RECOMMENDED_APPROACH=Approach A (production provider only, no production fallback) + composition-level production-fail-closed check
PROPOSED_FILES_TO_CREATE=[
  apps/edge-api/src/control-plane/config/production-payment.test.ts additions only (no new file) -- see PROPOSED_FILES_TO_MODIFY
  apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.production-fail-closed.test.ts
  apps/edge-api/src/control-plane/routes/production-verify-v2-cdp-route.route-gate.test.ts
]
PROPOSED_FILES_TO_MODIFY=[
  apps/edge-api/src/control-plane/config/production-payment.ts (add resolveAuthenticatedCdpSellerAddress, wire it into the composition's dependency, no change to existing 4-gate logic)
  apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.ts (supply the real getAuthenticatedSellerAddress; add production-environment fail-closed check per §7)
  apps/edge-api/src/control-plane/routes/production-verify-v2-cdp-route.ts (add VERIFY_V2_CDP_ROUTE_ENABLED second gate)
  apps/edge-api/src/control-plane/config/env.ts (add VERIFY_V2_CDP_ROUTE_ENABLED?: string)
  scripts/test-worker-runtime.mts (new phase: local/test evidence provider injected explicitly, proves production-fail-closed behavior and the two-gate route logic under real workerd)
  scripts/test-production-fixture-reintroduction-caught.mts (new mutation proof: reintroducing a synthetic/test evidence provider into the production-mode path must be caught)
]
PROPOSED_MIGRATIONS=[]
PRODUCTION_RESOURCES_REQUIRED=[]
PRODUCTION_SECRETS_REQUIRED=[]
OPEN_R0_BLOCKERS=[
  ADR-0055's 4 human-authorization gates remain unset in real production (by design -- their activation is a distinct, future, explicitly human-gated action, never automated by this or any checkpoint)
]
IMPLEMENTATION_STARTED=NO
```

**Approve this SUN-1218 design for implementation?**

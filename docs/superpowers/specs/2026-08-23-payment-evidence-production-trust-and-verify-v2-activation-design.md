# SUN-1218 — Production Payment-Evidence Trust Closure + Verify v2/CDP Single-Route Activation: Design

Status: **design revision complete, awaiting explicit approval.** The
activation-granularity contradiction flagged in the first review round (§13–§18)
is resolved. No implementation has begun.

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

## 13. REVISION — paid fallback handlers, traced exactly (all in `apps/edge-api/src/index.ts`)

The first version of this design (§14 below, old) claimed the other 11 routes
are unaffected by `PAID_ROUTES_ENABLED`. That claim was **wrong** — verified by
re-reading `index.ts` in full, not by re-asserting the prior report's summary.
Two of the five fallback handlers registered in `index.ts` share the exact same
flag the verify route's own gate checks:

```
PAID_FALLBACK_HANDLERS=[
  {
    matcher: "POST /v2/verify/agent-output (exact route, mounted before /v2/*)",
    file: "apps/edge-api/src/control-plane/routes/production-verify-v2-cdp-route.ts",
    flag_false_behavior: "404 (c.notFound())",
    flag_true_behavior: "reaches buildVerifyAgentOutputV2CdpProductionRouteConfig; today always resolves evidenceMode:'fixture' (getAuthenticatedSellerAddress unimplemented) and, if the two paid-signing secrets are present (they are, in real production), MOUNTS a working x402 route -- reachable, not a fixed status code (402/400/200 depending on request)"
  },
  {
    matcher: "app.all('/v1/nevermined/*', ...)",
    file: "apps/edge-api/src/index.ts",
    flag_false_behavior: "404 (gated on NEVERMINED_ROUTES_ENABLED, NOT PAID_ROUTES_ENABLED)",
    flag_true_behavior: "503 productionServiceExecutorUnavailable -- but this flag is never toggled by anything in SUN-1218's scope, so this row stays 404 throughout"
  },
  {
    matcher: "app.all('/v1/*', ...)",
    file: "apps/edge-api/src/index.ts",
    flag_false_behavior: "404 (gated on PAID_ROUTES_ENABLED)",
    flag_true_behavior: "503 productionServiceExecutorUnavailable -- SAME flag as the verify route's own global gate"
  },
  {
    matcher: "app.all('/v2/nevermined/*', ...)",
    file: "apps/edge-api/src/index.ts",
    flag_false_behavior: "404 (gated on NEVERMINED_ROUTES_ENABLED, NOT PAID_ROUTES_ENABLED)",
    flag_true_behavior: "503 productionServiceExecutorUnavailable -- never toggled by SUN-1218's scope, stays 404 throughout"
  },
  {
    matcher: "app.all('/v2/*', ...) (mounted AFTER the exact verify route)",
    file: "apps/edge-api/src/index.ts",
    flag_false_behavior: "404 (gated on PAID_ROUTES_ENABLED)",
    flag_true_behavior: "503 productionServiceExecutorUnavailable -- SAME flag as the verify route's own global gate"
  }
]
```

Route-to-handler mapping (all 12): `/v1/company/evidence-graph`,
`/v1/web/context`, `/v1/document/evidence-json`, `/v1/verify/agent-output` → the
`/v1/*` wildcard. `/v2/company/evidence-graph`, `/v2/web/context`,
`/v2/document/evidence-json` → the `/v2/*` wildcard. `/v2/verify/agent-output` →
the exact route. `/v2/nevermined/*` (4 routes) → the `/v2/nevermined/*`
wildcard, gated by the _unrelated_ `NEVERMINED_ROUTES_ENABLED` flag, never
toggled anywhere in this design's scope.

**The contradiction, stated precisely**: `/v1/*` and `/v2/*` share
`PAID_ROUTES_ENABLED` with the verify route's own global gate. Turning that flag
on to authorize the one qualified route also flips 7 unrelated,
permanently-unsupported routes (4×v1 + 3×v2-non-nevermined-non-verify) from 404
to 503 — an externally-observable behavior change on routes this checkpoint has
no intention of touching.

## 14. REVISION — current 12-route truth table (today's actual code)

`VERIFY_V2_CDP_ROUTE_ENABLED` does not exist in current code, so States C and D
collapse to A and B respectively today (the flag doesn't exist to read) — both
are shown for completeness before the fix, with C/D marked
`(same as A/B — flag not yet implemented)`.

| Route                                   | A (global=F) |                              B (global=T) | C (global=F, route=T; same as A — flag N/A) | D (global=T, route=T; same as B — flag N/A) |
| --------------------------------------- | -----------: | ----------------------------------------: | ------------------------------------------: | ------------------------------------------: |
| `/v1/company/evidence-graph`            |          404 |                                       503 |                                         404 |                                         503 |
| `/v1/web/context`                       |          404 |                                       503 |                                         404 |                                         503 |
| `/v1/document/evidence-json`            |          404 |                                       503 |                                         404 |                                         503 |
| `/v1/verify/agent-output`               |          404 |                                       503 |                                         404 |                                         503 |
| `/v2/company/evidence-graph`            |          404 |                                       503 |                                         404 |                                         503 |
| `/v2/web/context`                       |          404 |                                       503 |                                         404 |                                         503 |
| `/v2/document/evidence-json`            |          404 |                                       503 |                                         404 |                                         503 |
| `/v2/verify/agent-output`               |          404 | **reachable (fixture-evidenced, the R0)** |                                         404 |                                   reachable |
| `/v2/nevermined/company/evidence-graph` |          404 |                                       404 |                                         404 |                                         404 |
| `/v2/nevermined/web/context`            |          404 |                                       404 |                                         404 |                                         404 |
| `/v2/nevermined/document/evidence-json` |          404 |                                       404 |                                         404 |                                         404 |
| `/v2/nevermined/verify/agent-output`    |          404 |                                       404 |                                         404 |                                         404 |

```
TWELVE_ROUTE_TRUTH_TABLE (current) = FAIL against the required final invariant
```

## 15. Resolving the contradiction — minimum source change

**Root cause**: `/v1/*` and `/v2/*`'s wildcard 503-on-flag-true behavior was
written under SUN-1206's now-obsolete "family-wide" activation model (index.ts's
own SUN-1206 doc comment: "every enabled family stops at the same deterministic
503" — a model where the whole family turns on together). SUN-1216/1217 already
flagged, and this checkpoint confirms, that this model is retired:
`PAID_ROUTES_ENABLED` no longer means "the v1/v2 family is nominally on"; going
forward it is one of two co-required gates for the _one_ route that has real
activation logic, and — per this checkpoint's own recommendation — a template
for how any future route gets its own independent two-level gate. The 503
diagnostic on the wildcards was never meant to fire merely because that flag was
raised for an unrelated, specific route's authorization.

**Minimum fix**: `/v1/*` and `/v2/*` become **unconditionally** `c.notFound()` —
no flag check at all, since neither wildcard covers any route with a real
executor and none is expected to (a future route with a real executor gets
pulled out of the wildcard into its own exact route + its own two-level gate,
exactly like verify was in SUN-1216 — never by adding back a flag check on the
wildcard). `productionServiceExecutorUnavailable` itself is untouched, still
reachable — now exclusively from the verify route's own dependency-unavailable
branch.

```
EVALUATE §4's preferred model literally = COMPATIBLE with historical
  safety intent, once corrected: SUN-1206's 503-on-flag-true diagnostic
  assumed a family-wide activation model this repository has since moved
  away from (first observed and explicitly flagged as
  NOT_YET_DETERMINED by SUN-1216's own approval). Removing the wildcard
  flag-check is not a safety regression -- it is the actual minimum
  change required to make PAID_ROUTES_ENABLED's new, narrower meaning
  (a co-gate for individually-activated routes) consistent with what the
  other 11 routes visibly do. No alternative is safer: keeping the
  503-on-flag-true coupling is the unsafe state (externally observable
  behavior change on 7 unrelated routes triggered by authorizing one).
```

`/v1/nevermined/*` and `/v2/nevermined/*` share this exact same class of
coupling (`NEVERMINED_ROUTES_ENABLED` → 503) — genuinely out of this
checkpoint's scope (§12: Nevermined untouched) since that flag is never toggled
anywhere in SUN-1218's states A–D, so those 4 routes already stay 404 throughout
regardless. Noted here for completeness, not fixed here.

## 16. Single-route activation design — revised

Two-level gate, unchanged from the first draft:

```
VERIFY_V2_CDP_ROUTE_ENABLED?: string   // new Env field, optional, additive
reachable = (PAID_ROUTES_ENABLED === 'true') AND (VERIFY_V2_CDP_ROUTE_ENABLED === 'true')
```

Required behavior (verify route's own handler, checked in this order):

```
global absent                          -> 404 (unchanged)
global true, route-specific absent     -> 404 (unchanged from first draft)
both true, dependency unavailable      -> 503 pre-economic (existing
                                           productionServiceExecutorUnavailable)
both true, dependencies valid          -> governed x402 route (protected
                                           by §7's production-fail-closed
                                           check)
```

**New in this revision**: the `/v1/*` and `/v2/*` wildcards drop their
`PAID_ROUTES_ENABLED` check entirely (§15) — this is what actually makes the
required final invariant hold, not merely the verify route's own two-gate logic
(which was already correct in the first draft; the wildcards were the
unaddressed half of the problem).

## 17. Revised 12-route truth table (proposed)

| Route                                   | A (G=F,R=F) | B (G=T,R=F) | C (G=F,R=T) |                                                              D (G=T,R=T) |
| --------------------------------------- | ----------: | ----------: | ----------: | -----------------------------------------------------------------------: |
| `/v1/company/evidence-graph`            |         404 |         404 |         404 |                                                                      404 |
| `/v1/web/context`                       |         404 |         404 |         404 |                                                                      404 |
| `/v1/document/evidence-json`            |         404 |         404 |         404 |                                                                      404 |
| `/v1/verify/agent-output`               |         404 |         404 |         404 |                                                                      404 |
| `/v2/company/evidence-graph`            |         404 |         404 |         404 |                                                                      404 |
| `/v2/web/context`                       |         404 |         404 |         404 |                                                                      404 |
| `/v2/document/evidence-json`            |         404 |         404 |         404 |                                                                      404 |
| `/v2/verify/agent-output`               |         404 |         404 |         404 | **503 (deps invalid) or governed x402 route (deps valid, §7-protected)** |
| `/v2/nevermined/company/evidence-graph` |         404 |         404 |         404 |                                                                      404 |
| `/v2/nevermined/web/context`            |         404 |         404 |         404 |                                                                      404 |
| `/v2/nevermined/document/evidence-json` |         404 |         404 |         404 |                                                                      404 |
| `/v2/nevermined/verify/agent-output`    |         404 |         404 |         404 |                                                                      404 |

```
TWELVE_ROUTE_TRUTH_TABLE (revised) = PASS against the required final invariant
GLOBAL_PAID_FLAG_APPROVED_FOR_SINGLE_ROUTE_LAUNCH = YES (as ONE of two
  required gates, never alone — the wildcard-decoupling in §15 is what
  makes "alone" a meaningless/impossible state for the other 11 routes to
  ever observe)
MASTER_KILL_SWITCH_PRESERVED = YES (PAID_ROUTES_ENABLED=false still forces
  the verify route to 404, unconditionally, first check)
UNSUPPORTED_ROUTES_REMAIN_404_WHEN_MASTER_TRUE = YES (proven by the
  revised table's B and D columns)
```

## 18. Revised proposed files (full list)

```
PROPOSED_FILES_TO_CREATE=[
  apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.production-fail-closed.test.ts
  apps/edge-api/src/control-plane/routes/production-verify-v2-cdp-route.route-gate.test.ts
  apps/edge-api/src/index.wildcard-decoupling.test.ts  (proves /v1/*, /v2/* are unconditionally 404 regardless of PAID_ROUTES_ENABLED, and that the 4 nevermined routes are unaffected by any flag combination this checkpoint touches)
]
PROPOSED_FILES_TO_MODIFY=[
  apps/edge-api/src/index.ts  (remove the PAID_ROUTES_ENABLED check from the /v1/* and /v2/* wildcards -- unconditional c.notFound(); /v1/nevermined/*, /v2/nevermined/* untouched)
  apps/edge-api/src/control-plane/config/production-payment.ts  (add resolveAuthenticatedCdpSellerAddress)
  apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.ts  (wire the real getAuthenticatedSellerAddress; add the §7 production-fail-closed check)
  apps/edge-api/src/control-plane/routes/production-verify-v2-cdp-route.ts  (add the VERIFY_V2_CDP_ROUTE_ENABLED second gate)
  apps/edge-api/src/control-plane/config/env.ts  (add VERIFY_V2_CDP_ROUTE_ENABLED?: string)
  scripts/test-worker-runtime.mts  (new phase: local/test evidence provider injected explicitly; new assertions that /v1/*, /v2/* stay 404 under every flag combination tested)
  scripts/test-production-fixture-reintroduction-caught.mts  (new mutation proof: reintroducing a synthetic/test evidence provider into the production-mode path must be caught)
]
```

`apps/edge-api/src/control-plane/routes/production-paid-services.ts` (home of
`productionServiceExecutorUnavailable`) is explicitly **not** modified — its
isolation property (imports nothing else) is preserved; only its _call sites_ in
`index.ts`'s two generic wildcards are removed, not the function itself, which
remains the verify route's own dependency-unavailable fallback.

## 19. `getAuthenticatedSellerAddress` lifecycle — traced exactly

```
GET_AUTHENTICATED_SELLER_ADDRESS_LIFECYCLE={
  called_when: "lazily, inside buildVerifyAgentOutputV2CdpProductionRouteConfig -> resolveProductionCdpEvidenceProvider, itself only reached from verifyAgentOutputV2CdpProductionRoute's handler after BOTH activation gates (§16) pass. Runs at most once per Worker isolate lifetime after the first successful composition (the route module caches the successful sub-app, per SUN-1216's own design -- the unavailable/failure path is never cached, so a failure retries this lookup on every subsequent request until it succeeds or the isolate recycles)",
  before_payment_challenge: YES (composition construction, hence this lookup, completes before createX402ServiceRoute mounts the sub-app that would ever issue a 402 challenge),
  external_call: YES (a real, authenticated GET-equivalent to the CDP API via CdpClient.evm.getAccount({address}) -- read-only, no Wallet Secret, uses only the already-real CDP_API_KEY_ID/CDP_API_KEY_SECRET),
  can_fail: YES (network failure, authentication failure, account-not-found, or an address mismatch against the configured SELLER_WALLET_ADDRESS are all real possible outcomes),
  failure_behavior: "today (pre-fix): silently falls back to {evidenceMode:'fixture'} via resolveProductionCdpEvidenceProvider's existing unconditional catch-all -- this is the exact gap. Required (this design): when env.ENVIRONMENT === 'production', a failure here (or any of the 3 other ADR-0055 gates) must cause the composition to return {unavailable:true} instead -- the verify route's existing handler already treats {unavailable} as the pre-economic 503 branch (§16), so this is a one-line branch addition at the composition boundary, not new error-handling machinery. Outside a genuine production environment (local dev, workerd qualification, any future non-production candidate), the existing fixture fallback continues unchanged -- required for local TDD and the SUN-1219 qualification strategy (§17, unrenumbered from the first draft's §15) to keep working.",
  economic_effect_possible_before_success: NO (a read-only account lookup cannot itself authorize, move, or affect any payment -- it only determines which evidence-provider construction path is taken; the actual economic-adjacent code -- verify()/settle() -- is never reached until well after this resolves)
}
```

## 20. Payment-evidence R0s vs. future production-activation prerequisites

Read `docs/decisions/0055-human-authorized-production-bootstrap-exception.md` in
full: ADR-0055's four gates
(`PAYMENT_ENVIRONMENT`/`PRODUCTION_ENABLED`/`HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP`/
`PRODUCTION_CDP_CREDENTIALS_APPROVED`) are explicitly, deliberately designed as
a **one-time, human-authorized, fully bounded production bootstrap exception** —
not implementation defects, and not something any checkpoint should ever set
autonomously. The ADR's own decision criteria (6 conditions, all requiring
explicit human authorization "in that exact session, for that exact action")
confirm these belong in the second category below, not the first:

```
PAYMENT_EVIDENCE_R0_BLOCKERS=[
  "getAuthenticatedSellerAddress has no implementation anywhere in the repository (closed by this checkpoint's proposed implementation, §11/§19)",
  "The composition's fallback-to-fixture is unconditional regardless of deployment environment (closed by the §7 production-fail-closed addition)"
]
FUTURE_PRODUCTION_ACTIVATION_PREREQUISITES=[
  "ADR-0055's 4 human-authorization gates (PAYMENT_ENVIRONMENT=production, PRODUCTION_ENABLED=true, HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true, PRODUCTION_CDP_CREDENTIALS_APPROVED=true) -- deliberately unset, a future bounded human action, not an implementation gap",
  "PAID_RECEIPT_PUBLIC_KEY_DISCOVERY_READY=NO, classified R1 (§9) -- a release-quality improvement, not an activation blocker",
  "PAID_ROUTES_ENABLED and VERIFY_V2_CDP_ROUTE_ENABLED both remain unset in real production -- their eventual setting is itself a future, explicit, human-authorized action (SUN-1219+), never automated"
]
```

Both `PAYMENT_EVIDENCE_R0_BLOCKERS` items are proposed to be closed by this
checkpoint's implementation, if approved — leaving zero open R0s after
implementation, with all remaining gates correctly classified as future
human-authorized prerequisites, not defects.

## 21. Qualification-mode strategy (design only, not executed)

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

## 22. Required design self-review

No `TBD`, `TODO`, unproven provider claims, ambiguous settlement ordering,
unsafe fallback, or activation ambiguity remain in this document — the
activation-ambiguity finding from the first review round is now resolved
(§13–§18) with a literal trace, not a re-assertion; every other claim remains
backed by a direct source trace or a live production check performed during this
checkpoint.

---

## SUN-1218 DESIGN REVISION COMPLETE

```
SUN1218_DESIGN_REVISION=COMPLETE
PAID_FALLBACK_HANDLERS=[ see §13 -- 5 handlers, all in apps/edge-api/src/index.ts except the exact verify route ]
CURRENT_TWELVE_ROUTE_TRUTH_TABLE= see §14 -- FAIL against the required final invariant (7 routes flip 404->503 when PAID_ROUTES_ENABLED alone is set true)
REVISED_TWELVE_ROUTE_TRUTH_TABLE= see §17 -- PASS against the required final invariant
PRODUCTION_PAYMENT_EVIDENCE_SOURCE=CdpPaymentEvidenceProvider
PRODUCTION_PAYMENT_EVIDENCE_FALLBACK_TO_SYNTHETIC_ALLOWED=NO
GLOBAL_PAID_FLAG_APPROVED_FOR_SINGLE_ROUTE_LAUNCH=YES (as one of two required gates, never alone -- see §17)
MASTER_KILL_SWITCH_PRESERVED=YES
UNSUPPORTED_ROUTES_REMAIN_404_WHEN_MASTER_TRUE=YES
RECOMMENDED_ACTIVATION_MODEL=two-level gate on the verify route (PAID_ROUTES_ENABLED AND new VERIFY_V2_CDP_ROUTE_ENABLED) PLUS unconditional 404 on the /v1/* and /v2/* wildcards (PAID_ROUTES_ENABLED check removed from both) -- both halves required; the first draft only had the first half
GET_AUTHENTICATED_SELLER_ADDRESS_LIFECYCLE={
  called_when: "lazily, at most once per Worker isolate lifetime after first success, only after both activation gates pass",
  before_payment_challenge: YES,
  external_call: YES,
  can_fail: YES,
  failure_behavior: "today: silent fallback to fixture (the gap); required: in env.ENVIRONMENT==='production', fail closed to {unavailable:true} instead -- see §19",
  economic_effect_possible_before_success: NO
}
PAYMENT_EVIDENCE_R0_BLOCKERS=[
  "getAuthenticatedSellerAddress has no implementation anywhere (closed by this design's proposed implementation)",
  "The composition's fallback-to-fixture is unconditional regardless of deployment environment (closed by the production-fail-closed addition)"
]
FUTURE_PRODUCTION_ACTIVATION_PREREQUISITES=[
  "ADR-0055's 4 human-authorization gates -- deliberate one-time bootstrap exception (docs/decisions/0055-human-authorized-production-bootstrap-exception.md), not an implementation gap",
  "PAID_RECEIPT_PUBLIC_KEY_DISCOVERY_READY=NO, classified R1, not an activation blocker",
  "PAID_ROUTES_ENABLED and VERIFY_V2_CDP_ROUTE_ENABLED both remain unset in real production -- their eventual setting is a future, explicit, human-authorized action (SUN-1219+)"
]
PROPOSED_FILES_TO_CREATE=[
  apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.production-fail-closed.test.ts
  apps/edge-api/src/control-plane/routes/production-verify-v2-cdp-route.route-gate.test.ts
  apps/edge-api/src/index.wildcard-decoupling.test.ts
]
PROPOSED_FILES_TO_MODIFY=[
  apps/edge-api/src/index.ts
  apps/edge-api/src/control-plane/config/production-payment.ts
  apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.ts
  apps/edge-api/src/control-plane/routes/production-verify-v2-cdp-route.ts
  apps/edge-api/src/control-plane/config/env.ts
  scripts/test-worker-runtime.mts
  scripts/test-production-fixture-reintroduction-caught.mts
]
PROPOSED_MIGRATIONS=[]
PRODUCTION_RESOURCES_REQUIRED=[]
PRODUCTION_SECRETS_REQUIRED=[]
OPEN_ARCHITECTURAL_BLOCKERS=[]
TWELVE_ROUTE_TRUTH_TABLE=PASS
IMPLEMENTATION_STARTED=NO
```

**Approve the revised SUN-1218 design for implementation?**

```
SUN1218_DESIGN_APPROVED=NO
SUN1218_IMPLEMENTATION_AUTHORIZED=NO
```

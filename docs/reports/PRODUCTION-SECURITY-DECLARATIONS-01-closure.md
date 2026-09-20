# PRODUCTION-SECURITY-DECLARATIONS-01 — closure

Status: **SOURCE QUALIFIED. NOT PUBLISHED.** No deployment, upload, traffic
change, secret change, or payment occurred.

## 1. Starting provenance

| Item                       | Value                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Starting HEAD              | `2862f733fe3f262ea4153993f3aa0e6b7c892e0f`                                                                               |
| Tree at start              | clean                                                                                                                    |
| Prior checkpoints          | FIRST-PAID-VERIFY-THIRD-REAL-PAYMENT-AUTHORIZATION-01 = PASS; FIRST-PAID-WEB-DIRECT-REAL-PAYMENT-AUTHORIZATION-01 = PASS |
| Ordinary public production | `369b4bf5-c2f7-4e05-8454-7f5514a3bd45`, 100%, paid routes disabled (recorded input, not re-queried)                      |
| Paid canary                | `0456f44c-1c28-4919-9fdb-ab4673bac8f6`, 0% (recorded input)                                                              |
| Continuation host          | `9b1e9b10-beed-4ff3-914c-2221aada9b45`, 100% (recorded input)                                                            |

Deployment identifiers above are inputs to this checkpoint. This checkpoint made
no Cloudflare read or write, so it does not re-verify them.

## 2. Current security-source inventory

`CURRENT_SECURITY_AUTHORITY = existing canonical source, partial`:
`@siteborne/vcm` owns the _truth law_ and the `SecurityCapability` type; it did
not own security _semantics_. This checkpoint extends it
(`packages/vcm/src/security/`).

| Representation                            | Where                                                                  | Says                                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Security Metadata Truth Law (four levels) | `docs/reports/METADATA-VCM-MASTER-canonical-reference.md` §I.13, §II.9 | IMPLEMENTED / CONFIGURED / ACTIVE / VERIFIED; static capped at CONFIGURED                                                     |
| VCM `SecurityCapability`                  | `packages/vcm/src/types.ts`, `legacy/import-registry.ts`               | `a2a_card_signing` = CONFIGURED, `mtls` = IMPLEMENTED                                                                         |
| A2A Agent Card                            | `packages/protocol-a2a/src/card.ts`                                    | `securitySchemes` empty by default; mTLS only if `mtlsProductionActive`; `securityRequirements: []`; `signatures` via JWS     |
| mTLS gate                                 | `apps/edge-api/.../mtls-production-capability.ts`                      | exact-literal `'true'` only, fails closed; the caller-cert helper `security/mtls-caller-context.ts` is wired into zero routes |
| MCP tool annotations                      | `packages/protocol-mcp/src/server.ts`                                  | paid tools `readOnlyHint:false`; utility tools read-only; `openWorldHint` from the economic offer                             |
| OpenAPI                                   | `packages/contracts/generated/openapi/service-contracts.openapi.json`  | no `securitySchemes`, no `security`; `x-production-enabled`, `x-implementation-status`                                        |
| Catalog / economics                       | `routes/catalog.ts`, `@siteborne/pricing` `projectEconomicOffer`       | `release_posture`, `capability_available` per mode, `production_enabled`                                                      |
| Economic contract                         | `packages/pricing/src/economic-contract.ts`                            | `releasePosture`, per-mode `available`, `openWorld`                                                                           |
| Mode gate                                 | `routes/pre-economic-mode-gate.ts`                                     | rejects unavailable modes before any quote                                                                                    |
| Route admission                           | `apps/edge-api/src/index.ts`                                           | two exact-literal gates per paid route; wildcards 404                                                                         |
| `security.txt`, static site               | `routes/security-txt.ts`, `apps/network-site`, publication manifest    | disclosure contact only; no security-mechanism claims                                                                         |
| Audit redaction                           | `control-plane/audit/events.ts`                                        | name-based redaction                                                                                                          |
| Registry files                            | `registry/services/*.json`                                             | `production_enabled:false`, protocols `planned` (legacy, HISTORICAL-class)                                                    |

`CURRENT_SECURITY_DUPLICATION`: security claims were spread across VCM, card,
MCP annotations, OpenAPI, and catalog with no shared semantic source. There were
no security _semantics_ (authority boundaries, effect axes, result access,
credential boundaries) anywhere machine-readable.

`CURRENT_SECURITY_CONTRADICTIONS`: none found among the surfaces that make
security claims. Two stale-documentation observations, neither a served claim:
`production-paid-services.ts` header still says "no governed executor"; registry
files carry `planned` protocol states.

## 3. Constitution mapping

The 20 frozen distinctions are carried as data in
`authorityModel.frozenDistinctions`. Each enforceable one has a structured
invariant. See §4.

Not weakened: `No external system grants SITEBORNE authority` is
`authorityModel.governingRule`.

Where a distinction has no current mechanism behind it (authentication ≠
authorization, platform authorization cannot widen,
restriction-not-overridable-by-trust) it is `DECLARED_FUTURE`, not enforced.

## 4. Canonical declaration

Location: `packages/vcm/src/security/declaration.ts`
(`buildSecurityDeclarationV1`). Schema `security_declaration.v1`, declaration
version `1.0.0`. Extension of VCM, no parallel package. Bindings are **derived**
from `@siteborne/pricing` so availability is not hand-copied.

Sections: `authorityModel`, `policySemantics`, `supportedSecurityProfiles`,
`capabilitySecurityBindings`, `evidenceSemantics`, `runtimeQualification`,
`effectSemantics`, `resultSecurity`, `economicSecurity`, `credentialBoundaries`,
`keyPurposeBoundaries`, `hostileContentBoundaries`,
`unsupportedSecurityFeatures`, `reservedFutureObjects`, `provenance`.

Compatibility: unknown schema version is denied. The declaration version is not
bound to a deployment version. `truthLevelCeiling` is `CONFIGURED`; the
declaration never asserts ACTIVE or VERIFIED.

## 5. Implementation-status vocabulary

`IMPLEMENTED_ENFORCED > IMPLEMENTED_OBSERVATIONAL > DECLARED_FUTURE > UNSUPPORTED`
(`vocabulary.ts`), a total order used for the narrowing rule. Unknown values
fail closed to `UNSUPPORTED`.

It is deliberately **not merged** with the existing four-level truth law. That
law measures how well _activation_ is evidenced; this vocabulary says whether a
behavior is a _guarantee_. The bundle carries both: per-claim status plus a
bundle ceiling. Each statement also carries `qualification`: `live_exercised`,
`source_implemented`, or `not_exercised`.

## 6. Release-1 profiles

| Profile                | Authentication | Identity        | Economic authorization                 | Result access                          | Status                                     |
| ---------------------- | -------------- | --------------- | -------------------------------------- | -------------------------------------- | ------------------------------------------ |
| `PUBLIC_DISCOVERY`     | none           | not established | none                                   | public metadata                        | ENFORCED                                   |
| `PUBLIC_ECONOMIC_X402` | none           | not established | quote-bound x402 payment authorization | paid response only, no retrieval route | ENFORCED (for release-candidate admission) |

No caller-bound or proof profile is declared, because none is enforced. Runtime
activation of `PUBLIC_ECONOMIC_X402` is an operational fact and is not asserted
here; ordinary production still has paid routes disabled.

## 7. Capability bindings

| Binding                                                       | Available | Purchasable             | Profile              | Status      |
| ------------------------------------------------------------- | --------- | ----------------------- | -------------------- | ----------- |
| `verify_agent_output.v2/standard`                             | yes       | yes (release candidate) | PUBLIC_ECONOMIC_X402 | ENFORCED    |
| `web_context_verified.v2/direct`                              | yes       | yes (release candidate) | PUBLIC_ECONOMIC_X402 | ENFORCED    |
| `web_context_verified.v2/rendered`                            | no        | no                      | none                 | UNSUPPORTED |
| `verify_agent_output.v2/independent_reproduction`             | no        | no                      | none                 | UNSUPPORTED |
| `company_evidence_graph.v2/*`, `document_evidence_json.v2/*`  | no        | no                      | none                 | UNSUPPORTED |
| all `v1` generations                                          | no        | no                      | none                 | UNSUPPORTED |
| `<v2 service>/nevermined` (4)                                 | no        | no                      | none                 | UNSUPPORTED |
| `mcp:siteborne_get_quote`, `mcp:siteborne_get_service_health` | yes       | n/a                     | PUBLIC_DISCOVERY     | ENFORCED    |

Exactly two bindings are purchasable, and a test asserts this.

## 8. Negative declarations

20 features are declared. `UNSUPPORTED`: mTLS, OAuth, SPIFFE/SVID, Machine
Payments Protocol, VCAP, AgentCore Policy, enterprise workload federation,
interactive login, custodial wallet operation, rendered mode, independent
reproduction, Nevermined paid execution, company paid, document paid, legacy v1
paid, public result retrieval, caller-bound result retrieval, automated
refund/reversal. `DECLARED_FUTURE`: DPoP, AP2.

mTLS is `UNSUPPORTED` even though helper code exists, because that helper is
wired into no route and Cloudflare edge configuration is outside the repository.
`RELEASE_1_STATUS_CEILINGS` is a one-way ratchet that fails the build if any is
raised.

## 9. Three-axis effect semantics

Execution effect, information effect, and economic effect are independent
fields. Both paid capabilities: execution `read_only`; economic `authorize` +
`settle`, irreversible; information effect present (`web direct` = outbound
public-web retrieval, `verify` = supplied material, no egress). A validator rule
fails any paid capability that maps `read_only` to no economic effect.
Refund/reverse are `UNSUPPORTED`: no refund executor exists, only a
`REFUND_REQUIRED` manual state.

## 10. Runtime-qualification declaration

All statements are `IMPLEMENTED_OBSERVATIONAL`: qualification is a
release-process control (gates, release invariant, rollback target), not a
request-path guard. `runtime_self_check_absent` states this explicitly as
`UNSUPPORTED`. Public output contains no version IDs, digests, topology, or
fencing detail; a leak scan enforces this.

## 11. Result-security declaration

| Aspect                                                        | Status                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------ |
| Creation binding (quote, requirement, payment id, input hash) | ENFORCED, live                                         |
| Persistence                                                   | ENFORCED, live                                         |
| Receipt signing                                               | ENFORCED, live                                         |
| Delivery channel: the paid response                           | ENFORCED, live                                         |
| Paid-request replay idempotency                               | ENFORCED, **source only, not exercised live**          |
| Public retrieval                                              | UNSUPPORTED                                            |
| Caller-bound retrieval                                        | UNSUPPORTED, not exercised (no retrieval route exists) |

## 12. Economic-security declaration

x402 on Base (`eip155:8453`), USDC; payment authorization is evidence, not
identity; quote-bound, exact amount; no provider work before verification;
settlement after execution and receipt generation; at-most-once settlement.
Client-side challenge validation is declared as the **buyer's** responsibility,
not a SITEBORNE guarantee. Wallet-management detail, provider credentials, and
settlement algorithms are not published.

## 13. Credential boundaries (verified from source)

- Buyer keys never enter SITEBORNE; the server receives only a signed
  authorization.
- **The signed authorization is retained, encrypted.** It is not written to D1,
  audit, or receipts, but the settlement context (including the payment payload)
  is sealed with AES-256-GCM into the continuation envelope and handed to the
  workflow platform until settlement completes. The declaration says exactly
  this and does **not** claim "not persisted". Platform-side retention of that
  sealed input is not controlled by this repository and is not asserted.
- Facilitator tokens are not persisted; failure diagnostics use closed
  vocabularies.
- Audit redaction is by field name and best-effort
  (`IMPLEMENTED_OBSERVATIONAL`), not a content scanner.
- Receipts follow a closed schema (`additionalProperties:false`).

The live harness's "signature not persisted" is a buyer-side property and is not
a SITEBORNE guarantee.

## 14. Key-purpose semantics

Separate purposes: agent-card signing (ES256), receipt signing (Ed25519),
facilitator authentication (Ed25519), continuation encryption (AES-256-GCM, not
signing), registry domain proof (public only). Separation proven is _distinct
configuration binding_ (and different algorithms for card vs receipt). Physical
key-material separation is `not_asserted`. Future grant-signing and
mandate-transaction domains are `DECLARED_FUTURE` and must not reuse any
existing key.

## 15. Hostile-content boundary

Enforced today: payTo, quote identity, price/ceiling, settlement destination,
security profile, result access. `DECLARED_FUTURE` because the concept does not
exist yet: principal identity, authorization scope, supplier qualification,
commit classification.

## 16. Public/private boundary

The public projection is built by an explicit allowlist and never spreads a
canonical object. `privateEvidenceRef` is stripped. `scanForPrivateLeaks`
rejects repo paths, source files, binding names, worker/version UUIDs, digests,
and addresses. Tests inject private fields into every section and prove none
reach output. Ordinary prose ("wallet secrets") is deliberately not flagged.

## 17. Semantic-hygiene audit (§19)

All five fields were traced through source, including raw-SQL readers. **None is
an authority, settlement, or PCC input, and none is publicly exposed. No STOP
condition.** All are recorded as accepted hardening debt, and none was silently
redefined.

| Field                                  | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                         | Classification                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `payment_attempts.service_output_hash` | Written at settlement-pending from the facilitator verification evidence's `raw_evidence_hash`, not the service output hash. The canonical output hash is in the payment link and PCC. Only reader is the repository mapper.                                                                                                                                                                                                                    | `INTERNAL_BOOKKEEPING_ONLY` (misnamed) |
| `settlement_evidence.settled_at`       | Set from `context.nowIso` when the evidence object is built, not the on-chain time. Validated only as non-empty. Not in PCC or public schemas. It is inside the object hashed into `settlement_evidence_hash`, so the hash commits to a mis-timed value that nothing interprets. Do not backfill; a fix changes hashes for new records only. D1 was not re-queried this checkpoint; the source mechanism matches the previously observed value. | `INTERNAL_BOOKKEEPING_ONLY`            |
| `payment_attempts.job_id`              | Nullable by documented design; link via `jobs.idempotency_key` and `payment_service_link_evidence.job_id` (NOT NULL). Only consumer is the operator alert sweep, whose payload therefore carries a null job id.                                                                                                                                                                                                                                 | `INTERNAL_BOOKKEEPING_ONLY`            |
| `payment_attempts.service_receipt_id`  | `COALESCE` write-once; the workflow never supplies it, so it stays null. Canonical link is `payment_service_link_evidence`. No consumer.                                                                                                                                                                                                                                                                                                        | `INTERNAL_BOOKKEEPING_ONLY`            |
| `cdp_facilitator_settle_attempt_count` | Incremented only on failure transitions and recovery retries, so first-attempt success leaves 0. Only consumer is the operator alert `reconciliation_attempts`. Name overstates.                                                                                                                                                                                                                                                                | `INTERNAL_BOOKKEEPING_ONLY`            |

## 18. Projection architecture

Chosen: **validate-mode** against the canonical source (`parity.ts`), plus
deterministic pure fragment projectors for MCP `_meta`, OpenAPI
`x-siteborne-security`, A2A skill metadata, and catalog. **The served surfaces
are unmodified.** Generation into them is a publication step (§23). No new
public endpoint was created.

Classification of publication: `ADDITIVE_PUBLIC_METADATA_ONLY` for extending
existing surfaces. A standalone `/.well-known` security-declaration resource
would be `NEW_PUBLIC_CONTRACT` and was **not** created; it needs governance
approval.

## 19. Contradiction and property tests

`contradiction.test.ts` (29): x402-as-identity; receipt as execution authority;
PCC as permission; each unsupported feature marked enforced; each closed
capability marked purchasable; rendered/Nevermined made self-consistent yet
still rejected by governance recomputation; caller-bound retrieval claims;
read-only conflated with no economic effect; runtime qualification omitted
(canonical and projection); unknown version; unknown status;
exercised-but-future claim; ACTIVE in a static declaration; private leaks.

`property.test.ts` (12): status lattice, exhaustive; every feature × every
status against its ceiling; every evidence class; every binding × every
projected status; a 400-iteration seeded mutation fuzz; injected private keys in
every section; closed bindings cannot inherit a profile.

**Mutation check:** with governance recomputation and the ceiling ratchet
disabled, 15 contradiction tests failed. The validator was restored, and all
pass again.

## 20. Parity results

Compared against the real builders and artifacts, not fixtures.

| Surface                                                                 | Result                                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| VCM effective view                                                      | PASS (nothing above CONFIGURED; mTLS agreement)                          |
| MCP (live definitions, 6 tools)                                         | PASS                                                                     |
| A2A (live card builder)                                                 | PASS; flipping `mtlsProductionActive` is **detected** as a contradiction |
| OpenAPI (generated artifact + live paid-operations builder)             | PASS                                                                     |
| Catalog / economics (`projectServiceEconomics`, all 8 ids)              | PASS                                                                     |
| Economic (amounts 0.017 / 0.008, network, asset, domain `USD Coin`/`2`) | PASS                                                                     |
| Route mode gate                                                         | PASS                                                                     |

## 21. Qualification results

| Gate                                           | Result            |
| ---------------------------------------------- | ----------------- |
| New tests                                      | 73 pass (5 files) |
| `tsc --noEmit` `packages/vcm`, `apps/edge-api` | clean             |
| eslint (changed files)                         | clean             |
| prettier (changed files)                       | clean             |
| Working-tree secret scan                       | OK, 1690 files    |
| Full repository suite                          | see §22           |

## 22. Full-suite classification

Full repository run (`vitest run`): **319 files passed, 1 failed, 22 skipped;
4006 tests passed, 1 failed, 79 skipped** (4086 total). The process exit code
was **1**. This is not a clean run and is not reported as one.

The single failure is
`scripts/reconcile-payment-attempts.contract.test.ts > actual isolated D1 operator flow > performs a fresh exact-17 apply and truthful idempotent no-op`,
failing with `Test timed out in 5000ms`.

Classification: **pre-existing, load-sensitive, unrelated to this checkpoint.**
Evidence: (1) rerun in isolation, the whole file passes (38/38) and this test
takes about 3.3 s, so it has little headroom under the 5 s default when 300+
files run concurrently; (2) it exercises Miniflare/D1 reconciliation code that
this change does not import or modify; (3) the previous checkpoint recorded the
same class of one-off timeout under load. It was not fixed here, because raising
the timeout is outside this checkpoint's scope.

The 79 skipped tests are the credential-gated live suites
(`apps/edge-api/tests/live/*`), which by design do not run without explicit live
authorization.

The 73 new tests are included in the passing count.

## 23. Known limitations

- Catalog parity is against the catalog's shared economic source, **not through
  the HTTP route** (the route test needs Miniflare/D1). The served catalog JSON
  itself is unverified by this checkpoint.
- No live surface was fetched. Parity is against locally built surfaces at HEAD.
- Deployment state is the recorded input, not re-verified.
- Statuses marked `source_implemented` make no test-coverage claim.
- A2A skill parity uses the card's eight skill ids (four v1, four v2).
- `PUBLIC_ECONOMIC_X402` ENFORCED describes release-candidate admission;
  ordinary production has paid routes disabled.
- Retention duration of the sealed workflow input is platform-governed and
  unspecified.

## 24. Publication plan (prepared, not executed)

`PUBLICATION_REQUIRED = YES`; `PUBLICATION_MUTATION_AUTHORIZED = NO`.

1. Governance decision: extend existing surfaces only
   (`ADDITIVE_PUBLIC_METADATA_ONLY`), or also add a standalone resource
   (`NEW_PUBLIC_CONTRACT`, needs approval).
2. Wire the four fragment projectors into the MCP `_meta`, the OpenAPI
   generator, the A2A card, and the catalog. This changes served bytes, so the
   signed A2A card JWS, OpenAPI hash pins, and MCP tool digests must be
   regenerated and re-qualified.
3. Build one immutable public candidate at 0% traffic and re-run exact-version
   MCP/A2A-JWS/OpenAPI/catalog qualification.
4. Human-authorized promotion with the existing rollback target.

## 25. Remaining blocker to final production activation

Unchanged by this checkpoint: ordinary production still has paid routes disabled
and the security declaration is unpublished. Final activation additionally needs
a decision on the accepted hardening debt in §17 and the replay/caller-binding
paths that were never exercised live.

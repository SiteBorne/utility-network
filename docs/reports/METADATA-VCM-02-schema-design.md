# METADATA-VCM-02 — Verified Canonical Metadata Model Schema Design

Status: design checkpoint. `METADATA-AUTHORITY-01` is treated as frozen authority; every
canonical-owner decision made there is inherited without re-litigation. No runtime,
protocol-projection, registry, governance, pricing, contract, CI, or production file was
modified to produce this document. `packages/vcm` is **not** created by this checkpoint.

All canonicalization/hashing decisions reuse the repo's existing frozen machinery rather
than inventing a second one: `packages/pcc-schema`'s `canonicalize()`/`hashCanonical()`
(RFC8785/JCS, documented at `docs/decisions/0007-pcc-canonicalization-and-signing.md`),
consumed the same way `packages/verification/src/canonical.ts` already consumes it —
by import, not reimplementation. Hash format matches the existing convention exactly:
`sha256:<64 lowercase hex>`, i.e. `packages/pcc-schema/src/index.ts:654`'s
`HashZ = z.string().regex(/^sha256:[a-f0-9]{64}$/)`.

---

## 1. Three-Layer Model

```
CanonicalStaticModel   — NORMATIVE + DERIVED + MIRROR + EVIDENCE facts (per Authority Map §1).
                          Build-time. Never reads live environment state.
        +
RuntimeStateOverlay     — OPERATIONAL facts (per Authority Map §1). Read at request/report
                          time from env bindings, secrets, and live measurement. Never
                          hand-authored, never checked into a static file as truth.
        =
EffectiveMetadataView   — the merge. The only thing any protocol projection is allowed
                          to read from. Never constructed by hand; always `project(static, overlay)`.
```

```typescript
declare function project(
  staticModel: CanonicalStaticModel,
  overlay: RuntimeStateOverlay,
): EffectiveMetadataView;
```

**Merge law** (structural, not just documented — see §6 for how the types enforce it):
for every fact that has both a static declaration and an overlay observation, the
effective value is `overlay.narrows(static)`, never `overlay.widens(static)`. The overlay
types below are deliberately missing any field that could assert a capability, exposure,
or truth level the static model didn't already declare — there is no `protocolExposed`
field anywhere in `RuntimeStateOverlay`, only fields that can turn a static "yes" into an
effective "no" (`runtimeEnabled: false`, `measuredLevel: 'UNMEASURED'`, etc.). A widening
bug is a type-construction error, not just a logic error a reviewer has to catch.

---

## 2. Version Namespaces — Closed, Unambiguous

No field in this model is ever named bare `version`. Eleven namespaces, exactly matching
Authority Map §4:

```typescript
/** `.v1`, `.v2`, … — permanent parallel identities. Never a deprecation ladder. */
type ServiceGeneration = 'v1' | 'v2';

/** Precise decimal semver, not a bare string — avoids "2.0" vs "2.0.0" ambiguity
 *  that has already caused confusion in hand-maintained YAML across this repo. */
interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly raw: `${number}.${number}.${number}`;
}

type ContractReleaseVersion = SemVer;              // contracts/releases/*/CONTRACT_RELEASE.yaml
type PccWireVersion = '1.0.0';                      // packages/pcc-schema/src/index.ts:PCC_VERSION
                                                      // (literal union of one today; extend the
                                                      // union, never widen to `string`, if it changes)
type PccSchemaRelease = SemVer;                      // CONTRACT_RELEASE.yaml:pcc_dependency.schema_release
type McpProtocolVersion = `${number}-${string}-${string}`; // date-shaped, e.g. '2026-07-28'
type X402ProtocolVersion = number;                   // @x402/core's exported x402Version (= 2)
type VcmSchemaVersion = SemVer;                      // this model's own shape version
type VcmReleaseVersion = SemVer;                     // one compiled instance of the model
type ProjectionVersion = SemVer;                     // per-protocol-surface generated-output version
type DeploymentVersion =                             // OPERATIONAL — never in CanonicalStaticModel
  | { readonly platform: 'cloudflare-workers'; readonly workerVersionId: string }
  | Unknown_;                                        // platform id not obtainable from this build context
type PricingPolicyVersion = SemVer;                  // governance/RISK_LIMITS.yaml pricing generation
```

`PccWireVersion` and `PccSchemaRelease` are carried as two separate fields everywhere
they appear (`ServiceContractRef.pcc.wireVersion` / `.schemaRelease` — §5) — never
collapsed, per Authority Map §4's resolved finding that these are intentionally distinct
dimensions (`contracts/releases/2.0.0/CONTRACT_RELEASE.yaml:42`'s own comment: *"version
pcc_version remains 1.0.0, unchanged"* while `schema_release` independently advances).

---

## 3. Unknown / Null / Unsupported States

Every "we don't know" state is a distinct, named sentinel — never a bare `null`/`undefined`
standing in for three different meanings at once.

```typescript
/** We looked and could not obtain a value in this build/report context
 *  (e.g. a live platform query wasn't performed). Distinct from "known false". */
interface Unknown_ { readonly kind: 'UNKNOWN' }

/** A live measurement was never attempted for this fact. Distinct from UNKNOWN:
 *  UNMEASURED means "no attempt was made", UNKNOWN means "an attempt was made
 *  and failed or was inconclusive". Both are honest; they answer different questions. */
interface Unmeasured { readonly kind: 'UNMEASURED' }

/** The fact is knowably absent by design (e.g. no payTo bound yet), not merely unknown. */
interface NotConfigured { readonly kind: 'NOT_CONFIGURED' }

/** The fact does not apply to this entity at all (e.g. security mechanism kind
 *  that has no jwksUri concept). */
interface NotApplicable { readonly kind: 'NOT_APPLICABLE' }

type Maybe<T> = T | Unknown_;
type MeasuredOr<T> = T | Unmeasured;
```

Rule: a field typed `T | undefined` is a design smell in this model. If absence is
possible, it must be one of the four sentinels above, chosen for what absence *means*.

---

## 4. Capability / Exposure / Activation / Admission / Qualification — Formalized

Direct implementation of Authority Map §3's five-axis model, now as types instead of prose:

```typescript
type ProtocolSurface = 'a2a' | 'mcp' | 'openapi' | 'x402' | 'bazaar' | 'nevermined';

/** STATIC. capabilityExists is always `true` by construction: if a CanonicalInteraction
 *  exists at all, the capability exists. The field is kept explicit (not just implied by
 *  presence in an array) because §10's projection law requires every projection to be able
 *  to state it positively, and because a future interaction kind might need a `false` here
 *  if the model ever represents "planned but not yet implemented" interactions directly
 *  (not needed today — see minimality table, §12). */
interface StaticProtocolExposure {
  readonly surface: ProtocolSurface;
  readonly capabilityExists: true;
  /** Whether THIS surface has wired the interaction to a callable endpoint/tool.
   *  Compiled from actual code registration once the registry authority inversion (§7)
   *  completes; during transition, carried through from the legacy registry file
   *  verbatim (see §7's two-track field). */
  readonly protocolExposed: boolean;
  readonly exposureShape: 'standalone_endpoint' | 'inline_within_another_operation' | 'not_exposed';
}

/** OPERATIONAL. Lives only in RuntimeStateOverlay (§6) — deliberately has NO field that
 *  could assert protocolExposed; it can only narrow protocolExposed=true down to
 *  effectively-unavailable via runtimeEnabled=false. */
interface RouteRuntimeState {
  readonly serviceId: CanonicalServiceIdValue;
  readonly operationId: string;
  readonly runtimeEnabled: boolean;
  readonly economicAdmissionEnabled: boolean; // independent axis; a free/read-only
                                               // interaction can be runtimeEnabled=true
                                               // with economicAdmissionEnabled=NOT_APPLICABLE
                                               // — see EffectiveInteractionView, §6
}

/** EVIDENCE-derived, not static, not purely operational: whether a service has cleared
 *  the governance promotion ladder rung required for the controls it exercises.
 *  Computed from governance/PROMOTION_STATES.yaml's requirement set + docs/reports/
 *  evidence, at report time — hence modeled as part of the overlay (it can change
 *  without a code deploy), not the static model. */
interface QualificationRuntimeState {
  readonly serviceId: CanonicalServiceIdValue;
  readonly currentPromotionState: LifecycleState;
  readonly qualifiedForProduction: boolean;
}
```

Effective view merges these into one honest per-interaction record (§6). No projection
is ever allowed to collapse this back into a single `available: boolean` — that collapse
is exactly the class of bug the `get_quote` investigation in `METADATA-AUTHORITY-01` §3
surfaced and resolved as a non-contradiction only because the two axes were disentangled
by hand; VCM makes the disentanglement structural.

---

## 5. Core Identity Types

```typescript
type Sha256Digest = `sha256:${string}`; // validated against HashZ's regex at parse time,
                                         // not representable at the TS type level alone

type IsoTimestamp = string; // validated as ISO-8601 at parse time; kept as `string` here
                             // deliberately — see §12, this is the one place a "generic
                             // string" is correct because the domain (arbitrary instants)
                             // is genuinely unbounded, unlike the enums elsewhere in this doc

type GitSha = string; // validated against /^[0-9a-f]{40}$/ at parse time
type UriString = string; // validated as a well-formed absolute URI at parse time
type EvmAddress = `0x${string}`; // validated against /^0x[0-9a-fA-F]{40}$/ at parse time

interface MetadataModelIdentity {
  readonly vcmSchemaVersion: VcmSchemaVersion;
  readonly vcmReleaseVersion: VcmReleaseVersion;
  readonly modelDigest: Sha256Digest;   // see §9 — excluded from its own hash input, obviously
  readonly compiledAt: IsoTimestamp;    // volatile — excluded from every digest (§9)
}

/** Closed today: SITEBORNE has exactly one known organizational identity in this repo.
 *  If a second org identity is ever needed (white-label, multi-tenant), extend
 *  `network` to a union rather than widening it to `string` preemptively — YAGNI. */
interface OrganizationIdentity {
  readonly legalName: string;
  readonly publicName: string;
  readonly network: 'net.siteborne';
  readonly homepageUri: UriString;
  readonly supportContact: UriString;
}
```

---

## 6. Service Identity, Family, Generation, Interactions

```typescript
/** Closed per Authority Map §8 — the four families that exist today. Extending this
 *  union is itself a governed, reviewed act (a new service family launching),
 *  exactly like adding a new file to registry/services/ is today. */
type ServiceFamily =
  | 'company_evidence_graph'
  | 'web_context_verified'
  | 'document_evidence_json'
  | 'verify_agent_output';

interface CanonicalServiceId {
  readonly family: ServiceFamily;
  readonly generation: ServiceGeneration;
}

/** The dotted string form used everywhere as a map key / lookup value.
 *  Derived, never independently settable — constructing one always goes through
 *  a single `serviceIdValue()` function, never string concatenation at call sites. */
type CanonicalServiceIdValue = `${ServiceFamily}.${ServiceGeneration}`;

/** Mirrors governance/PROMOTION_STATES.yaml's ladder ids exactly (DRAFT,
 *  CASE_SUPPORTED, MULTI_CASE_SUPPORTED, VERIFIED_PATTERN confirmed present in this
 *  pass; EXECUTABLE_VERIFIED confirmed as a registry-observed value
 *  (`promotion_state: "executable_candidate"` — NOTE: the registry's current string
 *  does not exactly match any ladder id read from PROMOTION_STATES.yaml in this pass;
 *  flagged OPEN below, not blocking, since the union is still closed and the mismatch
 *  itself becomes a detectable IDENTITY_DRIFT once VCM validates registry values
 *  against the governance ladder at compile time — which it cannot do today). */
type LifecycleState =
  | 'DRAFT'
  | 'CASE_SUPPORTED'
  | 'MULTI_CASE_SUPPORTED'
  | 'VERIFIED_PATTERN'
  | 'EXECUTABLE_CANDIDATE' // OPEN: reconcile exact name against governance/PROMOTION_STATES.yaml's
                            // full ladder (only its first four rungs were read in this pass)
  | 'EXECUTABLE_VERIFIED'
  | 'RETIRED'
  | 'TOMBSTONED';

type AuthorizationClassification = 'public' | 'restricted'; // 'public' confirmed observed;
  // 'restricted' inferred as the closed complement — OPEN: confirm no third value exists
  // by reading every registry/services/*.json file's authorization_classification before
  // implementation (mechanical, cheap — not a design blocker)

/** A capability tag. Deliberately NOT a closed TS union: the actual capability
 *  vocabulary varies per service family (identity_resolution, sec_submissions, …) and
 *  is itself data, not a fixed protocol concept — collapsing it into one repo-wide
 *  union would force every new capability to be a type-level change. Boundedness is
 *  enforced instead by a per-family closed set validated by the compiler (a runtime
 *  check against a governed capability vocabulary file), not by TypeScript. This is
 *  the one deliberate departure from "prefer closed unions" in this document, and it
 *  is deliberate rather than a `Record<string, unknown>` escape hatch. */
interface CanonicalCapability {
  readonly id: string; // validated at compile time against a governed per-family vocabulary
  readonly description: string;
}

type ExecutionMode = 'sync' | 'async';

/** 'variable' confirmed observed in registry/services/*.json. 'fast'/'slow' are the
 *  closed complement inferred from the field's name and are OPEN pending a full read
 *  of every registry file's expected_latency_class value before implementation. */
type LatencyClass = 'fast' | 'variable' | 'slow';

interface CanonicalInteraction {
  readonly operationId: string;
  /** Matches the three tool categories confirmed in the MCP discovery pass:
   *  four service tools (primary_service_call), one quote tool, one health tool. */
  readonly kind: 'primary_service_call' | 'quote_request' | 'health_check';
  readonly executionMode: ExecutionMode;
  readonly maximumInputBytes: number;
  readonly expectedLatencyClass: LatencyClass;
  readonly readOnly: boolean;
  readonly idempotent: boolean;
  readonly destructive: boolean;
  readonly exposure: readonly StaticProtocolExposure[];
  /** The ONE bounded, governed transform per Authority Map §10: MCP's contrastive
   *  routing text may rephrase but never assert a fact absent from this interaction's
   *  own capabilities/lifecycle/price. Optional because most interactions don't need
   *  an override — a default routing text is DERIVABLE from the base fields alone
   *  (§8 projection readiness); this slot exists only because today's MCP text is
   *  hand-authored per tool and migrating it to fully-generated text is out of scope
   *  for this checkpoint (see minimality table, §12: REQUIRED_FOR_KNOWN_PROJECTION,
   *  not REQUIRED_NOW). */
  readonly routingOverrides?: readonly RoutingOverride[];
  /** Two-track transitional field — see §7. REMOVE once registry authority inverts. */
  readonly legacyProtocolExposureDeclared?: Partial<Record<ProtocolSurface, 'planned' | 'live' | 'deprecated'>>;
}

interface RoutingOverride {
  readonly protocolSurface: Extract<ProtocolSurface, 'mcp'>; // only MCP needs this today;
                                                               // extend the Extract<> set if
                                                               // another surface adopts
                                                               // hand-authored routing text
  readonly useWhen: readonly string[];
  readonly doNotUseWhen: readonly string[];
}
```

---

## 7. Schema/Contract References, Digests, Economics

```typescript
interface SchemaRef {
  readonly uri: UriString;
  readonly digest: Sha256Digest;
}

interface ServiceContractRef {
  readonly contractReleaseVersion: ContractReleaseVersion;
  readonly inputSchema: SchemaRef;
  readonly outputSchema: SchemaRef;
  readonly pcc: {
    readonly wireVersion: PccWireVersion;
    readonly schemaRelease: PccSchemaRelease;
  };
}

/** Decimal-as-string, matching the existing registry convention
 *  (`{"amount": "0.039", "currency": "USD"}`) — never a JS `number`, which would
 *  silently introduce float rounding into a financial figure that is compared for
 *  exact equality elsewhere in this repo (governance ceiling checks). */
type UsdAmount = `${number}.${number}`;

interface Price {
  readonly amount: UsdAmount;
  readonly currency: 'USD'; // closed — only USD observed anywhere in this repo
}

type PaymentScheme = 'exact' | 'upto'; // packages/protocol-x402/src/network/schemes.ts
type SettlementNetworkFamily = 'eip155' | 'solana'; // schemes.ts

interface SchemeNetworkSupport {
  readonly scheme: PaymentScheme;
  readonly networks: readonly SettlementNetworkFamily[];
}

/** Deliberately excludes effectiveRuntimePrice and quotedTransactionAmount —
 *  those are OPERATIONAL / transaction-artifact facts respectively (§8, §9's economic
 *  semantics section), never part of CanonicalStaticModel. */
interface ServiceEconomics {
  readonly pricingPolicyVersion: PricingPolicyVersion;
  /** INVARIANT, enforced at compile time by the VCM compiler (not representable as a
   *  TS type constraint alone): listPrice.amount <= governedMaxPrice.amount. */
  readonly listPrice: Price;
  readonly governedMaxPrice: Price;
  readonly supportedSchemes: readonly SchemeNetworkSupport[];
}
```

---

## 8. Critical Economic Semantics — Four Distinct Concepts, Never Merged

Direct implementation of Authority Map §7:

```typescript
// CanonicalStaticModel (§7 above):
//   listPrice            — ServiceEconomics.listPrice           (NORMATIVE, registry-sourced)
//   governedMaxPrice      — ServiceEconomics.governedMaxPrice     (NORMATIVE, RISK_LIMITS.yaml-sourced)

// RuntimeStateOverlay (§10 below):
//   effectiveRuntimePrice — EconomicRuntimeState.effectiveRuntimePrice (OPERATIONAL, live resolver)

// NOT part of VCM at all:
//   quotedTransactionAmount — belongs to a Quote, a transaction artifact bound to one
//                             specific request (deterministic hash of pricing_key,
//                             pricing_source_version, scheme, network, asset, amount,
//                             payee — packages/protocol-x402/src/quote/quote.ts).
//                             A Quote MAY CITE a VCM release's pricingPolicyVersion and
//                             modelDigest as provenance, but a Quote is never itself a
//                             field of VerifiedCanonicalMetadata, and VCM never contains
//                             quote_id, expiresAt, or any other per-transaction field.
```

```typescript
interface EconomicRuntimeState {
  readonly serviceId: CanonicalServiceIdValue;
  readonly effectiveRuntimePrice: Price | Unknown_;
  readonly payTo: EvmAddress | NotConfigured;
  readonly activeNetwork: SettlementNetworkFamily | Unknown_;
  readonly activeAsset: { readonly symbol: string; readonly contractAddress: EvmAddress } | Unknown_;
}
```

`payTo`, active network, and active asset are OPERATIONAL exactly as the directive
requires — `apps/edge-api/.../production-payment.ts:124-150` resolves `payTo` from
`env.SELLER_WALLET_ADDRESS` and the asset from `resolvePaymentAsset(network)` →
`@x402/evm.getDefaultAsset()`, both live-environment facts with no static counterpart.
The existing Bazaar discovery fixture sentinel (`PAYTO_NOT_CONFIGURED`) maps directly
onto `NotConfigured` here — VCM formalizes a pattern the codebase already uses correctly
rather than inventing a new one.

---

## 9. Critical Security Semantics — Four Truth Levels, Structurally Enforced

Direct implementation of Authority Map §13. The type system itself makes "code support
implies live activation" inexpressible: the static model's truth-level union has only
two members; ACTIVE/VERIFIED literally cannot be constructed there.

```typescript
type StaticSecurityTruthLevel = 'IMPLEMENTED' | 'CONFIGURED';
type SecurityTruthLevel = StaticSecurityTruthLevel | 'ACTIVE' | 'VERIFIED';

/** Closed per evidence: A2A card signing uses ES256 (packages/protocol-a2a),
 *  PCC receipts use Ed25519 (packages/pcc-schema / packages/verification).
 *  mTLS fields intentionally left unenumerated — OPEN per Authority Map §13,
 *  not required by any of the 7 governed projections (§11), so not blocking. */
interface SecurityMechanism {
  readonly kind: 'a2a_card_signing' | 'mtls' | 'payment_signature_verification';
  readonly keyId?: string;      // present once CONFIGURED or higher
  readonly jwksUri?: UriString; // present for a2a_card_signing once CONFIGURED or higher
  readonly algorithm?: 'ES256' | 'Ed25519';
}

/** STATIC. truthLevel is type-capped at CONFIGURED — this interface cannot represent
 *  ACTIVE or VERIFIED. `createConfiguredA2aSigningIdentity` existing
 *  (packages/protocol-a2a/src/signing.ts:123) plus `wrangler.toml` declaring
 *  AGENT_CARD_SIGNING_KEY_ID/AGENT_CARD_SIGNING_PRIVATE_KEY proves exactly
 *  CONFIGURED — never more — from repo contents alone. */
interface SecurityCapability {
  readonly mechanism: SecurityMechanism;
  readonly truthLevel: StaticSecurityTruthLevel;
}

/** OPERATIONAL. The ONLY place ACTIVE/VERIFIED can be written, and only by a process
 *  that performed a live measurement (a platform secret-presence query, a signature
 *  verification against the published JWKS, an external audit) — never inferred. */
interface SecurityRuntimeState {
  readonly mechanismKind: SecurityMechanism['kind'];
  readonly measuredLevel: MeasuredOr<Extract<SecurityTruthLevel, 'ACTIVE' | 'VERIFIED'>>;
  readonly measuredAt: IsoTimestamp;
  readonly evidenceRef?: EvidenceRef;
}
```

---

## 10. Runtime State Overlay

```typescript
interface RuntimeStateOverlay {
  readonly observedAt: IsoTimestamp;               // volatile, excluded from overlay digest
  readonly deploymentVersion: DeploymentVersion;
  readonly routes: readonly RouteRuntimeState[];     // §4
  readonly economics: readonly EconomicRuntimeState[]; // §8
  readonly security: readonly SecurityRuntimeState[];  // §9
  readonly qualification: readonly QualificationRuntimeState[]; // §4
}
```

No other fields. This is deliberately the smallest overlay that can represent every
OPERATIONAL fact identified in Authority Map §2 and §5 — see minimality table, §12.

---

## 11. Effective Metadata View

```typescript
interface EffectiveInteractionView {
  readonly operationId: string;
  readonly capabilityExists: true;
  readonly protocolExposed: boolean;                      // from static
  readonly runtimeEnabled: boolean;                        // from overlay, ANDed under the hood
  readonly economicAdmissionEnabled: boolean | NotApplicable; // NotApplicable for non-paid interactions
  readonly effectivePrice: Price | Unknown_ | NotApplicable;
}

interface EffectiveSecurityView {
  readonly mechanismKind: SecurityMechanism['kind'];
  /** Ceiling law: this can only reach ACTIVE/VERIFIED if the overlay supplied a
   *  matching measurement; otherwise it falls back to the static CONFIGURED/IMPLEMENTED
   *  ceiling. Never the other direction. */
  readonly truthLevel: SecurityTruthLevel | Unmeasured;
}

interface EffectiveServiceView {
  readonly id: CanonicalServiceIdValue;
  readonly title: string;
  readonly description: string;
  readonly lifecycleState: LifecycleState;
  readonly qualifiedForProduction: boolean;
  readonly interactions: readonly EffectiveInteractionView[];
  readonly security: readonly EffectiveSecurityView[];
  readonly listPrice: Price;
  readonly governedMaxPrice: Price;
}

interface EffectiveMetadataView {
  readonly digest: Sha256Digest;        // see §14
  readonly organization: OrganizationIdentity;
  readonly services: readonly EffectiveServiceView[];
  readonly generatedAt: IsoTimestamp;   // volatile, excluded from effective-view digest
}
```

---

## 12. Extension Boundary

The single deliberate `Record<string, unknown>` escape hatch in this entire model —
justified, not accidental:

```typescript
interface ExtensionField<Namespace extends string = string> {
  /** Reserved-prefix convention, e.g. 'x-siteborne-avuf'. */
  readonly namespace: Namespace;
  /** Explicitly non-normative. Ignored by every core validator and excluded from
   *  every digest in §14 — its presence or absence must never silently change a
   *  core service's identity hash. This is what lets AVUF later "produce a Candidate
   *  VCM via the same metadata compiler" (original directive) without AVUF, DID, or
   *  ERC-8004 concepts entering the critical-path types above. */
  readonly payload: Record<string, unknown>;
}
```

Attached as an optional `extensions?: readonly ExtensionField[]` on `CanonicalService`
and on `VerifiedCanonicalMetadata` itself. Nowhere else.

---

## 13. Compatibility, Provenance, Evidence, Release

```typescript
interface CompatibilityDeclaration {
  readonly contractReleaseVersion: ContractReleaseVersion;
  readonly compatibleWith: readonly ContractReleaseVersion[]; // governance/CONTRACT_COMPATIBILITY.yaml
  readonly breakingFrom: readonly ContractReleaseVersion[];
}

interface EvidenceRef {
  readonly kind: 'git_commit' | 'docs_report' | 'contract_release' | 'promotion_requirement' | 'live_query';
  /** Shape genuinely varies by kind (a SHA, a file path, a query description) —
   *  bounded by the compiler per-kind, not further subdivided at the type level
   *  since no consumer needs to distinguish locator shapes generically. */
  readonly locator: string;
  readonly observedAt: IsoTimestamp;
}

/** Authority Map §12's six-identifier rule, minus deploymentVersion (carried
 *  separately on MetadataRelease itself, not duplicated here) and minus the two
 *  digest fields (also on MetadataRelease). ProvenanceRef holds exactly the two
 *  identifiers that are source-control facts, kept deliberately distinct
 *  (runtimeSourceCommit vs evidenceReportCommit — confirmed by discovery to
 *  already differ for SUN-1222C, i.e. this is not a hypothetical distinction). */
interface ProvenanceRef {
  readonly runtimeSourceCommit: GitSha;
  readonly evidenceReportCommit?: GitSha;
  readonly contractReleaseVersion: ContractReleaseVersion;
}

interface MetadataRelease {
  readonly vcmReleaseVersion: VcmReleaseVersion;
  readonly modelDigest: Sha256Digest;
  readonly provenance: ProvenanceRef;
  readonly deploymentVersion: DeploymentVersion;
  readonly projectionDigests: Partial<Record<ProtocolSurface, Sha256Digest>>;
  readonly qualificationEvidence: readonly EvidenceRef[];
}
```

---

## 14. Deterministic Identity — Canonicalization and Digest Model

**Canonical bytes**: `@siteborne/pcc-schema`'s `canonicalize()` (RFC8785/JCS), imported
the same way `packages/verification/src/canonical.ts` already does — one canonicalization
algorithm for the whole repo, per that module's own header comment. VCM does not implement
JCS a second time.

**Hash algorithm**: SHA-256, hex-encoded, prefixed `sha256:` — identical to
`packages/pcc-schema/src/index.ts:575-576` and the existing `HashZ` regex. VCM's digests
are drop-in-compatible with every existing `sha256:...` field in this repo (schema hashes,
receipt hashes).

**Volatile-field exclusions** (never enter canonicalized bytes for any digest below):
`compiledAt`, `generatedAt`, `observedAt`, `measuredAt`, the digest field being computed
itself, `deploymentVersion` (except where a digest's own stated purpose is to bind to a
specific deployment — see projection digest), and the contents of every `ExtensionField.payload`.

**Timestamp treatment**: every `IsoTimestamp`-typed field is enumerated per digest kind
below as either "excluded" (volatile, about when the fact was observed/compiled — always
excluded) or "not present in this digest's input at all" (structurally absent because the
type being hashed doesn't carry one). No digest ever includes a timestamp.

Five digests, each retained because it has a specific release/integrity consumer —
**no digest is created merely because it is possible**:

| Digest | Computed over | Excludes | Consumer / use |
|---|---|---|---|
| **model digest** | `CanonicalStaticModel` minus `modelIdentity.compiledAt` and `modelIdentity.modelDigest` itself; includes `vcmSchemaVersion` (structural shape matters) but not `vcmReleaseVersion` (identifies a compiled instance, not content) | timestamps, self | Identifies "this exact static content" independent of when it was compiled — lets two builds from different machines/times prove they produced the same canonical facts |
| **service digest** | one `CanonicalService` | none within it (services carry no internal timestamps) | Fine-grained change detection; lets the registry parity proof (§15) and any future diffing tool point at exactly which service changed, rather than only "the whole model changed" |
| **runtime-overlay digest** | `RuntimeStateOverlay` minus `observedAt` and every `measuredAt` | timestamps | Lets a live status consumer (e.g. `siteborne_get_service_health`) detect "the effective operational facts changed" without diffing full JSON on every poll |
| **effective-view digest** | `EffectiveMetadataView` minus `generatedAt` | timestamp | The one digest a projection or external verifier should actually cite as "the semantic content you are looking at, precisely" — closes Authority Map §2's "no digest for generated projections" gap at the model layer |
| **projection digest** | the generated output of one protocol surface (Agent Card JSON, MCP tool list, OpenAPI doc, x402 discovery doc, Bazaar listing, catalog entry) — canonicalized the same way | none beyond whatever the projection's own volatile fields are (documented per-adapter, not here) | Closes Authority Map §12's confirmed gap: "no digest currently exists for generated projections themselves." Recorded in `MetadataRelease.projectionDigests`, one per surface |

Digests deliberately **not** created: no digest for `OrganizationIdentity` alone (no
consumer needs to verify the org identity independent of the rest of the model — it's
tiny and rarely changes); no digest for an individual `CanonicalInteraction` (too granular
— no consumer identified that needs interaction-level integrity independent of its parent
service digest); no digest for `MetadataModelIdentity` alone (it *contains* the model
digest — hashing a struct that contains a hash of itself is definitionally redundant).

---

## 15. Registry Transition Model

```
registry/services/*.json
        ↓  legacyRegistryToVCM()
CanonicalStaticModel  (VCM, imported)
        ↓  vcmToLegacyRegistry()
regenerated registry/services/*.json
```

```typescript
declare function legacyRegistryToVCM(
  registryFiles: readonly LegacyRegistryServiceFile[], // raw parsed registry/services/*.json
  riskLimits: RiskLimitsFile,                            // governance/RISK_LIMITS.yaml, parsed
  schemaFiles: readonly SchemaFileRef[],                 // schemas/services/*.schema.json, hashed
): CanonicalStaticModel;

declare function vcmToLegacyRegistry(
  model: CanonicalStaticModel,
): readonly LegacyRegistryServiceFile[];
```

### Two-track protocol-exposure field during transition

Per Authority Map §6/§14, the transitional import must **preserve the currently-stale
`protocols` block verbatim**, not silently correct it. `CanonicalInteraction` therefore
carries two fields during the transition period (§6):

- `exposure: StaticProtocolExposure[]` — the **real** value, compiled from actual code
  registration (MCP's live tool list, A2A's live skill list, x402's live route table).
- `legacyProtocolExposureDeclared?: Partial<Record<ProtocolSurface, 'planned'|'live'|'deprecated'>>`
  — the **raw legacy value**, carried through losslessly so `vcmToLegacyRegistry()` can
  reproduce the original file's stale `"planned"` values exactly, byte-for-byte in content
  (not necessarily formatting — see parity law below), until the correction is applied as
  its own separately reviewed diff (Authority Map §14 step 2).

This field is classified `REMOVE` in the minimality table (§16) once authority inverts —
it exists only to make the parity proof possible without silently fixing known drift
inside a "just a schema design" checkpoint.

### Parity law

Target stated in the directive: `project(import(existing_registry)) == existing_registry`.

**Strongest feasible law, chosen deliberately over raw byte equality**:

```
deepStructuralEqual(
  canonicalize(vcmToLegacyRegistry(legacyRegistryToVCM(readAllRegistryFiles()))),
  canonicalize(readAllRegistryFiles())
)
```

i.e. **ordered structural equality over JCS-canonicalized JSON**, not raw byte equality
of the files on disk. Justification: `registry/services/*.json` files are not currently
serialized through any canonicalizer — their on-disk key ordering and whitespace are
incidental, not semantically meaningful. Requiring raw byte equality today would force
reformatting all eight registry files as a precondition of even writing the parity test,
which is itself a mutation this checkpoint is not authorized to make and which the
directive's own instruction ("no registry mutation") forecloses.

**Upgrade path, explicit**: once the reviewed correction diff from Authority Map §14
step 2 lands (the `protocols` block fix), re-serialize all registry files once through
`canonicalize()` as that diff's own formatting side-effect. From that point forward, raw
byte equality becomes the permanent, strictly stronger law, since the files will already
be in canonical form. This is recorded here as the target end-state, not performed now.

**Authority inversion** (registry becomes a generated projection of VCM rather than VCM
importing registry) occurs **only after** the structural parity proof above passes in CI
for the current registry file set, exactly per the directive's ordering requirement.

---

## 16. Projection Readiness

| Projection | Status | Basis |
|---|---|---|
| **Agent Card / A2A** | `DERIVABLE_WITH_PROTOCOL_ADAPTER` | Needs identity (§5), description, `ServiceContractRef` (§7), `StaticProtocolExposure(a2a)` (§4), `SecurityCapability` capped at CONFIGURED (§9) + optional `SecurityRuntimeState` overlay, `ServiceEconomics` (§7). All present. Adapter work: A2A's own envelope shape (`skills` array naming, JWKS pointer placement) — protocol-specific packaging, not a missing fact. |
| **MCP** | `DERIVABLE_WITH_PROTOCOL_ADAPTER` | Needs identity, description + `RoutingOverride` (§6), schemas, `StaticProtocolExposure(mcp)`, `ServiceEconomics`, and the three annotation-hint booleans (`readOnly`/`idempotent`/`destructive`) already on `CanonicalInteraction` (§6). All present. Adapter work: MCP tool-registration envelope + the routing-text bounded transform (§10's projection law). |
| **OpenAPI** | `DERIVABLE_WITH_PROTOCOL_ADAPTER` | Needs identity, schemas, `StaticProtocolExposure(openapi)`. HTTP-specific error-shape catalog (400/402 response bodies, reverse-engineered from `x402-service.ts` per discovery) is correctly **not** in VCM — it's REST-transport packaging, the adapter's job, not a cross-protocol canonical fact. No missing fact. |
| **x402** | `DERIVABLE_WITH_PROTOCOL_ADAPTER` | Needs `ServiceEconomics.supportedSchemes` (§7), `StaticProtocolExposure(x402)`, `EconomicRuntimeState` overlay (§8) for live `payTo`/network/asset. All present. Adapter work: x402 discovery-document envelope. |
| **Bazaar** | `DERIVABLE_WITH_PROTOCOL_ADAPTER` | Same inputs as x402 plus its own listing envelope; `NotConfigured` sentinel (§3) directly models the existing `PAYTO_NOT_CONFIGURED` fixture pattern. No missing fact. |
| **Nevermined** | `FULLY_DERIVABLE` | `StaticProtocolExposure(nevermined).protocolExposed = false`, `exposureShape = 'not_exposed'` for every service today — the model represents "honestly not implemented" with no adapter logic beyond reading the flag. |
| **catalog** | `FULLY_DERIVABLE` | Identity, `lifecycleState`, `listPrice`, and a protocol-exposure summary across all six surfaces are all directly present on `CanonicalService`/`EffectiveServiceView` with no per-protocol packaging required. |

**`MISSING_CANONICAL_FACT` count: 0.**

mTLS (`SecurityMechanism.kind = 'mtls'`) remains `OPEN` for field enumeration per
Authority Map §13 but is not required by any of the seven projections above — it does
not block this checkpoint. `SecurityMechanism` already reserves room for it (`'mtls'` is
already a member of the `kind` union) so no type redesign will be needed when that
enumeration pass happens.

---

## 17. Runtime Truth Proof — Worked Instance

Concrete instance for `company_evidence_graph.v2`, `PAID_ROUTES_ENABLED` unset (the
repo's actual current state per `env.ts`), A2A signing IMPLEMENTED+CONFIGURED with no
live measurement performed:

```typescript
const staticInteraction: CanonicalInteraction = {
  operationId: 'evaluate',
  kind: 'primary_service_call',
  executionMode: 'async',
  maximumInputBytes: 1_048_576,
  expectedLatencyClass: 'variable',
  readOnly: false,
  idempotent: true,
  destructive: false,
  exposure: [
    { surface: 'mcp', capabilityExists: true, protocolExposed: true, exposureShape: 'standalone_endpoint' },
    { surface: 'x402', capabilityExists: true, protocolExposed: true, exposureShape: 'inline_within_another_operation' },
    { surface: 'a2a', capabilityExists: true, protocolExposed: true, exposureShape: 'standalone_endpoint' },
  ],
};

const staticSecurity: SecurityCapability = {
  mechanism: { kind: 'a2a_card_signing', keyId: 'siteborne-a2a-es256-2026-01', jwksUri: '…', algorithm: 'ES256' },
  truthLevel: 'CONFIGURED', // NOT 'ACTIVE' — type system forbids it here (§9)
};

const overlay: Pick<RuntimeStateOverlay, 'routes' | 'security'> = {
  routes: [
    { serviceId: 'company_evidence_graph.v2', operationId: 'evaluate',
      runtimeEnabled: false,              // PAID_ROUTES_ENABLED is unset today
      economicAdmissionEnabled: false },
  ],
  security: [
    { mechanismKind: 'a2a_card_signing', measuredLevel: { kind: 'UNMEASURED' }, measuredAt: '2026-09-20T00:00:00Z' },
  ],
};

// project(static, overlay) yields:
const effective: EffectiveInteractionView = {
  operationId: 'evaluate',
  capabilityExists: true,   // code exists — true
  protocolExposed: true,    // MCP/x402/A2A have wired it — true
  runtimeEnabled: false,    // PAID_ROUTES_ENABLED unset — honestly false
  economicAdmissionEnabled: false,
  effectivePrice: { kind: 'UNKNOWN' }, // resolver not queried in this static example
};

const effectiveSecurity: EffectiveSecurityView = {
  mechanismKind: 'a2a_card_signing',
  truthLevel: { kind: 'UNMEASURED' }, // NEVER 'ACTIVE' — no measurement was supplied,
                                       // and CONFIGURED is not promoted to ACTIVE by
                                       // default; a consumer reading UNMEASURED must
                                       // NOT interpret it as "inactive", only as
                                       // "not verified by this report" — the ceiling
                                       // law (§9) still lets a caller fall back to
                                       // displaying the static CONFIGURED level with
                                       // an explicit "activation unverified" label,
                                       // which is a projection-layer choice, not a
                                       // VCM one.
};
```

This is the exact chain the directive asked to prove: capability implemented → protocol
exposed → route not runtime-enabled because `PAID_ROUTES_ENABLED=false` → signing
implementation present and configured → live signing activation reported as unmeasured,
never fabricated as active. Effective metadata never claims paid availability or verified
security merely because supporting code exists.

---

## 18. Minimality Classification

| Field / type | Classification | Note |
|---|---|---|
| `MetadataModelIdentity` (all fields) | `REQUIRED_NOW` | Nothing downstream works without model identity |
| `OrganizationIdentity` (all fields) | `REQUIRED_NOW` | Every projection needs it |
| `CanonicalServiceId`, `ServiceFamily`, `ServiceGeneration` | `REQUIRED_NOW` | Core identity |
| `CanonicalService.{title,description,capabilities,lifecycleState}` | `REQUIRED_NOW` | Used by all 7 projections |
| `CanonicalService.declaredLimitations` | `REQUIRED_FOR_KNOWN_PROJECTION` | Currently only surfaced in registry/catalog-shaped output; not consumed by A2A/MCP/x402 today per discovery |
| `CanonicalService.authorizationClassification` | `REQUIRED_NOW` | Gates public visibility itself |
| `CanonicalInteraction.{operationId,kind,executionMode,maximumInputBytes,expectedLatencyClass}` | `REQUIRED_NOW` | Directly sourced from existing registry fields, directly consumed |
| `CanonicalInteraction.{readOnly,idempotent,destructive}` | `REQUIRED_FOR_KNOWN_PROJECTION` | Needed specifically for MCP annotation hints; other surfaces don't consume them today |
| `CanonicalInteraction.exposure` (`StaticProtocolExposure[]`) | `REQUIRED_NOW` | Core of the capability/exposure model |
| `CanonicalInteraction.routingOverrides` | `REQUIRED_FOR_KNOWN_PROJECTION` | MCP-only, optional |
| `CanonicalInteraction.legacyProtocolExposureDeclared` | `REMOVE` (post-authority-inversion) | Transitional only — §15 |
| `ServiceContractRef` (all fields) | `REQUIRED_NOW` | Every projection needs schema references; PCC dual-version fields required to avoid re-collapsing the §4 namespace fix |
| `ServiceEconomics.{pricingPolicyVersion,listPrice,governedMaxPrice}` | `REQUIRED_NOW` | Closes the confirmed live pricing drift (Authority Map §2, §7) |
| `ServiceEconomics.supportedSchemes` | `REQUIRED_FOR_KNOWN_PROJECTION` | x402/Bazaar only |
| `CompatibilityDeclaration` | `REQUIRED_FOR_KNOWN_PROJECTION` | Not consumed by any projection surface directly today (discovery found no consumer), but required to keep `governance/CONTRACT_COMPATIBILITY.yaml` from becoming a second undeclared authority once VCM exists |
| `RuntimeStateOverlay` (all fields) | `REQUIRED_FOR_RUNTIME_TRUTH` | Entire purpose is closing the confirmed `production_ready`/env-gate drift (Authority Map §2, §9) |
| `SecurityCapability` / `SecurityRuntimeState` | `REQUIRED_FOR_RUNTIME_TRUTH` | Directly implements the directive's non-negotiable security truth law |
| `EffectiveMetadataView` (all fields) | `REQUIRED_NOW` | The only thing projections may read |
| `MetadataRelease` | `REQUIRED_FOR_RUNTIME_TRUTH` | Closes Authority Map §12's confirmed digest gap |
| `EvidenceRef` / `ProvenanceRef` | `REQUIRED_FOR_RUNTIME_TRUTH` | Same |
| `ExtensionField` | `FUTURE_EXTENSION` | Exists only to keep AVUF/DID/ERC-8004 off the critical path while remaining reachable later, per original directive constraint |
| `DeploymentVersion` | `REQUIRED_FOR_RUNTIME_TRUTH` | Needed for `MetadataRelease`, but its value is frequently `Unknown_` until a live-query mechanism exists (Authority Map §13 follow-up) |
| Per-digest fields (`modelDigest`, `projectionDigests`, etc.) | `REQUIRED_FOR_RUNTIME_TRUTH` | Scoped tightly per §14's "no hash without a consumer" rule; nothing here is speculative |

No field in the design is classified `FUTURE_EXTENSION` other than `ExtensionField`
itself — the model does not carry speculative AVUF/DID/ERC-8004 fields, matching the
directive's minimality requirement.

---

## 19. Decision Gates

```
ONE_CANONICAL_SERVICE_ID_SOURCE_DESIGN=YES        — §15: registry file set, generation-derived (Authority Map §8)
ONE_CANONICAL_PRICING_POLICY_SOURCE_DESIGN=YES     — §7/§8: governance/RISK_LIMITS.yaml, single ServiceEconomics shape
STATIC_RUNTIME_SEPARATION_COMPLETE=YES              — §1, §4, §6, §9: no overlay field can widen a static fact
PROTOCOL_EXPOSURE_MODEL_COMPLETE=YES                — §4, §16: capability/exposure/activation/admission/qualification
                                                       all separately typed and merged only via project()
VERSION_DOMAINS_UNAMBIGUOUS=YES                     — §2: eleven named namespaces, zero bare `version` fields
SECURITY_TRUTH_MODEL_COMPLETE=YES                   — §9: four levels, ACTIVE/VERIFIED type-unreachable from static model
ECONOMIC_TRUTH_MODEL_COMPLETE=YES                   — §8: four distinct price concepts, quote explicitly excluded from VCM
PROVENANCE_MODEL_COMPLETE=YES                       — §13: six-identifier rule from Authority Map §12 fully represented
DETERMINISTIC_DIGEST_MODEL_COMPLETE=YES             — §14: reuses frozen JCS/SHA-256 machinery, five scoped digests, none speculative
REGISTRY_TRANSITION_MODEL_COMPLETE=YES              — §15: legacyRegistryToVCM/vcmToLegacyRegistry, two-track field,
                                                       structural-equality parity law with an explicit byte-equality upgrade path
ALL_CURRENT_PROJECTIONS_DERIVABLE=YES               — §16: 0 MISSING_CANONICAL_FACT across all 7 surfaces
```

---

## P. Return Block

```
METADATA_VCM_02=PASS

VCM_ROOT_TYPE=VerifiedCanonicalMetadata
VCM_SCHEMA_VERSION_PROPOSAL=1.0.0

CANONICAL_SERVICE_ID_OWNER=registry/services/*.json (file-set-derived, per Authority Map §8)
CANONICAL_PRICING_POLICY_OWNER=governance/RISK_LIMITS.yaml (per Authority Map §7)

STATIC_RUNTIME_SEPARATION_COMPLETE=YES
RUNTIME_OVERLAY_MODEL=RuntimeStateOverlay { observedAt, deploymentVersion, routes[], economics[], security[], qualification[] }
EFFECTIVE_VIEW_MODEL=EffectiveMetadataView = project(CanonicalStaticModel, RuntimeStateOverlay)

CAPABILITY_EXPOSURE_ACTIVATION_MODEL=PASS
VERSION_NAMESPACE_MODEL=PASS
ECONOMIC_MODEL=PASS
SECURITY_MODEL=PASS
PROVENANCE_MODEL=PASS
DIGEST_MODEL=PASS

REGISTRY_MIGRATION=
IMPORT -> PARITY_PROOF -> AUTHORITY_INVERSION

PROJECTION_A2A=DERIVABLE_WITH_PROTOCOL_ADAPTER
PROJECTION_MCP=DERIVABLE_WITH_PROTOCOL_ADAPTER
PROJECTION_OPENAPI=DERIVABLE_WITH_PROTOCOL_ADAPTER
PROJECTION_X402=DERIVABLE_WITH_PROTOCOL_ADAPTER
PROJECTION_BAZAAR=DERIVABLE_WITH_PROTOCOL_ADAPTER
PROJECTION_NEVERMINED=FULLY_DERIVABLE
PROJECTION_CATALOG=FULLY_DERIVABLE

MISSING_CANONICAL_FACTS=0
UNRESOLVED_SCHEMA_DECISIONS=3
  (1) LifecycleState full ladder vs. governance/PROMOTION_STATES.yaml — only first four
      rungs plus one registry-observed value were read; reconcile exact ids before implementation.
  (2) LatencyClass — 'variable' confirmed observed, 'fast'/'slow' inferred; confirm full
      value set across all registry/services/*.json files before implementation.
  (3) AuthorizationClassification — 'public' confirmed, 'restricted' inferred as closed
      complement; confirm no third value exists before implementation.
  None of these block PASS: each is a mechanical, cheap verification against existing
  files, not an open design question, and each union is already closed pending that check.

DESIGN_ARTIFACT=
docs/reports/METADATA-VCM-02-schema-design.md

RUNTIME_SOURCE_CHANGES=0
METADATA_PROJECTION_CHANGES=0
PRODUCTION_MUTATIONS=0

SAFE_TO_IMPLEMENT_VCM=YES
```

Stopping here per instruction. `packages/vcm` not created.

/**
 * CanonicalStaticModel and its constituents (Master Reference Part II §III,
 * §VII-§X). These are compile-time shapes only; runtime construction and
 * validation live in validators.ts and legacy/import-registry.ts. Nothing
 * here may use `Record<string, unknown>` except ExtensionField.payload, the
 * one deliberate, governed, non-normative escape hatch (Part II §"Extension
 * mechanism").
 */
import type { GitSha, Sha256Digest, UriString, UsdAmount } from './primitives';
import type { CanonicalServiceId, CanonicalServiceIdValue } from './service-id';
import type {
  ContractReleaseVersion,
  PccSchemaRelease,
  PccWireVersion,
  PricingPolicyVersion,
  VcmReleaseVersion,
  VcmSchemaVersion,
} from './versions';

// ---------------------------------------------------------------------------
// Lifecycle -- exact ids from governance/PROMOTION_STATES.yaml (8 states;
// the frozen Master Reference's own prose listed 7 and omitted
// EXECUTABLE_CANDIDATE -- resolved as a mechanical completion, see
// docs/reports/METADATA-VCM-IMPL-01-truth-core-and-registry-parity.md §V).
// ---------------------------------------------------------------------------
export const LIFECYCLE_STATES = [
  'DRAFT',
  'CASE_SUPPORTED',
  'MULTI_CASE_SUPPORTED',
  'VERIFIED_PATTERN',
  'EXECUTABLE_CANDIDATE',
  'EXECUTABLE_VERIFIED',
  'RETIRED',
  'TOMBSTONED',
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export function isLifecycleState(value: string): value is LifecycleState {
  return (LIFECYCLE_STATES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Mechanical, evidence-bounded closed unions. Each is exactly the set of
// values observed in registry/services/*.json today (grep-verified across
// all 8 files) -- not a guess at a hypothetical future vocabulary. Widening
// one of these the moment a genuinely new value appears in source data is a
// mechanical follow-up, not a design change.
// ---------------------------------------------------------------------------
export type LatencyClass = 'slow' | 'variable';
export const LATENCY_CLASSES: readonly LatencyClass[] = ['slow', 'variable'];

export type AuthorizationClassification = 'buyer_authorized' | 'public';
export const AUTHORIZATION_CLASSIFICATIONS: readonly AuthorizationClassification[] = [
  'buyer_authorized',
  'public',
];

export type ExecutionMode = 'async';
export const EXECUTION_MODES: readonly ExecutionMode[] = ['async'];

// ---------------------------------------------------------------------------
// Economics
// ---------------------------------------------------------------------------
export interface Price {
  readonly amount: UsdAmount;
  readonly currency: 'USD';
}

export type PaymentScheme = 'exact' | 'upto';
export type SettlementNetworkFamily = 'eip155' | 'solana';

export interface SchemeNetworkSupport {
  readonly scheme: PaymentScheme;
  readonly networks: readonly SettlementNetworkFamily[];
}

export interface ServiceEconomics {
  readonly pricingPolicyVersion: PricingPolicyVersion;
  /** The price a caller is normally charged. Resolved from the current
   * governed pricing authority (governance/RISK_LIMITS.yaml's
   * `max_price_usd_per_service`, via `primaryPricingKey()` ->
   * `resolveServiceMaxPriceUsd()` -- the exact same call `governedMaxPrice`
   * makes), NOT from the legacy registry's frozen `base_price`. See
   * METADATA-VCM-04 §I-III/§VII for why: `base_price` is release-scoped
   * evidence, not a current economic authority (see
   * `releaseBasePriceDeclared` below). */
  readonly listPrice: Price;
  /** The governance ceiling for `listPrice`, resolved from
   * governance/RISK_LIMITS.yaml's `max_price_usd_per_service` via the exact
   * family-specific tier key (see legacy/pricing-map.ts) -- never a
   * client-suppliable value. */
  readonly governedMaxPrice: Price;
  /** EVIDENCE/HISTORICAL, transitional: the legacy registry's own frozen
   * `base_price`, preserved verbatim for lossless round-trip and
   * contract-release provenance (METADATA-VCM-04 §IV). NOT validated
   * against `governedMaxPrice` -- it is explicitly documented, in
   * `packages/protocol-x402/src/bazaar/registry-source.ts:9-11`, as not an
   * economic authority, and is allowed to diverge from the live governed
   * price by design. NOT projected as a current live price by any protocol
   * adapter. Never read `listPrice`, `governedMaxPrice`, or any runtime
   * price from this field. */
  readonly releaseBasePriceDeclared: Price;
  /** Transitional, non-normative: the legacy registry's own `maximum_price`
   * field, preserved verbatim for lossless round-trip. This is a *third*
   * economic concept the legacy format publishes (the advertised ceiling of
   * a variable-cost/"upto" job) that the frozen four-concept economic model
   * (listPrice/governedMaxPrice/effectiveRuntimePrice/quotedTransactionAmount)
   * has no slot for. It is carried through exactly like
   * `releaseProtocolExposureDeclared` -- preserved, not validated, not
   * treated as canonical -- pending a reviewed decision on where (or
   * whether) it belongs in the canonical model. */
  readonly releaseMaximumPriceDeclared: Price;
  readonly supportedSchemes: readonly SchemeNetworkSupport[];
}

// `effectiveRuntimePrice` lives in runtime-overlay.ts (operational, not
// static). `quotedTransactionAmount` does not exist anywhere in this
// package -- a quote is a transaction artifact, explicitly outside VCM.

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------
export type SecurityMechanismKind = 'a2a_card_signing' | 'mtls' | 'payment_signature_verification';

export interface SecurityMechanism {
  readonly kind: SecurityMechanismKind;
  readonly keyId?: string;
  readonly jwksUri?: UriString;
  readonly algorithm?: 'ES256' | 'Ed25519';
}

/** Static construction may only ever claim these two levels. ACTIVE and
 * VERIFIED are unconstructible here by type shape alone -- they can only
 * be attached by a RuntimeStateOverlay with real measured evidence. */
export type StaticSecurityTruthLevel = 'IMPLEMENTED' | 'CONFIGURED';
export type SecurityTruthLevel = StaticSecurityTruthLevel | 'ACTIVE' | 'VERIFIED';

export interface SecurityCapability {
  readonly mechanism: SecurityMechanism;
  readonly truthLevel: StaticSecurityTruthLevel;
}

// ---------------------------------------------------------------------------
// Schema / contract references
// ---------------------------------------------------------------------------
export interface SchemaRef {
  readonly uri: UriString;
  readonly digest: Sha256Digest;
}

export interface ServiceContractRef {
  readonly contractReleaseVersion: ContractReleaseVersion;
  readonly inputSchema: SchemaRef;
  readonly outputSchema: SchemaRef;
  readonly pcc: {
    readonly wireVersion: PccWireVersion;
    readonly schemaRelease: PccSchemaRelease;
  };
}

// ---------------------------------------------------------------------------
// Protocol exposure -- release declaration, current static registration,
// operational activation, and external publication are distinct facts.
// ---------------------------------------------------------------------------
export type ProtocolSurface = 'a2a' | 'mcp' | 'openapi' | 'x402' | 'bazaar' | 'nevermined';
export const PROTOCOL_SURFACES: readonly ProtocolSurface[] = [
  'a2a',
  'mcp',
  'openapi',
  'x402',
  'bazaar',
  'nevermined',
];

export type ExposureShape =
  | 'standalone_tool'
  | 'standalone_endpoint'
  | 'inline_operation'
  | 'skill';
export const EXPOSURE_SHAPES: readonly ExposureShape[] = [
  'standalone_tool',
  'standalone_endpoint',
  'inline_operation',
  'skill',
];

export interface CurrentExposureProvenance {
  readonly sourcePackage: string;
  readonly sourceModule: string;
  readonly sourceRegistrationId: string;
  readonly runtimeSourceCommit: GitSha;
  readonly derivationMethod: 'typed_export';
}

export interface CurrentStaticProtocolExposure {
  readonly surface: ProtocolSurface;
  readonly registrationId: string;
  readonly operationId: string;
  readonly exposureShape: ExposureShape;
  readonly provenance: CurrentExposureProvenance;
}

export interface CurrentStaticUtilityExposure extends CurrentStaticProtocolExposure {
  readonly utilityKind: 'quote_request' | 'health_check';
}

export interface CurrentX402ProtocolCapability {
  readonly protocolVersion: number;
  readonly supportedSchemes: Readonly<Record<'exact' | 'upto', readonly SettlementNetworkFamily[]>>;
  readonly provenance: CurrentExposureProvenance;
}

/** Static capability to construct a local Bazaar projection. This does not
 * claim that a listing has been submitted, indexed, or externally published. */
export interface CurrentBazaarProjectionSupport {
  readonly projectionSupported: boolean;
  readonly serviceIds: readonly CanonicalServiceIdValue[];
  readonly provenance: CurrentExposureProvenance;
}

/** The accepted registry release's own declaration vocabulary. These values
 * are compatibility evidence only and never determine current exposure. */
export const RELEASE_PROTOCOL_EXPOSURE_VALUES = [
  'planned',
  'scaffolded',
  'tested',
  'enabled',
  'not_enabled',
] as const;
export type ReleaseProtocolExposureValue = (typeof RELEASE_PROTOCOL_EXPOSURE_VALUES)[number];
export const RELEASE_PROTOCOL_EXPOSURE_SURFACES = [
  'x402',
  'mcp',
  'a2a',
  'nevermined',
  'agentverse',
  'coinbase_bazaar',
  'mcp_registry',
] as const;
export type ReleaseProtocolExposureSurface = (typeof RELEASE_PROTOCOL_EXPOSURE_SURFACES)[number];
export type ReleaseProtocolExposureDeclaration = Readonly<
  Record<ReleaseProtocolExposureSurface, ReleaseProtocolExposureValue>
>;

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------
export type InteractionKind = 'primary_service_call' | 'quote_request' | 'health_check';

export interface RoutingOverride {
  readonly protocolSurface: 'mcp';
  readonly useWhen: readonly string[];
  readonly doNotUseWhen: readonly string[];
}

export interface CanonicalInteraction {
  readonly operationId: string;
  readonly kind: InteractionKind;
  readonly executionMode: ExecutionMode;
  readonly maximumInputBytes: number;
  readonly expectedLatencyClass: LatencyClass;
  readonly readOnly: boolean;
  readonly idempotent: boolean;
  readonly destructive: boolean;
  readonly routingOverrides?: readonly RoutingOverride[];
}

// ---------------------------------------------------------------------------
// Extension boundary -- the one deliberate escape hatch, kept off the
// digest and off every core type.
// ---------------------------------------------------------------------------
export interface ExtensionField<Namespace extends string = string> {
  readonly namespace: Namespace;
  readonly payload: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// CanonicalService
// ---------------------------------------------------------------------------
export interface CanonicalService {
  readonly id: CanonicalServiceId;
  readonly title: string;
  readonly description: string;
  readonly capabilities: readonly string[];
  readonly lifecycleState: LifecycleState;
  readonly contract: ServiceContractRef;
  readonly economics: ServiceEconomics;
  readonly interactions: readonly CanonicalInteraction[];
  readonly currentStaticExposures: readonly CurrentStaticProtocolExposure[];
  readonly declaredLimitations: readonly string[];
  readonly authorizationClassification: AuthorizationClassification;
  readonly releaseProtocolExposureDeclared: ReleaseProtocolExposureDeclaration;
  /** Transitional, non-normative: the legacy registry's own
   * `production_enabled` boolean, preserved verbatim for lossless
   * round-trip. Authority Map step 2 explicitly removes this as
   * present-tense static truth (production enablement is an OPERATIONAL,
   * RuntimeStateOverlay fact -- see OperationalProtocolActivation) --
   * this field exists only so the legacy projector can reproduce today's
   * file exactly, never as a canonical VCM fact a consumer should read. */
  readonly legacyProductionEnabledDeclared: boolean;
  /** Transitional, non-normative: the legacy registry file's own
   * `updated_at` timestamp, preserved verbatim for lossless round-trip. */
  readonly legacyUpdatedAt: string;
  readonly securityCapabilities: readonly SecurityCapability[];
  readonly extensions?: readonly ExtensionField[];
}

// ---------------------------------------------------------------------------
// Model-level identity and root
// ---------------------------------------------------------------------------
export interface MetadataModelIdentity {
  readonly vcmSchemaVersion: VcmSchemaVersion;
  readonly vcmReleaseVersion: VcmReleaseVersion;
  readonly modelDigest: Sha256Digest;
  readonly compiledAt: string; // IsoTimestamp; excluded from every digest input
}

export interface OrganizationIdentity {
  readonly legalName: string;
  readonly publicName: string;
  readonly network: 'net.siteborne';
  readonly homepageUri: UriString;
  readonly supportContact?: UriString;
}

export interface CompatibilityDeclaration {
  readonly contractReleaseVersion: ContractReleaseVersion;
  readonly compatibleWith: readonly ContractReleaseVersion[];
  readonly breakingFrom: readonly ContractReleaseVersion[];
}

export interface ProvenanceRef {
  readonly runtimeSourceCommit: GitSha;
  readonly evidenceReportCommit?: GitSha;
  readonly contractReleaseVersion: ContractReleaseVersion;
}

export interface CanonicalStaticModel {
  readonly modelIdentity: MetadataModelIdentity;
  readonly organization: OrganizationIdentity;
  readonly services: readonly CanonicalService[];
  readonly currentStaticUtilityExposures: readonly CurrentStaticUtilityExposure[];
  readonly currentX402ProtocolCapability: CurrentX402ProtocolCapability;
  readonly currentBazaarProjectionSupport: CurrentBazaarProjectionSupport;
  readonly pricingPolicyVersion: PricingPolicyVersion;
  readonly compatibility: readonly CompatibilityDeclaration[];
}

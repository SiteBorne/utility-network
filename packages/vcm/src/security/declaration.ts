/**
 * PRODUCTION-SECURITY-DECLARATIONS-01 -- the canonical Release-1
 * SecurityDeclarationBundle.
 *
 * Truthfulness rules (Security Constitution v2):
 *  - Describes what current code ENFORCES. Future AuthorityGrant/Lease/
 *    CommitGrant/SettlementGrant objects are reserved names only.
 *  - No external system grants SITEBORNE authority; external systems supply
 *    evidence or mechanisms.
 *  - Capability bindings are DERIVED from the governed economic contract
 *    (`@siteborne/pricing`), never hand-copied, so availability cannot drift.
 *  - `privateEvidenceRef` fields point at internal source and MUST NOT reach
 *    any public projection (project.ts builds public output from an
 *    allowlist and never spreads a canonical object).
 *
 * Nothing here is served. This module is a shadow authority in the same
 * sense as the rest of `@siteborne/vcm`: projections validate against it.
 */
import {
  ECONOMIC_SERVICE_IDS,
  buildEconomicOffer,
  type EconomicOffer,
  type EconomicServiceId,
} from '@siteborne/pricing';
import type { SecurityTruthLevel } from '../types';
import {
  EVIDENCE_CLASSES,
  RESERVED_FUTURE_OBJECT_NAMES,
  SECURITY_DECLARATION_SCHEMA_VERSION,
  type EconomicEffect,
  type EvidenceClass,
  type ExecutionEffect,
  type ImplementationStatus,
  type SecurityDeclarationSchemaVersion,
} from './vocabulary';

/** live_exercised: observed in the real paid canaries. source_implemented:
 * present in source; this declaration makes no coverage claim beyond that.
 * not_exercised: implemented or declared but never exercised end to end. */
export type Qualification = 'live_exercised' | 'source_implemented' | 'not_exercised';

export interface Statement {
  readonly id: string;
  /** Public-safe, human-readable semantics. */
  readonly statement: string;
  readonly status: ImplementationStatus;
  readonly qualification: Qualification;
  /** PRIVATE. Internal source pointer. Never projected. */
  readonly privateEvidenceRef?: string;
}

export type SecurityProfileId = 'PUBLIC_DISCOVERY' | 'PUBLIC_ECONOMIC_X402';

export interface SecurityProfile {
  readonly id: SecurityProfileId;
  readonly authentication: 'none';
  readonly identity: 'not_established';
  readonly economicAuthorization: 'none' | 'x402_quote_bound_payment_authorization';
  readonly executionAuthorityCondition: string;
  readonly assurance: 'none' | 'pcc_receipt_generated_before_settlement';
  readonly resultAccess: 'public_metadata' | 'paid_response_only_no_retrieval_route';
  readonly settlementCondition: 'none' | 'after_execution_and_receipt_generation';
  readonly runtimeQualification: 'release_qualification' | 'qualified_runtime_required';
  readonly executionEffects: readonly ExecutionEffect[];
  readonly economicEffects: readonly EconomicEffect[];
  readonly credentialHandling: string;
  readonly status: ImplementationStatus;
  readonly qualification: Qualification;
}

export type DataFlow =
  | 'none'
  | 'supplied_material_only_no_egress'
  | 'outbound_public_web_retrieval'
  | 'third_party_provider_retrieval';

export interface CapabilitySecurityBinding {
  readonly id: string;
  readonly capability: string;
  readonly mode: string;
  readonly kind: 'paid_service' | 'discovery_tool';
  readonly economicMechanism: 'x402' | 'nevermined' | 'none';
  readonly available: boolean;
  readonly purchasable: boolean;
  /** null when closed: a closed capability must never carry an enabled profile. */
  readonly securityProfile: SecurityProfileId | null;
  readonly economicAuthorizationRequired: boolean;
  readonly executionEffect: ExecutionEffect;
  readonly informationEffect: {
    readonly dataFlow: DataFlow;
    readonly inputHandling: 'caller_supplied_untrusted' | 'none';
    readonly retention: 'result_and_audit_persisted_duration_unspecified' | 'none';
    readonly callerBindingRequirement: 'not_applicable_no_retrieval_route' | 'none';
  };
  readonly economicEffects: readonly EconomicEffect[];
  readonly settlementReversibility: 'irreversible' | 'not_applicable';
  readonly assuranceRequirement: 'pcc_receipt_generated_before_settlement' | 'none';
  readonly resultSemantics:
    | 'delivered_in_paid_response_no_retrieval_route'
    | 'public_metadata'
    | 'none';
  readonly runtimeQualification: 'qualified_runtime_required' | 'release_qualification' | 'none';
  readonly admission: 'first_release_candidate' | 'closed_not_admitted';
  readonly closedReason?: string;
  readonly implementationStatus: ImplementationStatus;
  /** PRIVATE. */
  readonly privateEvidenceRef?: string;
}

export interface EvidenceSemantics {
  readonly evidenceClass: EvidenceClass;
  readonly support: 'supported_today' | 'future_recognized' | 'unsupported_today';
  readonly status: ImplementationStatus;
  /** Always false: no evidence class implies caller identity by itself. */
  readonly mayImplyIdentity: false;
  /** Always false: no evidence class widens permission by itself. */
  readonly mayWidenAuthority: false;
  readonly mayOnlySatisfy: string;
  readonly note: string;
}

export interface KeyPurpose {
  readonly purpose: string;
  readonly algorithm: string | null;
  readonly status: ImplementationStatus;
  /** What is actually proven about separation from other purposes. */
  readonly separationBasis:
    | 'distinct_configuration_binding'
    | 'not_applicable_symmetric'
    | 'not_asserted';
  readonly note: string;
}

export interface NegativeDeclaration {
  readonly feature: string;
  readonly status: ImplementationStatus;
  readonly note: string;
}

export interface SecurityDeclarationBundle {
  readonly schemaVersion: SecurityDeclarationSchemaVersion | string;
  readonly declarationVersion: string;
  readonly compatibility: {
    readonly supportedSchemaVersions: readonly string[];
    readonly unknownVersionBehavior: 'denied';
    readonly bindsToDeploymentVersion: false;
  };
  /** Static declarations never assert ACTIVE/VERIFIED (Authority Map §I.13). */
  readonly truthLevelCeiling: Extract<SecurityTruthLevel, 'IMPLEMENTED' | 'CONFIGURED'>;
  readonly authorityModel: {
    readonly governingRule: string;
    readonly frozenDistinctions: readonly (readonly [string, string])[];
    readonly invariants: readonly Statement[];
  };
  readonly policySemantics: readonly Statement[];
  readonly supportedSecurityProfiles: readonly SecurityProfile[];
  readonly capabilitySecurityBindings: readonly CapabilitySecurityBinding[];
  readonly evidenceSemantics: readonly EvidenceSemantics[];
  readonly runtimeQualification: readonly Statement[];
  readonly effectSemantics: {
    readonly execution: readonly ExecutionEffect[];
    readonly economic: readonly EconomicEffect[];
    readonly note: string;
  };
  readonly resultSecurity: readonly Statement[];
  readonly economicSecurity: readonly Statement[];
  readonly credentialBoundaries: readonly Statement[];
  readonly keyPurposeBoundaries: readonly KeyPurpose[];
  readonly hostileContentBoundaries: readonly Statement[];
  readonly unsupportedSecurityFeatures: readonly NegativeDeclaration[];
  readonly reservedFutureObjects: readonly string[];
  readonly implementationStatus: { readonly vocabulary: readonly ImplementationStatus[] };
  readonly provenance: {
    readonly publicationState: 'additive_metadata_projection';
    readonly qualification: 'source_qualified';
  };
}

const s = (
  id: string,
  statement: string,
  status: ImplementationStatus,
  qualification: Qualification,
  privateEvidenceRef?: string
): Statement => ({
  id,
  statement,
  status,
  qualification,
  ...(privateEvidenceRef ? { privateEvidenceRef } : {}),
});

const E = 'IMPLEMENTED_ENFORCED' as const;
const O = 'IMPLEMENTED_OBSERVATIONAL' as const;
const F = 'DECLARED_FUTURE' as const;
const U = 'UNSUPPORTED' as const;

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------
const PROFILES: readonly SecurityProfile[] = [
  {
    id: 'PUBLIC_DISCOVERY',
    authentication: 'none',
    identity: 'not_established',
    economicAuthorization: 'none',
    executionAuthorityCondition: 'none_required_public_metadata_only',
    assurance: 'none',
    resultAccess: 'public_metadata',
    settlementCondition: 'none',
    runtimeQualification: 'release_qualification',
    executionEffects: ['read_only'],
    economicEffects: ['none'],
    credentialHandling: 'no_credentials_accepted_or_required',
    status: E,
    qualification: 'live_exercised',
  },
  {
    id: 'PUBLIC_ECONOMIC_X402',
    authentication: 'none',
    identity: 'not_established',
    economicAuthorization: 'x402_quote_bound_payment_authorization',
    executionAuthorityCondition:
      'verified_quote_bound_payment_authorization_and_governed_route_and_mode_admission',
    assurance: 'pcc_receipt_generated_before_settlement',
    resultAccess: 'paid_response_only_no_retrieval_route',
    settlementCondition: 'after_execution_and_receipt_generation',
    runtimeQualification: 'qualified_runtime_required',
    executionEffects: ['read_only'],
    economicEffects: ['authorize', 'settle'],
    credentialHandling: 'buyer_signs_locally_server_receives_signed_authorization_only',
    status: E,
    qualification: 'live_exercised',
  },
];

// ---------------------------------------------------------------------------
// Capability bindings -- derived from the governed economic contract
// ---------------------------------------------------------------------------
function dataFlowFor(offer: EconomicOffer): DataFlow {
  if (!offer.openWorld) return 'supplied_material_only_no_egress';
  return offer.capabilityId === 'web_context_verified'
    ? 'outbound_public_web_retrieval'
    : 'third_party_provider_retrieval';
}

function paidBinding(
  offer: EconomicOffer,
  mode: string,
  modeAvailable: boolean,
  unavailableReason: string | undefined
): CapabilitySecurityBinding {
  const admitted = offer.releasePosture === 'first_release_candidate' && modeAvailable;
  const closedReason = admitted
    ? undefined
    : !modeAvailable
      ? (unavailableReason ?? 'mode_not_available')
      : offer.releasePosture === 'compatibility_not_admitted'
        ? 'legacy_compatibility_generation_not_admitted'
        : 'closed_for_initial_paid_release';
  return {
    id: `${offer.serviceId}/${mode}`,
    capability: offer.serviceId,
    mode,
    kind: 'paid_service',
    economicMechanism: 'x402',
    available: admitted,
    purchasable: admitted,
    securityProfile: admitted ? 'PUBLIC_ECONOMIC_X402' : null,
    economicAuthorizationRequired: admitted,
    executionEffect: 'read_only',
    informationEffect: {
      dataFlow: dataFlowFor(offer),
      inputHandling: 'caller_supplied_untrusted',
      retention: 'result_and_audit_persisted_duration_unspecified',
      callerBindingRequirement: 'not_applicable_no_retrieval_route',
    },
    economicEffects: admitted ? ['authorize', 'settle'] : ['none'],
    settlementReversibility: admitted ? 'irreversible' : 'not_applicable',
    assuranceRequirement: admitted ? 'pcc_receipt_generated_before_settlement' : 'none',
    resultSemantics: admitted ? 'delivered_in_paid_response_no_retrieval_route' : 'none',
    runtimeQualification: admitted ? 'qualified_runtime_required' : 'none',
    admission: admitted ? 'first_release_candidate' : 'closed_not_admitted',
    ...(closedReason ? { closedReason } : {}),
    implementationStatus: admitted ? E : U,
    privateEvidenceRef:
      'packages/pricing/src/economic-contract.ts (releasePosture, modes[].available)',
  };
}

function neverminedBinding(serviceId: EconomicServiceId): CapabilitySecurityBinding {
  return {
    id: `${serviceId}/nevermined`,
    capability: serviceId,
    mode: 'nevermined',
    kind: 'paid_service',
    economicMechanism: 'nevermined',
    available: false,
    purchasable: false,
    securityProfile: null,
    economicAuthorizationRequired: false,
    executionEffect: 'read_only',
    informationEffect: {
      dataFlow: 'none',
      inputHandling: 'none',
      retention: 'none',
      callerBindingRequirement: 'none',
    },
    economicEffects: ['none'],
    settlementReversibility: 'not_applicable',
    assuranceRequirement: 'none',
    resultSemantics: 'none',
    runtimeQualification: 'none',
    admission: 'closed_not_admitted',
    closedReason: 'nevermined_paid_execution_closed_for_initial_paid_release',
    implementationStatus: U,
    privateEvidenceRef:
      'apps/edge-api/src/index.ts (/v2/nevermined/* gated NEVERMINED_ROUTES_ENABLED)',
  };
}

function discoveryBinding(id: string, tool: string): CapabilitySecurityBinding {
  return {
    id,
    capability: tool,
    mode: 'read',
    kind: 'discovery_tool',
    economicMechanism: 'none',
    available: true,
    purchasable: false,
    securityProfile: 'PUBLIC_DISCOVERY',
    economicAuthorizationRequired: false,
    executionEffect: 'read_only',
    informationEffect: {
      dataFlow: 'none',
      inputHandling: 'caller_supplied_untrusted',
      retention: 'none',
      callerBindingRequirement: 'none',
    },
    economicEffects: ['none'],
    settlementReversibility: 'not_applicable',
    assuranceRequirement: 'none',
    resultSemantics: 'public_metadata',
    runtimeQualification: 'release_qualification',
    admission: 'first_release_candidate',
    implementationStatus: E,
    privateEvidenceRef: 'packages/protocol-mcp/src/server.ts (utility tool annotations)',
  };
}

export function buildCapabilityBindings(): readonly CapabilitySecurityBinding[] {
  const bindings: CapabilitySecurityBinding[] = [];
  for (const serviceId of ECONOMIC_SERVICE_IDS) {
    const offer = buildEconomicOffer(serviceId);
    for (const m of offer.modes) {
      bindings.push(paidBinding(offer, m.mode, m.available, m.unavailableReason));
    }
    if (serviceId.endsWith('.v2')) bindings.push(neverminedBinding(serviceId));
  }
  bindings.push(discoveryBinding('mcp:siteborne_get_quote', 'siteborne_get_quote'));
  bindings.push(
    discoveryBinding('mcp:siteborne_get_service_health', 'siteborne_get_service_health')
  );
  return bindings;
}

// ---------------------------------------------------------------------------
// Evidence semantics
// ---------------------------------------------------------------------------
const EVIDENCE_TABLE: Readonly<
  Record<
    EvidenceClass,
    {
      support: EvidenceSemantics['support'];
      status: ImplementationStatus;
      only: string;
      note: string;
    }
  >
> = {
  IDENTITY_PROOF: {
    support: 'unsupported_today',
    status: U,
    only: 'none',
    note: 'No caller identity mechanism exists in Release 1. Payment evidence is not identity evidence.',
  },
  POSSESSION_PROOF: {
    support: 'future_recognized',
    status: F,
    only: 'a_future_possession_requirement',
    note: 'A future proof-of-possession (for example DPoP) would bind a request to a key. It is not client authentication.',
  },
  DELEGATION_MANDATE: {
    support: 'future_recognized',
    status: F,
    only: 'a_future_delegation_requirement',
    note: 'A mandate (for example AP2) is evidence of delegation. It is not SITEBORNE authority and not payment.',
  },
  PLATFORM_AUTHZ_DECISION: {
    support: 'future_recognized',
    status: F,
    only: 'a_future_restriction_only',
    note: 'External platform authorization may restrict execution. It cannot create or widen SITEBORNE authorization.',
  },
  RISK_SIGNAL: {
    support: 'future_recognized',
    status: F,
    only: 'a_future_step_up_or_restriction',
    note: 'A risk signal is never authority and cannot override a restriction.',
  },
  COMPLIANCE_ATTESTATION: {
    support: 'unsupported_today',
    status: U,
    only: 'none',
    note: 'No compliance attestation is consumed in Release 1.',
  },
  QUALIFICATION_SIGNAL: {
    support: 'future_recognized',
    status: F,
    only: 'a_future_supplier_qualification_requirement',
    note: 'Supplier capability is not supplier qualification.',
  },
  PAYMENT_AUTHORIZATION: {
    support: 'supported_today',
    status: E,
    only: 'the_quote_bound_economic_authorization_requirement',
    note: 'Payment authorization proves permission for the governed economic action. It does not establish caller identity.',
  },
  PAYMENT_RECEIPT: {
    support: 'supported_today',
    status: O,
    only: 'recorded_verification_evidence',
    note: 'A payment receipt or verification response is recorded evidence. It is not settlement authority.',
  },
  DELIVERY_EVIDENCE: {
    support: 'supported_today',
    status: E,
    only: 'proof_of_a_governed_outcome',
    note: 'A PCC receipt proves a governed outcome. It grants no permission for another operation.',
  },
  SETTLEMENT_EVIDENCE: {
    support: 'supported_today',
    status: E,
    only: 'recorded_settlement_outcome',
    note: 'Settlement evidence records what happened. It grants no further authority.',
  },
};

function buildEvidenceSemantics(): readonly EvidenceSemantics[] {
  return EVIDENCE_CLASSES.map((evidenceClass) => {
    const row = EVIDENCE_TABLE[evidenceClass];
    return {
      evidenceClass,
      support: row.support,
      status: row.status,
      mayImplyIdentity: false,
      mayWidenAuthority: false,
      mayOnlySatisfy: row.only,
      note: row.note,
    };
  });
}

// ---------------------------------------------------------------------------
// The bundle
// ---------------------------------------------------------------------------
export const SECURITY_DECLARATION_VERSION = '1.0.0';

export function buildSecurityDeclarationV1(): SecurityDeclarationBundle {
  return {
    schemaVersion: SECURITY_DECLARATION_SCHEMA_VERSION,
    declarationVersion: SECURITY_DECLARATION_VERSION,
    compatibility: {
      supportedSchemaVersions: [SECURITY_DECLARATION_SCHEMA_VERSION],
      unknownVersionBehavior: 'denied',
      bindsToDeploymentVersion: false,
    },
    truthLevelCeiling: 'CONFIGURED',
    authorityModel: {
      governingRule:
        'No external system grants SITEBORNE authority. External systems provide verifiable evidence or mechanisms. SITEBORNE alone determines whether the conditions required by its canonical contract and policy are satisfied.',
      frozenDistinctions: [
        ['authentication', 'authorization'],
        ['identity', 'trust'],
        ['payment', 'identity'],
        ['mandate', 'payment'],
        ['mandate', 'SITEBORNE authority'],
        ['platform authorization', 'SITEBORNE authorization'],
        ['policy evaluation', 'authority grant'],
        ['quote', 'economic authorization'],
        ['payment authorization', 'execution authority'],
        ['execution authority', 'commit authority'],
        ['execution success', 'contract satisfaction'],
        ['commit success', 'contract satisfaction'],
        ['PCC', 'permission'],
        ['evidence', 'authority'],
        ['risk score', 'authority'],
        ['payment receipt', 'settlement authority'],
        ['result existence', 'result authorization'],
        ['revocation', 'rollback'],
        ['compensation', 'undo'],
        ['supplier capability', 'supplier qualification'],
      ],
      invariants: [
        s(
          'authentication_not_authorization',
          'Authentication does not imply SITEBORNE authorization. Release 1 has no caller authentication mechanism; this boundary is a design direction, not an enforced check.',
          F,
          'not_exercised'
        ),
        s(
          'payment_not_identity',
          'Payment does not imply identity. The payer address is recorded as evidence and is never used to derive caller identity or permission.',
          E,
          'source_implemented',
          'apps/edge-api/src/control-plane/evidence/cdp-provider.ts (payer recorded, no identity use)'
        ),
        s(
          'verification_necessary_not_sufficient',
          'A verified payment authorization is necessary but not sufficient for execution: route admission, mode availability, and quote and requirement binding are independently required.',
          E,
          'live_exercised',
          'apps/edge-api/src/index.ts; routes/pre-economic-mode-gate.ts'
        ),
        s(
          'provider_success_not_contract_satisfaction',
          'Provider or executor success does not establish contract satisfaction: a receipt must be generated before settlement is attempted.',
          E,
          'live_exercised',
          'workflows/paid-continuation-workflow.ts (invoke-executor, generate-pcc, settle order)'
        ),
        s(
          'pcc_is_evidence_not_permission',
          'A PCC receipt is proof of a governed outcome. No code path reads a receipt to grant permission.',
          E,
          'source_implemented'
        ),
        s(
          'evidence_does_not_grant_authority',
          'Evidence does not itself grant authority. Payment evidence can satisfy only the requirement it is bound to (quote, requirement, amount, payee, network, asset).',
          E,
          'live_exercised',
          'packages/protocol-x402/src/evidence/settlement.ts (binding mismatches rejected)'
        ),
        s(
          'settlement_requires_controlled_lifecycle',
          'Settlement occurs only inside the SITEBORNE-controlled paid lifecycle, after execution and receipt generation, and at most once per logical purchase.',
          E,
          'live_exercised',
          'workflows/paid-continuation-workflow.ts'
        ),
        s(
          'persisted_result_not_arbitrary_access',
          'A persisted result does not imply arbitrary caller access: no public result-retrieval route exists.',
          E,
          'source_implemented',
          'apps/edge-api/src/index.ts (no result route)'
        ),
        s(
          'platform_authz_cannot_widen',
          'External platform authorization cannot widen SITEBORNE permission. No platform authorization decision is consumed in Release 1.',
          F,
          'not_exercised'
        ),
        s(
          'malformed_required_state_fails_closed',
          'Unknown or malformed required security state fails closed (unsupported evidence versions, binding mismatches, and unverifiable payment evidence are rejected).',
          E,
          'live_exercised',
          'packages/protocol-x402/src/evidence/settlement.ts'
        ),
      ],
    },
    policySemantics: [
      s(
        'default_deny_route_admission',
        'Capabilities not admitted for the release are not mounted and return not-found. Paid routes require two independent exact-literal gates.',
        E,
        'live_exercised',
        'apps/edge-api/src/index.ts'
      ),
      s(
        'unknown_declaration_version_denied',
        'A consumer of this declaration denies any schema version it does not recognise. This is enforced inside the declaration tooling, not on a request path.',
        O,
        'source_implemented'
      ),
      s(
        'missing_required_evidence_denied',
        'A paid request without a valid payment authorization receives a payment-required challenge and no execution occurs.',
        E,
        'live_exercised'
      ),
      s(
        'expired_required_evidence_denied',
        'An expired quote or payment authorization is rejected before settlement is claimed.',
        E,
        'source_implemented',
        'workflows/paid-continuation-workflow.ts (authorization_expired)'
      ),
      s(
        'indeterminate_state_denied',
        'An unanswered or ambiguous facilitator check is rejected, and an ambiguous settlement is reconciled without a second settle.',
        E,
        'live_exercised'
      ),
      s(
        'restriction_not_overridable_by_trust',
        'A restriction cannot be overridden by positive trust or risk evidence. No trust or risk evidence is consumed in Release 1.',
        F,
        'not_exercised'
      ),
      s(
        'external_evidence_cannot_broaden',
        'External evidence may satisfy a bound requirement but cannot create broader authority. Enforced today for x402 payment evidence only; the general policy engine is a future direction.',
        E,
        'source_implemented'
      ),
    ],
    supportedSecurityProfiles: PROFILES,
    capabilitySecurityBindings: buildCapabilityBindings(),
    evidenceSemantics: buildEvidenceSemantics(),
    runtimeQualification: [
      s(
        'runtime_qualification_required',
        'Privileged paid execution depends on a qualified deployment: release candidates are qualified against the published contract before any paid admission.',
        O,
        'live_exercised'
      ),
      s(
        'multi_runtime_parity_required',
        'Every runtime that can reach the payment path must be qualified; a release invariant fails when a payment-capable runtime lacks a qualification gate.',
        O,
        'source_implemented',
        'apps/edge-api/tests/build-output/payment-worker-release-invariant.test.ts'
      ),
      s(
        'qualified_continuation_runtime_required',
        'The paid continuation runtime is qualified as a separate runtime from the public API.',
        O,
        'live_exercised'
      ),
      s(
        'rollback_qualified_release',
        'Releases keep a qualified rollback target. Rollback is a human-operated procedure.',
        O,
        'live_exercised'
      ),
      s(
        'runtime_self_check_absent',
        'A runtime does not refuse execution by checking its own qualification at request time. Qualification is a release-process control, not a request-path guard.',
        U,
        'not_exercised'
      ),
    ],
    effectSemantics: {
      execution: ['read_only', 'reversible', 'compensatable', 'irreversible'],
      economic: ['none', 'authorize', 'reserve', 'charge', 'settle', 'refund', 'reverse'],
      note: 'Execution effect, information effect and economic effect are independent axes. read_only describes the work performed and never implies safe or free: paid evidence services are read_only yet have information effects and an irreversible economic settlement.',
    },
    resultSecurity: [
      s(
        'result_creation_binding',
        'A result and its receipt are bound to the quote, requirement, payment identifier and request input hash of the purchase that produced it.',
        E,
        'live_exercised',
        'packages/protocol-x402/src/linkage/payment-service-link.ts'
      ),
      s(
        'result_persistence',
        'Results and receipts are persisted durably for audit and idempotent reconstruction.',
        E,
        'live_exercised'
      ),
      s(
        'receipt_signed',
        'Receipts are signed with a dedicated receipt signing key.',
        E,
        'live_exercised'
      ),
      s(
        'delivery_channel_paid_response',
        'A result is delivered in the response to the paid request. No other delivery channel exists.',
        E,
        'live_exercised'
      ),
      s('public_result_retrieval', 'No public result-retrieval route exists.', U, 'not_exercised'),
      s(
        'caller_bound_retrieval',
        'Caller-bound result retrieval is not available and was not exercised, because there is no non-economic retrieval route.',
        U,
        'not_exercised'
      ),
      s(
        'paid_request_replay_idempotency',
        'Retrying a paid request reconstructs the existing result instead of executing or settling again. Not exercised end to end against the live paid runtime.',
        E,
        'source_implemented',
        'routes/x402-service.ts (retry reconstruction)'
      ),
    ],
    economicSecurity: [
      s(
        'payment_rail_x402',
        'The payment rail is x402 with an exact-amount scheme for the admitted capabilities.',
        E,
        'live_exercised'
      ),
      s(
        'settlement_network_asset',
        'Settlement is on Base (eip155:8453) in USDC.',
        E,
        'live_exercised'
      ),
      s(
        'payment_authorization_not_identity',
        'Payment authorization is economic evidence, not identity.',
        E,
        'live_exercised'
      ),
      s(
        'challenge_self_describing_quote_bound',
        "The payment challenge is self-describing and quote-bound: it states amount, network, asset, payee and signing domain. Validating a challenge before signing is the buyer's responsibility and is not enforced by SITEBORNE.",
        E,
        'live_exercised'
      ),
      s(
        'exact_amount',
        'The authorized amount is the governed exact price. A request cannot alter it.',
        E,
        'live_exercised'
      ),
      s(
        'no_provider_work_before_authorization',
        'Provider work does not begin before the payment authorization has been verified.',
        E,
        'live_exercised'
      ),
      s(
        'settlement_after_execution_and_assurance',
        'Settlement is attempted only after execution and receipt generation.',
        E,
        'live_exercised'
      ),
      s(
        'at_most_once_settlement',
        'A logical purchase is settled at most once. Duplicate settlement is prevented by durable lifecycle guards; a duplicate attempt was not exercised live.',
        E,
        'source_implemented'
      ),
      s(
        'no_buyer_key_custody',
        'SITEBORNE does not custody buyer private keys and does not receive buyer wallet secrets.',
        E,
        'live_exercised'
      ),
      s(
        'refund_reversal_automation',
        'Automated refund or reversal is not available. A failed-after-execution purchase enters a manual-intervention state.',
        U,
        'not_exercised'
      ),
    ],
    credentialBoundaries: [
      s(
        'buyer_key_custody',
        'Buyer private keys never enter SITEBORNE. The server receives only a signed payment authorization.',
        E,
        'live_exercised'
      ),
      s(
        'signed_authorization_retention',
        'The signed payment authorization is not written to the relational store, the audit log, or receipts. It is held only inside an AES-256-GCM sealed continuation envelope until settlement completes. Retention of the sealed workflow input is governed by the workflow platform and is not asserted here.',
        E,
        'source_implemented',
        'routes/x402-service.ts; continuation/envelope.ts'
      ),
      s(
        'provider_credential_passthrough',
        'Provider and facilitator credentials are used server-side only and are never sent to buyers.',
        E,
        'source_implemented'
      ),
      s(
        'jwt_not_persisted',
        'Facilitator authentication tokens are not persisted or logged; failure diagnostics record closed-vocabulary reason codes only.',
        E,
        'source_implemented'
      ),
      s(
        'audit_detail_redaction',
        'Audit details redact fields whose names indicate secrets or payloads. Redaction is by field name and is best-effort, not a content scanner.',
        O,
        'source_implemented',
        'control-plane/audit/events.ts sanitizeDetails'
      ),
      s(
        'receipt_closed_schema',
        'Receipts follow a closed schema with no credential fields.',
        E,
        'source_implemented',
        'schemas/proof-carrying-context.schema.json'
      ),
    ],
    keyPurposeBoundaries: [
      {
        purpose: 'agent_card_signing',
        algorithm: 'ES256',
        status: E,
        separationBasis: 'distinct_configuration_binding',
        note: 'Signs the published agent card only.',
      },
      {
        purpose: 'receipt_signing',
        algorithm: 'Ed25519',
        status: E,
        separationBasis: 'distinct_configuration_binding',
        note: 'Signs receipts only. A different algorithm and binding from agent card signing.',
      },
      {
        purpose: 'facilitator_authentication',
        algorithm: 'Ed25519',
        status: E,
        separationBasis: 'distinct_configuration_binding',
        note: 'Authenticates the server to the payment facilitator.',
      },
      {
        purpose: 'continuation_envelope_encryption',
        algorithm: 'AES-256-GCM',
        status: E,
        separationBasis: 'not_applicable_symmetric',
        note: 'Encrypts, does not sign.',
      },
      {
        purpose: 'registry_domain_proof',
        algorithm: 'Ed25519',
        status: O,
        separationBasis: 'not_asserted',
        note: 'Only a public proof is served; the private key is held outside the deployment.',
      },
      {
        purpose: 'security_authority_grant_signing',
        algorithm: null,
        status: F,
        separationBasis: 'not_asserted',
        note: 'Future domain. Must not reuse any key above.',
      },
      {
        purpose: 'mandate_transaction_signing',
        algorithm: null,
        status: F,
        separationBasis: 'not_asserted',
        note: 'Future domain. Must never be the agent card key.',
      },
    ],
    hostileContentBoundaries: [
      s(
        'untrusted_content_cannot_set_payto',
        'Untrusted model, tool, document or web content cannot change the payment destination. The payee comes from governed configuration and is checked against settlement evidence.',
        E,
        'live_exercised'
      ),
      s(
        'untrusted_content_cannot_set_quote',
        'Untrusted content cannot choose quote identity. Quotes are minted server-side.',
        E,
        'live_exercised'
      ),
      s(
        'untrusted_content_cannot_set_price',
        'Untrusted content cannot change the economic ceiling. Price is governed per capability.',
        E,
        'live_exercised'
      ),
      s(
        'untrusted_content_cannot_set_settlement_destination',
        'Untrusted content cannot change the settlement destination.',
        E,
        'live_exercised'
      ),
      s(
        'untrusted_content_cannot_set_profile',
        'Untrusted content cannot select a security profile. The profile is fixed per route.',
        E,
        'source_implemented'
      ),
      s(
        'untrusted_content_cannot_authorize_result',
        'Untrusted content cannot authorize result access. No retrieval route exists.',
        E,
        'source_implemented'
      ),
      s(
        'untrusted_content_cannot_set_principal',
        'Untrusted content cannot set principal identity. No principal model exists in Release 1; this boundary is a design direction.',
        F,
        'not_exercised'
      ),
      s(
        'untrusted_content_cannot_set_scope',
        'Untrusted content cannot widen authorization scope. No scope model exists in Release 1; this boundary is a design direction.',
        F,
        'not_exercised'
      ),
      s(
        'untrusted_content_cannot_set_supplier_qualification',
        'Untrusted content cannot alter supplier allowlist or qualification. No supplier qualification framework exists in Release 1.',
        F,
        'not_exercised'
      ),
      s(
        'untrusted_content_cannot_set_commit_classification',
        'Untrusted content cannot alter commit or effect classification. No commit-authority model exists in Release 1.',
        F,
        'not_exercised'
      ),
    ],
    unsupportedSecurityFeatures: [
      {
        feature: 'mtls',
        status: U,
        note: 'No route enforces mutual TLS. Caller-certificate helper code is not wired into any route.',
      },
      { feature: 'oauth', status: U, note: 'No OAuth flow is offered.' },
      {
        feature: 'dpop',
        status: F,
        note: 'Proof-of-possession is a future direction and is not client authentication.',
      },
      { feature: 'spiffe_svid', status: U, note: 'Workload identity federation is not supported.' },
      {
        feature: 'ap2',
        status: F,
        note: 'Mandate evidence is a future direction and is not SITEBORNE authority.',
      },
      { feature: 'machine_payments_protocol', status: U, note: 'Not supported.' },
      { feature: 'vcap', status: U, note: 'Not supported.' },
      { feature: 'agentcore_policy', status: U, note: 'Not supported.' },
      { feature: 'enterprise_workload_federation', status: U, note: 'Not supported.' },
      { feature: 'interactive_login', status: U, note: 'No interactive login exists.' },
      {
        feature: 'custodial_wallet_operation',
        status: U,
        note: 'SITEBORNE does not operate buyer wallets.',
      },
      {
        feature: 'rendered_web_mode',
        status: U,
        note: 'The rendered retrieval mode is not purchasable.',
      },
      {
        feature: 'independent_reproduction_mode',
        status: U,
        note: 'The independent reproduction mode is not purchasable.',
      },
      {
        feature: 'nevermined_paid_execution',
        status: U,
        note: 'Closed for the initial paid release.',
      },
      {
        feature: 'company_evidence_graph_paid',
        status: U,
        note: 'Closed for the initial paid release.',
      },
      {
        feature: 'document_evidence_paid',
        status: U,
        note: 'Closed for the initial paid release.',
      },
      {
        feature: 'legacy_v1_paid_routes',
        status: U,
        note: 'Legacy generation routes are not admitted.',
      },
      { feature: 'public_result_retrieval', status: U, note: 'No result-retrieval route exists.' },
      {
        feature: 'caller_bound_result_retrieval',
        status: U,
        note: 'Not available and not exercised.',
      },
      { feature: 'automated_refund_or_reversal', status: U, note: 'Manual intervention only.' },
    ],
    reservedFutureObjects: [...RESERVED_FUTURE_OBJECT_NAMES],
    implementationStatus: {
      vocabulary: [
        'IMPLEMENTED_ENFORCED',
        'IMPLEMENTED_OBSERVATIONAL',
        'DECLARED_FUTURE',
        'UNSUPPORTED',
      ],
    },
    provenance: {
      publicationState: 'additive_metadata_projection',
      qualification: 'source_qualified',
    },
  };
}

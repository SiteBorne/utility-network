/**
 * PRODUCTION-SECURITY-DECLARATIONS-01 -- deterministic public projections.
 *
 * Every public field is copied by name. Nothing is spread from a canonical
 * object, so adding a private field to the canonical model cannot leak it.
 * A projection may narrow a status, never broaden it, and an unrecognised
 * status is coerced to UNSUPPORTED (fail closed).
 */
import type {
  CapabilitySecurityBinding,
  EvidenceSemantics,
  KeyPurpose,
  NegativeDeclaration,
  Qualification,
  SecurityDeclarationBundle,
  SecurityProfile,
  Statement,
} from './declaration';
import {
  isSupportedSecuritySchemaVersion,
  scanForPrivateLeaks,
  validateSecurityDeclaration,
  type SecurityViolation,
} from './validate';
import { failClosedStatus, isNoStrongerThan, type ImplementationStatus } from './vocabulary';

export class SecurityDeclarationError extends Error {
  readonly violations: readonly SecurityViolation[];
  constructor(message: string, violations: readonly SecurityViolation[] = []) {
    super(message);
    this.name = 'SecurityDeclarationError';
    this.violations = violations;
  }
}

export interface PublicStatement {
  readonly id: string;
  readonly statement: string;
  readonly status: ImplementationStatus;
  readonly qualification: Qualification;
}

export interface PublicSecurityDeclaration {
  readonly schemaVersion: string;
  readonly declarationVersion: string;
  readonly compatibility: {
    readonly supportedSchemaVersions: readonly string[];
    readonly unknownVersionBehavior: 'denied';
  };
  readonly truthLevelCeiling: string;
  readonly authorityModel: {
    readonly governingRule: string;
    readonly frozenDistinctions: readonly (readonly [string, string])[];
    readonly invariants: readonly PublicStatement[];
  };
  readonly policySemantics: readonly PublicStatement[];
  readonly supportedSecurityProfiles: readonly SecurityProfile[];
  readonly capabilitySecurityBindings: readonly PublicBinding[];
  readonly evidenceSemantics: readonly EvidenceSemantics[];
  readonly runtimeQualification: readonly PublicStatement[];
  readonly effectSemantics: SecurityDeclarationBundle['effectSemantics'];
  readonly resultSecurity: readonly PublicStatement[];
  readonly economicSecurity: readonly PublicStatement[];
  readonly credentialBoundaries: readonly PublicStatement[];
  readonly keyPurposeBoundaries: readonly KeyPurpose[];
  readonly hostileContentBoundaries: readonly PublicStatement[];
  readonly unsupportedSecurityFeatures: readonly NegativeDeclaration[];
  readonly reservedFutureObjects: readonly string[];
  readonly provenance: SecurityDeclarationBundle['provenance'];
}

export type PublicBinding = Omit<CapabilitySecurityBinding, 'privateEvidenceRef'>;

function pubStatement(item: Statement): PublicStatement {
  return {
    id: item.id,
    statement: item.statement,
    status: failClosedStatus(item.status),
    qualification: item.qualification,
  };
}

function pubBinding(b: CapabilitySecurityBinding): PublicBinding {
  return {
    id: b.id,
    capability: b.capability,
    mode: b.mode,
    kind: b.kind,
    economicMechanism: b.economicMechanism,
    available: b.available,
    purchasable: b.purchasable,
    securityProfile: b.securityProfile,
    economicAuthorizationRequired: b.economicAuthorizationRequired,
    executionEffect: b.executionEffect,
    informationEffect: {
      dataFlow: b.informationEffect.dataFlow,
      inputHandling: b.informationEffect.inputHandling,
      retention: b.informationEffect.retention,
      callerBindingRequirement: b.informationEffect.callerBindingRequirement,
    },
    economicEffects: [...b.economicEffects],
    settlementReversibility: b.settlementReversibility,
    assuranceRequirement: b.assuranceRequirement,
    resultSemantics: b.resultSemantics,
    runtimeQualification: b.runtimeQualification,
    admission: b.admission,
    ...(b.closedReason ? { closedReason: b.closedReason } : {}),
    implementationStatus: failClosedStatus(b.implementationStatus),
  };
}

/**
 * Builds the public projection. Throws on an unknown schema version or on any
 * canonical contradiction; a public projection is never produced from a
 * declaration that fails validation.
 */
export function projectPublicSecurityDeclaration(
  canonical: SecurityDeclarationBundle
): PublicSecurityDeclaration {
  if (!isSupportedSecuritySchemaVersion(canonical.schemaVersion)) {
    throw new SecurityDeclarationError(
      `unsupported security declaration schema version "${String(canonical.schemaVersion)}"`,
      [{ code: 'UNKNOWN_SCHEMA_VERSION', path: 'schemaVersion', message: 'denied' }]
    );
  }
  const violations = validateSecurityDeclaration(canonical);
  if (violations.length > 0) {
    throw new SecurityDeclarationError(
      'canonical security declaration is contradictory',
      violations
    );
  }
  const projection: PublicSecurityDeclaration = {
    schemaVersion: canonical.schemaVersion,
    declarationVersion: canonical.declarationVersion,
    compatibility: {
      supportedSchemaVersions: [...canonical.compatibility.supportedSchemaVersions],
      unknownVersionBehavior: 'denied',
    },
    truthLevelCeiling: canonical.truthLevelCeiling,
    authorityModel: {
      governingRule: canonical.authorityModel.governingRule,
      frozenDistinctions: canonical.authorityModel.frozenDistinctions.map(
        ([a, b]) => [a, b] as const
      ),
      invariants: canonical.authorityModel.invariants.map(pubStatement),
    },
    policySemantics: canonical.policySemantics.map(pubStatement),
    supportedSecurityProfiles: canonical.supportedSecurityProfiles.map((p) => ({
      id: p.id,
      authentication: p.authentication,
      identity: p.identity,
      economicAuthorization: p.economicAuthorization,
      executionAuthorityCondition: p.executionAuthorityCondition,
      assurance: p.assurance,
      resultAccess: p.resultAccess,
      settlementCondition: p.settlementCondition,
      runtimeQualification: p.runtimeQualification,
      executionEffects: [...p.executionEffects],
      economicEffects: [...p.economicEffects],
      credentialHandling: p.credentialHandling,
      status: failClosedStatus(p.status),
      qualification: p.qualification,
    })),
    capabilitySecurityBindings: canonical.capabilitySecurityBindings.map(pubBinding),
    evidenceSemantics: canonical.evidenceSemantics.map((e) => ({
      evidenceClass: e.evidenceClass,
      support: e.support,
      status: failClosedStatus(e.status),
      mayImplyIdentity: false as const,
      mayWidenAuthority: false as const,
      mayOnlySatisfy: e.mayOnlySatisfy,
      note: e.note,
    })),
    runtimeQualification: canonical.runtimeQualification.map(pubStatement),
    effectSemantics: {
      execution: [...canonical.effectSemantics.execution],
      economic: [...canonical.effectSemantics.economic],
      note: canonical.effectSemantics.note,
    },
    resultSecurity: canonical.resultSecurity.map(pubStatement),
    economicSecurity: canonical.economicSecurity.map(pubStatement),
    credentialBoundaries: canonical.credentialBoundaries.map(pubStatement),
    keyPurposeBoundaries: canonical.keyPurposeBoundaries.map((k) => ({
      purpose: k.purpose,
      algorithm: k.algorithm,
      status: failClosedStatus(k.status),
      separationBasis: k.separationBasis,
      note: k.note,
    })),
    hostileContentBoundaries: canonical.hostileContentBoundaries.map(pubStatement),
    unsupportedSecurityFeatures: canonical.unsupportedSecurityFeatures.map((n) => ({
      feature: n.feature,
      status: failClosedStatus(n.status),
      note: n.note,
    })),
    reservedFutureObjects: [...canonical.reservedFutureObjects],
    provenance: {
      publicationState: canonical.provenance.publicationState,
      qualification: canonical.provenance.qualification,
    },
  };
  const leaks = scanForPrivateLeaks(projection);
  if (leaks.length > 0) {
    throw new SecurityDeclarationError('public projection would expose private material', leaks);
  }
  return projection;
}

// ---------------------------------------------------------------------------
// Per-surface fragments (all derived from the same public binding)
// ---------------------------------------------------------------------------
export interface SecurityFragment {
  readonly bindingId: string;
  readonly securityProfile: string | null;
  readonly implementationStatus: ImplementationStatus;
  readonly executionEffect: string;
  readonly economicEffects: readonly string[];
  readonly settlementReversibility: string;
  readonly dataFlow: string;
  readonly assuranceRequirement: string;
  readonly runtimeQualification: string;
  readonly available: boolean;
  readonly purchasable: boolean;
}

export function toSecurityFragment(binding: PublicBinding): SecurityFragment {
  return {
    bindingId: binding.id,
    securityProfile: binding.securityProfile,
    implementationStatus: binding.implementationStatus,
    executionEffect: binding.executionEffect,
    economicEffects: [...binding.economicEffects],
    settlementReversibility: binding.settlementReversibility,
    dataFlow: binding.informationEffect.dataFlow,
    assuranceRequirement: binding.assuranceRequirement,
    runtimeQualification: binding.runtimeQualification,
    available: binding.available,
    purchasable: binding.purchasable,
  };
}

/** MCP tool `_meta` keys (namespace matches the existing `net.siteborne/`). */
export function projectMcpSecurityMeta(fragment: SecurityFragment): Record<string, unknown> {
  return {
    'net.siteborne/securityProfile': fragment.securityProfile,
    'net.siteborne/implementationStatus': fragment.implementationStatus,
    'net.siteborne/executionEffect': fragment.executionEffect,
    'net.siteborne/economicEffects': fragment.economicEffects,
    'net.siteborne/settlementReversibility': fragment.settlementReversibility,
    'net.siteborne/dataFlow': fragment.dataFlow,
    'net.siteborne/assuranceRequirement': fragment.assuranceRequirement,
    'net.siteborne/runtimeQualification': fragment.runtimeQualification,
  };
}

/** OpenAPI operation extension. */
export function projectOpenApiSecurityExtension(
  fragment: SecurityFragment
): Record<string, unknown> {
  return { 'x-siteborne-security': { ...fragment } };
}

/** A2A skill-level metadata block. */
export function projectA2aSkillSecurity(fragment: SecurityFragment): Record<string, unknown> {
  return { security: { ...fragment } };
}

/** Catalog service entry block. */
export function projectCatalogSecurity(fragment: SecurityFragment): Record<string, unknown> {
  return { security: { ...fragment } };
}

/**
 * True only if every status in `projected` is no stronger than the canonical
 * status for the same binding id. Unknown ids are treated as a violation.
 */
export function checkProjectionNarrowing(
  canonical: SecurityDeclarationBundle,
  fragments: readonly SecurityFragment[]
): readonly SecurityViolation[] {
  const out: SecurityViolation[] = [];
  const byId = new Map(canonical.capabilitySecurityBindings.map((b) => [b.id, b]));
  for (const f of fragments) {
    const c = byId.get(f.bindingId);
    if (!c) {
      out.push({
        code: 'PROJECTION_EXCEEDS_CANONICAL',
        path: f.bindingId,
        message: 'binding is not in the canonical declaration',
      });
      continue;
    }
    if (!isNoStrongerThan(failClosedStatus(f.implementationStatus), c.implementationStatus)) {
      out.push({
        code: 'PROJECTION_EXCEEDS_CANONICAL',
        path: f.bindingId,
        message: 'projected status is stronger than canonical',
      });
    }
    if ((f.available && !c.available) || (f.purchasable && !c.purchasable)) {
      out.push({
        code: 'PROJECTION_EXCEEDS_CANONICAL',
        path: f.bindingId,
        message: 'projection enables what canonical keeps closed',
      });
    }
    if (f.securityProfile !== null && f.securityProfile !== c.securityProfile) {
      out.push({
        code: 'PROJECTION_EXCEEDS_CANONICAL',
        path: f.bindingId,
        message: 'projected profile differs from canonical',
      });
    }
    if (
      c.runtimeQualification === 'qualified_runtime_required' &&
      f.runtimeQualification !== 'qualified_runtime_required'
    ) {
      out.push({
        code: 'RUNTIME_QUALIFICATION_OMITTED',
        path: f.bindingId,
        message: 'paid capability projection omits runtime qualification',
      });
    }
  }
  return out;
}

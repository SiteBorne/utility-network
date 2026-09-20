/**
 * PRODUCTION-SECURITY-DECLARATIONS-PUBLICATION-01 -- additive publication of
 * `security_declaration.v1` through EXISTING public metadata surfaces.
 *
 * Every value here is derived from `buildSecurityDeclarationV1()` through the
 * validated allowlist projector. There is no second security truth: the
 * fragments, the compact A2A block and the OpenAPI/catalog references are pure
 * functions of the canonical declaration, and each is re-validated for
 * narrowing (never broader than canonical) and for private-field leakage
 * before it is returned.
 *
 * The protocol packages (MCP, A2A, x402/OpenAPI) sit below this package in the
 * dependency graph and cannot import it, so edge-api resolves the publication
 * once and injects the resulting plain data into them. Nothing is injected by
 * default, so those packages behave exactly as before unless a caller opts in.
 */
import {
  buildSecurityDeclarationV1,
  type CapabilitySecurityBinding,
  type SecurityDeclarationBundle,
  type SecurityProfile,
} from './declaration';
import {
  checkProjectionNarrowing,
  projectPublicSecurityDeclaration,
  SecurityDeclarationError,
  toSecurityFragment,
  type PublicBinding,
  type PublicSecurityDeclaration,
  type SecurityFragment,
} from './project';
import { scanForPrivateLeaks, type SecurityViolation } from './validate';
import type { ImplementationStatus } from './vocabulary';

/** A2A extension identifier carrying the compact declaration. It is an additive
 * `capabilities.extensions` entry (`required: false`); it adds no
 * authentication scheme and no security requirement. It is deliberately a URN
 * rather than an https URL: a URL would have to resolve to a newly published
 * public resource, and this publication class forbids creating one. */
export const SITEBORNE_SECURITY_DECLARATION_EXTENSION_URI =
  'urn:siteborne:a2a:extension:security-declaration:v1' as const;

/** OpenAPI document-level extension key. */
export const OPENAPI_SECURITY_DECLARATION_KEY = 'x-siteborne-security-declaration' as const;
/** OpenAPI operation-level extension key. */
export const OPENAPI_SECURITY_OPERATION_KEY = 'x-siteborne-security' as const;

/** Reference every surface carries so a reader can locate the full declaration. */
export interface SecurityDeclarationRef {
  readonly schemaVersion: string;
  readonly declarationVersion: string;
  readonly truthLevelCeiling: string;
  readonly fullDeclaration: 'openapi:x-siteborne-security-declaration';
  readonly profiles: readonly string[];
}

/**
 * Per-binding fragment as published. Adds the existing VCM truth-law ceiling
 * (`SecurityTruthLevel`: IMPLEMENTED/CONFIGURED/ACTIVE/VERIFIED) beside the
 * declaration's guarantee-status axis, so no surface presents a guarantee
 * status without the activation-evidence ceiling that bounds it.
 */
export interface PublishedSecurityFragment extends SecurityFragment {
  readonly truthLevelCeiling: string;
  readonly capability: string;
  readonly mode: string;
  readonly economicAuthorizationRequired: boolean;
  readonly resultSemantics: string;
}

export interface CompactSecurityDeclaration {
  readonly schemaVersion: string;
  readonly declarationVersion: string;
  readonly truthLevelCeiling: string;
  readonly unknownVersionBehavior: 'denied';
  readonly fullDeclaration: 'openapi:x-siteborne-security-declaration';
  readonly frozenDistinctions: readonly (readonly [string, string])[];
  readonly supportedSecurityProfiles: readonly {
    readonly id: string;
    readonly authentication: string;
    readonly identity: string;
    readonly economicAuthorization: string;
    readonly resultAccess: string;
    readonly status: ImplementationStatus;
  }[];
  readonly capabilitySecurity: readonly PublishedSecurityFragment[];
  readonly unsupportedSecurityFeatures: PublicSecurityDeclaration['unsupportedSecurityFeatures'];
  readonly provenance: PublicSecurityDeclaration['provenance'];
}

export interface SecurityPublication {
  readonly canonical: SecurityDeclarationBundle;
  readonly full: PublicSecurityDeclaration;
  readonly compact: CompactSecurityDeclaration;
  readonly ref: SecurityDeclarationRef;
  readonly fragments: readonly PublishedSecurityFragment[];
}

function publishedFragment(
  binding: PublicBinding,
  truthLevelCeiling: string
): PublishedSecurityFragment {
  return {
    ...toSecurityFragment(binding),
    truthLevelCeiling,
    capability: binding.capability,
    mode: binding.mode,
    economicAuthorizationRequired: binding.economicAuthorizationRequired,
    resultSemantics: binding.resultSemantics,
  };
}

function profileSummary(p: SecurityProfile) {
  return {
    id: p.id,
    authentication: p.authentication,
    identity: p.identity,
    economicAuthorization: p.economicAuthorization,
    resultAccess: p.resultAccess,
    status: p.status,
  } as const;
}

/**
 * Builds and self-checks the publication. Throws `SecurityDeclarationError`
 * on any contradiction, any projection broader than canonical, or any private
 * material in the published output.
 */
export function buildSecurityPublication(
  canonical: SecurityDeclarationBundle = buildSecurityDeclarationV1()
): SecurityPublication {
  const full = projectPublicSecurityDeclaration(canonical);
  const fragments = full.capabilitySecurityBindings.map((b) =>
    publishedFragment(b, full.truthLevelCeiling)
  );
  const narrowing = checkProjectionNarrowing(canonical, fragments);
  if (narrowing.length > 0) {
    throw new SecurityDeclarationError(
      'published fragments exceed the canonical declaration',
      narrowing
    );
  }
  const ref: SecurityDeclarationRef = {
    schemaVersion: full.schemaVersion,
    declarationVersion: full.declarationVersion,
    truthLevelCeiling: full.truthLevelCeiling,
    fullDeclaration: 'openapi:x-siteborne-security-declaration',
    profiles: full.supportedSecurityProfiles.map((p) => p.id),
  };
  const compact: CompactSecurityDeclaration = {
    schemaVersion: full.schemaVersion,
    declarationVersion: full.declarationVersion,
    truthLevelCeiling: full.truthLevelCeiling,
    unknownVersionBehavior: full.compatibility.unknownVersionBehavior,
    fullDeclaration: 'openapi:x-siteborne-security-declaration',
    frozenDistinctions: full.authorityModel.frozenDistinctions.map(([a, b]) => [a, b] as const),
    supportedSecurityProfiles: canonical.supportedSecurityProfiles.map(profileSummary),
    capabilitySecurity: fragments,
    unsupportedSecurityFeatures: full.unsupportedSecurityFeatures,
    provenance: full.provenance,
  };
  const leaks: SecurityViolation[] = [
    ...scanForPrivateLeaks(compact),
    ...scanForPrivateLeaks(fragments),
    ...scanForPrivateLeaks(ref),
  ];
  if (leaks.length > 0) {
    throw new SecurityDeclarationError('publication would expose private material', leaks);
  }
  return { canonical, full, compact, ref, fragments };
}

/** Fragments for one service id (all modes), in canonical order. */
export function fragmentsForCapability(
  publication: SecurityPublication,
  capability: string
): readonly PublishedSecurityFragment[] {
  return publication.fragments.filter((f) => f.capability === capability);
}

/** MCP tool `_meta` for one tool: profile + per-mode fragments + reference. */
export function mcpToolSecurityMeta(
  publication: SecurityPublication,
  toolOrServiceId: string
): Record<string, unknown> | null {
  const fragments = fragmentsForCapability(publication, toolOrServiceId);
  if (fragments.length === 0) return null;
  return {
    'net.siteborne/securityDeclaration': {
      schemaVersion: publication.ref.schemaVersion,
      declarationVersion: publication.ref.declarationVersion,
      truthLevelCeiling: publication.ref.truthLevelCeiling,
      fullDeclaration: publication.ref.fullDeclaration,
    },
    'net.siteborne/security': fragments.map((f) => ({
      mode: f.mode,
      securityProfile: f.securityProfile,
      implementationStatus: f.implementationStatus,
      truthLevelCeiling: f.truthLevelCeiling,
      available: f.available,
      purchasable: f.purchasable,
      economicAuthorizationRequired: f.economicAuthorizationRequired,
      executionEffect: f.executionEffect,
      economicEffects: f.economicEffects,
      settlementReversibility: f.settlementReversibility,
      dataFlow: f.dataFlow,
      assuranceRequirement: f.assuranceRequirement,
      runtimeQualification: f.runtimeQualification,
      resultSemantics: f.resultSemantics,
    })),
  };
}

/** MCP tool name -> `_meta` fragment map (service ids are keyed by tool name
 * by the caller-supplied map; discovery tools are keyed by their own name). */
export function mcpSecurityMetaByToolName(
  publication: SecurityPublication,
  serviceToolIds: Readonly<Record<string, string>>,
  utilityToolNames: readonly string[]
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [toolName, serviceId] of Object.entries(serviceToolIds)) {
    const meta = mcpToolSecurityMeta(publication, serviceId);
    if (meta) out[toolName] = meta;
  }
  for (const toolName of utilityToolNames) {
    const meta = mcpToolSecurityMeta(publication, toolName);
    if (meta) out[toolName] = meta;
  }
  return out;
}

/** Catalog per-service block (all modes of the service). */
export function catalogSecurityBlock(
  publication: SecurityPublication,
  serviceId: string
): {
  readonly declaration: SecurityDeclarationRef;
  readonly modes: readonly Record<string, unknown>[];
} | null {
  const fragments = fragmentsForCapability(publication, serviceId);
  if (fragments.length === 0) return null;
  const meta = mcpToolSecurityMeta(publication, serviceId);
  return {
    declaration: publication.ref,
    modes: (meta?.['net.siteborne/security'] as readonly Record<string, unknown>[]) ?? [],
  };
}

/** OpenAPI operation extension for one service id. */
export function openApiOperationSecurity(
  publication: SecurityPublication,
  serviceId: string
): Record<string, unknown> | null {
  const block = catalogSecurityBlock(publication, serviceId);
  return block ? { [OPENAPI_SECURITY_OPERATION_KEY]: block } : null;
}

/** A2A extension entry (additive; not required; adds no auth scheme). */
export function a2aSecurityExtension(publication: SecurityPublication): {
  readonly uri: typeof SITEBORNE_SECURITY_DECLARATION_EXTENSION_URI;
  readonly description: string;
  readonly required: false;
  readonly params: Readonly<Record<string, unknown>>;
} {
  return {
    uri: SITEBORNE_SECURITY_DECLARATION_EXTENSION_URI,
    description:
      'SITEBORNE Release-1 security declaration (security_declaration.v1). Describes only guarantees enforced today; declares no authentication mechanism and requires none.',
    required: false,
    params: { ...publication.compact },
  };
}

export type { CapabilitySecurityBinding };

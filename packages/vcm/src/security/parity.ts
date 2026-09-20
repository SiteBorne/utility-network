/**
 * PRODUCTION-SECURITY-DECLARATIONS-01 -- surface parity.
 *
 * Validate-mode (not generate-mode): each existing served surface is compared
 * with the canonical declaration and any disagreement is a violation. The
 * served surfaces are not modified by this checkpoint, so generation into
 * them is a publication step. Every comparator takes plain data, so it is
 * usable against a locally built surface or a fetched one.
 *
 * Direction of trust: a surface may say LESS than the declaration (narrower)
 * but must never say MORE.
 */
import {
  ECONOMIC_SERVICE_IDS,
  buildEconomicOffer,
  checkModeAvailability,
} from '@siteborne/pricing';
import type { EconomicOfferProjection, EconomicServiceId } from '@siteborne/pricing';
import type { SecurityDeclarationBundle } from './declaration';
import type { SecurityViolation } from './validate';
import { isNoStrongerThan, type ImplementationStatus } from './vocabulary';

const mismatch = (path: string, message: string): SecurityViolation => ({
  code: 'SURFACE_PARITY_MISMATCH',
  path,
  message,
});

const bindingsFor = (d: SecurityDeclarationBundle, capability: string) =>
  d.capabilitySecurityBindings.filter((b) => b.capability === capability);

const feature = (d: SecurityDeclarationBundle, name: string): ImplementationStatus | undefined =>
  d.unsupportedSecurityFeatures.find((n) => n.feature === name)?.status;

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------
export interface McpToolLike {
  readonly name: string;
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
    readonly openWorldHint?: boolean;
  };
  readonly _meta?: Readonly<Record<string, unknown>>;
}

export function checkMcpParity(
  d: SecurityDeclarationBundle,
  tools: readonly McpToolLike[],
  serviceToolIds: Readonly<Record<string, string>>
): readonly SecurityViolation[] {
  const out: SecurityViolation[] = [];
  for (const tool of tools) {
    const path = `mcp.${tool.name}`;
    const serviceId = serviceToolIds[tool.name];
    const bindings = serviceId ? bindingsFor(d, serviceId) : bindingsFor(d, tool.name);
    if (bindings.length === 0) {
      out.push(mismatch(path, 'MCP tool has no capability security binding'));
      continue;
    }
    const readOnly = tool.annotations?.readOnlyHint;
    const anyEconomic = bindings.some((b) => b.economicEffects.some((e) => e !== 'none'));
    if (readOnly === true && anyEconomic) {
      out.push(mismatch(path, 'readOnlyHint=true but the capability has an economic effect'));
    }
    if (serviceId) {
      if (readOnly !== false)
        out.push(mismatch(path, 'a paid service tool must not be annotated read-only'));
      const offer = buildEconomicOffer(serviceId as EconomicServiceId);
      const declaredOpenWorld = bindings.some(
        (b) =>
          b.informationEffect.dataFlow !== 'supplied_material_only_no_egress' &&
          b.informationEffect.dataFlow !== 'none'
      );
      if (
        tool.annotations?.openWorldHint !== offer.openWorld ||
        offer.openWorld !== declaredOpenWorld
      ) {
        out.push(mismatch(path, 'openWorldHint disagrees with the declared information data flow'));
      }
    } else if (tool.annotations?.openWorldHint === true) {
      out.push(
        mismatch(
          path,
          'a discovery tool declares no outbound data flow but is annotated open-world'
        )
      );
    }
    for (const key of Object.keys(tool._meta ?? {})) {
      if (/securityScheme|authentication|identity/i.test(key)) {
        out.push(
          mismatch(
            path,
            `MCP _meta key "${key}" implies an authentication mechanism Release 1 does not have`
          )
        );
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// A2A
// ---------------------------------------------------------------------------
export interface A2aCardLike {
  readonly securitySchemes?: Readonly<Record<string, unknown>>;
  readonly securityRequirements?: readonly unknown[];
  readonly skills?: readonly { readonly id: string }[];
}

export function checkA2aParity(
  d: SecurityDeclarationBundle,
  card: A2aCardLike
): readonly SecurityViolation[] {
  const out: SecurityViolation[] = [];
  const schemes = Object.keys(card.securitySchemes ?? {});
  const mtls = feature(d, 'mtls') ?? 'UNSUPPORTED';
  for (const key of schemes) {
    const body = JSON.stringify(card.securitySchemes?.[key] ?? {});
    if (/mtls|mutualTls/i.test(key + body) && !isNoStrongerThan('IMPLEMENTED_ENFORCED', mtls)) {
      out.push(
        mismatch(
          `a2a.securitySchemes.${key}`,
          'agent card declares mutual TLS but the declaration does not enforce it'
        )
      );
    } else if (!/mtls|mutualTls/i.test(key + body)) {
      out.push(
        mismatch(
          `a2a.securitySchemes.${key}`,
          'agent card declares an authentication scheme the declaration does not contain'
        )
      );
    }
  }
  if ((card.securityRequirements ?? []).length > 0) {
    out.push(
      mismatch(
        'a2a.securityRequirements',
        'agent card requires authentication; Release 1 requires none'
      )
    );
  }
  for (const skill of card.skills ?? []) {
    if (bindingsFor(d, skill.id).length === 0) {
      out.push(mismatch(`a2a.skills.${skill.id}`, 'skill has no capability security binding'));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// OpenAPI
// ---------------------------------------------------------------------------
export interface OpenApiLike {
  readonly security?: unknown;
  readonly components?: { readonly securitySchemes?: unknown };
  readonly paths?: Readonly<Record<string, Readonly<Record<string, Record<string, unknown>>>>>;
}

export function checkOpenApiParity(
  d: SecurityDeclarationBundle,
  doc: OpenApiLike
): readonly SecurityViolation[] {
  const out: SecurityViolation[] = [];
  if (
    doc.components?.securitySchemes &&
    Object.keys(doc.components.securitySchemes as object).length > 0
  ) {
    out.push(
      mismatch(
        'openapi.components.securitySchemes',
        'OpenAPI declares authentication schemes; Release 1 has none'
      )
    );
  }
  if (Array.isArray(doc.security) && doc.security.length > 0) {
    out.push(
      mismatch('openapi.security', 'OpenAPI requires authentication; Release 1 requires none')
    );
  }
  for (const [route, methods] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(methods)) {
      const path = `openapi.${method} ${route}`;
      if (Array.isArray(op.security) && op.security.length > 0) {
        out.push(mismatch(path, 'operation requires authentication; Release 1 requires none'));
      }
      const serviceId = op['x-service-id'];
      if (typeof serviceId === 'string') {
        const bindings = bindingsFor(d, serviceId);
        if (bindings.length === 0)
          out.push(mismatch(path, 'operation has no capability security binding'));
        if (op['x-production-enabled'] === true && !bindings.some((b) => b.purchasable)) {
          out.push(mismatch(path, 'operation is production-enabled but no binding is purchasable'));
        }
      }
    }
  }
  return out;
}

/** Mode selector enums in generated input schemas must be a subset of the
 * purchasable modes for that service (a buyer is never offered a closed mode). */
export function checkOpenApiModeEnums(
  d: SecurityDeclarationBundle,
  serviceId: EconomicServiceId,
  inputSchema: {
    readonly properties?: Readonly<Record<string, { readonly enum?: readonly string[] }>>;
  }
): readonly SecurityViolation[] {
  const field = buildEconomicOffer(serviceId).modeSelectorField;
  const values = field ? inputSchema.properties?.[field]?.enum : undefined;
  if (!field || !values) return [];
  const purchasable = new Set(
    bindingsFor(d, serviceId)
      .filter((b) => b.purchasable)
      .map((b) => b.mode)
  );
  return values
    .filter((v) => !purchasable.has(v))
    .map((v) =>
      mismatch(
        `openapi.${serviceId}.${field}`,
        `input schema offers mode "${v}" that the declaration does not make purchasable`
      )
    );
}

// ---------------------------------------------------------------------------
// Economic projection (catalog / MCP economics / OpenAPI economics share it)
// ---------------------------------------------------------------------------
export function checkEconomicParity(
  d: SecurityDeclarationBundle,
  projections: readonly EconomicOfferProjection[]
): readonly SecurityViolation[] {
  const out: SecurityViolation[] = [];
  for (const p of projections) {
    const bindings = bindingsFor(d, p.service_id);
    if (bindings.length === 0) {
      out.push(mismatch(`economics.${p.service_id}`, 'no capability security binding'));
      continue;
    }
    const admitted = bindings.filter((b) => b.purchasable && b.economicMechanism === 'x402');
    const posturePurchasable = p.release_posture === 'first_release_candidate';
    if (admitted.length > 0 && !posturePurchasable) {
      out.push(
        mismatch(
          `economics.${p.service_id}`,
          'declaration admits a capability the economic contract does not'
        )
      );
    }
    if (posturePurchasable && admitted.length === 0) {
      out.push(
        mismatch(
          `economics.${p.service_id}`,
          'economic contract admits a capability the declaration keeps closed'
        )
      );
    }
    for (const b of bindings.filter((x) => x.economicMechanism === 'x402')) {
      const mode = p.modes.find((m) => m.mode === b.mode);
      if (!mode) {
        out.push(
          mismatch(
            `economics.${p.service_id}/${b.mode}`,
            'mode missing from the economic projection'
          )
        );
        continue;
      }
      if (b.purchasable && !mode.capability_available) {
        out.push(
          mismatch(
            `economics.${b.id}`,
            'purchasable in the declaration but unavailable in the economic projection'
          )
        );
      }
      if (b.purchasable && (p.scheme !== 'exact' || mode.amount_kind !== 'exact')) {
        out.push(
          mismatch(
            `economics.${b.id}`,
            'declared exact-amount payment but the economic projection is not exact'
          )
        );
      }
      if (!b.purchasable && posturePurchasable && mode.capability_available) {
        out.push(
          mismatch(
            `economics.${b.id}`,
            'projection offers an available mode the declaration keeps closed'
          )
        );
      }
    }
    if (p.production_enabled && admitted.length === 0) {
      out.push(
        mismatch(
          `economics.${p.service_id}`,
          'projection marks a closed capability production-enabled'
        )
      );
    }
  }
  return out;
}

/** The pre-economic mode gate (what a route actually accepts) must agree with
 * the declaration for every governed mode. */
export function checkModeGateParity(d: SecurityDeclarationBundle): readonly SecurityViolation[] {
  const out: SecurityViolation[] = [];
  for (const serviceId of ECONOMIC_SERVICE_IDS) {
    const offer = buildEconomicOffer(serviceId);
    if (!offer.modeSelectorField) continue;
    for (const m of offer.modes) {
      const accepted = checkModeAvailability(serviceId, { [offer.modeSelectorField]: m.mode }).ok;
      const binding = d.capabilitySecurityBindings.find((b) => b.id === `${serviceId}/${m.mode}`);
      if (!binding) {
        out.push(mismatch(`gate.${serviceId}/${m.mode}`, 'mode has no binding'));
      } else if (binding.purchasable && !accepted) {
        out.push(
          mismatch(`gate.${binding.id}`, 'declared purchasable but the route gate rejects it')
        );
      } else if (!accepted && binding.available) {
        out.push(
          mismatch(`gate.${binding.id}`, 'declared available but the route gate rejects it')
        );
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// VCM effective view
// ---------------------------------------------------------------------------
const MECHANISM_TO_FEATURE: Readonly<
  Record<string, { key: string; section: 'feature' | 'keyPurpose' }>
> = {
  mtls: { key: 'mtls', section: 'feature' },
  a2a_card_signing: { key: 'agent_card_signing', section: 'keyPurpose' },
};

export function checkVcmParity(
  d: SecurityDeclarationBundle,
  services: readonly {
    readonly security: readonly { readonly mechanismKind: string; readonly truthLevel: string }[];
  }[]
): readonly SecurityViolation[] {
  const out: SecurityViolation[] = [];
  for (const service of services) {
    for (const sec of service.security) {
      if (sec.truthLevel === 'ACTIVE' || sec.truthLevel === 'VERIFIED') {
        if (d.truthLevelCeiling !== 'IMPLEMENTED' && d.truthLevelCeiling !== 'CONFIGURED') continue;
        out.push(
          mismatch(
            `vcm.${sec.mechanismKind}`,
            'static effective view asserts a level the declaration ceiling forbids'
          )
        );
      }
      const mapped = MECHANISM_TO_FEATURE[sec.mechanismKind];
      if (!mapped) continue;
      const status =
        mapped.section === 'feature'
          ? feature(d, mapped.key)
          : d.keyPurposeBoundaries.find((k) => k.purpose === mapped.key)?.status;
      if (status === 'IMPLEMENTED_ENFORCED' && sec.truthLevel === 'IMPLEMENTED') {
        out.push(
          mismatch(
            `vcm.${sec.mechanismKind}`,
            'declaration enforces a mechanism VCM records only as IMPLEMENTED (not configured)'
          )
        );
      }
    }
  }
  return out;
}

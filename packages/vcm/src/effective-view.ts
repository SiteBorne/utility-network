/**
 * The single pure deterministic resolver: project(static, overlay) =
 * EffectiveMetadataView (Master Reference Part II §XII). No process.env, no
 * Cloudflare bindings, no network calls, no secret access, no mutation of
 * inputs, no protocol-specific output -- this package only validates and
 * resolves; protocol adapters (METADATA-VCM-04+) consume the result.
 */
import { canonicalize, hashCanonical } from './canonical';
import type { IsoTimestamp, Sha256Digest } from './primitives';
import type { CanonicalServiceIdValue } from './service-id';
import { toServiceIdValue } from './service-id';
import type {
  CanonicalStaticModel,
  Price,
  SecurityMechanismKind,
  SecurityTruthLevel,
} from './types';
import type { RuntimeStateOverlay } from './runtime-overlay';
import { UNMEASURED, type MeasuredOrUnmeasured } from './sentinels';

export interface EffectiveInteractionView {
  readonly operationId: string;
  readonly capabilityExists: true;
  readonly protocolExposed: boolean;
  readonly runtimeEnabled: boolean;
  readonly economicAdmissionEnabled: boolean;
}

export interface EffectiveSecurityView {
  readonly mechanismKind: SecurityMechanismKind;
  readonly truthLevel: SecurityTruthLevel | 'UNMEASURED';
}

export interface EffectiveServiceView {
  readonly id: CanonicalServiceIdValue;
  readonly title: string;
  readonly description: string;
  readonly lifecycleState: string;
  readonly interactions: readonly EffectiveInteractionView[];
  readonly security: readonly EffectiveSecurityView[];
  readonly listPrice: Price;
  readonly governedMaxPrice: Price;
}

export interface EffectiveMetadataView {
  readonly digest: Sha256Digest;
  readonly organizationPublicName: string;
  readonly services: readonly EffectiveServiceView[];
  readonly generatedAt: IsoTimestamp; // excluded from the digest
}

/** Deterministic ordering key for anything canonically set-like (services,
 * interactions, protocol-exposure entries) -- never rely on filesystem
 * enumeration order, Map insertion order, or object construction order. */
function byString<T>(key: (item: T) => string) {
  return (a: T, b: T): number => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
}

function resolveInteraction(
  serviceIdValue: CanonicalServiceIdValue,
  operationId: string,
  staticProtocolExposed: boolean,
  overlay: RuntimeStateOverlay
): EffectiveInteractionView {
  const route = overlay.routes.find(
    (r) => r.serviceId === serviceIdValue && r.interactionOperationId === operationId
  );
  // Narrowing law: effective exposure/enablement can never exceed what the
  // static model declared, and an overlay entry can only ever disable, not
  // enable, something the static model marked unexposed.
  const runtimeEnabled = staticProtocolExposed && (route?.runtimeEnabled ?? false);
  const economicAdmissionEnabled = runtimeEnabled && (route?.economicAdmissionEnabled ?? false);
  return {
    operationId,
    capabilityExists: true,
    protocolExposed: staticProtocolExposed,
    runtimeEnabled,
    economicAdmissionEnabled,
  };
}

function resolveSecurity(
  mechanismKind: SecurityMechanismKind,
  staticCeiling: 'IMPLEMENTED' | 'CONFIGURED',
  overlay: RuntimeStateOverlay
): EffectiveSecurityView {
  const measured = overlay.security.find((s) => s.mechanismKind === mechanismKind);
  const level: MeasuredOrUnmeasured<'ACTIVE' | 'VERIFIED'> = measured?.measuredLevel ?? UNMEASURED;
  if (typeof level !== 'string') {
    return { mechanismKind, truthLevel: staticCeiling };
  }
  // A measured ACTIVE/VERIFIED level is only meaningful capped at what the
  // static model actually declared support for -- CONFIGURED is required
  // before ACTIVE can mean anything, IMPLEMENTED-only mechanisms cannot be
  // reported as ACTIVE regardless of what an overlay claims.
  if (staticCeiling === 'IMPLEMENTED') {
    return { mechanismKind, truthLevel: 'IMPLEMENTED' };
  }
  return { mechanismKind, truthLevel: level };
}

export interface ProjectOptions {
  readonly generatedAt: IsoTimestamp;
}

export async function project(
  staticModel: CanonicalStaticModel,
  overlay: RuntimeStateOverlay,
  options: ProjectOptions
): Promise<EffectiveMetadataView> {
  const services: EffectiveServiceView[] = [...staticModel.services]
    .sort(byString((s) => toServiceIdValue(s.id)))
    .map((service) => {
      const serviceIdValue = toServiceIdValue(service.id);
      const staticallyExposedSurfaces = new Set(
        service.protocolExposure.filter((p) => p.protocolExposed).map((p) => p.surface)
      );
      const interactions = [...service.interactions]
        .sort(byString((i) => i.operationId))
        .map((interaction) =>
          resolveInteraction(
            serviceIdValue,
            interaction.operationId,
            staticallyExposedSurfaces.size > 0,
            overlay
          )
        );
      const security = [...service.securityCapabilities]
        .sort(byString((s) => s.mechanism.kind))
        .map((cap) => resolveSecurity(cap.mechanism.kind, cap.truthLevel, overlay));
      return {
        id: serviceIdValue,
        title: service.title,
        description: service.description,
        lifecycleState: service.lifecycleState,
        interactions,
        security,
        listPrice: service.economics.listPrice,
        governedMaxPrice: service.economics.governedMaxPrice,
      };
    });

  const digestInput = {
    organizationPublicName: staticModel.organization.publicName,
    services,
  };
  const digest = (await hashCanonical(digestInput)) as Sha256Digest;

  return {
    digest,
    organizationPublicName: staticModel.organization.publicName,
    services,
    generatedAt: options.generatedAt,
  };
}

export { canonicalize };

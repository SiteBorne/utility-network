/**
 * The single pure deterministic resolver: project(static, overlay) =
 * EffectiveMetadataView (Master Reference Part II §XII). No process.env, no
 * Cloudflare bindings, no network calls, no secret access, no mutation of
 * inputs, no protocol-specific output -- this package only validates and
 * resolves; protocol adapters (METADATA-VCM-04+) consume the result.
 */
import type { EconomicOffer } from '@siteborne/pricing';
import { canonicalize, hashCanonical } from './canonical';
import type { IsoTimestamp, Sha256Digest } from './primitives';
import type { CanonicalServiceIdValue } from './service-id';
import { toServiceIdValue } from './service-id';
import type {
  AuthorizationClassification,
  CanonicalStaticModel,
  CurrentStaticProtocolExposure,
  ExposureShape,
  Price,
  ProtocolSurface,
  SecurityMechanismKind,
  SecurityTruthLevel,
  ServiceContractRef,
} from './types';
import type { RuntimeStateOverlay } from './runtime-overlay';
import { UNMEASURED, type MeasuredOrUnmeasured } from './sentinels';

export interface EffectiveInteractionView {
  readonly operationId: string;
  readonly capabilityExists: true;
  /** Pass-through of `CanonicalInteraction.{readOnly,destructive,idempotent}`
   * (METADATA-VCM-IMPL-03B) -- needed by protocol shadow projections (MCP
   * tool annotations) that were not previously threaded through this view.
   * Static-only: no overlay measures or narrows these. */
  readonly readOnly: boolean;
  readonly destructive: boolean;
  readonly idempotent: boolean;
  readonly currentStaticExposures: readonly EffectiveCurrentExposureView[];
}

export interface EffectiveCurrentExposureView {
  readonly surface: ProtocolSurface;
  readonly registrationId: string;
  readonly exposureShape: ExposureShape;
  readonly runtimeEnabled: boolean;
  readonly economicAdmissionEnabled: boolean;
  readonly externalPublication: MeasuredOrUnmeasured<'PUBLISHED' | 'NOT_PUBLISHED'>;
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
  /** Pass-through of `CanonicalService.capabilities` (METADATA-VCM-IMPL-03B
   * §"EffectiveMetadataView extension") -- needed by protocol shadow
   * projections (A2A skill tags) that were not previously threaded through
   * this view. Static-only: no overlay narrows or measures it. */
  readonly capabilities: readonly string[];
  readonly declaredLimitations: readonly string[];
  readonly authorizationClassification: AuthorizationClassification;
  readonly contract: ServiceContractRef;
  readonly interactions: readonly EffectiveInteractionView[];
  readonly security: readonly EffectiveSecurityView[];
  readonly listPrice: Price;
  readonly governedMaxPrice: Price;
  /** Canonical economic contract (static/normative part only); operational
   * facts are injected by each projector from its own context. */
  readonly economicOffer: EconomicOffer;
}

export interface EffectiveMetadataView {
  readonly digest: Sha256Digest;
  readonly organizationPublicName: string;
  readonly services: readonly EffectiveServiceView[];
  readonly utilityExposures: readonly EffectiveCurrentExposureView[];
  readonly generatedAt: IsoTimestamp; // excluded from the digest
}

/** Deterministic ordering key for anything canonically set-like (services,
 * interactions, protocol-exposure entries) -- never rely on filesystem
 * enumeration order, Map insertion order, or object construction order. */
function byString<T>(key: (item: T) => string) {
  return (a: T, b: T): number => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
}

function resolveExposure(
  exposure: CurrentStaticProtocolExposure,
  overlay: RuntimeStateOverlay
): EffectiveCurrentExposureView {
  const activation = overlay.protocolActivations.find(
    (candidate) =>
      candidate.surface === exposure.surface && candidate.registrationId === exposure.registrationId
  );
  const publication = overlay.externalPublications.find(
    (candidate) =>
      candidate.surface === exposure.surface && candidate.registrationId === exposure.registrationId
  );
  const runtimeEnabled = activation?.runtimeEnabled ?? false;
  const economicAdmissionEnabled =
    runtimeEnabled && (activation?.economicAdmissionEnabled ?? false);
  return {
    surface: exposure.surface,
    registrationId: exposure.registrationId,
    exposureShape: exposure.exposureShape,
    runtimeEnabled,
    economicAdmissionEnabled,
    externalPublication: publication?.publicationState ?? UNMEASURED,
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
      const interactions = [...service.interactions]
        .sort(byString((i) => i.operationId))
        .map((interaction) => ({
          operationId: interaction.operationId,
          capabilityExists: true as const,
          readOnly: interaction.readOnly,
          destructive: interaction.destructive,
          idempotent: interaction.idempotent,
          currentStaticExposures: service.currentStaticExposures
            .filter((exposure) => exposure.operationId === interaction.operationId)
            .sort(byString((exposure) => `${exposure.surface}:${exposure.registrationId}`))
            .map((exposure) => resolveExposure(exposure, overlay)),
        }));
      const security = [...service.securityCapabilities]
        .sort(byString((s) => s.mechanism.kind))
        .map((cap) => resolveSecurity(cap.mechanism.kind, cap.truthLevel, overlay));
      return {
        id: serviceIdValue,
        title: service.title,
        description: service.description,
        lifecycleState: service.lifecycleState,
        capabilities: service.capabilities,
        declaredLimitations: service.declaredLimitations,
        authorizationClassification: service.authorizationClassification,
        contract: service.contract,
        interactions,
        security,
        listPrice: service.economics.listPrice,
        governedMaxPrice: service.economics.governedMaxPrice,
        economicOffer: service.economics.offer,
      };
    });

  const utilityExposures = [...staticModel.currentStaticUtilityExposures]
    .sort(byString((exposure) => `${exposure.surface}:${exposure.registrationId}`))
    .map((exposure) => resolveExposure(exposure, overlay));

  const digestInput = {
    organizationPublicName: staticModel.organization.publicName,
    services,
    utilityExposures,
  };
  const digest = (await hashCanonical(digestInput)) as Sha256Digest;

  return {
    digest,
    organizationPublicName: staticModel.organization.publicName,
    services,
    utilityExposures,
    generatedAt: options.generatedAt,
  };
}

export { canonicalize };

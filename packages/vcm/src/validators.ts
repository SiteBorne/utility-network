/**
 * Runtime validators (Master Reference Part II §XV). Errors are
 * deterministic, structured, and closed/classifiable -- every failure mode
 * has a stable `code` a test can assert on. This package's internal error
 * classification is intentionally minimal; the expanded caller-visible
 * machine-error taxonomy is reserved for METADATA-VCM-04 and is not
 * implemented here.
 *
 * `validateEconomicConstraints` never throws: per the explicit resolution
 * of the SEMANTIC_DESIGN_DELTA discovered while building the legacy
 * importer (docs/reports/METADATA-VCM-IMPL-01-truth-core-and-registry-parity.md
 * §V), a real, present-day violation exists in
 * registry/services/company_evidence_graph.v2.json. This function detects
 * and reports such a violation as a structured, non-fatal finding so the
 * legacy import/round-trip parity proof (a distinct concern -- "did we
 * reproduce what exists") can still run to completion, while the violation
 * itself is never hidden, never silently passed, and never resolved by
 * this package. See validators.test.ts for the exact real-data case.
 */
import { usdToMicro } from '@siteborne/pricing';
import { isSha256Digest } from './primitives';
import { toServiceIdValue } from './service-id';
import { EXPOSURE_SHAPES, isLifecycleState } from './types';
import type { CanonicalService, CanonicalStaticModel } from './types';
import type { RuntimeStateOverlay } from './runtime-overlay';
import { computeModelDigest } from './digests';

export interface ValidationError {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export type ValidationResult =
  | { readonly ok: true; readonly errors: readonly [] }
  | { readonly ok: false; readonly errors: readonly ValidationError[] };

function ok(): ValidationResult {
  return { ok: true, errors: [] };
}
function fail(errors: ValidationError[]): ValidationResult {
  return { ok: false, errors };
}

// ---------------------------------------------------------------------------
// validateCanonicalModel -- structural invariants over the static model
// alone (no overlay, no governance cross-check -- that is
// validateEconomicConstraints' job).
// ---------------------------------------------------------------------------
export function validateCanonicalModel(model: CanonicalStaticModel): ValidationResult {
  const errors: ValidationError[] = [];
  const seenServiceIds = new Set<string>();
  const seenExposureRegistrations = new Set<string>();
  const seenProtocolOperations = new Set<string>();

  for (const service of model.services) {
    const idValue = toServiceIdValue(service.id);
    if (seenServiceIds.has(idValue)) {
      errors.push({
        code: 'DUPLICATE_SERVICE_ID',
        path: `services[${idValue}]`,
        message: `duplicate service id "${idValue}"`,
      });
    }
    seenServiceIds.add(idValue);

    if (!isLifecycleState(service.lifecycleState)) {
      errors.push({
        code: 'INVALID_LIFECYCLE_STATE',
        path: `services[${idValue}].lifecycleState`,
        message: `"${service.lifecycleState}" is not a known LifecycleState`,
      });
    }

    const seenOperationIds = new Set<string>();
    for (const interaction of service.interactions) {
      if (seenOperationIds.has(interaction.operationId)) {
        errors.push({
          code: 'DUPLICATE_OPERATION_ID',
          path: `services[${idValue}].interactions[${interaction.operationId}]`,
          message: `duplicate operationId "${interaction.operationId}" within service "${idValue}"`,
        });
      }
      seenOperationIds.add(interaction.operationId);
    }

    for (const schemaRef of [service.contract.inputSchema, service.contract.outputSchema]) {
      if (!isSha256Digest(schemaRef.digest)) {
        errors.push({
          code: 'MALFORMED_SCHEMA_DIGEST',
          path: `services[${idValue}].contract`,
          message: `schema digest "${schemaRef.digest}" is not a valid sha256:<64 hex> digest`,
        });
      }
    }

    for (const exposure of service.currentStaticExposures) {
      const registrationKey = `${exposure.surface}:${exposure.registrationId}`;
      const operationKey = `${exposure.surface}:service:${idValue}:${exposure.operationId}`;
      if (!(EXPOSURE_SHAPES as readonly string[]).includes(exposure.exposureShape)) {
        errors.push({
          code: 'UNSUPPORTED_EXPOSURE_SHAPE',
          path: `services[${idValue}].currentStaticExposures[${registrationKey}]`,
          message: `unsupported exposure shape "${exposure.exposureShape}"`,
        });
      }
      if (!seenOperationIds.has(exposure.operationId)) {
        errors.push({
          code: 'CURRENT_EXPOSURE_UNKNOWN_OPERATION',
          path: `services[${idValue}].currentStaticExposures[${registrationKey}]`,
          message: `current exposure references unknown operation "${exposure.operationId}"`,
        });
      }
      if (seenExposureRegistrations.has(registrationKey)) {
        errors.push({
          code: 'DUPLICATE_CURRENT_REGISTRATION',
          path: `services[${idValue}].currentStaticExposures[${registrationKey}]`,
          message: `duplicate current registration "${registrationKey}"`,
        });
      }
      seenExposureRegistrations.add(registrationKey);
      if (seenProtocolOperations.has(operationKey)) {
        errors.push({
          code: 'DUPLICATE_PROTOCOL_OPERATION_EXPOSURE',
          path: `services[${idValue}].currentStaticExposures[${operationKey}]`,
          message: `duplicate protocol/operation exposure "${operationKey}"`,
        });
      }
      seenProtocolOperations.add(operationKey);
    }
  }

  for (const exposure of model.currentStaticUtilityExposures) {
    const registrationKey = `${exposure.surface}:${exposure.registrationId}`;
    const operationKey = `${exposure.surface}:utility:${exposure.operationId}`;
    if (!(EXPOSURE_SHAPES as readonly string[]).includes(exposure.exposureShape)) {
      errors.push({
        code: 'UNSUPPORTED_EXPOSURE_SHAPE',
        path: `currentStaticUtilityExposures[${registrationKey}]`,
        message: `unsupported exposure shape "${exposure.exposureShape}"`,
      });
    }
    if (seenExposureRegistrations.has(registrationKey)) {
      errors.push({
        code: 'DUPLICATE_CURRENT_REGISTRATION',
        path: `currentStaticUtilityExposures[${registrationKey}]`,
        message: `duplicate current registration "${registrationKey}"`,
      });
    }
    seenExposureRegistrations.add(registrationKey);
    if (seenProtocolOperations.has(operationKey)) {
      errors.push({
        code: 'DUPLICATE_PROTOCOL_OPERATION_EXPOSURE',
        path: `currentStaticUtilityExposures[${operationKey}]`,
        message: `duplicate protocol/operation exposure "${operationKey}"`,
      });
    }
    seenProtocolOperations.add(operationKey);
  }

  return errors.length === 0 ? ok() : fail(errors);
}

// The canonical offer must describe the same service and the same commercial
// facts the scalar economics fields already carry: identity, scheme support,
// list price, and (for tiered upto offers) the authorization ceiling.
function validateEconomicOffer(service: CanonicalService, idValue: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const path = `services[${idValue}].economics.offer`;
  const { offer, supportedSchemes, listPrice } = service.economics;
  if (offer.serviceId !== idValue) {
    errors.push({
      code: 'ECONOMIC_OFFER_IDENTITY_MISMATCH',
      path,
      message: `offer.serviceId "${offer.serviceId}" !== service id "${idValue}"`,
    });
  }
  if (!supportedSchemes.some((entry) => entry.scheme === offer.scheme)) {
    errors.push({
      code: 'ECONOMIC_OFFER_SCHEME_UNSUPPORTED',
      path,
      message: `offer scheme "${offer.scheme}" is not among the service's supported schemes`,
    });
  }
  const defaultMode = offer.modes.find((mode) => mode.mode === offer.defaultMode);
  if (!defaultMode || !defaultMode.available) {
    errors.push({
      code: 'ECONOMIC_OFFER_DEFAULT_MODE_UNAVAILABLE',
      path,
      message: `offer default mode "${offer.defaultMode}" is missing or unavailable`,
    });
  }
  // The scalar listPrice is the offer's primary unit price: the exact request
  // price, or the lowest per-page tier for a metered offer.
  const primaryUnitAmount =
    offer.tierPrices && offer.tierPrices.length > 0
      ? offer.tierPrices[0].amountUsd
      : defaultMode?.amountUsd;
  if (
    primaryUnitAmount !== undefined &&
    usdToMicro(primaryUnitAmount) !== usdToMicro(listPrice.amount)
  ) {
    errors.push({
      code: 'ECONOMIC_OFFER_PRICE_MISMATCH',
      path,
      message: `offer primary unit price ${primaryUnitAmount} USD !== listPrice ${listPrice.amount} USD`,
    });
  }
  if (offer.tierPrices && defaultMode) {
    const ceiling = usdToMicro(defaultMode.amountUsd);
    for (const tier of offer.tierPrices) {
      if (usdToMicro(tier.amountUsd) > ceiling) {
        errors.push({
          code: 'ECONOMIC_OFFER_TIER_EXCEEDS_CEILING',
          path,
          message: `tier ${tier.tier} ${tier.amountUsd} USD exceeds the authorization maximum ${defaultMode.amountUsd} USD`,
        });
      }
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// validateEconomicConstraints -- listPrice <= governedMaxPrice per service,
// decimal-safe (BigInt micro-USD via @siteborne/pricing, never
// Number()/parseFloat()). Reports every violation; never throws.
// ---------------------------------------------------------------------------
export function validateEconomicConstraints(model: CanonicalStaticModel): ValidationResult {
  const errors: ValidationError[] = [];
  for (const service of model.services) {
    const idValue = toServiceIdValue(service.id);
    const { listPrice, governedMaxPrice } = service.economics;
    if (listPrice.currency !== governedMaxPrice.currency) {
      errors.push({
        code: 'CURRENCY_MISMATCH',
        path: `services[${idValue}].economics`,
        message: `listPrice currency "${listPrice.currency}" !== governedMaxPrice currency "${governedMaxPrice.currency}"`,
      });
      continue;
    }
    const listMicro = usdToMicro(listPrice.amount);
    const maxMicro = usdToMicro(governedMaxPrice.amount);
    if (listMicro > maxMicro) {
      errors.push({
        code: 'ECONOMIC_CEILING_VIOLATION',
        path: `services[${idValue}].economics`,
        message: `listPrice ${listPrice.amount} USD exceeds governedMaxPrice ${governedMaxPrice.amount} USD`,
      });
    }
    errors.push(...validateEconomicOffer(service, idValue));
  }
  return errors.length === 0 ? ok() : fail(errors);
}

// ---------------------------------------------------------------------------
// validateSecurityTruthConstraints -- defense-in-depth over parsed/untyped
// input; the TypeScript shape already makes ACTIVE/VERIFIED unconstructible
// in CanonicalStaticModel, but this guards data that arrived as JSON
// (e.g. from the legacy importer) before it is trusted as a
// StaticSecurityTruthLevel.
// ---------------------------------------------------------------------------
export function validateSecurityTruthConstraints(model: CanonicalStaticModel): ValidationResult {
  const errors: ValidationError[] = [];
  for (const service of model.services) {
    const idValue = toServiceIdValue(service.id);
    for (const cap of service.securityCapabilities) {
      if (cap.truthLevel !== 'IMPLEMENTED' && cap.truthLevel !== 'CONFIGURED') {
        errors.push({
          code: 'STATIC_MODEL_CLAIMS_LIVE_ACTIVATION',
          path: `services[${idValue}].securityCapabilities[${cap.mechanism.kind}]`,
          message: `static model claims truthLevel "${cap.truthLevel}" -- only IMPLEMENTED/CONFIGURED are constructible statically`,
        });
      }
    }
  }
  return errors.length === 0 ? ok() : fail(errors);
}

// ---------------------------------------------------------------------------
// validateRuntimeOverlay -- OverlayDomain ⊆ StaticPossibilitySpace. Every
// overlay entry must reference a service/interaction/mechanism that
// actually exists in the static model; an overlay can never introduce a
// new one.
// ---------------------------------------------------------------------------
export function validateRuntimeOverlay(
  overlay: RuntimeStateOverlay,
  model: CanonicalStaticModel
): ValidationResult {
  const errors: ValidationError[] = [];
  const serviceById = new Map<string, CanonicalService>(
    model.services.map((s) => [toServiceIdValue(s.id), s])
  );

  const staticExposureKeys = new Set([
    ...model.services.flatMap((service) =>
      service.currentStaticExposures.map(
        (exposure) => `${exposure.surface}:${exposure.registrationId}`
      )
    ),
    ...model.currentStaticUtilityExposures.map(
      (exposure) => `${exposure.surface}:${exposure.registrationId}`
    ),
  ]);

  for (const activation of overlay.protocolActivations) {
    const key = `${activation.surface}:${activation.registrationId}`;
    if (!staticExposureKeys.has(key)) {
      errors.push({
        code: 'OPERATIONAL_ACTIVATION_WITHOUT_STATIC_EXPOSURE',
        path: `protocolActivations[${key}]`,
        message: `operational activation references unregistered static exposure "${key}"`,
      });
    }
  }

  for (const publication of overlay.externalPublications) {
    const key = `${publication.surface}:${publication.registrationId}`;
    if (!staticExposureKeys.has(key)) {
      errors.push({
        code: 'EXTERNAL_PUBLICATION_WITHOUT_STATIC_EXPOSURE',
        path: `externalPublications[${key}]`,
        message: `external publication references unregistered static exposure "${key}"`,
      });
    }
  }

  for (const econ of overlay.economics) {
    const service = serviceById.get(econ.serviceId);
    if (!service) {
      errors.push({
        code: 'OVERLAY_UNKNOWN_SERVICE',
        path: `economics[${econ.serviceId}]`,
        message: `overlay references unknown service "${econ.serviceId}"`,
      });
      continue;
    }
    if (!('kind' in econ.effectiveRuntimePrice)) {
      const runtimeMicro = usdToMicro(econ.effectiveRuntimePrice.amount);
      const ceilingMicro = usdToMicro(service.economics.governedMaxPrice.amount);
      if (runtimeMicro > ceilingMicro) {
        errors.push({
          code: 'OVERLAY_PRICE_EXCEEDS_CEILING',
          path: `economics[${econ.serviceId}]`,
          message: `overlay effectiveRuntimePrice ${econ.effectiveRuntimePrice.amount} USD exceeds governedMaxPrice ${service.economics.governedMaxPrice.amount} USD`,
        });
      }
    }
    if (typeof econ.activeNetwork === 'string') {
      const activeNetwork = econ.activeNetwork;
      const supported = service.economics.supportedSchemes.some((s) =>
        s.networks.includes(activeNetwork)
      );
      if (!supported) {
        errors.push({
          code: 'OVERLAY_UNSUPPORTED_NETWORK',
          path: `economics[${econ.serviceId}]`,
          message: `overlay activeNetwork "${activeNetwork}" is not in any supported scheme/network pair`,
        });
      }
    }
  }

  for (const sec of overlay.security) {
    const anyMechanismDeclared = model.services.some((s) =>
      s.securityCapabilities.some((c) => c.mechanism.kind === sec.mechanismKind)
    );
    if (!anyMechanismDeclared) {
      errors.push({
        code: 'OVERLAY_UNKNOWN_SECURITY_MECHANISM',
        path: `security[${sec.mechanismKind}]`,
        message: `overlay claims measurement for security mechanism "${sec.mechanismKind}" not declared by any service's static model`,
      });
    }
  }

  for (const qual of overlay.qualification) {
    if (!serviceById.has(qual.serviceId)) {
      errors.push({
        code: 'OVERLAY_UNKNOWN_SERVICE',
        path: `qualification[${qual.serviceId}]`,
        message: `overlay references unknown service "${qual.serviceId}"`,
      });
    }
  }

  return errors.length === 0 ? ok() : fail(errors);
}

// ---------------------------------------------------------------------------
// validateDigestIntegrity -- the model's own modelIdentity.modelDigest must
// equal a fresh recomputation.
// ---------------------------------------------------------------------------
export async function validateDigestIntegrity(
  model: CanonicalStaticModel
): Promise<ValidationResult> {
  const recomputed = await computeModelDigest(model);
  if (recomputed !== model.modelIdentity.modelDigest) {
    return fail([
      {
        code: 'MODEL_DIGEST_MISMATCH',
        path: 'modelIdentity.modelDigest',
        message: `stored digest "${model.modelIdentity.modelDigest}" !== recomputed digest "${recomputed}"`,
      },
    ]);
  }
  return ok();
}

/** Combined authority-constraint check: static model structure +
 * security-truth ceiling. (Economic ceiling is reported separately, by
 * design, since it is expected to legitimately fail on today's real data --
 * see the module doc comment above.) */
export function validateAuthorityConstraints(model: CanonicalStaticModel): ValidationResult {
  const structural = validateCanonicalModel(model);
  const security = validateSecurityTruthConstraints(model);
  const errors = [...structural.errors, ...security.errors];
  return errors.length === 0 ? ok() : fail(errors);
}

import {
  compareProjections,
  summarizeDifferences,
  type ComparatorConfig,
  type DifferenceSummary,
} from '@siteborne/vcm';
import {
  recordMetadataProjectionComparison,
  recordMetadataProjectionLifecycle,
  type MetadataProjectionFailureReason,
} from '../telemetry/metadata-projection-telemetry';

export type PrimaryProjectionSurface = 'a2a' | 'mcp';

export type PrimarySelectionReason =
  | 'semantic_match'
  | 'semantic_mismatch'
  | 'primary_projection_failure'
  | 'primary_validation_failure'
  | 'comparison_failure';

export type PrimarySelectionResult<T> =
  | {
      readonly selectedProducer: 'vcm';
      readonly selected: T;
      readonly primary: T;
      readonly legacy: T;
      readonly reason: 'semantic_match';
      readonly differenceSummary: DifferenceSummary;
    }
  | {
      readonly selectedProducer: 'legacy';
      readonly selected: T;
      readonly primary?: T;
      readonly legacy: T;
      readonly reason: Exclude<PrimarySelectionReason, 'semantic_match'>;
      readonly differenceSummary?: DifferenceSummary;
    };

export interface SelectPrimaryProjectionParams<T> {
  readonly surface: PrimaryProjectionSurface;
  readonly buildLegacy: () => T | Promise<T>;
  readonly buildPrimary: () => T | Promise<T>;
  readonly validatePrimary: (candidate: T) => void | Promise<void>;
  readonly governedDifferences?: ComparatorConfig['governedDifferences'];
}

function safeLifecycle(
  surface: PrimaryProjectionSurface,
  event: Parameters<typeof recordMetadataProjectionLifecycle>[0]['event'],
  reason?: MetadataProjectionFailureReason
): void {
  try {
    recordMetadataProjectionLifecycle({
      event,
      surface,
      mode: 'vcm_primary_compare',
      ...(reason ? { reason } : {}),
    });
  } catch {
    // Telemetry is observational and cannot affect producer selection.
  }
}

function safeComparison(
  surface: PrimaryProjectionSurface,
  differenceSummary: DifferenceSummary,
  fellBackToLegacy: boolean,
  fallbackReason?: MetadataProjectionFailureReason
): void {
  try {
    recordMetadataProjectionComparison({
      surface,
      differenceSummary,
      fellBackToLegacy,
      mode: 'vcm_primary_compare',
      ...(fallbackReason ? { fallbackReason } : {}),
    });
  } catch {
    // Telemetry is observational and cannot affect producer selection.
  }
}

export async function selectPrimaryProjection<T>(
  params: SelectPrimaryProjectionParams<T>
): Promise<PrimarySelectionResult<T>> {
  const { surface, buildLegacy, buildPrimary, validatePrimary, governedDifferences } = params;

  safeLifecycle(surface, 'metadata_projection_legacy_reference_attempt_total');
  let legacy: T;
  try {
    legacy = await buildLegacy();
  } catch (error) {
    safeLifecycle(surface, 'metadata_projection_primary_failure_total', 'legacy_reference');
    throw error;
  }

  safeLifecycle(surface, 'metadata_projection_primary_attempt_total');
  let primary: T;
  try {
    primary = await buildPrimary();
  } catch {
    safeLifecycle(surface, 'metadata_projection_primary_failure_total', 'projector');
    safeLifecycle(surface, 'metadata_projection_fallback_total', 'projector');
    return {
      selectedProducer: 'legacy',
      selected: legacy,
      legacy,
      reason: 'primary_projection_failure',
    };
  }

  try {
    await validatePrimary(primary);
  } catch {
    safeLifecycle(surface, 'metadata_projection_validation_failure_total', 'validation');
    safeLifecycle(surface, 'metadata_projection_primary_failure_total', 'validation');
    safeLifecycle(surface, 'metadata_projection_fallback_total', 'validation');
    return {
      selectedProducer: 'legacy',
      selected: legacy,
      primary,
      legacy,
      reason: 'primary_validation_failure',
    };
  }

  let differenceSummary: DifferenceSummary;
  try {
    differenceSummary = summarizeDifferences(
      compareProjections(legacy, primary, { governedDifferences })
    );
  } catch {
    safeLifecycle(surface, 'metadata_projection_comparator_failure_total', 'comparator');
    safeLifecycle(surface, 'metadata_projection_fallback_total', 'comparator');
    return {
      selectedProducer: 'legacy',
      selected: legacy,
      primary,
      legacy,
      reason: 'comparison_failure',
    };
  }

  if (differenceSummary.UNEXPLAINED_DIFFERENCE > 0) {
    safeComparison(surface, differenceSummary, true, 'mismatch');
    return {
      selectedProducer: 'legacy',
      selected: legacy,
      primary,
      legacy,
      reason: 'semantic_mismatch',
      differenceSummary,
    };
  }

  safeComparison(surface, differenceSummary, false);
  safeLifecycle(surface, 'metadata_projection_primary_success_total');
  return {
    selectedProducer: 'vcm',
    selected: primary,
    primary,
    legacy,
    reason: 'semantic_match',
    differenceSummary,
  };
}

import type {
  DriftChange,
  DriftClassification,
  DriftPolicy,
  DriftResult,
  DriftResultClass,
} from './types';

export function classifyDrift(
  changes: DriftChange[],
  policy: DriftPolicy = { allowOptionalAdditions: false, requireAllFields: false }
): { classification: DriftClassification; resultClass: DriftResultClass; reviewRequired: boolean } {
  const hasQuarantine = changes.some((c) => c.severity === 'quarantine');
  if (hasQuarantine) {
    return { classification: 'quarantined', resultClass: 'quarantined', reviewRequired: true };
  }

  const hasUnsafe = changes.some((c) => c.severity === 'unsafe');
  if (hasUnsafe) {
    return {
      classification: 'source_changed',
      resultClass: 'source_changed',
      reviewRequired: true,
    };
  }

  const onlyOptionalAdditions =
    changes.length > 0 &&
    changes.every(
      (c) => c.type === 'optional_field_added' || c.type === 'pagination_shape_changed'
    );
  const canContinue =
    onlyOptionalAdditions &&
    changes.every((c) => c.severity === 'safe') &&
    policy.allowOptionalAdditions;

  return {
    classification: canContinue ? 'continue' : 'source_changed',
    resultClass: canContinue ? 'source_changed' : 'source_changed',
    reviewRequired: !canContinue,
  };
}

export function summarizeChanges(changes: DriftChange[]): string {
  if (changes.length === 0) return 'No drift detected';
  const bySeverity = {
    safe: changes.filter((c) => c.severity === 'safe').length,
    unsafe: changes.filter((c) => c.severity === 'unsafe').length,
    quarantine: changes.filter((c) => c.severity === 'quarantine').length,
  };
  const types = new Set(changes.map((c) => c.type));
  return `${changes.length} change(s): ${bySeverity.unsafe} unsafe, ${bySeverity.quarantine} quarantine, ${bySeverity.safe} safe; types=[${[...types].join(',')}]`;
}

export function buildDriftResult(params: {
  providerId: string;
  capability: string;
  expectedShapeHash: string;
  observedShapeHash: string;
  changes: DriftChange[];
  classification: DriftClassification;
  resultClass: DriftResultClass;
  reviewRequired: boolean;
  safeToContinue: boolean;
  observedAt?: Date;
}): DriftResult {
  const at = (params.observedAt ?? new Date()).toISOString();
  return {
    provider_id: params.providerId,
    capability: params.capability,
    expected_shape_hash: params.expectedShapeHash,
    observed_shape_hash: params.observedShapeHash,
    changes: params.changes,
    classification: params.classification,
    safe_to_continue: params.safeToContinue,
    result_class: params.resultClass,
    review_required: params.reviewRequired,
    audit_event: {
      event_type: 'source_drift_detected',
      provider_id: params.providerId,
      capability: params.capability,
      timestamp: at,
      changes_summary: summarizeChanges(params.changes),
      classification: params.classification,
    },
  };
}

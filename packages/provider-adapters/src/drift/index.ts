import type { DriftDetectionOptions, DriftResult } from './types';
import { compareSchemas } from './compare';
import { classifyDrift, buildDriftResult, summarizeChanges } from './classify';
import { computeShapeHash, inferSchema } from './shape';

export type {
  DriftChange,
  DriftChangeSchema,
  DriftChangeType,
  DriftChangeTypeSchema,
  DriftClassification,
  DriftClassificationSchema,
  DriftDetectionOptions,
  DriftPolicy,
  DriftResult,
  DriftResultClass,
  DriftResultClassSchema,
  DriftResultSchema,
  DriftSeverity,
  DriftSeveritySchema,
  ShapeSchema,
} from './types';

export { inferSchema, computeShapeHash } from './shape';
export { compareSchemas } from './compare';
export { classifyDrift, summarizeChanges, buildDriftResult } from './classify';

export function detectDrift(options: DriftDetectionOptions): DriftResult {
  const inferred = inferSchema(options.observedData);
  const observedSchema = inferred.schema;
  const expectedHash = options.expectedShapeHash || computeShapeHash(options.expectedSchema);
  const observedHash = options.observedShapeHash || computeShapeHash(observedSchema);

  const policy = options.policy ?? { allowOptionalAdditions: false, requireAllFields: false };
  let changes = compareSchemas(options.expectedSchema, observedSchema, '', policy);

  if (
    options.expectedMediaType &&
    options.observedMediaType &&
    options.expectedMediaType !== options.observedMediaType
  ) {
    changes = [
      ...changes,
      {
        type: 'content_type_changed' as const,
        path: '<root>',
        expected: options.expectedMediaType,
        observed: options.observedMediaType,
        severity: 'unsafe' as const,
        description: `Content-type changed from ${options.expectedMediaType} to ${options.observedMediaType}`,
      },
    ];
  }

  const { classification, resultClass, reviewRequired } = classifyDrift(changes, policy);
  const onlySafe = changes.length > 0 && changes.every((c) => c.severity === 'safe');
  const safeToContinue =
    classification === 'continue' &&
    (onlySafe || (changes.length === 0 && policy.allowOptionalAdditions));

  return buildDriftResult({
    providerId: options.providerId,
    capability: options.capability,
    expectedShapeHash: expectedHash,
    observedShapeHash: observedHash,
    changes,
    classification,
    resultClass,
    reviewRequired,
    safeToContinue,
    observedAt: options.observedAt,
  });
}

export { summarizeChanges as describeDrift };

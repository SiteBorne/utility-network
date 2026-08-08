import { z } from 'zod';

export const DriftChangeTypeSchema = z.enum([
  'optional_field_added',
  'required_field_missing',
  'field_type_changed',
  'array_vs_object_changed',
  'enum_value_changed',
  'pagination_shape_changed',
  'identifier_format_changed',
  'timestamp_format_changed',
  'unexpected_wrapper',
  'removed_wrapper',
  'content_type_changed',
  'excessive_nesting',
  'result_item_shape_changed',
]);
export type DriftChangeType = z.infer<typeof DriftChangeTypeSchema>;

export const DriftSeveritySchema = z.enum(['safe', 'unsafe', 'quarantine']);
export type DriftSeverity = z.infer<typeof DriftSeveritySchema>;

export const DriftClassificationSchema = z.enum(['continue', 'source_changed', 'quarantined']);
export type DriftClassification = z.infer<typeof DriftClassificationSchema>;

export const DriftChangeSchema = z.object({
  type: DriftChangeTypeSchema,
  path: z.string(),
  expected: z.unknown().optional(),
  observed: z.unknown().optional(),
  severity: DriftSeveritySchema,
  description: z.string(),
});
export type DriftChange = z.infer<typeof DriftChangeSchema>;

export const DriftResultClassSchema = z.enum(['source_changed', 'quarantined']);
export type DriftResultClass = z.infer<typeof DriftResultClassSchema>;

export const DriftAuditEventSchema = z.object({
  event_type: z.literal('source_drift_detected'),
  provider_id: z.string(),
  capability: z.string(),
  timestamp: z.string().datetime({ offset: true }),
  changes_summary: z.string(),
  classification: DriftClassificationSchema,
});
export type DriftAuditEvent = z.infer<typeof DriftAuditEventSchema>;

export const DriftResultSchema = z.object({
  provider_id: z.string(),
  capability: z.string(),
  expected_shape_hash: z.string(),
  observed_shape_hash: z.string(),
  changes: z.array(DriftChangeSchema),
  classification: DriftClassificationSchema,
  safe_to_continue: z.boolean(),
  result_class: DriftResultClassSchema,
  review_required: z.boolean(),
  audit_event: DriftAuditEventSchema,
});
export type DriftResult = z.infer<typeof DriftResultSchema>;

export interface ShapeSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' | 'unknown';
  properties?: Record<string, ShapeSchema>;
  items?: ShapeSchema;
  required?: string[];
  optional?: string[];
  enum?: unknown[];
  maxDepth?: number;
  maxItems?: number;
  format?: 'identifier' | 'timestamp' | 'pagination-cursor' | 'content-type' | string;
  parentKey?: string;
}

export interface DriftPolicy {
  allowOptionalAdditions: boolean;
  requireAllFields: boolean;
  maxNestingDepth?: number;
  maxResultItems?: number;
}

export interface DriftDetectionOptions {
  providerId: string;
  capability: string;
  expectedSchema: ShapeSchema;
  observedData: unknown;
  expectedShapeHash: string;
  observedShapeHash?: string;
  observedMediaType?: string;
  expectedMediaType?: string;
  policy?: DriftPolicy;
  observedAt?: Date;
}

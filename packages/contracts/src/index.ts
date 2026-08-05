import { z } from 'zod';

export const ISO8601DateSchema = z.string().datetime({ offset: true });
export type ISO8601Date = z.infer<typeof ISO8601DateSchema>;

export const HashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export type Hash = z.infer<typeof HashSchema>;

export const ServiceIdSchema = z.enum([
  'company_evidence_graph.v1',
  'web_context_verified.v1',
  'document_evidence_json.v1',
  'verify_agent_output.v1',
]);
export type ServiceId = z.infer<typeof ServiceIdSchema>;

export const PromotionStateSchema = z.enum([
  'DRAFT',
  'CASE_SUPPORTED',
  'MULTI_CASE_SUPPORTED',
  'VERIFIED_PATTERN',
  'EXECUTABLE_CANDIDATE',
  'EXECUTABLE_VERIFIED',
  'RETIRED',
  'TOMBSTONED',
]);
export type PromotionState = z.infer<typeof PromotionStateSchema>;

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: ISO8601DateSchema,
  version: z.string(),
  uptime_seconds: z.number().nonnegative(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ReadinessResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  phase: z.string(),
  production_services_enabled: z.boolean(),
  blocked_external: z.array(z.string()),
  reason: z.string(),
});
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;

export const ServiceErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  request_id: z.string(),
});
export type ServiceError = z.infer<typeof ServiceErrorSchema>;

export const RubricCriterionSchema = z.object({
  id: z.string(),
  name: z.string(),
  weight: z.number().int().min(0).max(100),
  score: z.number().min(0).max(100).optional(),
});
export type RubricCriterion = z.infer<typeof RubricCriterionSchema>;

export const RubricEvaluationSchema = z.object({
  criteria: z.array(RubricCriterionSchema),
  total_score: z.number().min(0).max(100),
  threshold_met: z.boolean(),
  hard_gates_pass: z.boolean(),
});
export type RubricEvaluation = z.infer<typeof RubricEvaluationSchema>;

export const TaskRecordSchema = z.object({
  id: z.string().regex(/^SUN-\d{4}$/),
  title: z.string(),
  phase: z.string(),
  state: z.enum([
    'pending',
    'active',
    'in_progress',
    'completed',
    'accepted',
    'blocked_external',
    'cancelled',
    'rejected',
  ]),
  owner_agent: z.string(),
  dependencies: z.array(z.string()),
  rubric_target: z.number().int().min(0).max(100),
  acceptance_tests: z.array(z.string()).min(1),
  evidence: z.array(z.string()),
  next_action: z.string(),
  blocker: z.union([z.string(), z.null()]),
  commit_ref: z.union([z.string(), z.null()]),
});
export type TaskRecord = z.infer<typeof TaskRecordSchema>;

export const DecisionRecordSchema = z
  .object({
    id: z.string().regex(/^\d{4}$/),
    title: z.string(),
    status: z.enum(['proposed', 'accepted', 'rejected', 'superseded']),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    question: z.string(),
    options: z
      .array(
        z.object({
          label: z.string(),
          description: z.string(),
        })
      )
      .min(1),
    selected: z.string(),
    rubric_score: z.number().min(0).max(100).optional(),
    evidence: z.array(z.string()),
    assumptions: z.array(z.string()),
    revisit_condition: z.string(),
  })
  .refine((data) => data.options.some((o) => o.label === data.selected), {
    message: 'selected must match one of the option labels',
    path: ['selected'],
  });
export type DecisionRecord = z.infer<typeof DecisionRecordSchema>;

export function validateHealthResponse(data: unknown): HealthResponse {
  return HealthResponseSchema.parse(data);
}

export function validateReadinessResponse(data: unknown): ReadinessResponse {
  return ReadinessResponseSchema.parse(data);
}

export function validateServiceError(data: unknown): ServiceError {
  return ServiceErrorSchema.parse(data);
}

export function validateTaskRecord(data: unknown): TaskRecord {
  return TaskRecordSchema.parse(data);
}

export function validateDecisionRecord(data: unknown): DecisionRecord {
  return DecisionRecordSchema.parse(data);
}

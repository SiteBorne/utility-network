import { TaskRecordSchema, DecisionRecordSchema } from '@siteborne/contracts';

export const VALID_PROMOTION_SEQUENCES = [
  ['DRAFT', 'CASE_SUPPORTED'],
  ['CASE_SUPPORTED', 'MULTI_CASE_SUPPORTED'],
  ['MULTI_CASE_SUPPORTED', 'VERIFIED_PATTERN'],
  ['VERIFIED_PATTERN', 'EXECUTABLE_CANDIDATE'],
  ['EXECUTABLE_CANDIDATE', 'EXECUTABLE_VERIFIED'],
  ['EXECUTABLE_VERIFIED', 'RETIRED'],
  ['RETIRED', 'TOMBSTONED'],
] as const;

export const INVALID_PROMOTION_SEQUENCES = [
  ['DRAFT', 'MULTI_CASE_SUPPORTED'],
  ['CASE_SUPPORTED', 'VERIFIED_PATTERN'],
  ['EXECUTABLE_VERIFIED', 'EXECUTABLE_CANDIDATE'],
  ['RETIRED', 'EXECUTABLE_VERIFIED'],
  ['TOMBSTONED', 'RETIRED'],
  ['TOMBSTONED', 'DRAFT'],
  ['DRAFT', 'DRAFT'],
] as const;

export const VALID_TASK_RECORD = {
  id: 'SUN-0100',
  title: 'Test task',
  phase: 'phase_3_contracts',
  state: 'pending' as const,
  owner_agent: 'architect',
  dependencies: ['SUN-0001'],
  rubric_target: 85,
  acceptance_tests: ['test_schema_generation', 'test_compatibility'],
  evidence: [],
  next_action: 'Generate schemas',
  blocker: null,
  commit_ref: null,
};

export const INVALID_TASK_RECORDS = [
  { ...VALID_TASK_RECORD, id: 'SUN-001' },
  { ...VALID_TASK_RECORD, acceptance_tests: [] },
  {
    ...VALID_TASK_RECORD,
    state: 'invalid_state' as
      | 'pending'
      | 'active'
      | 'in_progress'
      | 'completed'
      | 'accepted'
      | 'blocked_external'
      | 'cancelled'
      | 'rejected',
  },
];

export const VALID_DECISION_RECORD = {
  id: '0006',
  title: 'Test Decision',
  status: 'accepted' as const,
  date: '2026-08-05',
  question: 'What to do?',
  options: [
    { label: 'Option A', description: 'Do A' },
    { label: 'Option B', description: 'Do B' },
  ],
  selected: 'Option A',
  rubric_score: 90,
  evidence: ['evidence1'],
  assumptions: ['assumption1'],
  revisit_condition: 'condition met',
};

export const INVALID_DECISION_RECORDS = [
  { ...VALID_DECISION_RECORD, id: '006' },
  { ...VALID_DECISION_RECORD, options: [] },
  { ...VALID_DECISION_RECORD, selected: 'Option C' },
];

export const VALID_PROVIDER_MANIFEST = {
  provider: 'test-provider',
  plan: 'free',
  commercial_application_allowed: true,
  automated_access_allowed: true,
  raw_access_resale_allowed: false,
  transformed_output_allowed: true,
  customer_data_training_possible: false,
  sensitive_data_allowed: false,
  account_sharing_allowed: false,
  quota_multiplication_allowed: false,
  terms_hash: 'sha256:' + 'a'.repeat(64),
  reviewed_at: '2026-08-05T10:00:00Z',
  promotion_state: 'EXECUTABLE_VERIFIED' as const,
};

export const INVALID_PROVIDER_MANIFESTS = [
  { ...VALID_PROVIDER_MANIFEST, commercial_application_allowed: false },
  { ...VALID_PROVIDER_MANIFEST, automated_access_allowed: false },
  { ...VALID_PROVIDER_MANIFEST, raw_access_resale_allowed: true },
  { ...VALID_PROVIDER_MANIFEST, account_sharing_allowed: true },
  { ...VALID_PROVIDER_MANIFEST, terms_hash: 'invalid' },
  {
    ...VALID_PROVIDER_MANIFEST,
    promotion_state: 'INVALID' as
      | 'DRAFT'
      | 'CASE_SUPPORTED'
      | 'MULTI_CASE_SUPPORTED'
      | 'VERIFIED_PATTERN'
      | 'EXECUTABLE_CANDIDATE'
      | 'EXECUTABLE_VERIFIED'
      | 'RETIRED'
      | 'TOMBSTONED',
  },
];

export function validateTaskRecord(data: unknown) {
  return TaskRecordSchema.parse(data);
}

export function validateDecisionRecord(data: unknown) {
  return DecisionRecordSchema.parse(data);
}

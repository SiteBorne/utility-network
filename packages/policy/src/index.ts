import { z } from 'zod';

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

export const HardGateIdSchema = z.enum([
  'machine_callable',
  'machine_payable',
  'bounded_input',
  'bounded_output',
  'acceptance_tests_defined',
  'commercial_use_permitted',
  'automated_access_permitted',
  'raw_account_resale',
  'quota_circumvention',
  'secret_exposure',
  'unbounded_backend_spend',
  'verification_available',
]);
export type HardGateId = z.infer<typeof HardGateIdSchema>;

export const HardGateResultSchema = z.object({
  gate_id: HardGateIdSchema,
  passed: z.boolean(),
  reason: z.string().optional(),
});
export type HardGateResult = z.infer<typeof HardGateResultSchema>;

export const HardGatesEvaluationSchema = z.object({
  results: z.array(HardGateResultSchema),
  all_passed: z.boolean(),
  failed_gates: z.array(HardGateIdSchema),
});
export type HardGatesEvaluation = z.infer<typeof HardGatesEvaluationSchema>;

export const ProviderManifestSchema = z.object({
  provider: z.string(),
  plan: z.string(),
  commercial_application_allowed: z.boolean(),
  automated_access_allowed: z.boolean(),
  raw_access_resale_allowed: z.boolean(),
  transformed_output_allowed: z.boolean(),
  customer_data_training_possible: z.boolean(),
  sensitive_data_allowed: z.boolean(),
  account_sharing_allowed: z.boolean(),
  quota_multiplication_allowed: z.boolean(),
  terms_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  reviewed_at: z.string().datetime({ offset: true }),
  promotion_state: PromotionStateSchema,
});
export type ProviderManifest = z.infer<typeof ProviderManifestSchema>;

export const PrivacyClassSchema = z.enum([
  'public_data',
  'buyer_provided_public',
  'buyer_provided_authorized',
  'operational_metadata',
  'payment_metadata',
  'secrets',
]);
export type PrivacyClass = z.infer<typeof PrivacyClassSchema>;

const REQUIRED_HARD_GATES: HardGateId[] = [
  'machine_callable',
  'machine_payable',
  'bounded_input',
  'bounded_output',
  'acceptance_tests_defined',
  'commercial_use_permitted',
  'automated_access_permitted',
  'raw_account_resale',
  'quota_circumvention',
  'secret_exposure',
  'unbounded_backend_spend',
  'verification_available',
];

export { REQUIRED_HARD_GATES };

const VALID_TRANSITIONS: ReadonlyMap<PromotionState, ReadonlySet<PromotionState>> = new Map([
  ['DRAFT', new Set(['CASE_SUPPORTED'])],
  ['CASE_SUPPORTED', new Set(['MULTI_CASE_SUPPORTED'])],
  ['MULTI_CASE_SUPPORTED', new Set(['VERIFIED_PATTERN'])],
  ['VERIFIED_PATTERN', new Set(['EXECUTABLE_CANDIDATE'])],
  ['EXECUTABLE_CANDIDATE', new Set(['EXECUTABLE_VERIFIED'])],
  ['EXECUTABLE_VERIFIED', new Set(['RETIRED'])],
  ['RETIRED', new Set(['TOMBSTONED'])],
  ['TOMBSTONED', new Set()],
]);

export { VALID_TRANSITIONS };

const PRODUCTION_STATES = new Set<PromotionState>(['EXECUTABLE_VERIFIED']);

export function evaluateHardGates(
  providerManifest: ProviderManifest,
  customChecks?: Record<HardGateId, (manifest: ProviderManifest) => boolean>
): HardGatesEvaluation {
  const results: HardGateResult[] = [];

  for (const gateId of REQUIRED_HARD_GATES) {
    let passed = false;
    let reason: string | undefined;

    if (customChecks?.[gateId]) {
      passed = customChecks[gateId](providerManifest);
      reason = passed ? undefined : `Custom check failed for ${gateId}`;
    } else {
      switch (gateId) {
        case 'machine_callable':
          passed = true;
          break;
        case 'machine_payable':
          passed = true;
          break;
        case 'bounded_input':
          passed = true;
          break;
        case 'bounded_output':
          passed = true;
          break;
        case 'acceptance_tests_defined':
          passed = true;
          break;
        case 'commercial_use_permitted':
          passed = providerManifest.commercial_application_allowed;
          reason = passed ? undefined : 'Provider terms do not permit commercial application';
          break;
        case 'automated_access_permitted':
          passed = providerManifest.automated_access_allowed;
          reason = passed ? undefined : 'Provider terms do not permit automated access';
          break;
        case 'raw_account_resale':
          passed = !providerManifest.raw_access_resale_allowed;
          reason = passed ? undefined : 'Provider terms allow raw access resale (forbidden)';
          break;
        case 'quota_circumvention':
          passed =
            !providerManifest.account_sharing_allowed &&
            !providerManifest.quota_multiplication_allowed;
          reason = passed ? undefined : 'Provider terms allow quota circumvention';
          break;
        case 'secret_exposure':
          passed = true;
          break;
        case 'unbounded_backend_spend':
          passed = true;
          break;
        case 'verification_available':
          passed = true;
          break;
        default:
          passed = false;
          reason = `Unknown hard gate: ${gateId}`;
      }
    }

    results.push({ gate_id: gateId, passed, reason });
  }

  const failed_gates = results.filter((r) => !r.passed).map((r) => r.gate_id);
  return {
    results,
    all_passed: failed_gates.length === 0,
    failed_gates,
  };
}

export function evaluatePromotionTransition(
  from: PromotionState,
  to: PromotionState
): { valid: boolean; reason?: string } {
  if (from === to) {
    return { valid: false, reason: 'No transition (same state)' };
  }

  const allowed = VALID_TRANSITIONS.get(from);
  if (!allowed) {
    return { valid: false, reason: `Unknown source state: ${from}` };
  }

  if (!allowed.has(to)) {
    return { valid: false, reason: `Invalid transition: ${from} → ${to}` };
  }

  return { valid: true };
}

export function isProductionEligible(state: PromotionState): boolean {
  return PRODUCTION_STATES.has(state);
}

export function canControlProduction(state: PromotionState): boolean {
  return PRODUCTION_STATES.has(state);
}

export function isTerminal(state: PromotionState): boolean {
  return state === 'TOMBSTONED';
}

export function canRetire(state: PromotionState): boolean {
  return state === 'EXECUTABLE_VERIFIED';
}

export function enforcePublicDataOnly(
  requestedClass: PrivacyClass,
  allowedClasses: PrivacyClass[] = ['public_data', 'buyer_provided_public']
): { allowed: boolean; reason?: string } {
  if (allowedClasses.includes(requestedClass)) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `Privacy class ${requestedClass} not permitted. Allowed: ${allowedClasses.join(', ')}`,
  };
}

export function validateProviderManifest(manifest: unknown): ProviderManifest {
  return ProviderManifestSchema.parse(manifest);
}

import { describe, it, expect } from 'vitest';
import {
  HardGateIdSchema,
  REQUIRED_HARD_GATES,
  VALID_TRANSITIONS,
  evaluateHardGates,
  evaluatePromotionTransition,
  isProductionEligible,
  canControlProduction,
  isTerminal,
  canRetire,
  enforcePublicDataOnly,
  validateProviderManifest,
} from './index';
import type { ProviderManifest, PromotionState } from './index';

const PROMOTION_STATES: PromotionState[] = [
  'DRAFT',
  'CASE_SUPPORTED',
  'MULTI_CASE_SUPPORTED',
  'VERIFIED_PATTERN',
  'EXECUTABLE_CANDIDATE',
  'EXECUTABLE_VERIFIED',
  'RETIRED',
  'TOMBSTONED',
];

const asPromotionState = (s: string): PromotionState => s as PromotionState;

describe('policy - hard gates, promotion, privacy', () => {
  describe('Required hard gates', () => {
    it('has all 12 required gates', () => {
      expect(REQUIRED_HARD_GATES.length).toBe(12);
      for (const gate of REQUIRED_HARD_GATES) {
        expect(HardGateIdSchema.safeParse(gate).success).toBe(true);
      }
    });
  });

  describe('evaluateHardGates', () => {
    const validManifest: ProviderManifest = {
      provider: 'test',
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
      promotion_state: 'EXECUTABLE_VERIFIED',
    };

    it('passes all gates for valid manifest', () => {
      const result = evaluateHardGates(validManifest);
      expect(result.all_passed).toBe(true);
      expect(result.failed_gates.length).toBe(0);
      expect(result.results.length).toBe(12);
    });

    it('fails commercial_use_permitted when false', () => {
      const manifest = { ...validManifest, commercial_application_allowed: false };
      const result = evaluateHardGates(manifest);
      expect(result.all_passed).toBe(false);
      expect(result.failed_gates).toContain('commercial_use_permitted');
    });

    it('fails automated_access_permitted when false', () => {
      const manifest = { ...validManifest, automated_access_allowed: false };
      const result = evaluateHardGates(manifest);
      expect(result.failed_gates).toContain('automated_access_permitted');
    });

    it('fails raw_account_resale when true', () => {
      const manifest = { ...validManifest, raw_access_resale_allowed: true };
      const result = evaluateHardGates(manifest);
      expect(result.failed_gates).toContain('raw_account_resale');
    });

    it('fails quota_circumvention when account sharing allowed', () => {
      const manifest = { ...validManifest, account_sharing_allowed: true };
      const result = evaluateHardGates(manifest);
      expect(result.failed_gates).toContain('quota_circumvention');
    });

    it('fails quota_circumvention when quota multiplication allowed', () => {
      const manifest = { ...validManifest, quota_multiplication_allowed: true };
      const result = evaluateHardGates(manifest);
      expect(result.failed_gates).toContain('quota_circumvention');
    });

    it('unknown gates fail closed via customChecks', () => {
      const manifest = { ...validManifest };
      // Provide all required gate checks, only override machine_callable
      const allChecks: Record<string, (m: ProviderManifest) => boolean> = {
        machine_callable: () => false,
        machine_payable: () => true,
        bounded_input: () => true,
        bounded_output: () => true,
        acceptance_tests_defined: () => true,
        commercial_use_permitted: () => true,
        automated_access_permitted: () => true,
        raw_account_resale: () => true,
        quota_circumvention: () => true,
        secret_exposure: () => true,
        unbounded_backend_spend: () => true,
        verification_available: () => true,
      };
      const result = evaluateHardGates(manifest, allChecks);
      expect(result.failed_gates).toContain('machine_callable');
    });
  });

  describe('evaluatePromotionTransition', () => {
    it('allows valid forward transitions', () => {
      const valid = [
        ['DRAFT', 'CASE_SUPPORTED'],
        ['CASE_SUPPORTED', 'MULTI_CASE_SUPPORTED'],
        ['MULTI_CASE_SUPPORTED', 'VERIFIED_PATTERN'],
        ['VERIFIED_PATTERN', 'EXECUTABLE_CANDIDATE'],
        ['EXECUTABLE_CANDIDATE', 'EXECUTABLE_VERIFIED'],
        ['EXECUTABLE_VERIFIED', 'RETIRED'],
        ['RETIRED', 'TOMBSTONED'],
      ];
      for (const [from, to] of valid) {
        const result = evaluatePromotionTransition(asPromotionState(from), asPromotionState(to));
        expect(result.valid).toBe(true);
      }
    });

    it('rejects invalid transitions', () => {
      const invalid = [
        ['DRAFT', 'MULTI_CASE_SUPPORTED'],
        ['CASE_SUPPORTED', 'VERIFIED_PATTERN'],
        ['EXECUTABLE_VERIFIED', 'EXECUTABLE_CANDIDATE'],
        ['RETIRED', 'EXECUTABLE_VERIFIED'],
        ['TOMBSTONED', 'RETIRED'],
        ['EXECUTABLE_VERIFIED', 'DRAFT'],
      ];
      for (const [from, to] of invalid) {
        const result = evaluatePromotionTransition(asPromotionState(from), asPromotionState(to));
        expect(result.valid).toBe(false);
      }
    });

    it('rejects same-state transition', () => {
      const result = evaluatePromotionTransition(
        asPromotionState('DRAFT'),
        asPromotionState('DRAFT')
      );
      expect(result.valid).toBe(false);
    });

    it('TOMBSTONED has no outgoing transitions', () => {
      const allowed = VALID_TRANSITIONS.get('TOMBSTONED');
      expect(allowed?.size).toBe(0);
    });
  });

  describe('isProductionEligible / canControlProduction', () => {
    it('only EXECUTABLE_VERIFIED is production eligible', () => {
      expect(isProductionEligible(asPromotionState('EXECUTABLE_VERIFIED'))).toBe(true);
      expect(isProductionEligible(asPromotionState('EXECUTABLE_CANDIDATE'))).toBe(false);
      expect(isProductionEligible(asPromotionState('VERIFIED_PATTERN'))).toBe(false);
      expect(isProductionEligible(asPromotionState('RETIRED'))).toBe(false);
      expect(isProductionEligible(asPromotionState('TOMBSTONED'))).toBe(false);
    });

    it('canControlProduction matches isProductionEligible', () => {
      for (const state of PROMOTION_STATES) {
        expect(canControlProduction(state)).toBe(isProductionEligible(state));
      }
    });
  });

  describe('isTerminal / canRetire', () => {
    it('TOMBSTONED is terminal', () => {
      expect(isTerminal(asPromotionState('TOMBSTONED'))).toBe(true);
      expect(isTerminal(asPromotionState('RETIRED'))).toBe(false);
      expect(isTerminal(asPromotionState('EXECUTABLE_VERIFIED'))).toBe(false);
    });

    it('only EXECUTABLE_VERIFIED can retire', () => {
      expect(canRetire(asPromotionState('EXECUTABLE_VERIFIED'))).toBe(true);
      expect(canRetire(asPromotionState('VERIFIED_PATTERN'))).toBe(false);
      expect(canRetire(asPromotionState('RETIRED'))).toBe(false);
    });
  });

  describe('enforcePublicDataOnly', () => {
    it('allows public_data and buyer_provided_public by default', () => {
      expect(enforcePublicDataOnly('public_data').allowed).toBe(true);
      expect(enforcePublicDataOnly('buyer_provided_public').allowed).toBe(true);
    });

    it('rejects sensitive classes by default', () => {
      expect(enforcePublicDataOnly('buyer_provided_authorized').allowed).toBe(false);
      expect(enforcePublicDataOnly('payment_metadata').allowed).toBe(false);
      expect(enforcePublicDataOnly('secrets').allowed).toBe(false);
    });

    it('allows custom allowed classes', () => {
      expect(enforcePublicDataOnly('secrets', ['secrets']).allowed).toBe(true);
    });
  });

  describe('validateProviderManifest', () => {
    it('validates complete manifest', () => {
      const manifest = {
        provider: 'test',
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
        promotion_state: 'EXECUTABLE_VERIFIED',
      };
      expect(() => validateProviderManifest(manifest)).not.toThrow();
    });

    it('rejects invalid promotion state', () => {
      const manifest = {
        provider: 'test',
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
        promotion_state: 'INVALID_STATE',
      };
      expect(() => validateProviderManifest(manifest)).toThrow();
    });

    it('rejects invalid terms_hash format', () => {
      const manifest = {
        provider: 'test',
        plan: 'free',
        commercial_application_allowed: true,
        automated_access_allowed: true,
        raw_access_resale_allowed: false,
        transformed_output_allowed: true,
        customer_data_training_possible: false,
        sensitive_data_allowed: false,
        account_sharing_allowed: false,
        quota_multiplication_allowed: false,
        terms_hash: 'invalid',
        reviewed_at: '2026-08-05T10:00:00Z',
        promotion_state: 'EXECUTABLE_VERIFIED',
      };
      expect(() => validateProviderManifest(manifest)).toThrow();
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  VALID_PROMOTION_SEQUENCES,
  INVALID_PROMOTION_SEQUENCES,
  VALID_TASK_RECORD,
  INVALID_TASK_RECORDS,
  VALID_DECISION_RECORD,
  INVALID_DECISION_RECORDS,
  VALID_PROVIDER_MANIFEST,
  INVALID_PROVIDER_MANIFESTS,
  validateTaskRecord,
  validateDecisionRecord,
} from './index';
import { TaskRecordSchema, DecisionRecordSchema } from '@siteborne/contracts';

describe('test-fixtures - foundation fixtures', () => {
  describe('Promotion sequences', () => {
    it('VALID_PROMOTION_SEQUENCES has 7 valid transitions', () => {
      expect(VALID_PROMOTION_SEQUENCES.length).toBe(7);
    });

    it('INVALID_PROMOTION_SEQUENCES has invalid transitions', () => {
      expect(INVALID_PROMOTION_SEQUENCES.length).toBeGreaterThan(0);
    });
  });

  describe('Task records', () => {
    it('VALID_TASK_RECORD passes schema', () => {
      expect(() => validateTaskRecord(VALID_TASK_RECORD)).not.toThrow();
    });

    it('INVALID_TASK_RECORDS fail schema', () => {
      for (const invalid of INVALID_TASK_RECORDS) {
        expect(() => validateTaskRecord(invalid)).toThrow();
      }
    });
  });

  describe('Decision records', () => {
    it('VALID_DECISION_RECORD passes schema', () => {
      expect(() => validateDecisionRecord(VALID_DECISION_RECORD)).not.toThrow();
    });

    it('INVALID_DECISION_RECORDS fail schema', () => {
      for (const invalid of INVALID_DECISION_RECORDS) {
        expect(() => validateDecisionRecord(invalid)).toThrow();
      }
    });
  });

  describe('Provider manifests', () => {
    it('VALID_PROVIDER_MANIFEST has correct structure', () => {
      expect(VALID_PROVIDER_MANIFEST.provider).toBe('test-provider');
      expect(VALID_PROVIDER_MANIFEST.commercial_application_allowed).toBe(true);
      expect(VALID_PROVIDER_MANIFEST.promotion_state).toBe('EXECUTABLE_VERIFIED');
    });

    it('INVALID_PROVIDER_MANIFESTS have various issues', () => {
      expect(INVALID_PROVIDER_MANIFESTS.length).toBe(6);
    });
  });

  describe('Schema imports', () => {
    it('TaskRecordSchema and DecisionRecordSchema imported from contracts', () => {
      expect(TaskRecordSchema).toBeDefined();
      expect(DecisionRecordSchema).toBeDefined();
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  validateHealthResponse,
  validateReadinessResponse,
  validateServiceError,
  validateTaskRecord,
  validateDecisionRecord,
  HealthResponseSchema,
  ReadinessResponseSchema,
  ServiceErrorSchema,
  TaskRecordSchema,
  DecisionRecordSchema,
} from './index';

describe('contracts - shared types', () => {
  describe('HealthResponse', () => {
    it('accepts valid health response', () => {
      const result = validateHealthResponse({
        status: 'ok',
        timestamp: '2026-08-05T10:00:00Z',
        version: '0.0.1',
        uptime_seconds: 123,
      });
      expect(result.status).toBe('ok');
      expect(result.uptime_seconds).toBe(123);
    });

    it('rejects invalid status', () => {
      expect(() =>
        validateHealthResponse({
          status: 'healthy',
          timestamp: '2026-08-05T10:00:00Z',
          version: '0.0.1',
          uptime_seconds: 123,
        })
      ).toThrow();
    });
  });

  describe('ReadinessResponse', () => {
    it('accepts valid not_ready response', () => {
      const result = validateReadinessResponse({
        status: 'not_ready',
        phase: 'foundation',
        production_services_enabled: false,
        blocked_external: ['cloudflare_account_configuration'],
        reason: 'Service contracts not yet verified',
      });
      expect(result.status).toBe('not_ready');
      expect(result.production_services_enabled).toBe(false);
    });

    it('accepts valid ready response', () => {
      const result = validateReadinessResponse({
        status: 'ready',
        phase: 'production',
        production_services_enabled: true,
        blocked_external: [],
        reason: 'All systems operational',
      });
      expect(result.status).toBe('ready');
    });
  });

  describe('ServiceError', () => {
    it('accepts valid error', () => {
      const result = validateServiceError({
        code: 'VALIDATION_ERROR',
        message: 'Input validation failed',
        details: { field: 'company' },
        request_id: 'req_123',
      });
      expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('TaskRecord', () => {
    it('accepts valid task record', () => {
      const result = validateTaskRecord({
        id: 'SUN-0100',
        title: 'Test task',
        phase: 'phase_3_contracts',
        state: 'pending',
        owner_agent: 'architect',
        dependencies: ['SUN-0001'],
        rubric_target: 85,
        acceptance_tests: ['test1', 'test2'],
        evidence: [],
        next_action: 'Run tests',
        blocker: null,
        commit_ref: null,
      });
      expect(result.id).toBe('SUN-0100');
    });

    it('rejects invalid ID format', () => {
      expect(() =>
        validateTaskRecord({
          id: 'SUN-001',
          title: 'Test',
          phase: 'phase_3_contracts',
          state: 'pending',
          owner_agent: 'architect',
          dependencies: [],
          rubric_target: 85,
          acceptance_tests: ['test'],
          evidence: [],
          next_action: 'Run',
          blocker: null,
          commit_ref: null,
        })
      ).toThrow();
    });
  });

  describe('DecisionRecord', () => {
    it('accepts valid decision record', () => {
      const result = validateDecisionRecord({
        id: '0001',
        title: 'Test Decision',
        status: 'accepted',
        date: '2026-08-05',
        question: 'What to do?',
        options: [
          { label: 'A', description: 'Option A' },
          { label: 'B', description: 'Option B' },
        ],
        selected: 'A',
        rubric_score: 90,
        evidence: ['ev1'],
        assumptions: ['assumption1'],
        revisit_condition: 'condition',
      });
      expect(result.id).toBe('0001');
    });
  });

  describe('Schema exports', () => {
    it('exports all required schemas', () => {
      expect(HealthResponseSchema).toBeDefined();
      expect(ReadinessResponseSchema).toBeDefined();
      expect(ServiceErrorSchema).toBeDefined();
      expect(TaskRecordSchema).toBeDefined();
      expect(DecisionRecordSchema).toBeDefined();
    });
  });
});

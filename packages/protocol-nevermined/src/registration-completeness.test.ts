import { describe, expect, it } from 'vitest';
import { validateNeverminedRegistrationCompleteness } from './registration-completeness';

const exactInventory = [
  {
    service_id: 'company_evidence_graph.v1',
    reconciliation: 'EXACT_EXISTING',
    matching_agent_count: 1,
    matching_plan_count: 1,
  },
  {
    service_id: 'web_context_verified.v1',
    reconciliation: 'EXACT_EXISTING',
    matching_agent_count: 1,
    matching_plan_count: 1,
  },
  {
    service_id: 'document_evidence_json.v1',
    reconciliation: 'EXACT_EXISTING',
    matching_agent_count: 1,
    matching_plan_count: 1,
  },
  {
    service_id: 'verify_agent_output.v1',
    reconciliation: 'EXACT_EXISTING',
    matching_agent_count: 1,
    matching_plan_count: 1,
  },
] as const;

describe('validateNeverminedRegistrationCompleteness', () => {
  it('accepts exactly one authoritative registration for every canonical service', () => {
    expect(validateNeverminedRegistrationCompleteness(exactInventory)).toEqual({ valid: true });
  });

  it('fails closed when a canonical registration is duplicated', () => {
    const duplicated = exactInventory.map((entry) =>
      entry.service_id === 'web_context_verified.v1' ? { ...entry, matching_agent_count: 2 } : entry
    );

    expect(validateNeverminedRegistrationCompleteness(duplicated)).toEqual({
      valid: false,
      reason: 'DUPLICATE_CANONICAL_REGISTRATION',
      service_id: 'web_context_verified.v1',
    });
  });

  it('fails closed when authoritative reconciliation is not exact', () => {
    const conflicting = exactInventory.map((entry) =>
      entry.service_id === 'verify_agent_output.v1'
        ? { ...entry, reconciliation: 'CONFLICT' as const }
        : entry
    );

    expect(validateNeverminedRegistrationCompleteness(conflicting)).toEqual({
      valid: false,
      reason: 'REGISTRATION_NOT_EXACT',
      service_id: 'verify_agent_output.v1',
    });
  });

  it('fails closed when a canonical service is missing from the audit', () => {
    expect(validateNeverminedRegistrationCompleteness(exactInventory.slice(0, 3))).toEqual({
      valid: false,
      reason: 'CANONICAL_SERVICE_SET_MISMATCH',
    });
  });
});

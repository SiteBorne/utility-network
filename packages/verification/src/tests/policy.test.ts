import { describe, expect, it } from 'vitest';
import { loadPolicy, hashPolicy } from '../policy';

describe('VERIFICATION_POLICY.yaml', () => {
  it('loads and Zod-validates against the real governance/VERIFICATION_POLICY.yaml', () => {
    const policy = loadPolicy();
    expect(policy.policy_version).toBe('1.0.0');
    expect(policy.required_verifiers.standard).toEqual([
      'schema_verifier',
      'evidence_accessibility_verifier',
      'claim_evidence_verifier',
      'freshness_verifier',
      'completeness_verifier',
      'cross_source_verifier',
      'provenance_verifier',
      'prompt_injection_verifier',
    ]);
    expect(policy.required_verifiers.independent_reproduction).toContain('reproduction_verifier');
  });

  it('hashes deterministically (same policy object → same hash)', async () => {
    const policy = loadPolicy();
    const h1 = await hashPolicy(policy);
    const h2 = await hashPolicy(policy);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('hash changes when the policy content changes', async () => {
    const policy = loadPolicy();
    const mutated = { ...policy, policy_version: '9.9.9' };
    expect(await hashPolicy(mutated)).not.toBe(await hashPolicy(policy));
  });
});

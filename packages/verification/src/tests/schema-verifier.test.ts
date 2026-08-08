import { describe, expect, it } from 'vitest';
import { SchemaVerifier } from '../verifiers/schema-verifier';
import { buildContext, createTestClock } from '../context';
import { validCandidate, validDocumentPccOutput } from './fixtures';

describe('SchemaVerifier', () => {
  it('passes a schema-valid candidate output', async () => {
    const verifier = new SchemaVerifier();
    const context = buildContext({ clock: createTestClock() });
    const result = await verifier.verify(validCandidate(), context);
    expect(result.status).toBe('pass');
    expect(result.severity).toBe('info');
    expect(result.findings).toHaveLength(0);
  });

  it('fails closed with findings when the output violates the frozen schema', async () => {
    const verifier = new SchemaVerifier();
    const context = buildContext({ clock: createTestClock() });
    const badOutput = validDocumentPccOutput({ job_id: 'not-a-valid-job-id' });
    const result = await verifier.verify(validCandidate({ output: badOutput }), context);
    expect(result.status).toBe('fail');
    expect(result.severity).toBe('blocking');
    expect(result.failure_codes).toContain('schema_violation');
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it('fails closed on an unknown service_id rather than skipping validation', async () => {
    const verifier = new SchemaVerifier();
    const context = buildContext({ clock: createTestClock() });
    const result = await verifier.verify(
      validCandidate({ service_id: 'not_a_real_service.v1' }),
      context
    );
    expect(result.status).toBe('fail');
    expect(result.failure_codes).toContain('unknown_service');
  });

  it('caps findings at 50 even when the schema produces more violations', async () => {
    const verifier = new SchemaVerifier();
    const context = buildContext({ clock: createTestClock() });
    // Strip nearly everything required by the base PCC schema at once.
    const result = await verifier.verify(
      validCandidate({ output: { pcc_version: '1.0.0' } }),
      context
    );
    expect(result.status).toBe('fail');
    expect(result.findings.length).toBeLessThanOrEqual(50);
  });
});

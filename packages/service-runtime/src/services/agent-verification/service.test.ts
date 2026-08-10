import { createHash } from 'node:crypto';
import { describe, expect, it, beforeAll } from 'vitest';
import type { KeyRegistry } from '@siteborne/verification';
import { type Signer, type VerificationReceipt } from '@siteborne/verification';
import { VerifyAgentOutputService } from './service';
import { deterministicId } from '../../pcc/ids';
import { verifyServiceReceipt } from '../../pcc';
import { buildTestServiceContext, createFixtureSigner } from '../../tests/support';
import type { AgentVerificationInput } from './types';

function baseInput(overrides: Partial<AgentVerificationInput> = {}): AgentVerificationInput {
  return {
    verification_contract: {
      claims: [{ claim_id: 'total', predicate: 'equals', expected_value: 42 }],
      deterministic_requirements: [{ requirement_id: 'schema_check', check: 'schema_valid' }],
    },
    candidate_output: { total: 42 },
    required_schema: {
      type: 'object',
      properties: { total: { type: 'number' } },
      required: ['total'],
    },
    verification_mode: 'standard',
    ...overrides,
  };
}

describe('VerifyAgentOutputService', () => {
  let signer: Signer;
  let registry: KeyRegistry;

  beforeAll(async () => {
    ({ signer, registry } = await createFixtureSigner());
  });

  it('rejects an incomplete input', async () => {
    const context = await buildTestServiceContext('verify_agent_output.v1');
    const service = new VerifyAgentOutputService({ signer, keyRegistry: registry });
    // @ts-expect-error deliberately incomplete for the test
    const result = await service.execute({}, context);
    expect(result.result_class).toBe('rejected');
  });

  it('passes standard verification when the claim and deterministic requirement both hold', async () => {
    const context = await buildTestServiceContext('verify_agent_output.v1');
    const service = new VerifyAgentOutputService({ signer, keyRegistry: registry });
    const result = await service.execute(baseInput(), context);

    expect(result.result_class).toBe('success');
    expect((result.output as { outcome?: string })?.outcome).toBe('pass');
    expect(result.receipt_id).toMatch(/^rcpt_[a-f0-9]{24}$/);

    // Real cryptographic verification — not just receipt_id pattern matching.
    const verification = await verifyServiceReceipt({
      receipt: result.receipt as VerificationReceipt,
      keyRegistry: registry,
      expectedServiceId: 'verify_agent_output.v1',
      expectedOutputHash: result.output_hash,
    });
    expect(verification.valid).toBe(true);
  });

  it('tampering with a bound receipt field (decision) invalidates cryptographic verification of the standard-mode receipt', async () => {
    const context = await buildTestServiceContext('verify_agent_output.v1');
    const service = new VerifyAgentOutputService({ signer, keyRegistry: registry });
    const result = await service.execute(baseInput(), context);

    const tampered: VerificationReceipt = {
      ...(result.receipt as VerificationReceipt),
      decision: 'fail',
    };
    const verification = await verifyServiceReceipt({
      receipt: tampered,
      keyRegistry: registry,
      expectedServiceId: 'verify_agent_output.v1',
    });
    expect(verification.valid).toBe(false);
  });

  it('reports a failed claim without letting the mesh reach a false pass', async () => {
    const context = await buildTestServiceContext('verify_agent_output.v1');
    const service = new VerifyAgentOutputService({ signer, keyRegistry: registry });
    const result = await service.execute(
      baseInput({
        verification_contract: {
          claims: [{ claim_id: 'total', predicate: 'equals', expected_value: 999 }],
          deterministic_requirements: [],
        },
      }),
      context
    );

    expect(result.result_class).toBe('partial');
    expect((result.output as { outcome?: string })?.outcome).toBe('conditional');
  });

  it('fails schema_valid when candidate_output violates required_schema, and does not fabricate a pass', async () => {
    const context = await buildTestServiceContext('verify_agent_output.v1');
    const service = new VerifyAgentOutputService({ signer, keyRegistry: registry });
    const result = await service.execute(
      baseInput({ candidate_output: { total: 'not-a-number' } }),
      context
    );

    const requirementResults = (
      result.output as { requirement_results?: Array<{ requirement_id: string; passed: boolean }> }
    )?.requirement_results;
    expect(requirementResults?.find((r) => r.requirement_id === 'schema_check')?.passed).toBe(
      false
    );
  });

  it('marks unimplemented deterministic checks as unverifiable rather than a silent pass', async () => {
    const context = await buildTestServiceContext('verify_agent_output.v1');
    const service = new VerifyAgentOutputService({ signer, keyRegistry: registry });
    const result = await service.execute(
      baseInput({
        verification_contract: {
          claims: [],
          deterministic_requirements: [{ requirement_id: 'sig', check: 'signature_valid' }],
        },
      }),
      context
    );

    expect(
      result.limitations.some((l) => l.includes('signature_valid') && l.includes('not implemented'))
    ).toBe(true);
  });

  it('is skipped_by_policy-driven fail for independent_reproduction mode with no reproduction supplied (never silently downgrades to standard)', async () => {
    const context = await buildTestServiceContext('verify_agent_output.v1', {
      mode: 'independent_reproduction',
    });
    const service = new VerifyAgentOutputService({
      signer,
      keyRegistry: registry,
      reproduction: null,
    });
    const result = await service.execute(
      baseInput({ verification_mode: 'independent_reproduction' }),
      context
    );

    expect(result.result_class).toBe('internal_verification_failed');
    expect(result.failure?.details).toContain('reproduction_unavailable');
  });

  it('passes independent_reproduction mode when a matching reproduction result is supplied', async () => {
    const context = await buildTestServiceContext('verify_agent_output.v1', {
      mode: 'independent_reproduction',
    });
    const input = baseInput({ verification_mode: 'independent_reproduction' });
    const candidateOutputHash =
      'sha256:' + createHash('sha256').update(JSON.stringify(input.candidate_output)).digest('hex');
    const claimId = deterministicId(
      'clm',
      `verify_agent_output.v1:claim:total:${candidateOutputHash}`
    );

    const service = new VerifyAgentOutputService({
      signer,
      keyRegistry: registry,
      reproduction: { claims: [{ claim_id: claimId, value: true }] },
    });
    const result = await service.execute(input, context);

    expect(result.result_class).toBe('success');
    expect((result.output as { outcome?: string })?.outcome).toBe('pass');

    // Independent-reproduction mode's requirements actually ran (the mesh's
    // reproduction_verifier is mandatory only in this mode — see ADR 0034)
    // and the resulting receipt cryptographically verifies.
    const verification = await verifyServiceReceipt({
      receipt: result.receipt as VerificationReceipt,
      keyRegistry: registry,
      expectedServiceId: 'verify_agent_output.v1',
      expectedOutputHash: result.output_hash,
    });
    expect(verification.valid).toBe(true);
  });

  it('tampering with a bound receipt field (decision) invalidates cryptographic verification of the independent_reproduction receipt', async () => {
    const context = await buildTestServiceContext('verify_agent_output.v1', {
      mode: 'independent_reproduction',
    });
    const input = baseInput({ verification_mode: 'independent_reproduction' });
    const candidateOutputHash =
      'sha256:' + createHash('sha256').update(JSON.stringify(input.candidate_output)).digest('hex');
    const claimId = deterministicId(
      'clm',
      `verify_agent_output.v1:claim:total:${candidateOutputHash}`
    );
    const service = new VerifyAgentOutputService({
      signer,
      keyRegistry: registry,
      reproduction: { claims: [{ claim_id: claimId, value: true }] },
    });
    const result = await service.execute(input, context);

    const tampered: VerificationReceipt = {
      ...(result.receipt as VerificationReceipt),
      decision: 'fail',
    };
    const verification = await verifyServiceReceipt({
      receipt: tampered,
      keyRegistry: registry,
      expectedServiceId: 'verify_agent_output.v1',
    });
    expect(verification.valid).toBe(false);
  });

  it('fails independent_reproduction mode when the reproduced value disagrees', async () => {
    const context = await buildTestServiceContext('verify_agent_output.v1', {
      mode: 'independent_reproduction',
    });
    const input = baseInput({ verification_mode: 'independent_reproduction' });
    const candidateOutputHash =
      'sha256:' + createHash('sha256').update(JSON.stringify(input.candidate_output)).digest('hex');
    const claimId = deterministicId(
      'clm',
      `verify_agent_output.v1:claim:total:${candidateOutputHash}`
    );

    const service = new VerifyAgentOutputService({
      signer,
      keyRegistry: registry,
      reproduction: { claims: [{ claim_id: claimId, value: false }] },
    });
    const result = await service.execute(input, context);

    expect(result.result_class).toBe('internal_verification_failed');
  });
});

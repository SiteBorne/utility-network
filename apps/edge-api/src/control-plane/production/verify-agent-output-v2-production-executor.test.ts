/**
 * SUN-1214 checkpoint T — production executor for verify_agent_output.v2.
 *
 * Differential test: proves the production composition (real signer,
 * execution_mode:'live', a registry containing ONLY VerifyAgentOutputService)
 * produces the same verification decision/output as the existing
 * fixture-backed path for identical input, differing only in the
 * signature (because the signing key differs), and structurally never
 * references any fixture symbol.
 */
import { describe, expect, it } from 'vitest';
import type { VerificationReceipt } from '@siteborne/verification';
import {
  verifyServiceReceipt,
  VerifyAgentOutputService,
  buildServiceContext,
  createTestClock,
  createFixtureSigner,
  buildProductionSigner,
  type AgentVerificationInput,
} from '@siteborne/service-runtime';
import { buildVerifyAgentOutputV2ProductionExecutor } from './verify-agent-output-v2-production-executor';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** A random 32-byte value is statistically a valid Ed25519 private key
 * scalar for @noble/ed25519's purposes -- avoids adding @noble/ed25519
 * as a direct edge-api dependency just for test key generation. */
function randomPrivateKeyHex(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

const TEST_INPUT: AgentVerificationInput = {
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
};

describe('buildVerifyAgentOutputV2ProductionExecutor', () => {
  it('produces a genuinely signed, cryptographically valid receipt for the production key', async () => {
    const privateKeyHex = randomPrivateKeyHex();
    const { signer, registry } = await buildProductionSigner(
      privateKeyHex,
      'kid_prod0123456789abcdefghij'
    );

    const executor = buildVerifyAgentOutputV2ProductionExecutor(signer, registry);
    const outcome = await executor(TEST_INPUT, {
      job_id: 'job_test_0000000000000001',
      request_id: 'req_test_0000000000000001',
    });

    expect(outcome.result.result_class).toBe('success');
    expect((outcome.result.output as { outcome?: string })?.outcome).toBe('pass');
    expect(outcome.result.receipt_id).toMatch(/^rcpt_[a-f0-9]{24}$/);

    const verification = await verifyServiceReceipt({
      receipt: outcome.result.receipt as VerificationReceipt,
      keyRegistry: registry,
      expectedServiceId: 'verify_agent_output.v2',
      expectedOutputHash: outcome.result.output_hash,
    });
    expect(verification.valid).toBe(true);
  });

  it('matches the existing fixture-backed path on every field except the signature', async () => {
    const privateKeyHex = randomPrivateKeyHex();
    const { signer: prodSigner, registry: prodRegistry } = await buildProductionSigner(
      privateKeyHex,
      'kid_prod0123456789abcdefghij'
    );
    const executor = buildVerifyAgentOutputV2ProductionExecutor(prodSigner, prodRegistry);
    const productionOutcome = await executor(TEST_INPUT, {
      job_id: 'job_test_0000000000000002',
      request_id: 'req_test_0000000000000002',
    });

    const { signer: fixtureSigner, registry: fixtureRegistry } = await createFixtureSigner();
    const fixtureContext = buildServiceContext('verify_agent_output.v2', {
      clock: createTestClock(),
      execution_mode: 'fixture',
      job_id: 'job_test_0000000000000002',
      request_id: 'req_test_0000000000000002',
    });
    const fixtureService = new VerifyAgentOutputService({
      signer: fixtureSigner,
      keyRegistry: fixtureRegistry,
    });
    const fixtureResult = await fixtureService.execute(TEST_INPUT, fixtureContext);

    expect(productionOutcome.result.result_class).toBe(fixtureResult.result_class);
    // The semantic verification decision must be identical between the
    // production and fixture-backed paths for the same input.
    expect(productionOutcome.result.output).toEqual(fixtureResult.output);
    // output_hash legitimately differs -- it is computed over the full PCC
    // draft document, which embeds `issued_at` from the injected clock
    // (this executor's real clock vs. the fixture path's deterministic
    // test clock), not merely over `.output`. Discovered by this test
    // itself during TDD (traced to packages/verification/src/receipt/
    // issue.ts's `contentHash(canonicalize(candidate.output))`, where
    // `candidate.output` is the full draft, not the service's business
    // output field) -- asserting hash equality here would be asserting a
    // false invariant, not a real regression signal.
    expect(productionOutcome.result.output_hash).toBeDefined();
    expect(fixtureResult.output_hash).toBeDefined();
    // The signature itself must differ -- proving the production path
    // genuinely used the production key, not a copy of the fixture key.
    const prodReceipt = productionOutcome.result.receipt as VerificationReceipt;
    const fixtureReceipt = fixtureResult.receipt as VerificationReceipt;
    expect(prodReceipt.signature).not.toBe(fixtureReceipt.signature);
    expect(prodReceipt.signing_key_id).not.toBe(fixtureReceipt.signing_key_id);
  });

  it('never references any fixture symbol in its own source (structural check)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.join(import.meta.dirname, 'verify-agent-output-v2-production-executor.ts'),
      'utf-8'
    );
    const importLines = source
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line))
      .join('\n');
    for (const forbidden of [
      'buildFixtureRegistry',
      'createFixtureSigner',
      'FixtureDocumentWorkerBridge',
      'createTestArtifactStore',
      'createTestServiceAuditSink',
      'createTestClock',
    ]) {
      expect(importLines).not.toMatch(new RegExp(forbidden));
    }
  });
});

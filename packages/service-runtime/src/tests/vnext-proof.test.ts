import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAjv, getOutputSchemaId } from '@siteborne/verification';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PCC_PROOF_NAMESPACE,
  readGovernedPccDocumentHash,
  verifySelfVerifyingPcc,
  type SelfVerifyingPcc,
} from '../pcc/vnext-proof';
import { FOUR_V2_SERVICES, FOUR_V3_SERVICES, runScenario } from './four-service-scenarios';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const runtimeVersionDescriptor = Object.getOwnPropertyDescriptor(process, 'version');

describe('RESULT-PCC-WIRE-CUTOVER-01 vNext proof core', () => {
  beforeAll(() => {
    Object.defineProperty(process, 'version', { value: 'v24.18.1', configurable: true });
  });

  afterAll(() => {
    if (runtimeVersionDescriptor)
      Object.defineProperty(process, 'version', runtimeVersionDescriptor);
  });

  it.each(FOUR_V3_SERVICES)(
    '%s emits one schema-valid self-verifying full PCC',
    async (serviceId) => {
      const { result, keyRegistry } = await runScenario(serviceId);
      const artifact = result.finalized!;
      const wire = artifact.wireBody as unknown as SelfVerifyingPcc;

      expect(result.result_class).toBe('success');
      expect(result.service_id).toBe(serviceId);
      expect(result.service_version).toBe('v3');
      expect(result.contract_release).toBe('3.0.0');
      expect(artifact.artifactVersion).toBe(2);
      expect(wire.pcc_version).toBe('2.0.0');
      expect(wire.contract.service_id).toBe(serviceId);
      expect(wire.extensions[PCC_PROOF_NAMESPACE]).toBeDefined();
      const validator = getAjv().getSchema(getOutputSchemaId(serviceId)!);
      expect(validator).toBeTypeOf('function');
      expect(validator!(wire), JSON.stringify(validator!.errors)).toBe(true);
      expect(result.finalized!.governed).toMatchObject({
        contractRelease: '3.0.0',
        pccSchemaRelease: '2.0.0',
      });
      expect(result.finalized!.governed.policyHash).not.toMatch(/^sha256:([0-9a-f])\1{63}$/);
      await expect(verifySelfVerifyingPcc(wire, keyRegistry)).resolves.toMatchObject({
        valid: true,
        errors: [],
      });
    }
  );

  it.each(FOUR_V2_SERVICES)('%s preserves the legacy flat receipt wire body', async (serviceId) => {
    const { result } = await runScenario(serviceId);
    expect(result.finalized!.artifactVersion).toBe(1);
    expect(result.finalized!.wireBody).toEqual(result.receipt);
    expect(result.finalized!.wireBody).not.toHaveProperty('pcc_version');
  });

  it('binds verify outcome and score and rejects output, identity, receipt, proof and signature tampering', async () => {
    const { result, keyRegistry } = await runScenario('verify_agent_output.v3');
    const original = result.finalized!.wireBody as unknown as SelfVerifyingPcc;
    const proof = original.extensions[PCC_PROOF_NAMESPACE];
    const originalVerify = original.extensions['net.siteborne.agent-verification.v1'] as {
      outcome: string;
      score: number;
    };
    const cases: Array<[string, (wire: SelfVerifyingPcc) => void, string]> = [
      [
        'outcome',
        (wire) => {
          (wire.extensions['net.siteborne.agent-verification.v1'] as { outcome: string }).outcome =
            originalVerify.outcome === 'pass' ? 'fail' : 'pass';
        },
        'output_hash_mismatch',
      ],
      [
        'score',
        (wire) => {
          (wire.extensions['net.siteborne.agent-verification.v1'] as { score: number }).score =
            originalVerify.score === 0 ? 1 : 0;
        },
        'output_hash_mismatch',
      ],
      [
        'service id',
        (wire) => {
          wire.contract.service_id = 'web_context_verified.v3';
        },
        'service_id_mismatch',
      ],
      [
        'receipt id',
        (wire) => {
          wire.extensions[PCC_PROOF_NAMESPACE].receipt.receipt_id = 'rcpt_' + '0'.repeat(24);
        },
        'receipt_id_mismatch',
      ],
      [
        'proof version',
        (wire) => {
          (wire.extensions[PCC_PROOF_NAMESPACE] as { proof_version: string }).proof_version =
            '9.0.0';
        },
        'proof_version_mismatch',
      ],
      [
        'signature',
        (wire) => {
          wire.extensions[PCC_PROOF_NAMESPACE].receipt.signature = 'A'.repeat(86);
        },
        'invalid_signature',
      ],
      [
        'unknown finding code',
        (wire) => {
          wire.extensions[
            PCC_PROOF_NAMESPACE
          ].verification_material.verifier_results[0].findings.push({
            code: 'invented_finding',
            severity: 'blocking',
          });
        },
        'unknown_finding_code:invented_finding',
      ],
      [
        'unknown failure code',
        (wire) => {
          wire.extensions[
            PCC_PROOF_NAMESPACE
          ].verification_material.verifier_results[0].failure_codes.push('invented_failure');
        },
        'unknown_verifier_failure_code:invented_failure',
      ],
      [
        'invalid Unicode scalar',
        (wire) => {
          (
            wire.extensions['net.siteborne.agent-verification.v1'] as Record<string, unknown>
          ).invalid = '\ud800';
        },
        'non_unicode_scalar',
      ],
    ];
    expect(proof.receipt.decision).toBe(original.verification.decision);
    expect(proof.receipt.output_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    for (const [label, mutate, expected] of cases) {
      const changed = clone(original);
      mutate(changed);
      const check = await verifySelfVerifyingPcc(changed, keyRegistry);
      expect(check.valid, label).toBe(false);
      expect(check.errors, label).toContain(expected);
    }
  });

  it('signs and self-verifies a legitimate verify non-pass result', async () => {
    const { result, keyRegistry } = await runScenario('verify_agent_output.v3', {
      verifyExpectedValue: 42,
      verifyCandidateValue: 7,
    });
    const wire = result.finalized!.wireBody as unknown as SelfVerifyingPcc;
    const extension = wire.extensions['net.siteborne.agent-verification.v1'] as {
      outcome: string;
      score: number;
    };
    expect(extension.outcome).not.toBe('pass');
    expect(extension.score).toBeLessThan(1);
    const golden = {
      canonicalPreimage: result.finalized!.proofPreimage.canonicalPreimage,
      receiptId: result.finalized!.linkEvidenceInputs.receiptId,
    };
    const path = `${REPO}packages/service-runtime/fixtures/internal-artifact-preimage/verify_agent_output.v3.nonpass.json`;
    if (process.env.UPDATE_PREIMAGE_GOLDEN === '1') {
      writeFileSync(path, JSON.stringify(golden, null, 2) + '\n');
    }
    expect(golden).toEqual(JSON.parse(readFileSync(path, 'utf8')));
    await expect(verifySelfVerifyingPcc(wire, keyRegistry)).resolves.toEqual({
      valid: true,
      errors: [],
    });
  });
});

describe('readGovernedPccDocumentHash — canonical shared accessor', () => {
  it.each(FOUR_V3_SERVICES)(
    "%s: reads the REAL governed PCC's nested receipt.pcc_document_hash",
    async (serviceId) => {
      const { result } = await runScenario(serviceId);
      const wire = result.finalized!.wireBody as unknown as SelfVerifyingPcc;
      const expected = wire.extensions[PCC_PROOF_NAMESPACE].receipt.pcc_document_hash;
      expect(typeof expected).toBe('string');
      expect(readGovernedPccDocumentHash(wire.extensions)).toBe(expected);
    }
  );

  it('is NOT fooled by a flat pcc_document_hash on the proof object (the exact shape the real production defect used to read)', async () => {
    const { result } = await runScenario('document_evidence_json.v3');
    const wire = result.finalized!.wireBody as unknown as SelfVerifyingPcc;
    const flatOnly = {
      [PCC_PROOF_NAMESPACE]: {
        // No `receipt` at all — only a flat field, the old (buggy) shape.
        pcc_document_hash: wire.extensions[PCC_PROOF_NAMESPACE].receipt.pcc_document_hash,
      },
    };
    expect(readGovernedPccDocumentHash(flatOnly)).toBeNull();
  });

  it.each([
    ['null extensions', null],
    ['undefined extensions', undefined],
    ['array extensions', []],
    ['string extensions', 'not-an-object'],
    ['missing proof namespace', {}],
    ['null proof', { [PCC_PROOF_NAMESPACE]: null }],
    ['array proof', { [PCC_PROOF_NAMESPACE]: [] }],
    ['missing receipt', { [PCC_PROOF_NAMESPACE]: {} }],
    ['null receipt', { [PCC_PROOF_NAMESPACE]: { receipt: null } }],
    ['array receipt', { [PCC_PROOF_NAMESPACE]: { receipt: [] } }],
    ['missing hash field', { [PCC_PROOF_NAMESPACE]: { receipt: {} } }],
    ['non-string hash field', { [PCC_PROOF_NAMESPACE]: { receipt: { pcc_document_hash: 12345 } } }],
  ] as const)('fails closed (null, never throws) for: %s', (_label, malformed) => {
    expect(() => readGovernedPccDocumentHash(malformed)).not.toThrow();
    expect(readGovernedPccDocumentHash(malformed)).toBeNull();
  });
});

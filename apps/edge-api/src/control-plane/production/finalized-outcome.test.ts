import { describe, expect, it } from 'vitest';
import type { ServiceExecutionResult } from '@siteborne/service-runtime';
import { toExecutorOutcomeResult } from './finalized-outcome';

describe('finalized executor outcome projection', () => {
  it('carries the exact vNext full-PCC wire root to the persistence boundary', () => {
    const wireBody = {
      pcc_version: '2.0.0',
      extensions: { 'net.siteborne.verification-proof.v1': { proof_version: '1.0.0' } },
    };
    const projected = toExecutorOutcomeResult({
      result_class: 'success',
      finalized: {
        artifactVersion: 2,
        wireBody,
        linkEvidenceInputs: {
          receiptId: 'rcpt_aaaaaaaaaaaaaaaaaaaaaaaa',
          signingKeyId: 'kid_aaaaaaaaaaaaaaaaaaaaaaaa',
          signature: 'A'.repeat(86),
          buyerReceiptHash: `sha256:${'a'.repeat(64)}`,
        },
      },
    } as unknown as ServiceExecutionResult);

    expect(projected.resultRepresentation).toEqual({
      format: 'SELF_VERIFYING_PCC_VNEXT',
      body: wireBody,
    });
    expect(projected.result).not.toHaveProperty('finalized');
  });

  it('does not relabel a legacy finalized artifact as a self-verifying PCC', () => {
    const projected = toExecutorOutcomeResult({
      result_class: 'success',
      receipt: { receipt_id: 'legacy' },
      finalized: {
        artifactVersion: 1,
        wireBody: { receipt_id: 'legacy' },
        linkEvidenceInputs: {
          receiptId: 'legacy',
          signingKeyId: 'kid_aaaaaaaaaaaaaaaaaaaaaaaa',
          signature: 'A'.repeat(86),
          buyerReceiptHash: `sha256:${'a'.repeat(64)}`,
        },
      },
    } as unknown as ServiceExecutionResult);

    expect(projected.resultRepresentation).toBeUndefined();
    expect(projected.result.receipt).toEqual({ receipt_id: 'legacy' });
  });
});

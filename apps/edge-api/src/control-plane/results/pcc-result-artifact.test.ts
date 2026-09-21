import { describe, expect, it } from 'vitest';
import { InMemoryArtifactStore } from '../artifacts/store';
import type { ExecutorOutcome } from '../routes/x402-service';
import { hashPaymentObject } from '@siteborne/protocol-x402';
import {
  LEGACY_RECEIPT_ONLY,
  MAX_VNEXT_PCC_BYTES,
  PccResultArtifactStore,
  SELF_VERIFYING_PCC_VNEXT,
  classifyStoredResultRecord,
  resolveStoredResultBody,
} from './pcc-result-artifact';

const JOB_ID = '11111111-1111-4111-8111-111111111111';

describe('vNext PCC durable result artifacts', () => {
  it('persists canonical full-PCC bytes by content hash and reloads the exact semantic root', async () => {
    const store = new PccResultArtifactStore(new InMemoryArtifactStore());
    const pcc = {
      pcc_version: '2.0.0',
      contract: { service_id: 'company_evidence_graph.v3' },
      extensions: {
        'net.siteborne.company-evidence.v1': { z: 1, a: 'value' },
        'net.siteborne.verification-proof.v1': { proof_version: '1.0.0' },
      },
    };

    const reference = await store.stage({
      jobId: JOB_ID,
      serviceId: 'company_evidence_graph.v3',
      pcc,
      createdAt: '2026-09-21T00:00:00.000Z',
    });

    expect(await store.isReady(reference)).toBe(true);
    expect(await store.read(reference)).toEqual(pcc);
    expect(reference.byte_length).toBeLessThan(MAX_VNEXT_PCC_BYTES);
  });

  it('rejects a candidate larger than the governed 5,000,000-byte wire limit before settlement', async () => {
    const store = new PccResultArtifactStore(new InMemoryArtifactStore());
    await expect(
      store.stage({
        jobId: JOB_ID,
        serviceId: 'web_context_verified.v3',
        pcc: { value: 'x'.repeat(MAX_VNEXT_PCC_BYTES) },
        createdAt: '2026-09-21T00:00:00.000Z',
      })
    ).rejects.toThrow(`vnext_pcc_exceeds_${MAX_VNEXT_PCC_BYTES}_byte_limit`);
  });

  it('branches on explicit vNext format while treating unversioned historical bodies as legacy only', () => {
    expect(
      classifyStoredResultRecord({
        result_format: SELF_VERIFYING_PCC_VNEXT,
        result_reference: { content_hash: `sha256:${'a'.repeat(64)}` },
      })
    ).toBe(SELF_VERIFYING_PCC_VNEXT);
    expect(classifyStoredResultRecord({ body: { receipt_id: 'legacy' } })).toBe(
      LEGACY_RECEIPT_ONLY
    );
    expect(
      classifyStoredResultRecord({
        result_format: LEGACY_RECEIPT_ONLY,
        body: { receipt_id: 'legacy' },
      })
    ).toBe(LEGACY_RECEIPT_ONLY);
    expect(classifyStoredResultRecord({ result_format: 'UNKNOWN', body: {} })).toBeNull();
  });

  it('replays the same staged PCC while legacy replay remains inline and unknown formats fail closed', async () => {
    const store = new PccResultArtifactStore(new InMemoryArtifactStore());
    const pcc = { pcc_version: '2.0.0', extensions: {} };
    const reference = await store.stage({
      jobId: JOB_ID,
      serviceId: 'company_evidence_graph.v3',
      pcc,
      createdAt: '2026-09-21T00:00:00.000Z',
    });
    expect(
      await resolveStoredResultBody(
        { result_format: SELF_VERIFYING_PCC_VNEXT, result_reference: reference },
        store
      )
    ).toEqual(pcc);
    expect(await resolveStoredResultBody({ body: { receipt_id: 'legacy' } }, store)).toEqual({
      receipt_id: 'legacy',
    });
    expect(
      await resolveStoredResultBody({ result_format: 'UNKNOWN', body: pcc }, store)
    ).toBeNull();
    expect(
      await resolveStoredResultBody({
        result_format: SELF_VERIFYING_PCC_VNEXT,
        result_reference: reference,
      })
    ).toBeNull();
  });

  it('bounds the durable Workflow step by replacing the full body and duplicate output with one R2 reference', async () => {
    const store = new PccResultArtifactStore(new InMemoryArtifactStore());
    const pcc = { pcc_version: '2.0.0', extensions: { service: { value: 'x'.repeat(1024) } } };
    const outcome: ExecutorOutcome = {
      result: {
        result_class: 'success',
        output: { value: 'x'.repeat(1024) },
        receipt: { receipt_id: 'rcpt_aaaaaaaaaaaaaaaaaaaaaaaa' },
      },
      linkEvidenceInputs: {
        receiptId: 'rcpt_aaaaaaaaaaaaaaaaaaaaaaaa',
        signingKeyId: 'kid_aaaaaaaaaaaaaaaaaaaaaaaa',
        signature: 'A'.repeat(86),
        buyerReceiptHash: await hashPaymentObject(pcc),
      },
      resultRepresentation: { format: SELF_VERIFYING_PCC_VNEXT, body: pcc },
    };

    const prepared = await store.prepareExecutorOutcome({
      outcome,
      jobId: JOB_ID,
      serviceId: 'company_evidence_graph.v3',
      createdAt: '2026-09-21T00:00:00.000Z',
    });

    expect(prepared.result.output).toBeUndefined();
    expect(prepared.resultRepresentation).toHaveProperty('reference');
    expect(JSON.stringify(prepared)).not.toContain('"value":"xxxxxxxx');
  });
});

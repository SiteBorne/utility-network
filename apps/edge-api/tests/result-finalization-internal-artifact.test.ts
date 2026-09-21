/**
 * RESULT-FINALIZATION-INTERNAL-ARTIFACT-01 — edge-side proofs.
 *
 * Executes the REAL production `D1PaymentFinalizationRepository.persistLinkEvidence`
 * (over a tiny D1 fake), the real production executors, the real
 * `validateExecutorPcc` and the real Workflow orchestration to show that link
 * evidence is persisted from typed proof state, never from the response body.
 */
import { describe, expect, it } from 'vitest';
import { buildProductionSigner } from '@siteborne/service-runtime';
import { runPaidContinuationWorkflow } from '../src/control-plane/workflows/paid-continuation-workflow';
import { validateExecutorPcc } from '../src/control-plane/workflows/production-dependencies';
import { D1PaymentFinalizationRepository } from '../src/control-plane/repositories/d1/payment-finalization';
import { buildVerifyAgentOutputV2ProductionExecutor } from '../src/control-plane/production/verify-agent-output-v2-production-executor';
import { FakeWorkflowStep } from './support/fake-workflow-step';
import {
  buildDecryptedPayload,
  buildTestDependencies,
  buildTestMetadata,
  sealTestInput,
} from './support/paid-continuation-workflow-fixtures';

/** Columns of the INSERT in `persistLinkEvidence`, by bound-argument index. */
const COL = { buyerReceiptHash: 13, signingKeyId: 14 } as const;

class FakeLinkD1 {
  insertArgs: unknown[] | null = null;
  prepare(sql: string) {
    const s = sql.trim();
    return {
      bind: (...a: unknown[]) => ({
        first: async () => {
          if (s.startsWith('SELECT id FROM payment_attempts')) return { id: 'attempt_1' };
          if (s.includes('FROM payment_service_link_evidence')) {
            const b = this.insertArgs as unknown[];
            return {
              link_hash: b[4],
              settlement_transaction_reference: b[6],
              buyer_receipt_hash: b[13],
            };
          }
          throw new Error(`unsupported first: ${s}`);
        },
        run: async () => {
          if (!s.startsWith('INSERT INTO payment_service_link_evidence'))
            throw new Error(`unsupported: ${s}`);
          if (this.insertArgs === null) this.insertArgs = a;
          return { success: true };
        },
      }),
    };
  }
}

const LINK = {
  link_version: 2,
  payment_rail: 'cdp',
  payment_provider: 'cdp',
  payment_identifier: 'pay-typed',
  quote_id: 'q',
  requirement_id: 'r',
  service_id: 'verify_agent_output.v2',
  service_version: 'v2',
  request_input_hash: 'sha256:' + '1'.repeat(64),
  job_id: 'job-typed',
  service_output_hash: 'sha256:' + '2'.repeat(64),
  verification_receipt_id: 'receipt-provider',
  verification_receipt_hash: 'sha256:' + '3'.repeat(64),
  verification_evidence_hash: 'sha256:' + '4'.repeat(64),
  settlement_evidence_hash: 'sha256:' + '5'.repeat(64),
  link_id: 'lnk-typed',
  link_hash: 'sha256:' + '6'.repeat(64),
} as never;

const TYPED = {
  receiptId: 'rcpt_' + 'a'.repeat(24),
  signingKeyId: 'kid_typedtypedtypedtypedtyp',
  signature: 'S'.repeat(86),
  buyerReceiptHash: 'sha256:' + 'c'.repeat(64),
};

function baseInput(over: Record<string, unknown> = {}) {
  return {
    paymentIdentifier: 'pay-typed',
    jobId: 'job-typed',
    paymentServiceLink: LINK,
    settlementTransactionReference: '0xtx',
    settlementEvidenceHash: 'sha256:' + '5'.repeat(64),
    linkEvidenceInputs: TYPED,
    buyerReceiptId: 'receipt-workflow',
    createdAt: '2026-09-11T00:00:01.000Z',
    ...over,
  } as Parameters<D1PaymentFinalizationRepository['persistLinkEvidence']>[0];
}

describe('real persistLinkEvidence consumes typed proof state (REAL_PERSIST_LINK_EVIDENCE_TYPED_TEST)', () => {
  it('A: typed link evidence succeeds and persists exactly the typed values', async () => {
    const d1 = new FakeLinkD1();
    await new D1PaymentFinalizationRepository(d1 as never).persistLinkEvidence(baseInput());
    expect(d1.insertArgs![COL.signingKeyId]).toBe(TYPED.signingKeyId);
    expect(d1.insertArgs![COL.buyerReceiptHash]).toBe(TYPED.buyerReceiptHash);
  });

  it('B/C: a legacy wire-shaped `pcc` field is ignored; signing_key_id comes from typed state only', async () => {
    const d1 = new FakeLinkD1();
    await new D1PaymentFinalizationRepository(d1 as never).persistLinkEvidence(
      baseInput({
        // A hostile / different public representation must have zero influence.
        pcc: { signing_key_id: 'kid_FROM_WIRE_BODY', signature: 'WIRE', receipt: { anything: 1 } },
        wireBody: { signing_key_id: 'kid_FROM_WIRE_BODY' },
      })
    );
    expect(d1.insertArgs![COL.signingKeyId]).toBe(TYPED.signingKeyId);
    expect(d1.insertArgs).not.toContain('kid_FROM_WIRE_BODY');
  });

  it('B: two different wire representations with identical typed state persist identical link evidence', async () => {
    const first = new FakeLinkD1();
    const second = new FakeLinkD1();
    await new D1PaymentFinalizationRepository(first as never).persistLinkEvidence(
      baseInput({ pcc: { shape: 'flat-receipt' } })
    );
    await new D1PaymentFinalizationRepository(second as never).persistLinkEvidence(
      baseInput({ pcc: { shape: 'full-pcc', extensions: {} } })
    );
    expect(second.insertArgs).toEqual(first.insertArgs);
  });

  it('D: missing or malformed typed proof state fails closed (nothing is written)', async () => {
    for (const bad of [
      undefined,
      null,
      {},
      { ...TYPED, signingKeyId: '' },
      { ...TYPED, signature: '' },
      { ...TYPED, signature: 42 },
      { ...TYPED, buyerReceiptHash: 'not-a-hash' },
      { signing_key_id: 'kid_x', signature: 'y' }, // legacy wire shape is NOT accepted
    ]) {
      const d1 = new FakeLinkD1();
      await expect(
        new D1PaymentFinalizationRepository(d1 as never).persistLinkEvidence(
          baseInput({ linkEvidenceInputs: bad })
        )
      ).rejects.toThrow('typed link evidence inputs');
      expect(d1.insertArgs).toBeNull();
    }
  });
});

describe('typed link evidence originates from the internal artifact, end to end', () => {
  async function runRealChain() {
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const { signer, registry } = await buildProductionSigner(hex, 'kid_prod0123456789abcdefghij');
    const executor = buildVerifyAgentOutputV2ProductionExecutor(signer, registry);
    const base = await buildTestDependencies({ executor, validatePcc: validateExecutorPcc });
    const d1 = new FakeLinkD1();
    const real = new D1PaymentFinalizationRepository(d1 as never);
    let seen: Parameters<typeof real.persistLinkEvidence>[0] | undefined;
    const deps = {
      ...base,
      persistence: {
        ...base.persistence,
        finalization: {
          recordProviderFailure: (i: never) =>
            base.finalizationPersistence.recordProviderFailure(i),
          recordSettlementFinalizationUnresolved: (i: never) =>
            base.finalizationPersistence.recordSettlementFinalizationUnresolved(i),
          persistLinkEvidence: (i: Parameters<typeof real.persistLinkEvidence>[0]) => {
            seen = i;
            return real.persistLinkEvidence(i);
          },
          finalizeSettled: (p: string) => base.finalizationPersistence.finalizeSettled(p),
        },
      },
    };
    const metadata = buildTestMetadata();
    const input = await sealTestInput(metadata, {
      key: base.envelopeKey,
      payload: buildDecryptedPayload(metadata, {
        executorInput: {
          verification_contract: {
            claims: [{ claim_id: 'total', predicate: 'equals', expected_value: 42 }],
            deterministic_requirements: [],
          },
          candidate_output: { total: 42 },
          required_schema: {},
          verification_mode: 'standard',
        } as never,
      }),
    });
    const result = await runPaidContinuationWorkflow(
      { payload: input },
      new FakeWorkflowStep(),
      deps as never
    );
    return { result, seen: seen!, d1, executor };
  }

  it('the Workflow hands persistLinkEvidence the artifact-derived typed inputs; the released body is untouched', async () => {
    const { result, seen, d1 } = await runRealChain();
    expect(result.status).toBe('settled');
    expect(seen.linkEvidenceInputs).toMatchObject({
      signingKeyId: 'kid_prod0123456789abcdefghij',
    });
    expect(seen.linkEvidenceInputs!.signature).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(seen).not.toHaveProperty('pcc');
    expect(d1.insertArgs![COL.signingKeyId]).toBe('kid_prod0123456789abcdefghij');
  });

  it('validateExecutorPcc rejects a success that lacks typed proof state BEFORE settlement', async () => {
    const outcome = {
      result: {
        result_class: 'success',
        receipt: { signing_key_id: 'kid_wire', signature: 'wire' },
      },
    };
    expect(await validateExecutorPcc(outcome as never)).toEqual({
      valid: false,
      reason: 'missing_link_evidence_inputs',
    });
  });

  it('validateExecutorPcc rejects typed proof state whose buyer hash does not describe the released receipt', async () => {
    const outcome = {
      result: { result_class: 'success', receipt: { id: 'r1' } },
      linkEvidenceInputs: { ...TYPED, buyerReceiptHash: 'sha256:' + 'd'.repeat(64) },
    };
    expect(await validateExecutorPcc(outcome as never)).toEqual({
      valid: false,
      reason: 'link_evidence_hash_mismatch',
    });
  });

  it('the production executor never carries the internal artifact across the durable step boundary', async () => {
    const hex = 'ab'.repeat(32);
    const { signer, registry } = await buildProductionSigner(hex, 'kid_prod0123456789abcdefghij');
    const outcome = await buildVerifyAgentOutputV2ProductionExecutor(signer, registry)(
      {
        verification_contract: { claims: [], deterministic_requirements: [] },
        candidate_output: { a: 1 },
        required_schema: {},
        verification_mode: 'standard',
      },
      { job_id: 'job-x', request_id: 'req-x' }
    );
    expect(outcome.result).not.toHaveProperty('finalized');
    expect(outcome.linkEvidenceInputs).toBeDefined();
    expect(JSON.stringify(outcome)).not.toContain('net.siteborne.verification-proof.v1');
  });
});

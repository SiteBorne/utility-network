import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hashPaymentObject } from '@siteborne/protocol-x402';
import { buildProductionSigner } from '@siteborne/service-runtime';
import { InMemoryArtifactStore } from '../src/control-plane/artifacts/store';
import { PccResultArtifactStore } from '../src/control-plane/results/pcc-result-artifact';
import { runPaidContinuationWorkflow } from '../src/control-plane/workflows/paid-continuation-workflow';
import {
  buildExecutorPccValidator,
  validateExecutorPcc,
} from '../src/control-plane/workflows/production-dependencies';
import { FakeWorkflowStep } from './support/fake-workflow-step';
import {
  buildSuccessfulExecutorOutcome,
  buildTestDependencies,
  buildTestMetadata,
  sealTestInput,
} from './support/paid-continuation-workflow-fixtures';

describe('vNext continuation result persistence', () => {
  async function fixture(withStore = true, mutate?: (pcc: Record<string, unknown>) => void) {
    const pcc = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            '../../../contracts/releases/3.0.0/examples/company_evidence_graph.v3.pcc.json',
            import.meta.url
          )
        ),
        'utf8'
      )
    ) as Record<string, unknown>;
    const { registry: keyRegistry } = await buildProductionSigner(
      '11'.repeat(32),
      `kid_${'a'.repeat(24)}`
    );
    mutate?.(pcc);
    const buyerReceiptHash = await hashPaymentObject(pcc);
    const receiptId = (pcc.extensions as Record<string, { receipt: { receipt_id: string } }>)[
      'net.siteborne.verification-proof.v1'
    ].receipt.receipt_id;
    const outcome = buildSuccessfulExecutorOutcome({
      service_id: 'company_evidence_graph.v3',
      service_version: 'v3',
      output: { company: 'Example' },
      receipt: pcc.receipt,
      receipt_id: receiptId,
    });
    outcome.resultRepresentation = { format: 'SELF_VERIFYING_PCC_VNEXT', body: pcc };
    outcome.linkEvidenceInputs = {
      ...outcome.linkEvidenceInputs!,
      receiptId,
      buyerReceiptHash,
    };
    const base = await buildTestDependencies({ executor: vi.fn(async () => outcome) });
    const resultArtifacts = new PccResultArtifactStore(new InMemoryArtifactStore());
    const deps = {
      ...base,
      validatePcc: buildExecutorPccValidator(keyRegistry),
      ...(withStore ? { resultArtifacts } : {}),
    };
    const metadata = buildTestMetadata({ service: 'company_evidence_graph.v3' });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    return { pcc, deps, resultArtifacts, input };
  }

  it('stages the exact PCC before settlement and writes only its explicit R2 reference to the cached D1 record', async () => {
    const { pcc, deps, resultArtifacts, input } = await fixture();
    const result = await runPaidContinuationWorkflow(
      { payload: input },
      new FakeWorkflowStep(),
      deps
    );

    expect(result.status).toBe('settled');
    const persisted = [...deps.resultReceiptPersistence.results.values()][0].cachedResult;
    expect(persisted.result_format).toBe('SELF_VERIFYING_PCC_VNEXT');
    expect(persisted.body).toBeUndefined();
    expect(persisted.result_reference).toBeDefined();
    expect(await resultArtifacts.read(persisted.result_reference!)).toEqual(pcc);
    expect(deps.settle).toHaveBeenCalledTimes(1);
  });

  it('fails closed before settlement when a vNext executor has no durable result store', async () => {
    const { deps, input } = await fixture(false);
    const result = await runPaidContinuationWorkflow(
      { payload: input },
      new FakeWorkflowStep(),
      deps
    );

    expect(result.status).toBe('pcc_failed');
    expect(result.error_code).toBe('vnext_result_artifact_store_unavailable');
    expect(deps.settle).not.toHaveBeenCalled();
  });

  it('rejects a canonical, hash-consistent but schema-invalid staged PCC before settlement', async () => {
    const { deps, input } = await fixture(true, (pcc) => {
      delete (pcc.contract as Record<string, unknown>).output_schema_hash;
    });
    const result = await runPaidContinuationWorkflow(
      { payload: input },
      new FakeWorkflowStep(),
      deps
    );
    expect(result.status).toBe('pcc_failed');
    expect(result.error_code).toBe('pcc_schema_validation_failed');
    expect(deps.settle).not.toHaveBeenCalled();
  });

  it('rejects a canonical, hash-consistent PCC with an invalid signature before settlement', async () => {
    const { deps, input } = await fixture(true, (pcc) => {
      const proof = (pcc.extensions as Record<string, { receipt: { signature: string } }>)[
        'net.siteborne.verification-proof.v1'
      ];
      proof.receipt.signature = 'A'.repeat(86);
      (pcc.receipt as { signature: string }).signature = 'A'.repeat(86);
    });
    const result = await runPaidContinuationWorkflow(
      { payload: input },
      new FakeWorkflowStep(),
      deps
    );
    expect(result.status).toBe('pcc_failed');
    expect(result.error_code).toBe('pcc_crypto_verification_failed:invalid_signature');
    expect(deps.settle).not.toHaveBeenCalled();
  });

  it('fails closed before settlement for a cached pre-artifact v3 executor step', async () => {
    const outcome = buildSuccessfulExecutorOutcome({
      service_id: 'company_evidence_graph.v3',
      service_version: 'v3',
    });
    const deps = await buildTestDependencies({ executor: vi.fn(async () => outcome) });
    const guardedDeps = { ...deps, validatePcc: validateExecutorPcc };
    const metadata = buildTestMetadata({ service: 'company_evidence_graph.v3' });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });

    const result = await runPaidContinuationWorkflow(
      { payload: input },
      new FakeWorkflowStep(),
      guardedDeps
    );

    expect(result.status).toBe('pcc_failed');
    expect(result.error_code).toBe('missing_vnext_result_representation');
    expect(deps.settle).not.toHaveBeenCalled();
  });
});

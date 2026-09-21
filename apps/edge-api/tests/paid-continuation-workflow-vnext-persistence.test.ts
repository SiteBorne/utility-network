import { describe, expect, it, vi } from 'vitest';
import { hashPaymentObject } from '@siteborne/protocol-x402';
import { InMemoryArtifactStore } from '../src/control-plane/artifacts/store';
import { PccResultArtifactStore } from '../src/control-plane/results/pcc-result-artifact';
import { runPaidContinuationWorkflow } from '../src/control-plane/workflows/paid-continuation-workflow';
import { validateExecutorPcc } from '../src/control-plane/workflows/production-dependencies';
import { FakeWorkflowStep } from './support/fake-workflow-step';
import {
  buildSuccessfulExecutorOutcome,
  buildTestDependencies,
  buildTestMetadata,
  sealTestInput,
} from './support/paid-continuation-workflow-fixtures';

describe('vNext continuation result persistence', () => {
  async function fixture(withStore = true) {
    const pcc = {
      pcc_version: '2.0.0',
      contract: { service_id: 'company_evidence_graph.v3', service_version: 'v3' },
      extensions: {
        'net.siteborne.company-evidence.v1': { company: 'Example' },
        'net.siteborne.verification-proof.v1': { proof_version: '1.0.0' },
      },
    };
    const buyerReceiptHash = await hashPaymentObject(pcc);
    const outcome = buildSuccessfulExecutorOutcome({
      output: { company: 'Example' },
      receipt: { receipt_id: 'rcpt_aaaaaaaaaaaaaaaaaaaaaaaa' },
      receipt_id: 'rcpt_aaaaaaaaaaaaaaaaaaaaaaaa',
    });
    outcome.resultRepresentation = { format: 'SELF_VERIFYING_PCC_VNEXT', body: pcc };
    outcome.linkEvidenceInputs = {
      ...outcome.linkEvidenceInputs!,
      receiptId: 'rcpt_aaaaaaaaaaaaaaaaaaaaaaaa',
      buyerReceiptHash,
    };
    const base = await buildTestDependencies({ executor: vi.fn(async () => outcome) });
    const resultArtifacts = new PccResultArtifactStore(new InMemoryArtifactStore());
    const deps = {
      ...base,
      validatePcc: validateExecutorPcc,
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

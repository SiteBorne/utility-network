import { describe, expect, it } from 'vitest';
import { runPaidContinuationWorkflow } from '../src/control-plane/workflows/paid-continuation-workflow';
import { FakeWorkflowStep } from './support/fake-workflow-step';
import {
  buildSuccessfulExecutorOutcome,
  buildTestDependencies,
  buildTestMetadata,
  fakeExecutor,
  sealTestInput,
  TEST_PAYMENT_IDENTIFIER,
} from './support/paid-continuation-workflow-fixtures';

describe('Model C Workflow outcome and settlement finalization', () => {
  it('automatically records terminal provider failure as non-actionable without settling', async () => {
    const deps = await buildTestDependencies({
      executor: fakeExecutor({
        result: {
          result_class: 'failure',
          failure: { code: 'provider_failed', message: 'bounded failure' },
        },
      }),
    });
    const input = await sealTestInput(buildTestMetadata(), { key: deps.envelopeKey });
    const result = await runPaidContinuationWorkflow(
      { payload: input },
      new FakeWorkflowStep(),
      deps
    );
    expect(result.status).toBe('executor_rejected');
    expect(deps.finalizationPersistence.providerFailures).toEqual([
      'executor_rejected:provider_failed',
    ]);
    expect(deps.settle).not.toHaveBeenCalled();
  });

  it('persists link evidence then advances settled_external to link_verified to settled', async () => {
    const deps = await buildTestDependencies({
      executor: fakeExecutor(buildSuccessfulExecutorOutcome()),
    });
    const input = await sealTestInput(buildTestMetadata(), { key: deps.envelopeKey });
    const result = await runPaidContinuationWorkflow(
      { payload: input },
      new FakeWorkflowStep(),
      deps
    );
    expect(result.status).toBe('settled');
    expect(deps.finalizationPersistence.linkEvidenceWrites).toBe(1);
    expect(deps.finalizationPersistence.settledFinalizations).toBe(1);
    expect(deps.settlementRepository.rows.get(TEST_PAYMENT_IDENTIFIER)?.lifecycleStage).toBe(
      'settled'
    );
  });

  it('resumes from settled_external without provider, payment verify, or settlement replay', async () => {
    const deps = await buildTestDependencies({
      seedSettlement: {
        lifecycleStage: 'settled_external',
        settlementTransactionReference: '0xalready-settled',
      },
    });
    const input = await sealTestInput(buildTestMetadata(), { key: deps.envelopeKey });
    const result = await runPaidContinuationWorkflow(
      { payload: input },
      new FakeWorkflowStep(),
      deps
    );
    expect(result.status).toBe('settled');
    expect(deps.settle).not.toHaveBeenCalled();
    expect(deps.settlementRepository.rows.get(TEST_PAYMENT_IDENTIFIER)?.lifecycleStage).toBe(
      'settled'
    );
  });
});

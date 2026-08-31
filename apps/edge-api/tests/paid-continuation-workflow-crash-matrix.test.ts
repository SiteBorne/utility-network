/**
 * SUN-1221E6R-H2AWI-2h — full restart/replay matrix (plan Task 2.8, 12
 * cases, mission §30, design §14/§26).
 *
 * Cloudflare Workflows memoizes each successfully completed `step.do()`
 * call and never re-executes it on restart. This suite simulates a
 * restart by constructing a SECOND `FakeWorkflowStep` pre-seeded with
 * exactly the step results a real Workflow would have durably completed
 * before the simulated crash point, then running `runPaidContinuationWorkflow`
 * again against that seeded step AND the SAME (durable, shared) settlement
 * repository / job persistence / result-receipt persistence fakes a real
 * restart would still see — proving the orchestration function itself
 * (not just the platform's own memoization) never re-triggers an unsafe
 * economic action.
 *
 * Each of the 12 cases is its own `it(...)` block — no shared loop hiding
 * individual failures.
 */
import { describe, expect, it, vi } from 'vitest';
import { runPaidContinuationWorkflow } from '../src/control-plane/workflows/paid-continuation-workflow';
import { FakeWorkflowStep } from './support/fake-workflow-step';
import {
  buildDecryptedPayload,
  buildSuccessfulExecutorOutcome,
  buildTestDependencies,
  buildTestMetadata,
  fakeSettleRejected,
  sealTestInput,
  TEST_JOB_ID,
  TEST_PAYMENT_IDENTIFIER,
} from './support/paid-continuation-workflow-fixtures';

describe('paid-continuation-workflow — crash/restart determinism matrix (H2AWI-2h)', () => {
  it('case 1: crash before step 0 (envelope never opened) — restart re-runs step 0, safe (pure)', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies();
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep(); // nothing memoized — a fresh start

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('settled');
    expect(step.calls.map((c) => c.name)[0]).toBe('open-envelope');
  });

  it('case 2: crash during step 2 (executor call) — restart re-invokes step 2; a second executor call is acceptable', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies();
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const decrypted = buildDecryptedPayload(metadata);
    const step = new FakeWorkflowStep(
      new Map([
        ['open-envelope', decrypted],
        ['check-authorization-expiry', { expired: false }],
        // 'invoke-executor' intentionally NOT memoized — crash mid-step.
      ])
    );

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('settled');
    // step.do() is called for EVERY step on every run() invocation (steps
    // 0/1 return their memoized value without invoking the callback) --
    // the callback-invocation count is what actually proves memoization,
    // not the list of step.do() names, which is always the full 7.
    expect(step.calls.map((c) => c.name)).toEqual([
      'open-envelope',
      'check-authorization-expiry',
      'invoke-executor',
      'generate-pcc',
      'settle',
      'persist-result',
      'persist-receipt-and-finalize',
    ]);
    expect(deps.executor).toHaveBeenCalledTimes(1); // this restart's own single (re-)invocation
  });

  it('case 3: crash during step 3 (PCC) — restart re-runs step 3; deterministic given step 2s already-memoized output', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies();
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const decrypted = buildDecryptedPayload(metadata);
    const executorOutcome = buildSuccessfulExecutorOutcome();
    const step = new FakeWorkflowStep(
      new Map([
        ['open-envelope', decrypted],
        ['check-authorization-expiry', { expired: false }],
        ['invoke-executor', executorOutcome],
        // 'generate-pcc' intentionally NOT memoized.
      ])
    );

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('settled');
    expect(step.calls.map((c) => c.name)).toEqual([
      'open-envelope',
      'check-authorization-expiry',
      'invoke-executor',
      'generate-pcc',
      'settle',
      'persist-result',
      'persist-receipt-and-finalize',
    ]);
    expect(deps.executor).not.toHaveBeenCalled(); // step 2 stayed memoized, never re-invoked
  });

  it('case 4: crash before step 4s pre-settle draft write — restart re-runs step 4 from scratch, draft not yet written, safe', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({ seedSettlement: { lifecycleStage: 'executed' } });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const decrypted = buildDecryptedPayload(metadata);
    const step = new FakeWorkflowStep(
      new Map([
        ['open-envelope', decrypted],
        ['check-authorization-expiry', { expired: false }],
        ['invoke-executor', buildSuccessfulExecutorOutcome()],
        ['generate-pcc', { valid: true, pcc: {} }],
      ])
    );

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('settled');
    expect(deps.settle).toHaveBeenCalledTimes(1);
    expect(deps.settlementRepository.recordSettlementPendingCallCount).toBe(1);
  });

  it('case 5: crash after pre-settle draft write, before settle() call — restart routes DIRECTLY to reconciliation, never calls settle()', async () => {
    const metadata = buildTestMetadata();
    // Durable state as it would exist AFTER a prior attempt's draft write
    // but with the settle() call never having produced any response
    // (crash strictly between the two) — no candidate tx ref known.
    const deps = await buildTestDependencies({
      seedSettlement: { lifecycleStage: 'settlement_pending', settlementTransactionReference: null },
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const decrypted = buildDecryptedPayload(metadata);
    const step = new FakeWorkflowStep(
      new Map([
        ['open-envelope', decrypted],
        ['check-authorization-expiry', { expired: false }],
        ['invoke-executor', buildSuccessfulExecutorOutcome()],
        ['generate-pcc', { valid: true, pcc: {} }],
        // 'settle' intentionally NOT memoized — this restart re-enters it.
      ])
    );

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(deps.settle).not.toHaveBeenCalled(); // NEVER called again
    expect(deps.reconciliationChecker).not.toHaveBeenCalled(); // no tx ref to check
    expect(result.status).toBe('settlement_ambiguous');
  });

  it('case 6: crash during the settle() network call itself, response never received — restart sees the same unresolved draft, resolves via reconciliation only', async () => {
    const metadata = buildTestMetadata();
    // This time a candidate transaction reference DID become known before
    // the crash (e.g. a partial/out-of-band response) — reconciliation can
    // positively confirm it on-chain without ever re-calling settle().
    const deps = await buildTestDependencies({
      seedSettlement: {
        lifecycleStage: 'settlement_pending',
        settlementTransactionReference: '0xpartial',
      },
    });
    deps.reconciliationChecker.mockResolvedValue('SETTLED');
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const decrypted = buildDecryptedPayload(metadata);
    const step = new FakeWorkflowStep(
      new Map([
        ['open-envelope', decrypted],
        ['check-authorization-expiry', { expired: false }],
        ['invoke-executor', buildSuccessfulExecutorOutcome()],
        ['generate-pcc', { valid: true, pcc: {} }],
      ])
    );

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(deps.settle).not.toHaveBeenCalled();
    expect(deps.reconciliationChecker).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('settled');
    expect(result.settlement_transaction_reference).toBe('0xpartial');
  });

  it('case 7: crash after settle() returns confirmed, before step 4 returns — restart never re-calls settle(); reconciliation feeds the happy-path continuation', async () => {
    const metadata = buildTestMetadata();
    // Distinguishes from case 6 only in ORIGIN (settle() actually returned
    // a confirmed response internally, but the crash landed between that
    // return and `recordSettledExternal` completing) -- from the
    // restarted run's point of view this is indistinguishable from case 6
    // (still 'settlement_pending' with a known tx ref), which is exactly
    // the point: the SAME safe recovery path handles both.
    const deps = await buildTestDependencies({
      seedSettlement: {
        lifecycleStage: 'settlement_pending',
        settlementTransactionReference: '0xconfirmed',
      },
    });
    deps.reconciliationChecker.mockResolvedValue('SETTLED');
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const decrypted = buildDecryptedPayload(metadata);
    const step = new FakeWorkflowStep(
      new Map([
        ['open-envelope', decrypted],
        ['check-authorization-expiry', { expired: false }],
        ['invoke-executor', buildSuccessfulExecutorOutcome()],
        ['generate-pcc', { valid: true, pcc: {} }],
      ])
    );

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(deps.settle).not.toHaveBeenCalled();
    expect(result.status).toBe('settled');
    expect(deps.resultReceiptPersistence.persistResultCallCount).toBe(1);
    expect(deps.resultReceiptPersistence.persistReceiptCallCount).toBe(1);
  });

  it('case 8: crash during step 5 (persist-result), settlement already confirmed — restart re-runs step 5 only, never re-calls settle()', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({
      seedSettlement: {
        lifecycleStage: 'settled_external',
        settlementTransactionReference: '0xalreadysettled',
      },
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const decrypted = buildDecryptedPayload(metadata);
    const step = new FakeWorkflowStep(
      new Map([
        ['open-envelope', decrypted],
        ['check-authorization-expiry', { expired: false }],
        ['invoke-executor', buildSuccessfulExecutorOutcome()],
        ['generate-pcc', { valid: true, pcc: {} }],
        ['settle', { kind: 'confirmed', transactionReference: '0xalreadysettled' }],
        // 'persist-result' intentionally NOT memoized.
      ])
    );

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(deps.settle).not.toHaveBeenCalled(); // step 4 stayed memoized
    expect(result.status).toBe('settled');
    expect(deps.resultReceiptPersistence.persistResultCallCount).toBe(1);
    expect(step.calls.map((c) => c.name)).toEqual([
      'open-envelope',
      'check-authorization-expiry',
      'invoke-executor',
      'generate-pcc',
      'settle',
      'persist-result',
      'persist-receipt-and-finalize',
    ]);
  });

  it('case 9: crash during step 6 (persist-receipt), settlement confirmed, result already persisted — restart re-runs step 6 only', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({
      seedSettlement: {
        lifecycleStage: 'settled_external',
        settlementTransactionReference: '0xalreadysettled',
      },
    });
    // Simulate the result row already durably written by the crashed
    // first attempt (step 5's own idempotent UPSERT would have written
    // this).
    await deps.resultReceiptPersistence.persistResult({
      jobId: TEST_JOB_ID,
      paymentIdentifier: TEST_PAYMENT_IDENTIFIER,
    });
    deps.resultReceiptPersistence.persistResultCallCount = 0; // reset the counter to isolate THIS restart's own calls

    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const decrypted = buildDecryptedPayload(metadata);
    const step = new FakeWorkflowStep(
      new Map([
        ['open-envelope', decrypted],
        ['check-authorization-expiry', { expired: false }],
        ['invoke-executor', buildSuccessfulExecutorOutcome()],
        ['generate-pcc', { valid: true, pcc: {} }],
        ['settle', { kind: 'confirmed', transactionReference: '0xalreadysettled' }],
        ['persist-result', { status: 'already_written' }],
        // 'persist-receipt-and-finalize' intentionally NOT memoized.
      ])
    );

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(deps.settle).not.toHaveBeenCalled();
    expect(deps.resultReceiptPersistence.persistResultCallCount).toBe(0); // step 5 stayed memoized, never re-invoked
    expect(result.status).toBe('settled');
    expect(step.calls.map((c) => c.name)).toEqual([
      'open-envelope',
      'check-authorization-expiry',
      'invoke-executor',
      'generate-pcc',
      'settle',
      'persist-result',
      'persist-receipt-and-finalize',
    ]);
    const job = await deps.jobPersistence.getJob(TEST_JOB_ID);
    expect(job?.current_state).toBe('DELIVERED');
  });

  it('case 10: duplicate Workflow instance precondition — two independent full runs of the SAME input still settle exactly once (D1 at-most-one backstop)', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies();
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });

    const firstStep = new FakeWorkflowStep();
    const firstResult = await runPaidContinuationWorkflow({ payload: input }, firstStep, deps);

    // A second, entirely independent Workflow "instance" (fresh step,
    // same shared durable dependencies) somehow also runs against the
    // identical WorkflowContinuationInput -- the platform's own
    // instance-ID uniqueness (deriveWorkflowInstanceId) should prevent
    // this from ever happening in production, but this test proves the
    // D1 at-most-one invariant is still the final backstop even if it did.
    const secondStep = new FakeWorkflowStep();
    const secondResult = await runPaidContinuationWorkflow({ payload: input }, secondStep, deps);

    expect(firstResult.status).toBe('settled');
    expect(secondResult.status).toBe('settled'); // second run observes the already-settled outcome
    expect(deps.settle).toHaveBeenCalledTimes(1); // settle() reached exactly once across BOTH runs
    expect(secondResult.settlement_transaction_reference).toBe(firstResult.settlement_transaction_reference);
  });

  it('case 11: executor timeout at the declared step boundary — reports executor_timeout deterministically, no real wait, never hangs', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({
      executor: vi.fn(async () => {
        // Simulates the platform's own step.do timeout classification
        // surfacing as a thrown error -- no real setTimeout/wait anywhere
        // in this test.
        const err = new Error('invoke-executor step exceeded its declared 40 second timeout');
        err.name = 'TimeoutError';
        throw err;
      }),
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('executor_timeout');
    expect(deps.settle).not.toHaveBeenCalled();
  });

  it('case 12: settlement rejected pre-broadcast (explicit facilitator no) — zero economic effect, terminal settlement_rejected, draft marked RESOLVED not left ambiguous', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({ settleResponse: fakeSettleRejected('insufficient_funds') });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('settlement_rejected');
    expect(deps.settle).toHaveBeenCalledTimes(1);
    const record = await deps.settlementRepository.getSettlementRecoveryRecord(TEST_PAYMENT_IDENTIFIER);
    // Resolved (settlement_failed), never left dangling at
    // 'settlement_pending' where a future restart could misread it as
    // still-ambiguous.
    expect(record?.lifecycleStage).toBe('settlement_failed');
    expect(record?.settlementOutcomeKind).toBe('explicit_rejection');
  });
});

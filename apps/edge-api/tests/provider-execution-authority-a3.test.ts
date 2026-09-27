/**
 * R3-A3-PROVIDER-EXECUTION-AUTHORITY-41 — provider (executor) dispatch
 * authority.
 *
 * Two distinct races, never conflated:
 *
 *   A. POST-COMPLETION / WHOLE-INSTANCE REPLAY — the payment attempt has
 *      already left `verified` (executed / settlement_pending / settled...).
 *      Fenced by reading the canonical `payment_attempts.lifecycle_stage`
 *      INSIDE the invoke-executor step (outside the step would wrongly stop a
 *      legitimate resume of a later step).
 *
 *   B. AMBIGUOUS IN-FLIGHT ATTEMPT — the provider request was dispatched, the
 *      step then crashed/timed out before any durable post-provider
 *      transition, so the row still reads `verified`. A stage fence cannot
 *      see this. Fenced by a durable, never-expiring dispatch claim
 *      (`payment_workflow_owner_intents.provider_dispatched_at`, CAS on NULL)
 *      taken before the provider call. A retry/restart that finds the claim
 *      already taken must NOT redispatch: it ends the run as an unsettled
 *      provider failure (buyer never charged).
 *
 * No SITEBORNE provider (Modal document worker, Modal webctx safe-egress,
 * public HTTP evidence sources) accepts an idempotency key or supports
 * lookup of a prior request, so exactly-once provider spend is not provable.
 * The achievable bound, asserted here, is: at most ONE provider dispatch per
 * logical operation (payment_identifier), across step retries, crashes,
 * restarts and whole-instance replays.
 */
import { describe, expect, it, vi } from 'vitest';
import { runPaidContinuationWorkflow } from '../src/control-plane/workflows/paid-continuation-workflow';
import { FakeWorkflowStep } from './support/fake-workflow-step';
import {
  TEST_JOB_ID,
  TEST_PAYMENT_IDENTIFIER,
  buildSuccessfulExecutorOutcome,
  buildTestDependencies,
  buildTestMetadata,
  sealTestInput,
} from './support/paid-continuation-workflow-fixtures';

async function setup(overrides: Parameters<typeof buildTestDependencies>[0] = {}) {
  const metadata = buildTestMetadata();
  const deps = await buildTestDependencies(overrides);
  const input = await sealTestInput(metadata, { key: deps.envelopeKey });
  return { metadata, deps, input };
}

/** Simulates an isolate crash: the named step's callback runs (or not, for
 * `before`), its result is never memoized, and NO orchestration code after
 * it ever runs — not even a catch block. The abandoned run is never awaited;
 * the engine re-enters on a fresh step later. */
class CrashingStep extends FakeWorkflowStep {
  readonly crashed: Promise<void>;
  private signalCrash!: () => void;
  constructor(
    private readonly crashAt: string,
    private readonly when: 'before' | 'after' = 'after'
  ) {
    super();
    this.crashed = new Promise((r) => (this.signalCrash = r));
  }
  override async do<T>(
    name: string,
    config: Parameters<FakeWorkflowStep['do']>[1],
    callback: () => Promise<T>
  ): Promise<T> {
    if (name !== this.crashAt) return super.do(name, config, callback);
    this.calls.push({ name, config });
    if (this.when === 'after') await callback(); // the provider really ran...
    this.signalCrash();
    return new Promise<T>(() => undefined); // ...and the isolate died here.
  }
}

async function crashRun(
  input: Awaited<ReturnType<typeof setup>>['input'],
  deps: Awaited<ReturnType<typeof buildTestDependencies>>,
  step: CrashingStep
): Promise<void> {
  void runPaidContinuationWorkflow({ payload: input }, step, deps);
  await step.crashed;
}

const stage = (deps: Awaited<ReturnType<typeof buildTestDependencies>>) =>
  deps.settlementRepository.rows.get(TEST_PAYMENT_IDENTIFIER)?.lifecycleStage;

describe('A3-41 race A: post-completion / whole-instance replay', () => {
  it('1. whole-instance replay after settlement never invokes the provider again', async () => {
    const { deps, input } = await setup();
    await runPaidContinuationWorkflow({ payload: input }, new FakeWorkflowStep(), deps);
    expect(stage(deps)).toBe('settled');

    const replay = await runPaidContinuationWorkflow(
      { payload: input },
      new FakeWorkflowStep(),
      deps
    );

    expect(deps.executor).toHaveBeenCalledTimes(1);
    expect(deps.settle).toHaveBeenCalledTimes(1);
    expect(replay.status).toBe('workflow_internal_error');
    expect(replay.error_code).toBe('provider_replay_fenced:settled');
  });

  it('2. manual restart after settlement is fenced without mutating any durable state', async () => {
    const { deps, input } = await setup();
    await runPaidContinuationWorkflow({ payload: input }, new FakeWorkflowStep(), deps);
    const rowBefore = structuredClone(deps.settlementRepository.rows.get(TEST_PAYMENT_IDENTIFIER));
    const resultBefore = deps.resultReceiptPersistence.results.get(TEST_JOB_ID);
    const failuresBefore = deps.finalizationPersistence.providerFailures.length;

    await runPaidContinuationWorkflow({ payload: input }, new FakeWorkflowStep(), deps);

    expect(deps.settlementRepository.rows.get(TEST_PAYMENT_IDENTIFIER)).toEqual(rowBefore);
    expect(deps.resultReceiptPersistence.results.get(TEST_JOB_ID)).toBe(resultBefore);
    expect(deps.finalizationPersistence.providerFailures.length).toBe(failuresBefore);
  });

  it('stage fence alone is PARTIAL: it cannot see an in-flight attempt (row still verified)', async () => {
    const { deps, input } = await setup();
    await crashRun(input, deps, new CrashingStep('invoke-executor'));
    // The one durable fact the stage fence reads has not moved:
    expect(stage(deps)).toBe('verified');
  });
});

describe('A3-PROVIDER-AMBIGUITY-1 race B: ambiguous in-flight provider attempt', () => {
  it('3. crash BEFORE provider dispatch: the restart is the first and only dispatch', async () => {
    const { deps, input } = await setup();
    // Crash entering invoke-executor, before its callback: nothing claimed,
    // nothing dispatched.
    await crashRun(input, deps, new CrashingStep('invoke-executor', 'before'));
    expect(deps.executor).not.toHaveBeenCalled();
    expect(deps.providerDispatch.claims.size).toBe(0);

    const result = await runPaidContinuationWorkflow(
      { payload: input },
      new FakeWorkflowStep(),
      deps
    );
    expect(result.status).toBe('settled');
    expect(deps.executor).toHaveBeenCalledTimes(1);
  });

  it('4. crash AFTER provider dispatch, before durable completion: the restart never redispatches', async () => {
    const { deps, input } = await setup();
    await crashRun(input, deps, new CrashingStep('invoke-executor'));
    // FIRST_PROVIDER_CALL_OCCURRED / DURABLE_EXECUTION_COMPLETION_NOT_RECORDED
    expect(deps.executor).toHaveBeenCalledTimes(1);
    expect(stage(deps)).toBe('verified');

    const restart = await runPaidContinuationWorkflow(
      { payload: input },
      new FakeWorkflowStep(),
      deps
    );

    // SECOND_PROVIDER_CALL_OCCURRED must be NO:
    expect(deps.executor).toHaveBeenCalledTimes(1);
    expect(restart.status).toBe('executor_timeout');
    expect(restart.error_code).toContain('provider_attempt_ambiguous');
    expect(deps.settle).not.toHaveBeenCalled(); // buyer never charged
    expect(stage(deps)).toBe('verified');
    expect(deps.finalizationPersistence.providerFailures).toHaveLength(1);
  });

  it('5 + 6 + 8. timeout while the provider may still run: no automatic same-attempt retry, late success discarded', async () => {
    let resolveLate!: (v: unknown) => void;
    const late = new Promise((r) => (resolveLate = r));
    const executor = vi.fn(async () => {
      await late; // provider still running when the step deadline fires
      return buildSuccessfulExecutorOutcome();
    });
    const { deps, input } = await setup({ executor });
    const step = new FakeWorkflowStep();
    const timeoutStep = Object.assign(Object.create(step) as FakeWorkflowStep, {
      async do<T>(
        name: string,
        config: Parameters<FakeWorkflowStep['do']>[1],
        cb: () => Promise<T>
      ) {
        if (name !== 'invoke-executor') return step.do(name, config, cb);
        step.calls.push({ name, config });
        void cb(); // dispatched; the engine abandons it at the deadline
        // retries.limit is the ENGINE's retry count; honour it here.
        for (let attempt = 0; attempt < (config.retries?.limit ?? 0); attempt++) {
          await cb().catch(() => undefined);
        }
        throw new Error('invoke-executor step exceeded its declared 40 second timeout');
      },
    });

    const result = await runPaidContinuationWorkflow({ payload: input }, timeoutStep, deps);
    resolveLate(undefined); // the first attempt succeeds late

    expect(step.calls.find((c) => c.name === 'invoke-executor')?.config.retries?.limit).toBe(0);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('executor_timeout');
    expect(deps.settle).not.toHaveBeenCalled();
    expect(deps.resultReceiptPersistence.results.size).toBe(0);
  });

  it('7. provider failover inside one executor does not bypass the single dispatch claim', async () => {
    // Failover lives inside the executor (one logical effect); the claim is
    // per payment_identifier, so a failing primary + a restart can still
    // produce at most one executor dispatch.
    const executor = vi.fn(async () => {
      throw new Error('primary_provider_unavailable');
    });
    const { deps, input } = await setup({ executor });
    const first = await runPaidContinuationWorkflow(
      { payload: input },
      new FakeWorkflowStep(),
      deps
    );
    const restart = await runPaidContinuationWorkflow(
      { payload: input },
      new FakeWorkflowStep(),
      deps
    );

    expect(first.status).toBe('executor_timeout');
    expect(restart.status).toBe('executor_timeout');
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('a whole-instance replay after a terminal provider failure (row still verified) is also not redispatched', async () => {
    const executor = vi.fn(async () =>
      buildSuccessfulExecutorOutcome({ result_class: 'failed' as never })
    );
    const { deps, input } = await setup({ executor });
    const first = await runPaidContinuationWorkflow(
      { payload: input },
      new FakeWorkflowStep(),
      deps
    );
    expect(first.status).toBe('executor_rejected');
    expect(stage(deps)).toBe('verified');

    await runPaidContinuationWorkflow({ payload: input }, new FakeWorkflowStep(), deps);

    expect(executor).toHaveBeenCalledTimes(1);
    expect(deps.settle).not.toHaveBeenCalled();
  });
});

describe('A3-41 isolation and single-owner regressions', () => {
  it('9. an unrelated payment is unaffected by another payment’s dispatch claim', async () => {
    const { deps, input } = await setup();
    deps.providerDispatch.claims.add('pay_unrelated_0002');
    const result = await runPaidContinuationWorkflow(
      { payload: input },
      new FakeWorkflowStep(),
      deps
    );
    expect(result.status).toBe('settled');
    expect(deps.executor).toHaveBeenCalledTimes(1);
  });

  it('10 + 11. settlement and result release stay single-owner across crash, restart and replay', async () => {
    const { deps, input } = await setup();
    await runPaidContinuationWorkflow({ payload: input }, new FakeWorkflowStep(), deps);
    const released = deps.resultReceiptPersistence.results.get(TEST_JOB_ID);
    await runPaidContinuationWorkflow({ payload: input }, new FakeWorkflowStep(), deps);
    await runPaidContinuationWorkflow({ payload: input }, new FakeWorkflowStep(), deps);

    expect(deps.settle).toHaveBeenCalledTimes(1);
    expect(deps.resultReceiptPersistence.results.get(TEST_JOB_ID)).toBe(released);
    expect(deps.executor).toHaveBeenCalledTimes(1);
  });

  it('the dispatch claim is keyed by the canonical payment_identifier, never a per-attempt random id', async () => {
    const { deps, input } = await setup();
    await runPaidContinuationWorkflow({ payload: input }, new FakeWorkflowStep(), deps);
    expect([...deps.providerDispatch.claims]).toEqual([TEST_PAYMENT_IDENTIFIER]);
  });
});

describe('A3-41 authority boundaries: only `verified` authorizes a provider dispatch', () => {
  const NON_DISPATCH_STAGES = [
    'acquired',
    'verification_failed',
    'executed',
    'settlement_pending',
    'settled_external',
    'link_verified',
    'settled',
    'settlement_failed',
  ] as const;

  for (const lifecycleStage of NON_DISPATCH_STAGES) {
    it(`a memo-less run at \`${lifecycleStage}\` never reaches the provider, the claim, or settlement`, async () => {
      const { deps, input } = await setup({ seedSettlement: { lifecycleStage } });
      const result = await runPaidContinuationWorkflow(
        { payload: input },
        new FakeWorkflowStep(),
        deps
      );

      expect(result.status).toBe('workflow_internal_error');
      expect(result.error_code).toBe(`provider_replay_fenced:${lifecycleStage}`);
      expect(deps.executor).not.toHaveBeenCalled();
      expect(deps.providerDispatch.claims.size).toBe(0);
      expect(deps.settle).not.toHaveBeenCalled();
      expect(stage(deps)).toBe(lifecycleStage);
      expect(deps.finalizationPersistence.providerFailures).toHaveLength(0);
    });
  }
});

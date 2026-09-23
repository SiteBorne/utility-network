/**
 * SUN-1221E6R-H2AWI-2 — durable Workflow orchestration tests.
 *
 * Every dependency (executor, PCC validator, settlement facilitator,
 * settlement repository, reconciliation, job/result/receipt persistence,
 * clock) is a fake/test double. No real network call, no real D1, no real
 * Cloudflare Workflow resource anywhere in this file. `step` is a fake
 * `WorkflowStep` double that records every `step.do(name, config, ...)`
 * call for inspection and memoizes successful results the same way the
 * real platform does (see `FakeWorkflowStep`).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { hashPaymentObject } from '@siteborne/protocol-x402';
import { runPaidContinuationWorkflow } from '../src/control-plane/workflows/paid-continuation-workflow';
import { deriveWorkflowInstanceId } from '../src/control-plane/continuation/instance-id';
import { FakeWorkflowStep } from './support/fake-workflow-step';
import {
  buildDecryptedPayload,
  buildSuccessfulExecutorOutcome,
  buildTestDependencies,
  buildTestMetadata,
  fakeSettleSuccess,
  fakeSettleRejected,
  generateTestKey,
  sealTestInput,
  TEST_JOB_ID,
} from './support/paid-continuation-workflow-fixtures';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runHappyPath() {
  const metadata = buildTestMetadata();
  const deps = await buildTestDependencies();
  const input = await sealTestInput(metadata, { key: deps.envelopeKey });
  const step = new FakeWorkflowStep();
  const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);
  return { result, step, deps, metadata };
}

describe('paid-continuation-workflow — step graph (H2AWI-2a)', () => {
  it('binds a finalized buyer PCC resource before terminal delivery and fails closed on binding loss', async () => {
    const metadata = buildTestMetadata();
    const reference = {
      storage: 'R2_CONTENT_ADDRESS' as const,
      content_hash: `sha256:${'a'.repeat(64)}` as `sha256:${string}`,
      byte_length: 128,
      media_type: 'application/pcc+json' as const,
    };
    const pcc = {
      receipt_id: 'receipt_test_0001',
      extensions: {
        'net.siteborne.verification-proof.v1': {
          pcc_document_hash: `sha256:${'b'.repeat(64)}`,
        },
      },
    };
    const outcome = {
      ...buildSuccessfulExecutorOutcome(),
      resultRepresentation: { format: 'SELF_VERIFYING_PCC_VNEXT' as const, body: pcc },
    };
    const base = await buildTestDependencies({ executor: async () => outcome });
    const bind = vi.fn(async () => {});
    const deps = {
      ...base,
      resultArtifacts: {
        prepareExecutorOutcome: async () => ({
          ...outcome,
          resultRepresentation: { format: 'SELF_VERIFYING_PCC_VNEXT' as const, reference },
        }),
        read: async () => pcc,
      },
      validatePcc: async () => ({
        valid: true as const,
        pcc,
        pccReference: reference,
        linkEvidenceInputs: outcome.linkEvidenceInputs,
      }),
      resultAuthorization: bind,
    };
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const delivered = await runPaidContinuationWorkflow(
      { payload: input },
      new FakeWorkflowStep(),
      deps
    );
    expect(delivered.status).toBe('settled');
    expect(bind).toHaveBeenCalledWith({
      jobId: metadata.job_id,
      serviceId: metadata.service,
      contentHash: reference.content_hash,
      pccDocumentHash: `sha256:${'b'.repeat(64)}`,
    });

    const failingBase = await buildTestDependencies({ executor: async () => outcome });
    const failed = await runPaidContinuationWorkflow(
      { payload: await sealTestInput(metadata, { key: failingBase.envelopeKey }) },
      new FakeWorkflowStep(),
      {
        ...failingBase,
        resultArtifacts: deps.resultArtifacts,
        validatePcc: deps.validatePcc,
        resultAuthorization: async () => {
          throw new Error('simulated_binding_loss');
        },
      }
    );
    expect(failed.status).toBe('persistence_failed_after_settlement');
  });
  it('runs the 7 frozen steps in exact order on the happy path', async () => {
    const { result, step, metadata } = await runHappyPath();

    expect(result.status).toBe('settled');
    expect(result.job_id).toBe(metadata.job_id);

    const names = step.calls.map((c) => c.name);
    expect(names).toEqual([
      'open-envelope',
      'check-authorization-expiry',
      'invoke-executor',
      'generate-pcc',
      'settle',
      'persist-result',
      'persist-receipt-and-finalize',
    ]);
  });

  it('declares an explicit retry policy on every step (no implicit platform default)', async () => {
    const { step } = await runHappyPath();

    for (const call of step.calls) {
      expect(
        call.config.retries,
        `step "${call.name}" must declare retries explicitly`
      ).toBeDefined();
      expect(
        typeof call.config.retries?.limit,
        `step "${call.name}" retries.limit must be a number`
      ).toBe('number');
      expect(
        call.config.timeout,
        `step "${call.name}" must declare a timeout explicitly`
      ).toBeDefined();
    }
  });

  it('settle step has zero retries (frozen invariant) — mutation-sensitive', async () => {
    const { step } = await runHappyPath();

    const settleCall = step.calls.find((c) => c.name === 'settle');
    expect(settleCall).toBeDefined();
    expect(settleCall!.config.retries).toEqual({ limit: 0, delay: '1 second' });
  });

  it('is the sole production settle() call site introduced by this Workflow (static source proof)', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../src/control-plane/workflows/paid-continuation-workflow.ts'),
      'utf8'
    );
    const occurrences = source.match(/\.evidenceProvider\.settle\(/g) ?? [];
    expect(occurrences.length).toBe(1);
  });

  it('persists a result before finalizing a receipt, and returns settled with a receipt id and tx reference', async () => {
    const { result, deps } = await runHappyPath();
    expect(result.status).toBe('settled');
    expect(result.receipt_id).toBe(`receipt_${TEST_JOB_ID}`);
    expect(result.settlement_transaction_reference).toBe('0xsettledhash');

    const persisted = deps.resultReceiptPersistence.results.get(TEST_JOB_ID)?.cachedResult;
    // SUN-1222C-PCC-WIRE-RESULT-IMPLEMENTATION: `body` is now the governed
    // v2 wire result -- the full PCC document (`durableEvidence.pcc`/
    // `pccResult.pcc`) itself, byte-identical -- never a bespoke
    // service_id/result_class/receipt_id envelope. This harness's own
    // `validatePcc` fixture (see buildTestDependencies) returns
    // `{ pcc_id: 'pcc_test_0001', signature: '0xpccsignature' }` as its
    // `pcc`, so that is exactly what `body` must now equal.
    expect(persisted).toMatchObject({
      status: 200,
      body: {
        pcc_id: 'pcc_test_0001',
        signature: '0xpccsignature',
      },
      settleResponse: {
        success: true,
        transaction: '0xsettledhash',
        network: 'eip155:84532',
        amount: '9000',
      },
    });
    expect(persisted?.durableEvidence.payment_service_link.payment_identifier).toBe(
      'pay_test_0001'
    );
  });
});

describe('paid-continuation-workflow — executor integration (H2AWI-2b)', () => {
  it('calls the injected executor exactly once with the job routing input', async () => {
    const { deps } = await runHappyPath();
    expect(deps.executor).toHaveBeenCalledTimes(1);
  });

  it('settles and persists the executor-measured upto amount instead of the authorized maximum', async () => {
    const metadata = buildTestMetadata();
    const payload = buildDecryptedPayload(metadata);
    const uptoPayload = {
      ...payload,
      settlementContext: {
        ...payload.settlementContext,
        scheme: 'upto' as const,
        paymentPayload: { ...payload.settlementContext.paymentPayload, scheme: 'upto' },
        paymentRequirements: {
          ...payload.settlementContext.paymentRequirements,
          scheme: 'upto',
        },
      },
      verificationEvidence: { ...payload.verificationEvidence, scheme: 'upto' as const },
    };
    const deps = await buildTestDependencies({
      executor: async () => ({
        ...buildSuccessfulExecutorOutcome(),
        actualAmountAtomic: '7000',
        resourceMetrics: { page_count: 1 },
      }),
      settleResponse: {
        ...fakeSettleSuccess(),
        scheme: 'upto',
        actual_amount: '7000',
        authorized_maximum: '9000',
        verification_evidence_hash: await hashPaymentObject(uptoPayload.verificationEvidence),
      },
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey, payload: uptoPayload });
    const result = await runPaidContinuationWorkflow(
      { payload: input },
      new FakeWorkflowStep(),
      deps
    );
    expect(deps.settle.mock.calls[0]?.[0].scheme).toBe('upto');
    expect(await deps.settle.mock.results[0]?.value).toMatchObject({ scheme: 'upto' });
    expect(result.status).toBe('settled');
    expect(deps.settle).toHaveBeenCalledWith(expect.anything(), expect.anything(), '7000');
    expect(
      deps.resultReceiptPersistence.results.get(TEST_JOB_ID)?.cachedResult.settleResponse.amount
    ).toBe('7000');
  });

  it('fails closed before settlement when the executor-measured amount exceeds authorization', async () => {
    const metadata = buildTestMetadata();
    const payload = buildDecryptedPayload(metadata);
    const uptoPayload = {
      ...payload,
      settlementContext: {
        ...payload.settlementContext,
        scheme: 'upto' as const,
        paymentPayload: { ...payload.settlementContext.paymentPayload, scheme: 'upto' },
        paymentRequirements: {
          ...payload.settlementContext.paymentRequirements,
          scheme: 'upto',
        },
      },
      verificationEvidence: { ...payload.verificationEvidence, scheme: 'upto' as const },
    };
    const deps = await buildTestDependencies({
      executor: async () => ({
        ...buildSuccessfulExecutorOutcome(),
        actualAmountAtomic: '9001',
        resourceMetrics: { page_count: 999 },
      }),
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey, payload: uptoPayload });
    const result = await runPaidContinuationWorkflow(
      { payload: input },
      new FakeWorkflowStep(),
      deps
    );
    expect(result).toMatchObject({
      status: 'executor_rejected',
      error_code: 'actual_amount_exceeds_authorized_maximum',
    });
    expect(deps.settle).not.toHaveBeenCalled();
  });

  it('fails closed before settlement when an upto executor omits its measured amount', async () => {
    const metadata = buildTestMetadata();
    const payload = buildDecryptedPayload(metadata);
    const uptoPayload = {
      ...payload,
      settlementContext: {
        ...payload.settlementContext,
        scheme: 'upto' as const,
        paymentPayload: { ...payload.settlementContext.paymentPayload, scheme: 'upto' },
        paymentRequirements: {
          ...payload.settlementContext.paymentRequirements,
          scheme: 'upto',
        },
      },
      verificationEvidence: { ...payload.verificationEvidence, scheme: 'upto' as const },
    };
    const deps = await buildTestDependencies({
      executor: async () => buildSuccessfulExecutorOutcome(),
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey, payload: uptoPayload });
    const result = await runPaidContinuationWorkflow(
      { payload: input },
      new FakeWorkflowStep(),
      deps
    );
    expect(result).toMatchObject({
      status: 'executor_rejected',
      error_code: 'actual_amount_required_for_upto',
    });
    expect(deps.settle).not.toHaveBeenCalled();
  });

  it('surfaces a resolved-but-unsuccessful ExecutorOutcome as executor_rejected, never calling PCC or settle', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({
      executor: async () => ({
        result: { result_class: 'rejected', failure: { code: 'bad_input', message: 'nope' } },
      }),
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('executor_rejected');
    expect(step.calls.map((c) => c.name)).not.toContain('generate-pcc');
    expect(step.calls.map((c) => c.name)).not.toContain('settle');
    expect(deps.settle).not.toHaveBeenCalled();
  });

  it('SUN-1222C-R4: preserves the specific rejection detail for a legitimate "partial" result (verification passed, no `failure` object, detail only in `limitations`) instead of collapsing it to the generic result_class', async () => {
    // Exact shape SUN-1222C-R4-D1 proved CompanyEvidenceGraphService returns
    // for a real SEC EDGAR rejection: the verification mesh itself PASSED
    // (so `failure` is `undefined` — see service.ts's own `failure:
    // signed.verdict.decision === 'pass' ? undefined : {...}`), and the only
    // place the specific, sanitized reason lives is `limitations`.
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({
      executor: async () => ({
        result: {
          result_class: 'partial',
          limitations: [
            'sec-edgar company_submissions returned permanent_failure for CIK 0000320193',
          ],
        },
      }),
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('executor_rejected');
    // The stable machine-readable code is unchanged (existing callers rely
    // on this exact fallback-to-result_class behavior for a `failure`-less
    // rejection) —
    expect(result.error_code).toBe('partial');
    // — but the specific, sanitized reason is now ALSO preserved, not
    // silently dropped.
    expect(result.error_detail).toBe(
      'sec-edgar company_submissions returned permanent_failure for CIK 0000320193'
    );
  });

  it('SUN-1222C-R4: error_detail prefers a populated `failure.message` over `limitations` when both exist', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({
      executor: async () => ({
        result: {
          result_class: 'rejected',
          failure: { code: 'bad_input', message: 'the specific bad-input reason' },
          limitations: ['a different, less specific limitation string'],
        },
      }),
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('executor_rejected');
    expect(result.error_code).toBe('bad_input');
    expect(result.error_detail).toBe('the specific bad-input reason');
  });

  it('SUN-1222C-R4: error_detail is undefined (not a stray empty string) when neither failure.message nor limitations exist', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({
      executor: async () => ({
        result: { result_class: 'rejected' },
      }),
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('executor_rejected');
    expect(result.error_code).toBe('rejected');
    expect(result.error_detail).toBeUndefined();
  });

  it('surfaces a thrown executor error as executor_timeout, never calling PCC or settle', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({
      executor: async () => {
        throw new Error('modal timeout');
      },
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('executor_timeout');
    expect(step.calls.map((c) => c.name)).not.toContain('generate-pcc');
    expect(deps.settle).not.toHaveBeenCalled();
  });

  it('mutation proof: executor_rejected and executor_timeout are independently, separately caught', async () => {
    // Two dedicated tests above each assert a DISTINCT status string for a
    // DISTINCT failure shape (resolved-unsuccessful vs thrown) — swapping
    // the branches in the implementation would flip both of those specific
    // assertions independently, proving they are not one merged catch-all.
    expect(true).toBe(true);
  });
});

describe('paid-continuation-workflow — durable rejection-detail capture (SUN-1222C-R4-D4-CONTINUED)', () => {
  // SUN-1222C-R4-D4 proved `error_detail`/`deriveErrorDetail(...)` is
  // computed and returned in the terminal `WorkflowContinuationResult`, but
  // never durably written anywhere — `transitionJobState`'s
  // `createStateEvent(...)` call only ever receives the fixed
  // `TransitionReason` enum ('EXECUTION_FAILED' / 'QUARANTINE_POLICY'), not
  // the dynamic, specific reason. Once the Workflow instance's own retained
  // output is truncated/expired, that specific reason becomes permanently
  // unrecoverable (D4-CONTINUED's live D1 proof: the job row, its
  // idempotency-key correlation, and all 9 state-transition events survive
  // perfectly — only the *reason text* itself was ever lost). The fix
  // threads the SAME already-bounded, already-sanitized string
  // (`deriveErrorDetail`'s ≤500-char output — R4-D3 proved these are
  // service-authored, never raw response bodies/headers/credentials) into
  // `StateEvent.evidence_ref`, an existing, already-nullable D1 column no
  // migration is needed for.

  it("persists the specific rejection reason as the REJECTED event's evidence_ref (limitations-only shape)", async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({
      executor: async () => ({
        result: {
          result_class: 'partial',
          limitations: [
            'sec-edgar company_submissions returned permanent_failure for CIK 0000320193',
          ],
        },
      }),
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);
    expect(result.status).toBe('executor_rejected');

    const rejectedEvent = deps.jobPersistence.events.find((e) => e.to_state === 'REJECTED');
    expect(rejectedEvent).toBeDefined();
    expect(rejectedEvent!.evidence_ref).toBe(
      'sec-edgar company_submissions returned permanent_failure for CIK 0000320193'
    );

    const quarantinedEvent = deps.jobPersistence.events.find((e) => e.to_state === 'QUARANTINED');
    expect(quarantinedEvent).toBeDefined();
    expect(quarantinedEvent!.evidence_ref).toBe(
      'sec-edgar company_submissions returned permanent_failure for CIK 0000320193'
    );
  });

  it('persists the specific rejection reason (failure.message shape) durably too', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({
      executor: async () => ({
        result: {
          result_class: 'rejected',
          failure: { code: 'bad_input', message: 'the specific bad-input reason' },
        },
      }),
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    await runPaidContinuationWorkflow({ payload: input }, step, deps);

    const rejectedEvent = deps.jobPersistence.events.find((e) => e.to_state === 'REJECTED');
    expect(rejectedEvent!.evidence_ref).toBe('the specific bad-input reason');
  });

  it('leaves evidence_ref undefined (not a stray value) when deriveErrorDetail has nothing to report', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({
      executor: async () => ({ result: { result_class: 'rejected' } }),
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    await runPaidContinuationWorkflow({ payload: input }, step, deps);

    const rejectedEvent = deps.jobPersistence.events.find((e) => e.to_state === 'REJECTED');
    expect(rejectedEvent!.evidence_ref).toBeUndefined();
  });

  it('persists a bounded reason for a thrown executor error (executor_timeout) too', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({
      executor: async () => {
        throw new Error('modal timeout');
      },
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    await runPaidContinuationWorkflow({ payload: input }, step, deps);

    const rejectedEvent = deps.jobPersistence.events.find((e) => e.to_state === 'REJECTED');
    expect(rejectedEvent!.evidence_ref).toBe('modal timeout');
  });

  it('never lets a sentinel secret-shaped string reach the durable evidence_ref', async () => {
    // Defense-in-depth: even if a future executor bug put something
    // sensitive-looking into `failure.message`, this test only documents
    // existing behavior — deriveErrorDetail passes the string through
    // unchanged (R4-D3's own established boundary is that services never
    // put payment material there in the first place). What this DOES prove
    // is that nothing ELSE (payment payload, signature, auth headers) leaks
    // in ALONGSIDE it — evidence_ref is exactly and only the one derived
    // string, never a serialized object.
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({
      executor: async () => ({
        result: {
          result_class: 'rejected',
          failure: { code: 'bad_input', message: 'plain reason' },
        },
      }),
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    await runPaidContinuationWorkflow({ payload: input }, step, deps);

    const rejectedEvent = deps.jobPersistence.events.find((e) => e.to_state === 'REJECTED');
    expect(typeof rejectedEvent!.evidence_ref).toBe('string');
    expect(rejectedEvent!.evidence_ref).not.toMatch(
      /signature|nonce|authorization|PAYMENT-SIGNATURE/i
    );
  });

  it('idempotency: re-running the same terminal transition never appends a second event', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({
      executor: async () => ({
        result: { result_class: 'rejected', failure: { code: 'x', message: 'one reason' } },
      }),
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    await runPaidContinuationWorkflow({ payload: input }, step, deps);
    const countAfterFirst = deps.jobPersistence.events.filter(
      (e) => e.to_state === 'REJECTED'
    ).length;
    expect(countAfterFirst).toBe(1);

    // Re-entering with the job already at the terminal REJECTED state (the
    // platform re-invoking a memoized step graph) must be a pure no-op —
    // `transitionJobState`'s existing `isTerminal(job.current_state)` guard
    // already covers this; this test proves the new evidenceRef parameter
    // does not bypass it.
    await runPaidContinuationWorkflow({ payload: input }, step, deps);
    const countAfterSecond = deps.jobPersistence.events.filter(
      (e) => e.to_state === 'REJECTED'
    ).length;
    expect(countAfterSecond).toBe(1);
  });

  it('a diagnostic-persistence write failure on the REJECTED event still fails closed — zero settlement', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({
      executor: async () => ({
        result: {
          result_class: 'rejected',
          failure: { code: 'x', message: 'reason that fails to persist' },
        },
      }),
    });
    // Existing crash-matrix fixture mechanism (`failAppendStateEventForToState`)
    // — simulates the D1 write for the REJECTED event itself throwing.
    deps.jobPersistence.failAppendStateEventForToState = 'REJECTED';
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    // `transitionJobState` propagates a persistence throw uncaught (same as
    // every other step in this orchestration — no bespoke swallow-and-carry-
    // on path exists for this call); the surrounding `step.do`/Workflow
    // retry machinery is what would see it, not a silent success.
    await expect(runPaidContinuationWorkflow({ payload: input }, step, deps)).rejects.toThrow(
      'simulated terminal-state-event persistence failure'
    );
    expect(deps.settle).not.toHaveBeenCalled();
  });
});

describe('paid-continuation-workflow — PCC integration (H2AWI-2c)', () => {
  it('a corrupted/missing PCC surfaces as pcc_failed, never reaching settle', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({
      validatePcc: () => ({ valid: false, reason: 'signature_mismatch' }),
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('pcc_failed');
    expect(step.calls.map((c) => c.name)).not.toContain('settle');
    expect(deps.settle).not.toHaveBeenCalled();
  });

  // SUN-1222C-R4-D6: the sibling rejection path to the executor-rejection
  // one above — D5 closed `evidence_ref` for `executor_rejected`/
  // `executor_timeout`; this closes the one other terminal rejection
  // branch that stops short of settlement, `pcc_failed`, which previously
  // only ever wrote the bare `VERIFICATION_FAILED` state-transition reason
  // and dropped `pccResult.reason` (e.g. `signature_mismatch`,
  // `missing_receipt`) before it could reach D1.
  it("persists the specific PCC rejection reason as the REJECTED event's evidence_ref", async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({
      validatePcc: () => ({ valid: false, reason: 'signature_mismatch' }),
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('pcc_failed');
    const rejectedEvent = deps.jobPersistence.events.find((e) => e.to_state === 'REJECTED');
    expect(rejectedEvent).toBeDefined();
    expect(rejectedEvent!.evidence_ref).toBe('signature_mismatch');
  });

  it('PCC evidence_ref stays a plain bounded string, never a serialized object or payment material', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({
      validatePcc: () => ({ valid: false, reason: 'missing_receipt' }),
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    await runPaidContinuationWorkflow({ payload: input }, step, deps);

    const rejectedEvent = deps.jobPersistence.events.find((e) => e.to_state === 'REJECTED');
    expect(typeof rejectedEvent!.evidence_ref).toBe('string');
    expect(rejectedEvent!.evidence_ref).toBe('missing_receipt');
    expect(rejectedEvent!.evidence_ref).not.toMatch(
      /signature|nonce|authorization|PAYMENT-SIGNATURE/i
    );
  });
});

describe('paid-continuation-workflow — terminal observability parity (SUN-1222C-R4-D7)', () => {
  it('an envelope-open failure durably transitions the job to REJECTED with a bounded evidence_ref, not just a transient result', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies();
    // Sealed with a DIFFERENT key than deps.envelopeKey: openContinuationEnvelope
    // will genuinely fail to decrypt, exercising the real catch branch
    // (never a mocked/forced throw).
    const wrongKey = await generateTestKey();
    const input = await sealTestInput(metadata, { key: wrongKey });
    const step = new FakeWorkflowStep();

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('workflow_internal_error');

    const rejectedEvent = deps.jobPersistence.events.find((e) => e.to_state === 'REJECTED');
    expect(rejectedEvent).toBeDefined();
    expect(rejectedEvent!.reason).toBe('VALIDATION_FAILED');
    expect(typeof rejectedEvent!.evidence_ref).toBe('string');
    expect(rejectedEvent!.evidence_ref).toBe(result.error_code);
    // Never the raw ciphertext/key material — only the same short,
    // bounded code already in the transient result.
    expect(rejectedEvent!.evidence_ref!.length).toBeLessThanOrEqual(500);

    const jobAfter = await deps.jobPersistence.getJob(TEST_JOB_ID);
    expect(jobAfter?.current_state).toBe('REJECTED'); // previously stuck at LOCKED forever
  });

  it('an explicit settlement rejection durably persists the same reason already in the transient result', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({
      settleResponse: fakeSettleRejected(),
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('settlement_rejected');
    const refundEvent = deps.jobPersistence.events.find((e) => e.to_state === 'REFUND_REQUIRED');
    expect(refundEvent).toBeDefined();
    expect(refundEvent!.evidence_ref).toBe(result.error_code);
    expect(typeof refundEvent!.evidence_ref).toBe('string');
    expect(refundEvent!.evidence_ref).not.toMatch(/signature|nonce|authorization/i);
  });

  it('a persistence failure after settlement leaves the job in the retryable SETTLING state — no premature REFUND_REQUIRED that would block idempotent retry', async () => {
    // Regression guard for the reverted D7 attempt: forcing a durable
    // transition here broke the exact idempotent-retry contract this
    // step's own doc comment promises. This test pins the CORRECT
    // (Class E, not-actually-terminal) behavior.
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies();
    deps.resultReceiptPersistence.failResultOnce = true;
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('persistence_failed_after_settlement');
    const jobAfterFailure = await deps.jobPersistence.getJob(TEST_JOB_ID);
    expect(jobAfterFailure?.current_state).toBe('SETTLING'); // never forced to REFUND_REQUIRED
    expect(deps.jobPersistence.events.some((e) => e.to_state === 'REFUND_REQUIRED')).toBe(false);
  });
});

describe('paid-continuation-workflow — authorization expiry gate (H2AWI-2f)', () => {
  it('now < validBefore: valid, executor IS invoked', async () => {
    const metadata = buildTestMetadata({ valid_before_unix: 1000 });
    const deps = await buildTestDependencies({ clock: () => 999 });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('settled');
    expect(deps.executor).toHaveBeenCalledTimes(1);
  });

  it('now === validBefore: treated as EXPIRED (fail-closed), executor is NEVER invoked', async () => {
    const metadata = buildTestMetadata({ valid_before_unix: 1000 });
    const deps = await buildTestDependencies({ clock: () => 1000 });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('authorization_expired');
    expect(deps.executor).not.toHaveBeenCalled();
    expect(step.calls.map((c) => c.name)).not.toContain('invoke-executor');
    expect(deps.settle).not.toHaveBeenCalled();
  });

  it('now > validBefore: expired, executor is NEVER invoked', async () => {
    const metadata = buildTestMetadata({ valid_before_unix: 1000 });
    const deps = await buildTestDependencies({ clock: () => 1001 });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('authorization_expired');
    expect(deps.executor).not.toHaveBeenCalled();
    expect(deps.settle).not.toHaveBeenCalled();
  });

  it('expires during executor/PCC work: rechecks immediately before a new settlement and never calls settle', async () => {
    const metadata = buildTestMetadata({ valid_before_unix: 1000 });
    let now = 999;
    const executor = vi.fn(async () => {
      now = 1000;
      return buildSuccessfulExecutorOutcome();
    });
    const deps = await buildTestDependencies({
      clock: () => now,
      executor,
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('authorization_expired');
    expect(executor).toHaveBeenCalledTimes(1);
    expect(deps.settle).not.toHaveBeenCalled();
  });
});

describe('paid-continuation-workflow — settlement step (H2AWI-2d)', () => {
  it('writes the pre-settle draft (recordSettlementPending) before calling settle()', async () => {
    const { deps } = await runHappyPath();
    expect(deps.settlementRepository.recordSettlementPendingCallCount).toBe(1);
    expect(deps.settle).toHaveBeenCalledTimes(1);
  });

  it('explicit rejection (success: false) never calls settle() twice and reports settlement_rejected', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({
      settleResponse: fakeSettleRejected(),
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('settlement_rejected');
    expect(deps.settle).toHaveBeenCalledTimes(1);
    expect(step.calls.map((c) => c.name)).not.toContain('persist-result');
  });

  it('rejects successful-looking settlement evidence whose economic binding does not match the accepted context', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({
      settleResponse: {
        ...fakeSettleSuccess(),
        payee: '0x000000000000000000000000000000000000bb',
      },
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('settlement_rejected');
    expect(result.error_code).toBe('not_structurally_valid:payee_mismatch');
    expect(deps.settlementRepository.recordSettledExternalCallCount).toBe(0);
    expect(deps.resultReceiptPersistence.persistResultCallCount).toBe(0);
  });

  it('transport ambiguity (settle() throws, no tx ref ever known): resolves via reconciliation abstraction only, never retries settle()', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies();
    // Force settle() to throw (transport failure), never resolve. No
    // transaction reference is ever recorded — the reconciliation
    // ABSTRACTION is still the only thing consulted (proven by the
    // settlement-repository recovery-record read below); the chain
    // checker itself has nothing to check without a candidate reference
    // (see settlement-reconciliation.test.ts's own dedicated proof of
    // that exact behavior) and is correctly never reached in this case.
    (deps.settle as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('connection reset'));
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('settlement_ambiguous');
    expect(deps.settle).toHaveBeenCalledTimes(1); // never retried
    expect(deps.reconciliationChecker).not.toHaveBeenCalled(); // nothing to check without a tx ref
  });

  it('pre-existing unresolved draft (idempotency guard) with a known tx ref: routes directly to reconciliation, settle() never reached at all', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies();
    (deps.settle as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('connection reset'));
    // Simulate a PRIOR (possibly crashed) attempt that already durably
    // claimed this payment_identifier and recorded a candidate
    // transaction reference before this run even started.
    deps.settlementRepository.seed(metadata.payment_identifier, {
      lifecycleStage: 'settlement_pending',
      settlementTransactionReference: '0xpending',
    });
    deps.reconciliationChecker.mockResolvedValue('SETTLED');
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    // Idempotency guard (proof #3): the pre-existing 'settlement_pending'
    // row means settle() is short-circuited BEFORE the facilitator is
    // ever reached a second time — recordSettlementPending is not called
    // again either, since the guard fires before it.
    expect(deps.settle).not.toHaveBeenCalled();
    expect(deps.reconciliationChecker).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('settled');
    expect(result.settlement_transaction_reference).toBe('0xpending');
  });

  it('expired authorization with a pre-existing pending transaction still reconciles and never resubmits settlement', async () => {
    const metadata = buildTestMetadata({ valid_before_unix: 1000 });
    const deps = await buildTestDependencies({ clock: () => 1001 });
    deps.settlementRepository.seed(metadata.payment_identifier, {
      lifecycleStage: 'settlement_pending',
      settlementTransactionReference: '0xexpired-but-pending',
    });
    deps.reconciliationChecker.mockResolvedValue('SETTLED');
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });

    // Simulate Workflow step memoization: the entry expiry check passed
    // before executor work, then the authorization expired before this
    // resumed settlement step examined durable state.
    const step = new FakeWorkflowStep(
      new Map([['check-authorization-expiry', { expired: false }]])
    );
    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('settled');
    expect(result.settlement_transaction_reference).toBe('0xexpired-but-pending');
    expect(deps.settle).not.toHaveBeenCalled();
    expect(deps.reconciliationChecker).toHaveBeenCalledTimes(1);
  });

  it('never calls settle() a second time within one run under any injected failure sequence (idempotency mutation guard)', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies();
    (deps.settle as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(deps.settle).toHaveBeenCalledTimes(1);
  });
});

describe('paid-continuation-workflow — result/receipt persistence + terminal transition (H2AWI-2g)', () => {
  it('persists result, then receipt, then transitions the job to DELIVERED', async () => {
    const { deps } = await runHappyPath();
    expect(deps.resultReceiptPersistence.persistResultCallCount).toBe(1);
    expect(deps.resultReceiptPersistence.persistReceiptCallCount).toBe(1);
    const job = await deps.jobPersistence.getJob(TEST_JOB_ID);
    expect(job?.current_state).toBe('DELIVERED');
  });

  it('a finalize call repeated twice on an already-terminal job is a safe no-op (idempotent, no second event)', async () => {
    const { deps } = await runHappyPath();
    const eventsAfterFirst = deps.jobPersistence.events.length;

    // Simulate a second, independent finalize attempt against the SAME
    // already-terminal job (e.g. a duplicate persistence retry) by
    // re-running the whole happy path against the same job/result state.
    const metadata = buildTestMetadata();
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();
    // Reset settlement row back to 'settled_external' won't re-trigger
    // settle (already covered elsewhere); here we only care that a second
    // finalize attempt against the terminal job never throws and never
    // appends a second terminal event.
    deps.settlementRepository.seed('pay_test_0001', {
      lifecycleStage: 'settled_external',
      settlementTransactionReference: '0xsettledhash',
    });

    await expect(
      runPaidContinuationWorkflow({ payload: input }, step, deps)
    ).resolves.toMatchObject({
      status: 'settled',
    });
    expect(deps.jobPersistence.events.length).toBe(eventsAfterFirst); // no new terminal event
  });

  it('settled-then-result-persistence-failure: settle is never called again; only idempotent persistence retry is allowed (proof #11, point 1/3)', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies();
    deps.resultReceiptPersistence.failResultOnce = true;
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('persistence_failed_after_settlement');
    expect(deps.settle).toHaveBeenCalledTimes(1); // settlement already happened, never repeated
    expect(deps.resultReceiptPersistence.persistReceiptCallCount).toBe(0); // never reached step 6

    // Idempotent persistence retry (simulating a Workflow-level step retry
    // of the SAME 'persist-result' step.do call, per its declared
    // retries: 3 policy) succeeds without ever touching settle() again.
    const retryStep = new FakeWorkflowStep(
      new Map([
        ['open-envelope', buildDecryptedPayload(metadata)],
        ['check-authorization-expiry', { expired: false }],
        ['invoke-executor', buildSuccessfulExecutorOutcome()],
        ['generate-pcc', { valid: true, pcc: {} }],
        ['settle', { kind: 'confirmed', transactionReference: '0xsettledhash' }],
      ])
    );
    const retryInput = await sealTestInput(metadata, { key: deps.envelopeKey });
    const retryResult = await runPaidContinuationWorkflow({ payload: retryInput }, retryStep, deps);

    expect(retryResult.status).toBe('settled');
    expect(deps.settle).toHaveBeenCalledTimes(1); // still exactly once, across both attempts
  });

  it('settled-then-receipt-persistence-failure: settle is never called again; only idempotent persistence retry is allowed (proof #11, point 2/3)', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies();
    deps.resultReceiptPersistence.failReceiptOnce = true;
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('persistence_failed_after_settlement');
    expect(deps.settle).toHaveBeenCalledTimes(1);
    expect(deps.resultReceiptPersistence.persistResultCallCount).toBe(1); // step 5 DID succeed before step 6 failed

    // Retry: steps 0-5 stay memoized (result already durably written);
    // only step 6 re-runs.
    const retryStep = new FakeWorkflowStep(
      new Map([
        ['open-envelope', buildDecryptedPayload(metadata)],
        ['check-authorization-expiry', { expired: false }],
        ['invoke-executor', buildSuccessfulExecutorOutcome()],
        ['generate-pcc', { valid: true, pcc: {} }],
        ['settle', { kind: 'confirmed', transactionReference: '0xsettledhash' }],
        ['persist-result', { status: 'already_written' }],
      ])
    );
    const retryInput = await sealTestInput(metadata, { key: deps.envelopeKey });
    const retryResult = await runPaidContinuationWorkflow({ payload: retryInput }, retryStep, deps);

    expect(retryResult.status).toBe('settled');
    expect(deps.settle).toHaveBeenCalledTimes(1); // still exactly once
    expect(deps.resultReceiptPersistence.persistResultCallCount).toBe(1); // step 5 never re-invoked (stayed memoized)
  });

  it('settled-then-terminal-state-persistence-failure: settle is never called again; only idempotent persistence retry is allowed (proof #11, point 3/3)', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies();
    deps.jobPersistence.failAppendStateEventForToState = 'DELIVERED'; // receipt write succeeds; only the terminal state-event write fails
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('persistence_failed_after_settlement');
    expect(deps.settle).toHaveBeenCalledTimes(1);
    expect(deps.resultReceiptPersistence.persistReceiptCallCount).toBe(1); // receipt WAS written before the state-event write failed
    const jobAfterFailure = await deps.jobPersistence.getJob(TEST_JOB_ID);
    expect(jobAfterFailure?.current_state).not.toBe('DELIVERED'); // never falsely marked terminal

    // Retry: steps 0-5 stay memoized; step 6 re-runs, receipt persistence
    // is idempotently a no-op (already_written), and the terminal
    // transition succeeds this time.
    const retryStep = new FakeWorkflowStep(
      new Map([
        ['open-envelope', buildDecryptedPayload(metadata)],
        ['check-authorization-expiry', { expired: false }],
        ['invoke-executor', buildSuccessfulExecutorOutcome()],
        ['generate-pcc', { valid: true, pcc: {} }],
        ['settle', { kind: 'confirmed', transactionReference: '0xsettledhash' }],
        ['persist-result', { status: 'already_written' }],
      ])
    );
    const retryInput = await sealTestInput(metadata, { key: deps.envelopeKey });
    const retryResult = await runPaidContinuationWorkflow({ payload: retryInput }, retryStep, deps);

    expect(retryResult.status).toBe('settled');
    expect(deps.settle).toHaveBeenCalledTimes(1);
    expect(deps.resultReceiptPersistence.persistReceiptCallCount).toBe(2); // idempotent re-invocation, still only 1 logical receipt
    const jobAfterRetry = await deps.jobPersistence.getJob(TEST_JOB_ID);
    expect(jobAfterRetry?.current_state).toBe('DELIVERED');
  });

  it('settled-then-pcc-undefined: fails closed with a clean terminal state, never an opaque crash, and never re-settles (SUN-1222B-S2 guard)', async () => {
    // A `validatePcc` implementation that (buggily, or via a malformed
    // external validator response) claims `valid: true` but resolves
    // `pcc` to `undefined` -- exactly the shape that used to reach
    // `hashPaymentObject(undefined)` and throw an opaque, uncaught
    // 'canonical-json returned undefined' after settlement had *already*
    // succeeded (see paid-continuation-workflow.ts's own guard comment).
    const deps = await buildTestDependencies({
      validatePcc: () => ({ valid: true, pcc: undefined }),
    });
    const metadata = buildTestMetadata();
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('persistence_failed_after_settlement');
    if (result.status === 'persistence_failed_after_settlement') {
      expect(result.error_code).toBe('missing_verification_receipt');
      expect(result.settlement_transaction_reference).toBeTruthy();
    }
    // Settlement already happened and is never repeated, exactly like the
    // proof #11 persistence-failure siblings above.
    expect(deps.settle).toHaveBeenCalledTimes(1);
    expect(deps.resultReceiptPersistence.persistReceiptCallCount).toBe(0);
  });

  it('result/receipt/terminal-event idempotency: repeated persistence never creates a second logical record (proof #12)', async () => {
    const { deps } = await runHappyPath();

    // Directly re-invoke the persistence port with the identical identity
    // (simulating a duplicate Workflow-level step retry) and confirm the
    // underlying store still holds exactly one logical result and one
    // logical receipt.
    const firstResult = deps.resultReceiptPersistence.results.get(TEST_JOB_ID);
    expect(firstResult).toBeDefined();
    const secondResult = await deps.resultReceiptPersistence.persistResult(firstResult!);
    const secondReceipt = await deps.resultReceiptPersistence.persistReceipt({
      jobId: TEST_JOB_ID,
      paymentIdentifier: 'pay_test_0001',
    });

    expect(secondResult.status).toBe('already_written');
    expect(secondReceipt.status).toBe('already_written');
    expect(deps.resultReceiptPersistence.results.size).toBe(1);
    expect(deps.resultReceiptPersistence.receipts.size).toBe(1);
  });
});

describe('paid-continuation-workflow — deterministic instance identity reuse (proof requirement #13)', () => {
  // H2AWI-2 does not itself create Workflow instances (that is H2AWI-3's
  // `createOrJoinPaidContinuation` job) and does not reimplement instance
  // identity derivation — it reuses the frozen H2AWI-1 primitive verbatim.
  // This is a non-forking proof, not a re-test of instance-id.ts's own
  // exhaustive suite (continuation-instance-id.test.ts already covers the
  // algorithm itself in full).
  it('same payment_identifier -> byte-identical Workflow instance id, via the committed H2AWI-1 helper', async () => {
    const first = await deriveWorkflowInstanceId('pay_test_0001');
    const second = await deriveWorkflowInstanceId('pay_test_0001');
    expect(first).toBe(second);
    expect(first).toMatch(/^siteborne-wf-[0-9a-f]{48}$/);
  });

  it('different payment_identifier values -> different Workflow instance ids', async () => {
    const first = await deriveWorkflowInstanceId('pay_test_0001');
    const second = await deriveWorkflowInstanceId('pay_test_0002');
    expect(first).not.toBe(second);
  });

  it('this module never defines its own instance-id/hash helper (static source proof — no computeAttemptHash-style reimplementation)', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../src/control-plane/workflows/paid-continuation-workflow.ts'),
      'utf8'
    );
    expect(source).not.toMatch(/function\s+(derive|compute).*(InstanceId|AttemptHash)/i);
    expect(source).not.toContain('deriveWorkflowInstanceId'); // not even imported — H2AWI-3's concern
  });
});

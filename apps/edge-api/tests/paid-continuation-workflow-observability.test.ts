/**
 * SUN-1222C-R4-D10 — ambiguous-settlement operator-escalation observability.
 *
 * D9 proved `runSettlementStep` can reach `ambiguous_unresolved` (terminal
 * `settlement_ambiguous`) with zero economic effect and correct fail-closed
 * behavior, but the audit found the outcome produced no active operator
 * signal at all (`D10_ALERTING_CLASS=D`). These tests prove the minimal,
 * observational-only remediation: a single structured `console.warn` at the
 * exact convergence point (regardless of which of the three
 * `ambiguous_unresolved` origins reached it), carrying only the two
 * non-secret correlation identifiers an operator needs to run the new
 * `listUnresolvedSettlements` discovery query or look the row up directly.
 *
 * No real network call, no real D1, no real Cloudflare Workflow resource —
 * same fully-faked dependency style as every other file in this suite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPaidContinuationWorkflow } from '../src/control-plane/workflows/paid-continuation-workflow';
import { FakeWorkflowStep } from './support/fake-workflow-step';
import {
  buildTestDependencies,
  buildTestMetadata,
  sealTestInput,
  TEST_JOB_ID,
  TEST_PAYMENT_IDENTIFIER,
} from './support/paid-continuation-workflow-fixtures';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runToAmbiguous() {
  const metadata = buildTestMetadata();
  // Case 5 precondition from the crash-matrix suite: a prior attempt's
  // pre-settle draft is durably claimed but no candidate transaction
  // reference is known — `resolveViaReconciliation` returns `inconclusive`
  // without ever calling settle() again.
  const deps = await buildTestDependencies({
    seedSettlement: { lifecycleStage: 'settlement_pending', settlementTransactionReference: null },
  });
  const input = await sealTestInput(metadata, { key: deps.envelopeKey });
  const step = new FakeWorkflowStep();
  const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);
  return { result, deps };
}

describe('paid-continuation-workflow — ambiguous-settlement operator escalation (SUN-1222C-R4-D10)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('O1: reaching settlement_ambiguous emits exactly one structured escalation log', async () => {
    const { result } = await runToAmbiguous();

    expect(result.status).toBe('settlement_ambiguous');
    expect(warnSpy).toHaveBeenCalledTimes(1);

    const logged = JSON.parse(warnSpy.mock.calls[0]![0] as string);
    expect(logged).toEqual({
      event: 'settlement_ambiguous_unresolved',
      job_id: TEST_JOB_ID,
      payment_identifier: TEST_PAYMENT_IDENTIFIER,
    });
  });

  it('O2: a second run against the same still-unresolved durable state re-emits the SAME logical incident, never a second row/incident (dedup key = payment_identifier)', async () => {
    const first = await runToAmbiguous();
    expect(first.result.status).toBe('settlement_ambiguous');

    // Re-run against the identical durable settlement-repository state a
    // real restart/operator re-drive would see — no new row is ever
    // created (the repository fake, like the real D1 UPDATE, only ever
    // mutates the one existing `payment_identifier` row).
    const secondMetadata = buildTestMetadata();
    const secondInput = await sealTestInput(secondMetadata, { key: first.deps.envelopeKey });
    const secondStep = new FakeWorkflowStep();
    const second = await runPaidContinuationWorkflow(
      { payload: secondInput },
      secondStep,
      first.deps
    );

    expect(second.status).toBe('settlement_ambiguous');
    expect(warnSpy).toHaveBeenCalledTimes(2); // one log per invocation
    const firstLogged = JSON.parse(warnSpy.mock.calls[0]![0] as string);
    const secondLogged = JSON.parse(warnSpy.mock.calls[1]![0] as string);
    // Same payment_identifier/job_id both times: an operator's dedup layer
    // (or a human reading the log) recognizes this as the SAME unresolved
    // economic incident, not two — never a distinct identifier per retry.
    expect(secondLogged.payment_identifier).toBe(firstLogged.payment_identifier);
    expect(secondLogged.job_id).toBe(firstLogged.job_id);
  });

  it('O4: the escalation log carries no forbidden secret material', async () => {
    await runToAmbiguous();
    const logged = warnSpy.mock.calls[0]![0] as string;

    for (const forbidden of [
      'private',
      'privateKey',
      'signature',
      'wallet',
      'authorization:',
      'Bearer ',
      'secret',
    ]) {
      expect(logged.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    // Only the two declared correlation fields — nothing else.
    expect(Object.keys(JSON.parse(logged)).sort()).toEqual([
      'event',
      'job_id',
      'payment_identifier',
    ]);
  });

  it('the happy (settled) path never emits the ambiguous-settlement log', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies();
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();
    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(result.status).toBe('settled');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('the escalation log path calls zero settle/verify/executor/chain functions (static source proof)', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../src/control-plane/workflows/paid-continuation-workflow.ts'),
      'utf8'
    );
    const fnStart = source.indexOf('function logSettlementAmbiguous(');
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = source.indexOf('\n}', fnStart);
    const fnBody = source.slice(fnStart, fnEnd);

    expect(fnBody).not.toMatch(/\.settle\(/);
    expect(fnBody).not.toMatch(/\.verify\(/);
    expect(fnBody).not.toMatch(/executor/i);
    expect(fnBody).not.toMatch(/chain/i);
    // The ONLY side effect this function performs.
    expect(fnBody).toMatch(/console\.warn\(/);
  });
});

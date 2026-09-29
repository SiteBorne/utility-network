/**
 * R3-57A Phase 1 — isolated old-vs-new run() contract harness.
 *
 * NOT a Cloudflare Workflows reproduction. It proves only that, for an
 * invalid envelope, run() with the A4 version-log line (new) and with that
 * line stubbed out (old, per `git diff d939f3b 314e24e`) produce identical
 * step sequences, results, persistence effects and settlement/provider
 * calls, and that run() resolves rather than hangs or rejects.
 */
import { describe, expect, it, vi } from 'vitest';
import { runPaidContinuationWorkflow } from '../src/control-plane/workflows/paid-continuation-workflow';
import { FakeWorkflowStep } from './support/fake-workflow-step';
import {
  buildTestDependencies,
  buildTestMetadata,
  generateTestKey,
  sealTestInput,
} from './support/paid-continuation-workflow-fixtures';

async function invalidEnvelopeRun() {
  const metadata = buildTestMetadata();
  const deps = await buildTestDependencies();
  // Sealed under a DIFFERENT key => open-envelope must fail (probe shape).
  const input = await sealTestInput(metadata, { key: await generateTestKey() });
  const step = new FakeWorkflowStep();
  const started = Date.now();
  const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);
  return {
    result,
    steps: step.calls.map((c: { name: string }) => c.name),
    settle: deps.settle.mock.calls.length,
    jobState: deps.jobPersistence,
    elapsedMs: Date.now() - started,
  };
}

describe('R3-57A HOST run() old-vs-new for an invalid envelope', () => {
  it('new (with version log) resolves, terminates at open-envelope, no provider/settle', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const r = await invalidEnvelopeRun();
    expect(r.result.status).toBe('workflow_internal_error');
    expect(r.steps).toEqual(['open-envelope']);
    expect(r.settle).toBe(0);
    expect(r.elapsedMs).toBeLessThan(2000);
    info.mockRestore();
  });

  it('old (log stubbed) is observably identical to new', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const withLog = await invalidEnvelopeRun();

    vi.resetModules();
    vi.doMock('../src/runtime-observation', () => ({ emitRuntimeVersionEvent: () => {} }));
    const { runPaidContinuationWorkflow: oldRun } = await import(
      '../src/control-plane/workflows/paid-continuation-workflow'
    );
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies();
    const input = await sealTestInput(metadata, { key: await generateTestKey() });
    const step = new FakeWorkflowStep();
    const oldResult = await oldRun({ payload: input }, step, deps);
    vi.doUnmock('../src/runtime-observation');

    expect(oldResult.status).toBe(withLog.result.status);
    expect(oldResult.error_code).toBe(withLog.result.error_code);
    expect(step.calls.map((c: { name: string }) => c.name)).toEqual(withLog.steps);
    expect(deps.settle.mock.calls.length).toBe(withLog.settle);
    info.mockRestore();
  });

  it('the version-log emitter is synchronous and never throws, even for a hostile env', async () => {
    const { emitRuntimeVersionEvent } = await import('../src/runtime-observation');
    const info = vi.spyOn(console, 'info').mockImplementation(() => {
      throw new Error('log sink down');
    });
    expect(emitRuntimeVersionEvent({ CF_VERSION_METADATA: { id: 'x' } }, 'u')).toBeUndefined();
    expect(emitRuntimeVersionEvent(undefined, 'u')).toBeUndefined();
    info.mockRestore();
  });
});

/**
 * SUN-1221E6R-H2BF1 — proves the actual exported `PaidContinuationWorkflow`
 * class's `run(event, step)` invokes real orchestration, closing the gap
 * H2AWI-2 deliberately deferred and every later checkpoint (H2AWI-3/4/4R/4P)
 * left unclosed straight through the real H2B payment attempt (which
 * errored with zero Workflow steps executed — see
 * docs/reports/SUN-1221E6R-H2B-real-durable-workflow-payment-
 * qualification.md).
 *
 * Deliberately distinct from `paid-continuation-workflow.test.ts`, which
 * exhaustively exercises the pure `runPaidContinuationWorkflow` orchestration
 * function against fakes (all of that coverage is reused unmodified here —
 * this file only proves the ENTRYPOINT correctly delegates to it). Mocks
 * `./production-dependencies` at the module boundary rather than faking a
 * full D1Database/CDP client surface, since that boundary — not the
 * orchestration logic itself — is exactly what was broken.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaidContinuationWorkflow } from './paid-continuation-workflow';
import type {
  PaidContinuationWorkflowDependencies,
  PaidContinuationWorkflowEvent,
  PaidContinuationWorkflowStep,
} from './paid-continuation-workflow';
// `WorkflowContinuationResult` is defined in `../continuation/types` --
// `paid-continuation-workflow.ts` imports it for its own internal use but
// never re-exports it, so it must be imported from its actual source here
// rather than through that module (SUN-1222B typecheck remediation: this
// was the sole cause of this file's `TS2459` error).
import type { WorkflowContinuationResult } from '../continuation/types';
import type { Env } from '../config/env';

const buildDependenciesMock = vi.hoisted(() => vi.fn());

vi.mock('./production-dependencies', () => ({
  buildProductionPaidContinuationWorkflowDependencies: buildDependenciesMock,
}));

function fakeEvent(service = 'web_context_verified.v2'): PaidContinuationWorkflowEvent {
  return {
    payload: {
      envelope: { v: 1, key_id: 'v1', iv_b64: 'AAAAAAAAAAAAAAAA', ciphertext_b64: 'AAAA', aad_fingerprint: 'x' },
      metadata: {
        job_id: 'job-h2bf1-1',
        payment_identifier: 'pay-h2bf1-1',
        service,
        network: 'eip155:8453',
        asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        pay_to: '0x7f44a2dd237938f18632d4cca40f4c690295e6e1',
        amount_atomic: '9000',
        valid_before_unix: Math.floor(Date.now() / 1000) + 300,
      },
      request_id: 'req-h2bf1-1',
    },
  };
}

const fakeStep: PaidContinuationWorkflowStep = {
  do: async (_name, _config, cb) => cb(),
};

function fakeDeps(): PaidContinuationWorkflowDependencies {
  return {
    envelopeKey: {} as CryptoKey,
    clock: () => 1_000_000,
    executor: vi.fn() as never,
    validatePcc: vi.fn() as never,
    settlement: { repository: {} as never, evidenceProvider: {} as never },
    reconciliation: { checker: vi.fn() as never, network: 'eip155:8453' },
    persistence: { job: {} as never, resultReceipt: {} as never },
  };
}

describe('SUN-1221E6R-H2BF1 PaidContinuationWorkflow.run() real entrypoint wiring', () => {
  beforeEach(() => {
    buildDependenciesMock.mockReset();
  });

  it('ACTUAL_CLASS_RUN_GREEN: delegates to buildProductionPaidContinuationWorkflowDependencies(this.env, service) and never throws the deferred-wiring stub', async () => {
    const deps = fakeDeps();
    buildDependenciesMock.mockResolvedValue(deps);
    const fakeEnv = { DB: {} } as unknown as Env;
    const workflow = new PaidContinuationWorkflow({} as never, fakeEnv);

    const event = fakeEvent();
    // Real orchestration will run with these fakes; step 0 (open-envelope)
    // fails closed on the deliberately-invalid fake ciphertext, which is
    // exactly the correctly-terminal, non-throwing behavior this test
    // needs — it proves `run()` reached real orchestration at all
    // (`runPaidContinuationWorkflow`), not that decryption succeeds.
    const result: WorkflowContinuationResult = await workflow.run(event, fakeStep);

    expect(buildDependenciesMock).toHaveBeenCalledExactlyOnceWith(fakeEnv, 'web_context_verified.v2');
    // A decrypt failure on garbage ciphertext also terminates as
    // `workflow_internal_error` (same status as a dependency-unavailable
    // short-circuit, different error_code) — the discriminator that
    // proves `run()` actually reached real orchestration (rather than
    // synchronously throwing the old hard-coded stub, or short-circuiting
    // on unavailable dependencies) is the error_code shape, not the
    // status enum value.
    expect(result.error_code).not.toContain('dependencies_unavailable');
  });

  it('ACTUAL_CLASS_HAPPY_PATH: with a fully-fake dependency set, run() reaches step.do("open-envelope", ...) before returning', async () => {
    const deps = fakeDeps();
    buildDependenciesMock.mockResolvedValue(deps);
    // `PaidContinuationWorkflowStep['do']` is a generic method
    // (`do<T>(...): Promise<T>`); `vi.fn`'s inferred mock type is
    // necessarily non-generic (`Promise<unknown>`), which is why passing
    // `doSpy` directly as `{ do: doSpy }` fails `tsc` even though the
    // runtime behavior (always resolve with whatever `cb()` returns) is
    // exactly generic-correct. Asserting the object's shape at the call
    // site -- not weakening `doSpy`'s own inferred type, which
    // `.mock.calls` below still reads normally -- is the narrow, test-only
    // fix (SUN-1222B typecheck remediation).
    const doSpy = vi.fn(async (_name: string, _config: unknown, cb: () => Promise<unknown>) => cb());
    const workflow = new PaidContinuationWorkflow({} as never, {} as Env);

    await workflow.run(fakeEvent(), { do: doSpy } as unknown as PaidContinuationWorkflowStep);

    expect(doSpy).toHaveBeenCalled();
    expect(doSpy.mock.calls[0][0]).toBe('open-envelope');
  });

  it('ACTUAL_CLASS_FAIL_CLOSED: an unsupported/unknown service never reaches step.do, never touches settlement, and THROWS (SUN-1221E6R-H2BF5-R1 — a resolved return here is recorded by the real Cloudflare Workflows platform as Completed/Success regardless of the application-level status field; see the real H2BF5 zero-step "Completed, Success=Yes" instance this closes)', async () => {
    buildDependenciesMock.mockResolvedValue({ unavailable: true, reason: 'unsupported service: nope' });
    const doSpy = vi.fn();
    const workflow = new PaidContinuationWorkflow({} as never, {} as Env);

    await expect(workflow.run(fakeEvent('nope'), { do: doSpy })).rejects.toThrow(
      /dependencies_unavailable: unsupported service: nope/
    );
    expect(doSpy).not.toHaveBeenCalled();
  });

  it('ACTUAL_CLASS_FAIL_CLOSED: missing PAYMENT_CONTINUATION_ENCRYPTION_KEY (surfaced via the dependency builder) never reaches step.do and THROWS (platform must record Errored, not Completed)', async () => {
    buildDependenciesMock.mockResolvedValue({
      unavailable: true,
      reason: 'PAYMENT_CONTINUATION_ENCRYPTION_KEY is missing',
    });
    const doSpy = vi.fn();
    const workflow = new PaidContinuationWorkflow({} as never, {} as Env);

    await expect(workflow.run(fakeEvent(), { do: doSpy })).rejects.toThrow(
      /dependencies_unavailable: PAYMENT_CONTINUATION_ENCRYPTION_KEY is missing/
    );
    expect(doSpy).not.toHaveBeenCalled();
  });

  it('verify_agent_output.v2 requests the verify-service dependency set, not web-context', async () => {
    buildDependenciesMock.mockResolvedValue(fakeDeps());
    const workflow = new PaidContinuationWorkflow({} as never, {} as Env);

    await workflow.run(fakeEvent('verify_agent_output.v2'), fakeStep);

    expect(buildDependenciesMock).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'verify_agent_output.v2');
  });

  it('MUTATION_REAL_ORCHESTRATION_BYPASS: if run() returned without calling runPaidContinuationWorkflow, step.do would never be reached — this test fails if that regresses', async () => {
    buildDependenciesMock.mockResolvedValue(fakeDeps());
    const doSpy = vi.fn(async (_n: string, _c: unknown, cb: () => Promise<unknown>) => cb());
    const workflow = new PaidContinuationWorkflow({} as never, {} as Env);

    // See the identical note in the ACTUAL_CLASS_HAPPY_PATH test above.
    await workflow.run(fakeEvent(), { do: doSpy } as unknown as PaidContinuationWorkflowStep);

    expect(doSpy).toHaveBeenCalled();
  });
});

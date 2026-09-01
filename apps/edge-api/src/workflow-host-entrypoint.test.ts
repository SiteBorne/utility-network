/**
 * SUN-1221E6R-H2BF4 — proves the dedicated Workflow-host entrypoint
 * (`workflow-host-entrypoint.ts`) is a genuine, isolated bundle boundary:
 * it exports the real `PaidContinuationWorkflow` (same class the public
 * API Worker used to export directly, unmodified by this split), its
 * default export is an inert 404 with zero real HTTP surface, and its
 * SOURCE never imports the public SITEBORNE HTTP router, Hono app
 * construction, MCP/A2A handlers, or any test-only/fixture module.
 *
 * The real-`run()`-delegation proof reuses the exact mocking pattern
 * `paid-continuation-workflow-entrypoint.test.ts` established for the
 * class itself (mock `./production-dependencies` at the module boundary)
 * — this file does not re-prove that boundary's own behavior, only that
 * importing the class THROUGH this new entrypoint module still reaches
 * the same real class (identity-checked), not a copy/fork.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PaidContinuationWorkflow as DirectlyImportedWorkflow } from './control-plane/workflows/paid-continuation-workflow';
import type {
  PaidContinuationWorkflowDependencies,
  PaidContinuationWorkflowEvent,
  PaidContinuationWorkflowStep,
} from './control-plane/workflows/paid-continuation-workflow';
import type { Env } from './control-plane/config/env';

const buildDependenciesMock = vi.hoisted(() => vi.fn());

vi.mock('./control-plane/workflows/production-dependencies', () => ({
  buildProductionPaidContinuationWorkflowDependencies: buildDependenciesMock,
}));

const SOURCE_PATH = fileURLToPath(new URL('./workflow-host-entrypoint.ts', import.meta.url));

function fakeEvent(): PaidContinuationWorkflowEvent {
  return {
    payload: {
      envelope: {
        v: 1,
        key_id: 'v1',
        iv_b64: 'AAAAAAAAAAAAAAAA',
        ciphertext_b64: 'AAAA',
        aad_fingerprint: 'x',
      },
      metadata: {
        job_id: 'job-h2bf4-1',
        payment_identifier: 'pay-h2bf4-1',
        service: 'web_context_verified.v2',
        network: 'eip155:8453',
        asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        pay_to: '0x7f44a2dd237938f18632d4cca40f4c690295e6e1',
        amount_atomic: '9000',
        valid_before_unix: Math.floor(Date.now() / 1000) + 300,
      },
      request_id: 'req-h2bf4-1',
    },
  };
}

function fakeDeps(): PaidContinuationWorkflowDependencies {
  return {
    envelopeKey: {} as CryptoKey,
    clock: () => 1_000_000,
    evidenceMode: 'production',
    executor: vi.fn() as never,
    validatePcc: vi.fn() as never,
    settlement: { repository: {} as never, evidenceProvider: {} as never },
    reconciliation: { checker: vi.fn() as never, network: 'eip155:8453' },
    persistence: { job: {} as never, resultReceipt: {} as never },
  };
}

describe('SUN-1221E6R-H2BF4 dedicated Workflow-host entrypoint', () => {
  beforeEach(() => {
    buildDependenciesMock.mockReset();
  });

  it('DEDICATED_HOST_GREEN: exports the real, unmodified PaidContinuationWorkflow class (identity-equal to the shared module, not a fork)', async () => {
    const hostModule = await import('./workflow-host-entrypoint');
    expect(hostModule.PaidContinuationWorkflow).toBe(DirectlyImportedWorkflow);
  });

  it('ACTUAL_WORKFLOW_CLASS_GREEN: the class reached through this entrypoint really delegates run() to production dependencies + real orchestration (reaches step.do("open-envelope", ...), not the old throwing stub)', async () => {
    const hostModule = await import('./workflow-host-entrypoint');
    const { PaidContinuationWorkflow } = hostModule;
    const deps = fakeDeps();
    buildDependenciesMock.mockResolvedValue(deps);
    const fakeEnv = { DB: {} } as unknown as Env;
    const workflow = new PaidContinuationWorkflow({} as never, fakeEnv);
    const doSpy = vi.fn(async (_name: string, _config: unknown, cb: () => Promise<unknown>) =>
      cb()
    );

    // The old deferred-wiring stub synchronously threw before ever
    // returning a `WorkflowContinuationResult` at all -- the mere fact
    // this resolves (rather than rejects) and reaches `step.do(...)` is
    // itself the proof real orchestration is wired through this entrypoint.
    const result = await workflow.run(fakeEvent(), {
      do: doSpy,
    } as unknown as PaidContinuationWorkflowStep);

    expect(buildDependenciesMock).toHaveBeenCalledExactlyOnceWith(
      fakeEnv,
      'web_context_verified.v2'
    );
    expect(doSpy).toHaveBeenCalled();
    expect(doSpy.mock.calls[0][0]).toBe('open-envelope');
    expect(result.job_id).toBe('job-h2bf4-1');
    expect(result.error_code).not.toContain('dependencies_unavailable');
  });

  it('does NOT export a public fetch API/HTTP router -- the default export is an inert, unconditional 404', async () => {
    const hostModule = await import('./workflow-host-entrypoint');
    expect(hostModule.default).toBeDefined();
    expect(typeof hostModule.default.fetch).toBe('function');
    const response = await hostModule.default.fetch(new Request('https://example.com/anything'));
    expect(response.status).toBe(404);
    const response2 = await hostModule.default.fetch(
      new Request('https://example.com/v2/web/context')
    );
    expect(response2.status).toBe(404);
  });

  it('does NOT include HTTP routes at the SOURCE level -- no import of Hono, the public router, MCP, A2A, or index.ts', () => {
    const source = readFileSync(SOURCE_PATH, 'utf-8');
    const forbiddenImports = [
      "from 'hono'",
      'from ./index',
      "from './index'",
      'mcpRoute',
      'a2aRoute',
      'catalogRoute',
      'healthRoute',
      'readinessRoute',
      'openapiRoute',
      'benchmarksRoute',
      'worker-runtime-test-entrypoint',
      'FixturePaymentEvidenceProvider',
    ];
    const found = forbiddenImports.filter((marker) => source.includes(marker));
    expect(found, `unexpected markers found: ${found.join(', ')}`).toEqual([]);
  });

  it('exports exactly PaidContinuationWorkflow (named) and a default export -- no other named export', async () => {
    const hostModule = await import('./workflow-host-entrypoint');
    const namedExports = Object.keys(hostModule).filter((k) => k !== 'default');
    expect(namedExports).toEqual(['PaidContinuationWorkflow']);
  });
});

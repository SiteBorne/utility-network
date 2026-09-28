/**
 * R3-A4-55 — HOST runtime version observation.
 *
 * The dedicated Workflow host has no HTTP surface (inert 404), so the
 * executing version is reported as one structured Workers Logs event,
 * `siteborne.runtime_version`, at the start of every `run()`. The event is
 * observation only: it adds no step, changes no ordering, never throws and
 * is never read by provider dispatch, settlement or result release.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PaidContinuationWorkflowDependencies,
  PaidContinuationWorkflowEvent,
  PaidContinuationWorkflowStep,
} from './control-plane/workflows/paid-continuation-workflow';
import type { Env } from './control-plane/config/env';
import { emitRuntimeVersionEvent } from './runtime-observation';

const buildDependenciesMock = vi.hoisted(() => vi.fn());
vi.mock('./control-plane/workflows/production-dependencies', () => ({
  buildProductionPaidContinuationWorkflowDependencies: buildDependenciesMock,
}));

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SRC = join(ROOT, 'apps/edge-api/src');
const VERSION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const META = {
  id: VERSION_A,
  tag: 'release-3-a4-provenance-host-01',
  timestamp: '2026-09-28T15:00:00.000Z',
};

function event(): PaidContinuationWorkflowEvent {
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
        job_id: 'job-a4-1',
        payment_identifier: 'pay-a4-1',
        service: 'web_context_verified.v2',
        network: 'eip155:8453',
        asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        pay_to: '0x7f44a2dd237938f18632d4cca40f4c690295e6e1',
        amount_atomic: '9000',
        valid_before_unix: Math.floor(Date.now() / 1000) + 300,
      },
      request_id: 'req-a4-1',
    },
  };
}

function deps(): PaidContinuationWorkflowDependencies {
  return {
    envelopeKey: {} as CryptoKey,
    clock: () => 1_000_000,
    evidenceMode: 'production',
    executor: vi.fn() as never,
    providerDispatch: {} as never,
    validatePcc: vi.fn() as never,
    settlement: { repository: {} as never, evidenceProvider: {} as never },
    reconciliation: { checker: vi.fn() as never, network: 'eip155:8453' },
    persistence: {
      job: { getJob: async () => undefined } as never,
      resultReceipt: {} as never,
      finalization: {} as never,
    },
  };
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'generated' ? [] : sourceFiles(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });
}

const events = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls
    .map((c) => String(c[0]))
    .filter((s) => s.includes('siteborne.runtime_version'))
    .map((s) => JSON.parse(s) as Record<string, unknown>);

describe('HOST runtime observation (R3-A4-55)', () => {
  let info: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    buildDependenciesMock.mockReset();
    info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });
  afterEach(() => info.mockRestore());

  it('run() logs the executing version once, then proceeds to open-envelope unchanged', async () => {
    const { PaidContinuationWorkflow } = await import('./workflow-host-entrypoint');
    const d = deps();
    buildDependenciesMock.mockResolvedValue(d);
    const env = { DB: {}, CF_VERSION_METADATA: META } as unknown as Env;
    const wf = new PaidContinuationWorkflow({} as never, env);
    const doSpy = vi.fn(async (_n: string, _c: unknown, cb: () => Promise<unknown>) => cb());
    const result = await wf.run(event(), { do: doSpy } as unknown as PaidContinuationWorkflowStep);

    expect(events(info)).toEqual([
      {
        event: 'siteborne.runtime_version',
        deployment_unit: 'siteborne-paid-continuation-runtime',
        platform_version_id: VERSION_A,
        platform_version_tag: 'release-3-a4-provenance-host-01',
        platform_version_timestamp: '2026-09-28T15:00:00.000Z',
      },
    ]);
    // Dependencies still receive the untouched env; step graph unchanged.
    expect(buildDependenciesMock).toHaveBeenCalledExactlyOnceWith(env, 'web_context_verified.v2');
    expect(doSpy.mock.calls[0][0]).toBe('open-envelope');
    expect(result.job_id).toBe('job-a4-1');
  });

  it('absent binding logs a null version and does not affect execution', async () => {
    const { PaidContinuationWorkflow } = await import('./workflow-host-entrypoint');
    buildDependenciesMock.mockResolvedValue(deps());
    const wf = new PaidContinuationWorkflow({} as never, { DB: {} } as unknown as Env);
    const doSpy = vi.fn(async (_n: string, _c: unknown, cb: () => Promise<unknown>) => cb());
    await wf.run(event(), { do: doSpy } as unknown as PaidContinuationWorkflowStep);
    expect(events(info)).toEqual([
      {
        event: 'siteborne.runtime_version',
        deployment_unit: 'siteborne-paid-continuation-runtime',
        platform_version_id: null,
      },
    ]);
    expect(doSpy.mock.calls[0][0]).toBe('open-envelope');
  });

  it('a throwing logger or hostile binding can never break run()', () => {
    info.mockImplementation(() => {
      throw new Error('log sink down');
    });
    const hostile = {
      get CF_VERSION_METADATA(): never {
        throw new Error('binding exploded');
      },
    };
    expect(() => emitRuntimeVersionEvent(hostile, 'u')).not.toThrow();
    expect(() => emitRuntimeVersionEvent({ CF_VERSION_METADATA: META }, 'u')).not.toThrow();
    expect(emitRuntimeVersionEvent({ CF_VERSION_METADATA: META }, 'u')).toBeUndefined();
  });

  it('host HTTP surface stays an inert 404 even with version metadata bound', async () => {
    const host = await import('./workflow-host-entrypoint');
    const res = await host.default.fetch(new Request('https://x/health'));
    expect(res.status).toBe(404);
  });

  it('CF_VERSION_METADATA is referenced only by the observation module', () => {
    const readers = sourceFiles(SRC)
      .filter((p) => readFileSync(p, 'utf8').includes('CF_VERSION_METADATA'))
      .map((p) => relative(ROOT, p));
    expect(readers).toEqual(['apps/edge-api/src/runtime-observation.ts']);
  });

  it('the workflow uses the observation module only through the void emitter, once', () => {
    const wf = readFileSync(
      join(SRC, 'control-plane/workflows/paid-continuation-workflow.ts'),
      'utf8'
    );
    const uses =
      wf.match(/runtime-observation|emitRuntimeVersionEvent|runtimeVersionReport/g) ?? [];
    expect(uses).toEqual([
      'emitRuntimeVersionEvent',
      'runtime-observation',
      'emitRuntimeVersionEvent',
    ]);
    expect(wf).toMatch(
      /\n    emitRuntimeVersionEvent\(this\.env, 'siteborne-paid-continuation-runtime'\);\n/
    );
  });

  it('host config declares the canonical version_metadata binding', () => {
    const toml = readFileSync(join(ROOT, 'wrangler.paid-continuation-runtime.toml'), 'utf8');
    expect(toml).toMatch(/\n\[version_metadata\]\nbinding = "CF_VERSION_METADATA"\n/);
  });
});

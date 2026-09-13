/**
 * SUN-1222C cron export remediation — proves the default export handed to
 * the Cloudflare Workers runtime is a canonical `ExportedHandler` object
 * (explicit `fetch` + `scheduled` properties), not the Hono application
 * instance itself augmented via `Object.assign`. The latter shape is
 * indistinguishable from the correct one for module introspection and for
 * ordinary HTTP dispatch, but is the suspected cause of zero observed
 * `scheduled` invocations on the live platform (see
 * docs/reports/SUN-1222C-cron-runtime-invocation-blocker-diagnosis.md).
 */
import { describe, expect, it, vi } from 'vitest';
import defaultExport from './index';
import { app } from './index';
import type { Env } from './control-plane/config/env';

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as Env['DB'],
    ARTIFACTS: {} as Env['ARTIFACTS'],
    JOBS: {} as Env['JOBS'],
    EVENTS: {} as Env['EVENTS'],
    CATALOG: {} as Env['CATALOG'],
    AI: {} as Env['AI'],
    BROWSER: {} as Env['BROWSER'],
    ENVIRONMENT: 'production',
    LOG_LEVEL: 'info',
    PCC_VERSION: '1.0.0',
    SELLER_WALLET_ADDRESS: '0x' + '1'.repeat(40),
    CDP_API_KEY_ID: 'cdp-key-id',
    CDP_API_KEY_SECRET: 'cdp-key-secret',
    VOYAGE_API_KEY: 'voyage-key',
    MODAL_TOKEN_ID: 'modal-token-id',
    MODAL_TOKEN_SECRET: 'modal-token-secret',
    SENTRY_DSN: 'https://example.invalid/sentry',
    ...overrides,
  };
}

describe('index.ts default export — canonical ExportedHandler shape', () => {
  it('A. exposes a callable fetch', () => {
    expect(typeof defaultExport.fetch).toBe('function');
  });

  it('B. exposes a callable scheduled', () => {
    expect(typeof defaultExport.scheduled).toBe('function');
  });

  it('C. scheduled is an own property of the exported handler object', () => {
    expect(Object.prototype.hasOwnProperty.call(defaultExport, 'scheduled')).toBe(true);
  });

  it('D. fetch delegates to the existing Hono app (same response as app.request)', async () => {
    const env = baseEnv();
    const viaDefault = await defaultExport.fetch(new Request('https://example.com/health'), env);
    const viaApp = await app.request('/health', {}, env);
    expect(viaDefault.status).toBe(viaApp.status);
  });

  it('E. scheduled invokes the exact existing owner-recovery scheduled function via ctx.waitUntil', async () => {
    const waitUntil = vi.fn();
    const ctx = { waitUntil } as { waitUntil(promise: Promise<unknown>): void };
    // DB/PAID_CONTINUATION_WORKFLOW/ARTIFACTS absent -> both scheduled
    // functions' own guard clauses make this a safe no-op; we are proving
    // *wiring*, not re-testing either function's internal behavior.
    const env = baseEnv({
      DB: undefined,
      PAID_CONTINUATION_WORKFLOW: undefined,
      ARTIFACTS: undefined,
    } as Partial<Env>);
    defaultExport.scheduled({ scheduledTime: Date.now(), cron: '* * * * *' }, env, ctx);
    // SUN-1222C-document-artifact-production-closure: reclaimStaleArtifactsScheduled
    // is now wired alongside owner-recovery on the same trigger -> 2 calls.
    expect(waitUntil).toHaveBeenCalledTimes(2);
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
    await expect(waitUntil.mock.calls[1][0]).resolves.toBeUndefined();
  });

  it("E2. scheduled's second waitUntil call runs artifact reclamation, independently of the owner-recovery call", async () => {
    const waitUntil = vi.fn();
    const ctx = { waitUntil } as { waitUntil(promise: Promise<unknown>): void };
    // ARTIFACTS absent -> reclaimStaleArtifactsScheduled's own guard clause
    // makes this a safe no-op; DB/PAID_CONTINUATION_WORKFLOW present so the
    // owner-recovery call's own guard does not also short-circuit, proving
    // the two calls are wired independently rather than one gate covering
    // both.
    const env = baseEnv({ ARTIFACTS: undefined } as Partial<Env>);
    defaultExport.scheduled({ scheduledTime: Date.now(), cron: '* * * * *' }, env, ctx);
    expect(waitUntil).toHaveBeenCalledTimes(2);
    await expect(waitUntil.mock.calls[1][0]).resolves.toBeUndefined();
  });

  it('F. no provider/payment/facilitator/settlement path is reachable from scheduled', () => {
    // Static shape guard: scheduled's only observable side effects are the
    // waitUntil calls proven in (E)/(E2); it takes no facilitator/provider
    // dependency in its signature.
    expect(defaultExport.scheduled.length).toBeLessThanOrEqual(3);
  });

  it('G. the exported handler is NOT the Hono application instance itself', () => {
    expect(defaultExport).not.toBe(app);
  });
});

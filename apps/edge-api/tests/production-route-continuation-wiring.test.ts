/**
 * SUN-1221E6R-H2AWI-3F — proves the real production route wiring defect
 * (neither `production-web-context-v2-cdp-route.ts` nor
 * `production-verify-v2-cdp-route.ts` forwarded `PAID_CONTINUATION_WORKFLOW`
 * / `PAYMENT_CONTINUATION_ENCRYPTION_KEY` into `createX402ServiceRoute`, so
 * every real payment silently hit `create_failed` after H2AWI-3 removed the
 * request-local settlement fallback) is fixed, and stays fixed.
 *
 * Exercises the REAL route modules (`production-web-context-v2-cdp-route.ts`,
 * `production-verify-v2-cdp-route.ts`) through the real app. The two
 * production *composition* modules are mocked to a fixed, always-valid
 * config -- their own CDP-evidence/network resolution is an orthogonal,
 * pre-existing concern (real CDP credentials, real network calls) that has
 * nothing to do with this checkpoint's fix, which is entirely about what
 * happens to `workflow`/`continuationEnvelopeKey` *after* composition
 * succeeds. `createX402ServiceRoute` itself is spied on (via
 * `importActual` for every other export) so the exact `config` object each
 * route hands it can be inspected directly -- the strongest possible proof
 * that the fix's actual mechanism (not a downstream side effect) is what
 * is under test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { X402ServiceRouteConfig } from '../src/control-plane/routes/x402-service';
import type {
  WorkflowBindingLike,
  WorkflowInstanceLike,
} from '../src/control-plane/continuation/handoff';

const createX402ServiceRouteSpy = vi.fn();

vi.mock('../src/control-plane/routes/x402-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/control-plane/routes/x402-service')>();
  return {
    ...actual,
    createX402ServiceRoute: (subApp: unknown, config: X402ServiceRouteConfig) => {
      createX402ServiceRouteSpy(config);
      return actual.createX402ServiceRoute(subApp as never, config);
    },
  };
});

const FIXED_VALID_CONFIG_BASE = {
  serviceId: 'web_context_verified.v2',
  scheme: 'exact',
  pricingKey: 'web_context_verified_v2' as never,
  network: 'eip155:8453' as never,
  asset: '0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913',
  path: '/v2/web/context',
  inputSchema: { type: 'object' },
  executor: { execute: async () => ({ result: { result_class: 'success' } }) } as never,
  contractRelease: 'test-release',
  inputSchemaHash: 'test-input-hash',
  outputSchemaHash: 'test-output-hash',
  pccDependency: 'test-pcc-dependency',
  clock: () => new Date().toISOString(),
  evidenceMode: 'fixture' as const,
};

vi.mock(
  '../src/control-plane/production/web-context-v2-cdp-composition',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../src/control-plane/production/web-context-v2-cdp-composition')
      >();
    return {
      ...actual,
      buildWebContextV2CdpProductionRouteConfig: vi.fn(async (_env: unknown, db: D1Database) => ({
        ...FIXED_VALID_CONFIG_BASE,
        db,
      })),
    };
  }
);

vi.mock(
  '../src/control-plane/production/verify-agent-output-v2-cdp-composition',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../src/control-plane/production/verify-agent-output-v2-cdp-composition')
      >();
    return {
      ...actual,
      buildVerifyAgentOutputV2CdpProductionRouteConfig: vi.fn(
        async (_env: unknown, db: D1Database) => ({
          ...FIXED_VALID_CONFIG_BASE,
          serviceId: 'verify_agent_output.v2',
          path: '/v2/verify/agent-output',
          db,
        })
      ),
    };
  }
);

function createFakeD1(): D1Database {
  const prepare = (_sql: string) => ({
    bind: (..._params: unknown[]) => ({
      all: async () => ({ success: true, results: [] }),
      run: async () => ({ success: true, results: [], meta: { changes: 0, last_row_id: 0 } }),
      first: async () => null,
    }),
    all: async () => ({ success: true, results: [] }),
  });
  return {
    prepare,
    exec: async () => ({ count: 0, duration: 0 }),
    batch: async (statements: unknown[]) => statements.map(() => ({ success: true, results: [] })),
    dump: async () => new Uint8Array(),
  } as unknown as D1Database;
}

// A valid base64-encoded 32-byte (256-bit) key -- the exact shape
// `PAYMENT_CONTINUATION_ENCRYPTION_KEY` must be in production.
const VALID_BASE64_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

function fakeWorkflowInstance(): WorkflowInstanceLike {
  return {
    id: 'test-instance',
    status: async () => ({ status: 'running' }),
  } as unknown as WorkflowInstanceLike;
}

function fakeWorkflowBinding(): WorkflowBindingLike {
  return {
    create: async () => fakeWorkflowInstance(),
    get: async () => fakeWorkflowInstance(),
  };
}

const BASE_ENV = {
  PAID_ROUTES_ENABLED: 'true',
  VERIFY_V2_CDP_ROUTE_ENABLED: 'true',
  WEB_CONTEXT_V2_CDP_ROUTE_ENABLED: 'true',
};

function jsonRequest(path: string): Request {
  return new Request(`https://edge.test${path}`, {
    method: 'POST',
    body: '{}',
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('SUN-1221E6R-H2AWI-3F: real production route continuation wiring', () => {
  beforeEach(() => {
    createX402ServiceRouteSpy.mockClear();
  });

  describe('fails closed when continuation dependencies are absent (RED reproduces the original bug)', () => {
    it('web_context_verified.v2: 503 service_executor_not_configured, createX402ServiceRoute never called, with no workflow/key bound', async () => {
      const { app } = await import('../src/index');
      const res = await app.fetch(jsonRequest('/v2/web/context'), {
        ...BASE_ENV,
        DB: createFakeD1(),
      } as never);
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('service_executor_not_configured');
      expect(createX402ServiceRouteSpy).not.toHaveBeenCalled();
    });

    it('verify_agent_output.v2: 503 service_executor_not_configured, createX402ServiceRoute never called, with no workflow/key bound', async () => {
      const { app } = await import('../src/index');
      const res = await app.fetch(jsonRequest('/v2/verify/agent-output'), {
        ...BASE_ENV,
        DB: createFakeD1(),
      } as never);
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('service_executor_not_configured');
      expect(createX402ServiceRouteSpy).not.toHaveBeenCalled();
    });

    it('web_context_verified.v2: still 503, still uncalled, with workflow bound but key absent', async () => {
      const { app } = await import('../src/index');
      const res = await app.fetch(jsonRequest('/v2/web/context'), {
        ...BASE_ENV,
        DB: createFakeD1(),
        PAID_CONTINUATION_WORKFLOW: fakeWorkflowBinding(),
      } as never);
      expect(res.status).toBe(503);
      expect(createX402ServiceRouteSpy).not.toHaveBeenCalled();
    });

    it('web_context_verified.v2: still 503, still uncalled, with key present but workflow absent', async () => {
      const { app } = await import('../src/index');
      const res = await app.fetch(jsonRequest('/v2/web/context'), {
        ...BASE_ENV,
        DB: createFakeD1(),
        PAYMENT_CONTINUATION_ENCRYPTION_KEY: VALID_BASE64_KEY,
      } as never);
      expect(res.status).toBe(503);
      expect(createX402ServiceRouteSpy).not.toHaveBeenCalled();
    });
  });

  describe('GREEN: propagates both dependencies into the exact config object createX402ServiceRoute receives', () => {
    it('web_context_verified.v2: config.workflow and config.continuationEnvelopeKey are the exact bound instances', async () => {
      const { app } = await import('../src/index');
      const workflow = fakeWorkflowBinding();
      await app.fetch(jsonRequest('/v2/web/context'), {
        ...BASE_ENV,
        DB: createFakeD1(),
        PAID_CONTINUATION_WORKFLOW: workflow,
        PAYMENT_CONTINUATION_ENCRYPTION_KEY: VALID_BASE64_KEY,
      } as never);
      expect(createX402ServiceRouteSpy).toHaveBeenCalledTimes(1);
      const config = createX402ServiceRouteSpy.mock.calls[0][0] as X402ServiceRouteConfig;
      expect(config.workflow).toBe(workflow);
      expect(config.continuationEnvelopeKey).toBeDefined();
      expect((config.continuationEnvelopeKey as CryptoKey).algorithm).toMatchObject({
        name: 'AES-GCM',
      });
    });

    it('verify_agent_output.v2: config.workflow and config.continuationEnvelopeKey are the exact bound instances', async () => {
      const { app } = await import('../src/index');
      const workflow = fakeWorkflowBinding();
      await app.fetch(jsonRequest('/v2/verify/agent-output'), {
        ...BASE_ENV,
        DB: createFakeD1(),
        PAID_CONTINUATION_WORKFLOW: workflow,
        PAYMENT_CONTINUATION_ENCRYPTION_KEY: VALID_BASE64_KEY,
      } as never);
      expect(createX402ServiceRouteSpy).toHaveBeenCalledTimes(1);
      const config = createX402ServiceRouteSpy.mock.calls[0][0] as X402ServiceRouteConfig;
      expect(config.workflow).toBe(workflow);
      expect(config.continuationEnvelopeKey).toBeDefined();
      expect((config.continuationEnvelopeKey as CryptoKey).algorithm).toMatchObject({
        name: 'AES-GCM',
      });
    });
  });
});

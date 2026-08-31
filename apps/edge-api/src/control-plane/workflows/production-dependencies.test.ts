/**
 * SUN-1221E6R-H2BF4 — direct, UNMOCKED unit coverage for
 * `buildProductionPaidContinuationWorkflowDependencies`'s own fail-closed
 * guards.
 *
 * `paid-continuation-workflow-entrypoint.test.ts` (H2BF1) proves the
 * ENTRYPOINT CLASS correctly delegates to and fails closed on whatever
 * this function returns — but it does so with this entire module
 * `vi.mock`'d at the boundary, so it never actually exercises this
 * function's own guard logic. That left a real coverage gap: H2BF4's own
 * mutation-matrix proof (removing the
 * `PAYMENT_CONTINUATION_ENCRYPTION_KEY` guard below) silently passed
 * against the mocked suite. This file closes that gap by calling the
 * REAL function directly, mocking nothing.
 *
 * Only the three guards reachable without a real D1Database/CDP
 * composition are covered here (unsupported service, missing `DB`,
 * missing `PAYMENT_CONTINUATION_ENCRYPTION_KEY`) — the guards ordered
 * BEFORE any real composition-function call. The `routeConfig.unavailable`
 * passthrough and successful-path construction are already exhaustively
 * covered by `web-context-v2-cdp-composition.test.ts` /
 * `verify-agent-output-v2-cdp-composition.test.ts` (the two composition
 * functions this function calls, unmodified, for exactly that logic) —
 * re-proving them here through a third layer would test the same code a
 * third time for no new coverage.
 */
import { describe, it, expect } from 'vitest';
import { buildProductionPaidContinuationWorkflowDependencies } from './production-dependencies';
import type { PaidContinuationWorkflowHostEnv } from './paid-continuation-workflow';

function minimalHostEnv(overrides: Partial<PaidContinuationWorkflowHostEnv> = {}): PaidContinuationWorkflowHostEnv {
  return {
    DB: {} as never,
    PAYMENT_CONTINUATION_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    PAID_RECEIPT_SIGNING_PRIVATE_KEY: undefined,
    PAID_RECEIPT_SIGNING_KEY_ID: undefined,
    SELLER_WALLET_ADDRESS: '0x7f44a2dd237938f18632d4cca40f4c690295e6e1',
    // Required (non-optional) fields on `Env` -- unlike the
    // `PAID_RECEIPT_SIGNING_*`/`MODAL_WEBCTX_*` fields below, these
    // cannot be `undefined`. Harmless placeholders: every test in this
    // file only exercises guards that short-circuit before these values
    // are ever read.
    CDP_API_KEY_ID: 'unused-test-placeholder',
    CDP_API_KEY_SECRET: 'unused-test-placeholder',
    PAYMENT_ENVIRONMENT: undefined,
    PRODUCTION_ENABLED: undefined,
    HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: undefined,
    PRODUCTION_CDP_CREDENTIALS_APPROVED: undefined,
    MODAL_WEBCTX_ENDPOINT_URL: undefined,
    MODAL_WEBCTX_PROXY_KEY: undefined,
    MODAL_WEBCTX_PROXY_SECRET: undefined,
    BASE_RPC_URL: undefined,
    BASE_SEPOLIA_RPC_URL: undefined,
    ...overrides,
  };
}

describe('SUN-1221E6R-H2BF4 buildProductionPaidContinuationWorkflowDependencies (real function, unmocked)', () => {
  it('fails closed on an unsupported/unknown service', async () => {
    const result = await buildProductionPaidContinuationWorkflowDependencies(
      minimalHostEnv(),
      'not_a_real_service'
    );
    expect('unavailable' in result && result.unavailable).toBe(true);
    expect('unavailable' in result && result.reason).toContain('unsupported service');
  });

  it('fails closed when DB is missing', async () => {
    const result = await buildProductionPaidContinuationWorkflowDependencies(
      minimalHostEnv({ DB: undefined as never }),
      'web_context_verified.v2'
    );
    expect('unavailable' in result && result.unavailable).toBe(true);
    expect('unavailable' in result && result.reason).toContain('D1 database binding');
  });

  it('MUTATION_G_TARGET: fails closed when PAYMENT_CONTINUATION_ENCRYPTION_KEY is missing -- this is the exact guard SUN-1221E6R-H2BF4 §37 mutation G proves is load-bearing (removing it was proven, this checkpoint, to silently pass the entrypoint-level mocked suite alone)', async () => {
    const result = await buildProductionPaidContinuationWorkflowDependencies(
      minimalHostEnv({ PAYMENT_CONTINUATION_ENCRYPTION_KEY: undefined }),
      'web_context_verified.v2'
    );
    expect('unavailable' in result && result.unavailable).toBe(true);
    expect('unavailable' in result && result.reason).toBe('PAYMENT_CONTINUATION_ENCRYPTION_KEY is missing');
  });

  it('both supported services are recognized before the DB/key guards short-circuit', async () => {
    for (const service of ['web_context_verified.v2', 'verify_agent_output.v2']) {
      const result = await buildProductionPaidContinuationWorkflowDependencies(
        minimalHostEnv({ DB: undefined as never }),
        service
      );
      // Reaches the DB guard (not the "unsupported service" guard) --
      // proves both real service names are accepted by the allowlist.
      expect('unavailable' in result && result.reason).toContain('D1 database binding');
    }
  });
});

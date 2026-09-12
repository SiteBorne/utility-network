/**
 * SUN-1220Q2 — proves `/ready` truthfully reflects version-local runtime
 * paid-route state for `verify_agent_output.v2` / CDP, and that its
 * `blocked_external` snapshot no longer lists the three items SUN-1220Q1
 * proved stale.
 *
 * Root cause (SUN-1220Q1): `readiness.ts` never reads `c.env` at all --
 * every field of its response, including `production_services_enabled`,
 * is a compile-time-constant literal. SUN-1220P1's claim that this field
 * was already runtime-derived via `ControlPlaneConfig.productionEnabled`
 * was disproven: that function has zero callers in the real request
 * path. This mirrors SUN-1220P2's fix for `/catalog`/agent-card, applied
 * to the one field of `/ready` this checkpoint is scoped to.
 *
 * These tests exercise the real app (`../src/index`) end to end with two
 * env variants: known-good-equivalent (every gate off, no DB) and
 * candidate-equivalent (every gate on, DB present -- matching
 * SUN-1220P3's qualified discovery-fixed candidate configuration).
 */
import { describe, it, expect } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { app } from '../src/index';

const VERIFY_V2_ROW = {
  id: 'verify_agent_output.v2',
  version: '2.0.0',
  title: 'Verify Agent Output v2',
  description: 'CDP-backed agent output verification',
  input_schema: 'schema',
  output_schema: 'schema',
  price_usd: '0.019',
  production_enabled: 0,
  production_ready: 0,
  protocol_status: 'preproduction',
};

function createFakeD1(): D1Database {
  const prepare = (sql: string) => ({
    bind: (..._params: unknown[]) => ({
      all: async () => {
        if (sql.includes('FROM services WHERE id')) {
          const id = _params[0];
          return { success: true, results: id === VERIFY_V2_ROW.id ? [VERIFY_V2_ROW] : [] };
        }
        if (sql.includes('FROM services')) {
          return { success: true, results: [VERIFY_V2_ROW] };
        }
        return { success: true, results: [] };
      },
      run: async () => ({ success: true, results: [], meta: { changes: 0, last_row_id: 0 } }),
    }),
    all: async () => {
      if (sql.includes('FROM services')) {
        return { success: true, results: [VERIFY_V2_ROW] };
      }
      return { success: true, results: [] };
    },
  });
  return {
    prepare,
    exec: async () => ({ count: 0, duration: 0 }),
    batch: async (statements: unknown[]) => statements.map(() => ({ success: true, results: [] })),
    dump: async () => new Uint8Array(),
  } as unknown as D1Database;
}

const FAKE_DB = createFakeD1();

const KNOWN_GOOD_EQUIVALENT_ENV = { DB: FAKE_DB };

const CANDIDATE_EQUIVALENT_ENV = {
  DB: FAKE_DB,
  PAID_ROUTES_ENABLED: 'true',
  VERIFY_V2_CDP_ROUTE_ENABLED: 'true',
  PAYMENT_ENVIRONMENT: 'production',
  PRODUCTION_ENABLED: 'true',
  HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: 'true',
  PRODUCTION_CDP_CREDENTIALS_APPROVED: 'true',
  PAID_RECEIPT_SIGNING_PRIVATE_KEY: 'test-key-material',
  PAID_RECEIPT_SIGNING_KEY_ID: 'kid_test000000000000000',
  SELLER_WALLET_ADDRESS: '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1',
  CDP_API_KEY_ID: 'test-cdp-key-id',
  CDP_API_KEY_SECRET: 'test-cdp-key-secret',
};

interface ReadyBody {
  status: string;
  phase: string;
  production_services_enabled: boolean;
  blocked_external: string[];
  reason: string;
}

async function getReady(extraEnv: Record<string, unknown> = {}) {
  const res = await app.request('/ready', {}, { ...extraEnv } as never);
  const body = (await res.json()) as ReadyBody;
  return { res, body };
}

function withOverride(overrides: Record<string, unknown>) {
  return { ...CANDIDATE_EQUIVALENT_ENV, ...overrides };
}

describe('SUN-1220Q2 — /ready production_services_enabled truthfulness', () => {
  it('CASE A (known-good-equivalent): production_services_enabled=false', async () => {
    const { res, body } = await getReady(KNOWN_GOOD_EQUIVALENT_ENV);
    expect(res.status).toBe(200);
    expect(body.production_services_enabled).toBe(false);
  });

  it('CASE B (fully qualified candidate-equivalent): production_services_enabled=true', async () => {
    const { res, body } = await getReady(CANDIDATE_EQUIVALENT_ENV);
    expect(res.status).toBe(200);
    expect(body.production_services_enabled).toBe(true);
  });

  it('CASE C: master route flag (PAID_ROUTES_ENABLED) false -> false', async () => {
    const { body } = await getReady(withOverride({ PAID_ROUTES_ENABLED: 'false' }));
    expect(body.production_services_enabled).toBe(false);
  });

  it('CASE D: route-specific flag (VERIFY_V2_CDP_ROUTE_ENABLED) false -> false', async () => {
    const { body } = await getReady(withOverride({ VERIFY_V2_CDP_ROUTE_ENABLED: 'false' }));
    expect(body.production_services_enabled).toBe(false);
  });

  it('CASE E: PAYMENT_ENVIRONMENT != production -> false', async () => {
    const { body } = await getReady(withOverride({ PAYMENT_ENVIRONMENT: 'preproduction' }));
    expect(body.production_services_enabled).toBe(false);
  });

  it('CASE F: PRODUCTION_ENABLED false -> false', async () => {
    const { body } = await getReady(withOverride({ PRODUCTION_ENABLED: 'false' }));
    expect(body.production_services_enabled).toBe(false);
  });

  it('CASE G: HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP false -> false', async () => {
    const { body } = await getReady(withOverride({ HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: 'false' }));
    expect(body.production_services_enabled).toBe(false);
  });

  it('CASE H: PRODUCTION_CDP_CREDENTIALS_APPROVED false -> false', async () => {
    const { body } = await getReady(withOverride({ PRODUCTION_CDP_CREDENTIALS_APPROVED: 'false' }));
    expect(body.production_services_enabled).toBe(false);
  });

  it('CASE I: required production binding (SELLER_WALLET_ADDRESS) absent -> false', async () => {
    const env = withOverride({});
    delete (env as Record<string, unknown>).SELLER_WALLET_ADDRESS;
    const { body } = await getReady(env);
    expect(body.production_services_enabled).toBe(false);
  });

  it('CASE I2: no DB binding -> false even with every gate true', async () => {
    const env = withOverride({});
    delete (env as Record<string, unknown>).DB;
    const { body } = await getReady(env);
    expect(body.production_services_enabled).toBe(false);
  });
});

describe('SUN-1220Q2 — /ready blocked_external correction', () => {
  const STALE_BLOCKERS = ['cloudflare_account_configuration', 'seller_wallet', 'cdp_credentials'];
  const UNPROVEN_BLOCKERS = ['ionos_dns_migration', 'nevermined_credentials', 'registry_publication'];

  it('no longer lists the three Q1-proven-stale blockers (known-good env)', async () => {
    const { body } = await getReady(KNOWN_GOOD_EQUIVALENT_ENV);
    for (const stale of STALE_BLOCKERS) {
      expect(body.blocked_external).not.toContain(stale);
    }
  });

  it('no longer lists the three Q1-proven-stale blockers (candidate env)', async () => {
    const { body } = await getReady(CANDIDATE_EQUIVALENT_ENV);
    for (const stale of STALE_BLOCKERS) {
      expect(body.blocked_external).not.toContain(stale);
    }
  });

  it('still lists all three unproven blockers, unconditionally', async () => {
    const known = await getReady(KNOWN_GOOD_EQUIVALENT_ENV);
    const candidate = await getReady(CANDIDATE_EQUIVALENT_ENV);
    for (const unproven of UNPROVEN_BLOCKERS) {
      expect(known.body.blocked_external).toContain(unproven);
      expect(candidate.body.blocked_external).toContain(unproven);
    }
  });

  it('blocked_external contains exactly the 3 unproven items, nothing else', async () => {
    const { body } = await getReady(CANDIDATE_EQUIVALENT_ENV);
    expect([...body.blocked_external].sort()).toEqual([...UNPROVEN_BLOCKERS].sort());
  });
});

describe('SUN-1220Q2 — /ready global status/phase/reason preservation', () => {
  it('status/phase/reason unchanged by env for known-good', async () => {
    const { body } = await getReady(KNOWN_GOOD_EQUIVALENT_ENV);
    expect(body.status).toBe('not_ready');
    expect(body.phase).toBe('foundation');
    expect(body.reason).toBe(
      'Service contracts and production dependencies are not yet verified. Only health/readiness endpoints available.'
    );
  });

  it('status/phase/reason unchanged by env for fully qualified candidate (global platform readiness is broader than one service)', async () => {
    const { body } = await getReady(CANDIDATE_EQUIVALENT_ENV);
    expect(body.status).toBe('not_ready');
    expect(body.phase).toBe('foundation');
    expect(body.reason).toBe(
      'Service contracts and production dependencies are not yet verified. Only health/readiness endpoints available.'
    );
  });
});

describe('SUN-1220Q2 — /ready vs /catalog cross-surface coherence', () => {
  async function getCatalogV2Active(extraEnv: Record<string, unknown>) {
    const res = await app.request('/catalog', {}, { ...extraEnv } as never);
    const body = (await res.json()) as {
      services: Array<{ service_id: string; production_enabled: boolean }>;
    };
    const svc = body.services.find((s) => s.service_id === 'verify_agent_output.v2');
    if (!svc) throw new Error('verify_agent_output.v2 not found in catalog response');
    return svc.production_enabled;
  }

  it('known-good: catalog selected-service inactive AND ready.production_services_enabled=false', async () => {
    const catalogActive = await getCatalogV2Active(KNOWN_GOOD_EQUIVALENT_ENV);
    const { body } = await getReady(KNOWN_GOOD_EQUIVALENT_ENV);
    expect(catalogActive).toBe(false);
    expect(body.production_services_enabled).toBe(false);
  });

  it('qualified: catalog selected-service active AND ready.production_services_enabled=true', async () => {
    const catalogActive = await getCatalogV2Active(CANDIDATE_EQUIVALENT_ENV);
    const { body } = await getReady(CANDIDATE_EQUIVALENT_ENV);
    expect(catalogActive).toBe(true);
    expect(body.production_services_enabled).toBe(true);
  });
});

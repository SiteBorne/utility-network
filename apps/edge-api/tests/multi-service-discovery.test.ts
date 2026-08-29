/**
 * SUN-1221C — proves public discovery truthfully represents TWO
 * simultaneously-active paid services (`verify_agent_output.v2` and
 * `web_context_verified.v2`), each independently, across `/catalog`,
 * `/services/<id>`, agent-card, and `/ready`. Mirrors
 * `discovery-truthfulness.test.ts`'s own harness exactly (same fake D1,
 * same env-variant convention) -- this file only adds the
 * MULTI-service dimension that single-service file's own tests, by
 * construction, never exercised.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import app from '../src/index';

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

const WEB_CONTEXT_V2_ROW = {
  id: 'web_context_verified.v2',
  version: '2.0.0',
  title: 'Verified Web Context',
  description: 'CDP-backed web context retrieval',
  input_schema: 'schema',
  output_schema: 'schema',
  price_usd: '0.009',
  production_enabled: 0,
  production_ready: 0,
  protocol_status: 'preproduction',
};

const OTHER_ROW = {
  id: 'company_evidence_graph.v1',
  version: '1.0.0',
  title: 'Company Evidence Graph',
  description: 'Verify company evidence',
  input_schema: 'schema',
  output_schema: 'schema',
  price_usd: '0.039',
  production_enabled: 0,
  production_ready: 0,
  protocol_status: 'preproduction',
};

const ALL_ROWS = [VERIFY_V2_ROW, WEB_CONTEXT_V2_ROW, OTHER_ROW];

let d1Writes = 0;

function createFakeD1(): D1Database {
  const prepare = (sql: string) => ({
    bind: (..._params: unknown[]) => ({
      all: async () => {
        if (sql.includes('FROM services WHERE id')) {
          const id = _params[0];
          const row = ALL_ROWS.find((r) => r.id === id);
          return { success: true, results: row ? [row] : [] };
        }
        if (sql.includes('FROM services')) {
          return { success: true, results: ALL_ROWS };
        }
        return { success: true, results: [] };
      },
      run: async () => {
        if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) d1Writes += 1;
        return { success: true, results: [], meta: { changes: 0, last_row_id: 0 } };
      },
    }),
    all: async () => {
      if (sql.includes('FROM services')) {
        return { success: true, results: ALL_ROWS };
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

const KNOWN_GOOD_EQUIVALENT_ENV = {};

const BOTH_ACTIVE_ENV = {
  PAID_ROUTES_ENABLED: 'true',
  VERIFY_V2_CDP_ROUTE_ENABLED: 'true',
  WEB_CONTEXT_V2_CDP_ROUTE_ENABLED: 'true',
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

const ONLY_WEB_CONTEXT_ENV = { ...BOTH_ACTIVE_ENV, VERIFY_V2_CDP_ROUTE_ENABLED: 'false' };
const ONLY_VERIFY_ENV = { ...BOTH_ACTIVE_ENV, WEB_CONTEXT_V2_CDP_ROUTE_ENABLED: 'false' };

interface CatalogService {
  service_id: string;
  production_enabled: boolean;
  production_ready: boolean;
  protocol_status: string;
}

async function getCatalog(db: D1Database, extraEnv: Record<string, string> = {}) {
  const res = await app.request('/catalog', {}, { DB: db, ...extraEnv } as never);
  const body = (await res.json()) as { services: CatalogService[] };
  return { res, body };
}

function findService(body: { services: CatalogService[] }, id: string): CatalogService {
  const svc = body.services.find((s) => s.service_id === id);
  if (!svc) throw new Error(`service ${id} not found in catalog response`);
  return svc;
}

async function getReady(db: D1Database, extraEnv: Record<string, string> = {}) {
  const res = await app.request('/ready', {}, { DB: db, ...extraEnv } as never);
  const body = (await res.json()) as { production_services_enabled: boolean };
  return body;
}

async function getCardServices(db: D1Database, extraEnv: Record<string, string> = {}) {
  const res = await app.request(
    '/.well-known/agent-card.json',
    { headers: { Host: 'test.local' } },
    { DB: db, ...extraEnv } as never
  );
  const body = (await res.json()) as {
    capabilities: {
      extensions: Array<{ params: { services: Array<{ serviceId: string; productionEnabled: boolean }> } }>;
    };
  };
  return body.capabilities.extensions[0].params.services;
}

describe('SUN-1221C — multi-service /catalog truthfulness', () => {
  beforeEach(() => {
    d1Writes = 0;
  });

  it('both services truthfully active simultaneously when both flags are on', async () => {
    const db = createFakeD1();
    const { body } = await getCatalog(db, BOTH_ACTIVE_ENV);
    expect(findService(body, 'verify_agent_output.v2').production_enabled).toBe(true);
    expect(findService(body, 'web_context_verified.v2').production_enabled).toBe(true);
  });

  it('only web_context_verified.v2 active when only its own flag is on', async () => {
    const db = createFakeD1();
    const { body } = await getCatalog(db, ONLY_WEB_CONTEXT_ENV);
    expect(findService(body, 'web_context_verified.v2').production_enabled).toBe(true);
    expect(findService(body, 'verify_agent_output.v2').production_enabled).toBe(false);
  });

  it('only verify_agent_output.v2 active when only its own flag is on', async () => {
    const db = createFakeD1();
    const { body } = await getCatalog(db, ONLY_VERIFY_ENV);
    expect(findService(body, 'verify_agent_output.v2').production_enabled).toBe(true);
    expect(findService(body, 'web_context_verified.v2').production_enabled).toBe(false);
  });

  it('the remaining registered-inactive service (company_evidence_graph.v1) is never affected by either flag', async () => {
    const db = createFakeD1();
    const { body } = await getCatalog(db, BOTH_ACTIVE_ENV);
    expect(findService(body, 'company_evidence_graph.v1').production_enabled).toBe(false);
  });

  it('known-good-equivalent (all flags off) -> both services inactive', async () => {
    const db = createFakeD1();
    const { body } = await getCatalog(db, KNOWN_GOOD_EQUIVALENT_ENV);
    expect(findService(body, 'verify_agent_output.v2').production_enabled).toBe(false);
    expect(findService(body, 'web_context_verified.v2').production_enabled).toBe(false);
  });

  it('zero D1 writes across every multi-service gate combination', async () => {
    await getCatalog(createFakeD1(), BOTH_ACTIVE_ENV);
    await getCatalog(createFakeD1(), ONLY_WEB_CONTEXT_ENV);
    await getCatalog(createFakeD1(), ONLY_VERIFY_ENV);
    await getCatalog(createFakeD1(), KNOWN_GOOD_EQUIVALENT_ENV);
    expect(d1Writes).toBe(0);
  });
});

describe('SUN-1221C — /ready truthfully reflects "at least one" across two services', () => {
  it('both inactive -> production_services_enabled=false', async () => {
    const body = await getReady(createFakeD1(), KNOWN_GOOD_EQUIVALENT_ENV);
    expect(body.production_services_enabled).toBe(false);
  });

  it('only verify active -> production_services_enabled=true', async () => {
    const body = await getReady(createFakeD1(), ONLY_VERIFY_ENV);
    expect(body.production_services_enabled).toBe(true);
  });

  it('only web_context active -> production_services_enabled=true', async () => {
    const body = await getReady(createFakeD1(), ONLY_WEB_CONTEXT_ENV);
    expect(body.production_services_enabled).toBe(true);
  });

  it('both active -> production_services_enabled=true', async () => {
    const body = await getReady(createFakeD1(), BOTH_ACTIVE_ENV);
    expect(body.production_services_enabled).toBe(true);
  });
});

describe('SUN-1221C — agent-card truthfully reflects both services independently', () => {
  it('both services show productionEnabled=true when both flags are on', async () => {
    const services = await getCardServices(createFakeD1(), BOTH_ACTIVE_ENV);
    expect(services.find((s) => s.serviceId === 'verify_agent_output.v2')?.productionEnabled).toBe(
      true
    );
    expect(
      services.find((s) => s.serviceId === 'web_context_verified.v2')?.productionEnabled
    ).toBe(true);
  });

  it('only web_context_verified.v2 shows true when only its flag is on', async () => {
    const services = await getCardServices(createFakeD1(), ONLY_WEB_CONTEXT_ENV);
    expect(
      services.find((s) => s.serviceId === 'web_context_verified.v2')?.productionEnabled
    ).toBe(true);
    expect(services.find((s) => s.serviceId === 'verify_agent_output.v2')?.productionEnabled).toBe(
      false
    );
  });
});

describe('SUN-1221C — cross-surface coherence for web_context_verified.v2 (catalog vs agent-card vs /services/<id> vs /ready)', () => {
  it('/catalog, agent-card, /services/web_context_verified.v2, and /ready never disagree, for every combination of the two route flags', async () => {
    const flagCombos = [
      { VERIFY_V2_CDP_ROUTE_ENABLED: 'false', WEB_CONTEXT_V2_CDP_ROUTE_ENABLED: 'false' },
      { VERIFY_V2_CDP_ROUTE_ENABLED: 'true', WEB_CONTEXT_V2_CDP_ROUTE_ENABLED: 'false' },
      { VERIFY_V2_CDP_ROUTE_ENABLED: 'false', WEB_CONTEXT_V2_CDP_ROUTE_ENABLED: 'true' },
      { VERIFY_V2_CDP_ROUTE_ENABLED: 'true', WEB_CONTEXT_V2_CDP_ROUTE_ENABLED: 'true' },
    ];

    for (const combo of flagCombos) {
      const env = { ...BOTH_ACTIVE_ENV, ...combo };
      const db = createFakeD1();

      const { body: catalogBody } = await getCatalog(db, env);
      const catalogActive = findService(catalogBody, 'web_context_verified.v2').production_enabled;

      const cardServices = await getCardServices(db, env);
      const cardActive = cardServices.find(
        (s) => s.serviceId === 'web_context_verified.v2'
      )?.productionEnabled;

      const detailRes = await app.request(
        '/services/web_context_verified.v2',
        {},
        { DB: db, ...env } as never
      );
      const detail = (await detailRes.json()) as { production_enabled: boolean };

      const readyBody = await getReady(db, env);

      expect(cardActive, `combo=${JSON.stringify(combo)}`).toBe(catalogActive);
      expect(detail.production_enabled, `combo=${JSON.stringify(combo)}`).toBe(catalogActive);
      // /ready is "at least one" -- only assert it's true when THIS
      // service is active; when this service is inactive /ready may
      // still be true if the other one isn't in this combo's env, so
      // only the positive direction is a meaningful cross-check here.
      if (catalogActive) {
        expect(readyBody.production_services_enabled, `combo=${JSON.stringify(combo)}`).toBe(true);
      }
    }
  });
});

/**
 * SUN-1220P2 — proves public discovery truthfully reflects version-local
 * runtime paid-route state for `verify_agent_output.v2` / CDP.
 *
 * Root cause (SUN-1220P1): `/catalog`/`/services/<id>` read a shared D1
 * `services` row seeded `production_enabled=false`/
 * `protocol_status='preproduction'` and never updated; the agent card
 * (`packages/protocol-a2a/src/card.ts`) hardcoded `productionEnabled:
 * false` as a compile-time literal. Neither consulted the version-local
 * ADR-0055/route-flag gates that actually decide whether the route
 * executes (`production-verify-v2-cdp-route.ts`), so no single static
 * value could truthfully describe both a gated-off known-good version
 * and a qualified, gate-on candidate version.
 *
 * These tests exercise the real app (`../src/index`) end to end with a
 * fake D1 seeded exactly like the real migration, and two env variants:
 * known-good-equivalent (every gate off) and candidate-equivalent (every
 * gate on, matching SUN-1220M's qualified candidate configuration).
 */
import { describe, it, expect, beforeEach } from 'vitest';
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

// CATALOG-ROUTE-PARITY-01: this "unrelated other service" row must be a
// service_id `/catalog` actually lists (`company_evidence_graph.v2`, a real
// mounted `/v2/company/evidence-graph` route) -- a `.v1` id like the prior
// `company_evidence_graph.v1` no longer surfaces in `/catalog` at all, since
// every `/v1/*` path 404s. `company_evidence_graph.v2` has its own,
// independent EFFECTIVE_DISCOVERY_RESOLVERS entry, so it still proves the
// same isolation property this test asserts: `verify_agent_output.v2`'s
// gates never flip a different service's discovery state.
const OTHER_ROW = {
  id: 'company_evidence_graph.v2',
  version: '2.0.0',
  title: 'Company Evidence Graph',
  description: 'Verify company evidence',
  input_schema: 'schema',
  output_schema: 'schema',
  price_usd: '0.039',
  production_enabled: 0,
  production_ready: 0,
  protocol_status: 'preproduction',
};

let d1Writes = 0;

function createFakeD1(): D1Database {
  const prepare = (sql: string) => ({
    bind: (..._params: unknown[]) => ({
      all: async () => {
        if (sql.includes('FROM services WHERE id')) {
          const id = _params[0];
          const row = [VERIFY_V2_ROW, OTHER_ROW].find((r) => r.id === id);
          return { success: true, results: row ? [row] : [] };
        }
        if (sql.includes('FROM services')) {
          return { success: true, results: [VERIFY_V2_ROW, OTHER_ROW] };
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
        return { success: true, results: [VERIFY_V2_ROW, OTHER_ROW] };
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

const CANDIDATE_EQUIVALENT_ENV = {
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

async function getCatalog(db: D1Database, extraEnv: Record<string, string> = {}) {
  const res = await app.request('/catalog', {}, { DB: db, ...extraEnv } as never);
  const body = (await res.json()) as {
    services: Array<{
      service_id: string;
      production_enabled: boolean;
      production_ready: boolean;
      protocol_status: string;
    }>;
  };
  return { res, body };
}

function findService(body: { services: Array<{ service_id: string }> }, id: string) {
  const svc = body.services.find((s) => s.service_id === id);
  if (!svc) throw new Error(`service ${id} not found in catalog response`);
  return svc;
}

describe('SUN-1220P2 — /catalog discovery truthfulness for verify_agent_output.v2', () => {
  beforeEach(() => {
    d1Writes = 0;
  });

  it('A: known-good-equivalent gates (all off) → catalog production_enabled=false', async () => {
    const { body } = await getCatalog(createFakeD1(), KNOWN_GOOD_EQUIVALENT_ENV);
    const svc = findService(body, 'verify_agent_output.v2');
    expect(svc.production_enabled).toBe(false);
    expect(svc.protocol_status).toBe('preproduction');
  });

  it('B: candidate-equivalent gates (4/4 + route flags + bindings) → catalog production_enabled=true', async () => {
    const { body } = await getCatalog(createFakeD1(), CANDIDATE_EQUIVALENT_ENV);
    const svc = findService(body, 'verify_agent_output.v2');
    expect(svc.production_enabled).toBe(true);
    expect(svc.production_ready).toBe(true);
  });

  it('E (protocol_status): candidate-equivalent gates → protocol_status="production"', async () => {
    const { body } = await getCatalog(createFakeD1(), CANDIDATE_EQUIVALENT_ENV);
    expect(findService(body, 'verify_agent_output.v2').protocol_status).toBe('production');
  });

  it('F: master gate (PAID_ROUTES_ENABLED) false, all else true → discovery inactive', async () => {
    const { body } = await getCatalog(createFakeD1(), {
      ...CANDIDATE_EQUIVALENT_ENV,
      PAID_ROUTES_ENABLED: undefined as unknown as string,
    });
    expect(findService(body, 'verify_agent_output.v2').production_enabled).toBe(false);
  });

  it('G: route-specific gate (VERIFY_V2_CDP_ROUTE_ENABLED) false, all else true → discovery inactive', async () => {
    const { body } = await getCatalog(createFakeD1(), {
      ...CANDIDATE_EQUIVALENT_ENV,
      VERIFY_V2_CDP_ROUTE_ENABLED: 'false',
    });
    expect(findService(body, 'verify_agent_output.v2').production_enabled).toBe(false);
  });

  it('H: each individual ADR-0055 gate false → discovery inactive', async () => {
    for (const gate of [
      'PAYMENT_ENVIRONMENT',
      'PRODUCTION_ENABLED',
      'HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP',
      'PRODUCTION_CDP_CREDENTIALS_APPROVED',
    ] as const) {
      const env = { ...CANDIDATE_EQUIVALENT_ENV, [gate]: 'false' };
      const { body } = await getCatalog(createFakeD1(), env);
      expect(
        findService(body, 'verify_agent_output.v2').production_enabled,
        `expected inactive with ${gate}=false`
      ).toBe(false);
    }
  });

  it('I: missing required runtime dependency (signing key) → discovery stays inactive, never falsely active', async () => {
    const env = { ...CANDIDATE_EQUIVALENT_ENV, PAID_RECEIPT_SIGNING_PRIVATE_KEY: undefined as unknown as string };
    const { body } = await getCatalog(createFakeD1(), env);
    expect(findService(body, 'verify_agent_output.v2').production_enabled).toBe(false);
  });

  it('N: static D1 row alone (production_enabled=0 seed) cannot force active when runtime gates are false', async () => {
    // The fake D1 always seeds production_enabled=0/preproduction; with
    // no gates set this must stay false -- proving the overlay is an
    // override, not an OR against a possibly-mutated D1 value.
    const { body } = await getCatalog(createFakeD1(), {});
    expect(findService(body, 'verify_agent_output.v2').production_enabled).toBe(false);
  });

  it('N2: a D1 row that already (incorrectly) says production_enabled=1 is still overridden to false when runtime gates are off', async () => {
    // Proves the overlay OVERRIDES the static value in both directions,
    // not just raises it -- a stale/mutated-true D1 row must never leak
    // through as "active" on a version whose runtime gates are off (the
    // exact SUN-1220P known-good-side contradiction risk SUN-1220P1 §7
    // identified for a direct D1 write).
    const staleTrueD1 = createFakeD1();
    const original = (staleTrueD1.prepare as (sql: string) => { all: () => Promise<unknown> })(
      'SELECT * FROM services'
    );
    void original;
    const db: D1Database = {
      ...staleTrueD1,
      prepare: (sql: string) => {
        const base = (
          staleTrueD1.prepare as (
            s: string
          ) => { bind: (...p: unknown[]) => { all: () => Promise<unknown> }; all: () => Promise<unknown> }
        )(sql);
        const staleRow = { ...VERIFY_V2_ROW, production_enabled: 1, protocol_status: 'production' };
        return {
          bind: (..._params: unknown[]) => ({
            all: async () => {
              if (sql.includes('FROM services WHERE id')) {
                return { success: true, results: _params[0] === 'verify_agent_output.v2' ? [staleRow] : [] };
              }
              return base.bind(..._params).all();
            },
          }),
          all: async () => {
            if (sql.includes('FROM services')) {
              return { success: true, results: [staleRow, OTHER_ROW] };
            }
            return base.all();
          },
        };
      },
    } as unknown as D1Database;

    const { body } = await getCatalog(db, KNOWN_GOOD_EQUIVALENT_ENV);
    expect(findService(body, 'verify_agent_output.v2').production_enabled).toBe(false);
  });

  it('P (other-route isolation): other paid service rows are never flipped by verify_agent_output.v2 gates', async () => {
    const { body } = await getCatalog(createFakeD1(), CANDIDATE_EQUIVALENT_ENV);
    const other = findService(body, 'company_evidence_graph.v2');
    expect(other.production_enabled).toBe(false);
    expect(other.protocol_status).toBe('preproduction');
  });

  it('R/S: no D1 write occurs while serving /catalog under any gate state', async () => {
    await getCatalog(createFakeD1(), CANDIDATE_EQUIVALENT_ENV);
    await getCatalog(createFakeD1(), KNOWN_GOOD_EQUIVALENT_ENV);
    expect(d1Writes).toBe(0);
  });

  it('/services/verify_agent_output.v2 agrees with /catalog for the same env', async () => {
    const db = createFakeD1();
    const { body: catalogBody } = await getCatalog(db, CANDIDATE_EQUIVALENT_ENV);
    const res = await app.request(
      '/services/verify_agent_output.v2',
      {},
      { DB: db, ...CANDIDATE_EQUIVALENT_ENV } as never
    );
    const detail = (await res.json()) as { production_enabled: boolean; protocol_status: string };
    const fromCatalog = findService(catalogBody, 'verify_agent_output.v2');
    expect(detail.production_enabled).toBe(fromCatalog.production_enabled);
    expect(detail.protocol_status).toBe(fromCatalog.protocol_status);
    expect(detail.production_enabled).toBe(true);
  });
});

describe('SUN-1220P2 — agent-card discovery truthfulness for verify_agent_output.v2', () => {
  async function getCard(db: D1Database, extraEnv: Record<string, string> = {}) {
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
    const services = body.capabilities.extensions[0].params.services;
    const svc = services.find((s) => s.serviceId === 'verify_agent_output.v2');
    if (!svc) throw new Error('verify_agent_output.v2 not found in agent card');
    return svc;
  }

  it('C: known-good-equivalent gates → agent-card productionEnabled=false', async () => {
    const svc = await getCard(createFakeD1(), KNOWN_GOOD_EQUIVALENT_ENV);
    expect(svc.productionEnabled).toBe(false);
  });

  it('D: candidate-equivalent gates → agent-card productionEnabled=true', async () => {
    const svc = await getCard(createFakeD1(), CANDIDATE_EQUIVALENT_ENV);
    expect(svc.productionEnabled).toBe(true);
  });
});

describe('SUN-1220P2 — cross-surface coherence (/catalog vs agent-card)', () => {
  it('U: for every ADR-0055-gate permutation, /catalog and agent-card never disagree for verify_agent_output.v2', async () => {
    const gateNames = [
      'PAID_ROUTES_ENABLED',
      'VERIFY_V2_CDP_ROUTE_ENABLED',
      'PAYMENT_ENVIRONMENT',
      'PRODUCTION_ENABLED',
      'HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP',
      'PRODUCTION_CDP_CREDENTIALS_APPROVED',
    ] as const;

    for (let mask = 0; mask < 1 << gateNames.length; mask++) {
      const env: Record<string, string> = { ...CANDIDATE_EQUIVALENT_ENV };
      gateNames.forEach((name, i) => {
        if (!((mask >> i) & 1)) {
          if (name === 'PAYMENT_ENVIRONMENT') env[name] = 'preproduction';
          else env[name] = 'false';
        }
      });

      const db = createFakeD1();
      const { body: catalogBody } = await getCatalog(db, env);
      const catalogActive = findService(catalogBody, 'verify_agent_output.v2').production_enabled;

      const cardRes = await app.request(
        '/.well-known/agent-card.json',
        { headers: { Host: 'test.local' } },
        { DB: db, ...env } as never
      );
      const cardBody = (await cardRes.json()) as {
        capabilities: {
          extensions: Array<{
            params: { services: Array<{ serviceId: string; productionEnabled: boolean }> };
          }>;
        };
      };
      const cardActive = cardBody.capabilities.extensions[0].params.services.find(
        (s) => s.serviceId === 'verify_agent_output.v2'
      )?.productionEnabled;

      expect(cardActive, `mask=${mask} catalog=${catalogActive} card=${cardActive}`).toBe(
        catalogActive
      );

      // The mask is "all six gates true" only when mask === (1<<6)-1, and
      // even then production_ready/dependency presence must hold -- so
      // only the all-true mask combined with CANDIDATE_EQUIVALENT_ENV's
      // dependency fields is expected active.
      const allSixTrue = mask === (1 << gateNames.length) - 1;
      expect(catalogActive).toBe(allSixTrue);
    }
  });
});

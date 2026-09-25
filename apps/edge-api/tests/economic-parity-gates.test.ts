/**
 * PRODUCTION-ECONOMICS-DISCOVERY-01 -- the deterministic economic parity gates.
 * Each describe is named `GATE:<NAME>`; scripts/economics-discovery-gates.mts
 * maps them to the release-gate block. No network, no provider, no payment.
 */
import { readFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parse } from 'yaml';
import { isAddress } from 'viem';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ALL_BAZAAR_SERVICE_IDS,
  ECONOMIC_SERVICE_IDS,
  buildEconomicOffer,
  buildSiteborneDiscoveryDeclaration,
  challengePricingKey,
  checkModeAvailability,
  compareEconomicProjections,
  decodePaymentRequiredHeaderSafe,
  projectServiceEconomics,
  purchasableInputExample,
  resolveMaxDocumentPages,
  usdToAtomicUnits,
  validateBazaarDeclarationEconomics,
  validateEconomicProjection,
  V2_PAID_SERVICE_IDS,
  V3_CANDIDATE_SERVICE_IDS,
  REGISTRY_SERVICES,
  type EconomicOfferProjection,
  type PaymentDestination,
  type SiteborneServiceId,
} from '@siteborne/protocol-x402';
import { MCP_PROTOCOL_VERSION, createSiteborneMcpHonoApp } from '@siteborne/protocol-mcp';
import {
  getRuntimeEffectiveView,
  buildRealA2aShadowContext,
  projectA2aFromVcm,
} from '@siteborne/vcm';
import { app } from '../src/index';
import { buildPaidServicesApp } from '../src/control-plane/routes/paid-services';
import { resolvePublicPaymentDestination } from '../src/control-plane/config/production-payment';
import { catalogRoute, serviceMetadataRoute } from '../src/control-plane/routes/catalog';
import { InMemoryServicesRepository } from '../src/control-plane/repositories/in-memory';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf-8');
const PAY_TO = '0x2222222222222222222222222222222222222222';
/** Preproduction gates: every surface, including the fixture 402 route, resolves the same network. */
const ENV = { SELLER_WALLET_ADDRESS: PAY_TO } as Record<string, string>;
const DESTINATION = resolvePublicPaymentDestination(ENV)!;
const HOST = { headers: { Host: 'test.local' } };

const governance = parse(read('governance/RISK_LIMITS.yaml')) as {
  version: string;
  financial_limits: { max_price_usd_per_service: Record<string, number> };
  operational_limits: { max_document_pages: number };
};
const govPrice = (key: string) =>
  String(governance.financial_limits.max_price_usd_per_service[key]);

type Surfaces = Record<string, Map<SiteborneServiceId, EconomicOfferProjection>>;
let surfaces: Surfaces;
let http402: Map<
  string,
  {
    scheme: string;
    amount: string;
    network: string;
    asset: string;
    payTo: string;
    resource: string;
  }
>;
let mf: Miniflare;
let tempDir: string;

function migrate(db: D1Database) {
  const dir = join(REPO, 'migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .reduce(async (prev, file) => {
      await prev;
      const stmts = readFileSync(join(dir, file), 'utf-8')
        .split(';')
        .map((r) =>
          r
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('--'))
            .join(' ')
            .trim()
        )
        .filter(Boolean);
      for (const s of stmts) await db.exec(s);
    }, Promise.resolve());
}

beforeAll(async () => {
  surfaces = {};
  // A2A card (served)
  const card = (await (
    await app.request('/.well-known/agent-card.json', HOST, ENV as never)
  ).json()) as {
    capabilities: {
      extensions: {
        params: {
          services: { serviceId: SiteborneServiceId; economics: EconomicOfferProjection }[];
        };
      }[];
    };
  };
  surfaces.a2a = new Map(
    card.capabilities.extensions[0].params.services.map((s) => [s.serviceId, s.economics])
  );
  // OpenAPI (served; v2 production + v3 Release-3 candidates)
  const openapi = (await (await app.request('/openapi.json', HOST, ENV as never)).json()) as {
    paths: Record<
      string,
      {
        post?: {
          'x-service-id': SiteborneServiceId;
          'x-siteborne-economics': EconomicOfferProjection;
        };
      }
    >;
  };
  surfaces.openapi = new Map(
    Object.values(openapi.paths)
      .filter((p) => p.post)
      .map((p) => [p.post!['x-service-id'], p.post!['x-siteborne-economics']])
  );
  // catalog
  const repo = new InMemoryServicesRepository();
  for (const [id, e] of Object.entries(REGISTRY_SERVICES)) {
    await repo.create({
      service_id: id,
      version: e.service_version,
      title: e.title,
      description: e.description,
      price_usd: '0',
      production_enabled: false,
      production_ready: false,
      protocol_status: 'preproduction',
      input_schema: e.input_schema_uri,
      output_schema: e.output_schema_uri,
    } as never);
  }
  const site = new Hono();
  site.use('*', async (c, next) => {
    c.set('servicesRepo', repo);
    await next();
  });
  site.route('/catalog', catalogRoute);
  site.route('/services', serviceMetadataRoute);
  const catalog = (await (await site.request('/catalog', undefined, ENV as never)).json()) as {
    services: {
      service_id: SiteborneServiceId;
      economics: EconomicOfferProjection;
      price_usd: string;
      price_unit: string;
    }[];
  };
  surfaces.catalog = new Map(catalog.services.map((s) => [s.service_id, s.economics]));
  // VCM effective view -> A2A projection
  const effective = await getRuntimeEffectiveView('0'.repeat(40));
  const vcmCard = projectA2aFromVcm(effective, buildRealA2aShadowContext({}, false, DESTINATION));
  surfaces.vcm = new Map(
    vcmCard.capabilities.extensions[0].params.services.map((s) => [
      s.serviceId as SiteborneServiceId,
      s.economics,
    ])
  );
  // Bazaar
  surfaces.bazaar = new Map();
  for (const serviceId of ALL_BAZAAR_SERVICE_IDS) {
    const d = await buildSiteborneDiscoveryDeclaration({
      serviceId,
      nowIso: '2026-01-01T00:00:00.000Z',
      expiresInSeconds: 300,
      maxTimeoutSeconds: 30,
      destination: DESTINATION,
    });
    expect(validateBazaarDeclarationEconomics(d)).toEqual([]);
    surfaces.bazaar.set(serviceId, d.economics);
  }
  // MCP get_quote (canonical scheme per service)
  const mcp = createSiteborneMcpHonoApp({
    allowedHosts: ['test.local'],
    allowedOrigins: ['test.local'],
    health: { production_ready: false, production_enabled: false },
    quote: {
      network: DESTINATION.network as never,
      asset: DESTINATION.asset,
      payee: DESTINATION.payTo,
    },
  });
  const client = new Client(
    { name: 'parity', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: MCP_PROTOCOL_VERSION } } }
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
      fetch: async (i, init) => {
        const h = new Headers(init?.headers);
        h.set('Host', 'test.local');
        return mcp.fetch(new Request(i, { ...init, headers: h }));
      },
    })
  );
  surfaces.mcp = new Map();
  const quotes = new Map<
    string,
    { amount: string; scheme: string; economics: EconomicOfferProjection }
  >();
  for (const id of V2_PAID_SERVICE_IDS) {
    const result = await client.callTool({
      name: 'siteborne_get_quote',
      arguments: {
        service_id: id,
        scheme: buildEconomicOffer(id).scheme,
        input: purchasableInputExample(id),
      },
    });
    const q = result.structuredContent as {
      amount: string;
      scheme: string;
      economics: EconomicOfferProjection;
    };
    quotes.set(id, q);
    surfaces.mcp.set(id, q.economics);
  }
  await client.close();
  (surfaces as unknown as Record<string, unknown>).__quotes = quotes;
  // HTTP x402 402 challenges (real route boundary, fixture evidence, real D1)
  tempDir = mkdtempSync(join(tmpdir(), 'siteborne-parity-'));
  mf = new Miniflare({
    modules: true,
    script: `export default { async fetch() { return new Response('OK'); } }`,
    d1Databases: ['DB'],
    resourcePersistencePath: tempDir,
  });
  const db = await mf.getD1Database('DB');
  await db.exec('PRAGMA foreign_keys = ON');
  await migrate(db);
  const paid = await buildPaidServicesApp({ db, evidenceMode: 'fixture', payTo: PAY_TO });
  http402 = new Map();
  const INPUTS: Record<string, [string, unknown]> = {
    'company_evidence_graph.v2': [
      '/v2/company/evidence-graph',
      {
        identifiers: { cik: '0000320193' },
        requested_field_groups: ['identity', 'sec_submissions'],
      },
    ],
    'web_context_verified.v2': [
      '/v2/web/context',
      purchasableInputExample('web_context_verified.v2'),
    ],
    'document_evidence_json.v2': [
      '/v2/document/evidence-json',
      {
        artifact_reference: {
          artifact_id: 'doc/native-fixture.pdf',
          media_type: 'application/pdf',
          size_bytes: 1,
        },
      },
    ],
    'verify_agent_output.v2': [
      '/v2/verify/agent-output',
      purchasableInputExample('verify_agent_output.v2'),
    ],
  };
  for (const [id, [path, body]] of Object.entries(INPUTS)) {
    const res = await paid.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const decoded = decodePaymentRequiredHeaderSafe(res.headers.get('PAYMENT-REQUIRED') ?? '');
    if (res.status !== 402 || !decoded.ok)
      throw new Error(`${id}: expected a decodable 402, got ${res.status}`);
    const a = (
      decoded.value as {
        accepts: {
          scheme: string;
          amount: string;
          network: string;
          asset: string;
          payTo: string;
        }[];
        resource?: { url: string };
      }
    ).accepts[0];
    http402.set(id, {
      ...a,
      resource: (decoded.value as { resource?: { url: string } }).resource?.url ?? '',
    });
  }
}, 60_000);

afterAll(async () => {
  await mf?.dispose();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

const quotes = () =>
  (surfaces as unknown as { __quotes: Map<string, { amount: string; scheme: string }> }).__quotes;
const strip = (p: EconomicOfferProjection) =>
  JSON.parse(JSON.stringify(p)) as EconomicOfferProjection;

describe('GATE:ECONOMIC_CANONICAL_MODEL', () => {
  it('covers eight ids, validates clean, and equals the raw governance YAML value for value', () => {
    for (const id of ECONOMIC_SERVICE_IDS) {
      const p = projectServiceEconomics(id, { productionEnabled: false, destination: DESTINATION });
      expect(validateEconomicProjection(p), id).toEqual([]);
      for (const mode of p.modes) {
        const key = buildEconomicOffer(id).modes.find((m) => m.mode === mode.mode)!.pricingKey;
        expect(mode.amount, `${id}/${mode.mode}`).toBe(govPrice(key));
      }
      expect(p.pricing_source_version).toBe(governance.version);
    }
  });
});

describe('GATE:ECONOMIC_PROJECTION_PARITY', () => {
  it.each(['a2a', 'vcm', 'bazaar'])(
    '%s equals the canonical projection for all twelve ids (governance ⇄ VCM ⇄ surface)',
    (surface) => {
      for (const id of ECONOMIC_SERVICE_IDS) {
        const expected = projectServiceEconomics(id, {
          productionEnabled: false,
          destination: DESTINATION,
        });
        expect(
          compareEconomicProjections(expected, surfaces[surface].get(id)!),
          `${surface}/${id}`
        ).toEqual([]);
      }
    }
  );
  // CATALOG-ROUTE-PARITY-01: `/catalog` is grouped with `openapi`, not with
  // `a2a`/`vcm`/`bazaar` above -- those three are discovery-only surfaces
  // that deliberately declare all twelve identities (including the four
  // dead `.v1` ones, for historical/compat discovery purposes), while
  // `/catalog` and `/openapi.json` both now describe only the eight
  // services with a real, reachable mounted route (`V2_PAID_SERVICE_IDS` +
  // `V3_CANDIDATE_SERVICE_IDS`). A `.v1` catalog entry would advertise a
  // route index.ts hard-404s.
  it.each(['openapi', 'catalog'])(
    '%s equals the canonical projection for the four v2 + four v3 candidate ids',
    (surface) => {
      expect(surfaces[surface].size).toBe(8);
      for (const id of [...V2_PAID_SERVICE_IDS, ...V3_CANDIDATE_SERVICE_IDS]) {
        const expected = projectServiceEconomics(id, {
          productionEnabled: false,
          destination: DESTINATION,
        });
        expect(
          compareEconomicProjections(expected, surfaces[surface].get(id)!),
          `${surface}/${id}`
        ).toEqual([]);
      }
    }
  );
  it.each(['mcp'])('%s equals the canonical projection for the four v2 ids', (surface) => {
    expect(surfaces[surface].size).toBe(4);
    for (const id of V2_PAID_SERVICE_IDS) {
      const expected = projectServiceEconomics(id, {
        productionEnabled: false,
        destination: DESTINATION,
      });
      expect(
        compareEconomicProjections(expected, surfaces[surface].get(id)!),
        `${surface}/${id}`
      ).toEqual([]);
    }
  });
  it('every pair of surfaces agrees pairwise (no surface is an independent authority)', () => {
    const names = Object.keys(surfaces).filter((n) => !n.startsWith('__'));
    for (const id of V2_PAID_SERVICE_IDS) {
      for (const a of names)
        for (const b of names) {
          expect(
            compareEconomicProjections(surfaces[a].get(id)!, surfaces[b].get(id)!),
            `${a}⇄${b} ${id}`
          ).toEqual([]);
        }
    }
  });
});

describe('GATE:EXACT_PRICE_PARITY', () => {
  it.each([
    'company_evidence_graph.v2',
    'web_context_verified.v2',
    'verify_agent_output.v2',
  ] as const)(
    '%s: governance == MCP quote == HTTP 402 == A2A == catalog == OpenAPI == Bazaar',
    (id) => {
      const key = challengePricingKey(id);
      const atomic = usdToAtomicUnits(govPrice(key), 6);
      expect(quotes().get(id)!.amount).toBe(atomic);
      expect(http402.get(id)!.amount).toBe(atomic);
      expect(http402.get(id)!.scheme).toBe('exact');
      for (const s of ['a2a', 'catalog', 'openapi', 'bazaar', 'vcm', 'mcp']) {
        expect(surfaces[s].get(id)!.list_amount, `${s}`).toBe(govPrice(key));
      }
    }
  );
  it('the HTTP 402 destination equals the projected destination', () => {
    for (const id of V2_PAID_SERVICE_IDS) {
      const c = http402.get(id)!;
      expect({ network: c.network, asset: c.asset, payTo: c.payTo }).toEqual({ ...DESTINATION });
      expect(new URL(c.resource).pathname).toBe(new URL(surfaces.a2a.get(id)!.resource).pathname);
    }
  });
});

describe('GATE:UPTO_PRICE_PARITY', () => {
  it('document: authorization maximum equal on governance, MCP quote, HTTP 402 and every surface', () => {
    const id = 'document_evidence_json.v2';
    const atomic = usdToAtomicUnits(govPrice('document_evidence_json_max_job'), 6);
    expect(http402.get(id)!.scheme).toBe('upto');
    expect(http402.get(id)!.amount).toBe(atomic);
    expect(quotes().get(id)!.amount).toBe(atomic);
    expect(quotes().get(id)!.scheme).toBe('upto');
    for (const s of ['a2a', 'catalog', 'openapi', 'bazaar', 'vcm', 'mcp']) {
      const p = surfaces[s].get(id)!;
      expect(p.authorization_maximum, s).toBe(govPrice('document_evidence_json_max_job'));
      expect(p.list_amount, s).toBeNull();
      expect(p.actual_settlement_model, s).toBe('measured_usage_not_exceeding_authorization');
    }
  });
});

describe('GATE:TIER_PRICE_PARITY', () => {
  it('per-page tier schedule, unit and usage semantics equal governance on every surface', () => {
    const expected = [
      { tier: 'native', unit: 'page', amount: govPrice('document_evidence_json_native_v2') },
      { tier: 'ocr', unit: 'page', amount: govPrice('document_evidence_json_ocr_v2') },
      { tier: 'table', unit: 'page', amount: govPrice('document_evidence_json_table_v2') },
    ];
    const semantics = strip(
      surfaces.a2a.get('document_evidence_json.v2')!
    ).measured_usage_semantics;
    for (const s of ['a2a', 'catalog', 'openapi', 'bazaar', 'vcm', 'mcp']) {
      const p = surfaces[s].get('document_evidence_json.v2')!;
      expect(p.tier_prices, s).toEqual(expected);
      expect(p.price_unit, s).toBe('page');
      expect(p.measured_usage_semantics, s).toEqual(semantics);
    }
  });
});

describe('GATE:MODE_AVAILABILITY_PRICE_ALIGNMENT', () => {
  it('a mode is advertised as available on every surface iff the runtime gate accepts it', () => {
    const cases: [SiteborneServiceId, string, string][] = [
      ['web_context_verified.v2', 'retrieval_mode', 'web'],
      ['verify_agent_output.v2', 'verification_mode', 'verify'],
    ];
    for (const [id, field] of cases) {
      for (const s of Object.keys(surfaces).filter((n) => !n.startsWith('__'))) {
        const p = surfaces[s].get(id);
        if (!p) continue;
        for (const mode of p.modes) {
          const runtimeOk = checkModeAvailability(id, { [field]: mode.mode }).ok;
          expect(mode.capability_available, `${s}/${id}/${mode.mode}`).toBe(runtimeOk);
          expect(p.available_modes.includes(mode.mode), `${s}/${id}/${mode.mode}`).toBe(runtimeOk);
          expect(mode.price_defined).toBe(true);
        }
      }
    }
  });
  it('the first-release posture: web direct + verify standard candidates; rendered/reproduction unavailable', () => {
    expect(surfaces.a2a.get('web_context_verified.v2')!.available_modes).toEqual(['direct']);
    expect(surfaces.a2a.get('verify_agent_output.v2')!.available_modes).toEqual(['standard']);
    expect(surfaces.a2a.get('company_evidence_graph.v2')!.release_posture).toBe(
      'defined_not_production_admitted'
    );
    expect(surfaces.a2a.get('document_evidence_json.v2')!.release_posture).toBe(
      'defined_not_production_admitted'
    );
    for (const s of Object.keys(surfaces).filter((n) => !n.startsWith('__'))) {
      for (const p of surfaces[s].values()) expect(p.production_enabled, s).toBe(false);
    }
  });
});

describe('GATE:PRICE_MAP_DISCOVERABLE', () => {
  it('each purchasable capability/mode is machine-discoverable with every commercial field', () => {
    for (const id of V2_PAID_SERVICE_IDS) {
      const p = surfaces.openapi.get(id)!;
      for (const field of [
        'resource',
        'scheme',
        'pricing_model',
        'price_unit',
        'currency',
        'actual_settlement_model',
        'modes',
        'default_mode',
        'available_modes',
        'production_enabled',
        'pricing_source_version',
        'payment',
        'service_version',
        'capability_id',
      ] as const) {
        expect(p[field], `${id}.${field}`).not.toBeUndefined();
      }
      expect(p.payment).toEqual({
        network: DESTINATION.network,
        asset: DESTINATION.asset,
        pay_to: DESTINATION.payTo,
      });
      for (const m of p.modes) expect(m.amount).toMatch(/^\d+\.\d+$/);
    }
    const doc = surfaces.catalog.get('document_evidence_json.v2')!;
    expect(doc.tier_prices).toHaveLength(3);
    expect(doc.list_amount).toBeNull(); // tiered pricing is never flattened into one price
  });
});

describe('GATE:PAYTO_PROJECTION', () => {
  it('the committed governed public receiver derives a real destination; absent/malformed derive null, never a sentinel', () => {
    const wrangler = read('wrangler.toml');
    const address = /SELLER_WALLET_ADDRESS\s*=\s*"(0x[0-9a-fA-F]{40})"/.exec(wrangler)?.[1];
    expect(address, 'SELLER_WALLET_ADDRESS is a committed public var').toBeTruthy();
    expect(isAddress(address!, { strict: true })).toBe(true);
    const prod = resolvePublicPaymentDestination({
      SELLER_WALLET_ADDRESS: address,
      PAYMENT_ENVIRONMENT: 'production',
      PRODUCTION_ENABLED: 'true',
      HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: 'true',
      PRODUCTION_CDP_CREDENTIALS_APPROVED: 'true',
    })!;
    expect(prod.payTo).toBe(address);
    expect(prod.network).toBe('eip155:8453');
    expect(prod.asset).toMatch(/^0x[0-9a-fA-F]{40}$/);
    for (const bad of ['', '0xnope', 'siteborne-fixture:payto-not-configured']) {
      expect(resolvePublicPaymentDestination({ SELLER_WALLET_ADDRESS: bad })).toBeNull();
    }
    expect(resolvePublicPaymentDestination({})).toBeNull();
  });
  it('no production-enabled projection can carry a missing or sentinel payTo', () => {
    const p = projectServiceEconomics('web_context_verified.v2', {
      productionEnabled: true,
      destination: null,
    });
    expect(validateEconomicProjection(p).join()).toContain('no payment destination');
    expect(read('packages/protocol-x402/src/bazaar/discovery.ts')).toContain(
      'PAYTO_NOT_CONFIGURED'
    );
    expect(
      validateEconomicProjection({
        ...p,
        payment: { network: 'x', asset: 'y', pay_to: 'siteborne-fixture:payto-not-configured' },
      }).join()
    ).toContain('sentinel or malformed');
  });
  it('no wallet literal is hard-coded in the projection sources', () => {
    for (const rel of [
      'packages/pricing/src/economic-contract.ts',
      'packages/protocol-x402/src/pricing/economic.ts',
      'packages/protocol-x402/src/openapi/paid-operations.ts',
    ]) {
      expect(read(rel).match(/0x[0-9a-fA-F]{40}/g) ?? [], rel).toEqual([]);
    }
  });
  it('the production compositions bind the canonical challenge key and the governed receiver', () => {
    const files: [SiteborneServiceId, string][] = [
      ['company_evidence_graph.v2', 'company-evidence-graph-v2-cdp-composition.ts'],
      ['web_context_verified.v2', 'web-context-v2-cdp-composition.ts'],
      ['document_evidence_json.v2', 'document-evidence-json-v2-cdp-composition.ts'],
      ['verify_agent_output.v2', 'verify-agent-output-v2-cdp-composition.ts'],
    ];
    for (const [id, file] of files) {
      const src = read(`apps/edge-api/src/control-plane/production/${file}`);
      expect(/pricingKey:\s*'(\w+)'/.exec(src)?.[1], id).toBe(challengePricingKey(id));
      expect(src).toContain('payTo: env.SELLER_WALLET_ADDRESS');
    }
  });
});

describe('GATE:DOCUMENT_LIMIT_PARITY', () => {
  it('governance == runtime enforcement == input schema == every projection', () => {
    const limit = governance.operational_limits.max_document_pages;
    expect(resolveMaxDocumentPages()).toBe(limit);
    expect(
      Number(
        /MAX_PAGES\s*=\s*(\d+)/.exec(
          read('services/modal-worker/src/modal_worker/document/models.py')
        )![1]
      )
    ).toBe(limit);
    const schema = JSON.parse(
      read('contracts/releases/2.0.0/schemas/services/document-evidence-input.schema.json')
    ) as {
      properties: {
        declared_page_count: { maximum: number };
        page_range: { properties: { start: { maximum: number }; end: { maximum: number } } };
      };
    };
    expect(schema.properties.declared_page_count.maximum).toBe(limit);
    expect(schema.properties.page_range.properties.start.maximum).toBe(limit);
    expect(schema.properties.page_range.properties.end.maximum).toBe(limit);
    for (const s of ['a2a', 'catalog', 'openapi', 'bazaar', 'vcm', 'mcp']) {
      expect(surfaces[s].get('document_evidence_json.v2')!.limits, s).toEqual({
        max_document_pages: limit,
      });
    }
    for (const id of ['document_evidence_json.v1', 'document_evidence_json.v2'] as const) {
      expect(REGISTRY_SERVICES[id].declared_limitations.join(' '), id).toContain(
        `Maximum ${limit} pages`
      );
      expect(REGISTRY_SERVICES[id].declared_limitations.join(' '), id).not.toContain('100 pages');
    }
  });
  it('no served surface still says 100 pages', async () => {
    const texts = [
      JSON.stringify(
        await (await app.request('/.well-known/agent-card.json', HOST, ENV as never)).json()
      ),
      JSON.stringify(await (await app.request('/openapi.json', HOST, ENV as never)).json()),
    ];
    for (const t of texts) expect(t).not.toMatch(/100 pages/i);
  });
});

describe('GATE:CONTRADICTIONS_FAIL_QUALIFICATION', () => {
  const base = () => strip(surfaces.mcp.get('web_context_verified.v2')!);
  const doc = () => strip(surfaces.a2a.get('document_evidence_json.v2')!);
  const diff = (a: EconomicOfferProjection, b: EconomicOfferProjection) =>
    compareEconomicProjections(a, b).map((d) => d.path);

  it('MCP vs A2A amount, exact vs upto, payTo, network, asset, page limit, stale version all fail parity', () => {
    const a = base();
    expect(diff(a, { ...a, list_amount: '0.009' })).toEqual(['list_amount']);
    expect(diff(a, { ...a, scheme: 'upto' })).toContain('scheme');
    expect(
      diff(a, {
        ...a,
        payment: { ...a.payment!, pay_to: '0x3333333333333333333333333333333333333333' },
      })
    ).toEqual(['payment.pay_to']);
    expect(diff(a, { ...a, payment: { ...a.payment!, network: 'eip155:1' } })).toEqual([
      'payment.network',
    ]);
    expect(diff(a, { ...a, payment: { ...a.payment!, asset: '0xabc' } })).toEqual([
      'payment.asset',
    ]);
    expect(diff(doc(), { ...doc(), limits: { max_document_pages: 100 } })).toEqual([
      'limits.max_document_pages',
    ]);
    expect(diff(a, { ...a, pricing_source_version: '0.9.0' })).toEqual(['pricing_source_version']);
    expect(diff(a, { ...a, service_version: 'v1' })).toEqual(['service_version']);
  });
  it('an unavailable mode advertised as production-enabled / available fails validation', () => {
    const a = { ...base(), production_enabled: true, available_modes: ['direct', 'rendered'] };
    expect(validateEconomicProjection(a).join()).toContain(
      'available_modes lists rendered but the mode is unavailable'
    );
  });
  it('a v1 id posing as the current v2 commercial identity fails validation', () => {
    const v1 = strip(surfaces.a2a.get('web_context_verified.v1')!);
    expect(validateEconomicProjection({ ...v1, contract_role: 'current' }).join()).toContain(
      'non-v2 service id is projected as the current commercial identity'
    );
    expect(
      validateEconomicProjection({ ...base(), contract_role: 'compatibility' }).join()
    ).toContain('v2 service id is projected as a compatibility identity');
  });
  it('Bazaar declaring a capability that another surface marks unavailable fails', async () => {
    const d = await buildSiteborneDiscoveryDeclaration({
      serviceId: 'web_context_verified.v2',
      nowIso: '2026-01-01T00:00:00.000Z',
      expiresInSeconds: 300,
      maxTimeoutSeconds: 30,
      destination: DESTINATION,
    });
    const rendered = {
      ...d,
      economics: { ...d.economics, available_modes: ['direct', 'rendered'] },
    };
    expect(validateBazaarDeclarationEconomics(rendered).join()).toContain('unavailable');
    expect(diff(surfaces.a2a.get('web_context_verified.v2')!, rendered.economics)).toContain(
      'available_modes.1'
    );
  });
});

describe('GATE:SAFETY_STATE', () => {
  it('PAID_ROUTES_ENABLED is absent from committed config (fail-closed false) and no wrangler file changed', () => {
    expect(read('wrangler.toml')).not.toMatch(/PAID_ROUTES_ENABLED\s*=\s*"true"/);
    expect(read('apps/edge-api/src/control-plane/config/production-payment.ts')).toContain(
      "env.PAID_ROUTES_ENABLED === 'true'"
    );
  });
});

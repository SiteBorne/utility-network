/**
 * PRODUCTION-ECONOMICS-DISCOVERY-01 -- CANONICAL_URL_PROJECTION.
 *
 * Every URL a generated discovery surface projects (Agent Card and its x402
 * extension, MCP tools/list, served OpenAPI, /schemas index, catalog, Bazaar
 * declarations) must map to a known publication artifact or an explicitly
 * documented exception. An unclassified URL fails the test, so a dead canonical
 * URL can never qualify silently.
 *
 * Nothing here touches the network, DNS, Pages, or a Worker: "published" means
 * the source artifact exists in this repository and is byte-exact.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import {
  ALL_BAZAAR_SERVICE_IDS,
  CANONICAL_RESOURCE_ORIGIN,
  CANONICAL_SCHEMA_ORIGIN,
  buildSiteborneDiscoveryDeclaration,
  REGISTRY_SERVICES,
  type EconomicOfferProjection,
} from '@siteborne/protocol-x402';
import { MCP_PROTOCOL_VERSION, createSiteborneMcpHonoApp } from '@siteborne/protocol-mcp';
import { app } from '../src/index';
import {
  catalogRoute,
  openapiRoute,
  schemasRoute,
  serviceMetadataRoute,
} from '../src/control-plane/routes/catalog';
import { InMemoryServicesRepository } from '../src/control-plane/repositories/in-memory';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const SITE = join(REPO, 'apps', 'network-site');
const RELEASE = '2.0.0';
const ENV = {
  SELLER_WALLET_ADDRESS: '0x2222222222222222222222222222222222222222',
  PAYMENT_ENVIRONMENT: 'production',
  PRODUCTION_ENABLED: 'true',
  HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: 'true',
  PRODUCTION_CDP_CREDENTIALS_APPROVED: 'true',
};

/** Explicit, reasoned exceptions -- not silent passes. */
const EXTERNAL_IDENTITY = new Map([
  [
    'https://siteborne.com',
    'Provider organization homepage (Agent Card provider.url); a separate domain outside this repository publication scope.',
  ],
]);
const DOCUMENTED_FUTURE_TARGETS = new Map([
  [
    'https://utility.siteborne.net/schemas/proof-carrying-context.schema.json',
    'Frozen contract $id of the proof-carrying-context schema (an $id cannot change without a contract major). Its published copy is apps/network-site/schemas/proof-carrying-context.schema.json; serving it on the utility origin is a later publication action.',
  ],
]);
/** A non-active candidate release (e.g. Release 3) declares release-qualified
 * schema `$id`s/URIs on the utility origin so it can coexist with the active
 * release's validators (packages/verification/src/schema-registry.ts,
 * packages/protocol-mcp/src/frozen-contracts.ts, and
 * scripts/generate-network-site-publication.mts's CANDIDATE_SCHEMA_ORIGIN).
 * These are real, source-verified schemas -- hash-checked against their own
 * contract release -- but are never written to apps/network-site/schemas,
 * since that artifact serves only the currently active release. Live
 * reachability of a candidate URL is a later, separate publication action. */
const CANDIDATE_SCHEMA_ORIGIN = 'https://utility.siteborne.net/contracts';
function candidateReleaseSchemaPath(url: string): string | null {
  const m = /^https:\/\/utility\.siteborne\.net\/contracts\/([^/]+)\/schemas\/(.+)$/.exec(url);
  if (!m) return null;
  const [, version, rel] = m;
  const candidate = join(REPO, 'contracts', 'releases', version, 'schemas', rel);
  return existsSync(candidate) ? candidate : null;
}

/** Values under these paths are example data or the request origin, never a
 * projected link: OpenAPI `examples`/`servers`, and the Bazaar sample request /
 * response payloads (`extensions.bazaar.info`). */
const NOT_A_PROJECTED_LINK = /(^|\.)(examples?|servers)(\.|\[|$)|extensions\.bazaar\.info\./;

/** A JSON Schema `$schema` value is a standards-body dialect identifier, not a
 * SITEBORNE link; it is accepted only under that exact key. */
const STANDARD_DIALECTS = new Set(['https://json-schema.org/draft/2020-12/schema']);

function isStandardDialect(path: string, url: string): boolean {
  return path.endsWith('.$schema') && STANDARD_DIALECTS.has(url);
}

function countFiles(dir: string): number {
  return readdirSync(dir).reduce((n, entry) => {
    const full = join(dir, entry);
    return n + (statSync(full).isDirectory() ? countFiles(full) : 1);
  }, 0);
}

function collectUrls(node: unknown, path: string, out: { path: string; url: string }[]): void {
  if (typeof node === 'string') {
    if (/^https?:\/\/[^\s]+$/.test(node) && !NOT_A_PROJECTED_LINK.test(path))
      out.push({ path, url: node });
  } else if (Array.isArray(node)) {
    node.forEach((child, i) => collectUrls(child, `${path}[${i}]`, out));
  } else if (node && typeof node === 'object') {
    for (const [key, child] of Object.entries(node))
      collectUrls(child, path ? `${path}.${key}` : key, out);
  }
}

type Classification =
  | 'utility_route'
  | 'network_site_artifact'
  | 'external_identity'
  | 'compat_not_served'
  | 'documented_future_target'
  | 'candidate_release_target'
  | 'UNPUBLISHED';

const EXACT_ROUTES = new Set(
  app.routes.filter((r) => !r.path.includes('*') && !r.path.includes(':')).map((r) => r.path)
);

function classify(url: string, compatUnserved: ReadonlySet<string>): Classification {
  const parsed = new URL(url);
  if (EXTERNAL_IDENTITY.has(url)) return 'external_identity';
  if (DOCUMENTED_FUTURE_TARGETS.has(url)) return 'documented_future_target';
  if (url.startsWith(`${CANDIDATE_SCHEMA_ORIGIN}/`) && candidateReleaseSchemaPath(url))
    return 'candidate_release_target';
  if (parsed.origin === CANONICAL_RESOURCE_ORIGIN) {
    if (compatUnserved.has(url)) return 'compat_not_served';
    return EXACT_ROUTES.has(parsed.pathname) ? 'utility_route' : 'UNPUBLISHED';
  }
  if (parsed.origin === CANONICAL_SCHEMA_ORIGIN) {
    const path = parsed.pathname.replace(/\/$/, '') || '/';
    const candidates =
      path === '/'
        ? ['index.html']
        : path.startsWith('/schemas/')
          ? [path.slice(1)]
          : [path.slice(1), `${path.slice(1)}/index.html`];
    return candidates.some((c) => existsSync(join(SITE, c)) && !c.endsWith('/'))
      ? 'network_site_artifact'
      : 'UNPUBLISHED';
  }
  return 'UNPUBLISHED';
}

async function collectAllSurfaceUrls() {
  const surfaces: Record<string, { path: string; url: string }[]> = {};
  const add = (name: string, json: unknown) => {
    const out: { path: string; url: string }[] = [];
    collectUrls(json, '', out);
    surfaces[name] = out;
  };

  const cardRes = await app.request(
    '/.well-known/agent-card.json',
    { headers: { Host: 'test.local' } },
    ENV as never
  );
  const card = (await cardRes.json()) as {
    capabilities: {
      extensions: { params: { services: { economics: EconomicOfferProjection }[] } }[];
    };
  };
  add('a2a-card', card);
  const compat = new Set(
    card.capabilities.extensions[0].params.services
      .map((s) => s.economics)
      .filter(
        (e) =>
          e.contract_role === 'compatibility' &&
          e.release_posture === 'compatibility_not_admitted' &&
          !e.production_enabled
      )
      .map((e) => e.resource)
  );

  const openapi = await (
    await app.request('/openapi.json', { headers: { Host: 'test.local' } }, ENV as never)
  ).json();
  add('openapi', openapi);

  const mcp = createSiteborneMcpHonoApp({
    allowedHosts: ['test.local'],
    allowedOrigins: ['test.local'],
    health: { production_ready: false, production_enabled: false },
  });
  const client = new Client(
    { name: 'url-audit', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: MCP_PROTOCOL_VERSION } } }
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set('Host', 'test.local');
        return mcp.fetch(new Request(input, { ...init, headers }));
      },
    })
  );
  add('mcp-tools', (await client.listTools()).tools);
  await client.close();

  const repo = new InMemoryServicesRepository();
  for (const [id, entry] of Object.entries(REGISTRY_SERVICES)) {
    await repo.create({
      service_id: id,
      version: entry.service_version,
      title: entry.title,
      description: entry.description,
      price_usd: '0',
      production_enabled: false,
      production_ready: false,
      protocol_status: 'preproduction',
      input_schema: entry.input_schema_uri,
      output_schema: entry.output_schema_uri,
    } as never);
  }
  const site = new Hono();
  site.use('*', async (c, next) => {
    c.set('servicesRepo', repo);
    await next();
  });
  site.route('/catalog', catalogRoute);
  site.route('/services', serviceMetadataRoute);
  site.route('/schemas', schemasRoute);
  site.route('/', openapiRoute);
  add('catalog', await (await site.request('/catalog')).json());
  add('service-metadata', await (await site.request('/services/web_context_verified.v2')).json());
  add('schemas-index', await (await site.request('/schemas')).json());

  const bazaar = await Promise.all(
    ALL_BAZAAR_SERVICE_IDS.map((serviceId) =>
      buildSiteborneDiscoveryDeclaration({
        serviceId,
        nowIso: '2026-01-01T00:00:00.000Z',
        expiresInSeconds: 300,
        maxTimeoutSeconds: 30,
      })
    )
  );
  add('bazaar', bazaar);
  return { surfaces, compat };
}

describe('every projected URL maps to a known publication artifact or a documented exception', () => {
  it('leaves no unpublished URL on any generated surface', async () => {
    const { surfaces, compat } = await collectAllSurfaceUrls();
    const total = Object.values(surfaces).reduce((n, list) => n + list.length, 0);
    expect(total).toBeGreaterThan(40);
    const unpublished: string[] = [];
    const seen = new Map<Classification, Set<string>>();
    for (const [surface, list] of Object.entries(surfaces)) {
      for (const { path, url } of list) {
        const c = isStandardDialect(path, url) ? 'external_identity' : classify(url, compat);
        if (c === 'UNPUBLISHED') unpublished.push(`${surface} ${path} -> ${url}`);
        (seen.get(c) ?? seen.set(c, new Set()).get(c)!).add(url);
      }
    }
    expect(unpublished).toEqual([]);
    // the audit is meaningful: it observed every real class of URL
    for (const cls of [
      'utility_route',
      'network_site_artifact',
      'external_identity',
      'compat_not_served',
    ] as const) {
      expect(seen.get(cls)?.size ?? 0, cls).toBeGreaterThan(0);
    }
  });

  it('every exception is reasoned, and every compat-not-served URL is attested non-purchasable', async () => {
    for (const reason of [...EXTERNAL_IDENTITY.values(), ...DOCUMENTED_FUTURE_TARGETS.values()]) {
      expect(reason.length).toBeGreaterThan(40);
    }
    const { compat } = await collectAllSurfaceUrls();
    expect([...compat].every((url) => url.includes('/v1/'))).toBe(true);
    expect(compat.size).toBe(4);
  });

  it('the classifier rejects unpublished and unattested URLs (negative controls)', () => {
    const none = new Set<string>();
    expect(classify('https://siteborne.net/license', none)).toBe('UNPUBLISHED');
    expect(classify('https://siteborne.net/schemas/services/nope.schema.json', none)).toBe(
      'UNPUBLISHED'
    );
    expect(classify('https://siteborne.net/docs/unknown', none)).toBe('UNPUBLISHED');
    expect(
      classify('https://utility.siteborne.net/schemas/services/web-context-input.schema.json', none)
    ).toBe('UNPUBLISHED');
    expect(classify('https://utility.siteborne.net/v1/company/evidence-graph', none)).toBe(
      'UNPUBLISHED'
    );
    expect(
      classify(
        'https://utility.siteborne.net/v1/company/evidence-graph',
        new Set(['https://utility.siteborne.net/v1/company/evidence-graph'])
      )
    ).toBe('compat_not_served');
    expect(classify('https://elsewhere.example/', none)).toBe('UNPUBLISHED');
    // the standard-dialect allowance is key-scoped and exact
    expect(
      isStandardDialect('inputSchema.$schema', 'https://json-schema.org/draft/2020-12/schema')
    ).toBe(true);
    expect(
      isStandardDialect('inputSchema.$id', 'https://json-schema.org/draft/2020-12/schema')
    ).toBe(false);
    expect(
      isStandardDialect('inputSchema.$schema', 'https://json-schema.org/draft/2019-09/schema')
    ).toBe(false);
  });

  it('every published schema is byte-identical to the active contract release', () => {
    for (const rel of [
      'services/web-context-input.schema.json',
      'services/document-evidence-output.schema.json',
      'common/money.schema.json',
      'proof-carrying-context.schema.json',
    ]) {
      const published = readFileSync(join(SITE, 'schemas', rel));
      const source = readFileSync(join(REPO, 'contracts', 'releases', RELEASE, 'schemas', rel));
      expect(published.equals(source), rel).toBe(true);
    }
  });

  it('the schema index and catalog project canonical URLs, not request-origin paths', async () => {
    const { surfaces } = await collectAllSurfaceUrls();
    const indexUrls = surfaces['schemas-index'].map((u) => u.url);
    // one index entry per published schema artifact, no more and no fewer
    expect(indexUrls.length).toBe(countFiles(join(SITE, 'schemas')));
    expect(indexUrls.every((u) => u.startsWith(`${CANONICAL_SCHEMA_ORIGIN}/schemas/`))).toBe(true);
    const catalogUrls = surfaces.catalog
      .filter((u) => /\.(input|output)_schema_ref$/.test(u.path))
      .map((u) => u.url);
    expect(catalogUrls.length).toBeGreaterThan(0);
    // Every catalog schema ref must be one of the two well-defined, non-
    // request-origin schema origins: the active release's canonical origin,
    // or a non-active candidate release's release-qualified origin (see
    // CANDIDATE_SCHEMA_ORIGIN). Neither ever reflects the serving request's
    // own origin/path.
    expect(
      catalogUrls.every(
        (u) =>
          u.startsWith(`${CANONICAL_SCHEMA_ORIGIN}/schemas/`) ||
          (u.startsWith(`${CANDIDATE_SCHEMA_ORIGIN}/`) && candidateReleaseSchemaPath(u) !== null)
      )
    ).toBe(true);
  });
});

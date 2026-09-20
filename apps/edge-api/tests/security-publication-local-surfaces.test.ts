/**
 * PRODUCTION-SECURITY-DECLARATIONS-PUBLICATION-01 -- local publication proof.
 *
 * Drives the REAL Worker routes (Agent Card + JWKS, MCP tools/list, OpenAPI,
 * catalog) with no network and no cloud, and proves that the additive security
 * metadata (a) is present on every surface, (b) is derived from the one
 * canonical declaration and never broader than it, (c) agrees across surfaces,
 * (d) leaks nothing private, (e) leaves the A2A JWS valid, and (f) is
 * byte-reproducible. Nothing here authors a security claim.
 */
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentCard } from '@a2a-js/sdk';
import { verifyAgentCardAgainstTrustedJwks } from '@siteborne/protocol-a2a';
import { MCP_SERVICE_TOOLS } from '@siteborne/protocol-mcp';
import { REGISTRY_SERVICES } from '@siteborne/protocol-x402';
import {
  OPENAPI_SECURITY_DECLARATION_KEY,
  OPENAPI_SECURITY_OPERATION_KEY,
  SITEBORNE_SECURITY_DECLARATION_EXTENSION_URI,
  buildSecurityDeclarationV1,
  isNoStrongerThan,
  scanForPrivateLeaks,
} from '@siteborne/vcm';
// Validate-mode comparators are deliberately not re-exported from the package
// index (test/qualification code only), so the Worker bundle never pulls them.
import {
  checkA2aParity,
  checkMcpParity,
  checkOpenApiParity,
} from '../../../packages/vcm/src/security/parity';
import { app } from '../src/index';
import {
  catalogRoute,
  openapiRoute,
  serviceMetadataRoute,
} from '../src/control-plane/routes/catalog';
import { InMemoryServicesRepository } from '../src/control-plane/repositories/in-memory';

const ENV = {
  SELLER_WALLET_ADDRESS: '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1',
} as never;
const canonical = buildSecurityDeclarationV1();
const SERVICE_TOOLS = MCP_SERVICE_TOOLS as Record<string, string>;
const PAID_IDS = ['web_context_verified.v2', 'verify_agent_output.v2'];

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function fetchCard(env: Json = ENV as Json): Promise<{ raw: Json; jwks: Json }> {
  const [c, j] = await Promise.all([
    app.request('/.well-known/agent-card.json', { headers: { Host: 'test.local' } }, env as never),
    app.request('/.well-known/jwks.json', { headers: { Host: 'test.local' } }, env as never),
  ]);
  return { raw: (await c.json()) as Json, jwks: (await j.json()) as Json };
}

async function fetchTools(env: Json = ENV as Json): Promise<Json[]> {
  const r = await app.request(
    '/mcp',
    {
      method: 'POST',
      headers: {
        Host: 'test.local',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    },
    env as never
  );
  const text = await r.text();
  const data = (r.headers.get('content-type') ?? '').includes('application/json')
    ? text
    : (text.split('\n').find((l) => l.startsWith('data:')) ?? '').slice(5).trim();
  return JSON.parse(data).result.tools as Json[];
}

async function fetchOpenApi(): Promise<Json> {
  return (await (
    await app.request('/openapi.json', { headers: { Host: 'test.local' } }, ENV)
  ).json()) as Json;
}

async function fetchCatalog(): Promise<{ catalog: Json; service: Json }> {
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
  site.route('/', openapiRoute);
  return {
    catalog: (await (await site.request('/catalog')).json()) as Json,
    service: (await (await site.request('/services/web_context_verified.v2')).json()) as Json,
  };
}

/** Canonical per-mode expectation, read from the canonical declaration only. */
function canonicalFor(serviceId: string) {
  return canonical.capabilitySecurityBindings.filter((b) => b.capability === serviceId);
}

const normalise = (fragment: Json) => ({
  mode: fragment.mode,
  securityProfile: fragment.securityProfile,
  implementationStatus: fragment.implementationStatus,
  available: fragment.available,
  purchasable: fragment.purchasable,
  economicAuthorizationRequired: fragment.economicAuthorizationRequired,
  executionEffect: fragment.executionEffect,
  economicEffects: fragment.economicEffects,
  assuranceRequirement: fragment.assuranceRequirement,
  runtimeQualification: fragment.runtimeQualification,
});

function stripVolatile(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripVolatile);
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node as Json)
        .filter(([k]) => k !== 'generated_at')
        .map(([k, v]) => [k, stripVolatile(v)])
    );
  }
  return node;
}

describe('A2A Agent Card', () => {
  it('carries the additive extension, adds no auth scheme/requirement, and the JWS still verifies', async () => {
    const { raw, jwks } = await fetchCard();
    const ext = raw.capabilities.extensions.find(
      (e: Json) => e.uri === SITEBORNE_SECURITY_DECLARATION_EXTENSION_URI
    );
    expect(ext).toBeDefined();
    expect(ext.required ?? false).toBe(false); // proto JSON omits the default
    expect(raw.securityRequirements ?? []).toEqual([]);
    expect(Object.keys(raw.securitySchemes ?? {})).toEqual([]);
    expect(ext.params.declarationVersion).toBe(canonical.declarationVersion);
    expect(ext.params.truthLevelCeiling).toBe('CONFIGURED');
    // the signed payload is the full card: signature must cover the extension
    await expect(
      verifyAgentCardAgainstTrustedJwks(AgentCard.fromJSON(raw), jwks as never)
    ).resolves.toBeUndefined();
    const tampered = structuredClone(raw);
    tampered.capabilities.extensions.find(
      (e: Json) => e.uri === SITEBORNE_SECURITY_DECLARATION_EXTENSION_URI
    ).params.truthLevelCeiling = 'VERIFIED';
    await expect(
      verifyAgentCardAgainstTrustedJwks(AgentCard.fromJSON(tampered), jwks as never)
    ).rejects.toBeDefined();
    expect(checkA2aParity(canonical, raw)).toEqual([]);
  });
});

describe('MCP tools/list', () => {
  it('serves six tools, each with additive security _meta, and parity holds', async () => {
    const tools = await fetchTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [...Object.keys(SERVICE_TOOLS), 'siteborne_get_quote', 'siteborne_get_service_health'].sort()
    );
    for (const t of tools) {
      expect(t._meta?.['net.siteborne/securityDeclaration']).toBeDefined();
      expect(t._meta?.['net.siteborne/security']).toBeInstanceOf(Array);
    }
    // pre-existing meta keys are untouched
    const web = tools.find((t) => t.name === 'siteborne_web_context_verified')!;
    expect(web._meta['net.siteborne/serviceId']).toBe('web_context_verified.v2');
    expect(web._meta['net.siteborne/paymentRequired']).toBe(true);
    expect(checkMcpParity(canonical, tools as never, SERVICE_TOOLS)).toEqual([]);
  });
});

describe('OpenAPI + catalog', () => {
  it('OpenAPI carries the document declaration and per-operation fragments; no auth schemes', async () => {
    const doc = await fetchOpenApi();
    expect(doc[OPENAPI_SECURITY_DECLARATION_KEY].declarationVersion).toBe(
      canonical.declarationVersion
    );
    expect(checkOpenApiParity(canonical, doc)).toEqual([]);
    const ops = Object.values(doc.paths as Json).flatMap((p: Json) => Object.values(p) as Json[]);
    const secured = ops.filter((o) => o?.[OPENAPI_SECURITY_OPERATION_KEY]);
    // all four v2 paid operations are described; only the Release-1 pair has a purchasable mode
    expect(secured.map((o) => o['x-service-id']).sort()).toEqual(
      [
        'company_evidence_graph.v2',
        'document_evidence_json.v2',
        'verify_agent_output.v2',
        'web_context_verified.v2',
      ].sort()
    );
    const purchasable = secured
      .filter((o) =>
        (o[OPENAPI_SECURITY_OPERATION_KEY].modes as Json[]).some((m) => m.purchasable === true)
      )
      .map((o) => o['x-service-id']);
    expect(purchasable.sort()).toEqual([...PAID_IDS].sort());
  });

  it('catalog carries a top-level reference and per-service blocks', async () => {
    const { catalog, service } = await fetchCatalog();
    expect(catalog.security_declaration.declarationVersion).toBe(canonical.declarationVersion);
    const entry = catalog.services.find((s: Json) => s.service_id === 'web_context_verified.v2');
    expect(entry.security.modes.length).toBeGreaterThan(0);
    expect(service.security.modes.length).toBeGreaterThan(0);
  });
});

describe('cross-surface parity against the canonical declaration', () => {
  it('every surface agrees, per capability and mode, with canonical and with each other', async () => {
    const [tools, doc, { catalog }] = await Promise.all([
      fetchTools(),
      fetchOpenApi(),
      fetchCatalog(),
    ]);
    const { raw: card } = await fetchCard();
    const a2a = card.capabilities.extensions.find(
      (e: Json) => e.uri === SITEBORNE_SECURITY_DECLARATION_EXTENSION_URI
    ).params.capabilitySecurity as Json[];

    for (const id of PAID_IDS) {
      const expected = canonicalFor(id).map((b) => ({
        mode: b.mode,
        securityProfile: b.securityProfile,
        implementationStatus: b.implementationStatus,
        available: b.available,
        purchasable: b.purchasable,
        economicAuthorizationRequired: b.economicAuthorizationRequired,
        executionEffect: b.executionEffect,
        economicEffects: b.economicEffects,
        assuranceRequirement: b.assuranceRequirement,
        runtimeQualification: b.runtimeQualification,
      }));
      const toolName = Object.entries(SERVICE_TOOLS).find(([, v]) => v === id)![0];
      const mcp = (
        tools.find((t) => t.name === toolName)!._meta['net.siteborne/security'] as Json[]
      ).map(normalise);
      const openapi = (
        Object.values(doc.paths as Json)
          .flatMap((p: Json) => Object.values(p) as Json[])
          .find((o) => o?.['x-service-id'] === id)![OPENAPI_SECURITY_OPERATION_KEY].modes as Json[]
      ).map(normalise);
      const cat = (
        catalog.services.find((s: Json) => s.service_id === id).security.modes as Json[]
      ).map(normalise);
      const card2 = a2a.filter((f) => f.capability === id).map(normalise);
      expect(mcp).toEqual(expected);
      expect(openapi).toEqual(expected);
      expect(cat).toEqual(expected);
      expect(card2).toEqual(expected);
    }
  });

  it('closed / unsupported capabilities are never purchasable or enforced on any surface', async () => {
    const { catalog } = await fetchCatalog();
    for (const s of catalog.services as Json[]) {
      for (const m of s.security?.modes ?? []) {
        const c = canonicalFor(s.service_id).find((b) => b.mode === m.mode)!;
        expect(isNoStrongerThan(m.implementationStatus, c.implementationStatus)).toBe(true);
        expect(m.purchasable).toBe(c.purchasable);
        expect(m.available).toBe(c.available);
      }
    }
    const closed = canonical.capabilitySecurityBindings.filter(
      (b) => !b.available && !b.purchasable
    );
    expect(closed.length).toBeGreaterThan(0);
    for (const b of closed) expect(b.implementationStatus).toBe('UNSUPPORTED');
  });
});

describe('leaks and reproducibility', () => {
  it('published security material contains no private field or value', async () => {
    const [tools, doc, { catalog }] = await Promise.all([
      fetchTools(),
      fetchOpenApi(),
      fetchCatalog(),
    ]);
    const { raw: card } = await fetchCard();
    const material = {
      a2a: card.capabilities.extensions.find(
        (e: Json) => e.uri === SITEBORNE_SECURITY_DECLARATION_EXTENSION_URI
      ),
      mcp: tools.map((t) => ({
        n: t.name,
        a: t._meta['net.siteborne/securityDeclaration'],
        b: t._meta['net.siteborne/security'],
      })),
      openapi: doc[OPENAPI_SECURITY_DECLARATION_KEY],
      openapiOps: Object.values(doc.paths as Json)
        .flatMap((p: Json) => Object.values(p) as Json[])
        .map((o) => o?.[OPENAPI_SECURITY_OPERATION_KEY])
        .filter(Boolean),
      catalog: {
        ref: catalog.security_declaration,
        blocks: catalog.services.map((s: Json) => s.security).filter(Boolean),
      },
    };
    expect(scanForPrivateLeaks(material)).toEqual([]);
  });

  it('two independent generations are byte-identical apart from generated_at', async () => {
    const gen = async () => {
      const [tools, doc, { catalog }, { raw }] = await Promise.all([
        fetchTools(),
        fetchOpenApi(),
        fetchCatalog(),
        fetchCard(),
      ]);
      return JSON.stringify(stripVolatile({ tools, doc, catalog, raw }));
    };
    const first = await gen();
    const second = await gen();
    expect(second).toBe(first);
  });
});

describe('security metadata survives every metadata projection mode', () => {
  afterEach(() => vi.restoreAllMocks());
  const wallet = { SELLER_WALLET_ADDRESS: '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1' };
  const securityOnly = (tools: Json[]) =>
    tools.map((t) => ({
      n: t.name,
      a: t._meta['net.siteborne/securityDeclaration'],
      b: t._meta['net.siteborne/security'],
    }));

  for (const mode of ['shadow_compare', 'vcm_primary_compare']) {
    it(`MCP ${mode}: identical served security metadata; VCM path succeeds without fallback`, async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const legacy = await fetchTools();
      const tools = await fetchTools({ ...wallet, MCP_METADATA_PROJECTION_MODE: mode });
      expect(tools).toHaveLength(6);
      expect(securityOnly(tools)).toEqual(securityOnly(legacy));
      expect(JSON.stringify(tools)).toBe(JSON.stringify(legacy));
      await new Promise((r) => setTimeout(r, 30));
      const events = [...log.mock.calls, ...err.mock.calls]
        .map((c) => {
          try {
            return JSON.parse(c[0] as string) as Json;
          } catch {
            return {};
          }
        })
        .filter((l) => l.surface === 'mcp');
      if (mode === 'vcm_primary_compare') {
        expect(events.some((l) => l.event === 'metadata_projection_primary_success_total')).toBe(
          true
        );
        expect(events.some((l) => l.fellBackToLegacy === true)).toBe(false);
      }
      expect(events.some((l) => l.event === 'metadata_projection_semantic_mismatch_total')).toBe(
        false
      );
    });

    it(`A2A ${mode}: extension present and identical; JWS verifies`, async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const legacy = (await fetchCard()).raw;
      const { raw, jwks } = await fetchCard({ ...wallet, A2A_METADATA_PROJECTION_MODE: mode });
      const pick = (c: Json) =>
        c.capabilities.extensions.find(
          (e: Json) => e.uri === SITEBORNE_SECURITY_DECLARATION_EXTENSION_URI
        );
      expect(pick(raw)).toEqual(pick(legacy));
      await expect(
        verifyAgentCardAgainstTrustedJwks(AgentCard.fromJSON(raw), jwks as never)
      ).resolves.toBeUndefined();
      await new Promise((r) => setTimeout(r, 30));
      const events = [...log.mock.calls, ...err.mock.calls]
        .map((c) => {
          try {
            return JSON.parse(c[0] as string) as Json;
          } catch {
            return {};
          }
        })
        .filter((l) => l.surface === 'a2a');
      expect(events.some((l) => l.event === 'metadata_projection_semantic_mismatch_total')).toBe(
        false
      );
      if (mode === 'vcm_primary_compare') {
        expect(events.some((l) => l.event === 'metadata_projection_primary_success_total')).toBe(
          true
        );
      }
    });
  }
});

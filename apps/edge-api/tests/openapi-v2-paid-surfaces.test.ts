/**
 * PRODUCTION-ECONOMICS-DISCOVERY-01 -- OPENAPI_V2_PAID_SURFACES.
 *
 * The served /openapi.json must truthfully describe the four current v2 paid
 * operations: current identities, narrowed (supported-modes-only) request
 * schemas, the canonical economics, the governed page limit, and correct
 * errors -- with no v1-only enum controlling v2 truth and no price literal
 * authored outside the governed resolver.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  ECONOMIC_SERVICE_IDS,
  V2_PAID_SERVICE_IDS,
  BUNDLED_SERVICE_INPUT_SCHEMAS,
  projectServiceEconomics,
  purchasableInputExample,
  resolveMaxDocumentPages,
  type EconomicOfferProjection,
} from '@siteborne/protocol-x402';
import { app } from '../src/index';

const GOVERNED_ENV = {
  SELLER_WALLET_ADDRESS: '0x2222222222222222222222222222222222222222',
  PAYMENT_ENVIRONMENT: 'production',
  PRODUCTION_ENABLED: 'true',
  HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: 'true',
  PRODUCTION_CDP_CREDENTIALS_APPROVED: 'true',
};

type Doc = {
  openapi: string;
  info: Record<string, unknown>;
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components: { schemas: Record<string, Record<string, unknown>> };
};

async function fetchDoc(env: Record<string, string> = GOVERNED_ENV): Promise<Doc> {
  const res = await app.request('/openapi.json', { headers: { Host: 'test.local' } }, env as never);
  expect(res.status).toBe(200);
  return (await res.json()) as Doc;
}

const PATHS = [
  ['company_evidence_graph.v2', '/v2/company/evidence-graph'],
  ['web_context_verified.v2', '/v2/web/context'],
  ['document_evidence_json.v2', '/v2/document/evidence-json'],
  ['verify_agent_output.v2', '/v2/verify/agent-output'],
] as const;

function resolvePointer(doc: unknown, ref: string): unknown {
  return ref
    .slice(2)
    .split('/')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], doc);
}

function collectRefs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((child) => collectRefs(child, out));
  else if (node && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) {
      if (key === '$ref' && typeof child === 'string') out.push(child);
      else collectRefs(child, out);
    }
  }
  return out;
}

describe('served OpenAPI: structure', () => {
  it('is OpenAPI 3.1 and every $ref resolves inside the document', async () => {
    const doc = await fetchDoc();
    expect(doc.openapi).toBe('3.1.0');
    const refs = collectRefs(doc);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.startsWith('#/'), ref).toBe(true);
      expect(resolvePointer(doc, ref), ref).toBeDefined();
    }
  });

  it('projects no dead license URL', async () => {
    const doc = await fetchDoc();
    expect(doc.info.license).toEqual({ name: 'Proprietary' });
  });

  it('every component schema compiles as JSON Schema 2020-12', async () => {
    const doc = await fetchDoc();
    const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
    for (const [name, schema] of Object.entries(doc.components.schemas)) {
      // `$ref`s between components are rewritten to a standalone check below.
      const standalone = JSON.parse(
        JSON.stringify(schema).replace(/#\/components\/schemas\/[A-Za-z0-9]+/g, '#')
      );
      expect(() => ajv.compile(standalone), name).not.toThrow();
    }
  });
});

describe('served OpenAPI: the four v2 paid operations', () => {
  it.each(PATHS)(
    '%s is POST %s with the current v2 identity and no v1 enum',
    async (serviceId, path) => {
      const doc = await fetchDoc();
      const op = doc.paths[path]?.post;
      expect(op, path).toBeDefined();
      expect(op['x-service-id']).toBe(serviceId);
      expect(serviceId.endsWith('.v2')).toBe(true);
      expect(Object.keys(doc.paths).filter((p) => p.startsWith('/v1/'))).toEqual([]);
    }
  );

  it('the service metadata path enumerates every canonical id, not a v1-only list', async () => {
    const doc = await fetchDoc();
    const param = (
      doc.paths['/services/{service_id}'].get.parameters as { schema: { enum: string[] } }[]
    )[0];
    expect(param.schema.enum).toEqual([...ECONOMIC_SERVICE_IDS]);
    expect(param.schema.enum.filter((id) => id.endsWith('.v2')).length).toBe(4);
  });

  it.each(PATHS)('%s documents payment, error and disabled-route responses', async (_id, path) => {
    const doc = await fetchDoc();
    const op = doc.paths[path].post as {
      responses: Record<string, Record<string, unknown>>;
      parameters: { name: string }[];
    };
    expect(Object.keys(op.responses).sort()).toEqual(['200', '400', '402', '404', '503']);
    expect(op.parameters.map((p) => p.name)).toContain('PAYMENT-SIGNATURE');
    expect(
      (op.responses['402'].headers as Record<string, unknown>)['PAYMENT-REQUIRED']
    ).toBeDefined();
    expect(
      (op.responses['200'].headers as Record<string, unknown>)['PAYMENT-RESPONSE']
    ).toBeDefined();
  });

  it('the documented error body is the shape the routes emit ({ error, message })', async () => {
    const doc = await fetchDoc();
    const error = doc.components.schemas.PaidServiceError as { required: string[] };
    expect(error.required).toEqual(['error', 'message']);
  });
});

describe('served OpenAPI: supported modes only', () => {
  const validator = (serviceId: string, schema: unknown) => {
    const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
    return ajv.compile(JSON.parse(JSON.stringify(schema).replace(/"\$id":"[^"]*",?/g, '')));
  };

  it('web retrieval_mode is narrowed to direct, and rendered is listed as unavailable with a reason', async () => {
    const doc = await fetchDoc();
    const schema = doc.components.schemas.WebContextVerifiedV2Input as {
      properties: { retrieval_mode: { enum: string[]; [k: string]: unknown } };
    };
    expect(schema.properties.retrieval_mode.enum).toEqual(['direct']);
    expect(schema.properties.retrieval_mode['x-siteborne-unavailable-modes']).toEqual([
      expect.objectContaining({
        mode: 'rendered',
        price_defined: true,
        capability_available: false,
      }),
    ]);
  });

  it('verify verification_mode is narrowed to standard', async () => {
    const doc = await fetchDoc();
    const schema = doc.components.schemas.VerifyAgentOutputV2Input as {
      properties: { verification_mode: { enum: string[] } };
    };
    expect(schema.properties.verification_mode.enum).toEqual(['standard']);
  });

  it('the narrowed schema rejects rendered while the frozen contract schema still accepts it', async () => {
    const doc = await fetchDoc();
    const narrowed = validator('web', doc.components.schemas.WebContextVerifiedV2Input);
    const frozen = validator('web', BUNDLED_SERVICE_INPUT_SCHEMAS['web_context_verified.v2']);
    const rendered = { target_url: 'https://acme.example/', retrieval_mode: 'rendered' };
    const direct = { target_url: 'https://acme.example/', retrieval_mode: 'direct' };
    expect(frozen(rendered)).toBe(true);
    expect(narrowed(rendered)).toBe(false);
    expect(narrowed(direct)).toBe(true);
  });

  it.each(V2_PAID_SERVICE_IDS)(
    '%s: the advertised example validates against the narrowed schema',
    async (serviceId) => {
      const doc = await fetchDoc();
      const path = PATHS.find(([id]) => id === serviceId)![1];
      const ref = (
        doc.paths[path].post.requestBody as {
          content: Record<string, { schema: { $ref: string } }>;
        }
      ).content['application/json'].schema.$ref;
      const schema = resolvePointer(doc, ref) as { examples: unknown[] };
      expect(schema.examples).toEqual([purchasableInputExample(serviceId)]);
      expect(validator(serviceId, schema)(schema.examples[0])).toBe(true);
    }
  );
});

describe('served OpenAPI: canonical economics', () => {
  it.each(PATHS)('%s embeds exactly the canonical projection', async (serviceId, path) => {
    const doc = await fetchDoc();
    const economics = doc.paths[path].post['x-siteborne-economics'] as EconomicOfferProjection;
    const expected = projectServiceEconomics(serviceId, {
      productionEnabled: false,
      destination: economics.payment
        ? {
            network: economics.payment.network,
            asset: economics.payment.asset,
            payTo: economics.payment.pay_to,
          }
        : null,
    });
    expect(economics).toEqual(JSON.parse(JSON.stringify(expected)));
    expect(economics.payment).toMatchObject({
      network: 'eip155:8453',
      pay_to: GOVERNED_ENV.SELLER_WALLET_ADDRESS,
    });
  });

  it('every embedded projection validates against the published component schema', async () => {
    const doc = await fetchDoc();
    const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
    const validate = ajv.compile(doc.components.schemas.EconomicOfferProjection);
    for (const [, path] of PATHS) {
      const economics = doc.paths[path].post['x-siteborne-economics'];
      expect(validate(economics), JSON.stringify(validate.errors)).toBe(true);
    }
    // the schema is strict: a drifted projection is rejected, not tolerated
    const first = doc.paths[PATHS[0][1]].post['x-siteborne-economics'] as Record<string, unknown>;
    expect(validate({ ...first, invented_field: 1 })).toBe(false);
    expect(validate({ ...first, scheme: 'metered' })).toBe(false);
  });

  it('declares no payment destination (null) when none is configured', async () => {
    const doc = await fetchDoc({});
    for (const [, path] of PATHS) {
      expect(
        (doc.paths[path].post['x-siteborne-economics'] as EconomicOfferProjection).payment
      ).toBeNull();
    }
  });

  it('states the one governed document page limit', async () => {
    const doc = await fetchDoc();
    const description = doc.paths['/v2/document/evidence-json'].post.description as string;
    expect(description).toContain(`Maximum ${resolveMaxDocumentPages()} pages per job`);
    expect(description).not.toContain('100 pages');
    const economics = doc.paths['/v2/document/evidence-json'].post[
      'x-siteborne-economics'
    ] as EconomicOfferProjection;
    expect(economics.limits).toEqual({ max_document_pages: resolveMaxDocumentPages() });
  });

  it('no price literal is authored in the generator or the route: amounts come only from the resolver', () => {
    const sources = [
      '../../../packages/protocol-x402/src/openapi/paid-operations.ts',
      '../src/control-plane/routes/catalog.ts',
    ].map((rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8'));
    for (const source of sources) {
      expect(source.match(/['"`]0\.\d{3,}['"`]/g) ?? []).toEqual([]);
    }
  });
});

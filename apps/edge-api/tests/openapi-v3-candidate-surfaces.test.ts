/**
 * SITEBORNE-OPENAPI-V3-CANDIDATE-01 -- OPENAPI_V3_CANDIDATE_SURFACES.
 *
 * The served /openapi.json must truthfully describe the four Release 3
 * `.v3` candidate operations alongside the four live v2 operations, with an
 * explicit, machine-readable separation: a `.v3` operation's
 * `x-siteborne-economics.contract_role` is always `"candidate"` (never
 * `"current"`), its `production_enabled` is always `false` regardless of any
 * runtime gate, and `x-siteborne-candidate-state` mirrors the governed
 * registry entry's `promotion_state` / `authorization_classification`
 * exactly -- no OpenAPI-authored fact of its own.
 */
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  REGISTRY_SERVICES,
  V3_CANDIDATE_SERVICE_IDS,
  BUNDLED_SERVICE_INPUT_SCHEMAS,
  purchasableInputExample,
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
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components: { schemas: Record<string, Record<string, unknown>> };
};

async function fetchDoc(env: Record<string, string> = GOVERNED_ENV): Promise<Doc> {
  const res = await app.request('/openapi.json', { headers: { Host: 'test.local' } }, env as never);
  expect(res.status).toBe(200);
  return (await res.json()) as Doc;
}

const PATHS = [
  ['company_evidence_graph.v3', '/v3/company/evidence-graph'],
  ['web_context_verified.v3', '/v3/web/context'],
  ['document_evidence_json.v3', '/v3/document/evidence-json'],
  ['verify_agent_output.v3', '/v3/verify/agent-output'],
] as const;

function resolvePointer(doc: unknown, ref: string): unknown {
  return ref
    .slice(2)
    .split('/')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], doc);
}

describe('served OpenAPI: the four v3 candidate operations coexist with v2', () => {
  it('V3_ALL_FOUR_CORE_SERVICES_V3: all four candidate paths are present', async () => {
    const doc = await fetchDoc();
    for (const [serviceId, path] of PATHS) {
      const op = doc.paths[path]?.post;
      expect(op, path).toBeDefined();
      expect(op['x-service-id']).toBe(serviceId);
    }
  });

  it('does not remove or alter the live v2 paths', async () => {
    const doc = await fetchDoc();
    expect(doc.paths['/v2/company/evidence-graph']?.post?.['x-service-id']).toBe(
      'company_evidence_graph.v2'
    );
  });

  it.each(PATHS)(
    '%s: contract_role is "candidate", never "current", and production_enabled is always false',
    async (serviceId, path) => {
      const doc = await fetchDoc();
      const economics = doc.paths[path].post['x-siteborne-economics'] as EconomicOfferProjection;
      expect(economics.contract_role).toBe('candidate');
      expect(economics.production_enabled).toBe(false);
      expect(economics.service_version).toBe('v3');
    }
  );

  it.each(PATHS)(
    '%s: x-siteborne-candidate-state mirrors the governed registry entry exactly',
    async (serviceId, path) => {
      const doc = await fetchDoc();
      const registry = REGISTRY_SERVICES[serviceId];
      const state = doc.paths[path].post['x-siteborne-candidate-state'] as Record<string, unknown>;
      expect(state).toEqual({
        contract_release: '3.0.0',
        service_version: 'v3',
        promotion_state: registry.promotion_state,
        production_enabled: registry.production_enabled,
        result_confidentiality_class:
          registry.authorization_classification === 'buyer_authorized'
            ? 'BUYER_AUTHORIZED'
            : 'PUBLIC',
        pcc_version: registry.pcc_version,
      });
    }
  );

  it('company_evidence_graph.v3 and web_context_verified.v3 are PUBLIC; document/verify are BUYER_AUTHORIZED', async () => {
    const doc = await fetchDoc();
    const classOf = (path: string) =>
      (
        doc.paths[path].post['x-siteborne-candidate-state'] as {
          result_confidentiality_class: string;
        }
      ).result_confidentiality_class;
    expect(classOf('/v3/company/evidence-graph')).toBe('PUBLIC');
    expect(classOf('/v3/web/context')).toBe('PUBLIC');
    expect(classOf('/v3/document/evidence-json')).toBe('BUYER_AUTHORIZED');
    expect(classOf('/v3/verify/agent-output')).toBe('BUYER_AUTHORIZED');
  });

  it.each(PATHS)(
    '%s: production_enabled stays false even under a production-enabled runtime env',
    async (_id, path) => {
      const doc = await fetchDoc(GOVERNED_ENV);
      const economics = doc.paths[path].post['x-siteborne-economics'] as EconomicOfferProjection;
      expect(economics.production_enabled).toBe(false);
    }
  );

  it.each(V3_CANDIDATE_SERVICE_IDS)(
    '%s: the advertised example validates against its input schema',
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
      const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
      const validate = ajv.compile(
        JSON.parse(JSON.stringify(schema).replace(/"\$id":"[^"]*",?/g, ''))
      );
      expect(validate(schema.examples[0]), JSON.stringify(validate.errors)).toBe(true);
    }
  );

  it.each(PATHS)(
    '%s: output schema URI and PCC version match the registry entry',
    async (serviceId, path) => {
      const doc = await fetchDoc();
      const registry = REGISTRY_SERVICES[serviceId];
      const schema = doc.paths[path].post.responses['200'].content['application/json'].schema as {
        'x-output-schema-uri': string;
        'x-pcc-version': string;
      };
      expect(schema['x-output-schema-uri']).toBe(registry.output_schema_uri);
      expect(schema['x-pcc-version']).toBe(registry.pcc_version);
    }
  );

  it('every v3 component schema compiles as JSON Schema 2020-12', async () => {
    const doc = await fetchDoc();
    const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
    for (const name of Object.keys(BUNDLED_SERVICE_INPUT_SCHEMAS)
      .filter((id) => id.endsWith('.v3'))
      .map((id) => {
        const family = id.slice(0, id.lastIndexOf('.'));
        const pascal = family
          .split('_')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join('');
        return `${pascal}V3Input`;
      })) {
      const schema = doc.components.schemas[name];
      expect(schema, name).toBeDefined();
      const standalone = JSON.parse(
        JSON.stringify(schema).replace(/#\/components\/schemas\/[A-Za-z0-9]+/g, '#')
      );
      expect(() => ajv.compile(standalone), name).not.toThrow();
    }
  });
});

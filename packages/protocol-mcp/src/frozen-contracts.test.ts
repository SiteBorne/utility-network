import Ajv2020 from 'ajv/dist/2020.js';
import {
  BUNDLED_SERVICE_INPUT_SCHEMAS,
  frozenOutputExample,
  type SiteborneServiceId,
} from '@siteborne/protocol-x402';
import { describe, expect, it } from 'vitest';
import { MCP_SERVICE_INPUT_SCHEMAS, MCP_SERVICE_OUTPUT_SCHEMAS } from './frozen-contracts';

const SERVICE_IDS: SiteborneServiceId[] = [
  'company_evidence_graph.v1',
  'web_context_verified.v1',
  'document_evidence_json.v1',
  'verify_agent_output.v1',
];

function references(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(references);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) =>
    key === '$ref' && typeof child === 'string' ? [child] : references(child)
  );
}

describe('MCP frozen service contracts', () => {
  it.each(SERVICE_IDS)('uses the accepted bundled input schema for %s unchanged', (serviceId) => {
    expect(MCP_SERVICE_INPUT_SCHEMAS[serviceId]).toEqual(BUNDLED_SERVICE_INPUT_SCHEMAS[serviceId]);
  });

  it.each(SERVICE_IDS)('bundles a self-contained valid output schema for %s', (serviceId) => {
    const schema = MCP_SERVICE_OUTPUT_SCHEMAS[serviceId] as object;
    const externalReferences = references(schema).filter(
      (reference) => !reference.startsWith('#/')
    );
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const validate = ajv.compile(schema);

    expect(externalReferences).toEqual([]);
    expect(validate(frozenOutputExample(serviceId))).toBe(true);
    expect(validate.errors).toBeNull();
  });
});

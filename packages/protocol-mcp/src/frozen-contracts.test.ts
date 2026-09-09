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

  // SUN-1222C-MCP-PAYMENT-DESIGN-CORRECTION §17: real production v2
  // executors emit `contract.service_id`/`contract.service_version` with
  // the literal ".v2" identity (see e.g.
  // company-evidence-graph-v2-production-executor.ts, contractRelease:
  // '2.0.0'). The 1.0.0 output schema's `contract.service_id` /
  // `contract.service_version` properties are a `const` fixed to the v1
  // value — a genuine v2 result is therefore schema-invalid under 1.0.0.
  // 2.0.0 widens both to an `enum` covering v1 and v2 while changing
  // nothing else (see the frozen-contracts/2.0.0 migration note above the
  // export). This test uses a real v2-shaped result (not
  // `frozenOutputExample`, whose single frozen example is v1-shaped
  // regardless of which service key it's requested under) so it actually
  // exercises the identity-field bug.
  const V2_SERVICE_IDS: SiteborneServiceId[] = [
    'company_evidence_graph.v2',
    'web_context_verified.v2',
    'document_evidence_json.v2',
    'verify_agent_output.v2',
  ];

  function asV2Result(v1ServiceId: SiteborneServiceId, v2ServiceId: SiteborneServiceId): unknown {
    const v1Example = frozenOutputExample(v1ServiceId) as { contract: Record<string, unknown> };
    return {
      ...v1Example,
      contract: { ...v1Example.contract, service_id: v2ServiceId, service_version: 'v2' },
    };
  }

  const V1_TO_V2: [SiteborneServiceId, SiteborneServiceId][] = [
    ['company_evidence_graph.v1', 'company_evidence_graph.v2'],
    ['web_context_verified.v1', 'web_context_verified.v2'],
    ['document_evidence_json.v1', 'document_evidence_json.v2'],
    ['verify_agent_output.v1', 'verify_agent_output.v2'],
  ];

  it.each(V1_TO_V2)(
    'accepts a genuinely v2-identified result under the %s output schema',
    (v1ServiceId, v2ServiceId) => {
      const schema = MCP_SERVICE_OUTPUT_SCHEMAS[v2ServiceId] as object;
      const ajv = new Ajv2020({ strict: false, validateFormats: false });
      const validate = ajv.compile(schema);
      const v2Result = asV2Result(v1ServiceId, v2ServiceId);

      expect(validate(v2Result)).toBe(true);
      expect(validate.errors).toBeNull();
    }
  );

  it.each(V2_SERVICE_IDS)('exposes %s under the 2.0.0 contract release, not 1.0.0', (serviceId) => {
    const schema = MCP_SERVICE_OUTPUT_SCHEMAS[serviceId] as {
      allOf?: Array<{ properties?: { contract?: { properties?: Record<string, unknown> } } }>;
    };
    const identityProps = schema.allOf?.[1]?.properties?.contract?.properties ?? {};
    // 2.0.0 widens these from `const` (v1-only) to `enum` (v1 and v2).
    expect(identityProps.service_id).toHaveProperty('enum');
    expect(identityProps.service_version).toHaveProperty('enum');
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
// Test matrix for the PCC 1.0.1 extension_container patch (SUN-0100 correction).
//
// PCC 1.0.0's extension_container set additionalProperties:false with no
// properties/patternProperties, which unconditionally rejected every extension
// key regardless of what a service-specific schema's allOf branch declared.
// This is verified independently in docs/reports/SUN-0100-pcc-schema-report.md
// (Python jsonschema + ajv 6, both agree). 1.0.1 adds patternProperties keyed
// to the same reverse-domain pattern, mapping to a new bounded extension_value
// definition, so qualified extension keys structurally validate while invalid
// names remain rejected and PCC's own frozen shape (pcc_version, job_id,
// contract, etc.) is otherwise untouched.

import { describe, it, expect } from 'vitest';
import { NORMATIVE_SCHEMA, validateSchema } from './index';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function makeHash(seed: string): string {
  const hexChars = '0123456789abcdef';
  const char = hexChars[parseInt(seed, 36) % 16] || '0';
  return `sha256:${char.repeat(64)}`;
}

function makeValidDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = '2026-08-05T10:00:00Z';
  const base = {
    pcc_version: '1.0.0',
    job_id: 'job_aaaaaaaaaaaaaaaaaaaaaaaa',
    contract: {
      service_id: 'company_evidence_graph.v1',
      service_version: 'v1.0.0',
      input_hash: makeHash('a'),
      input_schema_hash: makeHash('b'),
      output_schema_hash: makeHash('c'),
      quote_id: 'qte_aaaaaaaaaaaaaaaaaaaaaaaa',
      mode: 'paid',
      price: '0.039',
      currency: 'USD',
      network: 'base',
      minimum_quality: 0.8,
      freshness_seconds: 3600,
      issued_at: now,
      expires_at: '2026-08-06T10:00:00Z',
      idempotency_key: 'idk_aaaaaaaaaaaaaaaaaaaaaaaa',
    },
    subject: {
      type: 'organization',
      canonical_name: 'Acme Example Corp',
      identifiers: { domain: 'acme.example' },
    },
    claims: [
      {
        claim_id: 'clm_aaaaaaaaaaaaaaaaaaaaaaaa',
        predicate: 'has_name',
        value: 'Acme Example Corp',
        confidence: 0.95,
        evidence_ids: ['evd_aaaaaaaaaaaaaaaaaaaaaaaa'],
        materiality: 'material',
        verification_status: 'verified',
      },
    ],
    evidence: [
      {
        evidence_id: 'evd_aaaaaaaaaaaaaaaaaaaaaaaa',
        source_uri: 'https://acme.example/about',
        retrieved_at: now,
        content_hash: makeHash('d'),
        media_type: 'text/html',
        locator: { type: 'text_quote', value: 'Acme Example Corp' },
        accessibility_status: 'accessible',
        transformation_history: [],
        authorization_classification: 'public',
        freshness_status: 'fresh',
      },
    ],
    completeness: {
      requested_fields: 5,
      populated_fields: 4,
      supported_fields: 4,
      score: 0.8,
      missing_fields: ['ceo_name'],
      unsupported_fields: [],
      stale_fields: [],
      vector: [{ dimension: 'general', requested: 5, populated: 4, supported: 4, score: 0.8 }],
    },
    provenance: {
      routes: [{ type: 'direct', provider: 'web', version: '1.0.0' }],
      providers: [{ name: 'web', version: '1.0.0', capabilities: ['fetch'] }],
      tools: { curl: '8.0.0' },
      models: [],
      software_versions: { pcc: '1.0.0' },
      policy_versions: { verification: '1.0.0' },
      transformations: [],
      cache_provenance: { enabled: false, hit: false },
      execution_environment: { runtime: 'node', version: '22.0.0', platform: 'linux' },
      verification_routes: [],
    },
    verification: {
      schema_valid: true,
      material_claims_supported: true,
      evidence_accessibility: 1.0,
      freshness: 1.0,
      completeness: 0.8,
      cross_source_agreement: 1.0,
      provenance_valid: true,
      prompt_injection_result: { checked: true, result: 'clean' },
      deterministic_failures: [],
      verifier_versions: { pcc: '1.0.0' },
      policy: 'pol_aaaaaaaaaaaaaaaaaaaaaaaa',
      decision: 'pass',
      score: 0.9,
      failed_requirements: [],
    },
    receipt: {
      output_hash: makeHash('e'),
      canonicalization_algorithm: 'RFC8785-JCS',
      policy_hash: makeHash('f'),
      schema_hash: makeHash('g'),
      signature_algorithm: 'Ed25519',
      signing_key_id: 'kid_aaaaaaaaaaaaaaaaaaaaaaaa',
      signature: 'A'.repeat(86),
      signed_at: now,
    },
  };
  return { ...base, ...overrides };
}

const SITEBORNE_SERVICE_NAMESPACES = [
  'net.siteborne.company-evidence.v1',
  'net.siteborne.web-context.v1',
  'net.siteborne.document-evidence.v1',
  'net.siteborne.agent-verification.v1',
];

describe('PCC 1.0.1 extension_container patch', () => {
  it('an empty extensions object passes', () => {
    const doc = makeValidDocument({ extensions: {} });
    const result = validateSchema(doc);
    expect(result.valid).toBe(true);
  });

  it('a valid qualified extension key passes', () => {
    const doc = makeValidDocument({
      extensions: { 'net.siteborne.verification.v1': { checked: true } },
    });
    const result = validateSchema(doc);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it.each(SITEBORNE_SERVICE_NAMESPACES)('the %s namespace passes', (namespace) => {
    const doc = makeValidDocument({ extensions: { [namespace]: { ok: true } } });
    const result = validateSchema(doc);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('an unqualified (single-label) key fails', () => {
    const doc = makeValidDocument({ extensions: { foo: {} } });
    const result = validateSchema(doc);
    expect(result.valid).toBe(false);
  });

  it('an uppercase namespace fails', () => {
    const doc = makeValidDocument({ extensions: { 'Net.siteborne.x.v1': {} } });
    const result = validateSchema(doc);
    expect(result.valid).toBe(false);
  });

  it('an underscore in the namespace fails', () => {
    const doc = makeValidDocument({ extensions: { 'net_siteborne.x.v1': {} } });
    const result = validateSchema(doc);
    expect(result.valid).toBe(false);
  });

  it('an empty label (leading hyphen) fails', () => {
    const doc = makeValidDocument({ extensions: { 'net.-siteborne.x.v1': {} } });
    const result = validateSchema(doc);
    expect(result.valid).toBe(false);
  });

  it('a trailing hyphen in a label fails', () => {
    const doc = makeValidDocument({ extensions: { 'net.siteborne-.x.v1': {} } });
    const result = validateSchema(doc);
    expect(result.valid).toBe(false);
  });

  it('a key over 253 chars fails (max is 253)', () => {
    // 5 labels of 61 chars + 4 dots + ".v1" suffix = 61*5 + 4 + 3 = 312 chars.
    const built = ['a', 'b', 'c', 'd', 'e'].map((c) => c.repeat(61)).join('.') + '.v1';
    expect(built.length).toBeGreaterThan(253);
    const doc = makeValidDocument({ extensions: { [built]: {} } });
    const result = validateSchema(doc);
    expect(result.valid).toBe(false);
  });

  it('11 extensions fail (max is 10)', () => {
    const extensions: Record<string, unknown> = {};
    for (let i = 0; i < 11; i++) {
      extensions[`net.siteborne.ext${i}.v1`] = {};
    }
    const doc = makeValidDocument({ extensions });
    const result = validateSchema(doc);
    expect(result.valid).toBe(false);
  });

  it('extension values must be objects (extension_value is bounded JSON data)', () => {
    const doc = makeValidDocument({
      extensions: { 'net.siteborne.verification.v1': 'not-an-object' },
    });
    const result = validateSchema(doc);
    expect(result.valid).toBe(false);
  });

  it('unknown PCC root properties still fail (base closure untouched)', () => {
    const doc = makeValidDocument({ not_a_real_field: true });
    const result = validateSchema(doc);
    expect(result.valid).toBe(false);
  });

  it('extension_container references the new bounded extension_value definition', () => {
    const container = (NORMATIVE_SCHEMA as any).definitions.extension_container;
    expect(container.additionalProperties).toBe(false);
    expect(container.patternProperties).toBeDefined();
    const patternKey = Object.keys(container.patternProperties)[0];
    expect(container.patternProperties[patternKey].$ref).toBe('#/definitions/extension_value');
    const extensionValue = (NORMATIVE_SCHEMA as any).definitions.extension_value;
    expect(extensionValue.type).toBe('object');
  });

  it('records the current PCC 1.1.0 schema hash for drift visibility', () => {
    const schemaPath = resolve(
      import.meta.dirname,
      '../../../schemas/proof-carrying-context.schema.json'
    );
    const content = readFileSync(schemaPath, 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');
    // Recorded at time of the 1.1.0 minor release (SUN-1000 checkpoint 1M: service_id
    // enum gains 4 .v2 members, additive-only per packages/pcc-schema/policy/COMPATIBILITY.md).
    // If this fails, the PCC schema changed again — update the report/manifest and this
    // constant together, deliberately, rather than silently.
    expect(hash).toBe('d32a8e25eba7a7ae4d7d7f7a14c565c1b92c8d8e10810ff885698ed102fdbcc0');
  });
});

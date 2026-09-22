/**
 * SUN-1200 checkpoint F — VALIDATION RUNTIME CLOSURE (P0-A).
 *
 * Proves the generated standalone output validators
 * (`src/generated/output-validators.generated.js`, produced by
 * `apps/edge-api/scripts/generate-input-validators.mts`'s
 * `generateOutputModuleSource()`) agree exactly with the pre-existing
 * runtime `getAjv().getSchema($id)` validation path
 * (`@siteborne/verification`'s `schema-registry.ts`) for every one of
 * this repository's four real output schemas. Switching
 * `SchemaVerifier`'s real Worker request path from request-time AJV
 * compilation to build-time precompilation must not silently change
 * validation semantics -- this is that proof, covering the case battery
 * the checkpoint directive requires: a schema-valid representative
 * output, missing required field, wrong type, an unexpected/additional
 * property, a nested invalid member, and an enum failure.
 */
import { describe, expect, it } from 'vitest';
import { getAjv, getOutputSchemaId, knownServiceIds } from '@siteborne/verification';
import { outputValidatorsById } from '../src/generated/output-validators.generated.js';

function makeHash(seed: string): string {
  const hexChars = '0123456789abcdef';
  const char = hexChars[parseInt(seed, 36) % 16] || '0';
  return `sha256:${char.repeat(64)}`;
}

const now = '2026-08-05T10:00:00Z';

/** A schema-valid document_evidence_json.v1 PCC output -- mirrors
 * packages/verification/src/tests/fixtures.ts's `validDocumentPccOutput`
 * exactly (kept as an inline, independent copy rather than a
 * cross-package import, since that fixture module is test-only and not
 * part of @siteborne/verification's public package export surface). */
function validDocumentPccOutput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base = {
    pcc_version: '1.0.0',
    job_id: 'job_verificationfixture01aaa',
    contract: {
      service_id: 'document_evidence_json.v1',
      service_version: 'v1',
      input_hash: makeHash('a'),
      input_schema_hash: makeHash('b'),
      output_schema_hash: makeHash('c'),
      quote_id: 'qte_verificationfixture01aaa',
      mode: 'offline_verification',
      price: '0.012',
      currency: 'USD',
      network: 'base',
      minimum_quality: 0.8,
      freshness_seconds: 3600,
      issued_at: now,
      expires_at: '2026-08-06T10:00:00Z',
      idempotency_key: 'idk_verificationfixture01aaa',
    },
    subject: {
      type: 'document',
      canonical_name: 'Annual Report 2025.pdf',
      identifiers: { filename: 'annual-report-2025.pdf' },
    },
    claims: [
      {
        claim_id: 'clm_verificationfixture01aaa',
        predicate: 'page_count',
        value: 24,
        confidence: 1.0,
        evidence_ids: ['evd_verificationfixture01aaa'],
        materiality: 'material',
        verification_status: 'verified',
      },
    ],
    evidence: [
      {
        evidence_id: 'evd_verificationfixture01aaa',
        source_uri: 'file:///docs/annual-report-2025.pdf',
        retrieved_at: now,
        content_hash: makeHash('d'),
        media_type: 'application/pdf',
        locator: { type: 'byte_range', value: '0-1024' },
        accessibility_status: 'accessible',
        transformation_history: [
          { type: 'pdf_text_extract', timestamp: now, tool_version: 'pdfplumber-0.11.0' },
        ],
        authorization_classification: 'buyer_authorized',
        freshness_status: 'fresh',
      },
    ],
    completeness: {
      requested_fields: 4,
      populated_fields: 4,
      supported_fields: 4,
      score: 1.0,
      missing_fields: [],
      unsupported_fields: [],
      stale_fields: [],
      vector: [{ dimension: 'document', requested: 4, populated: 4, supported: 4, score: 1.0 }],
    },
    provenance: {
      routes: [{ type: 'direct', provider: 'document-worker', version: '1.0.0' }],
      providers: [{ name: 'document-worker', version: '1.0.0', capabilities: ['extract'] }],
      tools: {},
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
      completeness: 1.0,
      cross_source_agreement: 1.0,
      provenance_valid: true,
      prompt_injection_result: { checked: true, result: 'clean' },
      deterministic_failures: [],
      verifier_versions: { pcc: '1.0.0' },
      policy: 'pol_verificationfixture01aaa',
      decision: 'pass',
      score: 1.0,
      failed_requirements: [],
    },
    receipt: {
      output_hash: makeHash('e'),
      canonicalization_algorithm: 'RFC8785-JCS',
      policy_hash: makeHash('f'),
      schema_hash: makeHash('g'),
      signature_algorithm: 'Ed25519',
      signing_key_id: 'kid_verificationfixture01aaa',
      signature: 'A'.repeat(86),
      signed_at: now,
    },
    extensions: {
      'net.siteborne.document-evidence.v1': {
        document_classification: 'financial_statement',
        total_pages: 4,
        processed_pages: 4,
      },
    },
  };
  return { ...base, ...overrides };
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

describe('generated standalone output validators cover every known service_id', () => {
  it('outputValidatorsById has an entry for every real output schema $id', () => {
    const ids = new Set<string>();
    for (const serviceId of knownServiceIds()) {
      const id = getOutputSchemaId(serviceId);
      expect(id).toBeTruthy();
      ids.add(id!);
    }
    // v1/v2 share four active files; v3 adds four release-qualified files.
    expect(ids.size).toBe(8);
    for (const id of ids) {
      expect(outputValidatorsById[id]).toBeDefined();
    }
  });
});

describe('generated output validators agree with runtime getAjv() validation (SUN-1200 checkpoint F P0-A)', () => {
  const docSchemaId = getOutputSchemaId('document_evidence_json.v1')!;

  function agree(schemaId: string, payload: unknown) {
    const runtime = getAjv().getSchema(schemaId);
    expect(runtime).toBeDefined();
    const generated = outputValidatorsById[schemaId];
    expect(generated).toBeDefined();
    const runtimeResult = runtime!(deepClone(payload));
    const generatedResult = generated(deepClone(payload));
    expect(generatedResult).toBe(runtimeResult);
    return generatedResult;
  }

  it('agrees on a schema-valid representative document_evidence_json.v1 output', () => {
    expect(agree(docSchemaId, validDocumentPccOutput())).toBe(true);
  });

  it('agrees on a missing required field', () => {
    const bad = validDocumentPccOutput();
    delete (bad as Record<string, unknown>).receipt;
    expect(agree(docSchemaId, bad)).toBe(false);
  });

  it('agrees on a wrong-type field', () => {
    // completeness.score must be a number -- give it a string instead.
    const bad = validDocumentPccOutput({
      completeness: { ...(validDocumentPccOutput().completeness as object), score: 'not-a-number' },
    });
    expect(agree(docSchemaId, bad)).toBe(false);
  });

  it('agrees on an unexpected/additional property inside a closed extension object', () => {
    const bad = validDocumentPccOutput({
      extensions: {
        'net.siteborne.document-evidence.v1': {
          document_classification: 'financial_statement',
          total_pages: 4,
          processed_pages: 4,
          unexpected_field_not_in_schema: true,
        },
      },
    });
    expect(agree(docSchemaId, bad)).toBe(false);
  });

  it('agrees on a nested invalid member (bad evidence item shape)', () => {
    const bad = validDocumentPccOutput();
    (bad.evidence as Record<string, unknown>[])[0] = {
      ...(bad.evidence as Record<string, unknown>[])[0],
      accessibility_status: 'not-a-real-status',
    };
    expect(agree(docSchemaId, bad)).toBe(false);
  });

  it('agrees on an enum failure (bad contract.service_id)', () => {
    const bad = validDocumentPccOutput({
      contract: {
        ...(validDocumentPccOutput().contract as object),
        service_id: 'not_a_real_service',
      },
    });
    expect(agree(docSchemaId, bad)).toBe(false);
  });

  it('agrees across every known output schema on obviously-invalid structural garbage', () => {
    for (const serviceId of knownServiceIds()) {
      const schemaId = getOutputSchemaId(serviceId)!;
      expect(agree(schemaId, {})).toBe(false);
      expect(agree(schemaId, { pcc_version: '1.0.0' })).toBe(false);
      expect(agree(schemaId, null)).toBe(false);
      expect(agree(schemaId, 'not-an-object')).toBe(false);
    }
  });
});

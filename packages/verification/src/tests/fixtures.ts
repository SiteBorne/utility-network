/**
 * Shared candidate-result fixtures for verification tests. Built as
 * schema-valid PCC document_evidence_json.v1 outputs (reusing the pattern
 * already established in packages/pcc-schema/tests/fixtures/index.ts)
 * rather than hand-waved partial objects, so schema_verifier is exercised
 * against a genuinely valid baseline and every mutation test starts from
 * something the mesh would otherwise pass.
 */
import type { CandidateResult } from '../types';

const now = '2026-08-05T10:00:00Z';

function makeHash(seed: string): string {
  const hexChars = '0123456789abcdef';
  const char = hexChars[parseInt(seed, 36) % 16] || '0';
  return `sha256:${char.repeat(64)}`;
}

/** A schema-valid document_evidence_json.v1 PCC output, one claim, one
 * evidence item, both fresh and accessible. */
export function validDocumentPccOutput(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
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

/** The mesh-facing candidate wrapper for the above output. */
export function validCandidate(overrides: Partial<CandidateResult> = {}): CandidateResult {
  return {
    job_id: 'job_verificationfixture01aaa',
    request_id: 'req_verificationfixture01aaa',
    service_id: 'document_evidence_json.v1',
    service_version: 'v1',
    contract_release: '1.0.0',
    input_hash: makeHash('a'),
    input_schema_hash: makeHash('b'),
    output_schema_hash: makeHash('c'),
    output: validDocumentPccOutput(),
    claims: [
      {
        claim_id: 'clm_verificationfixture01aaa',
        subject: 'job_verificationfixture01aaa',
        predicate: 'page_count',
        value: 24,
        evidence_ids: ['evd_verificationfixture01aaa'],
      },
    ],
    evidence: [
      {
        evidence_id: 'evd_verificationfixture01aaa',
        source_uri: 'file:///docs/annual-report-2025.pdf',
        locator: { type: 'byte_range', value: '0-1024' },
        content_hash: makeHash('d'),
        retrieved_at: now,
        authorization_classification: 'buyer_authorized',
        result_class: 'success',
      },
    ],
    completeness: {
      requested_fields: 4,
      populated_fields: 4,
      supported_fields: 4,
      missing_fields: [],
    },
    freshness_requirement_ms: 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

export { makeHash, now };

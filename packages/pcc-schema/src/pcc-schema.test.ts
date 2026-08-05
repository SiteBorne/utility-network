/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import {
  PCC_VERSION,
  SEMANTIC_FIELDS,
  COMPATIBILITY_POLICY,
  CANONICALIZATION_POLICY,
  SIGNING_POLICY,
  NORMATIVE_SCHEMA,
  PRE_NORMATIVE_DRAFT_SCHEMA,
  isPreNormative,
  assertNotFrozen,
  validateSchema,
  validateSemantic,
  canonicalize,
  hashCanonical,
  signReceipt,
  verifyReceipt,
  getSchemaHash,
  loadCanonicalJson,
  HashZ,
  TimestampZ,
  DecimalStringZ,
  PCCDocumentZ,
} from './index';

// Test fixture keypair (non-production, RFC 8032 test vector)
const TEST_PRIVATE_KEY = new Uint8Array([
  0x9d, 0x61, 0xb1, 0x9d, 0xef, 0xfd, 0x5a, 0x60, 0xba, 0x84, 0x4a, 0xf4, 0x92, 0xec, 0x2c, 0xc4,
  0x44, 0x49, 0xc5, 0x69, 0x7b, 0x32, 0x69, 0x19, 0x70, 0x3b, 0xac, 0x03, 0x1c, 0xae, 0x7f, 0x60,
]);
const TEST_PUBLIC_KEY = new Uint8Array([
  0xd7, 0x5a, 0x98, 0x01, 0x82, 0xb1, 0x0a, 0xb7, 0xd5, 0x4b, 0xfe, 0xd3, 0xc9, 0x64, 0x07, 0x3a,
  0x0e, 0xe1, 0x72, 0xf3, 0xda, 0xa6, 0x23, 0x25, 0xaf, 0x02, 0x1a, 0x68, 0xf7, 0x07, 0x51, 0x1a,
]);

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

describe('pcc-schema - normative v1.0.0', () => {
  beforeAll(async () => {
    await loadCanonicalJson();
  });

  describe('Constants', () => {
    it('PCC_VERSION is 1.0.0', () => {
      expect(PCC_VERSION).toBe('1.0.0');
    });

    it('SEMANTIC_FIELDS contains all required fields', () => {
      const required = [
        'pcc_version',
        'job_id',
        'contract',
        'subject',
        'claims',
        'evidence',
        'completeness',
        'provenance',
        'verification',
        'receipt',
      ];
      for (const field of required) {
        expect(SEMANTIC_FIELDS).toContain(field);
      }
    });
  });

  describe('Policies', () => {
    it('COMPATIBILITY_POLICY has version and rules', () => {
      expect(COMPATIBILITY_POLICY.version).toBe('1.0.0');
      expect(COMPATIBILITY_POLICY.rules.length).toBeGreaterThan(0);
    });

    it('CANONICALIZATION_POLICY references RFC 8785', () => {
      expect(CANONICALIZATION_POLICY.algorithm).toContain('RFC 8785');
    });

    it('SIGNING_POLICY uses Ed25519', () => {
      expect(SIGNING_POLICY.algorithm).toBe('Ed25519');
    });
  });

  describe('Schema loading', () => {
    it('NORMATIVE_SCHEMA has pcc_version 1.0.0', () => {
      expect(NORMATIVE_SCHEMA.pcc_version).toBe('1.0.0');
    });

    it('PRE_NORMATIVE_DRAFT_SCHEMA is alias for NORMATIVE_SCHEMA', () => {
      expect(PRE_NORMATIVE_DRAFT_SCHEMA).toBe(NORMATIVE_SCHEMA);
    });

    it('isPreNormative returns false for normative schema', () => {
      expect(isPreNormative(NORMATIVE_SCHEMA)).toBe(false);
    });

    it('assertNotFrozen throws on normative schema', () => {
      expect(() => assertNotFrozen(NORMATIVE_SCHEMA)).toThrow();
    });

    it('getSchemaHash returns sha256: prefix', async () => {
      const hash = await getSchemaHash();
      expect(hash.startsWith('sha256:')).toBe(true);
      expect(hash.length).toBe(64 + 7);
    });
  });

  describe('Structural validation', () => {
    it('accepts valid complete document', () => {
      const doc = makeValidDocument();
      const result = validateSchema(doc);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('rejects missing required field', () => {
      const doc = makeValidDocument();
      delete (doc as any).contract;
      const result = validateSchema(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('contract'))).toBe(true);
    });

    it('rejects unknown root property', () => {
      const doc = makeValidDocument({ extra_field: true });
      const result = validateSchema(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('extra_field'))).toBe(true);
    });

    it('accepts namespaced extensions', () => {
      const doc = makeValidDocument({ extensions: { 'net.siteborne.test': { foo: 'bar' } } });
      const result = validateSchema(doc);
      expect(result.valid).toBe(true);
    });

    it('accepts valid reverse-domain qualified extensions', () => {
      const validNamespaces = [
        'net.siteborne.verification.v1',
        'com.example.custom-metrics.v1',
        'org.test.namespace.v2',
        'io.github.user.project.v1',
      ];
      for (const ns of validNamespaces) {
        const doc = makeValidDocument({ extensions: { [ns]: { foo: 'bar' } } });
        const result = validateSchema(doc);
        expect(result.valid).toBe(true);
      }
    });

    it('rejects unqualified extension keys (less than 3 labels)', () => {
      const invalidNamespaces = ['foo', 'verification', 'siteborne.verification', 'net.siteborne'];
      for (const ns of invalidNamespaces) {
        const doc = makeValidDocument({ extensions: { [ns]: { foo: 'bar' } } });
        const result = validateSchema(doc);
        expect(result.valid).toBe(false);
        expect(
          result.errors.some(
            (e) => e.includes('extensions') || e.includes('unknown') || e.includes('pattern')
          )
        ).toBe(true);
      }
    });

    it('rejects extensions with underscores', () => {
      const doc = makeValidDocument({ extensions: { 'net._siteborne.v1': { foo: 'bar' } } });
      const result = validateSchema(doc);
      expect(result.valid).toBe(false);
    });

    it('rejects extensions with leading/trailing hyphens', () => {
      const invalidNamespaces = [
        'net.-siteborne.v1',
        'net.siteborne-.v1',
        '-net.siteborne.v1',
        'net.siteborne.v1-',
      ];
      for (const ns of invalidNamespaces) {
        const doc = makeValidDocument({ extensions: { [ns]: { foo: 'bar' } } });
        const result = validateSchema(doc);
        expect(result.valid).toBe(false);
      }
    });

    it('rejects extensions with uppercase', () => {
      const doc = makeValidDocument({ extensions: { 'NET.SITEBORNE.V1': { foo: 'bar' } } });
      const result = validateSchema(doc);
      expect(result.valid).toBe(false);
    });

    it('rejects extensions with empty labels', () => {
      const doc = makeValidDocument({ extensions: { 'net..siteborne.v1': { foo: 'bar' } } });
      const result = validateSchema(doc);
      expect(result.valid).toBe(false);
    });

    it('rejects extensions with labels exceeding 63 chars', () => {
      const longLabel = 'a'.repeat(64);
      const doc = makeValidDocument({ extensions: { [`net.${longLabel}.v1`]: { foo: 'bar' } } });
      const result = validateSchema(doc);
      expect(result.valid).toBe(false);
    });

    it('rejects malformed hash', () => {
      const doc = makeValidDocument({
        receipt: { ...(makeValidDocument().receipt as any), output_hash: 'invalid' },
      });
      const result = validateSchema(doc);
      expect(result.valid).toBe(false);
    });

    it('rejects uppercase hash', () => {
      const doc = makeValidDocument({
        receipt: {
          ...(makeValidDocument().receipt as any),
          output_hash: 'sha256:' + 'A'.repeat(64),
        },
      });
      const result = validateSchema(doc);
      expect(result.valid).toBe(false);
    });

    it('rejects invalid timestamp', () => {
      const doc = makeValidDocument({
        contract: { ...(makeValidDocument().contract as any), issued_at: 'not-a-date' },
      });
      const result = validateSchema(doc);
      expect(result.valid).toBe(false);
    });

    it('rejects invalid verification decision', () => {
      const doc = makeValidDocument({
        verification: { ...(makeValidDocument().verification as any), decision: 'maybe' },
      });
      const result = validateSchema(doc);
      expect(result.valid).toBe(false);
    });
  });

  describe('Semantic validation', () => {
    it('accepts valid semantic document', () => {
      const doc = makeValidDocument();
      const result = validateSemantic(doc);
      expect(result.valid).toBe(true);
    });

    it('rejects material claim without evidence', () => {
      const doc = makeValidDocument();
      (doc.claims as any)[0].evidence_ids = [];
      const result = validateSemantic(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('material supported claim'))).toBe(true);
    });

    it('rejects unknown evidence reference', () => {
      const doc = makeValidDocument();
      (doc.claims as any)[0].evidence_ids = ['evd_does_not_exist'];
      const result = validateSemantic(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('unknown evidence_id'))).toBe(true);
    });

    it('rejects unsupported claim with evidence', () => {
      const doc = makeValidDocument();
      (doc.claims as any)[0].verification_status = 'unsupported';
      const result = validateSemantic(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('unsupported claim must not reference'))).toBe(
        true
      );
    });

    it('rejects completeness invariant violation', () => {
      const doc = makeValidDocument();
      (doc.completeness as any).supported_fields = 10;
      (doc.completeness as any).populated_fields = 5;
      const result = validateSemantic(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('supported_fields cannot exceed'))).toBe(true);
    });

    it('rejects negative completeness counts', () => {
      const doc = makeValidDocument();
      (doc.completeness as any).requested_fields = -1;
      const result = validateSemantic(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('counts cannot be negative'))).toBe(true);
    });

    it('rejects deterministic failures with pass decision', () => {
      const doc = makeValidDocument();
      (doc.verification as any).deterministic_failures = ['schema_mismatch'];
      (doc.verification as any).decision = 'pass';
      const result = validateSemantic(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('deterministic failures prevent pass'))).toBe(
        true
      );
    });

    it('rejects invalid verification decision', () => {
      const doc = makeValidDocument();
      (doc.verification as any).decision = 'unknown';
      const result = validateSemantic(doc);
      expect(result.valid).toBe(false);
    });

    it('rejects duplicate claim_ids', () => {
      const doc = makeValidDocument();
      doc.claims = [(doc.claims as any)[0], { ...(doc.claims as any)[0] }];
      const result = validateSemantic(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Duplicate claim_id'))).toBe(true);
    });

    it('rejects duplicate evidence_ids', () => {
      const doc = makeValidDocument();
      doc.evidence = [(doc.evidence as any)[0], { ...(doc.evidence as any)[0] }];
      const result = validateSemantic(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Duplicate evidence_id'))).toBe(true);
    });

    it('accepts benchmark contract without payment fields', () => {
      const doc = makeValidDocument({
        contract: {
          ...(makeValidDocument().contract as any),
          mode: 'benchmark',
          price: undefined,
          network: undefined,
        },
      });
      const result = validateSemantic(doc);
      expect(result.valid).toBe(true);
    });

    it('rejects benchmark contract with payment fields', () => {
      const doc = makeValidDocument({
        contract: {
          ...(makeValidDocument().contract as any),
          mode: 'benchmark',
          price: '0.039',
        },
      });
      const result = validateSemantic(doc);
      expect(result.valid).toBe(false);
    });
  });

  describe('Canonicalization', () => {
    it('produces stable output for same input', async () => {
      const data = { b: 2, a: 1 };
      const c1 = await canonicalize(data);
      const c2 = await canonicalize(data);
      expect(c1).toBe(c2);
    });

    it('sorts object keys', async () => {
      const c = await canonicalize({ z: 1, a: 2, m: 3 });
      expect(c.indexOf('"a"')).toBeLessThan(c.indexOf('"m"'));
      expect(c.indexOf('"m"')).toBeLessThan(c.indexOf('"z"'));
    });

    it('produces sha256 tagged hash', async () => {
      const hash = await hashCanonical({ test: true });
      expect(hash.startsWith('sha256:')).toBe(true);
      expect(hash.length).toBe(64 + 7);
    });
  });

  describe('Signing & Verification', () => {
    const preimage = {
      pcc_version: '1.0.0',
      job_id: 'job_aaaaaaaaaaaaaaaaaaaaaaaa',
      service_id: 'company_evidence_graph.v1',
      service_version: '1.0.0',
      contract_mode: 'paid',
      input_hash: makeHash('a'),
      input_schema_hash: makeHash('b'),
      output_schema_hash: makeHash('c'),
      quote_id: 'quote_aaaaaaaaaaaaaaaaaaaaaaaa',
      output_hash: makeHash('0'),
      policy_hash: makeHash('1'),
      canonicalization_algorithm: 'RFC8785-JCS',
      signature_algorithm: 'Ed25519',
      signing_key_id: 'kid_aaaaaaaaaaaaaaaaaaaaaaaa',
    };

    it('signs and verifies a receipt', async () => {
      const signed = await signReceipt(
        preimage.output_hash,
        preimage.policy_hash,
        TEST_PRIVATE_KEY,
        preimage
      );
      expect(signed.signature.length).toBeGreaterThan(80);
      expect(signed.signedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

      const ok = await verifyReceipt(
        preimage.output_hash,
        preimage.policy_hash,
        signed.signature,
        TEST_PUBLIC_KEY,
        {
          ...preimage,
          signed_at: signed.signedAt,
        }
      );
      expect(ok).toBe(true);
    });

    it('rejects altered payload', async () => {
      const signed = await signReceipt(
        preimage.output_hash,
        preimage.policy_hash,
        TEST_PRIVATE_KEY,
        preimage
      );
      const alteredPreimage = { ...preimage, output_hash: makeHash('2') };
      const ok = await verifyReceipt(
        alteredPreimage.output_hash,
        preimage.policy_hash,
        signed.signature,
        TEST_PUBLIC_KEY,
        {
          ...alteredPreimage,
          signed_at: signed.signedAt,
        }
      );
      expect(ok).toBe(false);
    });
  });

  describe('Zod runtime types', () => {
    it('HashZ accepts valid hash', () => {
      expect(HashZ.parse(makeHash('a'))).toBe(makeHash('a'));
    });

    it('HashZ rejects invalid hash', () => {
      expect(() => HashZ.parse('invalid')).toThrow();
    });

    it('HashZ rejects uppercase hash', () => {
      expect(() => HashZ.parse('sha256:' + 'A'.repeat(64))).toThrow();
    });

    it('TimestampZ accepts valid timestamp', () => {
      expect(TimestampZ.parse('2026-08-05T10:00:00Z')).toBe('2026-08-05T10:00:00Z');
    });

    it('TimestampZ rejects missing Z suffix', () => {
      expect(() => TimestampZ.parse('2026-08-05T10:00:00')).toThrow();
    });

    it('DecimalStringZ accepts valid decimal', () => {
      expect(DecimalStringZ.parse('0.039')).toBe('0.039');
    });

    it('DecimalStringZ rejects scientific notation', () => {
      expect(() => DecimalStringZ.parse('1e-3')).toThrow();
    });

    it('DecimalStringZ rejects negative', () => {
      expect(() => DecimalStringZ.parse('-0.5')).toThrow();
    });

    it('PCCDocumentZ accepts valid document', () => {
      const doc = makeValidDocument();
      const parsed = PCCDocumentZ.parse(doc);
      expect(parsed.pcc_version).toBe('1.0.0');
    });
  });
});

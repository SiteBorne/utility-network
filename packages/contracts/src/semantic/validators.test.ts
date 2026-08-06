import { describe, it, expect } from 'vitest';
import {
  isValidServiceId,
  isValidRequestId,
  validateHashPairing,
  validateServicePairing,
  validateQuoteExactUpto,
  validateTimestampOrdering,
  validateExactlyOneMode,
  validateServiceExtension,
  validateWrongExtension,
  validateCompleteness,
  validateDeterministicFailures,
  MoneySchema,
  RequestEnvelopeSchema,
  QuoteRequestSchema,
  QuoteResponseSchema,
  StructuredErrorSchema,
  ServiceMetadataSchema,
  SERVICE_EXTENSION_NAMESPACE,
  validateServiceOutputDocument,
  validateDocumentEvidenceInputMode,
  validateCompanyEvidenceInputHasIdentifier,
} from './validators';

const H = (c: string) => `sha256:${c.repeat(64)}`;

describe('service_id pattern (SUN-0101 fix: single-dot word.vN)', () => {
  it('accepts the four canonical service ids', () => {
    for (const id of [
      'company_evidence_graph.v1',
      'web_context_verified.v1',
      'document_evidence_json.v1',
      'verify_agent_output.v1',
    ]) {
      expect(isValidServiceId(id)).toBe(true);
    }
  });

  it('rejects a three-segment id (the old, wrong pattern shape)', () => {
    expect(isValidServiceId('company.evidence.v1')).toBe(false);
  });

  it('rejects an id missing a version', () => {
    expect(isValidServiceId('company_evidence_graph')).toBe(false);
  });
});

describe('validateHashPairing / validateServicePairing / validateTimestampOrdering', () => {
  it('accepts valid triples', () => {
    expect(validateHashPairing(H('a'), H('b'), H('c'))).toEqual([]);
    expect(validateServicePairing('company_evidence_graph.v1', 'v1')).toEqual([]);
    expect(validateTimestampOrdering('2026-08-05T10:00:00Z', '2026-08-06T10:00:00Z')).toEqual([]);
  });

  it('rejects malformed hashes and reversed timestamps', () => {
    expect(validateHashPairing('not-a-hash', H('b'), H('c')).length).toBeGreaterThan(0);
    expect(validateTimestampOrdering('2026-08-06T10:00:00Z', '2026-08-05T10:00:00Z')).toContain(
      'expires_at must be after issued_at'
    );
  });
});

describe('validateQuoteExactUpto', () => {
  it('exact requires price, forbids maximum_authorized_price', () => {
    expect(validateQuoteExactUpto('exact', { amount: '1' })).toEqual([]);
    expect(validateQuoteExactUpto('exact')).toContain('exact scheme requires price');
    expect(validateQuoteExactUpto('exact', { amount: '1' }, { amount: '2' })).toContain(
      'exact scheme must not have maximum_authorized_price'
    );
  });

  it('upto requires maximum_authorized_price, forbids price', () => {
    expect(validateQuoteExactUpto('upto', undefined, { amount: '2' })).toEqual([]);
    expect(validateQuoteExactUpto('upto')).toContain(
      'upto scheme requires maximum_authorized_price'
    );
    expect(validateQuoteExactUpto('upto', { amount: '1' }, { amount: '2' })).toContain(
      'upto scheme must not have price'
    );
  });
});

describe('validateExactlyOneMode', () => {
  it('passes with exactly one present', () => {
    expect(validateExactlyOneMode({ a: 1 }, ['a', 'b', 'c'])).toEqual([]);
  });
  it('fails with zero present', () => {
    expect(validateExactlyOneMode({}, ['a', 'b', 'c']).length).toBeGreaterThan(0);
  });
  it('fails with more than one present', () => {
    expect(validateExactlyOneMode({ a: 1, b: 2 }, ['a', 'b', 'c']).length).toBeGreaterThan(0);
  });
});

describe('validateCompleteness / validateDeterministicFailures', () => {
  it('accepts internally consistent completeness', () => {
    expect(
      validateCompleteness({
        requested_fields: 5,
        populated_fields: 4,
        supported_fields: 4,
        score: 0.8,
      })
    ).toEqual([]);
  });
  it('rejects supported_fields > populated_fields', () => {
    expect(
      validateCompleteness({
        requested_fields: 5,
        populated_fields: 2,
        supported_fields: 4,
        score: 0.4,
      })
    ).toContain('supported_fields cannot exceed populated_fields');
  });
  it('rejects a pass decision alongside deterministic failures', () => {
    expect(
      validateDeterministicFailures({ decision: 'pass', deterministic_failures: ['x'] })
    ).toContain('deterministic failures prevent pass decision');
  });
  it('allows a fail decision alongside deterministic failures', () => {
    expect(
      validateDeterministicFailures({ decision: 'fail', deterministic_failures: ['x'] })
    ).toEqual([]);
  });
});

describe('isValidRequestId', () => {
  it('accepts valid UUID and ULID formats', () => {
    expect(isValidRequestId('3fa85f64-4b2c-4d8e-9f1a-2b3c4d5e6f7a')).toBe(true);
    expect(isValidRequestId('01H9K3V7M2N4P6Q8R9S1T3V5W7')).toBe(true);
  });
  it('rejects invalid formats', () => {
    expect(isValidRequestId('not-a-valid-id')).toBe(false);
    expect(isValidRequestId('')).toBe(false);
    expect(isValidRequestId('too-short')).toBe(false);
  });
});

describe('validateServiceExtension / validateWrongExtension', () => {
  const requiredNs = 'net.siteborne.company-evidence.v1';
  const wrongNs = 'net.siteborne.web-context.v1';
  const validExt = { foo: 'bar' };

  it('passes when required extension is present and valid', () => {
    const errors = validateServiceExtension({ [requiredNs]: validExt }, requiredNs);
    expect(errors).toEqual([]);
  });
  it('fails when required extension is missing', () => {
    const errors = validateServiceExtension({ other: validExt }, requiredNs);
    expect(errors.some((e) => e.includes('required extension namespace'))).toBe(true);
  });
  it('fails on invalid namespace format', () => {
    const errors = validateServiceExtension({ 'invalid.ns': validExt }, requiredNs);
    expect(errors.some((e) => e.includes('invalid'))).toBe(true);
  });
  it('validateWrongExtension passes when wrong namespace absent', () => {
    expect(validateWrongExtension({ [requiredNs]: validExt }, wrongNs)).toEqual([]);
  });
  it('validateWrongExtension fails when wrong namespace present', () => {
    const errors = validateWrongExtension({ [wrongNs]: validExt }, wrongNs);
    expect(errors.some((e) => e.includes('wrong service extension'))).toBe(true);
  });
});

describe('zod envelope/common schemas parse their own fixtures', () => {
  it('MoneySchema', () => {
    expect(MoneySchema.safeParse({ amount: '0.039', currency: 'USD' }).success).toBe(true);
    expect(MoneySchema.safeParse({ amount: '3.9e-2', currency: 'USD' }).success).toBe(false);
  });

  it('RequestEnvelopeSchema', () => {
    const valid = {
      request_id: '3fa85f64-4b2c-4d8e-9f1a-2b3c4d5e6f7a',
      service_id: 'company_evidence_graph.v1',
      service_version: 'v1',
      response_schema_version: 'v1',
      idempotency_key: 'idem_abc123xyz4567890',
      freshness_seconds: 86400,
      minimum_verification_score: 0.7,
      maximum_authorized_price: { amount: '0.039', currency: 'USD' },
      input: { company_name: 'Acme Corp' },
    };
    expect(RequestEnvelopeSchema.safeParse(valid).success).toBe(true);
    expect(RequestEnvelopeSchema.safeParse({ ...valid, service_id: 'nope' }).success).toBe(false);
  });

  it('QuoteRequestSchema', () => {
    const valid = {
      request_id: '3fa85f64-4b2c-4d8e-9f1a-2b3c4d5e6f7a',
      service_id: 'company_evidence_graph.v1',
      service_version: 'v1',
      input_hash: H('a'),
      input_schema_hash: H('b'),
      output_schema_hash: H('c'),
      requested_pricing_scheme: 'exact' as const,
      idempotency_key: 'idem_abc123xyz4567890',
    };
    expect(QuoteRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('QuoteResponseSchema', () => {
    const valid = {
      quote_id: '3fa85f64-4b2c-4d8e-9f1a-2b3c4d5e6f7b',
      request_id: '3fa85f64-4b2c-4d8e-9f1a-2b3c4d5e6f7a',
      service_id: 'company_evidence_graph.v1',
      service_version: 'v1',
      pricing_scheme: 'exact' as const,
      price: { amount: '0.039', currency: 'USD' },
      currency: 'USD' as const,
      payment_network: 'base',
      payment_asset: 'USDC',
      estimated_execution_class: 'standard' as const,
      execution_mode: 'sync' as const,
      issued_at: '2026-08-05T10:00:00Z',
      expires_at: '2026-08-06T10:00:00Z',
      input_hash: H('a'),
      input_schema_hash: H('b'),
      output_schema_hash: H('c'),
      pricing_policy_version: 'v1',
      expected_completeness: 0.8,
      declared_limitations: [],
      production_enabled: false as const,
      payment_required: true,
    };
    expect(QuoteResponseSchema.safeParse(valid).success).toBe(true);
  });

  it('StructuredErrorSchema', () => {
    const valid = {
      error_id: '3fa85f64-4b2c-4d8e-9f1a-2b3c4d5e6f7c',
      error_code: 'INVALID_INPUT',
      category: 'validation' as const,
      message: 'bad input',
      retryable: false,
      request_id: '3fa85f64-4b2c-4d8e-9f1a-2b3c4d5e6f7a',
      service_id: 'company_evidence_graph.v1',
      occurred_at: '2026-08-05T10:00:00Z',
    };
    expect(StructuredErrorSchema.safeParse(valid).success).toBe(true);
  });

  it('ServiceMetadataSchema', () => {
    const valid = {
      service_id: 'company_evidence_graph.v1',
      service_version: 'v1',
      title: 'Company Evidence Graph',
      description: 'desc',
      capabilities: ['identity_resolution'],
      input_schema_hash: H('a'),
      output_schema_hash: H('b'),
      pcc_version: '1.0.0' as const,
      pricing_schemes: ['exact' as const],
      base_price: { amount: '0.039', currency: 'USD' },
      execution_mode: 'sync' as const,
      maximum_input_bytes: 102400,
      expected_latency_class: 'standard' as const,
      authorization_classification: 'public' as const,
      promotion_state: 'executable_candidate' as const,
      production_enabled: false as const,
      declared_limitations: [],
      protocols: {
        x402: 'planned' as const,
        mcp: 'planned' as const,
        a2a: 'planned' as const,
        nevermined: 'planned' as const,
        agentverse: 'planned' as const,
        coinbase_bazaar: 'planned' as const,
        mcp_registry: 'planned' as const,
      },
      updated_at: '2026-08-05T10:00:00Z',
    };
    expect(ServiceMetadataSchema.safeParse(valid).success).toBe(true);
  });
});

describe('validateServiceOutputDocument (SUN-0101 Task 10)', () => {
  function baseDoc(serviceId: string, ns: string) {
    return {
      contract: {
        service_id: serviceId,
        service_version: 'v1',
        input_hash: H('a'),
        input_schema_hash: H('b'),
        output_schema_hash: H('c'),
        issued_at: '2026-08-05T10:00:00Z',
        expires_at: '2026-08-06T10:00:00Z',
      },
      extensions: { [ns]: { ok: true } },
      completeness: { requested_fields: 5, populated_fields: 4, supported_fields: 4, score: 0.8 },
      verification: { decision: 'pass', deterministic_failures: [] },
    };
  }

  it.each(Object.entries(SERVICE_EXTENSION_NAMESPACE))(
    'passes for %s with its own extension',
    (serviceId, ns) => {
      const errors = validateServiceOutputDocument(baseDoc(serviceId, ns), serviceId);
      expect(errors).toEqual([]);
    }
  );

  it('fails when the required extension is missing', () => {
    const doc = baseDoc('company_evidence_graph.v1', 'net.siteborne.company-evidence.v1');
    doc.extensions = {};
    const errors = validateServiceOutputDocument(doc, 'company_evidence_graph.v1');
    expect(errors.some((e) => e.includes('required extension namespace'))).toBe(true);
  });

  it('fails when another service extension is substituted', () => {
    const doc = baseDoc('company_evidence_graph.v1', 'net.siteborne.web-context.v1');
    const errors = validateServiceOutputDocument(doc, 'company_evidence_graph.v1');
    expect(errors.some((e) => e.includes('wrong service extension'))).toBe(true);
    expect(errors.some((e) => e.includes('required extension namespace'))).toBe(true);
  });

  it('fails on a service_id/expected_service_id mismatch', () => {
    const doc = baseDoc('web_context_verified.v1', 'net.siteborne.company-evidence.v1');
    const errors = validateServiceOutputDocument(doc, 'company_evidence_graph.v1');
    expect(
      errors.some((e) => e.includes("contract.service_id must be 'company_evidence_graph.v1'"))
    ).toBe(true);
  });
});

describe('input-side semantic guards', () => {
  it('validateDocumentEvidenceInputMode requires exactly one source', () => {
    expect(validateDocumentEvidenceInputMode({ document_url: 'https://x.example/a.pdf' })).toEqual(
      []
    );
    expect(validateDocumentEvidenceInputMode({})).not.toEqual([]);
    expect(
      validateDocumentEvidenceInputMode({
        document_url: 'https://x.example/a.pdf',
        upload_reference: 'up_1',
      })
    ).not.toEqual([]);
  });

  it('validateCompanyEvidenceInputHasIdentifier requires at least one identifier', () => {
    expect(validateCompanyEvidenceInputHasIdentifier({ ticker: 'ACME' })).toEqual([]);
    expect(validateCompanyEvidenceInputHasIdentifier({})).not.toEqual([]);
  });
});

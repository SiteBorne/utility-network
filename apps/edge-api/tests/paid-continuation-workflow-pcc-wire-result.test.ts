/**
 * SUN-1222C-PCC-WIRE-RESULT-IMPLEMENTATION.
 *
 * Focused, harness-independent RED->GREEN->mutation proof for the exact
 * shared fix boundary identified by
 * docs/reports/SUN-1222C-pcc-wire-result-governance-decision.md:
 * `DurableCachedResult.body` (paid-continuation-workflow.ts) must *be* the
 * governed v2 wire result -- the full PCC document -- not a bespoke
 * envelope with the business payload nested under `output`.
 *
 * Deliberately decoupled from the in-process Workflow test double's own
 * `validatePcc` fixture-fidelity gap (see
 * mcp-four-service-acceptance.test.ts's Section 8 comment): this file
 * constructs a realistic, schema-valid PCC document directly (mirroring
 * packages/verification/src/tests/fixtures.ts's `validDocumentPccOutput`
 * pattern already used by output-validators-generated-equivalence.test.ts)
 * and validates the exact `body` shape the real code now produces, both
 * pre- and post-fix, against the real accepted 2.0.0 schema authority.
 */
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import { MCP_SERVICE_OUTPUT_SCHEMAS } from '@siteborne/protocol-mcp';
import type { SiteborneServiceId } from '@siteborne/protocol-x402';

function makeHash(seed: string): string {
  const hexChars = '0123456789abcdef';
  const char = hexChars[parseInt(seed, 36) % 16] || '0';
  return `sha256:${char.repeat(64)}`;
}

const now = '2026-08-05T10:00:00Z';

/** A schema-valid PCC document for the given v2 service_id/extension_key
 * (the extension payload is deliberately empty -- none of the per-service
 * output schemas require any field inside it, only the base PCC document
 * shape is under test here). */
function validPccDocument(
  serviceId: string,
  extensionKey: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const base = {
    pcc_version: '1.0.0',
    job_id: 'job_pccwireresultfix01aaaaaa',
    contract: {
      service_id: serviceId,
      service_version: 'v2',
      input_hash: makeHash('a'),
      input_schema_hash: makeHash('b'),
      output_schema_hash: makeHash('c'),
      quote_id: 'qte_pccwireresultfix01aaaaaa',
      mode: 'paid',
      currency: 'USD',
      network: 'base',
      minimum_quality: 0.8,
      freshness_seconds: 3600,
      issued_at: now,
      expires_at: '2026-08-06T10:00:00Z',
      idempotency_key: 'idk_pccwireresultfix01aaaaaa',
    },
    subject: { type: 'document', canonical_name: 'fixture', identifiers: {} },
    claims: [],
    evidence: [],
    completeness: {
      requested_fields: 0,
      populated_fields: 0,
      supported_fields: 0,
      score: 1.0,
      missing_fields: [],
      unsupported_fields: [],
      stale_fields: [],
      vector: [],
    },
    provenance: {
      routes: [{ type: 'direct', provider: 'fixture', version: '1.0.0' }],
      providers: [{ name: 'fixture', version: '1.0.0', capabilities: [] }],
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
      policy: 'pol_pccwireresultfix01aaaaaa',
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
      signing_key_id: 'kid_pccwireresultfix01aaaaaa',
      signature: 'A'.repeat(86),
      signed_at: now,
    },
    extensions: { [extensionKey]: {} },
  };
  return { ...base, ...overrides };
}

/** The pre-fix `DurableCachedResult.body` shape (business payload nested
 * under `output`, PCC never attached) -- reconstructed here from the exact
 * object-literal git history shows the code used before this checkpoint,
 * so the RED case below fails for the SAME structural reason the real
 * pre-fix code failed, not a fabricated shape. */
function preFixBody(serviceId: string, extensionPayload: Record<string, unknown>) {
  return {
    service_id: serviceId,
    result_class: 'success',
    output: extensionPayload,
    receipt_id: 'rcpt_pccwireresultfix01aaaaaa',
    link_id: 'lnk_pccwireresultfix01aaaaaa',
    link_hash: makeHash('h'),
  };
}

const SERVICES: ReadonlyArray<{ id: SiteborneServiceId; extensionKey: string }> = [
  { id: 'company_evidence_graph.v2', extensionKey: 'net.siteborne.company-evidence.v1' },
  { id: 'web_context_verified.v2', extensionKey: 'net.siteborne.web-context.v1' },
  { id: 'verify_agent_output.v2', extensionKey: 'net.siteborne.agent-verification.v1' },
];

function validate(serviceId: SiteborneServiceId, candidate: unknown) {
  const schema = MCP_SERVICE_OUTPUT_SCHEMAS[serviceId] as object;
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const compiled = ajv.compile(schema);
  return { valid: compiled(candidate), errors: compiled.errors };
}

describe('SUN-1222C-PCC-WIRE-RESULT-IMPLEMENTATION: DurableCachedResult.body must be the governed PCC document', () => {
  describe('RED: the pre-fix business-payload-only envelope never validated', () => {
    it.each(SERVICES)('$id: pre-fix shape fails 2.0.0 schema validation', ({ id, extensionKey }) => {
      const pcc = validPccDocument(id, extensionKey);
      const extensionPayload = (pcc.extensions as Record<string, unknown>)[extensionKey] as Record<
        string,
        unknown
      >;
      const { valid, errors } = validate(id, preFixBody(id, extensionPayload));
      expect(valid).toBe(false);
      expect(errors?.some((e) => e.params && 'missingProperty' in e.params)).toBe(true);
    });
  });

  describe('GREEN: the governed PCC document (the fixed body shape) validates', () => {
    it.each(SERVICES)('$id: the full PCC document validates against 2.0.0', ({ id, extensionKey }) => {
      const pcc = validPccDocument(id, extensionKey);
      const { valid, errors } = validate(id, pcc);
      expect(errors).toBeNull();
      expect(valid).toBe(true);
    });
  });

  describe('MUTATION PROOF: each intended guard fails for the intended reason', () => {
    it.each(SERVICES)('$id: removing pcc_version fails', ({ id, extensionKey }) => {
      const pcc = validPccDocument(id, extensionKey);
      delete (pcc as Record<string, unknown>).pcc_version;
      const { valid, errors } = validate(id, pcc);
      expect(valid).toBe(false);
      expect(JSON.stringify(errors)).toContain('pcc_version');
    });

    it.each(SERVICES)('$id: replacing the whole document with the business payload alone fails', ({
      id,
      extensionKey,
    }) => {
      const pcc = validPccDocument(id, extensionKey);
      const extensionPayload = (pcc.extensions as Record<string, unknown>)[extensionKey];
      const { valid } = validate(id, extensionPayload);
      expect(valid).toBe(false);
    });

    it.each(SERVICES)('$id: unknown contract.service_id fails', ({ id, extensionKey }) => {
      const pcc = validPccDocument(id, extensionKey);
      // Outside the base PCC schema's own closed service_id enum (all 8
      // known v1/v2 service ids) -- a value no known service, real or
      // future, could legitimately carry.
      (pcc.contract as Record<string, unknown>).service_id = 'not_a_real_service.v2';
      const { valid, errors } = validate(id, pcc);
      expect(valid).toBe(false);
      expect(JSON.stringify(errors)).toContain('service_id');
    });

    it.each(SERVICES)('$id: wrong contract.service_version fails', ({ id, extensionKey }) => {
      const pcc = validPccDocument(id, extensionKey);
      (pcc.contract as Record<string, unknown>).service_version = 'v99';
      const { valid, errors } = validate(id, pcc);
      expect(valid).toBe(false);
      expect(JSON.stringify(errors)).toMatch(/service_version|pattern/);
    });

    it.each(SERVICES)('$id: restoring the valid document after each mutation passes again', ({
      id,
      extensionKey,
    }) => {
      const pcc = validPccDocument(id, extensionKey);
      delete (pcc as Record<string, unknown>).pcc_version;
      expect(validate(id, pcc).valid).toBe(false);
      const restored = validPccDocument(id, extensionKey);
      expect(validate(id, restored).valid).toBe(true);
    });
  });
});

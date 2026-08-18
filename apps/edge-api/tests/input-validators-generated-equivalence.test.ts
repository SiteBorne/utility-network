/**
 * SUN-1200 checkpoint F remediation — proves the generated standalone
 * validators (`src/generated/input-validators.generated.js`) accept and
 * reject exactly the same payloads as a runtime `new
 * Ajv2020().compile(schema)` validator built from the same frozen source
 * schema. This is the schema-equivalence proof the checkpoint's own
 * remediation directive requires: switching from runtime compilation to
 * build-time precompilation must not silently change validation
 * semantics.
 */
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import { BUNDLED_SERVICE_INPUT_SCHEMAS } from '@siteborne/protocol-x402';
import { inputValidatorsById } from '../src/generated/input-validators.generated.js';

const COMPANY_INPUT_ID =
  'https://siteborne.net/schemas/services/company-evidence-input.schema.json';
const WEB_INPUT_ID = 'https://siteborne.net/schemas/services/web-context-input.schema.json';
const DOCUMENT_INPUT_ID =
  'https://siteborne.net/schemas/services/document-evidence-input.schema.json';
const AGENT_INPUT_ID =
  'https://siteborne.net/schemas/services/agent-verification-input.schema.json';

function runtimeValidatorFor(schema: unknown) {
  return new Ajv2020({ strict: false }).compile(schema as object);
}

describe('generated standalone input validators are equivalent to runtime AJV compilation', () => {
  it('every generated validator has a matching runtime-compiled counterpart for the same frozen schema', () => {
    const uniqueIds = new Set(
      Object.values(BUNDLED_SERVICE_INPUT_SCHEMAS).map((s) => (s as { $id: string }).$id)
    );
    expect(uniqueIds.size).toBe(4);
    for (const id of uniqueIds) {
      expect(inputValidatorsById[id]).toBeDefined();
    }
  });

  const cases: Array<{
    name: string;
    id: string;
    valid: unknown[];
    invalid: unknown[];
  }> = [
    {
      name: 'company_evidence_graph',
      id: COMPANY_INPUT_ID,
      valid: [{ identifiers: { cik: '0000320193' }, requested_field_groups: ['identity'] }],
      invalid: [
        {}, // schema requires at least one identity signal despite an empty top-level `required`
        { identifiers: { cik: 'not-numeric' } }, // wrong pattern
        { unexpected_field: true }, // additionalProperties: false
        { ticker: 'toolongticker' }, // exceeds pattern/maxLength
        'not-an-object',
        null,
      ],
    },
    {
      name: 'web_context_verified',
      id: WEB_INPUT_ID,
      valid: [{ target_url: 'https://acme.example/', retrieval_mode: 'direct' }],
      invalid: [
        { target_url: 'https://acme.example/' }, // missing required retrieval_mode
        { target_url: 'https://acme.example/', retrieval_mode: 'not-a-real-mode' },
        { target_url: 123, retrieval_mode: 'direct' }, // wrong primitive type
        [],
      ],
    },
    {
      name: 'document_evidence_json',
      id: DOCUMENT_INPUT_ID,
      valid: [
        {
          artifact_reference: {
            artifact_id: 'doc/native-fixture.pdf',
            media_type: 'application/pdf',
            size_bytes: 1,
          },
        },
      ],
      invalid: [
        { artifact_reference: { artifact_id: 'doc/x.pdf' } }, // missing required nested fields
        { artifact_reference: null },
        42,
      ],
    },
    {
      name: 'verify_agent_output',
      id: AGENT_INPUT_ID,
      valid: [
        {
          verification_contract: {
            claims: [{ claim_id: 'total', predicate: 'equals', expected_value: 42 }],
            deterministic_requirements: [],
          },
          candidate_output: { total: 42 },
          required_schema: {},
          verification_mode: 'standard',
        },
      ],
      invalid: [
        { candidate_output: { total: 42 } }, // missing required verification_contract
        {
          verification_contract: { claims: 'not-an-array', deterministic_requirements: [] },
          candidate_output: {},
          required_schema: {},
          verification_mode: 'standard',
        },
        true,
      ],
    },
  ];

  for (const { name, id, valid, invalid } of cases) {
    describe(name, () => {
      const schema = Object.values(BUNDLED_SERVICE_INPUT_SCHEMAS).find(
        (s) => (s as { $id: string }).$id === id
      );
      const runtimeValidate = runtimeValidatorFor(schema);
      const generatedValidate = inputValidatorsById[id]!;

      for (const [i, payload] of valid.entries()) {
        it(`valid payload #${i} is accepted by both the runtime and generated validator`, () => {
          const runtimeResult = runtimeValidate(payload);
          const generatedResult = generatedValidate(payload);
          expect(generatedResult).toBe(runtimeResult);
          expect(generatedResult).toBe(true);
        });
      }

      for (const [i, payload] of invalid.entries()) {
        it(`invalid payload #${i} is rejected by both the runtime and generated validator`, () => {
          const runtimeResult = runtimeValidate(payload);
          const generatedResult = generatedValidate(payload);
          expect(generatedResult).toBe(runtimeResult);
          expect(generatedResult).toBe(false);
        });
      }
    });
  }
});

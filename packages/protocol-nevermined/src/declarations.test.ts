import { describe, expect, it } from 'vitest';
import { NEVERMINED_DECLARATIONS, validateNeverminedDeclaration } from './index';

describe('four canonical Nevermined declarations', () => {
  it('defines exactly one local agent and one PAYG plan for each SITEBORNE service', () => {
    expect(Object.keys(NEVERMINED_DECLARATIONS)).toEqual([
      'company_evidence_graph.v1',
      'web_context_verified.v1',
      'document_evidence_json.v1',
      'verify_agent_output.v1',
    ]);
    expect(
      new Set(Object.values(NEVERMINED_DECLARATIONS).map((d) => d.agent.local_agent_id)).size
    ).toBe(4);
    expect(
      new Set(Object.values(NEVERMINED_DECLARATIONS).map((d) => d.plan.local_plan_id)).size
    ).toBe(4);
  });

  it.each([
    ['company_evidence_graph.v1', '39000'],
    ['web_context_verified.v1', '9000'],
    ['verify_agent_output.v1', '19000'],
  ] as const)('%s derives its exact gross buyer amount from canonical pricing', (id, amount) => {
    expect(NEVERMINED_DECLARATIONS[id].plan.gross_buyer_amount_atomic).toBe(amount);
  });

  it('models document maximum and measured tiers without claiming registration is allowed (SUN-0900B checkpoint 2B: DYNAMIC_UNIT_MAPPING_UNPROVEN — on-chain evidence covers actual===price only, never actual<price)', () => {
    const document = NEVERMINED_DECLARATIONS['document_evidence_json.v1'];
    expect(document.plan).toMatchObject({
      siteborne_payment_semantics: 'upto',
      gross_buyer_amount_atomic: '190000',
      dynamic_actual_settlement_required: true,
      sandbox_capability_verified: false,
      registration_allowed: false,
      actual_tiers_atomic: { native: '12000', ocr: '19000', table: '29000' },
    });
  });

  it('binds declarations to canonical schema hashes, PCC, protocol references, and dedicated routes', () => {
    for (const declaration of Object.values(NEVERMINED_DECLARATIONS)) {
      expect(declaration.agent.input_schema_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(declaration.agent.output_schema_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(declaration.agent.pcc_version).toBe('1.0.0');
      expect(declaration.agent.endpoint).toMatch(/^\/v1\/nevermined\//);
      expect(declaration.agent.protocol_references).toEqual({ mcp: '/mcp', a2a: '/a2a' });
      expect(declaration.agent.production_enabled).toBe(false);
    }
  });

  it('the document declaration (registration_allowed=false) validates as-is', () => {
    expect(
      validateNeverminedDeclaration(NEVERMINED_DECLARATIONS['document_evidence_json.v1'])
    ).toEqual({
      valid: true,
    });
  });

  it('validator would allow an upto plan marked registration_allowed ONLY when dynamic_actual_settlement_required is also explicitly true (documents the shape a future, evidence-backed flip must take)', () => {
    const document = NEVERMINED_DECLARATIONS['document_evidence_json.v1'];
    expect(
      validateNeverminedDeclaration({
        ...document,
        plan: {
          ...document.plan,
          registration_allowed: true,
          dynamic_actual_settlement_required: true,
        },
      })
    ).toEqual({ valid: true });
  });

  it('still rejects an upto plan marked registration_allowed without the explicit dynamic-settlement accounting', () => {
    const document = NEVERMINED_DECLARATIONS['document_evidence_json.v1'];
    expect(
      validateNeverminedDeclaration({
        ...document,
        plan: {
          ...document.plan,
          registration_allowed: true,
          dynamic_actual_settlement_required: false,
        },
      })
    ).toMatchObject({ valid: false, reason: 'dynamic_document_registration_is_capability_gated' });
  });

  it('rejects free, zero-price, credits-trial, and time-trial declarations', () => {
    const valid = NEVERMINED_DECLARATIONS['company_evidence_graph.v1'];
    for (const patch of [
      { plan_classification: 'free' },
      { gross_buyer_amount_atomic: '0' },
      { trial_kind: 'credits' },
      { trial_kind: 'time' },
    ]) {
      expect(
        validateNeverminedDeclaration({ ...valid, plan: { ...valid.plan, ...patch } })
      ).toMatchObject({
        valid: false,
      });
    }
  });
});

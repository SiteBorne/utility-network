import declarationBaseline from '../fixtures/declarations-baseline.json';
import { describe, expect, it } from 'vitest';
import { NEVERMINED_DECLARATIONS } from './index';

describe('Nevermined deterministic declaration baseline', () => {
  it('matches canonical service, route, pricing, and capability declarations', () => {
    const actual = Object.values(NEVERMINED_DECLARATIONS).map(({ agent, plan }) => ({
      service_id: agent.service_id,
      endpoint: agent.endpoint,
      payment_semantics: plan.siteborne_payment_semantics,
      gross_buyer_amount_atomic: plan.gross_buyer_amount_atomic,
      dynamic_actual_settlement_required: plan.dynamic_actual_settlement_required,
      registration_allowed: plan.registration_allowed,
      ...(plan.actual_tiers_atomic ? { actual_tiers_atomic: plan.actual_tiers_atomic } : {}),
    }));
    expect(actual).toEqual(declarationBaseline.declarations);

    for (const { agent, plan } of Object.values(NEVERMINED_DECLARATIONS)) {
      expect({
        plan_classification: plan.plan_classification,
        trial_kind: plan.trial_kind,
        nevermined_scheme: plan.nevermined_scheme,
        asset: plan.asset,
        asset_decimals: plan.asset_decimals,
        pricing_source_version: plan.pricing_source_version,
        sandbox_capability_verified: plan.sandbox_capability_verified,
        production_enabled: agent.production_enabled,
      }).toEqual(declarationBaseline.shared_plan_policy);
    }
  });
});

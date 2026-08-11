import { describe, expect, it } from 'vitest';
import {
  NEVERMINED_PAYMENT_PROVIDER,
  SITEBORNE_NEVERMINED_EXTENSION,
  bindNeverminedPaymentRequired,
  validateNeverminedPaymentRequired,
} from './index';

const base = {
  x402Version: 2 as const,
  resource: { url: 'https://fixture.test/v1/nevermined/company/evidence-graph' },
  accepts: [
    {
      scheme: 'nvm:erc4337' as const,
      network: 'eip155:84532',
      planId: 'siteborne:company_evidence_graph.v1:payg',
      extra: {
        version: '1',
        agentId: 'siteborne:company_evidence_graph.v1:agent',
        httpVerb: 'POST',
      },
    },
  ],
  extensions: {},
};

describe('Nevermined SITEBORNE requirement binding', () => {
  it('binds the official requirement to the local quote, route, rail, amount, and production state', async () => {
    const built = await bindNeverminedPaymentRequired(base, {
      serviceId: 'company_evidence_graph.v1',
      route: base.resource.url,
      quoteId: 'quo_' + '1'.repeat(28),
      amount: '39000',
      semantics: 'exact',
      expiresAt: '2026-08-11T00:05:00.000Z',
      paymentIdentifierRequired: true,
    });
    expect(built.requirementId).toMatch(/^req_[a-f0-9]{24}$/);
    expect(built.paymentRequired.extensions[SITEBORNE_NEVERMINED_EXTENSION]).toEqual({
      version: 1,
      payment_rail: 'nevermined',
      payment_provider: NEVERMINED_PAYMENT_PROVIDER,
      service_id: 'company_evidence_graph.v1',
      route: base.resource.url,
      quote_id: 'quo_' + '1'.repeat(28),
      requirement_id: built.requirementId,
      amount: '39000',
      semantics: 'exact',
      expires_at: '2026-08-11T00:05:00.000Z',
      payment_identifier_required: true,
      production_enabled: false,
    });
    expect(
      await validateNeverminedPaymentRequired(built.paymentRequired, {
        resource: base.resource.url,
        network: 'eip155:84532',
        agentId: base.accepts[0].extra.agentId,
        planId: base.accepts[0].planId,
        serviceId: 'company_evidence_graph.v1',
        quoteId: 'quo_' + '1'.repeat(28),
        requirementId: built.requirementId,
        amount: '39000',
        semantics: 'exact',
        expiresAt: '2026-08-11T00:05:00.000Z',
      })
    ).toMatchObject({ valid: true });
  });

  it.each([
    ['payment_rail', 'cdp'],
    ['payment_provider', 'wrong-provider'],
    ['quote_id', 'quo_' + '2'.repeat(28)],
    ['amount', '0'],
    ['route', '/wrong'],
  ])('rejects a mutated %s binding', async (field, value) => {
    const built = await bindNeverminedPaymentRequired(base, {
      serviceId: 'company_evidence_graph.v1',
      route: base.resource.url,
      quoteId: 'quo_' + '1'.repeat(28),
      amount: '39000',
      semantics: 'exact',
      expiresAt: '2026-08-11T00:05:00.000Z',
      paymentIdentifierRequired: true,
    });
    const extension = built.paymentRequired.extensions[SITEBORNE_NEVERMINED_EXTENSION] as Record<
      string,
      unknown
    >;
    const mutated = {
      ...built.paymentRequired,
      extensions: {
        ...built.paymentRequired.extensions,
        [SITEBORNE_NEVERMINED_EXTENSION]: { ...extension, [field]: value },
      },
    };
    expect(
      await validateNeverminedPaymentRequired(mutated, {
        resource: base.resource.url,
        network: 'eip155:84532',
        agentId: base.accepts[0].extra.agentId,
        planId: base.accepts[0].planId,
        serviceId: 'company_evidence_graph.v1',
        quoteId: 'quo_' + '1'.repeat(28),
        requirementId: built.requirementId,
        amount: '39000',
        semantics: 'exact',
        expiresAt: '2026-08-11T00:05:00.000Z',
      })
    ).toMatchObject({ valid: false });
  });
});

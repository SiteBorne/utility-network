/**
 * PRODUCTION-ECONOMICS-DISCOVERY-01 -- BAZAAR_DECLARATION_GENERATION derives
 * from the canonical economic contract: exact prices, upto ceilings, per-page
 * tiers, network/asset/payTo, resource, unavailable modes. Local declaration
 * only -- nothing here contacts a facilitator or claims a live listing.
 */
import { describe, expect, it } from 'vitest';
import { ECONOMIC_SERVICE_IDS, challengePricingKey } from '@siteborne/pricing';
import {
  PAYTO_NOT_CONFIGURED,
  buildSiteborneDiscoveryDeclaration,
  validateBazaarDeclarationEconomics,
  BAZAAR_PAYMENT_POLICY,
} from './discovery';
import { ALL_BAZAAR_SERVICE_IDS } from './registry-source';
import { SERVICE_CAPABILITY_STATUS } from './capability';
import { frozenInputExample } from './frozen-inputs';
import { purchasableInputExample } from './purchasable-example';
import { canonicalResourceUrl, CANONICAL_RESOURCE_ORIGIN } from './routes';
import { usdToAtomicUnits } from '../pricing/mapping';
import type { SiteborneServiceId } from '../types';

const DESTINATION = {
  network: 'eip155:8453',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  payTo: '0x1111111111111111111111111111111111111111',
};
const base = { nowIso: '2026-01-01T00:00:00.000Z', expiresInSeconds: 300, maxTimeoutSeconds: 30 };

describe('canonical service-id parity', () => {
  it('the pricing package and this package agree on the service-id set', () => {
    expect([...ECONOMIC_SERVICE_IDS].sort()).toEqual([...ALL_BAZAAR_SERVICE_IDS].sort());
  });

  it('BAZAAR_PAYMENT_POLICY is derived: scheme and pricing key equal the canonical contract', () => {
    for (const id of ALL_BAZAAR_SERVICE_IDS) {
      expect(BAZAAR_PAYMENT_POLICY[id].pricing_key).toBe(challengePricingKey(id));
    }
    expect(BAZAAR_PAYMENT_POLICY['document_evidence_json.v2'].scheme).toBe('upto');
    expect(BAZAAR_PAYMENT_POLICY['web_context_verified.v2'].scheme).toBe('exact');
  });

  it('the canonical origin equals the route-table origin used by every surface', () => {
    for (const id of ALL_BAZAAR_SERVICE_IDS) {
      expect(canonicalResourceUrl(id).startsWith(CANONICAL_RESOURCE_ORIGIN)).toBe(true);
    }
  });
});

describe('declaration carries the canonical economics', () => {
  it.each(ALL_BAZAAR_SERVICE_IDS)(
    '%s: accepts, economics and resource agree (no destination)',
    async (serviceId) => {
      const resource = await buildSiteborneDiscoveryDeclaration({ serviceId, ...base });
      expect(validateBazaarDeclarationEconomics(resource)).toEqual([]);
      expect(resource.economics.payment).toBeNull();
      expect(resource.payto_configured).toBe(false);
      expect(resource.accepts[0].payTo).toBe(PAYTO_NOT_CONFIGURED);
      expect(resource.status).toBe('not_live');
      expect(resource.production_enabled).toBe(false);
      expect(resource.economics.production_enabled).toBe(false);
    }
  );

  it.each(ALL_BAZAAR_SERVICE_IDS)(
    '%s: an injected destination reaches accepts and economics identically',
    async (serviceId) => {
      const resource = await buildSiteborneDiscoveryDeclaration({
        serviceId,
        ...base,
        destination: DESTINATION,
      });
      expect(validateBazaarDeclarationEconomics(resource)).toEqual([]);
      expect(resource.accepts[0]).toMatchObject({
        network: DESTINATION.network,
        asset: DESTINATION.asset,
        payTo: DESTINATION.payTo,
      });
      expect(resource.economics.payment).toEqual({
        network: DESTINATION.network,
        asset: DESTINATION.asset,
        pay_to: DESTINATION.payTo,
      });
      expect(resource.payto_configured).toBe(true);
    }
  );

  it('exact: the requirement amount is the canonical list amount in atomic units', async () => {
    const resource = await buildSiteborneDiscoveryDeclaration({
      serviceId: 'web_context_verified.v2',
      ...base,
    });
    expect(resource.accepts[0].scheme).toBe('exact');
    expect(resource.accepts[0].amount).toBe(usdToAtomicUnits('0.008', 6));
    expect(resource.economics.list_amount).toBe('0.008');
  });

  it('upto: the requirement is the authorization ceiling; tiers travel in economics, not as a scalar', async () => {
    const resource = await buildSiteborneDiscoveryDeclaration({
      serviceId: 'document_evidence_json.v2',
      ...base,
    });
    expect(resource.accepts[0].scheme).toBe('upto');
    expect(resource.accepts[0].amount).toBe(usdToAtomicUnits('0.19', 6));
    expect(resource.economics.authorization_maximum).toBe('0.19');
    expect(resource.economics.list_amount).toBeNull();
    expect(resource.economics.tier_prices?.map((t) => t.tier)).toEqual(['native', 'ocr', 'table']);
    expect(resource.economics.limits).toEqual({ max_document_pages: 10 });
  });

  it('never advertises an unavailable mode as the sample call', async () => {
    expect(
      (frozenInputExample('web_context_verified.v2') as { retrieval_mode: string }).retrieval_mode
    ).toBe('rendered');
    expect(
      (purchasableInputExample('web_context_verified.v2') as { retrieval_mode: string })
        .retrieval_mode
    ).toBe('direct');
    const resource = await buildSiteborneDiscoveryDeclaration({
      serviceId: 'web_context_verified.v2',
      ...base,
    });
    const info = (
      resource.extensions.bazaar as { info: { input: { body: { retrieval_mode: string } } } }
    ).info;
    expect(info.input.body.retrieval_mode).toBe('direct');
  });

  it('the hand-maintained capability status agrees with the canonical mode availability', () => {
    for (const id of ALL_BAZAAR_SERVICE_IDS as readonly SiteborneServiceId[]) {
      const excluded = SERVICE_CAPABILITY_STATUS[id].excluded_modes.map((m) => m.mode);
      if (id.startsWith('web_context_verified')) expect(excluded).toContain('rendered');
      if (id.startsWith('verify_agent_output'))
        expect(excluded).toContain('independent_reproduction');
    }
  });
});

describe('contradiction detection', () => {
  it('flags a tampered amount, payTo, network, asset, scheme, or a payTo with no destination', async () => {
    const good = await buildSiteborneDiscoveryDeclaration({
      serviceId: 'verify_agent_output.v2',
      ...base,
      destination: DESTINATION,
    });
    expect(validateBazaarDeclarationEconomics(good)).toEqual([]);
    const tamper = (patch: Record<string, unknown>) => ({
      ...good,
      accepts: [{ ...good.accepts[0], ...patch }],
    });
    expect(validateBazaarDeclarationEconomics(tamper({ amount: '1' })).join()).toContain(
      'does not equal the canonical amount'
    );
    expect(
      validateBazaarDeclarationEconomics(
        tamper({ payTo: '0x3333333333333333333333333333333333333333' })
      ).join()
    ).toContain('payTo differs');
    expect(
      validateBazaarDeclarationEconomics(tamper({ network: 'eip155:84532' })).join()
    ).toContain('network differs');
    expect(validateBazaarDeclarationEconomics(tamper({ asset: '0xabc' })).join()).toContain(
      'asset differs'
    );
    expect(validateBazaarDeclarationEconomics(tamper({ scheme: 'upto' })).join()).toContain(
      'scheme'
    );
    const noDest = await buildSiteborneDiscoveryDeclaration({
      serviceId: 'verify_agent_output.v2',
      ...base,
    });
    const leaked = { ...noDest, accepts: [{ ...noDest.accepts[0], payTo: DESTINATION.payTo }] };
    expect(validateBazaarDeclarationEconomics(leaked).join()).toContain(
      'declares no payment destination'
    );
  });

  it('flags an unavailable mode advertised as available, and a production-enabled sentinel destination', async () => {
    const good = await buildSiteborneDiscoveryDeclaration({
      serviceId: 'web_context_verified.v2',
      ...base,
      destination: DESTINATION,
    });
    const bad = {
      ...good,
      economics: { ...good.economics, available_modes: ['direct', 'rendered'] },
    };
    expect(validateBazaarDeclarationEconomics(bad).join()).toContain('unavailable');
    const sentinel = {
      ...good,
      economics: {
        ...good.economics,
        production_enabled: true,
        payment: { ...good.economics.payment!, pay_to: PAYTO_NOT_CONFIGURED },
      },
    };
    expect(validateBazaarDeclarationEconomics(sentinel).join()).toContain('sentinel or malformed');
  });
});

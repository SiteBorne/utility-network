import { describe, expect, it } from 'vitest';
import {
  buildSiteborneDiscoveryDeclaration,
  BAZAAR_EXTENSION_KEY,
  BAZAAR_PAYMENT_POLICY,
  PAYTO_NOT_CONFIGURED,
} from './discovery';
import { ALL_BAZAAR_SERVICE_IDS, REGISTRY_SERVICES } from './registry-source';
import { validateSiteborneDiscoveryResource } from './validator';

const NOW = '2026-08-10T00:00:00.000Z';

describe('buildSiteborneDiscoveryDeclaration', () => {
  for (const serviceId of ALL_BAZAAR_SERVICE_IDS) {
    it(`${serviceId}: builds a valid discovery declaration`, async () => {
      const resource = await buildSiteborneDiscoveryDeclaration({
        serviceId,
        nowIso: NOW,
        expiresInSeconds: 300,
        maxTimeoutSeconds: 120,
      });

      expect(resource.method).toBe('POST');
      // SUN-1000 checkpoint 1M: each service's resourceUrl matches its
      // own major.
      const expectedPrefix = `https://utility.siteborne.net/v${serviceId.split('.v')[1]}/`;
      expect(resource.resourceUrl.startsWith(expectedPrefix)).toBe(true);
      expect(resource.x402Version).toBe(2);
      expect(resource.status).toBe('not_live');
      expect(resource.production_enabled).toBe(false);
      expect(resource.payto_configured).toBe(false);
      expect(resource.accepts).toHaveLength(1);
      expect(resource.accepts[0].scheme).toBe(BAZAAR_PAYMENT_POLICY[serviceId].scheme);
      expect(resource.accepts[0].payTo).toBe(PAYTO_NOT_CONFIGURED);
      expect(resource.extensions[BAZAAR_EXTENSION_KEY]).toBeTruthy();

      const validation = validateSiteborneDiscoveryResource(serviceId, resource);
      expect(validation.failures).toEqual([]);
      expect(validation.valid).toBe(true);
    });
  }

  it('document_evidence_json.v1 uses upto, not exact — the authorized ceiling is not presented as a fixed price', async () => {
    const resource = await buildSiteborneDiscoveryDeclaration({
      serviceId: 'document_evidence_json.v1',
      nowIso: NOW,
      expiresInSeconds: 300,
      maxTimeoutSeconds: 120,
    });
    expect(resource.accepts[0].scheme).toBe('upto');
  });

  it('company_evidence_graph.v1, web_context_verified.v1, verify_agent_output.v1 all use exact', async () => {
    for (const serviceId of [
      'company_evidence_graph.v1',
      'web_context_verified.v1',
      'verify_agent_output.v1',
    ] as const) {
      const resource = await buildSiteborneDiscoveryDeclaration({
        serviceId,
        nowIso: NOW,
        expiresInSeconds: 300,
        maxTimeoutSeconds: 120,
      });
      expect(resource.accepts[0].scheme).toBe('exact');
    }
  });

  it('isolates company v2 pricing from v1 across Bazaar requirements and registry discovery', async () => {
    const v1 = await buildSiteborneDiscoveryDeclaration({
      serviceId: 'company_evidence_graph.v1',
      nowIso: NOW,
      expiresInSeconds: 300,
      maxTimeoutSeconds: 120,
    });
    const v2 = await buildSiteborneDiscoveryDeclaration({
      serviceId: 'company_evidence_graph.v2',
      nowIso: NOW,
      expiresInSeconds: 300,
      maxTimeoutSeconds: 120,
    });

    expect(v1.accepts[0]).toMatchObject({ amount: '39000' });
    expect(BAZAAR_PAYMENT_POLICY['company_evidence_graph.v1'].pricing_key).toBe(
      'company_evidence_graph'
    );
    expect(v2.accepts[0]).toMatchObject({ amount: '31200' });
    expect(BAZAAR_PAYMENT_POLICY['company_evidence_graph.v2'].pricing_key).toBe(
      'company_evidence_graph_v2'
    );
    expect(REGISTRY_SERVICES['company_evidence_graph.v1'].base_price.amount).toBe('0.039');
    expect(REGISTRY_SERVICES['company_evidence_graph.v2'].base_price.amount).toBe('0.0312');
    expect(REGISTRY_SERVICES['company_evidence_graph.v2'].maximum_price.amount).toBe('0.0312');
  });

  it('is deterministic: identical inputs produce identical quote/requirement identity (directive §34)', async () => {
    const a = await buildSiteborneDiscoveryDeclaration({
      serviceId: 'company_evidence_graph.v1',
      nowIso: NOW,
      expiresInSeconds: 300,
      maxTimeoutSeconds: 120,
    });
    const b = await buildSiteborneDiscoveryDeclaration({
      serviceId: 'company_evidence_graph.v1',
      nowIso: NOW,
      expiresInSeconds: 300,
      maxTimeoutSeconds: 120,
    });
    expect(a.accepts[0].extra?.quote_id).toBe(b.accepts[0].extra?.quote_id);
  });

  it('mutating the resource (a different service) changes the discovery identity (directive §34)', async () => {
    const company = await buildSiteborneDiscoveryDeclaration({
      serviceId: 'company_evidence_graph.v1',
      nowIso: NOW,
      expiresInSeconds: 300,
      maxTimeoutSeconds: 120,
    });
    const web = await buildSiteborneDiscoveryDeclaration({
      serviceId: 'web_context_verified.v1',
      nowIso: NOW,
      expiresInSeconds: 300,
      maxTimeoutSeconds: 120,
    });
    expect(company.accepts[0].extra?.quote_id).not.toBe(web.accepts[0].extra?.quote_id);
  });

  it('a supplied payTo is reflected truthfully as payto_configured: true', async () => {
    const resource = await buildSiteborneDiscoveryDeclaration({
      serviceId: 'company_evidence_graph.v1',
      nowIso: NOW,
      expiresInSeconds: 300,
      maxTimeoutSeconds: 120,
      payTo: '0xRealWalletForTestingOnly',
    });
    expect(resource.payto_configured).toBe(true);
    expect(resource.accepts[0].payTo).toBe('0xRealWalletForTestingOnly');
  });

  it('capability_status never claims production capability (directive §10)', async () => {
    for (const serviceId of ALL_BAZAAR_SERVICE_IDS) {
      const resource = await buildSiteborneDiscoveryDeclaration({
        serviceId,
        nowIso: NOW,
        expiresInSeconds: 300,
        maxTimeoutSeconds: 120,
      });
      expect(resource.capability_status.production_capability).toBe('not_verified');
      expect(resource.capability_status.implementation_status).toBe('local_fixture_verified');
    }
  });
});

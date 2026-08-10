/**
 * Directive §35: adversarial discovery tests — every case must fail
 * closed, never silently pass.
 */
import { describe, expect, it } from 'vitest';
import { buildSiteborneDiscoveryDeclaration, BAZAAR_EXTENSION_KEY } from './discovery';
import { validateSiteborneDiscoveryResource } from './validator';

const NOW = '2026-08-10T00:00:00.000Z';

async function validDeclaration() {
  return buildSiteborneDiscoveryDeclaration({
    serviceId: 'company_evidence_graph.v1',
    nowIso: NOW,
    expiresInSeconds: 300,
    maxTimeoutSeconds: 120,
  });
}

describe('validateSiteborneDiscoveryResource: adversarial cases', () => {
  it('unknown service ID fails closed', async () => {
    const resource = await validDeclaration();
    const result = validateSiteborneDiscoveryResource('unknown_service.v1', resource);
    expect(result.valid).toBe(false);
    expect(result.failures).toEqual(['unknown_service_id']);
  });

  it('wrong service ID (a real but mismatched one) still validates the resource shape on its own terms — service-id/resource correspondence is a caller responsibility, but a completely bogus id fails closed', async () => {
    const resource = await validDeclaration();
    const result = validateSiteborneDiscoveryResource('not_a_real_service.v1', resource);
    expect(result.valid).toBe(false);
  });

  it('stale/unknown x402Version fails', async () => {
    const resource = await validDeclaration();
    const mutated = { ...resource, x402Version: 1 };
    const result = validateSiteborneDiscoveryResource('company_evidence_graph.v1', mutated);
    expect(result.failures).toContain('unsupported_x402_version');
  });

  it('missing Bazaar extension fails', async () => {
    const resource = await validDeclaration();
    const mutated = { ...resource, extensions: {} };
    const result = validateSiteborneDiscoveryResource('company_evidence_graph.v1', mutated);
    expect(result.failures).toContain('missing_bazaar_extension');
  });

  it('malformed Bazaar extension (wrong internal shape) fails', async () => {
    const resource = await validDeclaration();
    const mutated = {
      ...resource,
      extensions: { [BAZAAR_EXTENSION_KEY]: { info: { input: { type: 'not-http' } } } },
    };
    const result = validateSiteborneDiscoveryResource('company_evidence_graph.v1', mutated);
    expect(result.valid).toBe(false);
  });

  it('unsupported HTTP method fails', async () => {
    const resource = await validDeclaration();
    const mutated = { ...resource, method: 'DELETE' as const };
    const result = validateSiteborneDiscoveryResource('company_evidence_graph.v1', mutated);
    expect(result.failures).toContain('unsupported_method');
  });

  it('wrong service route (non-https resourceUrl) fails', async () => {
    const resource = await validDeclaration();
    const mutated = { ...resource, resourceUrl: 'http://insecure.example.com/v1/x' };
    const result = validateSiteborneDiscoveryResource('company_evidence_graph.v1', mutated);
    expect(result.failures).toContain('missing_resource_url');
  });

  it('empty resourceUrl fails', async () => {
    const resource = await validDeclaration();
    const mutated = { ...resource, resourceUrl: '' };
    const result = validateSiteborneDiscoveryResource('company_evidence_graph.v1', mutated);
    expect(result.failures).toContain('missing_resource_url');
  });

  it('wrong payment scheme (unsupported scheme string) fails', async () => {
    const resource = await validDeclaration();
    const mutated = {
      ...resource,
      accepts: [{ ...resource.accepts[0], scheme: 'batch-settlement' }],
    };
    const result = validateSiteborneDiscoveryResource('company_evidence_graph.v1', mutated);
    expect(result.failures).toContain('unsupported_scheme_network');
  });

  it('wrong network (unrecognized namespace) fails', async () => {
    const resource = await validDeclaration();
    const mutated = {
      ...resource,
      accepts: [{ ...resource.accepts[0], network: 'cosmos:hub-4' as `${string}:${string}` }],
    };
    const result = validateSiteborneDiscoveryResource('company_evidence_graph.v1', mutated);
    expect(result.failures).toContain('unsupported_scheme_network');
  });

  it('malformed price amount (non-canonical atomic amount) fails', async () => {
    const resource = await validDeclaration();
    const mutated = { ...resource, accepts: [{ ...resource.accepts[0], amount: '1.5' }] };
    const result = validateSiteborneDiscoveryResource('company_evidence_graph.v1', mutated);
    expect(result.failures).toContain('invalid_price_amount');
  });

  it('empty accepts[] fails', async () => {
    const resource = await validDeclaration();
    const mutated = { ...resource, accepts: [] };
    const result = validateSiteborneDiscoveryResource('company_evidence_graph.v1', mutated);
    expect(result.failures).toContain('missing_accepts');
  });

  it('fake production capability (status !== not_live) fails', async () => {
    const resource = await validDeclaration();
    const mutated = { ...resource, status: 'live' as never };
    const result = validateSiteborneDiscoveryResource('company_evidence_graph.v1', mutated);
    expect(result.failures).toContain('production_falsely_claimed_live');
  });

  it('fake production_enabled: true fails', async () => {
    const resource = await validDeclaration();
    const mutated = { ...resource, production_enabled: true as never };
    const result = validateSiteborneDiscoveryResource('company_evidence_graph.v1', mutated);
    expect(result.failures).toContain('production_falsely_enabled');
  });

  it('duplicate resource/service mapping: building the same service twice yields two structurally-identical (deduplicable) declarations, never two different identities for the same inputs', async () => {
    const a = await validDeclaration();
    const b = await validDeclaration();
    expect(a.accepts[0].extra?.quote_id).toBe(b.accepts[0].extra?.quote_id);
    expect(validateSiteborneDiscoveryResource('company_evidence_graph.v1', a).valid).toBe(true);
    expect(validateSiteborneDiscoveryResource('company_evidence_graph.v1', b).valid).toBe(true);
  });
});

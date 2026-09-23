/**
 * Exercises the real `runRegistryPricingDriftCheck` logic from
 * scripts/check-registry-pricing-drift.mts -- the same function the CLI
 * entry point calls -- rather than asserting on `PRICE_KEY_MAP` directly.
 *
 * Two defects motivated this suite:
 *  (a) `verify_agent_output.v2` was mapped to the v1 authority key
 *      (`verify_agent_output_standard`, 0.019) instead of the governed v2
 *      key (`verify_agent_output_standard_v2`, 0.017) -- it happened to
 *      pass only because the frozen registry JSON's own v1-era base_price
 *      (0.019) coincidentally matched the wrong key it was being checked
 *      against.
 *  (b) all four `.v3` registry files were entirely absent from the
 *      coverage map, so drift in any of them went undetected.
 *
 * The "correct"/"PASS" cases below run against the real repo tree (real
 * registry/services/*.json, real governance/RISK_LIMITS.yaml via the real
 * `resolveServiceMaxPriceUsd`) so they prove the actual current state is
 * clean. The "wrong"/"FAIL" cases inject a synthetic registry-entry reader
 * and/or price resolver to simulate drift without mutating real repo
 * files.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PRICE_KEY_MAP,
  runRegistryPricingDriftCheck,
  type RegistryPriceKeyEntry,
} from './check-registry-pricing-drift.mts';
import { resolveServiceMaxPriceUsd } from '../packages/pricing/src/service-prices';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const OK_ENTRY = { base_price: { amount: '1', currency: 'USD' }, maximum_price: { amount: '1', currency: 'USD' } };

describe('runRegistryPricingDriftCheck (real checker logic)', () => {
  it('PASSes against the real repo: verify_agent_output.v2 validates against the governed v2 price (0.017), not v1 (0.019)', () => {
    const result = runRegistryPricingDriftCheck({ repoRoot });
    expect(result.problems).toEqual([]);
    expect(result.validated).toContain('verify_agent_output.v2');
    // Proves the fix actually checks the v2 authority key, not the v1 one.
    expect(PRICE_KEY_MAP['verify_agent_output.v2'].baseKey).toBe(
      'verify_agent_output_standard_v2'
    );
    expect(resolveServiceMaxPriceUsd('verify_agent_output_standard_v2')).toBe('0.017');
  });

  it('FAILs when verify_agent_output.v2 is checked against the wrong (v1, 0.019) authority key', () => {
    const wrongMap: Record<string, RegistryPriceKeyEntry> = {
      ...PRICE_KEY_MAP,
      // Reproduces defect (a) exactly: v1 key, unprojected.
      'verify_agent_output.v2': { baseKey: 'verify_agent_output_standard' },
    };
    const result = runRegistryPricingDriftCheck({
      repoRoot,
      priceKeyMap: wrongMap,
      // Simulate the actual runtime-served (governed v2) price, 0.017 --
      // which now disagrees with the wrong key's expectation of 0.019.
      readRegistryEntry: (id) =>
        id === 'verify_agent_output.v2'
          ? { base_price: { amount: '0.017', currency: 'USD' }, maximum_price: { amount: '0.017', currency: 'USD' } }
          : defaultRead(id),
    });
    expect(result.problems.some((p) => p.startsWith('verify_agent_output.v2:'))).toBe(true);
  });

  it('PASSes for all four real .v3 registry files against their governed v2-generation prices', () => {
    const result = runRegistryPricingDriftCheck({ repoRoot });
    for (const id of [
      'company_evidence_graph.v3',
      'web_context_verified.v3',
      'document_evidence_json.v3',
      'verify_agent_output.v3',
    ]) {
      expect(result.validated).toContain(id);
      expect(result.problems.some((p) => p.startsWith(`${id}:`))).toBe(false);
    }
  });

  it.each([
    'company_evidence_graph.v3',
    'web_context_verified.v3',
    'document_evidence_json.v3',
    'verify_agent_output.v3',
  ])('FAILs when %s registry JSON is mutated to disagree with governance', (mutatedId) => {
    const result = runRegistryPricingDriftCheck({
      repoRoot,
      readRegistryEntry: (id) =>
        id === mutatedId
          ? { base_price: { amount: '999.99', currency: 'USD' }, maximum_price: { amount: '999.99', currency: 'USD' } }
          : defaultRead(id),
    });
    expect(result.problems.some((p) => p.startsWith(`${mutatedId}:`))).toBe(true);
  });

  it('FAILs closed when a .v3 entry is missing from the coverage map even though its file exists on disk', () => {
    const mapWithoutOneV3: Record<string, RegistryPriceKeyEntry> = { ...PRICE_KEY_MAP };
    delete mapWithoutOneV3['verify_agent_output.v3'];
    const result = runRegistryPricingDriftCheck({ repoRoot, priceKeyMap: mapWithoutOneV3 });
    expect(result.uncovered).toContain('verify_agent_output.v3');
    expect(
      result.problems.some((p) => p.includes('verify_agent_output.v3') && p.includes('unknown registry identity'))
    ).toBe(true);
  });

  it('fails closed on an unknown registry identity discovered on disk but absent from the map', () => {
    const result = runRegistryPricingDriftCheck({
      repoRoot,
      // A minimal map that deliberately omits every real service id --
      // every file discovered under registry/services/ must then be
      // reported uncovered, proving unknown identities are never silently
      // skipped.
      priceKeyMap: {},
      readRegistryEntry: () => OK_ENTRY,
    });
    expect(result.discovered.length).toBeGreaterThanOrEqual(12);
    expect(result.uncovered).toEqual(result.discovered);
    expect(result.problems.length).toBe(result.discovered.length);
    for (const id of result.discovered) {
      expect(result.problems.some((p) => p.startsWith(`${id}:`) && p.includes('unknown registry identity'))).toBe(
        true
      );
    }
  });

  it('reports zero uncovered against the real repo tree (full coverage)', () => {
    const result = runRegistryPricingDriftCheck({ repoRoot });
    expect(result.discovered.length).toBe(12);
    expect(result.validated.length).toBe(12);
    expect(result.uncovered).toEqual([]);
  });
});

function defaultRead(id: string) {
  return JSON.parse(readFileSync(join(repoRoot, 'registry', 'services', `${id}.json`), 'utf8'));
}

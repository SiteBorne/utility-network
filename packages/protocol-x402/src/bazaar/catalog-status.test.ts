import { describe, expect, it } from 'vitest';
import { CURRENT_BAZAAR_CATALOG_STATUS, assertCatalogStatusIsEvidenced } from './catalog-status';

describe('Bazaar catalog status (directive §21)', () => {
  it('SUN-0700A always reports not_submitted', () => {
    expect(CURRENT_BAZAAR_CATALOG_STATUS).toBe('not_submitted');
  });

  it('assertCatalogStatusIsEvidenced accepts not_submitted', () => {
    expect(() => assertCatalogStatusIsEvidenced('not_submitted')).not.toThrow();
  });

  it('assertCatalogStatusIsEvidenced fails closed for every other status — no facilitator evidence exists for any of them', () => {
    for (const status of ['submitted_unverified', 'processing', 'cataloged', 'rejected'] as const) {
      expect(() => assertCatalogStatusIsEvidenced(status)).toThrow();
    }
  });
});

/**
 * Models a Bazaar catalog's *external* status (directive §21) — a type
 * only, deliberately: SUN-0700A never submits to a live facilitator, so
 * there is no real state transition to persist yet, and adding a D1 table
 * for a status this package can only ever report as `not_submitted` would
 * be schema speculation the directive explicitly warns against ("do not
 * add a database table unless genuinely needed").
 */

export type BazaarCatalogStatus =
  | 'not_submitted'
  | 'submitted_unverified'
  | 'processing'
  | 'cataloged'
  | 'rejected';

/** SUN-0700A's only legally-producible status — no facilitator submission
 * code exists anywhere in this package (proven in
 * `src/tests/no-network.test.ts`), so nothing here can ever legitimately
 * report anything else. */
export const CURRENT_BAZAAR_CATALOG_STATUS: BazaarCatalogStatus = 'not_submitted';

/** Fails closed if ever called with a status this checkpoint has no real
 * evidence for — guards against a future caller accidentally hardcoding
 * `'cataloged'` without a real facilitator response to back it. */
export function assertCatalogStatusIsEvidenced(status: BazaarCatalogStatus): void {
  if (status !== 'not_submitted') {
    throw new Error(
      `refusing to assert Bazaar catalog status "${status}" — SUN-0700A has never called a live facilitator and cannot produce this status truthfully`
    );
  }
}

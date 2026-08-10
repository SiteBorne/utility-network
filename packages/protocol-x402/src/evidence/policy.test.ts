import { describe, expect, it } from 'vitest';
import { isTrustClassAllowed } from './policy';

describe('isTrustClassAllowed', () => {
  it('fixture mode allows synthetic_fixture and locally_derived_structure_only', () => {
    expect(isTrustClassAllowed('synthetic_fixture', 'fixture')).toBe(true);
    expect(isTrustClassAllowed('locally_derived_structure_only', 'fixture')).toBe(true);
  });

  it('fixture mode never allows external_unverified or external_verified', () => {
    expect(isTrustClassAllowed('external_unverified', 'fixture')).toBe(false);
    expect(isTrustClassAllowed('external_verified', 'fixture')).toBe(false);
  });

  it('production mode never allows synthetic_fixture', () => {
    expect(isTrustClassAllowed('synthetic_fixture', 'production')).toBe(false);
  });

  it('production mode never allows locally_derived_structure_only', () => {
    expect(isTrustClassAllowed('locally_derived_structure_only', 'production')).toBe(false);
  });

  it('production mode never allows external_unverified', () => {
    expect(isTrustClassAllowed('external_unverified', 'production')).toBe(false);
  });

  it('production mode allows only external_verified (which SUN-0700A itself never produces)', () => {
    expect(isTrustClassAllowed('external_verified', 'production')).toBe(true);
  });
});

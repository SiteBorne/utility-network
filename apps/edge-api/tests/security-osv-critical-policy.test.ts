import { describe, expect, it } from 'vitest';
import { vulnIsCritical, type OsvPackageVuln } from '../../../scripts/security/run-osv';

/**
 * SUN-1000 checkpoint 1F — credential-free unit tests for the OSV-Scanner
 * blocking-policy correction: the exit code now reflects the literal,
 * frozen TASKS.yaml criterion ('OSV-Scanner finds no critical
 * vulnerabilities') rather than checkpoint 1B's original "any finding
 * with a fix available" stand-in. No network access, no OSV-Scanner
 * binary invocation, no credentials — pure function tests only.
 */
describe('vulnIsCritical', () => {
  it('returns true when database_specific.severity is exactly CRITICAL', () => {
    const vuln: OsvPackageVuln = {
      id: 'GHSA-example-critical',
      database_specific: { severity: 'CRITICAL' },
    };
    expect(vulnIsCritical(vuln)).toBe(true);
  });

  it('returns false for HIGH severity', () => {
    const vuln: OsvPackageVuln = {
      id: 'GHSA-example-high',
      database_specific: { severity: 'HIGH' },
    };
    expect(vulnIsCritical(vuln)).toBe(false);
  });

  it('returns false for MODERATE severity', () => {
    const vuln: OsvPackageVuln = {
      id: 'GHSA-example-moderate',
      database_specific: { severity: 'MODERATE' },
    };
    expect(vulnIsCritical(vuln)).toBe(false);
  });

  it('returns false for LOW severity', () => {
    const vuln: OsvPackageVuln = {
      id: 'GHSA-example-low',
      database_specific: { severity: 'LOW' },
    };
    expect(vulnIsCritical(vuln)).toBe(false);
  });

  it('returns false when database_specific is absent (unscored findings never block)', () => {
    const vuln: OsvPackageVuln = { id: 'GHSA-example-unscored' };
    expect(vulnIsCritical(vuln)).toBe(false);
  });

  it('returns false when database_specific.severity is absent', () => {
    const vuln: OsvPackageVuln = {
      id: 'GHSA-example-unscored-2',
      database_specific: {},
    };
    expect(vulnIsCritical(vuln)).toBe(false);
  });

  it('is case-sensitive and does not match a lowercase severity string', () => {
    const vuln: OsvPackageVuln = {
      id: 'GHSA-example-lowercase',
      database_specific: { severity: 'critical' },
    };
    expect(vulnIsCritical(vuln)).toBe(false);
  });
});

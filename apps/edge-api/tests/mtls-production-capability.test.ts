/**
 * SUN-1222C-DEPLOYMENT-DEPENDENCY-AND-MTLS-TRUTHFULNESS-REMEDIATION.
 *
 * Direct unit coverage for `resolveMtlsProductionActive` in isolation,
 * complementing the end-to-end proofs in
 * `packages/protocol-a2a/src/card.test.ts` (package-level default
 * parameter) and `apps/edge-api/tests/a2a-route.test.ts` (real Worker
 * route wiring).
 */
import { describe, expect, it } from 'vitest';
import { resolveMtlsProductionActive } from '../src/control-plane/config/mtls-production-capability';

describe('resolveMtlsProductionActive (SUN-1222C-DEPLOYMENT-DEPENDENCY-AND-MTLS-TRUTHFULNESS-REMEDIATION)', () => {
  it('returns false when MTLS_PRODUCTION_ACTIVE is absent', () => {
    expect(resolveMtlsProductionActive({})).toBe(false);
  });

  it('returns false when MTLS_PRODUCTION_ACTIVE is undefined explicitly', () => {
    expect(resolveMtlsProductionActive({ MTLS_PRODUCTION_ACTIVE: undefined })).toBe(false);
  });

  it('returns true only for the exact literal "true"', () => {
    expect(resolveMtlsProductionActive({ MTLS_PRODUCTION_ACTIVE: 'true' })).toBe(true);
  });

  it('fails closed (returns false) for every near-miss value', () => {
    for (const nearMiss of ['1', 'True', 'TRUE', 'yes', ' true', 'true ', 'false']) {
      expect(resolveMtlsProductionActive({ MTLS_PRODUCTION_ACTIVE: nearMiss }), nearMiss).toBe(
        false
      );
    }
  });
});

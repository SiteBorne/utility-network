import { describe, expect, it } from 'vitest';
import {
  isCompanyEvidenceGraphV2CdpRouteFlagEnabled,
  isDocumentEvidenceJsonV2CdpRouteFlagEnabled,
  isVerifyAgentOutputV2CdpRouteFlagEnabled,
  isWebContextV2CdpRouteFlagEnabled,
  resolvePaymentEnvironment,
  resolveProductionAuthorizationInput,
} from './production-payment';

/**
 * SUN-1222C var-drift investigation (this checkpoint): proves, at the unit
 * level, the fail-closed absence semantics that
 * `docs/reports/SUN-1222C-*var-drift*` and `wrangler.toml`'s own [vars]
 * comment (SUN-1205 checkpoint K completion) already document in prose --
 * that an ordinary candidate lacking the ten out-of-band production/payment
 * vars (PAID_ROUTES_ENABLED, PRODUCTION_ENABLED, PAYMENT_ENVIRONMENT,
 * PRODUCTION_CDP_CREDENTIALS_APPROVED, HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP,
 * and the five *_ROUTE_ENABLED flags) is behaviorally IDENTICAL to one
 * where every one of those vars is explicitly set to its disabling value.
 * Absence can never be silently reinterpreted as enabling any of them --
 * this is the actual safety property `wrangler versions upload`/
 * `versions secret put` rely on when they omit these vars, not a bug to be
 * "fixed" by reproducing live values on every candidate.
 */
describe('production-payment fail-closed absence semantics', () => {
  describe('resolvePaymentEnvironment', () => {
    it('resolves only the exact literal "production" to production', () => {
      expect(resolvePaymentEnvironment('production')).toBe('production');
    });

    it.each([undefined, '', 'Production', 'PRODUCTION', 'prod', 'preproduction', 'true'])(
      'fails closed to preproduction for %j',
      (raw) => {
        expect(resolvePaymentEnvironment(raw)).toBe('preproduction');
      }
    );
  });

  describe('resolveProductionAuthorizationInput', () => {
    const baseline = {
      PAYMENT_ENVIRONMENT: undefined,
      PRODUCTION_ENABLED: undefined,
      HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: undefined,
      PRODUCTION_CDP_CREDENTIALS_APPROVED: undefined,
    };

    it('absent env resolves all four ADR-0055 gates to their disabled state', () => {
      expect(resolveProductionAuthorizationInput(baseline)).toEqual({
        environment: 'preproduction',
        productionEnabled: false,
        humanBootstrapAuthorized: false,
        productionCredentialsApproved: false,
      });
    });

    it('absent and explicit "false" are byte-identical for every boolean gate', () => {
      const explicitFalse = {
        PAYMENT_ENVIRONMENT: 'preproduction',
        PRODUCTION_ENABLED: 'false',
        HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: 'false',
        PRODUCTION_CDP_CREDENTIALS_APPROVED: 'false',
      };
      expect(resolveProductionAuthorizationInput(explicitFalse)).toEqual(
        resolveProductionAuthorizationInput(baseline)
      );
    });

    it('every gate requires its own exact "true" -- no partial/case-insensitive/truthy match', () => {
      expect(
        resolveProductionAuthorizationInput({
          ...baseline,
          PRODUCTION_ENABLED: 'TRUE',
        }).productionEnabled
      ).toBe(false);
      expect(
        resolveProductionAuthorizationInput({
          ...baseline,
          PRODUCTION_ENABLED: '1',
        }).productionEnabled
      ).toBe(false);
    });
  });

  describe.each([
    [
      'isVerifyAgentOutputV2CdpRouteFlagEnabled',
      isVerifyAgentOutputV2CdpRouteFlagEnabled,
      'VERIFY_V2_CDP_ROUTE_ENABLED',
    ] as const,
    [
      'isWebContextV2CdpRouteFlagEnabled',
      isWebContextV2CdpRouteFlagEnabled,
      'WEB_CONTEXT_V2_CDP_ROUTE_ENABLED',
    ] as const,
    [
      'isCompanyEvidenceGraphV2CdpRouteFlagEnabled',
      isCompanyEvidenceGraphV2CdpRouteFlagEnabled,
      'COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED',
    ] as const,
    [
      'isDocumentEvidenceJsonV2CdpRouteFlagEnabled',
      isDocumentEvidenceJsonV2CdpRouteFlagEnabled,
      'DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED',
    ] as const,
  ])('%s', (_name, fn, routeFlagKey) => {
    it('returns false when both flags are absent (a candidate missing the out-of-band vars entirely)', () => {
      expect(fn({ PAID_ROUTES_ENABLED: undefined, [routeFlagKey]: undefined } as never)).toBe(
        false
      );
    });

    it('returns false when both flags are explicitly "false" -- identical to absent', () => {
      expect(fn({ PAID_ROUTES_ENABLED: 'false', [routeFlagKey]: 'false' } as never)).toBe(false);
    });

    it('returns false when PAID_ROUTES_ENABLED is absent even if the route-specific flag is "true"', () => {
      expect(fn({ PAID_ROUTES_ENABLED: undefined, [routeFlagKey]: 'true' } as never)).toBe(false);
    });

    it('returns false when the route-specific flag is absent even if PAID_ROUTES_ENABLED is "true"', () => {
      expect(fn({ PAID_ROUTES_ENABLED: 'true', [routeFlagKey]: undefined } as never)).toBe(false);
    });

    it('returns true only when both are the exact literal "true"', () => {
      expect(fn({ PAID_ROUTES_ENABLED: 'true', [routeFlagKey]: 'true' } as never)).toBe(true);
    });
  });
});

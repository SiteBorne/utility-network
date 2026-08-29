import { describe, it, expect } from 'vitest';
import {
  TermsGuard,
  isExplicitlyAllowed,
  isCapabilityRiskAccepted,
  type TermsReview,
} from '../policy/terms-guard';
import { PolicyBlockedError } from '../errors';
import type { ProviderManifest } from '../types';

/**
 * SUN-1221E2T1: TermsGuard tri-state correctness.
 *
 * SUN-1221E2T proved (and SUN-1221E2T1 §3 reproduces below, standalone) that
 * `if (!manifest.some_permission_flag)` treats the tri-state placeholder
 * `'unknown'` as JS-truthy, so it silently passed instead of failing closed.
 *
 * This suite proves the fix's two distinct, explicit governance modes never
 * blur into each other:
 *  - 'provider_terms_review': only a literal `true` on all three permission
 *    flags passes; `false` and `'unknown'` both fail closed.
 *  - 'operator_risk_acceptance': an explicit, capability-scoped review lets
 *    a capability through without asserting the per-site permission flags
 *    (which may legitimately stay 'unknown') -- but only for the exact
 *    provider id it was recorded against, never anything else.
 */

function manifestWith(overrides: Partial<ProviderManifest> = {}): ProviderManifest {
  return {
    provider_id: 'tri-state-test-provider',
    source_class: 'public_web',
    base_uris: ['https://example.com'],
    capabilities: ['test_capability'],
    commercial_application_allowed: true,
    automated_access_allowed: true,
    transformed_output_allowed: true,
    raw_access_resale_allowed: false,
    sensitive_data_allowed: false,
    account_sharing_allowed: false,
    quota_multiplication_allowed: false,
    credentials_required: false,
    terms_uri: 'https://example.com/terms',
    terms_hash: null,
    terms_review_status: 'pending_review',
    reviewed_at: null,
    rate_policy: {
      strategy: 'token_bucket',
      maximum_concurrency: 5,
      minimum_interval_ms: 100,
      retry_after_respected: true,
      maximum_retries: 3,
    },
    promotion_state: 'fixture_tested',
    ...overrides,
  };
}

function providerReview(overrides: Partial<TermsReview> = {}): TermsReview {
  return {
    providerId: 'tri-state-test-provider',
    termsUri: 'https://example.com/terms',
    termsHash: null,
    reviewedAt: '2026-01-01T00:00:00Z',
    status: 'verified',
    reviewBasis: 'provider_terms_review',
    reviewer: 'legal',
    notes: '',
    ...overrides,
  };
}

describe('SUN-1221E2T1: isExplicitlyAllowed', () => {
  it('true -> true', () => {
    expect(isExplicitlyAllowed(true)).toBe(true);
  });
  it("'unknown' -> false (the bug: 'unknown' is JS-truthy but must not be an explicit grant)", () => {
    expect(isExplicitlyAllowed('unknown')).toBe(false);
  });
  it('false -> false', () => {
    expect(isExplicitlyAllowed(false)).toBe(false);
  });
});

describe('SUN-1221E2T1: isCapabilityRiskAccepted', () => {
  it('true for a verified operator_risk_acceptance review matching the provider id', () => {
    const review = providerReview({ reviewBasis: 'operator_risk_acceptance' });
    expect(isCapabilityRiskAccepted(review, 'tri-state-test-provider')).toBe(true);
  });
  it('false when providerId does not match (no transfer to another capability)', () => {
    const review = providerReview({ reviewBasis: 'operator_risk_acceptance' });
    expect(isCapabilityRiskAccepted(review, 'some-other-provider')).toBe(false);
  });
  it('false for provider_terms_review basis even if status verified', () => {
    const review = providerReview({ reviewBasis: 'provider_terms_review' });
    expect(isCapabilityRiskAccepted(review, 'tri-state-test-provider')).toBe(false);
  });
  it('false when status is not verified (e.g. blocked/pending), even with operator_risk_acceptance basis', () => {
    expect(
      isCapabilityRiskAccepted(
        providerReview({ reviewBasis: 'operator_risk_acceptance', status: 'blocked' }),
        'tri-state-test-provider'
      )
    ).toBe(false);
    expect(
      isCapabilityRiskAccepted(
        providerReview({ reviewBasis: 'operator_risk_acceptance', status: 'pending_review' }),
        'tri-state-test-provider'
      )
    ).toBe(false);
  });
  it('false for undefined review', () => {
    expect(isCapabilityRiskAccepted(undefined, 'tri-state-test-provider')).toBe(false);
  });
});

describe('SUN-1221E2T1: provider_terms_review mode -- literal-true-only permission gate', () => {
  it('§8 -- explicit true on all three flags passes', () => {
    const guard = new TermsGuard([providerReview()]);
    expect(() => guard.checkAccess(manifestWith(), 'live')).not.toThrow();
  });

  it('§7 -- commercial_application_allowed=false fails closed', () => {
    const guard = new TermsGuard([providerReview()]);
    expect(() =>
      guard.checkAccess(manifestWith({ commercial_application_allowed: false }), 'live')
    ).toThrow(PolicyBlockedError);
  });

  it('§7 -- automated_access_allowed=false fails closed', () => {
    const guard = new TermsGuard([providerReview()]);
    expect(() =>
      guard.checkAccess(manifestWith({ automated_access_allowed: false }), 'live')
    ).toThrow(PolicyBlockedError);
  });

  it('§7 -- transformed_output_allowed=false fails closed', () => {
    const guard = new TermsGuard([providerReview()]);
    expect(() =>
      guard.checkAccess(manifestWith({ transformed_output_allowed: false }), 'live')
    ).toThrow(PolicyBlockedError);
  });

  it("§6 -- commercial_application_allowed='unknown' fails closed (the bug, proven fixed)", () => {
    const guard = new TermsGuard([providerReview()]);
    expect(() =>
      guard.checkAccess(manifestWith({ commercial_application_allowed: 'unknown' }), 'live')
    ).toThrow(PolicyBlockedError);
  });

  it("§6 -- automated_access_allowed='unknown' fails closed (the bug, proven fixed)", () => {
    const guard = new TermsGuard([providerReview()]);
    expect(() =>
      guard.checkAccess(manifestWith({ automated_access_allowed: 'unknown' }), 'live')
    ).toThrow(PolicyBlockedError);
  });

  it("§6 -- transformed_output_allowed='unknown' fails closed (the bug, proven fixed)", () => {
    const guard = new TermsGuard([providerReview()]);
    expect(() =>
      guard.checkAccess(manifestWith({ transformed_output_allowed: 'unknown' }), 'live')
    ).toThrow(PolicyBlockedError);
  });

  it('§11 -- a review missing a valid reviewBasis (cast from untyped data) falls through to the strict path, not the permissive one', () => {
    const malformedReview = {
      ...providerReview({ reviewBasis: 'operator_risk_acceptance' }),
      reviewBasis: 'not-a-real-basis',
    } as unknown as TermsReview;
    const guard = new TermsGuard([malformedReview]);
    // All three flags 'unknown' -- must NOT pass just because *some* review
    // exists; an unrecognized basis must fail closed into provider_terms_review.
    expect(() =>
      guard.checkAccess(
        manifestWith({
          commercial_application_allowed: 'unknown',
          automated_access_allowed: 'unknown',
          transformed_output_allowed: 'unknown',
        }),
        'live'
      )
    ).toThrow(PolicyBlockedError);
  });
});

describe('SUN-1221E2T1: operator_risk_acceptance mode -- explicit capability-scoped acceptance', () => {
  function unknownFlagsManifest(overrides: Partial<ProviderManifest> = {}): ProviderManifest {
    return manifestWith({
      commercial_application_allowed: 'unknown',
      automated_access_allowed: 'unknown',
      transformed_output_allowed: 'unknown',
      ...overrides,
    });
  }

  it('§9 -- exact accepted capability passes with all permission flags unknown', () => {
    const guard = new TermsGuard([providerReview({ reviewBasis: 'operator_risk_acceptance' })]);
    expect(() => guard.checkAccess(unknownFlagsManifest(), 'live')).not.toThrow();
  });

  it('§10 -- does not transfer to a different (unreviewed) provider id', () => {
    const guard = new TermsGuard([providerReview({ reviewBasis: 'operator_risk_acceptance' })]);
    expect(() =>
      guard.checkAccess(unknownFlagsManifest({ provider_id: 'some-other-provider' }), 'live')
    ).toThrow(PolicyBlockedError);
  });

  it('§10 -- does not transfer to a wildcard-style provider id ("all-http")', () => {
    const guard = new TermsGuard([providerReview({ reviewBasis: 'operator_risk_acceptance' })]);
    expect(() =>
      guard.checkAccess(unknownFlagsManifest({ provider_id: 'all-http' }), 'live')
    ).toThrow(PolicyBlockedError);
  });

  it('§10 -- does not transfer to a browser/JS-style provider id', () => {
    const guard = new TermsGuard([providerReview({ reviewBasis: 'operator_risk_acceptance' })]);
    expect(() =>
      guard.checkAccess(unknownFlagsManifest({ provider_id: 'browser' }), 'live')
    ).toThrow(PolicyBlockedError);
  });

  it('§10 -- a rejected (status=blocked) risk-acceptance review still blocks', () => {
    const guard = new TermsGuard([
      providerReview({ reviewBasis: 'operator_risk_acceptance', status: 'blocked' }),
    ]);
    expect(() => guard.checkAccess(unknownFlagsManifest(), 'live')).toThrow(PolicyBlockedError);
  });

  it('§9 -- missing acceptance (no review at all) blocks, even with all flags unknown', () => {
    const guard = new TermsGuard();
    expect(() => guard.checkAccess(unknownFlagsManifest(), 'live')).toThrow(PolicyBlockedError);
  });

  it('operator_risk_acceptance for this provider does not implicitly grant provider_terms_review permission semantics elsewhere -- flags remain unknown, not coerced to true', () => {
    const manifest = unknownFlagsManifest();
    const guard = new TermsGuard([providerReview({ reviewBasis: 'operator_risk_acceptance' })]);
    guard.checkAccess(manifest, 'live'); // does not throw
    // The manifest itself is untouched -- risk acceptance does not rewrite
    // the underlying tri-state permission data.
    expect(manifest.commercial_application_allowed).toBe('unknown');
    expect(manifest.automated_access_allowed).toBe('unknown');
    expect(manifest.transformed_output_allowed).toBe('unknown');
  });
});

import { describe, it, expect } from 'vitest';
import { TermsGuard, globalTermsGuard } from '../policy/terms-guard';
import { PolicyBlockedError } from '../errors';
import { DIRECT_PUBLIC_HTTP_MANIFEST } from '../http/public-http-adapter';
import type { ProviderManifest } from '../types';

/**
 * SUN-1221E2T: direct-public-http terms review.
 *
 * globalTermsGuard.checkAccess() previously threw for direct-public-http in
 * 'live' execution mode because no review record existed anywhere in source.
 * SUN-1221E2D proved this deterministically via real workerd execution
 * (docs/reports/SUN-1221E2D-web-context-executor-diagnostics.md).
 *
 * This suite proves:
 *  (1) the permanent fail-closed invariant: an unreviewed capability stays
 *      blocked, always (§7 of the checkpoint) -- this must never regress;
 *  (2) direct-public-http specifically now passes the terms gate, because a
 *      review record was added, scoped exactly to the operator's recorded
 *      risk-acceptance approval (§8/§10);
 *  (3) the review does not leak to any other capability (§10 non-transfer
 *      requirements): wildcard/browser/unrelated capabilities remain
 *      unreviewed and blocked.
 */

function otherManifest(overrides: Partial<ProviderManifest> = {}): ProviderManifest {
  return {
    provider_id: 'some-other-provider',
    source_class: 'public_web',
    base_uris: ['https://example.org'],
    capabilities: ['some_other_capability'],
    commercial_application_allowed: true,
    automated_access_allowed: true,
    transformed_output_allowed: true,
    raw_access_resale_allowed: false,
    sensitive_data_allowed: false,
    account_sharing_allowed: false,
    quota_multiplication_allowed: false,
    credentials_required: false,
    terms_uri: 'https://example.org/terms',
    terms_hash: 'hash-v1',
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

describe('SUN-1221E2T: direct-public-http terms review', () => {
  // (1) permanent fail-closed invariant -- must hold for ANY unreviewed
  // capability, forever, regardless of what direct-public-http's own state is.
  it('§7 -- an unreviewed capability remains blocked in live mode (fail-closed, permanent)', () => {
    const guard = new TermsGuard();
    expect(() => guard.checkAccess(otherManifest(), 'live')).toThrow(PolicyBlockedError);
  });

  it('§7 -- globalTermsGuard still blocks an unrelated unreviewed provider in live mode', () => {
    expect(() => globalTermsGuard.checkAccess(otherManifest(), 'live')).toThrow(PolicyBlockedError);
  });

  // (2) direct-public-http specifically is now reviewed and passes the gate.
  it('§10 -- direct-public-http passes globalTermsGuard.checkAccess in live mode', () => {
    expect(() => globalTermsGuard.checkAccess(DIRECT_PUBLIC_HTTP_MANIFEST, 'live')).not.toThrow();
  });

  it('§10 -- direct-public-http review is recorded with status=verified', () => {
    const review = globalTermsGuard.getReview('direct-public-http');
    expect(review).toBeDefined();
    expect(review?.status).toBe('verified');
    expect(review?.providerId).toBe('direct-public-http');
  });

  it('§10 -- direct-public-http review is distinguishable operator risk-acceptance, not a per-site legal/ToS review', () => {
    const review = globalTermsGuard.getReview('direct-public-http');
    expect(review?.reviewer).toMatch(/operator/i);
    // Must not fabricate a legal/attorney/third-party ToS review.
    expect(review?.reviewer.toLowerCase()).not.toContain('legal counsel');
    expect(review?.reviewer.toLowerCase()).not.toContain('attorney');
    expect(review?.notes.toLowerCase()).not.toContain('legal counsel');
    expect(review?.notes.toLowerCase()).not.toContain('attorney reviewed');
    // Must explicitly disclaim that this is not a per-site ToS review.
    expect(review?.notes.toLowerCase()).toContain('does not represent');
  });

  it('§8 -- test execution mode still bypasses the terms gate entirely (unaffected)', () => {
    expect(() => globalTermsGuard.checkAccess(DIRECT_PUBLIC_HTTP_MANIFEST, 'test')).not.toThrow();
  });

  // (3) non-transfer: review for direct-public-http must not leak to other capabilities.
  it('§10 -- direct-public-http review does not transfer to an unrelated unreviewed provider', () => {
    expect(() => globalTermsGuard.checkAccess(otherManifest(), 'live')).toThrow(PolicyBlockedError);
  });

  it('§10 -- direct-public-http review does not transfer to a wildcard/browser-style capability id', () => {
    const wildcardManifest = otherManifest({ provider_id: 'all-http' });
    expect(() => globalTermsGuard.checkAccess(wildcardManifest, 'live')).toThrow(PolicyBlockedError);
    const browserManifest = otherManifest({ provider_id: 'browser' });
    expect(() => globalTermsGuard.checkAccess(browserManifest, 'live')).toThrow(PolicyBlockedError);
  });

  it('§10 -- a rejected/blocked review for the same capability id would still block (regression guard)', () => {
    const guard = new TermsGuard([
      {
        providerId: 'direct-public-http',
        termsUri: DIRECT_PUBLIC_HTTP_MANIFEST.terms_uri,
        termsHash: null,
        reviewedAt: '2026-01-01T00:00:00Z',
        status: 'blocked',
        reviewer: 'operator',
        notes: 'revoked',
      },
    ]);
    expect(() => guard.checkAccess(DIRECT_PUBLIC_HTTP_MANIFEST, 'live')).toThrow(PolicyBlockedError);
  });

  it('§10 -- a review whose recorded terms hash no longer matches the manifest still blocks (malformed/stale review regression guard)', () => {
    const guard = new TermsGuard([
      {
        providerId: 'direct-public-http',
        termsUri: DIRECT_PUBLIC_HTTP_MANIFEST.terms_uri,
        termsHash: 'hash-at-review-time',
        reviewedAt: '2026-01-01T00:00:00Z',
        status: 'verified',
        reviewer: 'operator',
        notes: 'reviewed against an earlier terms hash',
      },
    ]);
    const driftedManifest: ProviderManifest = {
      ...DIRECT_PUBLIC_HTTP_MANIFEST,
      terms_hash: 'hash-after-drift',
    };
    expect(() => guard.checkAccess(driftedManifest, 'live')).toThrow(PolicyBlockedError);
  });

  it('§10 -- a malformed/pending review for the same capability id would still block (regression guard)', () => {
    const guard = new TermsGuard([
      {
        providerId: 'direct-public-http',
        termsUri: DIRECT_PUBLIC_HTTP_MANIFEST.terms_uri,
        termsHash: null,
        reviewedAt: null,
        status: 'pending_review',
        reviewer: 'operator',
        notes: '',
      },
    ]);
    expect(() => guard.checkAccess(DIRECT_PUBLIC_HTTP_MANIFEST, 'live')).toThrow(PolicyBlockedError);
  });

  // Manifest-level descriptive truthfulness (health()/getCapabilities() reporting).
  it('manifest terms_review_status is truthful (verified), not the stale pending_review default', () => {
    expect(DIRECT_PUBLIC_HTTP_MANIFEST.terms_review_status).toBe('verified');
    expect(DIRECT_PUBLIC_HTTP_MANIFEST.reviewed_at).not.toBeNull();
  });

  it('raw_access_resale_allowed remains unknown -- operator approval never addressed resale', () => {
    // The operator's recorded approval is scoped to bounded fetch-and-verify
    // use; it says nothing about raw content resale. Do not infer consent.
    expect(DIRECT_PUBLIC_HTTP_MANIFEST.raw_access_resale_allowed).toBe('unknown');
  });
});

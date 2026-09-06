import { describe, it, expect } from 'vitest';
import { TermsGuard, type TermsReview } from '../policy/terms-guard';
import { SEC_EDGAR_MANIFEST } from '../sec/submissions-adapter';
import { PolicyBlockedError } from '../errors';

/**
 * SUN-1222C2-Q1-R2 sections 31-33: local governance validation of the
 * FINAL PROPOSED sec-edgar TermsReview -- exercised only against a
 * throwaway LOCAL `TermsGuard` instance constructed inside this test
 * file, NEVER `globalTermsGuard`. Nothing here registers this review
 * anywhere real; `packages/provider-adapters/src/policy/terms-guard.ts`
 * is untouched by this checkpoint (confirmed by this checkpoint's own
 * diff). SEC_TERMS_REVIEW_REGISTERED remains NO after this file exists
 * and after every test in it passes.
 *
 * This is the FROZEN, PROPOSED object (matches the evidence report's own
 * copy verbatim) -- truthful only to what SUN-1222C2-Q1-R1/R2 actually
 * proved, no unproven claims:
 */
export const PROPOSED_SEC_EDGAR_TERMS_REVIEW: TermsReview = {
  providerId: 'sec-edgar',
  termsUri: 'https://www.sec.gov/os/accessing-edgar-data',
  termsHash: null, // SEC publishes no versioned/hashable single terms document (same as direct-public-http's own precedent -- RFC 9110 has no hash either).
  reviewedAt: null, // Frozen here as null deliberately -- the operator sets the real approval timestamp only if/when they actually register this (section 34's own authorization text).
  status: 'verified',
  reviewBasis: 'provider_terms_review',
  reviewer: 'PENDING_OPERATOR_APPROVAL',
  notes:
    'SEC EDGAR company_submissions API (data.sec.gov/submissions/CIK*.json), no ' +
    "authentication required, per SEC's own published Fair Access policy " +
    '(sec.gov/os/accessing-edgar-data, sec.gov/developer -- reviewed 2026-09-06, ' +
    'no material change from the same-day re-check). SITEBORNE now (SUN-1222C2-Q1-R1/R2): ' +
    'declares a compliant User-Agent (SITEBORNE hello@siteborne.com) on every real ' +
    'request; validates CIK format before constructing any request URL (no SSRF/path ' +
    'escape); evaluates HTTP status before treating any response as data -- 404/429/' +
    '401/403/408/5xx are never fabricated into a success; retries are bounded (max 3), ' +
    'honor a valid Retry-After, and are coordinated through the same aggregate limiter ' +
    'as every other attempt; enforces an aggregate, D1-backed, cross-isolate sliding-' +
    'window rate coordinator capped at 8 req/s (20% headroom below the published 10 ' +
    'req/s ceiling), fails closed (denies) if that coordinator is itself unavailable, ' +
    'proven under real SQLite concurrency up to 100 simultaneous callers. This review ' +
    "does not claim any enforcement mechanism beyond what these two checkpoints' own " +
    'tests actually proved.',
};

describe('SUN-1222C2-Q1-R2: sec-edgar TermsReview local validation (never globalTermsGuard)', () => {
  it('with no review recorded: FAIL_CLOSED', () => {
    const guard = new TermsGuard([]);
    expect(() => guard.checkAccess(SEC_EDGAR_MANIFEST, 'live')).toThrow(PolicyBlockedError);
  });

  it('with the exact proposed review recorded: governance validation PASSES', () => {
    const guard = new TermsGuard([PROPOSED_SEC_EDGAR_TERMS_REVIEW]);
    expect(() => guard.checkAccess(SEC_EDGAR_MANIFEST, 'live')).not.toThrow();
  });

  it('freshness/expiry: N/A for this architecture -- reviewedAt is informational only, never runtime-enforced (TermsGuard.checkAccess has no staleness check; confirmed by reading its full source, not assumed)', () => {
    const staleReview: TermsReview = {
      ...PROPOSED_SEC_EDGAR_TERMS_REVIEW,
      reviewedAt: '2020-01-01T00:00:00.000Z', // arbitrarily old
    };
    const guard = new TermsGuard([staleReview]);
    // Passes regardless of how old reviewedAt is -- this is the honest,
    // proven-by-reading-the-source behavior, not a gap this checkpoint
    // is introducing or hiding.
    expect(() => guard.checkAccess(SEC_EDGAR_MANIFEST, 'live')).not.toThrow();
  });

  it('wrong provider identity: a sec-edgar review does not satisfy a different provider_id', () => {
    const guard = new TermsGuard([PROPOSED_SEC_EDGAR_TERMS_REVIEW]);
    const otherManifest = { ...SEC_EDGAR_MANIFEST, provider_id: 'some-other-provider' };
    expect(() => guard.checkAccess(otherManifest, 'live')).toThrow(PolicyBlockedError);
  });

  it('wrong policy metadata: a termsHash mismatch between the review and the manifest fails closed', () => {
    const reviewWithHash: TermsReview = {
      ...PROPOSED_SEC_EDGAR_TERMS_REVIEW,
      termsHash: 'sha256:aaaa',
    };
    const manifestWithDifferentHash = { ...SEC_EDGAR_MANIFEST, terms_hash: 'sha256:bbbb' };
    const guard = new TermsGuard([reviewWithHash]);
    expect(() => guard.checkAccess(manifestWithDifferentHash, 'live')).toThrow(PolicyBlockedError);
  });

  it('a status of "pending_review" or "blocked" still fails closed even with this exact object otherwise unchanged', () => {
    const pending = new TermsGuard([
      { ...PROPOSED_SEC_EDGAR_TERMS_REVIEW, status: 'pending_review' },
    ]);
    const blocked = new TermsGuard([{ ...PROPOSED_SEC_EDGAR_TERMS_REVIEW, status: 'blocked' }]);
    expect(() => pending.checkAccess(SEC_EDGAR_MANIFEST, 'live')).toThrow(PolicyBlockedError);
    expect(() => blocked.checkAccess(SEC_EDGAR_MANIFEST, 'live')).toThrow(PolicyBlockedError);
  });

  it('SEC_TERMS_REVIEW_REGISTERED=NO: globalTermsGuard (the real, live-wired guard) still has no sec-edgar review after this entire file runs', async () => {
    const { globalTermsGuard } = await import('../policy/terms-guard');
    expect(globalTermsGuard.getReview('sec-edgar')).toBeUndefined();
  });
});

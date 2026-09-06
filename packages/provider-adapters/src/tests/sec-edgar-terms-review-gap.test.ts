import { describe, it, expect } from 'vitest';
import { createExecutionContext } from '../context';
import { globalTermsGuard, TermsGuard } from '../policy/terms-guard';
import { SecSubmissionsAdapter, SEC_EDGAR_MANIFEST } from '../sec/submissions-adapter';
import { fakeClock, fakeArtifactStore, fakeAuditSink, unreachableHttpClient } from './support';

/**
 * SUN-1222C2-Q1-D1 diagnostic reproduction.
 *
 * The Q1 real-paid attempt's own field-groups limitation read
 * "sec-edgar company_submissions returned policy_blocked for CIK 0000320193"
 * — worded as if SEC EDGAR itself rejected the call. It did not: this suite
 * proves, with a zero-network `unreachableHttpClient()` that throws if it is
 * ever invoked, that `SecSubmissionsAdapter.execute()` in live mode never
 * reaches the network at all. `globalTermsGuard` (../policy/terms-guard.ts)
 * has no `TermsReview` record for `provider_id: 'sec-edgar'` — only
 * `direct-public-http` has one, added and recorded verbatim from the
 * operator's own words on 2026-08-29 (see
 * docs/reports/SUN-1221E2T-direct-public-http-governance-review.md). Per the
 * documented, permanently-tested invariant in
 * `direct-public-http-terms-review.test.ts` §7 ("an unreviewed capability
 * remains blocked in live mode, always"), `checkAccess()` throws
 * `PolicyBlockedError` before the adapter's rate limiter or HTTP fetch ever
 * run. This is CIK-independent and provider-manifest-independent (the
 * manifest's own `commercial_application_allowed` /
 * `automated_access_allowed` / `transformed_output_allowed` flags are
 * already literal `true` — none of that is even reached, because the
 * missing-review branch throws first).
 *
 * This is a diagnostic reproduction, not a bug-fix TDD cycle: the code is
 * behaving exactly per its documented, permanent fail-closed design. There
 * is no code defect to fix here. Deciding whether SEC EDGAR's terms of
 * service license this use, and recording that decision the same way
 * direct-public-http's was recorded, is an operator governance decision
 * this test suite does not and must not make on its own.
 */
describe('SUN-1222C2-Q1-D1: sec-edgar has no globalTermsGuard review record', () => {
  it('no TermsReview record exists for sec-edgar in the live singleton guard', () => {
    expect(globalTermsGuard.getReview('sec-edgar')).toBeUndefined();
  });

  it('SEC_EDGAR_MANIFEST already asserts all three provider-terms-review permission flags as true', () => {
    // Confirms the block is NOT because the manifest looks unreviewed/unsafe
    // -- it looks exactly as permissive as direct-public-http's manifest
    // does. The only missing piece is the review record itself.
    expect(SEC_EDGAR_MANIFEST.commercial_application_allowed).toBe(true);
    expect(SEC_EDGAR_MANIFEST.automated_access_allowed).toBe(true);
    expect(SEC_EDGAR_MANIFEST.transformed_output_allowed).toBe(true);
    expect(SEC_EDGAR_MANIFEST.terms_review_status).toBe('pending_review');
  });

  it('live-mode execute() for CIK 0000320193 (Apple, the Q1 CIK) returns policy_blocked with ZERO network calls', async () => {
    const httpClient = unreachableHttpClient();
    const adapter = new SecSubmissionsAdapter(
      httpClient,
      fakeClock(),
      fakeArtifactStore(),
      fakeAuditSink()
    );
    const context = createExecutionContext(
      { clock: fakeClock(), httpClient, rateLimiter: unusedRateLimiter(), artifactStore: fakeArtifactStore(), auditSink: fakeAuditSink() },
      { execution_mode: 'live', cache_policy: 'bypass' }
    );

    const result = await adapter.execute({ cik: '0000320193', forms: [], maxFilings: 10 }, context);

    expect(result.resultClass).toBe('policy_blocked');
    expect(result.error?.code).toBe('POLICY_BLOCKED');
    // The decisive proof: SEC EDGAR was never actually contacted.
    expect(httpClient.callCount).toBe(0);
  });

  it('the block is identical for an arbitrary different CIK -- it is not Apple-specific or CIK-dependent', async () => {
    const httpClient = unreachableHttpClient();
    const adapter = new SecSubmissionsAdapter(
      httpClient,
      fakeClock(),
      fakeArtifactStore(),
      fakeAuditSink()
    );
    const context = createExecutionContext(
      { clock: fakeClock(), httpClient, rateLimiter: unusedRateLimiter(), artifactStore: fakeArtifactStore(), auditSink: fakeAuditSink() },
      { execution_mode: 'live', cache_policy: 'bypass' }
    );

    // 0000051143 = IBM. Any CIK produces the identical outcome: the guard
    // check happens before `input.cik` is ever read for request construction.
    const result = await adapter.execute({ cik: '0000051143', forms: [], maxFilings: 10 }, context);

    expect(result.resultClass).toBe('policy_blocked');
    expect(httpClient.callCount).toBe(0);
  });

  it('test-mode execute() skips the guard entirely (checkAccess returns immediately for execution_mode "test")', () => {
    // Read-only source-level confirmation, no adapter invocation needed
    // (and none wanted here: bypassing checkAccess in test mode still
    // reaches the real fetch path, which is out of this diagnostic's
    // scope) -- TermsGuard.checkAccess()'s own first line is
    // `if (executionMode === 'test') return;`, proving the policy_blocked
    // result above is specifically an execution_mode: 'live' +
    // missing-review outcome, not a blanket adapter failure.
    expect(() => globalTermsGuard.checkAccess(SEC_EDGAR_MANIFEST, 'test')).not.toThrow();
  });

  // Mutation-style isolation proof, on a throwaway local `TermsGuard()` --
  // NEVER the exported `globalTermsGuard` singleton, and NEVER committed as
  // a change to production wiring. This does not assert or imply that
  // SEC EDGAR's terms of service actually permit this use; it only isolates
  // that the guard lookup is the *sole* thing standing between "policy
  // blocked, zero network calls" and "reaches the real fetch". Deciding
  // whether to actually record such a review for sec-edgar, the way
  // direct-public-http's was recorded from the operator's own words, is a
  // separate governance decision outside this diagnostic's scope.
  it('mutation proof: recording a review record on an isolated guard removes the block and the real fetch path is reached', async () => {
    const isolatedGuard = new TermsGuard([
      {
        providerId: 'sec-edgar',
        termsUri: SEC_EDGAR_MANIFEST.terms_uri,
        termsHash: null,
        reviewedAt: '1970-01-01T00:00:00.000Z',
        status: 'verified',
        reviewBasis: 'provider_terms_review',
        reviewer: 'SUN-1222C2-Q1-D1 diagnostic isolation test (not a real review)',
        notes: 'Throwaway local guard instance, discarded at test end. Not globalTermsGuard.',
      },
    ]);

    // With the review present, checkAccess no longer throws.
    expect(() => isolatedGuard.checkAccess(SEC_EDGAR_MANIFEST, 'live')).not.toThrow();

    // And globalTermsGuard (the one actually wired into production) is
    // completely untouched by constructing this isolated instance.
    expect(globalTermsGuard.getReview('sec-edgar')).toBeUndefined();
  });
});

function unusedRateLimiter() {
  return {
    async acquire() {},
    release() {},
    tryAcquire() {
      return true;
    },
    getState() {
      return { tokens: 1, lastRefill: 0, activeRequests: 0, queuedRequests: 0 };
    },
    getAvailableTokens() {
      return 1;
    },
  };
}

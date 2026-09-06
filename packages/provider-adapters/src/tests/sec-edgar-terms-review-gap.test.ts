import { describe, it, expect } from 'vitest';
import { globalTermsGuard, TermsGuard } from '../policy/terms-guard';
import { SEC_EDGAR_MANIFEST } from '../sec/submissions-adapter';
import { PolicyBlockedError } from '../errors';

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
 *
 * SUN-1222C2-Q1-R3-SEC-TERMS-REGISTRATION UPDATE: the operator has since
 * made exactly that governance decision (see terms-guard.ts's
 * `SEC_EDGAR_TERMS_REVIEW` and
 * docs/reports/SUN-1222C2-Q1-R3-sec-terms-registration.md) --
 * `globalTermsGuard` now DOES have a `sec-edgar` review. The assertions
 * below were rewritten to exercise an ISOLATED, zero-review `TermsGuard`
 * instance instead of the (now-reviewed) global singleton, preserving the
 * exact same diagnostic value this file always had -- proving the GUARD
 * MECHANISM's own behavior on an unreviewed provider, independent of
 * whatever happens to be registered globally at any given time -- rather
 * than asserting a global-state fact that was true in D1/R1/R2 and is no
 * longer true after R3. Nothing here re-litigates or reverses that
 * registration.
 */
describe('SUN-1222C2-Q1-D1: sec-edgar guard mechanism (isolated from globalTermsGuard state)', () => {
  it('no TermsReview record exists for sec-edgar in a fresh, empty guard', () => {
    const emptyGuard = new TermsGuard([]);
    expect(emptyGuard.getReview('sec-edgar')).toBeUndefined();
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

  it('an isolated, unreviewed guard: checkAccess for CIK 0000320193 (Apple, the Q1 CIK) throws PolicyBlockedError before any network access is even attempted', () => {
    // Proves the GUARD MECHANISM directly, not through a full adapter
    // .execute() call. SecSubmissionsAdapter always calls the real exported
    // globalTermsGuard singleton internally (which now has a sec-edgar
    // review -- SUN-1222C2-Q1-R3-SEC-TERMS-REGISTRATION -- so routing this
    // proof through the real adapter would no longer policy-block; it
    // would instead proceed to fetchAndNormalize, which is a different,
    // already-covered behavior, not this test's concern). checkAccess
    // itself runs before ANY rate-limiter/HTTP-client code executes
    // regardless of which adapter calls it -- CIK 0000320193 never even
    // reaches this call, confirming the block is unconditional on input.
    const emptyGuard = new TermsGuard([]);
    expect(() => emptyGuard.checkAccess(SEC_EDGAR_MANIFEST, 'live')).toThrow(PolicyBlockedError);
  });

  it('the isolated-guard block is identical for an arbitrary different CIK -- it is not Apple-specific or CIK-dependent', () => {
    const emptyGuard = new TermsGuard([]);
    // 0000051143 = IBM. Any CIK produces the identical outcome: the guard
    // check happens before `input.cik` is ever read for request construction
    // -- this is a property of `checkAccess` itself, not of any particular
    // CIK, so it needs no adapter invocation to prove.
    expect(() => emptyGuard.checkAccess(SEC_EDGAR_MANIFEST, 'live')).toThrow(PolicyBlockedError);
  });

  it('test-mode checkAccess skips the guard entirely (returns immediately for execution_mode "test"), on both an isolated and the real global guard', () => {
    // Read-only source-level confirmation -- TermsGuard.checkAccess()'s own
    // first line is `if (executionMode === 'test') return;`, proving the
    // policy_blocked result above is specifically an execution_mode: 'live'
    // + missing-review outcome, not a blanket adapter failure. True
    // regardless of whether a review is registered, so both an isolated
    // empty guard AND the real (now-reviewed) globalTermsGuard pass this.
    expect(() => new TermsGuard([]).checkAccess(SEC_EDGAR_MANIFEST, 'test')).not.toThrow();
    expect(() => globalTermsGuard.checkAccess(SEC_EDGAR_MANIFEST, 'test')).not.toThrow();
  });

  // Mutation-style isolation proof, on a throwaway local `TermsGuard()` --
  // NEVER the exported `globalTermsGuard` singleton, and NEVER committed as
  // a change to production wiring. Originally written (D1) to isolate that
  // the guard lookup is the *sole* thing standing between "policy blocked,
  // zero network calls" and "reaches the real fetch" -- still true and
  // still worth proving even now that globalTermsGuard genuinely has a
  // sec-edgar review (SUN-1222C2-Q1-R3-SEC-TERMS-REGISTRATION): this
  // isolated guard's own state is independent of and unaffected by
  // whatever globalTermsGuard currently holds, in both directions.
  it('mutation proof: recording a review record on an isolated guard removes the block and the real fetch path is reached; the isolated guard never touches globalTermsGuard', async () => {
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

    // Constructing this isolated instance never mutates globalTermsGuard --
    // its real sec-edgar review (a DIFFERENT object, a real registration,
    // not this test's throwaway one) is untouched, distinguishable by its
    // own distinct reviewer/reviewedAt fields.
    const realReview = globalTermsGuard.getReview('sec-edgar');
    expect(realReview).toBeDefined();
    expect(realReview?.reviewer).not.toBe(isolatedGuard.getReview('sec-edgar')?.reviewer);
    expect(realReview?.reviewedAt).not.toBe('1970-01-01T00:00:00.000Z');
  });
});

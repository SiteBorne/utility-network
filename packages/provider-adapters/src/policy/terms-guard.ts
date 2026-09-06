import type { ProviderManifest } from '../types';
import { PolicyBlockedError } from '../errors';

export interface TermsReview {
  providerId: string;
  termsUri: string;
  termsHash: string | null;
  reviewedAt: string | null;
  status: 'verified' | 'pending_review' | 'blocked';
  reviewer: string;
  notes: string;
  /**
   * SUN-1221E2T1: explicit governance basis for this review. Required (not
   * optional) so no review can be ambiguous about which regime it relies on.
   *
   * - 'provider_terms_review': SITEBORNE is asserting permissions derived
   *   from this provider's own reviewable Terms of Service. All three
   *   ProviderManifest permission flags (commercial_application_allowed,
   *   automated_access_allowed, transformed_output_allowed) must be the
   *   literal boolean `true` -- `false` *and* `'unknown'` both fail closed.
   * - 'operator_risk_acceptance': there is no single reviewable ToS for this
   *   capability (e.g. direct-public-http, where every buyer-supplied URL
   *   carries its own, unreviewed terms). The SITEBORNE operator has
   *   explicitly accepted the bounded operational risk for this exact
   *   capability. The three manifest permission flags are not asserted and
   *   may legitimately remain 'unknown'.
   *
   * Anything other than the literal string 'operator_risk_acceptance'
   * (including a missing/malformed value on a review built outside the
   * type system) falls through to the strict 'provider_terms_review' path
   * -- fail-closed is the default, never the reverse.
   */
  reviewBasis: 'provider_terms_review' | 'operator_risk_acceptance';
}

/**
 * SUN-1221E2T1: `true` is the only value that counts as an explicit,
 * reviewed permission grant. `false` and the tri-state placeholder
 * `'unknown'` both fail closed -- a bare `if (!value)` check previously let
 * `'unknown'` (a non-empty, JS-truthy string) through by accident.
 */
export function isExplicitlyAllowed(value: boolean | 'unknown'): boolean {
  return value === true;
}

/**
 * SUN-1221E2T1: true only for a `verified`, capability-scoped
 * `operator_risk_acceptance` review recorded for exactly this provider id.
 * Structurally cannot transfer to another provider/capability: the review
 * was looked up by `providerId` in the first place, and this re-checks the
 * match explicitly so the scoping is provable in isolation, not just implied
 * by Map key lookup.
 */
export function isCapabilityRiskAccepted(
  review: TermsReview | undefined,
  providerId: string
): boolean {
  return (
    review !== undefined &&
    review.providerId === providerId &&
    review.status === 'verified' &&
    review.reviewBasis === 'operator_risk_acceptance'
  );
}

export class TermsGuard {
  private reviews = new Map<string, TermsReview>();

  constructor(initialReviews: TermsReview[] = []) {
    for (const review of initialReviews) {
      this.reviews.set(review.providerId, review);
    }
  }

  recordReview(review: TermsReview): void {
    this.reviews.set(review.providerId, review);
  }

  getReview(providerId: string): TermsReview | undefined {
    return this.reviews.get(providerId);
  }

  checkAccess(manifest: ProviderManifest, executionMode: 'test' | 'live'): void {
    if (executionMode === 'test') {
      return;
    }

    const review = this.reviews.get(manifest.provider_id);
    if (!review) {
      throw new PolicyBlockedError(
        `Provider ${manifest.provider_id} has no terms review record. Live use is blocked.`,
        { providerId: manifest.provider_id }
      );
    }

    if (review.status === 'blocked') {
      throw new PolicyBlockedError(
        `Provider ${manifest.provider_id} terms review is blocked. Live use is forbidden.`,
        { providerId: manifest.provider_id, reviewStatus: 'blocked' }
      );
    }

    if (review.status === 'pending_review') {
      throw new PolicyBlockedError(
        `Provider ${manifest.provider_id} terms review is pending. Live use is blocked until verified.`,
        { providerId: manifest.provider_id, reviewStatus: 'pending_review' }
      );
    }

    if (review.termsHash && manifest.terms_hash && review.termsHash !== manifest.terms_hash) {
      throw new PolicyBlockedError(
        `Provider ${manifest.provider_id} terms hash has changed since review. Re-review required.`,
        {
          providerId: manifest.provider_id,
          expectedHash: review.termsHash,
          actualHash: manifest.terms_hash,
        }
      );
    }

    // SUN-1221E2T1: an explicit, capability-scoped operator risk-acceptance
    // review does not assert the per-site provider permission flags -- they
    // are allowed to remain 'unknown'. Everything else (including a review
    // missing/malformed reviewBasis) falls through to the strict
    // provider-terms-review checks below, where 'unknown' fails closed.
    if (isCapabilityRiskAccepted(review, manifest.provider_id)) {
      return;
    }

    if (!isExplicitlyAllowed(manifest.commercial_application_allowed)) {
      throw new PolicyBlockedError(
        `Provider ${manifest.provider_id} does not allow commercial application.`,
        { providerId: manifest.provider_id, permission: 'commercial_application_allowed' }
      );
    }

    if (!isExplicitlyAllowed(manifest.automated_access_allowed)) {
      throw new PolicyBlockedError(
        `Provider ${manifest.provider_id} does not allow automated access.`,
        { providerId: manifest.provider_id, permission: 'automated_access_allowed' }
      );
    }

    if (!isExplicitlyAllowed(manifest.transformed_output_allowed)) {
      throw new PolicyBlockedError(
        `Provider ${manifest.provider_id} does not allow transformed output.`,
        { providerId: manifest.provider_id, permission: 'transformed_output_allowed' }
      );
    }
  }

  checkFixtureAccess(manifest: ProviderManifest): void {
    if (manifest.credentials_required) {
      throw new PolicyBlockedError(
        `Provider ${manifest.provider_id} requires credentials. Fixture-only access not permitted.`,
        { providerId: manifest.provider_id, permission: 'credentials_required' }
      );
    }
  }

  getAllowedProviders(mode: 'test' | 'live', manifests: ProviderManifest[]): ProviderManifest[] {
    if (mode === 'test') {
      return manifests.filter((m) => !m.credentials_required);
    }
    return manifests.filter((m) => {
      try {
        this.checkAccess(m, 'live');
        return true;
      } catch {
        return false;
      }
    });
  }
}

/**
 * SUN-1221E2T: operator-recorded review for the `direct-public-http`
 * capability (bounded fetching of buyer-supplied public HTTP/HTTPS URLs,
 * used by web_context_verified.v2).
 *
 * This is explicitly an operational risk-acceptance decision by the
 * SITEBORNE operator, not a review of any specific third-party website's
 * Terms of Service (there is no single reviewable ToS document for
 * arbitrary buyer-supplied URLs -- every target site has its own, unreviewed
 * terms). It does not authorize bypassing authentication, access controls,
 * technical restrictions, or other applicable legal/contractual
 * restrictions. Recorded verbatim from the operator's own words (chat,
 * 2026-08-29), scoped narrowly to this one capability only -- see
 * docs/reports/SUN-1221E2T-direct-public-http-governance-review.md.
 */
export const DIRECT_PUBLIC_HTTP_TERMS_REVIEW: TermsReview = {
  providerId: 'direct-public-http',
  termsUri: 'https://www.rfc-editor.org/rfc/rfc9110',
  termsHash: null,
  reviewedAt: '2026-08-29T00:00:00.000Z',
  status: 'verified',
  reviewBasis: 'operator_risk_acceptance',
  reviewer: 'operator (SITEBORNE, recorded via chat 2026-08-29)',
  notes:
    'Approved for bounded fetching of buyer-supplied public HTTP/HTTPS URLs under ' +
    "SITEBORNE's existing security controls, including private/internal-address " +
    'blocking, DNS-rebinding protection, redirect revalidation, timeout and ' +
    'response-size limits, credential-bearing URL prohibition, and sanitized ' +
    'logging. This approval is an operational risk-acceptance decision for the ' +
    'SITEBORNE capability. It does not represent that any specific third-party ' +
    "website's Terms of Service were reviewed or approved, and does not authorize " +
    'bypassing authentication, access controls, technical restrictions, or other ' +
    'applicable legal/contractual restrictions.',
};

/**
 * SUN-1222C2-Q1-R3-SEC-TERMS-REGISTRATION — the frozen, locally-validated
 * `sec-edgar` TermsReview from SUN-1222C2-Q1-R1/R2 (proven RED/GREEN/
 * mutation-tested at the code level: declared User-Agent, CIK request
 * validation, HTTP status semantics, aggregate D1-backed rate
 * coordination -- see those checkpoints' own evidence reports and
 * `sec-edgar-terms-review-local-validation.test.ts`'s frozen
 * `PROPOSED_SEC_EDGAR_TERMS_REVIEW` constant, which this object matches
 * byte-for-byte on every content field). `reviewedAt`/`reviewer` are the
 * two fields that constant's own doc comment says get set "only if/when
 * they actually register this" -- filled in now, in the same format
 * `DIRECT_PUBLIC_HTTP_TERMS_REVIEW` above already uses, per
 * SUN-1222C2-Q1-R3-SEC-TERMS-REGISTRATION's own standalone authorization.
 * This is a repo-only source change: registration here does not deploy,
 * does not mutate Cloudflare, does not touch credentials/secrets/
 * production traffic, and cannot itself trigger any request to SEC --
 * `SecSubmissionsAdapter.execute()` must still be separately invoked by a
 * real request for this record to ever matter at runtime.
 */
export const SEC_EDGAR_TERMS_REVIEW: TermsReview = {
  providerId: 'sec-edgar',
  termsUri: 'https://www.sec.gov/os/accessing-edgar-data',
  termsHash: null,
  reviewedAt: '2026-09-06T00:00:00.000Z',
  status: 'verified',
  reviewBasis: 'provider_terms_review',
  reviewer: 'operator (SITEBORNE, recorded via chat 2026-09-06)',
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

export const globalTermsGuard = new TermsGuard([
  DIRECT_PUBLIC_HTTP_TERMS_REVIEW,
  SEC_EDGAR_TERMS_REVIEW,
]);

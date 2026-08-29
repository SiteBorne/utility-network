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

    if (!manifest.commercial_application_allowed) {
      throw new PolicyBlockedError(
        `Provider ${manifest.provider_id} does not allow commercial application.`,
        { providerId: manifest.provider_id, permission: 'commercial_application_allowed' }
      );
    }

    if (!manifest.automated_access_allowed) {
      throw new PolicyBlockedError(
        `Provider ${manifest.provider_id} does not allow automated access.`,
        { providerId: manifest.provider_id, permission: 'automated_access_allowed' }
      );
    }

    if (!manifest.transformed_output_allowed) {
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

export const globalTermsGuard = new TermsGuard([DIRECT_PUBLIC_HTTP_TERMS_REVIEW]);

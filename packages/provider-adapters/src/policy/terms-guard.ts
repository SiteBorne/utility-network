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

export const globalTermsGuard = new TermsGuard();

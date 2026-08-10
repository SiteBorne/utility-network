/**
 * Local validator for a `SiteborneDiscoveryResource` (directive §17).
 * Prefers the official Bazaar runtime validators
 * (`validateDiscoveryExtension`, `validateDiscoveryExtensionSpec`) for the
 * extension shape itself, then layers SITEBORNE-specific checks (service
 * identity, scheme/network support, price semantics, production
 * truthfulness) on top. Returns a closed outcome; an unknown service ID
 * fails closed rather than validating against a guessed shape.
 */
import {
  validateDiscoveryExtension,
  validateDiscoveryExtensionSpec,
} from '@x402/extensions/bazaar';
import { isSchemeSupportedOnNetwork } from '../network/schemes';
import { isCanonicalAtomicAmount } from '../requirements/upto';
import type { SiteborneServiceId } from '../types';
import type { SiteborneDiscoveryResource } from './discovery';
import { BAZAAR_EXTENSION_KEY } from './discovery';
import { ALL_BAZAAR_SERVICE_IDS } from './registry-source';

export type DiscoveryValidationFailureReason =
  | 'unknown_service_id'
  | 'unsupported_x402_version'
  | 'missing_bazaar_extension'
  | 'bazaar_extension_invalid_shape'
  | 'bazaar_extension_spec_invalid'
  | 'unsupported_method'
  | 'missing_resource_url'
  | 'missing_accepts'
  | 'unsupported_scheme_network'
  | 'invalid_price_amount'
  | 'production_falsely_claimed_live'
  | 'production_falsely_enabled';

export interface DiscoveryValidationResult {
  valid: boolean;
  failures: DiscoveryValidationFailureReason[];
}

/**
 * Validates protocol-level and SITEBORNE-truthfulness invariants for one
 * discovery resource. Reports every failure found (directive §17's test
 * matrix exercises each independently), not just the first.
 */
export function validateSiteborneDiscoveryResource(
  serviceId: string,
  resource: SiteborneDiscoveryResource
): DiscoveryValidationResult {
  const failures: DiscoveryValidationFailureReason[] = [];

  if (!ALL_BAZAAR_SERVICE_IDS.includes(serviceId as SiteborneServiceId)) {
    // Unknown service fails closed immediately — nothing else about the
    // resource can be meaningfully checked against a service SITEBORNE
    // doesn't recognize.
    return { valid: false, failures: ['unknown_service_id'] };
  }

  if (resource.x402Version !== 2) {
    failures.push('unsupported_x402_version');
  }

  const bazaarExtension = resource.extensions?.[BAZAAR_EXTENSION_KEY] as
    | { info?: unknown; schema?: unknown }
    | undefined;
  if (!bazaarExtension || typeof bazaarExtension !== 'object') {
    failures.push('missing_bazaar_extension');
  } else {
    const shapeResult = validateDiscoveryExtension(
      bazaarExtension as Parameters<typeof validateDiscoveryExtension>[0]
    );
    if (!shapeResult.valid) failures.push('bazaar_extension_invalid_shape');
    const specResult = validateDiscoveryExtensionSpec(bazaarExtension as Record<string, unknown>);
    if (!specResult.valid) failures.push('bazaar_extension_spec_invalid');
  }

  if (resource.method !== 'POST' && resource.method !== 'GET') {
    // SITEBORNE's four services are all POST today; GET is kept
    // supportable for a future read-only discovery resource, but nothing
    // else is.
    failures.push('unsupported_method');
  }

  if (!resource.resourceUrl || !resource.resourceUrl.startsWith('https://')) {
    failures.push('missing_resource_url');
  }

  if (!Array.isArray(resource.accepts) || resource.accepts.length === 0) {
    failures.push('missing_accepts');
  } else {
    for (const requirement of resource.accepts) {
      const support = isSchemeSupportedOnNetwork(requirement.scheme, requirement.network);
      if (!support.supported) {
        failures.push('unsupported_scheme_network');
      }
      if (!isCanonicalAtomicAmount(requirement.amount)) {
        failures.push('invalid_price_amount');
      }
    }
  }

  if (resource.status !== 'not_live') {
    failures.push('production_falsely_claimed_live');
  }
  if (resource.production_enabled !== false) {
    failures.push('production_falsely_enabled');
  }

  return { valid: failures.length === 0, failures: dedupe(failures) };
}

function dedupe<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

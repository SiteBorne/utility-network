/**
 * Truthful, per-service capability status for Bazaar discovery (directive
 * §10). Mirrors `@siteborne/service-runtime`'s `RegisteredService
 * .implementationStatus` field (`packages/service-runtime/src/registry.ts`
 * — `'local_fixture_verified' | 'not_implemented'`) by *convention*, the
 * same cross-package relationship documented for `SiteborneServiceId`
 * itself in `../types.ts`: service-runtime and protocol-x402 are
 * independent packages, and a Bazaar declaration can describe a service
 * before service-runtime ever executes it.
 *
 * `local_fixture_verified` never becomes a production-capability claim
 * here — every `ServiceCapabilityStatus.production_capability` below is
 * hardcoded `'not_verified'`, matching `production_enabled: false`
 * globally throughout SITEBORNE.
 */
import type { SiteborneServiceId } from '../types';

export interface ServiceCapabilityStatus {
  /** Mirrors service-runtime's `implementationStatus` — the only two
   * values that type has ever declared. */
  implementation_status: 'local_fixture_verified' | 'not_implemented';
  /** Always `'not_verified'` in SUN-0700A — no live facilitator or
   * production route exists to verify against. */
  production_capability: 'not_verified';
  /** Which of a service's advertised execution modes are actually
   * discoverable right now, and why the others are excluded (directive
   * §10: browser-rendered/Modal/independent-reproduction limitations must
   * never be silently upgraded to production claims). */
  advertised_mode: string;
  excluded_modes: readonly { mode: string; reason: string }[];
}

export const SERVICE_CAPABILITY_STATUS: Readonly<
  Record<SiteborneServiceId, ServiceCapabilityStatus>
> = {
  'company_evidence_graph.v1': {
    implementation_status: 'local_fixture_verified',
    production_capability: 'not_verified',
    advertised_mode: 'standard',
    excluded_modes: [],
  },
  'web_context_verified.v1': {
    implementation_status: 'local_fixture_verified',
    production_capability: 'not_verified',
    advertised_mode: 'direct',
    excluded_modes: [
      {
        mode: 'rendered',
        reason:
          'browser-rendered retrieval exists locally but is not advertised as a production-live discovery mode (directive §10)',
      },
    ],
  },
  'document_evidence_json.v1': {
    implementation_status: 'local_fixture_verified',
    production_capability: 'not_verified',
    advertised_mode: 'local_document_worker',
    excluded_modes: [
      {
        mode: 'modal_live',
        reason: 'live Modal deployment remains blocked_external (SUN-0400B)',
      },
    ],
  },
  'verify_agent_output.v1': {
    implementation_status: 'local_fixture_verified',
    production_capability: 'not_verified',
    advertised_mode: 'standard',
    excluded_modes: [
      {
        mode: 'independent_reproduction',
        reason:
          'independent_reproduction is a local fixture mode only — live external reproduction is not verified (directive §10)',
      },
    ],
  },
};

/**
 * Maps a CanonicalServiceId to the governance/RISK_LIMITS.yaml pricing tier
 * key that governs its `listPrice` (registry `base_price`).
 *
 * This is not a slug transform. Direct inspection of every registry file's
 * `base_price` against every `max_price_usd_per_service` key
 * (governance/RISK_LIMITS.yaml:11-26) shows the governance file uses
 * family-specific, irregular tier names -- document_evidence_json has
 * three priced sub-operations (native/ocr/table) plus one shared,
 * unversioned ceiling key (`_max_job`); company_evidence_graph,
 * web_context_verified and verify_agent_output each have exactly one
 * "primary" tier key per generation. `base_price` in every one of the 8
 * registry files matches exactly the family's *primary* tier key's value
 * -- except company_evidence_graph.v2, where it does not (see
 * docs/reports/METADATA-VCM-IMPL-01-truth-core-and-registry-parity.md §V
 * for the confirmed violation this reveals).
 *
 * We reuse `@siteborne/pricing`'s own `PricingKey` type rather than
 * re-declaring the key vocabulary -- that package is already the single
 * runtime-safe authority over governance/RISK_LIMITS.yaml
 * (packages/pricing/src/service-prices.ts's own doc comment).
 */
import type { PricingKey } from '@siteborne/pricing';
import type { ServiceFamily } from '../service-id';
import type { ServiceGeneration } from '../versions';

const PRIMARY_TIER_KEY: Readonly<
  Record<ServiceFamily, Readonly<Record<ServiceGeneration, PricingKey>>>
> = {
  company_evidence_graph: {
    v1: 'company_evidence_graph',
    v2: 'company_evidence_graph_v2',
    v3: 'company_evidence_graph_v2',
  },
  web_context_verified: {
    v1: 'web_context_verified_direct',
    v2: 'web_context_verified_direct_v2',
    v3: 'web_context_verified_direct_v2',
  },
  document_evidence_json: {
    v1: 'document_evidence_json_native',
    v2: 'document_evidence_json_native_v2',
    v3: 'document_evidence_json_native_v2',
  },
  verify_agent_output: {
    v1: 'verify_agent_output_standard',
    v2: 'verify_agent_output_standard_v2',
    v3: 'verify_agent_output_standard_v2',
  },
};

/** The governance key governing `listPrice`/`governedMaxPrice` for a
 * service generation. */
export function primaryPricingKey(
  family: ServiceFamily,
  generation: ServiceGeneration
): PricingKey {
  return PRIMARY_TIER_KEY[family][generation];
}

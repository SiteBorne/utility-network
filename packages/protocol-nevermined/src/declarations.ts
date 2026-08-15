import {
  resolvePricingSourceVersion,
  resolveServiceMaxPriceUsd,
  usdToAtomicUnits,
} from '@siteborne/pricing';
import {
  ALL_BAZAAR_SERVICE_IDS,
  REGISTRY_SERVICES,
  type SiteborneServiceId,
} from '@siteborne/protocol-x402';
import { NEVERMINED_ROUTES } from './routes';

export interface NeverminedAgentDeclaration {
  local_agent_id: string;
  service_id: SiteborneServiceId;
  service_version: 'v1';
  title: string;
  description: string;
  endpoint: string;
  input_schema_uri: string;
  input_schema_hash: string;
  output_schema_uri: string;
  output_schema_hash: string;
  pcc_version: string;
  protocol_references: { mcp: '/mcp'; a2a: '/a2a' };
  declared_limitations: readonly string[];
  production_enabled: false;
}

export interface NeverminedPlanDeclaration {
  local_plan_id: string;
  plan_classification: 'payg';
  trial_kind: 'none';
  siteborne_payment_semantics: 'exact' | 'upto';
  nevermined_scheme: 'nvm:erc4337';
  asset: 'USDC';
  asset_decimals: 6;
  gross_buyer_amount_atomic: string;
  provider_net_proceeds: 'resolved_by_nevermined_registration';
  pricing_source_version: string;
  dynamic_actual_settlement_required: boolean;
  sandbox_capability_verified: false;
  registration_allowed: boolean;
  actual_tiers_atomic?: { native: string; ocr: string; table: string };
}

export interface NeverminedServiceDeclaration {
  agent: NeverminedAgentDeclaration;
  plan: NeverminedPlanDeclaration;
}

const FIXED_PRICING_KEYS = {
  'company_evidence_graph.v1': 'company_evidence_graph',
  'web_context_verified.v1': 'web_context_verified_direct',
  'verify_agent_output.v1': 'verify_agent_output_standard',
} as const;

function atomic(key: Parameters<typeof resolveServiceMaxPriceUsd>[0]): string {
  return usdToAtomicUnits(resolveServiceMaxPriceUsd(key), 6);
}

function buildDeclaration(serviceId: SiteborneServiceId): NeverminedServiceDeclaration {
  const service = REGISTRY_SERVICES[serviceId];
  const document = serviceId === 'document_evidence_json.v1';
  const fixedKey = document
    ? undefined
    : FIXED_PRICING_KEYS[serviceId as keyof typeof FIXED_PRICING_KEYS];
  const amount = document ? atomic('document_evidence_json_max_job') : atomic(fixedKey!);
  return {
    agent: {
      local_agent_id: `siteborne:${serviceId}:agent`,
      service_id: serviceId,
      service_version: 'v1',
      title: service.title,
      description: service.description,
      endpoint: NEVERMINED_ROUTES[serviceId],
      input_schema_uri: service.input_schema_uri,
      input_schema_hash: service.input_schema_hash,
      output_schema_uri: service.output_schema_uri,
      output_schema_hash: service.output_schema_hash,
      pcc_version: service.pcc_version,
      protocol_references: { mcp: '/mcp', a2a: '/a2a' },
      declared_limitations: [...service.declared_limitations],
      production_enabled: false,
    },
    plan: {
      local_plan_id: `siteborne:${serviceId}:payg`,
      plan_classification: 'payg',
      trial_kind: 'none',
      siteborne_payment_semantics: document ? 'upto' : 'exact',
      nevermined_scheme: 'nvm:erc4337',
      asset: 'USDC',
      asset_decimals: 6,
      gross_buyer_amount_atomic: amount,
      provider_net_proceeds: 'resolved_by_nevermined_registration',
      pricing_source_version: resolvePricingSourceVersion(),
      dynamic_actual_settlement_required: document,
      // `sandbox_capability_verified` tracks the DYNAMIC SETTLEMENT itself
      // (a real settle(actual) call with actual < authorized_maximum) —
      // still unproven for every service; stays false until that live
      // proof exists.
      //
      // `registration_allowed` for the document plan stays FALSE, now
      // DEFINITIVELY (SUN-0900B checkpoint 2B differential probe, not
      // merely unproven). A controlled sandbox experiment reused the
      // already-registered web_context_verified.v1 plan (9000 atomic
      // USDC price) and its exact getPayAsYouGoPriceConfig +
      // getPayAsYouGoCreditsConfig() helper pair — verified maxAmount
      // 9000 (the plan's own ceiling), then deliberately settled
      // maxAmount 1000 (strictly less than the price) exactly once. The
      // real on-chain Base Sepolia result
      // (0x59a8bd0b7567e7cf3cc2489c539e41083ba424bd87d1b2920d539eebcd96
      // 69d7) transferred 9000 atomic USDC gross (split 8910/90, byte-
      // identical to the plan's fixed price), NOT the requested 1000 —
      // proving `settlePermissions({maxAmount})` does NOT control the
      // actual on-chain charge for this credits-config shape; the
      // plan's REGISTERED PRICE dominates regardless of the settle-time
      // maxAmount requested. Classification: PAYG_SETTLES_PLAN_PRICE.
      // This is a hard incompatibility, not a gap: registering a
      // document plan at a 190000 price using this same helper pair
      // would always charge 190000 on settlement, never 12000/19000/
      // 29000, regardless of measured actual usage — exactly the
      // economic misrepresentation this checkpoint exists to prevent.
      // A real dynamic plan would need the SDK's separate
      // `getDynamicCreditsConfig(creditsGranted, min, max)` helper
      // (+ `registerCreditsPlan`/`registerPlan`), entirely untested by
      // SITEBORNE so far. See
      // docs/reports/SUN-0900B-checkpoint-2b-unit-economics-report.md.
      sandbox_capability_verified: false,
      registration_allowed: !document,
      ...(document
        ? {
            actual_tiers_atomic: {
              native: atomic('document_evidence_json_native'),
              ocr: atomic('document_evidence_json_ocr'),
              table: atomic('document_evidence_json_table'),
            },
          }
        : {}),
    },
  };
}

export const NEVERMINED_DECLARATIONS: Readonly<
  Record<SiteborneServiceId, NeverminedServiceDeclaration>
> = Object.fromEntries(
  ALL_BAZAAR_SERVICE_IDS.map((id) => [id, buildDeclaration(id)])
) as unknown as Readonly<Record<SiteborneServiceId, NeverminedServiceDeclaration>>;

export function validateNeverminedDeclaration(
  declaration: unknown
): { valid: true } | { valid: false; reason: string } {
  if (!declaration || typeof declaration !== 'object' || !('plan' in declaration)) {
    return { valid: false, reason: 'invalid_declaration' };
  }
  const plan = (declaration as { plan: unknown }).plan;
  if (!plan || typeof plan !== 'object') return { valid: false, reason: 'invalid_plan' };
  const fields = plan as Record<string, unknown>;
  if (fields.plan_classification !== 'payg') return { valid: false, reason: 'plan_must_be_payg' };
  if (fields.trial_kind !== 'none') return { valid: false, reason: 'trials_are_disabled' };
  if (
    typeof fields.gross_buyer_amount_atomic !== 'string' ||
    !/^\d+$/.test(fields.gross_buyer_amount_atomic) ||
    BigInt(fields.gross_buyer_amount_atomic) <= 0n
  ) {
    return { valid: false, reason: 'price_must_be_positive' };
  }
  // Historical rule (pre SUN-0900B checkpoint 2B): an `upto`-semantics
  // plan could never be `registration_allowed`, because the unit
  // economics between a settle-time atomic amount and the actual
  // on-chain charge were unproven. That gate is now evidence-based
  // rather than blanket: `registration_allowed` may be true for an
  // `upto` plan only once `dynamic_actual_settlement_required` is also
  // true (i.e., only the deliberately-modeled dynamic case, never a
  // plan that skipped the explicit dynamic-economics accounting this
  // shape requires).
  if (
    fields.siteborne_payment_semantics === 'upto' &&
    fields.registration_allowed &&
    !fields.dynamic_actual_settlement_required
  ) {
    return { valid: false, reason: 'dynamic_document_registration_is_capability_gated' };
  }
  return { valid: true };
}

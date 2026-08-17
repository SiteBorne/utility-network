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
  service_version: 'v1' | 'v2';
  title: string;
  /** SUN-1000 checkpoint 1O-B: the real, on-provider Nevermined agent
   * display name — see `deriveNeverminedAgentDisplayName` below. `title`
   * above stays the plain, major-agnostic registry title used everywhere
   * else (Bazaar/MCP/A2A metadata); this field exists specifically
   * because Nevermined agent names must be unique across majors sharing
   * one account, which `title` alone is not. */
  nevermined_display_name: string;
  /** SUN-1000 checkpoint 1O-B2: the real, provider-issued agent ID from
   * the checkpoint 1O-B registration (public, non-secret) — set only for
   * the 4 v2 services that have actually been registered on the real
   * Nevermined sandbox backend; `undefined` for v1 (and any future
   * unregistered major), which keeps using `local_agent_id` exactly as
   * before. Never fabricated -- copied verbatim from the accepted
   * checkpoint 1O-B/1O-B1 registration evidence
   * (`docs/operations/NEVERMINED_PROTOCOL.md`). */
  registered_agent_id?: string;
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
  /** SUN-1000 checkpoint 1O-B2: the real, provider-issued plan ID —
   * same rules as `registered_agent_id` above. */
  registered_plan_id?: string;
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
  sandbox_capability_verified: boolean;
  dynamic_live_allowed: boolean;
  registration_allowed: boolean;
  actual_tiers_atomic?: { native: string; ocr: string; table: string };
}

export interface NeverminedServiceDeclaration {
  agent: NeverminedAgentDeclaration;
  plan: NeverminedPlanDeclaration;
}

// SUN-1000 checkpoint 1M: keyed by base service name (major suffix
// stripped) rather than the full .v1-literal string, so v2 declarations
// (SAME_ECONOMICS_NEW_SERVICE_MAJOR, checkpoint 1L section 9) reuse the
// identical pricing keys without a second hardcoded table.
const FIXED_PRICING_KEYS = {
  company_evidence_graph: 'company_evidence_graph',
  web_context_verified: 'web_context_verified_direct',
  verify_agent_output: 'verify_agent_output_standard',
} as const;

function atomic(key: Parameters<typeof resolveServiceMaxPriceUsd>[0]): string {
  return usdToAtomicUnits(resolveServiceMaxPriceUsd(key), 6);
}

/**
 * SUN-1000 checkpoint 1O-B: the single, shared Nevermined agent-display-
 * name derivation. Discovered via a real reconciliation attempt against
 * `company_evidence_graph.v2`: v1 and v2 declarations previously shared
 * the exact same `title` ("Company Evidence Graph"), so the registration
 * harness's name-based lookup always matched the *existing* v1 agent,
 * correctly refused by the endpoint-aware validator
 * (`WRONG_SERVICE_ENDPOINT`) rather than silently registering — but this
 * meant v2 could never reach a clean `NO_MATCH` state through that same
 * name-based lookup while v1 exists under an identical name.
 *
 * v1 names are preserved byte-for-byte (already registered on the real
 * Nevermined sandbox backend; changing the expected string would break
 * v1's own future reconciliation, not just v2's). Every other major
 * (v2 and beyond) disambiguates by appending the canonical service-major
 * identity itself — never a mutable price, agent/plan ID, environment
 * name, or endpoint, none of which are stable/appropriate name material.
 */
export function deriveNeverminedAgentDisplayName(
  serviceId: SiteborneServiceId,
  title: string
): string {
  return serviceId.endsWith('.v1') ? title : `${title} — ${serviceId}`;
}

/** Companion plan-name derivation, deterministic from the same agent
 * display name. v1's already-registered plan-name formula
 * (`"<title> — PAYG plan"`) is preserved unchanged; v2+ uses a plain,
 * generic `"<agent display name> — Plan"` — no economics/IDs/environment
 * embedded, matching `deriveNeverminedAgentDisplayName`'s own rule. */
export function deriveNeverminedPlanDisplayName(
  serviceId: SiteborneServiceId,
  agentDisplayName: string
): string {
  return serviceId.endsWith('.v1')
    ? `${agentDisplayName} — PAYG plan`
    : `${agentDisplayName} — Plan`;
}

/** SUN-1000 checkpoint 1O-B2: the four real, provider-issued agent/plan
 * IDs from the checkpoint 1O-B registration, copied verbatim from the
 * accepted evidence in `docs/operations/NEVERMINED_PROTOCOL.md` (public,
 * non-secret provider identifiers -- never a credential). Deliberately a
 * closed, hand-verified table rather than derived, so any future edit to
 * this repository's own generation logic can never silently change a
 * value that must match real external state exactly. v1 is deliberately
 * absent -- its declarations keep using `local_agent_id`/`local_plan_id`
 * exactly as before this checkpoint. */
const V2_REGISTERED_IDS: Partial<Record<SiteborneServiceId, { agentId: string; planId: string }>> =
  {
    'company_evidence_graph.v2': {
      agentId: '8945215415179810337511916177281451484220450532075244586308753062965582716389',
      planId: '10268032069987826322514735824876788768903142706079143267509577311063526800318',
    },
    'web_context_verified.v2': {
      agentId: '9613264351721376847099143451964490409753221634691266039731516778743818115758',
      planId: '24941537770422129588835488161631149735480385285064676886916949896840067329220',
    },
    'document_evidence_json.v2': {
      agentId: '23983377566340233303092237571868603328491815288742632945599286374009053451142',
      planId: '47055935846533104006091411392563929683665104827998139102920975407519466945495',
    },
    'verify_agent_output.v2': {
      agentId: '27131786432933344978515576530029108070322716902860955144259896627611005129186',
      planId: '91900896406434535132462316750130087602675645111856542980525216829631168048994',
    },
  };

function buildDeclaration(serviceId: SiteborneServiceId): NeverminedServiceDeclaration {
  const service = REGISTRY_SERVICES[serviceId];
  const base = serviceId.replace(/\.v\d+$/, '');
  const document = base === 'document_evidence_json';
  const fixedKey = document
    ? undefined
    : FIXED_PRICING_KEYS[base as keyof typeof FIXED_PRICING_KEYS];
  const amount = document ? atomic('document_evidence_json_max_job') : atomic(fixedKey!);
  const serviceVersion = serviceId.endsWith('.v2') ? 'v2' : 'v1';
  const registered = V2_REGISTERED_IDS[serviceId];
  return {
    agent: {
      // Deliberately a local, unregistered identifier only (SUN-1000
      // checkpoint 1M section 22: "do not fabricate actual agent/plan
      // IDs" — this describes what a future registration would declare,
      // it is not itself a live Nevermined-issued ID; no v1 agent/plan ID
      // is reused for v2, and no real registration is performed by
      // constructing this object). registered_agent_id below is the real
      // ID once a service has actually been registered (checkpoint 1O-B).
      local_agent_id: `siteborne:${serviceId}:agent`,
      registered_agent_id: registered?.agentId,
      service_id: serviceId,
      service_version: serviceVersion,
      title: service.title,
      nevermined_display_name: deriveNeverminedAgentDisplayName(serviceId, service.title),
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
      registered_plan_id: registered?.planId,
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
      // The document values below are scoped to the frozen controlled-sandbox
      // lifecycles proven in SUN-0900B checkpoints 2H and 2I. Checkpoint 2I
      // proved positive-but-insufficient behavior is FULL_BUNDLE_TOPUP:
      // 178000 + 190000 acquired - 190000 redeemed = 178000 remaining. This
      // capability evidence does not enable production. Fixed services do not
      // use this dynamic gate.
      //
      // Checkpoint 2F permits one exact document registration only after
      // authoritative GET read-back passes the credential-independent
      // dynamic-plan validator. The accepted shape is a prepaid pool:
      // 190000 atomic USDC acquires 190000 credits, with 12000..190000
      // variable redemption. This is deliberately not the disproven
      // PAYG 1/1/1 configuration. Registration permission is not a live
      // capability claim by itself. Checkpoint 2H proved the zero-credit native
      // lifecycle and replay; checkpoint 2I proved the full-bundle partial-
      // balance top-up policy and the same exactly-once recovery properties.
      sandbox_capability_verified: document,
      dynamic_live_allowed: document,
      registration_allowed: true,
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
  if (
    fields.dynamic_live_allowed === true &&
    (fields.sandbox_capability_verified !== true ||
      fields.dynamic_actual_settlement_required !== true)
  ) {
    return { valid: false, reason: 'dynamic_live_requires_verified_dynamic_capability' };
  }
  return { valid: true };
}

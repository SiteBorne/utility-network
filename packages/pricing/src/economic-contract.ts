/**
 * The canonical SITEBORNE economic contract (PRODUCTION-ECONOMICS-DISCOVERY-01).
 *
 * ONE governed definition -> deterministic projections. This module owns no
 * price of its own: every amount is resolved through this package's existing
 * governed resolver (`resolveServiceMaxPriceUsd`, i.e.
 * governance/RISK_LIMITS.yaml), every limit through `resolveMaxDocumentPages`.
 * What it adds is the *structure* the scalar price API cannot express:
 * exact vs upto, per-page tier schedules, authorization ceilings, measured
 * settlement semantics, and -- separately -- whether a capability MODE is
 * actually purchasable (`PRICE_DEFINED` is not `CAPABILITY_AVAILABLE`).
 *
 * Three kinds of truth stay separate (SITEBORNE thin-waist rule):
 *   - NORMATIVE   : the definition table + governed amounts (this file).
 *   - OPERATIONAL : `production_enabled` and the payment destination
 *                   (network/asset/payTo) -- injected by the caller from real
 *                   runtime configuration, never authored here.
 *   - OBSERVED    : runtime evidence -- not represented here at all.
 *
 * Every protocol surface (A2A, MCP, OpenAPI, x402, catalog, Bazaar) must embed
 * the output of `projectEconomicOffer` verbatim; none may author an economic
 * fact of its own.
 */
import { usdToMicro } from './index';
import {
  resolveMaxDocumentPages,
  resolvePricingSourceVersion,
  resolveServiceMaxPriceUsd,
  type PricingKey,
} from './service-prices';

/** Identical to `SiteborneServiceId` in `@siteborne/protocol-x402`; duplicated
 * structurally because that package depends on this one. Equality is enforced
 * by a cross-package parity test. */
export const ECONOMIC_SERVICE_IDS = [
  'company_evidence_graph.v1',
  'web_context_verified.v1',
  'document_evidence_json.v1',
  'verify_agent_output.v1',
  'company_evidence_graph.v2',
  'web_context_verified.v2',
  'document_evidence_json.v2',
  'verify_agent_output.v2',
] as const;
export type EconomicServiceId = (typeof ECONOMIC_SERVICE_IDS)[number];

export type EconomicFamily =
  | 'company_evidence_graph'
  | 'web_context_verified'
  | 'document_evidence_json'
  | 'verify_agent_output';

export type EconomicScheme = 'exact' | 'upto';
export type EconomicAmountKind = 'exact' | 'authorized_maximum';
export type EconomicPricingModel = 'fixed_per_request' | 'metered_per_page_tiered';
export type EconomicPriceUnit = 'request' | 'page';
export type EconomicActualSettlementModel =
  | 'equals_exact_amount'
  | 'measured_usage_not_exceeding_authorization';
export type EconomicContractRole = 'current' | 'compatibility';

/** Governed product posture -- NOT a runtime flag. `production_enabled` (the
 * operational fact) is independent and injected at projection time. */
export type EconomicReleasePosture =
  | 'first_release_candidate'
  | 'defined_not_production_admitted'
  | 'compatibility_not_admitted';

export type DocumentPageTier = 'native' | 'ocr' | 'table';

export interface EconomicModeDefinition {
  readonly mode: string;
  readonly pricingKey: PricingKey;
  readonly amountKind: EconomicAmountKind;
  readonly unit: 'request' | 'job';
  /** CAPABILITY_AVAILABLE -- independent of the (always defined) price. */
  readonly available: boolean;
  readonly unavailableReason?: string;
}

interface EconomicServiceDefinition {
  readonly family: EconomicFamily;
  readonly generation: 'v1' | 'v2';
  readonly scheme: EconomicScheme;
  readonly pricingModel: EconomicPricingModel;
  readonly releasePosture: EconomicReleasePosture;
  readonly defaultMode: string;
  /** The request-body field that selects a mode, when the frozen input
   * contract has one. */
  readonly modeSelectorField: string | null;
  readonly modes: readonly EconomicModeDefinition[];
  readonly tierKeys: Readonly<Record<DocumentPageTier, PricingKey>> | null;
}

const RENDERED_UNAVAILABLE =
  'Browser-rendered retrieval is not implemented for production execution; its governed price is defined for future use but the mode is not purchasable.';
const REPRODUCTION_UNAVAILABLE =
  'Independent reproduction is not implemented for production execution; its governed price is defined for future use but the mode is not purchasable. Standard verification of the supplied material is available.';

const DOCUMENT_MODE: EconomicModeDefinition = {
  mode: 'extraction',
  pricingKey: 'document_evidence_json_max_job',
  amountKind: 'authorized_maximum',
  unit: 'job',
  available: true,
};

const DEFINITIONS: Readonly<Record<EconomicServiceId, EconomicServiceDefinition>> = {
  'company_evidence_graph.v1': {
    family: 'company_evidence_graph',
    generation: 'v1',
    scheme: 'exact',
    pricingModel: 'fixed_per_request',
    releasePosture: 'compatibility_not_admitted',
    defaultMode: 'standard',
    modeSelectorField: null,
    modes: [
      {
        mode: 'standard',
        pricingKey: 'company_evidence_graph',
        amountKind: 'exact',
        unit: 'request',
        available: true,
      },
    ],
    tierKeys: null,
  },
  'company_evidence_graph.v2': {
    family: 'company_evidence_graph',
    generation: 'v2',
    scheme: 'exact',
    pricingModel: 'fixed_per_request',
    releasePosture: 'defined_not_production_admitted',
    defaultMode: 'standard',
    modeSelectorField: null,
    modes: [
      {
        mode: 'standard',
        pricingKey: 'company_evidence_graph_v2',
        amountKind: 'exact',
        unit: 'request',
        available: true,
      },
    ],
    tierKeys: null,
  },
  'web_context_verified.v1': {
    family: 'web_context_verified',
    generation: 'v1',
    scheme: 'exact',
    pricingModel: 'fixed_per_request',
    releasePosture: 'compatibility_not_admitted',
    defaultMode: 'direct',
    modeSelectorField: 'retrieval_mode',
    modes: [
      {
        mode: 'direct',
        pricingKey: 'web_context_verified_direct',
        amountKind: 'exact',
        unit: 'request',
        available: true,
      },
      {
        mode: 'rendered',
        pricingKey: 'web_context_verified_rendered',
        amountKind: 'exact',
        unit: 'request',
        available: false,
        unavailableReason: RENDERED_UNAVAILABLE,
      },
    ],
    tierKeys: null,
  },
  'web_context_verified.v2': {
    family: 'web_context_verified',
    generation: 'v2',
    scheme: 'exact',
    pricingModel: 'fixed_per_request',
    releasePosture: 'first_release_candidate',
    defaultMode: 'direct',
    modeSelectorField: 'retrieval_mode',
    modes: [
      {
        mode: 'direct',
        pricingKey: 'web_context_verified_direct_v2',
        amountKind: 'exact',
        unit: 'request',
        available: true,
      },
      {
        mode: 'rendered',
        pricingKey: 'web_context_verified_rendered',
        amountKind: 'exact',
        unit: 'request',
        available: false,
        unavailableReason: RENDERED_UNAVAILABLE,
      },
    ],
    tierKeys: null,
  },
  'document_evidence_json.v1': {
    family: 'document_evidence_json',
    generation: 'v1',
    scheme: 'upto',
    pricingModel: 'metered_per_page_tiered',
    releasePosture: 'compatibility_not_admitted',
    defaultMode: 'extraction',
    modeSelectorField: null,
    modes: [DOCUMENT_MODE],
    tierKeys: {
      native: 'document_evidence_json_native',
      ocr: 'document_evidence_json_ocr',
      table: 'document_evidence_json_table',
    },
  },
  'document_evidence_json.v2': {
    family: 'document_evidence_json',
    generation: 'v2',
    scheme: 'upto',
    pricingModel: 'metered_per_page_tiered',
    releasePosture: 'defined_not_production_admitted',
    defaultMode: 'extraction',
    modeSelectorField: null,
    modes: [DOCUMENT_MODE],
    tierKeys: {
      native: 'document_evidence_json_native_v2',
      ocr: 'document_evidence_json_ocr_v2',
      table: 'document_evidence_json_table_v2',
    },
  },
  'verify_agent_output.v1': {
    family: 'verify_agent_output',
    generation: 'v1',
    scheme: 'exact',
    pricingModel: 'fixed_per_request',
    releasePosture: 'compatibility_not_admitted',
    defaultMode: 'standard',
    modeSelectorField: 'verification_mode',
    modes: [
      {
        mode: 'standard',
        pricingKey: 'verify_agent_output_standard',
        amountKind: 'exact',
        unit: 'request',
        available: true,
      },
      {
        mode: 'independent_reproduction',
        pricingKey: 'verify_agent_output_reproduction',
        amountKind: 'exact',
        unit: 'request',
        available: false,
        unavailableReason: REPRODUCTION_UNAVAILABLE,
      },
    ],
    tierKeys: null,
  },
  'verify_agent_output.v2': {
    family: 'verify_agent_output',
    generation: 'v2',
    scheme: 'exact',
    pricingModel: 'fixed_per_request',
    releasePosture: 'first_release_candidate',
    defaultMode: 'standard',
    modeSelectorField: 'verification_mode',
    modes: [
      {
        mode: 'standard',
        pricingKey: 'verify_agent_output_standard_v2',
        amountKind: 'exact',
        unit: 'request',
        available: true,
      },
      {
        mode: 'independent_reproduction',
        pricingKey: 'verify_agent_output_reproduction',
        amountKind: 'exact',
        unit: 'request',
        available: false,
        unavailableReason: REPRODUCTION_UNAVAILABLE,
      },
    ],
    tierKeys: null,
  },
};

// ---------------------------------------------------------------------------
// Resolved (governed) offer
// ---------------------------------------------------------------------------
export interface ResolvedEconomicMode {
  readonly mode: string;
  readonly pricingKey: PricingKey;
  readonly amountUsd: string;
  readonly amountKind: EconomicAmountKind;
  readonly unit: 'request' | 'job';
  readonly available: boolean;
  readonly unavailableReason?: string;
}

export interface ResolvedTierPrice {
  readonly tier: DocumentPageTier;
  readonly pricingKey: PricingKey;
  readonly amountUsd: string;
}

export interface EconomicOffer {
  readonly serviceId: EconomicServiceId;
  readonly capabilityId: EconomicFamily;
  readonly serviceVersion: 'v1' | 'v2';
  readonly contractRole: EconomicContractRole;
  readonly scheme: EconomicScheme;
  readonly pricingModel: EconomicPricingModel;
  readonly priceUnit: EconomicPriceUnit;
  readonly actualSettlementModel: EconomicActualSettlementModel;
  readonly releasePosture: EconomicReleasePosture;
  readonly defaultMode: string;
  readonly modeSelectorField: string | null;
  readonly modes: readonly ResolvedEconomicMode[];
  readonly tierPrices: readonly ResolvedTierPrice[] | null;
  readonly maxDocumentPages: number | null;
  readonly pricingSourceVersion: string;
}

export function isEconomicServiceId(value: string): value is EconomicServiceId {
  return (ECONOMIC_SERVICE_IDS as readonly string[]).includes(value);
}

/** The governance key whose value the x402 challenge/requirement `amount` is
 * derived from -- exactly what each production composition's `pricingKey`
 * must equal. */
export function challengePricingKey(serviceId: EconomicServiceId): PricingKey {
  const definition = DEFINITIONS[serviceId];
  const mode = definition.modes.find((m) => m.mode === definition.defaultMode);
  if (!mode) throw new Error(`economic definition for ${serviceId} has no default mode`);
  return mode.pricingKey;
}

export function buildEconomicOffer(serviceId: EconomicServiceId): EconomicOffer {
  const definition = DEFINITIONS[serviceId];
  const modes: ResolvedEconomicMode[] = definition.modes.map((mode) => ({
    mode: mode.mode,
    pricingKey: mode.pricingKey,
    amountUsd: resolveServiceMaxPriceUsd(mode.pricingKey),
    amountKind: mode.amountKind,
    unit: mode.unit,
    available: mode.available,
    ...(mode.unavailableReason ? { unavailableReason: mode.unavailableReason } : {}),
  }));
  const tierPrices: ResolvedTierPrice[] | null = definition.tierKeys
    ? (['native', 'ocr', 'table'] as const).map((tier) => ({
        tier,
        pricingKey: definition.tierKeys![tier],
        amountUsd: resolveServiceMaxPriceUsd(definition.tierKeys![tier]),
      }))
    : null;
  return {
    serviceId,
    capabilityId: definition.family,
    serviceVersion: definition.generation,
    contractRole: definition.generation === 'v2' ? 'current' : 'compatibility',
    scheme: definition.scheme,
    pricingModel: definition.pricingModel,
    priceUnit: definition.pricingModel === 'metered_per_page_tiered' ? 'page' : 'request',
    actualSettlementModel:
      definition.scheme === 'exact'
        ? 'equals_exact_amount'
        : 'measured_usage_not_exceeding_authorization',
    releasePosture: definition.releasePosture,
    defaultMode: definition.defaultMode,
    modeSelectorField: definition.modeSelectorField,
    modes,
    tierPrices,
    maxDocumentPages:
      definition.family === 'document_evidence_json' ? resolveMaxDocumentPages() : null,
    pricingSourceVersion: resolvePricingSourceVersion(),
  };
}

export function buildAllEconomicOffers(): readonly EconomicOffer[] {
  return ECONOMIC_SERVICE_IDS.map(buildEconomicOffer);
}

// ---------------------------------------------------------------------------
// Public projection (the one JSON shape every surface embeds)
// ---------------------------------------------------------------------------

/** Operational fact: where value is paid. Supplied by the caller from real
 * runtime configuration; never derived or defaulted in this package. */
export interface PaymentDestination {
  readonly network: string;
  readonly asset: string;
  readonly payTo: string;
}

export interface EconomicModeProjection {
  readonly mode: string;
  readonly amount: string;
  readonly amount_kind: EconomicAmountKind;
  readonly unit: 'request' | 'job';
  readonly price_defined: true;
  readonly capability_available: boolean;
  readonly unavailable_reason?: string;
}

export interface EconomicOfferProjection {
  readonly service_id: EconomicServiceId;
  readonly capability_id: EconomicFamily;
  readonly service_version: 'v1' | 'v2';
  readonly contract_role: EconomicContractRole;
  readonly resource: string;
  readonly scheme: EconomicScheme;
  readonly pricing_model: EconomicPricingModel;
  readonly currency: 'USD';
  readonly price_unit: EconomicPriceUnit;
  readonly amount_kind: EconomicAmountKind;
  /** Exact-scheme request price of the default mode; `null` for `upto`. */
  readonly list_amount: string | null;
  /** `upto` authorization ceiling; `null` for `exact`. */
  readonly authorization_maximum: string | null;
  readonly actual_settlement_model: EconomicActualSettlementModel;
  readonly tier_prices: readonly { tier: DocumentPageTier; unit: 'page'; amount: string }[] | null;
  readonly measured_usage_semantics: {
    readonly usage_basis: 'processed_page';
    readonly tier_selection: 'highest_applicable_tier_per_page';
    readonly tier_precedence: readonly DocumentPageTier[];
    readonly settlement: 'sum_of_page_tiers_capped_at_authorization_maximum';
    readonly authorization_is_ceiling_not_charge: true;
  } | null;
  readonly limits: { readonly max_document_pages: number } | null;
  readonly default_mode: string;
  readonly available_modes: readonly string[];
  readonly modes: readonly EconomicModeProjection[];
  readonly release_posture: EconomicReleasePosture;
  readonly production_enabled: boolean;
  readonly payment: { network: string; asset: string; pay_to: string } | null;
  readonly pricing_source_version: string;
}

export interface EconomicProjectionRuntime {
  /** Full resource URL, built by the caller from the canonical route table. */
  readonly resource: string;
  /** OPERATIONAL: derived by the caller from real runtime gates. */
  readonly productionEnabled: boolean;
  /** OPERATIONAL: `null` means "not configured" -- never a sentinel string. */
  readonly destination: PaymentDestination | null;
}

const TIER_PRECEDENCE: readonly DocumentPageTier[] = ['table', 'ocr', 'native'];

export function projectEconomicOffer(
  offer: EconomicOffer,
  runtime: EconomicProjectionRuntime
): EconomicOfferProjection {
  const defaultMode = offer.modes.find((m) => m.mode === offer.defaultMode);
  if (!defaultMode) throw new Error(`economic offer ${offer.serviceId} has no default mode`);
  const isExact = offer.scheme === 'exact';
  return {
    service_id: offer.serviceId,
    capability_id: offer.capabilityId,
    service_version: offer.serviceVersion,
    contract_role: offer.contractRole,
    resource: runtime.resource,
    scheme: offer.scheme,
    pricing_model: offer.pricingModel,
    currency: 'USD',
    price_unit: offer.priceUnit,
    amount_kind: defaultMode.amountKind,
    list_amount: isExact ? defaultMode.amountUsd : null,
    authorization_maximum: isExact ? null : defaultMode.amountUsd,
    actual_settlement_model: offer.actualSettlementModel,
    tier_prices: offer.tierPrices
      ? offer.tierPrices.map((tier) => ({ tier: tier.tier, unit: 'page', amount: tier.amountUsd }))
      : null,
    measured_usage_semantics: offer.tierPrices
      ? {
          usage_basis: 'processed_page',
          tier_selection: 'highest_applicable_tier_per_page',
          tier_precedence: TIER_PRECEDENCE,
          settlement: 'sum_of_page_tiers_capped_at_authorization_maximum',
          authorization_is_ceiling_not_charge: true,
        }
      : null,
    limits: offer.maxDocumentPages === null ? null : { max_document_pages: offer.maxDocumentPages },
    default_mode: offer.defaultMode,
    available_modes: offer.modes.filter((m) => m.available).map((m) => m.mode),
    modes: offer.modes.map((m) => ({
      mode: m.mode,
      amount: m.amountUsd,
      amount_kind: m.amountKind,
      unit: m.unit,
      price_defined: true as const,
      capability_available: m.available,
      ...(m.unavailableReason ? { unavailable_reason: m.unavailableReason } : {}),
    })),
    release_posture: offer.releasePosture,
    production_enabled: runtime.productionEnabled,
    payment: runtime.destination
      ? {
          network: runtime.destination.network,
          asset: runtime.destination.asset,
          pay_to: runtime.destination.payTo,
        }
      : null,
    pricing_source_version: offer.pricingSourceVersion,
  };
}

// ---------------------------------------------------------------------------
// Validation and parity
// ---------------------------------------------------------------------------
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Deterministic self-consistency findings for one projection. An empty list
 * means the projection cannot contradict itself. */
export function validateEconomicProjection(projection: EconomicOfferProjection): string[] {
  const problems: string[] = [];
  const id = projection.service_id;
  const isV2 = id.endsWith('.v2');
  if (projection.contract_role === 'current' && !isV2) {
    problems.push(`${id}: a non-v2 service id is projected as the current commercial identity`);
  }
  if (projection.contract_role === 'compatibility' && isV2) {
    problems.push(`${id}: a v2 service id is projected as a compatibility identity`);
  }
  if (projection.contract_role === 'current' && !projection.resource.includes('/v2/')) {
    problems.push(`${id}: current commercial identity resource is not a /v2/ path`);
  }
  if (projection.scheme === 'exact') {
    if (projection.list_amount === null) problems.push(`${id}: exact scheme has no list_amount`);
    if (projection.authorization_maximum !== null) {
      problems.push(`${id}: exact scheme must not declare an authorization_maximum`);
    }
    if (projection.amount_kind !== 'exact') problems.push(`${id}: exact scheme amount_kind`);
    if (projection.actual_settlement_model !== 'equals_exact_amount') {
      problems.push(`${id}: exact scheme must settle at the exact amount`);
    }
  } else {
    if (projection.authorization_maximum === null) {
      problems.push(`${id}: upto scheme has no authorization_maximum`);
    }
    if (projection.list_amount !== null) {
      problems.push(`${id}: upto scheme must not declare a fixed list_amount`);
    }
    if (projection.amount_kind !== 'authorized_maximum') {
      problems.push(`${id}: upto scheme amount_kind`);
    }
    if (!projection.tier_prices || projection.tier_prices.length === 0) {
      problems.push(`${id}: upto scheme has no tier_prices`);
    } else if (projection.authorization_maximum !== null) {
      const ceiling = usdToMicro(projection.authorization_maximum);
      for (const tier of projection.tier_prices) {
        if (usdToMicro(tier.amount) > ceiling) {
          problems.push(`${id}: tier ${tier.tier} exceeds the authorization maximum`);
        }
      }
    }
    if (projection.actual_settlement_model !== 'measured_usage_not_exceeding_authorization') {
      problems.push(`${id}: upto scheme must settle measured usage not exceeding authorization`);
    }
  }
  const modeByName = new Map(projection.modes.map((m) => [m.mode, m]));
  if (!modeByName.has(projection.default_mode)) {
    problems.push(`${id}: default_mode is not a declared mode`);
  }
  for (const name of projection.available_modes) {
    if (modeByName.get(name)?.capability_available !== true) {
      problems.push(`${id}: available_modes lists ${name} but the mode is unavailable`);
    }
  }
  for (const mode of projection.modes) {
    if (!mode.capability_available && projection.available_modes.includes(mode.mode)) {
      problems.push(`${id}: unavailable mode ${mode.mode} is advertised as available`);
    }
    if (!mode.capability_available && mode.mode === projection.default_mode) {
      problems.push(`${id}: default_mode ${mode.mode} is unavailable`);
    }
  }
  if (projection.production_enabled) {
    if (projection.release_posture === 'compatibility_not_admitted') {
      problems.push(`${id}: a compatibility identity cannot be production-enabled`);
    }
    if (projection.available_modes.length === 0) {
      problems.push(`${id}: production_enabled but no mode is available`);
    }
    if (!projection.payment) {
      problems.push(`${id}: production_enabled but no payment destination is configured`);
    } else if (!EVM_ADDRESS.test(projection.payment.pay_to)) {
      problems.push(`${id}: production_enabled payTo is not an address (sentinel or malformed)`);
    }
  }
  if (projection.limits && projection.capability_id !== 'document_evidence_json') {
    problems.push(`${id}: only document offers may declare a page limit`);
  }
  return problems;
}

/** Keys compared by cross-surface parity. `resource` is compared by path only
 * because a request-origin surface (catalog/OpenAPI) may legitimately differ
 * from the canonical origin in host but never in path. */
function comparable(projection: EconomicOfferProjection): unknown {
  const { resource, ...rest } = projection;
  return { ...rest, resource_path: new URL(resource).pathname };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Canonical (sorted-key) serialization of the comparable projection; the
 * input to any digest a consumer wants to compute. */
export function canonicalEconomicProjectionJson(projection: EconomicOfferProjection): string {
  return stableStringify(comparable(projection));
}

export interface EconomicParityDifference {
  readonly path: string;
  readonly left: unknown;
  readonly right: unknown;
}

function diff(left: unknown, right: unknown, path: string, out: EconomicParityDifference[]): void {
  if (
    left !== null &&
    right !== null &&
    typeof left === 'object' &&
    typeof right === 'object' &&
    Array.isArray(left) === Array.isArray(right)
  ) {
    const l = left as Record<string, unknown>;
    const r = right as Record<string, unknown>;
    for (const key of new Set([...Object.keys(l), ...Object.keys(r)])) {
      diff(l[key], r[key], path ? `${path}.${key}` : key, out);
    }
    return;
  }
  if (stableStringify(left) !== stableStringify(right)) out.push({ path, left, right });
}

/** Leaf-level differences between two projections of the same offer. An empty
 * result is exact semantic parity: same amounts, same pricing function
 * (unit/tiers/ceiling/settlement), same modes, same network/asset/payTo. */
export function compareEconomicProjections(
  left: EconomicOfferProjection,
  right: EconomicOfferProjection
): readonly EconomicParityDifference[] {
  const out: EconomicParityDifference[] = [];
  diff(comparable(left), comparable(right), '', out);
  return out;
}

// ---------------------------------------------------------------------------
// Pre-payment mode gate
// ---------------------------------------------------------------------------
export type ModeAvailabilityCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: 'retrieval_mode_unavailable' | 'verification_mode_unavailable';
      readonly message: string;
      readonly mode: string;
    };

/** Pure request-body gate for the modes a service defines a price for but
 * cannot fulfil. Must run BEFORE any quote, 402 challenge, payment
 * verification, authorization, or provider invocation -- a buyer must never
 * discover only after paying (or being quoted) that a mode is unpurchasable,
 * and an unavailable mode must never be silently substituted with a
 * different (cheaper, available) one. An unknown mode value is left to the
 * frozen input schema, which has already run by the time this is called. */
export function checkModeAvailability(
  serviceId: EconomicServiceId,
  body: unknown
): ModeAvailabilityCheck {
  const definition = DEFINITIONS[serviceId];
  const field = definition.modeSelectorField;
  if (!field || body === null || typeof body !== 'object') return { ok: true };
  const requested = (body as Record<string, unknown>)[field];
  if (typeof requested !== 'string') return { ok: true };
  const mode = definition.modes.find((m) => m.mode === requested);
  if (!mode || mode.available) return { ok: true };
  return {
    ok: false,
    code:
      field === 'retrieval_mode' ? 'retrieval_mode_unavailable' : 'verification_mode_unavailable',
    message: `${field} "${requested}" is not available for ${serviceId}: ${mode.unavailableReason ?? 'mode unavailable'} Available: ${definition.modes
      .filter((m) => m.available)
      .map((m) => m.mode)
      .join(', ')}. No quote was created and nothing was charged.`,
    mode: requested,
  };
}

/**
 * R3-57A: economic observation record (append-only ledger row body).
 *
 * Observation only. It never grants execution, payment, result-release or
 * settlement authority, and imports nothing from the control plane. Unknown
 * quantities stay null; nothing is defaulted or zero-filled, and an
 * ESTIMATE_ONLY quantity can never be stored as an observed cost.
 */
import { canonicalize, hashCanonical } from './canonical';

export const ECONOMIC_QUALITIES = [
  'AUTHORITATIVE_AVAILABLE',
  'DERIVABLE',
  'ESTIMATE_ONLY',
  'NOT_AVAILABLE',
] as const;
export type EconomicQuality = (typeof ECONOMIC_QUALITIES)[number];

export interface EconomicQuantity {
  /** Non-negative integer string, smallest unit of `currency`; null = unknown. */
  readonly value: string | null;
  readonly quality: EconomicQuality;
  /** Where the value came from (e.g. 'x402.settle.amount'). Required with a value. */
  readonly source: string | null;
}

export const ECONOMIC_FIELDS = [
  'revenue',
  'normalized_cogs',
  'cash_cogs',
  'credit_benefit',
] as const;
export type EconomicField = (typeof ECONOMIC_FIELDS)[number];

export const OBSERVATION_KINDS = [
  'PRE_EXECUTION_BOUND',
  'POST_EXECUTION_ACTUAL',
  'REVENUE',
  'ESTIMATE',
  'UNKNOWN',
] as const;
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

export interface EconomicObservationInput {
  readonly kind: ObservationKind;
  /** Pre-execution provider-cost bound (PRE_EXECUTION_BOUND only). */
  readonly bound?: EconomicQuantity;
  /** Free-form estimate label; an ESTIMATE never carries an amount column. */
  readonly estimate_note?: string;
  readonly payment_identifier: string;
  readonly service_id?: string;
  readonly provider_id?: string;
  readonly execution_id?: string;
  readonly environment: 'production' | 'staging' | 'local';
  readonly platform_version_id?: string;
  readonly currency: string;
  readonly observed_at: string;
  readonly revenue?: EconomicQuantity;
  readonly normalized_cogs?: EconomicQuantity;
  readonly cash_cogs?: EconomicQuantity;
}

export interface EconomicObservation {
  readonly observation_id: string;
  readonly body_jcs: string;
  readonly row: Readonly<Record<string, string | null>>;
}

const UNKNOWN: EconomicQuantity = { value: null, quality: 'NOT_AVAILABLE', source: null };
const ATOMIC_RE = /^(0|[1-9][0-9]*)$/;
const NONEMPTY = (s: string | undefined, name: string): void => {
  if (s !== undefined && s.length === 0) throw new Error(`economic: ${name} must be non-empty`);
};

function checkQuantity(name: string, q: EconomicQuantity): EconomicQuantity {
  if (q.value === null) {
    if (q.quality !== 'NOT_AVAILABLE' && q.quality !== 'ESTIMATE_ONLY') {
      throw new Error(`economic: ${name} has quality ${q.quality} but no value`);
    }
    return q;
  }
  if (!ATOMIC_RE.test(q.value)) throw new Error(`economic: ${name} is not a non-negative integer`);
  if (q.quality === 'NOT_AVAILABLE') throw new Error(`economic: ${name} has a value but NOT_AVAILABLE`);
  if (q.quality === 'ESTIMATE_ONLY') {
    throw new Error(`economic: ${name} is ESTIMATE_ONLY and may not be recorded as an observed value`);
  }
  if (!q.source) throw new Error(`economic: ${name} requires a source`);
  return q;
}

/** credit_benefit = normalized_cogs - cash_cogs, only when both were observed. */
export function deriveCreditBenefit(
  normalized: EconomicQuantity,
  cash: EconomicQuantity
): EconomicQuantity {
  if (normalized.value === null || cash.value === null) return UNKNOWN;
  const v = BigInt(normalized.value) - BigInt(cash.value);
  if (v < 0n) return UNKNOWN; // cash above normalized is not a credit; do not invent one
  return {
    value: v.toString(),
    quality: 'DERIVABLE',
    source: `derived:${normalized.source}-${cash.source}`,
  };
}

export async function buildEconomicObservation(
  input: EconomicObservationInput
): Promise<EconomicObservation> {
  if (!input.payment_identifier) throw new Error('economic: payment_identifier required');
  if (!input.currency) throw new Error('economic: currency required');
  NONEMPTY(input.service_id, 'service_id');
  NONEMPTY(input.provider_id, 'provider_id');
  NONEMPTY(input.execution_id, 'execution_id');
  NONEMPTY(input.platform_version_id, 'platform_version_id');

  if (!OBSERVATION_KINDS.includes(input.kind)) throw new Error('economic: unknown observation kind');
  const k = input.kind;
  const has = (q?: EconomicQuantity): boolean => !!q && q.value !== null;
  const only = (allowed: readonly string[]): void => {
    const present: Record<string, boolean> = {
      bound: has(input.bound),
      revenue: has(input.revenue),
      normalized_cogs: has(input.normalized_cogs),
      cash_cogs: has(input.cash_cogs),
    };
    for (const [f, on] of Object.entries(present)) {
      if (on && !allowed.includes(f)) throw new Error(`economic: ${f} is not allowed on a ${k} observation`);
    }
  };
  if (k === 'PRE_EXECUTION_BOUND') only(['bound']);
  else if (k === 'POST_EXECUTION_ACTUAL') only(['normalized_cogs', 'cash_cogs']);
  else if (k === 'REVENUE') only(['revenue']);
  else only([]);
  if (k === 'PRE_EXECUTION_BOUND' && input.bound?.value !== null && input.bound?.quality === 'ESTIMATE_ONLY') {
    throw new Error('economic: a pre-execution bound may not be an estimate');
  }
  const bound = checkQuantity('bound', input.bound ?? UNKNOWN);
  const revenue = checkQuantity('revenue', input.revenue ?? UNKNOWN);
  const normalized = checkQuantity('normalized_cogs', input.normalized_cogs ?? UNKNOWN);
  const cash = checkQuantity('cash_cogs', input.cash_cogs ?? UNKNOWN);
  const credit = deriveCreditBenefit(normalized, cash);

  const body = {
    schema: 'economic_observation.v2',
    observation_kind: k,
    authority: 'NONE',
    payment_identifier: input.payment_identifier,
    service_id: input.service_id ?? null,
    provider_id: input.provider_id ?? null,
    execution_id: input.execution_id ?? null,
    environment: input.environment,
    platform_version_id: input.platform_version_id ?? null,
    currency: input.currency,
    observed_at: input.observed_at,
    bound,
    estimate_note: k === 'ESTIMATE' ? (input.estimate_note ?? null) : null,
    revenue,
    normalized_cogs: normalized,
    cash_cogs: cash,
    credit_benefit: credit,
  };
  const body_jcs = canonicalize(body);
  const hash = (await hashCanonical(body)).replace(/^sha256:/, '');
  const observation_id = `eo:${hash}`;
  return {
    observation_id,
    body_jcs,
    row: {
      observation_id,
      payment_identifier: body.payment_identifier,
      service_id: body.service_id,
      provider_id: body.provider_id,
      execution_id: body.execution_id,
      environment: body.environment,
      platform_version_id: body.platform_version_id,
      currency: body.currency,
      observation_kind: k,
      bound_atomic: bound.value,
      revenue_atomic: revenue.value,
      normalized_cogs_atomic: normalized.value,
      cash_cogs_atomic: cash.value,
      credit_benefit_atomic: credit.value,
      observed_at: body.observed_at,
      authority: 'NONE',
      body_jcs,
    },
  };
}

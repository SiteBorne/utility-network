export const MICRO_USD_PER_USD = 1_000_000;

export interface MarginRational {
  numerator: number;
  denominator: number;
}

export const TARGET_MARGIN: MarginRational = { numerator: 70, denominator: 100 };
export const MINIMUM_ACCEPTED_MARGIN: MarginRational = { numerator: 60, denominator: 100 };
export const MAX_PRICE_CHANGE_PCT = 20;

export interface CostComponentsMicro {
  resource_replacement_cost_usd: number;
  verification_cost_usd: number;
  facilitator_cost_usd: number;
  expected_retry_cost_usd: number;
  refund_reserve_usd: number;
  storage_cost_usd: number;
}

export interface CostComponentsUsd {
  resource_replacement_cost_usd: number;
  verification_cost_usd: number;
  facilitator_cost_usd: number;
  expected_retry_cost_usd: number;
  refund_reserve_usd: number;
  storage_cost_usd: number;
}

export function usdToMicro(usd: string): number {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/.exec(usd);
  if (!match) {
    throw new TypeError('USD amount must be a canonical non-negative decimal with at most 6 places');
  }

  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? '').padEnd(6, '0'));
  const micro = whole * BigInt(MICRO_USD_PER_USD) + fraction;
  if (micro > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('USD amount exceeds the safe micro-USD integer range');
  }
  return Number(micro);
}

export function microToUsd(micro: number): string {
  const whole = Math.floor(micro / MICRO_USD_PER_USD);
  const fraction = micro % MICRO_USD_PER_USD;
  return `${whole}.${fraction.toString().padStart(6, '0')}`;
}

export function addMicro(a: number, b: number): number {
  return a + b;
}

export function computeExpectedCostMicro(components: CostComponentsMicro): number {
  return (
    components.resource_replacement_cost_usd +
    components.verification_cost_usd +
    components.facilitator_cost_usd +
    components.expected_retry_cost_usd +
    components.refund_reserve_usd +
    components.storage_cost_usd
  );
}

export function computeExpectedCostUsd(components: CostComponentsUsd): number {
  return (
    components.resource_replacement_cost_usd +
    components.verification_cost_usd +
    components.facilitator_cost_usd +
    components.expected_retry_cost_usd +
    components.refund_reserve_usd +
    components.storage_cost_usd
  );
}

export function computeMinimumPriceMicro(
  expectedCostMicro: number,
  margin: MarginRational = TARGET_MARGIN
): number {
  const { numerator, denominator } = margin;
  if (numerator >= denominator) {
    throw new Error('Margin numerator must be less than denominator');
  }
  // ceil(expected_cost * denominator / (denominator - numerator))
  const num = expectedCostMicro * denominator;
  const den = denominator - numerator;
  return Math.ceil(num / den);
}

export function computeMinimumPriceUsd(
  expectedCostUsd: number,
  margin: MarginRational = TARGET_MARGIN
): string {
  const expectedCostMicro = usdToMicro(expectedCostUsd.toFixed(6));
  const minPriceMicro = computeMinimumPriceMicro(expectedCostMicro, margin);
  return microToUsd(minPriceMicro);
}

export function computeMarginMicro(priceMicro: number, costMicro: number): MarginRational {
  if (priceMicro <= 0) throw new Error('Price must be positive');
  const num = priceMicro - costMicro;
  const den = priceMicro;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(num, den);
  return { numerator: num / g, denominator: den / g };
}

export function marginToPercent(margin: MarginRational): number {
  return (margin.numerator / margin.denominator) * 100;
}

export function validateMargin(
  margin: MarginRational,
  minimum: MarginRational = MINIMUM_ACCEPTED_MARGIN
): boolean {
  return margin.numerator * minimum.denominator >= minimum.numerator * margin.denominator;
}

export function validatePriceChange(
  oldPriceUsd: string,
  newPriceUsd: string,
  maxPct: number = MAX_PRICE_CHANGE_PCT
): boolean {
  const oldMicro = usdToMicro(oldPriceUsd);
  const newMicro = usdToMicro(newPriceUsd);
  if (oldMicro === 0) return false;
  const changePct = Math.abs(((newMicro - oldMicro) * 100) / oldMicro);
  return changePct <= maxPct + 1e-9;
}

export function applyScarcityMultiplier(baseCostMicro: number, remainingQuotaPct: number): number {
  let multiplier: number;
  if (remainingQuotaPct > 75) multiplier = 0.1;
  else if (remainingQuotaPct > 50) multiplier = 0.25;
  else if (remainingQuotaPct > 25) multiplier = 0.6;
  else if (remainingQuotaPct > 10) multiplier = 1.0;
  else multiplier = 2.0;
  return Math.ceil(baseCostMicro * multiplier);
}

export * from './service-prices';
export * from './document-usage';

export function applyFailureRiskMultiplier(costMicro: number, providerReliability: number): number {
  let multiplier: number;
  if (providerReliability >= 0.99) multiplier = 1.0;
  else if (providerReliability >= 0.95) multiplier = 1.2;
  else if (providerReliability >= 0.9) multiplier = 1.5;
  else multiplier = 2.0;
  return Math.ceil(costMicro * multiplier);
}

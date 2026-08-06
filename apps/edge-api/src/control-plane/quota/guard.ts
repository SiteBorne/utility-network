import type { QuotaReservation } from '../types';

export interface ResourceQuota {
  resource_class: string;
  total_units: number;
  available_units: number;
  reserved_units: number;
  replacement_cost_per_unit: string;
  scarcity_multiplier: string;
  failure_risk_multiplier: string;
}

export interface CostCalculation {
  resource_replacement_cost: string;
  verification_cost: string;
  facilitator_cost: string;
  expected_retry_cost: string;
  refund_reserve: string;
  storage_cost: string;
  expected_cost: string;
  max_authorized_cost: string;
  scarcity_multiplier: string;
  failure_risk_multiplier: string;
}

export interface QuotaGuardConfig {
  paid_overflow_enabled: boolean;
  max_job_cost_usd: string;
  default_scarcity_multiplier: string;
  default_failure_risk_multiplier: string;
  resource_quotas: Record<string, ResourceQuota>;
}

export const DEFAULT_QUOTA_CONFIG: QuotaGuardConfig = {
  paid_overflow_enabled: false,
  max_job_cost_usd: '10.00',
  default_scarcity_multiplier: '1.0',
  default_failure_risk_multiplier: '1.0',
  resource_quotas: {
    cpu_heavy: {
      resource_class: 'cpu_heavy',
      total_units: 100,
      available_units: 100,
      reserved_units: 0,
      replacement_cost_per_unit: '0.05',
      scarcity_multiplier: '1.0',
      failure_risk_multiplier: '1.1',
    },
    storage: {
      resource_class: 'storage',
      total_units: 10000,
      available_units: 10000,
      reserved_units: 0,
      replacement_cost_per_unit: '0.001',
      scarcity_multiplier: '1.0',
      failure_risk_multiplier: '1.0',
    },
    network: {
      resource_class: 'network',
      total_units: 1000,
      available_units: 1000,
      reserved_units: 0,
      replacement_cost_per_unit: '0.01',
      scarcity_multiplier: '1.0',
      failure_risk_multiplier: '1.05',
    },
    verification: {
      resource_class: 'verification',
      total_units: 50,
      available_units: 50,
      reserved_units: 0,
      replacement_cost_per_unit: '0.02',
      scarcity_multiplier: '1.0',
      failure_risk_multiplier: '1.2',
    },
  },
};

export function addDecimal(a: string, b: string): string {
  const [aInt, aDec = '0'] = a.split('.');
  const [bInt, bDec = '0'] = b.split('.');
  const maxDec = Math.max(aDec.length, bDec.length);
  const aScaled = BigInt(aInt) * 10n ** BigInt(maxDec) + BigInt(aDec.padEnd(maxDec, '0'));
  const bScaled = BigInt(bInt) * 10n ** BigInt(maxDec) + BigInt(bDec.padEnd(maxDec, '0'));
  const sum = aScaled + bScaled;
  const intPart = sum / 10n ** BigInt(maxDec);
  const decPart = sum % 10n ** BigInt(maxDec);
  return `${intPart}.${decPart.toString().padStart(maxDec, '0')}`;
}

export function multiplyDecimal(a: string, b: string): string {
  const [aInt, aDec = '0'] = a.split('.');
  const [bInt, bDec = '0'] = b.split('.');
  const aScaled = BigInt(aInt + aDec);
  const bScaled = BigInt(bInt + bDec);
  const totalDec = aDec.length + bDec.length;
  const product = aScaled * bScaled;
  const intPart = product / 10n ** BigInt(totalDec);
  const decPart = product % 10n ** BigInt(totalDec);
  return `${intPart}.${decPart.toString().padStart(totalDec, '0')}`;
}

export function compareDecimal(a: string, b: string): number {
  const [aInt, aDec = '0'] = a.split('.');
  const [bInt, bDec = '0'] = b.split('.');
  const maxDec = Math.max(aDec.length, bDec.length);
  const aScaled = BigInt(aInt) * 10n ** BigInt(maxDec) + BigInt(aDec.padEnd(maxDec, '0'));
  const bScaled = BigInt(bInt) * 10n ** BigInt(maxDec) + BigInt(bDec.padEnd(maxDec, '0'));
  if (aScaled < bScaled) return -1;
  if (aScaled > bScaled) return 1;
  return 0;
}

export function calculateScarcityMultiplier(quota: ResourceQuota): string {
  const remainingPercent = (quota.available_units / quota.total_units) * 100;
  if (remainingPercent < 10) return '3.0';
  if (remainingPercent < 25) return '2.0';
  if (remainingPercent < 50) return '1.5';
  return '1.0';
}

export function calculateExpectedCost(
  resourceUnits: number,
  resourceClass: string,
  config: QuotaGuardConfig = DEFAULT_QUOTA_CONFIG
): CostCalculation {
  const quota = config.resource_quotas[resourceClass];
  if (!quota) {
    throw new Error(`Unknown resource class: ${resourceClass}`);
  }

  const scarcityMultiplier = calculateScarcityMultiplier(quota);
  const failureRiskMultiplier = quota.failure_risk_multiplier;

  const resourceReplacementCost = multiplyDecimal(
    multiplyDecimal(quota.replacement_cost_per_unit, String(resourceUnits)),
    scarcityMultiplier
  );

  const verificationCost = multiplyDecimal('0.01', scarcityMultiplier);
  const facilitatorCost = multiplyDecimal('0.005', scarcityMultiplier);
  const expectedRetryCost = multiplyDecimal(
    multiplyDecimal(resourceReplacementCost, '0.1'),
    failureRiskMultiplier
  );
  const refundReserve = multiplyDecimal(resourceReplacementCost, '0.05');
  const storageCost = multiplyDecimal('0.001', scarcityMultiplier);

  let expectedCost = '0';
  expectedCost = addDecimal(expectedCost, resourceReplacementCost);
  expectedCost = addDecimal(expectedCost, verificationCost);
  expectedCost = addDecimal(expectedCost, facilitatorCost);
  expectedCost = addDecimal(expectedCost, expectedRetryCost);
  expectedCost = addDecimal(expectedCost, refundReserve);
  expectedCost = addDecimal(expectedCost, storageCost);

  const maxAuthorizedCost = config.max_job_cost_usd;

  if (compareDecimal(expectedCost, maxAuthorizedCost) > 0) {
    throw new Error(
      `Expected cost ${expectedCost} exceeds maximum authorized cost ${maxAuthorizedCost}`
    );
  }

  return {
    resource_replacement_cost: resourceReplacementCost,
    verification_cost: verificationCost,
    facilitator_cost: facilitatorCost,
    expected_retry_cost: expectedRetryCost,
    refund_reserve: refundReserve,
    storage_cost: storageCost,
    expected_cost: expectedCost,
    max_authorized_cost: maxAuthorizedCost,
    scarcity_multiplier: scarcityMultiplier,
    failure_risk_multiplier: failureRiskMultiplier,
  };
}

export function reserveQuota(
  jobId: string,
  resourceClass: string,
  requestedUnits: number,
  config: QuotaGuardConfig = DEFAULT_QUOTA_CONFIG
): { reservation: QuotaReservation; costCalculation: CostCalculation } {
  const quota = config.resource_quotas[resourceClass];
  if (!quota) {
    throw new Error(`Unknown resource class: ${resourceClass}`);
  }

  if (quota.available_units < requestedUnits) {
    throw new Error(
      `Insufficient quota for ${resourceClass}: requested ${requestedUnits}, available ${quota.available_units}`
    );
  }

  const costCalculation = calculateExpectedCost(requestedUnits, resourceClass, config);
  const scarcityMultiplier = costCalculation.scarcity_multiplier;
  const failureRiskMultiplier = costCalculation.failure_risk_multiplier;

  const reservation: QuotaReservation = {
    id: crypto.randomUUID(),
    job_id: jobId,
    resource_class: resourceClass,
    requested_units: requestedUnits,
    remaining_units: quota.available_units - requestedUnits,
    reserved_units: requestedUnits,
    replacement_cost: quota.replacement_cost_per_unit,
    scarcity_multiplier: scarcityMultiplier,
    failure_risk_multiplier: failureRiskMultiplier,
    max_authorized_cost: costCalculation.expected_cost,
    paid_overflow_enabled: config.paid_overflow_enabled,
    reserved_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    released_at: undefined,
  };

  return { reservation, costCalculation };
}

export function releaseQuota(reservation: QuotaReservation): QuotaReservation {
  return {
    ...reservation,
    released_at: new Date().toISOString(),
    reserved_units: 0,
    remaining_units: reservation.remaining_units + reservation.reserved_units,
  };
}

export function isQuotaExpired(reservation: QuotaReservation): boolean {
  return new Date(reservation.expires_at) <= new Date();
}

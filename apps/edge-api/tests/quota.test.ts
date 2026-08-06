import { describe, it, expect } from 'vitest';
import {
  calculateExpectedCost,
  reserveQuota,
  releaseQuota,
  isQuotaExpired,
  addDecimal,
  multiplyDecimal,
  compareDecimal,
  DEFAULT_QUOTA_CONFIG,
} from '../src/control-plane/quota/guard';

describe('Decimal Arithmetic', () => {
  it('adds decimals correctly', () => {
    expect(addDecimal('1.5', '2.3')).toBe('3.8');
    expect(addDecimal('0.1', '0.2')).toBe('0.3');
    expect(addDecimal('10.00', '5.50')).toBe('15.50');
    expect(addDecimal('0.01', '0.02')).toBe('0.03');
  });

  it('multiplies decimals correctly', () => {
    expect(multiplyDecimal('2.0', '3.0')).toBe('6.00');
    expect(multiplyDecimal('0.5', '2.0')).toBe('1.00');
    expect(multiplyDecimal('1.5', '1.5')).toBe('2.25');
  });

  it('compares decimals correctly', () => {
    expect(compareDecimal('1.5', '2.0')).toBe(-1);
    expect(compareDecimal('2.0', '1.5')).toBe(1);
    expect(compareDecimal('1.5', '1.5')).toBe(0);
    expect(compareDecimal('10.00', '9.99')).toBe(1);
  });
});

describe('Quota Guard', () => {
  it('calculates expected cost with all components', () => {
    const result = calculateExpectedCost(10, 'cpu_heavy');

    expect(result.resource_replacement_cost).toBeDefined();
    expect(result.verification_cost).toBeDefined();
    expect(result.facilitator_cost).toBeDefined();
    expect(result.expected_retry_cost).toBeDefined();
    expect(result.refund_reserve).toBeDefined();
    expect(result.storage_cost).toBeDefined();
    expect(result.expected_cost).toBeDefined();
    expect(result.max_authorized_cost).toBe('10.00');
    expect(result.scarcity_multiplier).toBeDefined();
    expect(result.failure_risk_multiplier).toBeDefined();
  });

  it('applies scarcity multiplier based on remaining quota', () => {
    const config = {
      ...DEFAULT_QUOTA_CONFIG,
      resource_quotas: {
        ...DEFAULT_QUOTA_CONFIG.resource_quotas,
        test_resource: {
          resource_class: 'test_resource',
          total_units: 100,
          available_units: 5,
          reserved_units: 0,
          replacement_cost_per_unit: '0.01',
          scarcity_multiplier: '1.0',
          failure_risk_multiplier: '1.0',
        },
      },
    };

    const result = calculateExpectedCost(1, 'test_resource', config);
    expect(result.scarcity_multiplier).toBe('3.0');
  });

  it('throws when expected cost exceeds max authorized', () => {
    const config = {
      ...DEFAULT_QUOTA_CONFIG,
      max_job_cost_usd: '0.001',
    };

    expect(() => calculateExpectedCost(10, 'cpu_heavy', config)).toThrow(
      'exceeds maximum authorized cost'
    );
  });

  it('reserves quota successfully', () => {
    const { reservation, costCalculation } = reserveQuota('job-123', 'cpu_heavy', 5);

    expect(reservation.job_id).toBe('job-123');
    expect(reservation.resource_class).toBe('cpu_heavy');
    expect(reservation.requested_units).toBe(5);
    expect(reservation.reserved_units).toBe(5);
    expect(reservation.paid_overflow_enabled).toBe(false);
    expect(costCalculation.expected_cost).toBeDefined();
  });

  it('throws when insufficient quota', () => {
    const config = {
      ...DEFAULT_QUOTA_CONFIG,
      resource_quotas: {
        ...DEFAULT_QUOTA_CONFIG.resource_quotas,
        cpu_heavy: {
          ...DEFAULT_QUOTA_CONFIG.resource_quotas['cpu_heavy'],
          available_units: 2,
        },
      },
    };

    expect(() => reserveQuota('job-123', 'cpu_heavy', 5, config)).toThrow('Insufficient quota');
  });

  it('releases quota', () => {
    const { reservation } = reserveQuota('job-123', 'cpu_heavy', 5);
    const released = releaseQuota(reservation);

    expect(released.released_at).toBeDefined();
    expect(released.reserved_units).toBe(0);
    expect(released.remaining_units).toBe(reservation.remaining_units + reservation.reserved_units);
  });

  it('checks quota expiration', () => {
    const { reservation } = reserveQuota('job-123', 'cpu_heavy', 5);
    expect(isQuotaExpired(reservation)).toBe(false);

    const expiredReservation = {
      ...reservation,
      expires_at: new Date(Date.now() - 1000).toISOString(),
    };
    expect(isQuotaExpired(expiredReservation)).toBe(true);
  });

  it('uses additive cost formula', () => {
    const result = calculateExpectedCost(1, 'cpu_heavy');
    const expected = '0';
    let sum = expected;
    sum = addDecimal(sum, result.resource_replacement_cost);
    sum = addDecimal(sum, result.verification_cost);
    sum = addDecimal(sum, result.facilitator_cost);
    sum = addDecimal(sum, result.expected_retry_cost);
    sum = addDecimal(sum, result.refund_reserve);
    sum = addDecimal(sum, result.storage_cost);
    expect(sum).toBe(result.expected_cost);
  });

  it('increasing any cost component never lowers minimum cost', () => {
    const base = calculateExpectedCost(10, 'cpu_heavy');
    const increased = calculateExpectedCost(20, 'cpu_heavy');
    expect(compareDecimal(increased.expected_cost, base.expected_cost)).toBeGreaterThanOrEqual(0);
  });

  it('paid overflow defaults to false', () => {
    const { reservation } = reserveQuota('job-123', 'cpu_heavy', 1);
    expect(reservation.paid_overflow_enabled).toBe(false);
  });

  it('no negative costs', () => {
    const result = calculateExpectedCost(1, 'cpu_heavy');
    expect(compareDecimal(result.expected_cost, '0')).toBeGreaterThanOrEqual(0);
    expect(compareDecimal(result.resource_replacement_cost, '0')).toBeGreaterThanOrEqual(0);
    expect(compareDecimal(result.verification_cost, '0')).toBeGreaterThanOrEqual(0);
  });
});

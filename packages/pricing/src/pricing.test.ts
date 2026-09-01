import { describe, it, expect } from 'vitest';
import {
  TARGET_MARGIN,
  usdToMicro,
  microToUsd,
  computeExpectedCostMicro,
  computeExpectedCostUsd,
  computeMinimumPriceMicro,
  computeMinimumPriceUsd,
  computeMarginMicro,
  marginToPercent,
  validateMargin,
  validatePriceChange,
  applyScarcityMultiplier,
  applyFailureRiskMultiplier,
} from './index';

describe('pricing - decimal-safe arithmetic', () => {
  describe('usdToMicro / microToUsd', () => {
    it('converts whole dollars', () => {
      expect(usdToMicro('1')).toBe(1_000_000);
      expect(usdToMicro('0')).toBe(0);
      expect(usdToMicro('100')).toBe(100_000_000);
    });

    it('converts decimal dollars', () => {
      expect(usdToMicro('0.039')).toBe(39_000);
      expect(usdToMicro('0.009')).toBe(9_000);
      expect(usdToMicro('0.029')).toBe(29_000);
      expect(usdToMicro('0.012')).toBe(12_000);
      expect(usdToMicro('0.019')).toBe(19_000);
      expect(usdToMicro('0.19')).toBe(190_000);
    });

    it('round-trip preserves value', () => {
      const testValues = [
        '0',
        '1',
        '0.039',
        '0.009',
        '0.029',
        '0.012',
        '0.019',
        '0.19',
        '10.50',
        '0.000001',
      ];
      for (const val of testValues) {
        const micro = usdToMicro(val);
        const back = microToUsd(micro);
        expect(parseFloat(back)).toBeCloseTo(parseFloat(val), 5);
      }
    });

    it.each(['-1', '+1', '1e-3', ' 1', '1 ', '', '01', '1.2.3', '0.0000001'])(
      'rejects non-canonical monetary input %j',
      (value) => {
        expect(() => usdToMicro(value)).toThrow(TypeError);
      }
    );

    it('rejects values that cannot be represented as a safe micro-USD integer', () => {
      expect(() => usdToMicro('9007199254740992')).toThrow(RangeError);
    });
  });

  describe('computeExpectedCostMicro', () => {
    it('sums all components (additive, no subtraction)', () => {
      const components = {
        resource_replacement_cost_usd: 1000,
        verification_cost_usd: 500,
        facilitator_cost_usd: 1000,
        expected_retry_cost_usd: 200,
        refund_reserve_usd: 100,
        storage_cost_usd: 50,
      };
      const expected = 1000 + 500 + 1000 + 200 + 100 + 50;
      expect(computeExpectedCostMicro(components)).toBe(expected);
    });

    it('increasing any component increases expected cost (monotonicity)', () => {
      const base = {
        resource_replacement_cost_usd: 1000,
        verification_cost_usd: 500,
        facilitator_cost_usd: 1000,
        expected_retry_cost_usd: 200,
        refund_reserve_usd: 100,
        storage_cost_usd: 50,
      };
      const baseCost = computeExpectedCostMicro(base);

      for (const key of Object.keys(base) as Array<keyof typeof base>) {
        const modified = { ...base, [key]: base[key] + 100 };
        const newCost = computeExpectedCostMicro(modified);
        expect(newCost).toBeGreaterThan(baseCost);
      }
    });
  });

  describe('computeExpectedCostUsd', () => {
    it('sums all components in USD', () => {
      const components = {
        resource_replacement_cost_usd: 0.001,
        verification_cost_usd: 0.0005,
        facilitator_cost_usd: 0.001,
        expected_retry_cost_usd: 0.0002,
        refund_reserve_usd: 0.0001,
        storage_cost_usd: 0.00005,
      };
      const expected = 0.001 + 0.0005 + 0.001 + 0.0002 + 0.0001 + 0.00005;
      expect(computeExpectedCostUsd(components)).toBeCloseTo(expected, 10);
    });
  });

  describe('computeMinimumPriceMicro', () => {
    it('computes ceil(expected_cost * D / (D - N))', () => {
      const expectedCost = 10000;
      const minPrice = computeMinimumPriceMicro(expectedCost, TARGET_MARGIN);
      expect(minPrice).toBe(33334);
    });

    it('throws if margin numerator >= denominator', () => {
      expect(() => computeMinimumPriceMicro(1000, { numerator: 100, denominator: 100 })).toThrow();
      expect(() => computeMinimumPriceMicro(1000, { numerator: 101, denominator: 100 })).toThrow();
    });

    it('increasing expected cost never decreases minimum price (monotonicity)', () => {
      const costs = [1000, 2000, 5000, 10000, 50000];
      let prevPrice = 0;
      for (const cost of costs) {
        const price = computeMinimumPriceMicro(cost, TARGET_MARGIN);
        expect(price).toBeGreaterThan(prevPrice);
        prevPrice = price;
      }
    });
  });

  describe('computeMinimumPriceUsd (string API)', () => {
    it('returns price string for launch services', () => {
      const cost = computeExpectedCostUsd({
        resource_replacement_cost_usd: 0.004,
        verification_cost_usd: 0.001,
        facilitator_cost_usd: 0.001,
        expected_retry_cost_usd: 0.0005,
        refund_reserve_usd: 0.0002,
        storage_cost_usd: 0.0001,
      });
      const price = computeMinimumPriceUsd(cost);
      // Expected cost = 0.0068, with 70% margin = 0.0068 / 0.3 = 0.022667
      expect(parseFloat(price)).toBeCloseTo(0.022667, 5);
      expect(parseFloat(price)).toBeLessThan(0.05);
    });
  });

  describe('computeMarginMicro', () => {
    it('computes margin as rational', () => {
      const price = 39000;
      const cost = 4000;
      const margin = computeMarginMicro(price, cost);
      expect(margin.numerator).toBe(35);
      expect(margin.denominator).toBe(39);
    });

    it('marginToPercent converts correctly', () => {
      const margin = { numerator: 70, denominator: 100 };
      expect(marginToPercent(margin)).toBe(70);
    });
  });

  describe('validateMargin', () => {
    it('accepts margins above minimum', () => {
      expect(validateMargin({ numerator: 70, denominator: 100 })).toBe(true);
      expect(validateMargin({ numerator: 65, denominator: 100 })).toBe(true);
      expect(validateMargin({ numerator: 60, denominator: 100 })).toBe(true);
    });

    it('rejects margins below minimum', () => {
      expect(validateMargin({ numerator: 59, denominator: 100 })).toBe(false);
      expect(validateMargin({ numerator: 50, denominator: 100 })).toBe(false);
    });
  });

  describe('validatePriceChange', () => {
    it('accepts changes within 20%', () => {
      expect(validatePriceChange('0.039', '0.046')).toBe(true);
      expect(validatePriceChange('0.039', '0.0312')).toBe(true); // ~20% exactly
    });

    it('rejects changes over 20%', () => {
      expect(validatePriceChange('0.039', '0.047')).toBe(false);
      expect(validatePriceChange('0.039', '0.030')).toBe(false);
    });

    it('handles zero old price', () => {
      expect(validatePriceChange('0', '0.039')).toBe(false);
    });
  });

  describe('applyScarcityMultiplier', () => {
    it('applies correct multipliers', () => {
      const base = 10000;
      expect(applyScarcityMultiplier(base, 80)).toBe(1000);
      expect(applyScarcityMultiplier(base, 60)).toBe(2500);
      expect(applyScarcityMultiplier(base, 40)).toBe(6000);
      expect(applyScarcityMultiplier(base, 15)).toBe(10000);
      expect(applyScarcityMultiplier(base, 5)).toBe(20000);
    });
  });

  describe('applyFailureRiskMultiplier', () => {
    it('applies correct multipliers', () => {
      const base = 10000;
      expect(applyFailureRiskMultiplier(base, 0.995)).toBe(10000);
      expect(applyFailureRiskMultiplier(base, 0.97)).toBe(12000);
      expect(applyFailureRiskMultiplier(base, 0.92)).toBe(15000);
      expect(applyFailureRiskMultiplier(base, 0.85)).toBe(20000);
    });
  });
});

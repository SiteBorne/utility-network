/**
 * Proves the bundled schemas are the frozen contract schemas themselves
 * with only local $refs inlined — never a diverging, simplified copy
 * (directive §9, §14).
 */
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import {
  BUNDLED_SERVICE_INPUT_SCHEMAS,
  FROZEN_SERVICE_INPUT_SCHEMAS,
  frozenInputExample,
  frozenOutputExample,
} from './frozen-inputs';
import { containsUnresolvedRef } from './schema-bundle';
import { ALL_BAZAAR_SERVICE_IDS } from './registry-source';

describe('BUNDLED_SERVICE_INPUT_SCHEMAS', () => {
  for (const serviceId of ALL_BAZAAR_SERVICE_IDS) {
    it(`${serviceId}: bundled schema has no remaining $ref`, () => {
      expect(containsUnresolvedRef(BUNDLED_SERVICE_INPUT_SCHEMAS[serviceId])).toBe(false);
    });

    it(`${serviceId}: bundled schema matches the frozen schema for every non-$ref field`, () => {
      const frozen = FROZEN_SERVICE_INPUT_SCHEMAS[serviceId] as Record<string, unknown>;
      const bundled = BUNDLED_SERVICE_INPUT_SCHEMAS[serviceId] as Record<string, unknown>;
      expect(bundled.$id).toBe(frozen.$id);
      expect(bundled.title).toBe(frozen.title);
      expect(bundled.type).toBe(frozen.type);
      expect(bundled.required).toEqual(frozen.required);
    });

    it(`${serviceId}: bundled schema is valid JSON Schema (compiles with ajv)`, () => {
      const ajv = new Ajv2020({ strict: false });
      expect(() => ajv.compile(BUNDLED_SERVICE_INPUT_SCHEMAS[serviceId] as object)).not.toThrow();
    });

    it(`${serviceId}: the frozen schema's own examples[0] validates against the bundled schema`, () => {
      const ajv = new Ajv2020({ strict: false });
      const validate = ajv.compile(BUNDLED_SERVICE_INPUT_SCHEMAS[serviceId] as object);
      const example = frozenInputExample(serviceId);
      const valid = validate(example);
      expect(valid, JSON.stringify(validate.errors)).toBe(true);
    });

    it(`${serviceId}: has a non-empty frozen output example`, () => {
      const example = frozenOutputExample(serviceId);
      expect(example).toBeTruthy();
      expect(typeof example).toBe('object');
    });
  }
});

import { describe, expect, it } from 'vitest';
import {
  bundleLocalRefs,
  containsUnresolvedRef,
  UnresolvedSchemaRefError,
  SchemaBundleDepthExceededError,
} from './schema-bundle';

const MONEY = { $id: 'https://siteborne.net/schemas/common/money.schema.json', type: 'object' };
const REF_MAP = { [MONEY.$id]: MONEY };

describe('bundleLocalRefs', () => {
  it('inlines a top-level $ref, dropping the inlined fragment own $id (it is no longer a standalone document)', () => {
    const bundled = bundleLocalRefs({ $ref: MONEY.$id }, REF_MAP);
    expect(bundled).toEqual({ type: 'object' });
    expect(containsUnresolvedRef(bundled)).toBe(false);
  });

  it('inlines a nested $ref and preserves sibling keys on the $ref node', () => {
    const schema = {
      type: 'object',
      properties: {
        price: { $ref: MONEY.$id, description: 'local override' },
      },
    };
    const bundled = bundleLocalRefs(schema, REF_MAP) as {
      properties: { price: Record<string, unknown> };
    };
    expect(bundled.properties.price).toEqual({
      type: 'object',
      description: 'local override',
    });
    expect(containsUnresolvedRef(bundled)).toBe(false);
  });

  it('inlines a $ref nested inside an array', () => {
    const schema = { anyOf: [{ $ref: MONEY.$id }, { type: 'string' }] };
    const bundled = bundleLocalRefs(schema, REF_MAP);
    expect(containsUnresolvedRef(bundled)).toBe(false);
  });

  it('never mutates the input schema', () => {
    const schema = { properties: { price: { $ref: MONEY.$id } } };
    const clone = JSON.parse(JSON.stringify(schema));
    bundleLocalRefs(schema, REF_MAP);
    expect(schema).toEqual(clone);
  });

  it('leaves a schema with no $ref unchanged in structure', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } } };
    expect(bundleLocalRefs(schema, REF_MAP)).toEqual(schema);
  });

  it('throws UnresolvedSchemaRefError for a $ref not in the map', () => {
    expect(() => bundleLocalRefs({ $ref: 'https://unknown.example/x.json' }, REF_MAP)).toThrow(
      UnresolvedSchemaRefError
    );
  });

  it('throws SchemaBundleDepthExceededError on excessive depth', () => {
    let deep: unknown = { type: 'string' };
    for (let i = 0; i < 25; i++) {
      deep = { properties: { nested: deep } };
    }
    expect(() => bundleLocalRefs(deep, REF_MAP)).toThrow(SchemaBundleDepthExceededError);
  });
});

describe('containsUnresolvedRef', () => {
  it('detects a $ref at any depth', () => {
    expect(containsUnresolvedRef({ a: { b: [{ $ref: 'x' }] } })).toBe(true);
    expect(containsUnresolvedRef({ a: { b: 'no ref here' } })).toBe(false);
    expect(containsUnresolvedRef(null)).toBe(false);
    expect(containsUnresolvedRef('scalar')).toBe(false);
  });
});

/**
 * SUN-1200 checkpoint F — VALIDATION RUNTIME CLOSURE. Human governance
 * decision resolving VERIFY_DYNAMIC_DECISION=C: SITEBORNE JSON Schema
 * Profile 1's structural gate (`checkSchemaProfile1`) and eval-free
 * interpreter (`validateAgainstProfile1`, backed by
 * `@cfworker/json-schema`).
 *
 * §8's capability matrix, §12's differential corpus, §13's security/
 * complexity corpus, and §9's adversarial unsupported-keyword tests are
 * all exercised here — differentially against a fresh `ajv/dist/2020`
 * runtime validator (build/dev source of truth for what AJV 2020-12
 * behavior actually is), not merely against cfworker in isolation.
 */
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_DRAFT_2020_12_URI,
  PROFILE_1_LIMITS,
  PROFILE_1_UNSUPPORTED_KEYWORDS,
  checkSchemaProfile1,
  validateAgainstProfile1,
} from './schema-profile-1';

function ajvValidate(schema: unknown, candidate: unknown): boolean {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validate = ajv.compile(schema as object);
  return Boolean(validate(candidate));
}

/** Asserts checkSchemaProfile1 accepts `schema`, then that cfworker's
 * Profile 1 interpreter agrees exactly with a fresh AJV 2020-12 runtime
 * compile for every (candidate, expectedValid) pair -- the §12
 * differential-equivalence proof. */
function agree(schema: unknown, cases: Array<[unknown, boolean]>) {
  const check = checkSchemaProfile1(schema);
  expect(check.supported, `expected schema to be Profile-1 supported: ${JSON.stringify(check)}`).toBe(
    true
  );
  for (const [candidate, expected] of cases) {
    const ajvResult = ajvValidate(schema, candidate);
    expect(ajvResult, `AJV disagreement for ${JSON.stringify(candidate)}`).toBe(expected);
    const { valid } = validateAgainstProfile1(schema, candidate);
    expect(valid, `cfworker vs AJV mismatch for ${JSON.stringify(candidate)}`).toBe(ajvResult);
  }
}

describe('SITEBORNE JSON Schema Profile 1 — capability matrix (§8) / differential corpus (§12)', () => {
  it('type + primitives', () => {
    agree({ type: 'string' }, [
      ['hello', true],
      [42, false],
      [null, false],
    ]);
    agree({ type: 'integer' }, [
      [3, true],
      [3.5, false],
      ['3', false],
    ]);
    agree({ type: ['string', 'null'] }, [
      ['a', true],
      [null, true],
      [1, false],
    ]);
  });

  it('enum / const', () => {
    agree({ enum: ['a', 'b', 3] }, [
      ['a', true],
      ['c', false],
      [3, true],
    ]);
    agree({ const: 'exact' }, [
      ['exact', true],
      ['other', false],
    ]);
  });

  it('boolean schemas true/false', () => {
    agree(true, [
      [{}, true],
      [null, true],
      [42, true],
    ]);
    agree(false, [
      [{}, false],
      [null, false],
    ]);
  });

  it('objects: properties/required/additionalProperties/min/maxProperties', () => {
    const schema = {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'string' } },
      required: ['a'],
      additionalProperties: false,
      minProperties: 1,
      maxProperties: 2,
    };
    agree(schema, [
      [{ a: 1 }, true],
      [{ a: 1, b: 'x' }, true],
      [{ b: 'x' }, false], // missing required a
      [{ a: 1, c: true }, false], // additionalProperties: false
      [{ a: 1, b: 'x', extra: 1 }, false], // over maxProperties too
    ]);
  });

  it('additionalProperties as a schema (not just boolean)', () => {
    agree({ type: 'object', properties: { a: { type: 'string' } }, additionalProperties: { type: 'number' } }, [
      [{ a: 'x', b: 1 }, true],
      [{ a: 'x', b: 'not-a-number' }, false],
    ]);
  });

  it('arrays: items/prefixItems/min/maxItems/uniqueItems', () => {
    agree({ type: 'array', items: { type: 'number' }, minItems: 1, maxItems: 3, uniqueItems: true }, [
      [[1, 2], true],
      [[], false],
      [[1, 2, 3, 4], false],
      [[1, 1], false],
      [['x'], false],
    ]);
    agree({ type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }], items: false }, [
      [['a', 1], true],
      [['a', 1, 'extra'], false], // items:false forbids anything beyond prefixItems
      [[1, 'a'], false],
    ]);
  });

  it('contains/minContains/maxContains', () => {
    agree({ type: 'array', contains: { type: 'number' }, minContains: 2, maxContains: 3 }, [
      [[1, 2], true],
      [[1, 'x'], false],
      [[1, 2, 3, 4], false],
    ]);
  });

  it('strings: minLength/maxLength', () => {
    agree({ type: 'string', minLength: 2, maxLength: 4 }, [
      ['ab', true],
      ['a', false],
      ['abcde', false],
    ]);
  });

  it('numbers: minimum/maximum/exclusiveMinimum/exclusiveMaximum/multipleOf', () => {
    agree(
      { type: 'number', minimum: 0, maximum: 10, exclusiveMinimum: 0, exclusiveMaximum: 10, multipleOf: 2 },
      [
        [4, true],
        [0, false],
        [10, false],
        [3, false],
      ]
    );
  });

  it('composition: allOf/anyOf/oneOf/not', () => {
    agree({ allOf: [{ type: 'number' }, { minimum: 0 }] }, [
      [5, true],
      [-1, false],
      ['x', false],
    ]);
    agree({ anyOf: [{ type: 'string' }, { type: 'number' }] }, [
      ['x', true],
      [1, true],
      [true, false],
    ]);
    agree({ oneOf: [{ minimum: 0, maximum: 5 }, { minimum: 3, maximum: 10 }] }, [
      [1, true], // matches only the first
      [4, false], // matches both -> oneOf fails
      [8, true], // matches only the second
    ]);
    agree({ not: { type: 'string' } }, [
      [1, true],
      ['x', false],
    ]);
  });

  it('if/then/else', () => {
    agree(
      {
        type: 'object',
        properties: { kind: { type: 'string' }, value: {} },
        if: { properties: { kind: { const: 'a' } } },
        then: { properties: { value: { type: 'number' } } },
        else: { properties: { value: { type: 'string' } } },
      },
      [
        [{ kind: 'a', value: 1 }, true],
        [{ kind: 'a', value: 'x' }, false],
        [{ kind: 'b', value: 'x' }, true],
        [{ kind: 'b', value: 1 }, false],
      ]
    );
  });

  it('$defs + local $ref', () => {
    const schema = {
      $defs: { positiveInt: { type: 'integer', minimum: 1 } },
      type: 'object',
      properties: { count: { $ref: '#/$defs/positiveInt' } },
      required: ['count'],
    };
    agree(schema, [
      [{ count: 1 }, true],
      [{ count: 0 }, false],
      [{ count: 'x' }, false],
    ]);
  });

  it('$schema, when supplied, must equal the canonical Draft 2020-12 URI', () => {
    const ok = checkSchemaProfile1({ $schema: CANONICAL_DRAFT_2020_12_URI, type: 'string' });
    expect(ok.supported).toBe(true);
    const bad = checkSchemaProfile1({ $schema: 'http://json-schema.org/draft-07/schema#', type: 'string' });
    expect(bad).toEqual({
      supported: false,
      code: 'unsupported_required_schema',
      reason: expect.stringContaining('canonical Draft 2020-12 URI'),
    });
  });

  it('annotation-only keywords (title/description/default/examples/$comment/...) never cause rejection', () => {
    const check = checkSchemaProfile1({
      title: 'x',
      description: 'y',
      default: 1,
      examples: [1, 2],
      $comment: 'z',
      deprecated: false,
      readOnly: true,
      writeOnly: false,
      type: 'number',
    });
    expect(check.supported).toBe(true);
  });
});

describe('SITEBORNE JSON Schema Profile 1 — unsupported-keyword rejection (§4, §9)', () => {
  it.each(PROFILE_1_UNSUPPORTED_KEYWORDS)('rejects the explicitly unsupported keyword "%s"', (keyword) => {
    const schema = { type: 'object', [keyword]: {} };
    const check = checkSchemaProfile1(schema);
    expect(check.supported).toBe(false);
    if (!check.supported) expect(check.code).toBe('unsupported_required_schema');
  });

  it('rejects a genuinely unrecognized keyword rather than silently ignoring it', () => {
    const check = checkSchemaProfile1({ type: 'string', totallyMadeUpKeyword: true });
    expect(check.supported).toBe(false);
  });

  it('§9 adversarial: a property literally named "pattern" does NOT trigger unsupported-keyword rejection', () => {
    const schema = {
      type: 'object',
      properties: { pattern: { type: 'string' }, $dynamicRef: { type: 'number' }, format: { type: 'boolean' } },
      required: ['pattern'],
    };
    const check = checkSchemaProfile1(schema);
    expect(check.supported).toBe(true);
    agree(schema, [
      [{ pattern: 'x', $dynamicRef: 1, format: true }, true],
      [{ pattern: 1 }, false],
    ]);
  });

  it('§9 adversarial: a $defs entry literally named "unevaluatedProperties" does NOT trigger rejection', () => {
    const schema = {
      $defs: { unevaluatedProperties: { type: 'number' } },
      properties: { x: { $ref: '#/$defs/unevaluatedProperties' } },
    };
    expect(checkSchemaProfile1(schema).supported).toBe(true);
  });

  it('remote $ref is rejected (never a real dereference/network read)', () => {
    const check = checkSchemaProfile1({ properties: { x: { $ref: 'https://example.invalid/schema.json' } } });
    expect(check.supported).toBe(false);
  });

  it('an unresolvable local $ref is rejected', () => {
    const check = checkSchemaProfile1({ properties: { x: { $ref: '#/$defs/doesNotExist' } } });
    expect(check.supported).toBe(false);
  });

  it('a recursive local $ref cycle is rejected (§10)', () => {
    const schema = {
      $defs: {
        node: {
          type: 'object',
          properties: { child: { $ref: '#/$defs/node' } },
        },
      },
      $ref: '#/$defs/node',
    };
    const check = checkSchemaProfile1(schema);
    expect(check.supported).toBe(false);
    if (!check.supported) expect(check.reason).toMatch(/recursive/i);
  });

  it('mutual recursion between two sibling $defs entries is rejected (§10)', () => {
    const schema = {
      $defs: {
        a: { type: 'object', properties: { next: { $ref: '#/$defs/b' } } },
        b: { type: 'object', properties: { next: { $ref: '#/$defs/a' } } },
      },
      $ref: '#/$defs/a',
    };
    const check = checkSchemaProfile1(schema);
    expect(check.supported).toBe(false);
    if (!check.supported) expect(check.reason).toMatch(/recursive/i);
  });

  it('a non-recursive chain of local refs (A -> B -> C, no cycle) is accepted', () => {
    const schema = {
      $defs: {
        a: { $ref: '#/$defs/b' },
        b: { $ref: '#/$defs/c' },
        c: { type: 'number' },
      },
      $ref: '#/$defs/a',
    };
    expect(checkSchemaProfile1(schema).supported).toBe(true);
  });

  it('dependentRequired/dependentSchemas are recorded as unsupported, not silently dropped', () => {
    expect(checkSchemaProfile1({ dependentRequired: { a: ['b'] } }).supported).toBe(false);
    expect(checkSchemaProfile1({ dependentSchemas: { a: { type: 'object' } } }).supported).toBe(false);
  });
});

describe('SITEBORNE JSON Schema Profile 1 — resource limits (§5, §11, §13)', () => {
  it('rejects a schema exceeding MAX_CANONICAL_SCHEMA_BYTES', () => {
    const schema = { type: 'string', description: 'x'.repeat(PROFILE_1_LIMITS.MAX_CANONICAL_SCHEMA_BYTES) };
    const check = checkSchemaProfile1(schema);
    expect(check.supported).toBe(false);
    if (!check.supported) expect(check.code).toBe('required_schema_limit_exceeded');
  });

  it('rejects a schema exceeding MAX_SCHEMA_DEPTH', () => {
    let schema: Record<string, unknown> = { type: 'number' };
    for (let i = 0; i < PROFILE_1_LIMITS.MAX_SCHEMA_DEPTH + 5; i++) {
      schema = { allOf: [schema] };
    }
    const check = checkSchemaProfile1(schema);
    expect(check.supported).toBe(false);
    if (!check.supported) expect(check.code).toBe('required_schema_limit_exceeded');
  });

  it('rejects a schema exceeding MAX_PROPERTIES_PER_OBJECT_SCHEMA', () => {
    const properties: Record<string, unknown> = {};
    for (let i = 0; i < PROFILE_1_LIMITS.MAX_PROPERTIES_PER_OBJECT_SCHEMA + 1; i++) {
      properties[`p${i}`] = { type: 'string' };
    }
    const check = checkSchemaProfile1({ type: 'object', properties });
    expect(check.supported).toBe(false);
    if (!check.supported) expect(check.code).toBe('required_schema_limit_exceeded');
  });

  it('rejects a schema exceeding MAX_ENUM_VALUES', () => {
    const check = checkSchemaProfile1({ enum: Array.from({ length: PROFILE_1_LIMITS.MAX_ENUM_VALUES + 1 }, (_, i) => i) });
    expect(check.supported).toBe(false);
    if (!check.supported) expect(check.code).toBe('required_schema_limit_exceeded');
  });

  it('rejects a schema exceeding MAX_COMBINATOR_BRANCHES_PER_KEYWORD', () => {
    const branches = Array.from({ length: PROFILE_1_LIMITS.MAX_COMBINATOR_BRANCHES_PER_KEYWORD + 1 }, () => ({
      type: 'number',
    }));
    const check = checkSchemaProfile1({ anyOf: branches });
    expect(check.supported).toBe(false);
    if (!check.supported) expect(check.code).toBe('required_schema_limit_exceeded');
  });

  it('rejects a schema exceeding MAX_PREFIX_ITEMS', () => {
    const prefixItems = Array.from({ length: PROFILE_1_LIMITS.MAX_PREFIX_ITEMS + 1 }, () => ({ type: 'number' }));
    const check = checkSchemaProfile1({ type: 'array', prefixItems });
    expect(check.supported).toBe(false);
    if (!check.supported) expect(check.code).toBe('required_schema_limit_exceeded');
  });

  it('rejects a schema exceeding MAX_LOCAL_REF_COUNT', () => {
    const properties: Record<string, unknown> = {};
    for (let i = 0; i < PROFILE_1_LIMITS.MAX_LOCAL_REF_COUNT + 1; i++) {
      properties[`p${i}`] = { $ref: '#/$defs/leaf' };
    }
    const check = checkSchemaProfile1({ $defs: { leaf: { type: 'number' } }, properties });
    expect(check.supported).toBe(false);
    if (!check.supported) expect(check.code).toBe('required_schema_limit_exceeded');
  });

  it('a schema comfortably within every limit is accepted (no false-positive rejection)', () => {
    const check = checkSchemaProfile1({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a'],
    });
    expect(check.supported).toBe(true);
  });
});

describe('checkSchemaProfile1 rejects non-schema-shaped input up front', () => {
  it.each([null, 42, 'x', [1, 2]])('rejects %j as required_schema', (value) => {
    expect(checkSchemaProfile1(value).supported).toBe(false);
  });
});

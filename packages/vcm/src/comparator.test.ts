import { describe, expect, it } from 'vitest';
import {
  classifyDifference,
  compareProjections,
  summarizeDifferences,
  unexplainedDifferences,
} from './comparator';

describe('classifyDifference', () => {
  it('classifies equal leaves as EXACT_MATCH', () => {
    expect(
      classifyDifference('name', 'siteborne_get_quote', 'siteborne_get_quote').classification
    ).toBe('EXACT_MATCH');
  });

  it('classifies a normalized-equal pair as NORMALIZED_MATCH and preserves the raw values', () => {
    const result = classifyDifference(
      'id',
      'Company_Evidence_Graph.V2',
      'company_evidence_graph.v2',
      {
        normalizations: [{ pathPattern: /^id$/, normalize: (v) => String(v).toLowerCase() }],
      }
    );
    expect(result.classification).toBe('NORMALIZED_MATCH');
    expect(result.expected).toBe('Company_Evidence_Graph.V2');
    expect(result.actual).toBe('company_evidence_graph.v2');
  });

  it('classifies a governed-difference path as EXPECTED_VOLATILE_DIFFERENCE when accepted', () => {
    const result = classifyDifference('signatures[0].signature', 'sig-a', 'sig-b', {
      governedDifferences: [
        {
          pathPattern: /^signatures\[\d+\]\.signature$/,
          classification: 'EXPECTED_VOLATILE_DIFFERENCE',
          reason: 'nondeterministic key material under test fixtures',
        },
      ],
    });
    expect(result.classification).toBe('EXPECTED_VOLATILE_DIFFERENCE');
    expect(result.reason).toMatch(/nondeterministic/);
  });

  it('does not apply a governed rule whose accepts() predicate rejects the actual values', () => {
    const result = classifyDifference('tools.count', 6, 7, {
      governedDifferences: [
        {
          pathPattern: /^tools\.count$/,
          classification: 'INTENTIONAL_GOVERNED_DIFFERENCE',
          reason: 'only a +/-0 rename is governed',
          accepts: (expected, actual) => expected === actual,
        },
      ],
    });
    expect(result.classification).toBe('UNEXPLAINED_DIFFERENCE');
  });

  it('classifies an unmatched, unruled difference as UNEXPLAINED_DIFFERENCE', () => {
    expect(classifyDifference('description', 'a', 'b').classification).toBe(
      'UNEXPLAINED_DIFFERENCE'
    );
  });

  it('treats a value present only on one side as a difference, not a silent match', () => {
    const missingActual = classifyDifference('extraField', 'present', undefined as never);
    expect(missingActual.classification).toBe('UNEXPLAINED_DIFFERENCE');
  });
});

describe('compareProjections -- structural leaf comparison', () => {
  it('is order-insensitive for object keys', () => {
    const expected = { a: 1, b: 2 };
    const actual = { b: 2, a: 1 };
    const differences = compareProjections(expected, actual);
    expect(unexplainedDifferences(differences)).toEqual([]);
  });

  it('is order-sensitive for arrays: a reordered array element is a real difference', () => {
    const expected = { skills: [{ id: 'a' }, { id: 'b' }] };
    const actual = { skills: [{ id: 'b' }, { id: 'a' }] };
    const differences = compareProjections(expected, actual);
    expect(
      unexplainedDifferences(differences)
        .map((d) => d.path)
        .sort()
    ).toEqual(['skills[0].id', 'skills[1].id']);
  });

  it('detects a missing array element (fewer skills on the actual side)', () => {
    const expected = { skills: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
    const actual = { skills: [{ id: 'a' }, { id: 'b' }] };
    const differences = unexplainedDifferences(compareProjections(expected, actual));
    expect(differences.map((d) => d.path)).toEqual(['skills[2].id']);
  });

  it('detects an extra array element (more skills on the actual side)', () => {
    const expected = { skills: [{ id: 'a' }] };
    const actual = { skills: [{ id: 'a' }, { id: 'b' }] };
    const differences = unexplainedDifferences(compareProjections(expected, actual));
    expect(differences.map((d) => d.path)).toEqual(['skills[1].id']);
  });

  it('detects a changed nested schema property deep inside an object tree', () => {
    const expected = {
      tools: {
        siteborne_get_quote: { inputSchema: { properties: { service_id: { type: 'string' } } } },
      },
    };
    const actual = {
      tools: {
        siteborne_get_quote: { inputSchema: { properties: { service_id: { type: 'number' } } } },
      },
    };
    const differences = unexplainedDifferences(compareProjections(expected, actual));
    expect(differences.map((d) => d.path)).toEqual([
      'tools.siteborne_get_quote.inputSchema.properties.service_id.type',
    ]);
  });

  it('produces zero unexplained differences for byte-identical structures', () => {
    const value = { skills: [{ id: 'a', tags: ['x', 'y'] }] };
    const differences = compareProjections(value, JSON.parse(JSON.stringify(value)));
    expect(unexplainedDifferences(differences)).toEqual([]);
    const summary = summarizeDifferences(differences);
    expect(summary.UNEXPLAINED_DIFFERENCE).toBe(0);
    expect(summary.EXACT_MATCH).toBeGreaterThan(0);
  });

  it('summarizes every classification class with an accurate count', () => {
    const differences = compareProjections(
      { a: 1, b: 'x', c: 'volatile-1' },
      { a: 1, b: 'y', c: 'volatile-2' },
      {
        governedDifferences: [
          {
            pathPattern: /^c$/,
            classification: 'EXPECTED_VOLATILE_DIFFERENCE',
            reason: 'test',
          },
        ],
      }
    );
    const summary = summarizeDifferences(differences);
    expect(summary).toEqual({
      EXACT_MATCH: 1,
      NORMALIZED_MATCH: 0,
      EXPECTED_VOLATILE_DIFFERENCE: 1,
      INTENTIONAL_GOVERNED_DIFFERENCE: 0,
      UNEXPLAINED_DIFFERENCE: 1,
    });
  });
});

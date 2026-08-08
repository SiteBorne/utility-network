import { describe, expect, it } from 'vitest';
import {
  classifyDrift,
  compareSchemas,
  computeShapeHash,
  detectDrift,
  inferSchema,
  summarizeChanges,
} from './index';
import type { DriftChangeType, ShapeSchema } from './types';

const baseSchema: ShapeSchema = {
  type: 'object',
  required: ['cik', 'entityName'],
  properties: {
    cik: { type: 'string', format: 'identifier' },
    entityName: { type: 'string' },
    tickers: { type: 'array', items: { type: 'string' }, maxItems: 20 },
    filed: { type: 'string', format: 'timestamp' },
  },
};

function expectChangeType(
  result: { changes: Array<{ type: string }> },
  type: DriftChangeType
): void {
  expect(result.changes.some((c) => c.type === type)).toBe(true);
}

describe('drift detection — change type coverage', () => {
  it('detects optional field added (safe)', () => {
    const observed = inferSchema({
      ...BASE_DATA,
      newOptionalField: 'value',
    }).schema;
    const changes = compareSchemas(baseSchema, observed, '', {
      allowOptionalAdditions: false,
      requireAllFields: false,
    });
    expectChangeType({ changes }, 'optional_field_added');
    expect(changes.some((c) => c.severity === 'safe' && c.type === 'optional_field_added')).toBe(
      true
    );
  });

  it('detects required field missing (unsafe → source_changed)', () => {
    const observed = inferSchema({ cik: '0000320193' }).schema;
    const changes = compareSchemas(baseSchema, observed);
    expectChangeType({ changes }, 'required_field_missing');
    const { classification, resultClass } = classifyDrift(changes);
    expect(classification).toBe('source_changed');
    expect(resultClass).toBe('source_changed');
  });

  it('detects field type changed', () => {
    const observed = inferSchema({
      cik: '0000320193',
      entityName: 12345,
    }).schema;
    const changes = compareSchemas(baseSchema, observed);
    expectChangeType({ changes }, 'field_type_changed');
  });

  it('detects array vs object change (quarantine)', () => {
    const observed: ShapeSchema = { type: 'object', properties: { cik: { type: 'string' } } };
    const changes = compareSchemas({ type: 'array', items: { type: 'string' } }, observed);
    expectChangeType({ changes }, 'array_vs_object_changed');
    expect(changes[0].severity).toBe('quarantine');
  });

  it('detects enum value changed', () => {
    const expected: ShapeSchema = {
      type: 'string',
      enum: ['10-K', '10-Q', '8-K'],
    };
    const observed: ShapeSchema = {
      type: 'string',
      enum: ['10-K', '20-F'],
    };
    const changes = compareSchemas(expected, observed);
    expectChangeType({ changes }, 'enum_value_changed');
  });

  it('detects pagination shape change', () => {
    const expected: ShapeSchema = {
      type: 'object',
      properties: {
        results: { type: 'array', items: { type: 'string' } },
        next_cursor: { type: 'string' },
      },
    };
    const observed = inferSchema({
      results: ['a', 'b'],
      next_page: 'page=2',
    }).schema;
    const changes = compareSchemas(expected, observed);
    expectChangeType({ changes }, 'pagination_shape_changed');
  });

  it('detects identifier format change', () => {
    const expected: ShapeSchema = { type: 'string', format: 'identifier' };
    const observed: ShapeSchema = { type: 'string', format: 'timestamp' };
    const changes = compareSchemas(expected, observed, 'cik');
    expectChangeType({ changes }, 'identifier_format_changed');
  });

  it('detects timestamp format change', () => {
    const expected: ShapeSchema = { type: 'string', format: 'timestamp' };
    const observed: ShapeSchema = { type: 'string', format: 'identifier' };
    const changes = compareSchemas(expected, observed, 'filed');
    expectChangeType({ changes }, 'timestamp_format_changed');
  });

  it('detects unexpected wrapper', () => {
    const observed = inferSchema({
      data: { cik: '0000320193', entityName: 'ACME' },
    }).schema;
    const expectedCompact: ShapeSchema = {
      type: 'object',
      properties: {
        cik: { type: 'string', format: 'identifier' },
        entityName: { type: 'string' },
      },
    };
    const changes = compareSchemas(expectedCompact, observed);
    expectChangeType({ changes }, 'unexpected_wrapper');
  });

  it('detects removed wrapper', () => {
    const changes = compareSchemas(
      { type: 'object', properties: { cik: { type: 'string' } } },
      { type: 'object' }
    );
    expectChangeType({ changes }, 'removed_wrapper');
  });

  it('detects excessive nesting (quarantine)', () => {
    const observed: ShapeSchema = { type: 'object', maxDepth: 99 };
    const changes = compareSchemas({ type: 'object' }, observed, '', {
      allowOptionalAdditions: false,
      requireAllFields: false,
      maxNestingDepth: 32,
    });
    expectChangeType({ changes }, 'excessive_nesting');
    expect(changes[0].severity).toBe('quarantine');
  });

  it('detects result item shape change (count exceeds bound)', () => {
    const observed: ShapeSchema = { type: 'array', maxItems: 5000 };
    const changes = compareSchemas({ type: 'array', maxItems: 100 }, observed, '', {
      allowOptionalAdditions: false,
      requireAllFields: false,
      maxResultItems: 100,
    });
    expectChangeType({ changes }, 'result_item_shape_changed');
  });

  it('detects content_type change via detectDrift', () => {
    const result = detectDrift({
      providerId: 'sec-edgar',
      capability: 'company_submissions',
      expectedSchema: baseSchema,
      observedData: BASE_DATA,
      expectedShapeHash: 'h1',
      expectedMediaType: 'application/json',
      observedMediaType: 'text/html',
    });
    expectChangeType(result, 'content_type_changed');
  });
});

describe('drift classification invariants', () => {
  it('safe optional additions may continue only when policy permits', () => {
    const observed = inferSchema({ ...BASE_DATA, extra: 'x' }).schema;
    const changes = compareSchemas(baseSchema, observed);

    const blocked = classifyDrift(changes, {
      allowOptionalAdditions: false,
      requireAllFields: false,
    });
    expect(blocked.classification).toBe('source_changed');

    const allowed = classifyDrift(changes, {
      allowOptionalAdditions: true,
      requireAllFields: false,
    });
    expect(allowed.classification).toBe('continue');
  });

  it('drift result_class is never not_found or verified_absent_candidate', () => {
    const cases: Array<{ changes: Array<{ severity: 'safe' | 'unsafe' | 'quarantine' }> }> = [
      { changes: [{ severity: 'safe' }] },
      { changes: [{ severity: 'unsafe' }] },
      { changes: [{ severity: 'quarantine' }] },
      { changes: [] },
    ];
    const forbidden = new Set(['not_found', 'verified_absent_candidate']);
    for (const c of cases) {
      const { resultClass } = classifyDrift(c.changes as never, {
        allowOptionalAdditions: false,
        requireAllFields: false,
      });
      expect(forbidden.has(resultClass)).toBe(false);
      expect(['source_changed', 'quarantined']).toContain(resultClass);
    }
  });

  it('emits an auditable review event with provider/capability and timestamp', () => {
    const result = detectDrift({
      providerId: 'openalex',
      capability: 'openalex_work',
      expectedSchema: { type: 'object' },
      observedData: { a: 1 },
      expectedShapeHash: 'x',
    });
    expect(result.audit_event.event_type).toBe('source_drift_detected');
    expect(result.audit_event.provider_id).toBe('openalex');
    expect(result.audit_event.capability).toBe('openalex_work');
    expect(result.audit_event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.review_required).toBe(true);
  });

  it('shape hashes are stable for identical shapes', () => {
    expect(computeShapeHash(baseSchema)).toBe(computeShapeHash(baseSchema));
  });
});

describe('summarizeChanges', () => {
  it('reports "No drift detected" when empty', () => {
    expect(summarizeChanges([])).toBe('No drift detected');
  });
  it('counts severities and lists types', () => {
    const summary = summarizeChanges([
      { type: 'optional_field_added', path: '', severity: 'safe', description: '' },
      { type: 'required_field_missing', path: '', severity: 'unsafe', description: '' },
    ]);
    expect(summary).toContain('1 unsafe');
    expect(summary).toContain('1 safe');
    expect(summary).toContain('optional_field_added');
    expect(summary).toContain('required_field_missing');
  });
});

const BASE_DATA = {
  cik: '0000320193',
  entityName: 'Apple Inc.',
  tickers: ['AAPL'],
  filed: '2024-01-05T10:00:00Z',
};

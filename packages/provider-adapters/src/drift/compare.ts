import type { DriftChange, DriftPolicy, ShapeSchema } from './types';

export function compareSchemas(
  expected: ShapeSchema,
  observed: ShapeSchema,
  path = '',
  policy: DriftPolicy = { allowOptionalAdditions: false, requireAllFields: false }
): DriftChange[] {
  const changes: DriftChange[] = [];

  if (expected.type !== observed.type) {
    if (
      (expected.type === 'array' && observed.type === 'object') ||
      (expected.type === 'object' && observed.type === 'array')
    ) {
      changes.push({
        type: 'array_vs_object_changed',
        path,
        expected: expected.type,
        observed: observed.type,
        severity: 'quarantine',
        description: `Container shape changed from ${expected.type} to ${observed.type} at ${path || '<root>'}`,
      });
    } else {
      changes.push({
        type: 'field_type_changed',
        path,
        expected: expected.type,
        observed: observed.type,
        severity: 'unsafe',
        description: `Type changed from ${expected.type} to ${observed.type} at ${path || '<root>'}`,
      });
    }
    return changes;
  }

  if (expected.type === 'object' && expected.properties && observed.properties) {
    detectWrapperChanges(expected, observed, path, changes);
    detectFieldPresence(expected, observed, path, policy, changes);
    detectFieldTypes(expected, observed, path, policy, changes);
    if (path === '' && looksLikePaginatedPayload(expected, observed)) {
      detectRootPaginationChange(expected, observed, changes);
    }
  } else if (expected.type === 'object' && expected.properties && !observed.properties) {
    changes.push({
      type: 'removed_wrapper',
      path,
      expected: 'object with fields',
      observed: observed.type,
      severity: 'unsafe',
      description: `Expected object wrapper missing at ${path || '<root>'}`,
    });
  }

  if (expected.type === 'array' && observed.type === 'array') {
    detectArrayShape(expected, observed, path, policy, changes);
  }

  detectEnumChange(expected, observed, path, changes);
  detectFormatChanges(expected, observed, path, changes);
  detectNesting(expected, observed, path, policy, changes);
  detectResultItemShape(expected, observed, path, policy, changes);

  return changes;
}

function detectFieldPresence(
  expected: ShapeSchema,
  observed: ShapeSchema,
  path: string,
  policy: DriftPolicy,
  changes: DriftChange[]
): void {
  const expProps = expected.properties || {};
  const obsProps = observed.properties || {};
  const expRequired = new Set(expected.required || []);

  for (const key of Object.keys(obsProps)) {
    if (!expProps[key]) {
      changes.push({
        type: 'optional_field_added',
        path: path ? `${path}.${key}` : key,
        expected: undefined,
        observed: obsProps[key],
        severity: 'safe',
        description: `Optional field "${key}" added at ${path || '<root>'}`,
      });
    }
  }

  for (const key of Object.keys(expProps)) {
    const newPath = path ? `${path}.${key}` : key;
    if (!obsProps[key]) {
      if (expRequired.has(key) || policy.requireAllFields) {
        changes.push({
          type: 'required_field_missing',
          path: newPath,
          expected: expProps[key],
          observed: undefined,
          severity: 'unsafe',
          description: `Required field "${key}" missing at ${path || '<root>'}`,
        });
      }
    }
  }
}

function detectFieldTypes(
  expected: ShapeSchema,
  observed: ShapeSchema,
  path: string,
  _policy: DriftPolicy,
  changes: DriftChange[]
): void {
  const expProps = expected.properties || {};
  const obsProps = observed.properties || {};
  for (const key of Object.keys(expProps)) {
    if (!obsProps[key]) continue;
    const newPath = path ? `${path}.${key}` : key;
    changes.push(...compareSchemas(expProps[key], obsProps[key], newPath, _policy));
  }
}

function detectWrapperChanges(
  expected: ShapeSchema,
  observed: ShapeSchema,
  path: string,
  changes: DriftChange[]
): void {
  const expKeys = new Set(Object.keys(expected.properties || {}));
  const obsKeys = new Set(Object.keys(observed.properties || {}));
  const intersection = [...expKeys].filter((k) => obsKeys.has(k));
  const WRAPPER_NAMES = ['data', 'results', 'result', 'response', 'item'];

  const observedIsSingleWrapper =
    obsKeys.size === 1 && [...obsKeys].every((k) => WRAPPER_NAMES.includes(k));
  if (observedIsSingleWrapper && expKeys.size > 1 && !expKeys.has([...obsKeys][0])) {
    changes.push({
      type: 'unexpected_wrapper',
      path: path || '<root>',
      expected: [...expKeys].slice(0, 5).join(','),
      observed: [...obsKeys].join(','),
      severity: 'unsafe',
      description: `Payload wrapped under "${[...obsKeys][0]}" at ${path || '<root>'}`,
    });
    return;
  }

  if (intersection.length === 0) {
    changes.push({
      type: 'unexpected_wrapper',
      path: path || '<root>',
      expected: [...expKeys].slice(0, 5).join(','),
      observed: [...obsKeys].slice(0, 5).join(','),
      severity: 'quarantine',
      description: `No field overlap at ${path || '<root>'}; unexpected wrapper or wrong payload`,
    });
    return;
  }

  const expectedSingular = expKeys.size <= 3 && intersection.length > 0;
  const observedWrapped =
    obsKeys.size === 1 && [...obsKeys].every((k) => WRAPPER_NAMES.includes(k));
  if (expectedSingular && observedWrapped && !expKeys.has([...obsKeys][0])) {
    changes.push({
      type: 'unexpected_wrapper',
      path: path || '<root>',
      expected: [...expKeys].join(','),
      observed: [...obsKeys].join(','),
      severity: 'unsafe',
      description: `Payload wrapped under "${[...obsKeys][0]}" at ${path || '<root>'}`,
    });
  }
}

function detectArrayShape(
  expected: ShapeSchema,
  observed: ShapeSchema,
  path: string,
  policy: DriftPolicy,
  changes: DriftChange[]
): void {
  if (expected.items && observed.items) {
    changes.push(...compareSchemas(expected.items, observed.items, `${path}[]`, policy));
  }
  if (expected.maxItems !== undefined && observed.maxItems !== undefined) {
    if (observed.maxItems > expected.maxItems * 2) {
      changes.push({
        type: 'result_item_shape_changed',
        path,
        expected: expected.maxItems,
        observed: observed.maxItems,
        severity: 'unsafe',
        description: `Array length ${observed.maxItems} significantly exceeds expected ${expected.maxItems} at ${path || '<root>'}`,
      });
    }
  }
}

function detectEnumChange(
  expected: ShapeSchema,
  observed: ShapeSchema,
  path: string,
  changes: DriftChange[]
): void {
  if (!expected.enum || !observed.enum) return;
  const expEnum = new Set(expected.enum.map(String));
  const obsEnum = new Set(observed.enum.map(String));
  for (const val of expEnum) {
    if (!obsEnum.has(val)) {
      changes.push({
        type: 'enum_value_changed',
        path: path || '<root>',
        expected: val,
        observed: undefined,
        severity: 'unsafe',
        description: `Enum value "${val}" removed at ${path || '<root>'}`,
      });
    }
  }
  for (const val of obsEnum) {
    if (!expEnum.has(val)) {
      changes.push({
        type: 'enum_value_changed',
        path: path || '<root>',
        expected: undefined,
        observed: val,
        severity: 'unsafe',
        description: `Enum value "${val}" added at ${path || '<root>'}`,
      });
    }
  }
}

function detectFormatChanges(
  expected: ShapeSchema,
  observed: ShapeSchema,
  path: string,
  changes: DriftChange[]
): void {
  const label = path || '<root>';
  if (expected.format === observed.format) return;
  if (expected.format === 'identifier') {
    changes.push({
      type: 'identifier_format_changed',
      path: label,
      expected: expected.format || 'none',
      observed: observed.format || 'none',
      severity: 'unsafe',
      description: `Identifier format changed from ${expected.format || 'none'} to ${observed.format || 'none'} at ${label}`,
    });
    return;
  }
  if (expected.format === 'timestamp') {
    changes.push({
      type: 'timestamp_format_changed',
      path: label,
      expected: expected.format || 'none',
      observed: observed.format || 'none',
      severity: 'unsafe',
      description: `Timestamp format changed from ${expected.format || 'none'} to ${observed.format || 'none'} at ${label}`,
    });
    return;
  }
  if (expected.format === 'content-type') {
    changes.push({
      type: 'content_type_changed',
      path: label,
      expected: expected.format || 'none',
      observed: observed.format || 'none',
      severity: 'unsafe',
      description: `Content-type format changed at ${label}`,
    });
    return;
  }
  if (observed.format === 'identifier') {
    changes.push({
      type: 'identifier_format_changed',
      path: label,
      expected: expected.format || 'none',
      observed: observed.format || 'none',
      severity: 'unsafe',
      description: `Identifier format changed from ${expected.format || 'none'} to ${observed.format || 'none'} at ${label}`,
    });
    return;
  }
  if (observed.format === 'timestamp') {
    changes.push({
      type: 'timestamp_format_changed',
      path: label,
      expected: expected.format || 'none',
      observed: observed.format || 'none',
      severity: 'unsafe',
      description: `Timestamp format changed from ${expected.format || 'none'} to ${observed.format || 'none'} at ${label}`,
    });
    return;
  }
  if (observed.format === 'content-type') {
    changes.push({
      type: 'content_type_changed',
      path: label,
      expected: expected.format || 'none',
      observed: observed.format || 'none',
      severity: 'unsafe',
      description: `Content-type format changed at ${label}`,
    });
  }
}

function looksLikePaginatedPayload(expected: ShapeSchema, observed: ShapeSchema): boolean {
  const keys = (s: ShapeSchema) => Object.keys(s.properties || {}).map((k) => k.toLowerCase());
  const allKeys = new Set([...keys(expected), ...keys(observed)]);
  return [...allKeys].some((k) => /page|cursor|next|offset|count|total|results/.test(k));
}

function detectRootPaginationChange(
  expected: ShapeSchema,
  observed: ShapeSchema,
  changes: DriftChange[]
): void {
  const expCursorField = paginationField(expected);
  const obsCursorField = paginationField(observed);
  if (expCursorField && obsCursorField && expCursorField !== obsCursorField) {
    changes.push({
      type: 'pagination_shape_changed',
      path: '<root>',
      expected: expCursorField,
      observed: obsCursorField,
      severity: 'unsafe',
      description: `Pagination cursor key changed from "${expCursorField}" to "${obsCursorField}"`,
    });
  } else if (expCursorField && !obsCursorField) {
    changes.push({
      type: 'pagination_shape_changed',
      path: '<root>',
      expected: expCursorField,
      observed: undefined,
      severity: 'unsafe',
      description: `Pagination cursor field "${expCursorField}" no longer present`,
    });
  } else if (!expCursorField && obsCursorField) {
    changes.push({
      type: 'pagination_shape_changed',
      path: '<root>',
      expected: undefined,
      observed: obsCursorField,
      severity: 'safe',
      description: `Pagination cursor field "${obsCursorField}" newly present`,
    });
  }
}

function paginationField(schema: ShapeSchema): string | undefined {
  const props = Object.keys(schema.properties || {});
  for (const p of props) {
    if (/next_(page|cursor|token)/i.test(p) || /^cursor$/i.test(p) || /^offset$/i.test(p)) return p;
  }
  return undefined;
}

function detectNesting(
  expected: ShapeSchema,
  observed: ShapeSchema,
  path: string,
  policy: DriftPolicy,
  changes: DriftChange[]
): void {
  const limit = policy.maxNestingDepth ?? expected.maxDepth ?? 64;
  if (observed.maxDepth !== undefined && observed.maxDepth > limit) {
    changes.push({
      type: 'excessive_nesting',
      path: path || '<root>',
      expected: limit,
      observed: observed.maxDepth,
      severity: 'quarantine',
      description: `Nesting depth ${observed.maxDepth} exceeds configured limit ${limit} at ${path || '<root>'}`,
    });
  }
}

function detectResultItemShape(
  expected: ShapeSchema,
  observed: ShapeSchema,
  path: string,
  policy: DriftPolicy,
  changes: DriftChange[]
): void {
  const limit = policy.maxResultItems ?? expected.maxItems;
  if (limit === undefined) return;
  if (observed.maxItems !== undefined && observed.maxItems > limit) {
    changes.push({
      type: 'result_item_shape_changed',
      path: path || '<root>',
      expected: limit,
      observed: observed.maxItems,
      severity: 'unsafe',
      description: `Result item count ${observed.maxItems} exceeds configured bound ${limit} at ${path || '<root>'}`,
    });
  }
}

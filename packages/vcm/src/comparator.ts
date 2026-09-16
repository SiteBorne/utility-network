/**
 * Generic semantic comparison layer (METADATA-VCM-IMPL-03B §XIV). One
 * reusable comparator, not two ad hoc diff engines: A2A and MCP shadow
 * parity both classify every leaf-level difference between an "existing"
 * (real, production-generated) projection and a "shadow" (VCM-generated)
 * projection into exactly one of five classes. Any `UNEXPLAINED_DIFFERENCE`
 * blocks parity.
 *
 * Comparison is order-sensitive for arrays (skill/tool ordering is a real,
 * inspectable field per §VI/§X) and order-insensitive for object keys (an
 * object's own key order is never semantically meaningful here).
 */

export type DifferenceClass =
  | 'EXACT_MATCH'
  | 'NORMALIZED_MATCH'
  | 'EXPECTED_VOLATILE_DIFFERENCE'
  | 'INTENTIONAL_GOVERNED_DIFFERENCE'
  | 'UNEXPLAINED_DIFFERENCE';

export interface FieldDifference {
  readonly path: string;
  readonly classification: DifferenceClass;
  readonly expected: unknown;
  readonly actual: unknown;
  readonly reason?: string;
}

/** A path-scoped value transform applied to both sides before re-comparing.
 * Used for volatile-but-equivalent representations (e.g. a JSON Schema's
 * property insertion order) rather than for hiding a real difference. */
export interface NormalizationRule {
  readonly pathPattern: RegExp;
  readonly normalize: (value: unknown) => unknown;
}

/** A path-scoped classification for a difference that is real but expected
 * -- either because the field is inherently volatile at compare time
 * (`EXPECTED_VOLATILE_DIFFERENCE`: signatures, generated ids, timestamps) or
 * because the shadow is deliberately, governed-ly different from the
 * existing projection at that path (`INTENTIONAL_GOVERNED_DIFFERENCE`). If
 * `accepts` is supplied, only differences it accepts get this
 * classification; anything else at a matching path still falls through to
 * `UNEXPLAINED_DIFFERENCE`. */
export interface GovernedDifferenceRule {
  readonly pathPattern: RegExp;
  readonly classification: 'EXPECTED_VOLATILE_DIFFERENCE' | 'INTENTIONAL_GOVERNED_DIFFERENCE';
  readonly reason: string;
  readonly accepts?: (expected: unknown, actual: unknown) => boolean;
}

export interface ComparatorConfig {
  readonly normalizations?: readonly NormalizationRule[];
  readonly governedDifferences?: readonly GovernedDifferenceRule[];
}

const MISSING = Symbol('missing');

function isLeaf(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return true;
  if (Array.isArray(value)) return value.length === 0;
  return Object.keys(value as Record<string, unknown>).length === 0;
}

function walk(value: unknown, path: string, out: Map<string, unknown>): void {
  if (isLeaf(value)) {
    out.set(path, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, out));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    walk(child, path ? `${path}.${key}` : key, out);
  }
}

/** Flattens a value into `path -> leaf value` pairs. A "leaf" is a
 * primitive, `null`, or an empty array/object (so an object becoming empty
 * or vice versa is still visible as a difference rather than silently
 * disappearing). */
export function leaves(value: unknown): ReadonlyMap<string, unknown> {
  const out = new Map<string, unknown>();
  walk(value, '', out);
  return out;
}

function sameLeaf(a: unknown, b: unknown): boolean {
  if (a === MISSING || b === MISSING) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Classifies a single path's difference. Exposed standalone (rather than
 * only reachable via `compareProjections`) so normalization and governed-
 * difference rules can be unit-tested in isolation, per §XIV. */
export function classifyDifference(
  path: string,
  expected: unknown,
  actual: unknown,
  config: ComparatorConfig = {}
): FieldDifference {
  if (sameLeaf(expected, actual)) {
    return { path, classification: 'EXACT_MATCH', expected, actual };
  }

  const normalization = config.normalizations?.find((rule) => rule.pathPattern.test(path));
  if (normalization && expected !== MISSING && actual !== MISSING) {
    const normExpected = normalization.normalize(expected);
    const normActual = normalization.normalize(actual);
    if (JSON.stringify(normExpected) === JSON.stringify(normActual)) {
      return { path, classification: 'NORMALIZED_MATCH', expected, actual };
    }
  }

  const governed = config.governedDifferences?.find(
    (rule) => rule.pathPattern.test(path) && (!rule.accepts || rule.accepts(expected, actual))
  );
  if (governed) {
    return {
      path,
      classification: governed.classification,
      expected,
      actual,
      reason: governed.reason,
    };
  }

  return { path, classification: 'UNEXPLAINED_DIFFERENCE', expected, actual };
}

/** Compares two projection outputs leaf-by-leaf and classifies every
 * resulting path. `expected` is the existing (real, production) projection;
 * `actual` is the VCM shadow projection. */
export function compareProjections(
  expected: unknown,
  actual: unknown,
  config: ComparatorConfig = {}
): readonly FieldDifference[] {
  const expectedLeaves = leaves(expected);
  const actualLeaves = leaves(actual);
  const paths = new Set<string>([...expectedLeaves.keys(), ...actualLeaves.keys()]);
  const differences = [...paths].map((path) =>
    classifyDifference(
      path,
      expectedLeaves.has(path) ? expectedLeaves.get(path) : MISSING,
      actualLeaves.has(path) ? actualLeaves.get(path) : MISSING,
      config
    )
  );
  return differences.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export type DifferenceSummary = Readonly<Record<DifferenceClass, number>>;

export function summarizeDifferences(differences: readonly FieldDifference[]): DifferenceSummary {
  const summary: Record<DifferenceClass, number> = {
    EXACT_MATCH: 0,
    NORMALIZED_MATCH: 0,
    EXPECTED_VOLATILE_DIFFERENCE: 0,
    INTENTIONAL_GOVERNED_DIFFERENCE: 0,
    UNEXPLAINED_DIFFERENCE: 0,
  };
  for (const difference of differences) summary[difference.classification] += 1;
  return summary;
}

export function unexplainedDifferences(
  differences: readonly FieldDifference[]
): readonly FieldDifference[] {
  return differences.filter((d) => d.classification === 'UNEXPLAINED_DIFFERENCE');
}

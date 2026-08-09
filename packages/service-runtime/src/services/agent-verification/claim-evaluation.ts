import type { ClaimPredicate } from './types';

/**
 * Evaluates one verification_contract claim against candidate_output. The
 * frozen agent-verification-input schema's claim objects have no explicit
 * JSON-path/field selector — only `claim_id`, `predicate`, `expected_value`
 * (and optional `tolerance`) — so this service interprets `claim_id` as
 * the top-level property name in `candidate_output` to check. This is a
 * documented interpretation of an underspecified frozen field, not a
 * schema mutation (see docs/decisions/0039-service-runtime-underspecified-field-interpretations.md);
 * it should be revisited if a future contract revision adds an explicit
 * path field.
 */
export function evaluateClaim(
  candidateOutput: Record<string, unknown>,
  claim: {
    claim_id: string;
    predicate: ClaimPredicate;
    expected_value: unknown;
    tolerance?: number;
  }
): { passed: boolean; details: string } {
  const actual = candidateOutput[claim.claim_id];

  switch (claim.predicate) {
    case 'exists':
      return {
        passed: actual !== undefined,
        details: actual !== undefined ? 'field present' : 'field absent',
      };
    case 'not_exists':
      return {
        passed: actual === undefined,
        details: actual === undefined ? 'field absent' : 'field present',
      };
    case 'equals':
      if (
        typeof actual === 'number' &&
        typeof claim.expected_value === 'number' &&
        claim.tolerance !== undefined
      ) {
        const passed = Math.abs(actual - claim.expected_value) <= claim.tolerance;
        return {
          passed,
          details: `|${actual} - ${claim.expected_value}| ${passed ? '<=' : '>'} tolerance ${claim.tolerance}`,
        };
      }
      return deepEqualResult(actual, claim.expected_value);
    case 'contains':
      if (typeof actual === 'string' && typeof claim.expected_value === 'string') {
        const passed = actual.includes(claim.expected_value);
        return { passed, details: passed ? 'substring found' : 'substring not found' };
      }
      if (Array.isArray(actual)) {
        const passed = actual.some((v) => deepEqualResult(v, claim.expected_value).passed);
        return {
          passed,
          details: passed ? 'array contains value' : 'array does not contain value',
        };
      }
      return {
        passed: false,
        details: 'contains predicate requires a string or array actual value',
      };
    case 'matches':
      if (typeof actual === 'string' && typeof claim.expected_value === 'string') {
        try {
          const passed = new RegExp(claim.expected_value).test(actual);
          return { passed, details: passed ? 'pattern matched' : 'pattern did not match' };
        } catch {
          return { passed: false, details: 'expected_value is not a valid regular expression' };
        }
      }
      return {
        passed: false,
        details: 'matches predicate requires string actual and pattern values',
      };
    case 'greater_than':
      if (typeof actual === 'number' && typeof claim.expected_value === 'number') {
        const passed = actual > claim.expected_value;
        return { passed, details: `${actual} ${passed ? '>' : '<='} ${claim.expected_value}` };
      }
      return { passed: false, details: 'greater_than predicate requires numeric values' };
    case 'less_than':
      if (typeof actual === 'number' && typeof claim.expected_value === 'number') {
        const passed = actual < claim.expected_value;
        return { passed, details: `${actual} ${passed ? '<' : '>='} ${claim.expected_value}` };
      }
      return { passed: false, details: 'less_than predicate requires numeric values' };
  }
}

function deepEqualResult(a: unknown, b: unknown): { passed: boolean; details: string } {
  const passed = JSON.stringify(a) === JSON.stringify(b);
  return { passed, details: passed ? 'values equal' : 'values differ' };
}

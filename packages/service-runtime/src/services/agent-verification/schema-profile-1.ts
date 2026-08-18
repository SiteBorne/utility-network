/**
 * SITEBORNE JSON Schema Profile 1 ("siteborne-json-schema-profile-1").
 *
 * SUN-1200 checkpoint F — VALIDATION RUNTIME CLOSURE, human governance
 * decision (VERIFY_DYNAMIC_DECISION=C resolution): `verify_agent_output`'s
 * buyer-supplied `required_schema` can no longer be handed to a real,
 * request-time `Ajv.compile()` (the same request-time-eval risk class
 * that caused checkpoint F's second mainnet cutover 500). This module is
 * the bounded, eval-free, closed-world JSON Schema profile that replaces
 * it, plus the pre-economic structural/resource gate that rejects an
 * unsupported or oversized schema BEFORE any payment challenge is
 * constructed.
 *
 * Base dialect: JSON Schema 2020-12 semantics, for an explicitly
 * enumerated keyword subset only. Closed-world: any keyword not on the
 * supported list is REJECTED, never silently ignored. No remote schema
 * loading. No runtime JS generation anywhere in this module — schema
 * interpretation is delegated to `@cfworker/json-schema`'s `Validator`,
 * a pure-interpreter JSON Schema engine with no `eval`/`new Function`
 * anywhere in its own implementation (that is its whole reason for
 * existing — it is explicitly built to run inside Cloudflare Workers).
 *
 * Deliberately NOT supported in Profile 1 (see PROFILE_1_UNSUPPORTED_KEYWORDS
 * below for the full, explicit list and each one's rationale):
 * remote/dynamic $ref, unevaluated{Properties,Items}, pattern/
 * patternProperties/format/content* (regex/format ambiguity deferred to a
 * future profile revision after explicit security testing), $id/$anchor
 * (keeps this profile's "$ref is always a same-document JSON Pointer"
 * rule unambiguous), dependentRequired/dependentSchemas (omitted from
 * Profile 1 by explicit governance decision, not silently dropped —
 * recorded in the forward service contract as unsupported).
 */
import { Validator, type ValidationResult } from '@cfworker/json-schema';

export const SCHEMA_PROFILE_ID = 'siteborne-json-schema-profile-1';
export const CANONICAL_DRAFT_2020_12_URI = 'https://json-schema.org/draft/2020-12/schema';

/** SUN-1200 checkpoint F — human-authorized resource limits (§5). No
 * remote fetches; validating a schema requires zero network access. */
export const PROFILE_1_LIMITS = {
  MAX_CANONICAL_SCHEMA_BYTES: 32768,
  MAX_SCHEMA_DEPTH: 32,
  MAX_SCHEMA_NODES: 2048,
  MAX_LOCAL_REF_COUNT: 128,
  MAX_PROPERTIES_PER_OBJECT_SCHEMA: 256,
  MAX_TOTAL_PROPERTY_DECLARATIONS: 1024,
  MAX_COMBINATOR_BRANCHES_PER_KEYWORD: 32,
  MAX_ENUM_VALUES: 256,
  MAX_PREFIX_ITEMS: 128,
} as const;

/** How a supported keyword's value participates in the structural walk.
 * `'none'` keywords carry no nested schema (type, enum, required, the
 * numeric/length bounds, ...). `'schema'` keywords carry exactly one
 * nested schema (or boolean schema). `'schemaArray'` keywords carry an
 * array of schemas. `'schemaMapValues'` keywords carry an object whose
 * VALUES are schemas but whose KEYS are ordinary buyer-chosen names
 * (property names for `properties`, definition names for `$defs`) —
 * those key strings are never checked against the keyword allowlist
 * (§9's adversarial requirement: a property literally named `"pattern"`
 * must never trigger unsupported-keyword rejection). */
type KeywordShape = 'none' | 'schema' | 'schemaArray' | 'schemaMapValues';

const SUPPORTED_KEYWORD_SHAPES: Record<string, KeywordShape> = {
  type: 'none',
  enum: 'none',
  const: 'none',
  properties: 'schemaMapValues',
  required: 'none',
  additionalProperties: 'schema',
  minProperties: 'none',
  maxProperties: 'none',
  items: 'schema',
  prefixItems: 'schemaArray',
  minItems: 'none',
  maxItems: 'none',
  uniqueItems: 'none',
  contains: 'schema',
  minContains: 'none',
  maxContains: 'none',
  minLength: 'none',
  maxLength: 'none',
  minimum: 'none',
  maximum: 'none',
  exclusiveMinimum: 'none',
  exclusiveMaximum: 'none',
  multipleOf: 'none',
  allOf: 'schemaArray',
  anyOf: 'schemaArray',
  oneOf: 'schemaArray',
  not: 'schema',
  if: 'schema',
  then: 'schema',
  else: 'schema',
  $defs: 'schemaMapValues',
  $ref: 'none', // string value, handled + accounted for separately (local-only, §10)
};

/** Pure annotation keywords: never affect validation outcome, so
 * allowing them creates no "unsupported behavior silently ignored" risk
 * (§1) -- they had no behavior to drop. Rejecting ordinary `title`/
 * `description` fields would make Profile 1 unusable for real buyer
 * schemas for no safety benefit. */
const ANNOTATION_ONLY_KEYWORDS = new Set([
  'title',
  'description',
  'default',
  'examples',
  '$comment',
  'deprecated',
  'readOnly',
  'writeOnly',
]);

/** Explicitly enumerated, explicitly REJECTED (never silently ignored)
 * per directive §4 plus this profile's own local-ref-only design (§10).
 * Exported so the forward service contract (2.1.0) can quote this list
 * verbatim rather than re-deriving it. */
export const PROFILE_1_UNSUPPORTED_KEYWORDS = [
  '$dynamicRef',
  '$dynamicAnchor',
  '$anchor',
  '$id',
  '$recursiveRef',
  '$recursiveAnchor',
  '$vocabulary',
  'unevaluatedProperties',
  'unevaluatedItems',
  'pattern',
  'patternProperties',
  'format',
  'contentEncoding',
  'contentMediaType',
  'contentSchema',
  'dependentRequired',
  'dependentSchemas',
  'dependencies',
  'propertyNames',
  'additionalItems',
] as const;

export interface Profile1Rejection {
  supported: false;
  code: 'unsupported_required_schema' | 'required_schema_limit_exceeded';
  reason: string;
}

export interface Profile1Acceptance {
  supported: true;
  localRefCount: number;
}

export type Profile1CheckResult = Profile1Acceptance | Profile1Rejection;

function isSchemaNode(value: unknown): value is Record<string, unknown> | boolean {
  return (
    value === true ||
    value === false ||
    (typeof value === 'object' && value !== null && !Array.isArray(value))
  );
}

function reject(
  code: Profile1Rejection['code'],
  reason: string
): Profile1Rejection {
  return { supported: false, code, reason };
}

interface WalkState {
  nodeCount: number;
  maxDepth: number;
  totalProperties: number;
  refs: Array<{ from: string; target: string }>;
  refPointers: string[];
}

/** Structurally walks `node` (a schema, boolean or object), enforcing
 * the closed-world keyword allowlist and every §5 resource limit as it
 * goes (so an over-limit schema is rejected before expensive
 * interpretation, per §11 -- this walk itself is O(schema size), never
 * unbounded, since every recursive call strictly descends the JSON
 * value tree the caller already fully parsed). Returns a rejection the
 * instant any violation is found, or `null` to continue. */
function walk(
  node: unknown,
  path: string,
  depth: number,
  state: WalkState,
  isRoot: boolean
): Profile1Rejection | null {
  if (depth > PROFILE_1_LIMITS.MAX_SCHEMA_DEPTH) {
    return reject(
      'required_schema_limit_exceeded',
      `schema nesting depth exceeds MAX_SCHEMA_DEPTH=${PROFILE_1_LIMITS.MAX_SCHEMA_DEPTH} at ${path}`
    );
  }
  if (!isSchemaNode(node)) {
    return reject('unsupported_required_schema', `expected a schema (object or boolean) at ${path}`);
  }
  state.nodeCount++;
  state.maxDepth = Math.max(state.maxDepth, depth);
  if (state.nodeCount > PROFILE_1_LIMITS.MAX_SCHEMA_NODES) {
    return reject(
      'required_schema_limit_exceeded',
      `schema node count exceeds MAX_SCHEMA_NODES=${PROFILE_1_LIMITS.MAX_SCHEMA_NODES}`
    );
  }
  if (typeof node === 'boolean') return null; // boolean schemas are leaves, nothing further to walk

  for (const key of Object.keys(node)) {
    const value = (node as Record<string, unknown>)[key];
    const keyPath = `${path}/${key}`;

    if (key === '$schema') {
      if (!isRoot) {
        return reject(
          'unsupported_required_schema',
          `"$schema" is only supported at the schema root (found at ${keyPath})`
        );
      }
      if (value !== CANONICAL_DRAFT_2020_12_URI) {
        return reject(
          'unsupported_required_schema',
          `"$schema" must equal the canonical Draft 2020-12 URI "${CANONICAL_DRAFT_2020_12_URI}" if supplied`
        );
      }
      continue;
    }

    if (ANNOTATION_ONLY_KEYWORDS.has(key)) continue;

    const shape = SUPPORTED_KEYWORD_SHAPES[key];
    if (shape === undefined) {
      return reject(
        'unsupported_required_schema',
        `unsupported schema keyword "${key}" at ${keyPath} -- Profile 1 rejects unrecognized keywords rather than silently ignoring them`
      );
    }

    if (key === '$ref') {
      if (typeof value !== 'string' || !/^#(\/.*)?$/.test(value)) {
        return reject(
          'unsupported_required_schema',
          `"$ref" at ${keyPath} must be a local JSON Pointer ("#" or "#/...") -- remote/external/dynamic refs are rejected`
        );
      }
      state.refs.push({ from: path, target: value });
      state.refPointers.push(value);
      if (state.refPointers.length > PROFILE_1_LIMITS.MAX_LOCAL_REF_COUNT) {
        return reject(
          'required_schema_limit_exceeded',
          `local $ref count exceeds MAX_LOCAL_REF_COUNT=${PROFILE_1_LIMITS.MAX_LOCAL_REF_COUNT}`
        );
      }
      continue;
    }

    if (key === 'enum') {
      if (!Array.isArray(value)) {
        return reject('unsupported_required_schema', `"enum" at ${keyPath} must be an array`);
      }
      if (value.length > PROFILE_1_LIMITS.MAX_ENUM_VALUES) {
        return reject(
          'required_schema_limit_exceeded',
          `"enum" at ${keyPath} exceeds MAX_ENUM_VALUES=${PROFILE_1_LIMITS.MAX_ENUM_VALUES}`
        );
      }
      continue;
    }

    if (shape === 'none') continue;

    if (shape === 'schema') {
      const err = walk(value, keyPath, depth + 1, state, false);
      if (err) return err;
      continue;
    }

    if (shape === 'schemaArray') {
      if (!Array.isArray(value)) {
        return reject('unsupported_required_schema', `"${key}" at ${keyPath} must be an array of schemas`);
      }
      const limit =
        key === 'prefixItems'
          ? PROFILE_1_LIMITS.MAX_PREFIX_ITEMS
          : PROFILE_1_LIMITS.MAX_COMBINATOR_BRANCHES_PER_KEYWORD;
      if (value.length > limit) {
        return reject(
          'required_schema_limit_exceeded',
          `"${key}" at ${keyPath} has ${value.length} entries, exceeding its limit of ${limit}`
        );
      }
      for (let i = 0; i < value.length; i++) {
        const err = walk(value[i], `${keyPath}/${i}`, depth + 1, state, false);
        if (err) return err;
      }
      continue;
    }

    // shape === 'schemaMapValues' (properties, $defs)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return reject('unsupported_required_schema', `"${key}" at ${keyPath} must be an object`);
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (key === 'properties') {
      if (entries.length > PROFILE_1_LIMITS.MAX_PROPERTIES_PER_OBJECT_SCHEMA) {
        return reject(
          'required_schema_limit_exceeded',
          `"properties" at ${keyPath} has ${entries.length} entries, exceeding MAX_PROPERTIES_PER_OBJECT_SCHEMA=${PROFILE_1_LIMITS.MAX_PROPERTIES_PER_OBJECT_SCHEMA}`
        );
      }
      state.totalProperties += entries.length;
      if (state.totalProperties > PROFILE_1_LIMITS.MAX_TOTAL_PROPERTY_DECLARATIONS) {
        return reject(
          'required_schema_limit_exceeded',
          `total property declarations exceed MAX_TOTAL_PROPERTY_DECLARATIONS=${PROFILE_1_LIMITS.MAX_TOTAL_PROPERTY_DECLARATIONS}`
        );
      }
    }
    for (const [propName, propSchema] of entries) {
      // propName is an ordinary buyer-chosen name (a property name, or a
      // $defs definition name) -- never checked against the keyword
      // allowlist. Only propSchema (the VALUE) is walked as a schema.
      const err = walk(propSchema, `${keyPath}/${encodeURIComponent(propName)}`, depth + 1, state, false);
      if (err) return err;
    }
  }

  return null;
}

/** Resolves a local JSON Pointer (`#` or `#/a/b/c`) against `root`,
 * returning the JSON-Pointer path string it lands on, or `null` if the
 * pointer does not resolve to an existing node (§10: "detect unresolved
 * local refs"). */
function resolveLocalPointer(root: unknown, pointer: string): string | null {
  if (pointer === '#') return '';
  const segments = pointer
    .slice(2)
    .split('/')
    .map((s) => decodeURIComponent(s.replace(/~1/g, '/').replace(/~0/g, '~')));
  let cursor: unknown = root;
  let resolvedPath = '';
  for (const segment of segments) {
    if (typeof cursor !== 'object' || cursor === null) return null;
    if (Array.isArray(cursor)) {
      const idx = Number(segment);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cursor.length) return null;
      cursor = cursor[idx];
    } else {
      if (!(segment in (cursor as Record<string, unknown>))) return null;
      cursor = (cursor as Record<string, unknown>)[segment];
    }
    resolvedPath += `/${segment}`;
  }
  return resolvedPath;
}

/** Maps the path of a `$ref` occurrence to the vertex it belongs to for
 * cycle-detection purposes: the longest (most specific) resolved
 * definition path in `vertices` that `path` is nested inside (or equal
 * to). A `$ref` at `#/$defs/node/properties/child` belongs to the
 * `#/$defs/node` vertex, not its own unique occurrence path -- without
 * this, every `$ref` occurrence would be its own graph node and a real
 * self-reference (a `$ref` inside the very definition it points back
 * to) would never register as a self-loop. Falls back to the root
 * vertex `'#'` when no definition encloses the occurrence. */
function vertexFor(path: string, vertices: Set<string>): string {
  let best = '#';
  for (const v of vertices) {
    if ((path === v || path.startsWith(`${v}/`)) && v.length > best.length) best = v;
  }
  return best;
}

/** Detects a cycle in the local $ref graph via DFS with a recursion
 * stack. Per §10: "If safe recursion cannot be guaranteed, reject
 * recursive-reference cycles in Profile 1" -- rather than attempt to
 * formally bound cfworker's own recursive validation depth for a
 * self-referential schema, Profile 1 rejects the schema outright. */
function hasRefCycle(edges: Array<{ from: string; to: string }>): boolean {
  const adjacency = new Map<string, string[]>();
  for (const { from, to } of edges) {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from)!.push(to);
  }
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  const visit = (node: string): boolean => {
    color.set(node, GRAY);
    for (const next of adjacency.get(node) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) return true;
      if (c === WHITE && visit(next)) return true;
    }
    color.set(node, BLACK);
    return false;
  };
  for (const node of adjacency.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE) {
      if (visit(node)) return true;
    }
  }
  return false;
}

/** The pre-economic Profile 1 structural/resource gate (§6, §9-§11).
 * Must be called BEFORE any payment challenge is constructed for
 * `verify_agent_output`. Never invokes an interpreter on the schema --
 * this is pure, bounded structural inspection of the already-parsed
 * JSON value the buyer supplied. */
export function checkSchemaProfile1(schema: unknown): Profile1CheckResult {
  let canonicalBytes: number;
  try {
    canonicalBytes = Buffer.byteLength(JSON.stringify(schema), 'utf-8');
  } catch {
    return reject('unsupported_required_schema', 'required_schema is not JSON-serializable');
  }
  if (canonicalBytes > PROFILE_1_LIMITS.MAX_CANONICAL_SCHEMA_BYTES) {
    return reject(
      'required_schema_limit_exceeded',
      `required_schema is ${canonicalBytes} bytes, exceeding MAX_CANONICAL_SCHEMA_BYTES=${PROFILE_1_LIMITS.MAX_CANONICAL_SCHEMA_BYTES}`
    );
  }

  const state: WalkState = {
    nodeCount: 0,
    maxDepth: 0,
    totalProperties: 0,
    refs: [],
    refPointers: [],
  };
  const walkErr = walk(schema, '#', 0, state, true);
  if (walkErr) return walkErr;

  // Local-ref resolution + cycle detection (§10).
  const resolvedRefs: Array<{ from: string; to: string }> = [];
  const targetVertices = new Set<string>(['#']);
  for (const { from, target } of state.refs) {
    const resolved = resolveLocalPointer(schema, target);
    if (resolved === null) {
      return reject(
        'unsupported_required_schema',
        `"$ref": "${target}" does not resolve to any node inside the supplied schema`
      );
    }
    const to = `#${resolved}`;
    resolvedRefs.push({ from, to });
    targetVertices.add(to);
  }
  // Every $ref occurrence is reassigned to the vertex of the nearest
  // enclosing definition it lives inside (see `vertexFor`), so a $ref
  // nested anywhere within a $defs entry that points back to that same
  // entry registers as a graph self-loop, not a never-repeating unique
  // occurrence path.
  const edges = resolvedRefs.map(({ from, to }) => ({ from: vertexFor(from, targetVertices), to }));
  if (hasRefCycle(edges)) {
    return reject(
      'unsupported_required_schema',
      'required_schema contains a recursive $ref cycle -- Profile 1 rejects recursive references rather than attempting to bound their validation-time recursion'
    );
  }

  return { supported: true, localRefCount: state.refPointers.length };
}

export interface Profile1ValidationOutcome {
  valid: boolean;
  errors: string[];
}

/** Validates `candidate` against a schema already accepted by
 * `checkSchemaProfile1` -- eval-free, via `@cfworker/json-schema`'s pure
 * interpreter (no `Ajv`, no `new Function`, no request-time codegen of
 * any kind). Callers MUST call `checkSchemaProfile1` first; this
 * function does not re-check keyword support or resource limits. */
export function validateAgainstProfile1(schema: unknown, candidate: unknown): Profile1ValidationOutcome {
  const validator = new Validator(schema as Record<string, unknown> | boolean, '2020-12');
  const result: ValidationResult = validator.validate(candidate);
  return {
    valid: result.valid,
    errors: result.errors.map((e) => `${e.instanceLocation || '(root)'} ${e.error}`),
  };
}

/**
 * Local JSON-Schema $ref inliner (directive §14). SITEBORNE's frozen
 * contract schemas (`contracts/releases/1.0.0/schemas/...`) use absolute
 * `$id`-based `$ref`s to a handful of shared common schemas (e.g.
 * `https://siteborne.net/schemas/common/money.schema.json`). Those `$id`s
 * are not live network locations — nothing in this repo serves them — but
 * an unmodified Bazaar consumer has no way to resolve them either.
 *
 * `bundleLocalRefs` inlines every `$ref` this package already has the
 * referenced schema for (statically imported in `frozen-inputs.ts`, never
 * fetched), producing a fully self-contained schema with zero remaining
 * `$ref`s. It never mutates its inputs — it returns a new tree.
 */

const MAX_DEPTH = 20;

export class UnresolvedSchemaRefError extends Error {
  constructor(public readonly ref: string) {
    super(
      `schema bundling encountered "$ref": "${ref}" with no entry in the provided ref map — refusing to emit a schema with an unresolved reference`
    );
    this.name = 'UnresolvedSchemaRefError';
  }
}

export class SchemaBundleDepthExceededError extends Error {
  constructor() {
    super(
      `schema bundling exceeded max depth (${MAX_DEPTH}) — refusing to recurse further (cyclic $ref?)`
    );
    this.name = 'SchemaBundleDepthExceededError';
  }
}

/**
 * Inlines every `$ref` found anywhere in `schema` using `refMap` (keyed by
 * the referenced schema's own `$id`). A `$ref` node's sibling keys (if
 * any) are preserved and layered over the inlined content, matching the
 * JSON Schema 2020-12 convention this repo's frozen schemas already use
 * (`{ "$ref": "...", "description": "..." }`).
 *
 * Fails closed: an unresolvable `$ref` throws rather than being dropped or
 * passed through — directive §14 requires no remote `$ref` survive into
 * the bundled output.
 */
export function bundleLocalRefs(
  schema: unknown,
  refMap: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  depth = 0
): unknown {
  if (depth > MAX_DEPTH) {
    throw new SchemaBundleDepthExceededError();
  }
  if (Array.isArray(schema)) {
    return schema.map((item) => bundleLocalRefs(item, refMap, depth + 1));
  }
  if (schema === null || typeof schema !== 'object') {
    return schema;
  }

  const obj = schema as Record<string, unknown>;
  if (typeof obj.$ref === 'string') {
    const target = refMap[obj.$ref];
    if (!target) {
      throw new UnresolvedSchemaRefError(obj.$ref);
    }
    // Recurse into the resolved target too, in case it has its own $refs
    // (none of SITEBORNE's current common schemas do, but this keeps the
    // function correct if that ever changes).
    const bundledTarget = bundleLocalRefs(target, refMap, depth + 1) as Record<string, unknown>;
    // A resolved fragment's own `$id`/`$schema` are meaningless (and, per
    // the official Bazaar validator, actively rejected — "schema must not
    // contain external $ref/$id references") once inlined: it is no
    // longer a standalone schema document, just an embedded fragment.
    const { $id: _droppedId, $schema: _droppedSchema, ...resolved } = bundledTarget;
    void _droppedId;
    void _droppedSchema;
    const { $ref: _drop, ...siblings } = obj;
    void _drop;
    const bundledSiblings = Object.fromEntries(
      Object.entries(siblings).map(([k, v]) => [k, bundleLocalRefs(v, refMap, depth + 1)])
    );
    // Sibling keys on the $ref node (e.g. a local "description" override)
    // take precedence over the resolved schema's own value for that key —
    // matches how this repo's frozen schemas actually use sibling
    // descriptions ($ref + description together).
    return { ...resolved, ...bundledSiblings };
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key] = bundleLocalRefs(value, refMap, depth + 1);
  }
  return out;
}

/** True only when no `$ref` key survives anywhere in the tree — used to
 * prove `bundleLocalRefs`'s own output before it is ever handed to a
 * consumer. */
export function containsUnresolvedRef(schema: unknown): boolean {
  if (Array.isArray(schema)) return schema.some(containsUnresolvedRef);
  if (schema === null || typeof schema !== 'object') return false;
  const obj = schema as Record<string, unknown>;
  if (typeof obj.$ref === 'string') return true;
  return Object.values(obj).some(containsUnresolvedRef);
}

/**
 * Strips the *document-level* `$id`/`$schema` a bundled schema still
 * carries as a standalone JSON Schema document. `bundleLocalRefs` already
 * drops these from every *inlined* fragment (they would be
 * `hasExternalSchemaReference`-rejected by the official
 * `validateDiscoveryExtension` otherwise) — this additionally drops them
 * from the outermost document itself, for the one case where the whole
 * bundled schema is embedded as a Bazaar `inputSchema` *fragment* (nested
 * inside the extension's own envelope schema) rather than used as a
 * standalone document. `BUNDLED_SERVICE_INPUT_SCHEMAS` itself keeps its
 * top-level `$id` (useful for standalone ajv validation, proven in
 * frozen-inputs.test.ts) — only the Bazaar-embedding call site strips it.
 */
export function stripDocumentIdentity(schema: unknown): unknown {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const { $id: _id, $schema: _schema, ...rest } = schema as Record<string, unknown>;
  void _id;
  void _schema;
  return rest;
}

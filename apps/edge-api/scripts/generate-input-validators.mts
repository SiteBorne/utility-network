/**
 * SUN-1200 checkpoint F remediation — generates a single, self-contained
 * ESM module of AJV "standalone" validator functions for every one of
 * SITEBORNE's frozen paid-service input schemas
 * (`@siteborne/protocol-x402`'s `BUNDLED_SERVICE_INPUT_SCHEMAS`).
 *
 * WHY THIS EXISTS: `createX402ServiceRoute` (`x402-service.ts`) previously
 * called `new Ajv2020({...}).compile(config.inputSchema)` lazily, the
 * first time a given paid route was actually reached at request time
 * (via `buildPaidServicesApp`'s cache-on-first-request pattern in
 * `index.ts`). AJV's `.compile()` internally uses `new Function(...)` to
 * generate an optimized validator — real Cloudflare Workers reject
 * dynamic code generation triggered during request handling
 * (`EvalError: Code generation from strings disallowed for this
 * context`), confirmed live during SUN-1200 checkpoint F's second cutover
 * attempt. This script moves that compilation to BUILD TIME: the
 * generated module contains ordinary, already-compiled JavaScript
 * functions — the real deployed Worker never calls `Ajv.compile()` at
 * all for these schemas.
 *
 * Every input schema this repository actually validates against
 * (`BUNDLED_SERVICE_INPUT_SCHEMAS`) is a genuinely static, build-time-known
 * artifact — ES module JSON imports from the frozen `contracts/releases/`
 * tree, never runtime-supplied data — making standalone precompilation
 * safe and complete for this specific validator set. (This does NOT cover
 * `verify_agent_output`'s buyer-supplied `required_schema` field, which is
 * genuine per-request data and cannot be precompiled — that is a
 * structurally separate, still-open risk, deliberately not addressed by
 * this script; see the checkpoint F incident report.)
 *
 * Run via `pnpm generate:input-validators` (root: `pnpm schemas:generate`).
 * `drift-check-input-validators.ts` proves the committed generated file
 * matches what this script would produce right now.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error -- ajv ships this subpath without its own .d.ts export
// map entry for the compiled ESM build this repo consumes; the runtime
// export (default a function) is exercised directly below and is stable
// across ajv 8.x.
import standaloneCode from 'ajv/dist/standalone/index.js';
// Imported by relative path, not the `@siteborne/protocol-x402` package
// specifier: that package's own `dist/` build is not actually produced
// anywhere in this repository's real pipeline (its tsconfig sets
// `noEmit: true`; every other consumer resolves it via Vitest's own
// tsconfig-`paths`-aware resolver, which a bare `tsx` invocation does not
// replicate for cross-package specifiers). `frozen-inputs.ts` itself has
// no further `@siteborne/*` package imports -- only relative imports and
// JSON module imports -- so this resolves cleanly without needing any
// workspace package to be built first.
import { BUNDLED_SERVICE_INPUT_SCHEMAS } from '../../../packages/protocol-x402/src/bazaar/frozen-inputs.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const GENERATED_OUTPUT_PATH = join(
  __dirname,
  '..',
  'src',
  'generated',
  'input-validators.generated.js'
);

/** Deduplicates by schema `$id` -- v1/v2 service majors intentionally
 * share the identical frozen input schema object (SUN-1000 checkpoint
 * 1M), so compiling each service ID independently would throw AJV's own
 * duplicate-`$id` error. Keyed by `$id` (a stable, globally-unique string
 * per schema file), never by service ID, so the generated lookup works
 * for both majors without duplication. */
export function uniqueSchemasById(): Map<string, unknown> {
  const byId = new Map<string, unknown>();
  for (const schema of Object.values(BUNDLED_SERVICE_INPUT_SCHEMAS)) {
    const id = (schema as { $id?: string }).$id;
    if (!id) {
      throw new Error('bundled input schema missing required $id -- cannot generate a stable key');
    }
    byId.set(id, schema);
  }
  return byId;
}

/** Derives a valid JS export identifier from a schema `$id` URL --
 * `standaloneCode`'s multi-schema mode requires `{exportName: schemaId}`,
 * not the raw `$id` as the key. Deterministic and collision-free across
 * this repository's actual schema set (basename, extension stripped,
 * kebab-case to camelCase). */
export function exportNameForSchemaId(id: string): string {
  const basename = id.split('/').pop() ?? id;
  const withoutExtension = basename.replace(/\.schema\.json$/, '');
  return withoutExtension.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function generateModuleSource(): string {
  const ajv = new Ajv2020({ strict: false, code: { source: true, esm: true } });
  const refs: Record<string, string> = {};
  const seenExportNames = new Set<string>();
  for (const [id, schema] of uniqueSchemasById()) {
    ajv.compile(schema as object);
    const exportName = exportNameForSchemaId(id);
    if (seenExportNames.has(exportName)) {
      throw new Error(`derived export name collision for schema $id "${id}": "${exportName}"`);
    }
    seenExportNames.add(exportName);
    refs[exportName] = id;
  }
  const code = standaloneCode(ajv, refs) as string;
  // `standaloneCode` names each export by our derived identifier, not the
  // schema's own `$id` -- the real runtime consumer (`x402-service.ts`)
  // only has the `$id` available (from `config.inputSchema`), so append a
  // small, deterministic `$id -> validator` lookup map built from the
  // same `refs` association used above. This keeps the generated file
  // self-contained -- the consumer needs no separate id-to-export-name
  // logic duplicated at runtime.
  const idToExportNameEntries = Object.entries(refs)
    .map(([exportName, id]) => `  ${JSON.stringify(id)}: ${exportName},`)
    .join('\n');
  const lookupExport =
    '\nexport const inputValidatorsById = {\n' + idToExportNameEntries + '\n};\n';
  return (
    '// GENERATED FILE -- do not hand-edit.\n' +
    '// Regenerate with `pnpm generate:input-validators` (root: `pnpm schemas:generate`).\n' +
    '// Source: apps/edge-api/scripts/generate-input-validators.mts, from\n' +
    "// protocol-x402's BUNDLED_SERVICE_INPUT_SCHEMAS.\n" +
    '// See that script and the SUN-1200 checkpoint F incident report for why\n' +
    '// this file exists: AJV runtime compilation is unsafe inside a real\n' +
    '// Cloudflare Workers request handler.\n' +
    code +
    lookupExport
  );
}

function main(): void {
  const source = generateModuleSource();
  writeFileSync(GENERATED_OUTPUT_PATH, source, 'utf-8');
  // eslint-disable-next-line no-console
  console.log(`Generated ${GENERATED_OUTPUT_PATH}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

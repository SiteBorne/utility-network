/**
 * Loads the frozen JSON Schema files (schemas/**) and registers them with a
 * single ajv instance, so SchemaVerifier validates against the *actual*
 * frozen schema artifacts rather than a hand-written, divergent copy.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
// The frozen PCC schema (schemas/proof-carrying-context.schema.json) predates
// the 2020-12 migration and still declares draft-07 ($schema:
// http://json-schema.org/draft-07/schema#) — it is frozen and must not be
// edited to match. Every service output schema $refs it via `allOf`, so a
// single Ajv2020 instance needs the draft-07 meta-schema registered too, or
// adding the PCC schema throws "no schema with key or ref ...draft-07...".
import draft07MetaSchema from 'ajv/dist/refs/json-schema-draft-07.json' with { type: 'json' };

let schemasDir: string | null = null;

function getSchemasDir(): string {
  if (schemasDir) return schemasDir;
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const REPO_ROOT = join(__dirname, '..', '..', '..');
    schemasDir = join(REPO_ROOT, 'schemas');
  } catch {
    schemasDir = '';
  }
  return schemasDir;
}

let ajvSingleton: InstanceType<typeof Ajv2020> | null = null;

/**
 * SUN-1200 checkpoint F (P0-A) — a build-time-precompiled override,
 * checked BEFORE `getAjv()`'s runtime filesystem-based path anywhere
 * that path is reached. `setPrecompiledOutputValidators` is called
 * exactly once, at real Cloudflare Worker module-load time (never
 * per-request — see `apps/edge-api/src/control-plane/routes/paid-services.ts`),
 * registering the AJV-standalone-generated validators
 * (`apps/edge-api/scripts/generate-input-validators.mts`'s
 * `outputValidatorsById`). Once set, the real Worker's request-handling
 * code never reaches `getAjv()`'s `node:fs.readFileSync`/`readdirSync`
 * calls (classified `UNPROVEN_BUNDLE_PATH_DEPENDENCY` — the path is
 * computed relative to this module's own bundled location via
 * `import.meta.url`, which does not survive esbuild's single-file
 * bundling, and `schemas/` is not declared as a Worker asset anywhere)
 * or trigger request-time AJV compilation. Callers that never call this
 * setter (local Node.js scripts, this package's own tests, any
 * non-Worker tooling) are completely unaffected — `getAjv()`'s existing
 * behavior is unchanged for them, and `node:fs` genuinely works fine in
 * those real Node.js contexts.
 */
let precompiledOutputValidators: Record<string, unknown> | null = null;

export function setPrecompiledOutputValidators(byId: Record<string, unknown>): void {
  precompiledOutputValidators = byId;
}

export function getPrecompiledOutputValidator(schemaId: string): unknown | undefined {
  return precompiledOutputValidators?.[schemaId];
}

export function getAjv(): InstanceType<typeof Ajv2020> {
  if (ajvSingleton) return ajvSingleton;

  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addMetaSchema(draft07MetaSchema);

  const SCHEMAS_DIR = getSchemasDir();
  if (!SCHEMAS_DIR) {
    throw new Error('Schemas directory not available in this environment');
  }

  const files: string[] = [];
  for (const dir of ['common', 'services']) {
    const full = join(SCHEMAS_DIR, dir);
    for (const f of readdirSync(full)) {
      if (f.endsWith('.schema.json')) files.push(join(full, f));
    }
  }
  files.push(join(SCHEMAS_DIR, 'proof-carrying-context.schema.json'));

  for (const file of files) {
    const schema = JSON.parse(readFileSync(file, 'utf-8'));
    ajv.addSchema(schema);
  }

  ajvSingleton = ajv;
  return ajv;
}

/** service_id -> output schema $id, derived from schemas/MANIFEST.json's
 * naming convention (services/<name>-output.schema.json). */
const SERVICE_ID_TO_SCHEMA_FILE: Record<string, string> = {
  'company_evidence_graph.v1': 'company-evidence-output.schema.json',
  'web_context_verified.v1': 'web-context-output.schema.json',
  'document_evidence_json.v1': 'document-evidence-output.schema.json',
  'verify_agent_output.v1': 'agent-verification-output.schema.json',
  // SUN-1000 checkpoint 1M: v2 shares the identical output schema file —
  // output semantics are unchanged (checkpoint 1L section 7).
  'company_evidence_graph.v2': 'company-evidence-output.schema.json',
  'web_context_verified.v2': 'web-context-output.schema.json',
  'document_evidence_json.v2': 'document-evidence-output.schema.json',
  'verify_agent_output.v2': 'agent-verification-output.schema.json',
};

/** SUN-1200 checkpoint F (P0-A): every one of this repository's schema
 * files uses the exact, uniform `$id` convention
 * `https://siteborne.net/schemas/<dir>/<filename>` (confirmed directly
 * against every `schemas/services/*.schema.json` file's own `$id`) — so
 * this derivation needs no runtime file read at all. Proven, not
 * assumed: `schema-registry-derived-id.test.ts` asserts this derivation
 * matches every real output schema file's actual committed `$id`, so any
 * future schema that broke the convention would fail that test rather
 * than silently drift. */
export function getOutputSchemaId(serviceId: string): string | null {
  const file = SERVICE_ID_TO_SCHEMA_FILE[serviceId];
  if (!file) return null;
  return `https://siteborne.net/schemas/services/${file}`;
}

export function knownServiceIds(): string[] {
  return Object.keys(SERVICE_ID_TO_SCHEMA_FILE);
}

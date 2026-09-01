/**
 * SUN-1221E6R-H2B2-R1 — proves the dedicated Workflow host
 * (`apps/edge-api/src/workflow-host-entrypoint.ts`) registers the
 * build-time-precompiled output-schema validators at module load, exactly
 * like the two real production API route entrypoints already do.
 *
 * Root cause (first real H2B2 payment attempt, evidence commit `3984aff`):
 * the host never called `setPrecompiledOutputValidators`, so
 * `SchemaVerifier` (`packages/verification/src/verifiers/schema-verifier.ts`)
 * fell through to `getAjv()`'s runtime AJV-compilation path, which throws
 * `EvalError: Code generation from strings disallowed for this context`
 * inside the real Cloudflare Workers isolate (Workflows execute in the
 * same kind of isolate as ordinary Worker code).
 *
 * This test imports the REAL, unmodified host entrypoint module — the
 * exact file `wrangler.paid-continuation-runtime.toml`'s `main` points at
 * — not a fixture or a copy, so module-load side effects (or their
 * absence) are exactly what a real Worker isolate would observe.
 */
import { describe, expect, it } from 'vitest';
import {
  getPrecompiledOutputValidator,
  getOutputSchemaId,
} from '@siteborne/verification';

describe('SUN-1221E6R-H2B2-R1: dedicated Workflow host precompiled-validator registration', () => {
  it('registers the web_context_verified.v2 precompiled output validator at host module load', async () => {
    // Importing the real host entrypoint module is the module-load event
    // itself — in a real Worker isolate this runs exactly once, before any
    // request/Workflow-instance is ever handled.
    await import('../src/workflow-host-entrypoint');

    const schemaId = getOutputSchemaId('web_context_verified.v2');
    expect(schemaId).toBeTruthy();

    const validate = getPrecompiledOutputValidator(schemaId as string);

    // Before the fix: undefined -- SchemaVerifier falls through to
    // getAjv().getSchema(), which performs runtime AJV compilation and
    // throws EvalError inside a real Workers isolate. This is the exact
    // defect the first real H2B2 payment attempt hit.
    expect(validate).toBeDefined();
    expect(typeof validate).toBe('function');
  });

  it('the registered validator actually validates web_context_verified.v2 output (not a stub)', async () => {
    await import('../src/workflow-host-entrypoint');

    const schemaId = getOutputSchemaId('web_context_verified.v2') as string;
    const validate = getPrecompiledOutputValidator(schemaId) as
      | ((data: unknown) => boolean)
      | undefined;
    expect(validate).toBeDefined();

    // A structurally invalid candidate must be rejected -- proves this is
    // a real schema validator, not an always-true placeholder.
    const rejected = validate!({ not: 'a valid PCC document' });
    expect(rejected).toBe(false);
  });
});

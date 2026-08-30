/**
 * SUN-1216 checkpoint V — PRE-UPLOAD RESIDUAL ADJUDICATION, Finding A.
 *
 * `packages/service-runtime/src/context.ts`'s `buildServiceContext`
 * defaults `clock`/`artifact_store`/`audit` to
 * `createTestClock()`/`createTestArtifactStore()`/`createTestServiceAuditSink()`
 * via `??` when the corresponding override is omitted. Those three test
 * helpers are therefore present in the real production bundle's source
 * text (`buildServiceContext`'s own compiled function body references
 * them). This test proves, structurally, that their *invocation* is
 * unreachable from the real production entrypoint today: the one and
 * only production-reachable caller of `buildServiceContext`
 * (`verify-agent-output-v2-production-executor.ts`) supplies `clock`,
 * `artifact_store`, and `audit` as literal, unconditional function-call
 * expressions -- never a value that can be `undefined` -- so the `??`
 * right-hand side can never evaluate at that call site, by JavaScript
 * operator semantics (not by present configuration/argument choice).
 *
 * This does not claim `buildServiceContext` itself is safe against a
 * FUTURE caller that forgets to supply one of these three fields -- it
 * is a shared, exported, pre-existing convenience constructor whose own
 * API shape permits silent fixture-defaulting on omission, and that
 * property predates this checkpoint. That structural risk is disclosed
 * separately in the closure report as a non-blocking observation, not
 * hidden by this test's scope.
 *
 * SUN-1221C added a SECOND production-reachable caller,
 * `web-context-v2-production-executor.ts`, built to mirror this exact
 * audited pattern (see its own doc comment). This file was extended
 * from "the one" to "each of the two" audited call sites -- both must
 * independently pass the same non-nullable-expression check, and the
 * exhaustive walk's exemption list grew from one file to two, not to a
 * wildcard.
 *
 * SUN-1221E5Q added `dev-diagnostics/webctx-remote-diagnostic.ts`, a THIRD
 * `buildServiceContext` caller -- but not a third production-reachable one.
 * It is categorically the same kind of exclusion `paid-services.ts` and
 * `scripts/` already get below ("never part of the real bundle"), proven
 * independently by that file's own non-reachability suite
 * (`dev-diagnostics-webctx-remote.test.ts`: nothing under `apps/edge-api/src`
 * imports it, and the real production app 404s on its route). It is never
 * bundled, never deployed, never reachable except via a one-off
 * `wrangler dev --remote` CLI invocation pointed at it directly -- so it is
 * excluded from this walk below rather than added to `AUDITED_PATHS`, and
 * this exhaustive walk's exemption list grew from two directories to three,
 * still not a wildcard.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { describe, expect, it } from 'vitest';

const EXECUTOR_PATH = fileURLToPath(
  new URL('./verify-agent-output-v2-production-executor.ts', import.meta.url)
);
const WEB_CONTEXT_EXECUTOR_PATH = fileURLToPath(
  new URL('./web-context-v2-production-executor.ts', import.meta.url)
);

/** Every `.ts` file under `apps/edge-api/src` that is reachable from the
 * real production entrypoint's own import graph starts at `index.ts`.
 * Rather than re-implement a module resolver, this walks the whole
 * `control-plane` + top-level `src` tree (deliberately over-inclusive --
 * a superset of what's truly reachable) and asserts NO file other than
 * the one known, audited call site calls `buildServiceContext(` with an
 * object literal that omits `clock`, `artifact_store`, or `audit` --
 * except files under `paid-services.ts`'s own fixture module, test
 * files, scripts, and `dev-diagnostics/`, which are never part of the real
 * bundle (proven separately by the bundle-isolation checks in
 * scripts/test-worker-runtime.mts, and, for `dev-diagnostics/` specifically,
 * by `dev-diagnostics-webctx-remote.test.ts`). */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'generated') continue;
      out.push(...walk(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('SUN-1216 residual adjudication: buildServiceContext fixture-default reachability (Finding A)', () => {
  it('the one production-reachable call site supplies clock/artifact_store/audit as unconditional, non-nullable expressions (never able to trigger the ?? fixture fallback)', () => {
    const source = readFileSync(EXECUTOR_PATH, 'utf8');
    const callMatch = source.match(
      /buildServiceContext\('verify_agent_output\.v2',\s*\{([\s\S]*?)\}\s*\);/
    );
    expect(callMatch).not.toBeNull();
    const callBody = callMatch![1];

    // Each of the three fields must be present and bound to a literal
    // function-call expression -- `name()` or `nameFn()` -- never a
    // bare identifier (which could be undefined/optional), never a
    // ternary, never omitted.
    for (const field of ['clock', 'artifact_store', 'audit']) {
      const fieldMatch = callBody.match(new RegExp(`${field}:\\s*([a-zA-Z0-9_]+\\(\\))`));
      expect(
        fieldMatch,
        `field "${field}" must be a direct nullary call expression`
      ).not.toBeNull();
    }
  });

  it('SUN-1221C: the second audited call site (web_context_verified.v2) also supplies clock/artifact_store/audit as unconditional, non-nullable expressions', () => {
    const source = readFileSync(WEB_CONTEXT_EXECUTOR_PATH, 'utf8');
    const callMatch = source.match(
      /buildServiceContext\('web_context_verified\.v2',\s*\{([\s\S]*?)\}\s*\);/
    );
    expect(callMatch).not.toBeNull();
    const callBody = callMatch![1];

    for (const field of ['artifact_store', 'audit']) {
      const fieldMatch = callBody.match(new RegExp(`${field}:\\s*([a-zA-Z0-9_]+\\(\\))`));
      expect(
        fieldMatch,
        `field "${field}" must be a direct nullary call expression`
      ).not.toBeNull();
    }

    // `clock` is passed as a shorthand property here (this executor reuses
    // the SAME clock instance for both buildServiceContext and
    // PublicHttpAdapter, a deliberate improvement over constructing two
    // separate instances) -- verify the shorthand is present, AND that the
    // binding it refers to is itself an unconditional, non-nullable
    // nullary-call const declaration, never a param/optional value.
    expect(callBody, 'clock must be present, as a shorthand property or field: expr').toMatch(
      /\bclock\b/
    );
    expect(
      source,
      'clock must be bound via an unconditional, non-nullable nullary-call const declaration'
    ).toMatch(/const clock = [a-zA-Z0-9_]+\(\);/);
  });

  it('no OTHER production-reachable source file (excluding paid-services.ts, tests, and scripts) calls buildServiceContext with clock/artifact_store/audit omitted', () => {
    const srcRoot = dirname(dirname(dirname(EXECUTOR_PATH))); // apps/edge-api/src
    const files = walk(srcRoot).filter(
      (f) =>
        !f.includes('/routes/paid-services.ts') &&
        !f.includes('/scripts/') &&
        !f.includes('/dev-diagnostics/')
    );
    const AUDITED_PATHS = new Set([EXECUTOR_PATH, WEB_CONTEXT_EXECUTOR_PATH]);
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (!source.includes('buildServiceContext(')) continue;
      if (AUDITED_PATHS.has(file)) continue; // audited above (both call sites)
      offenders.push(file);
    }
    expect(
      offenders,
      `unexpected buildServiceContext call site(s) outside the two audited executors: ${offenders.join(', ')}`
    ).toEqual([]);
  });
});

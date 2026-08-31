/**
 * SUN-1221E6R-H2AWI-2 — a vitest-only module-resolution shim for
 * `cloudflare:workers` (aliased in the root `vitest.config.ts`,
 * `cloudflare:workers` -> this file), mirroring the exact, already-accepted
 * `cloudflare:sockets` shim precedent (SUN-1221C,
 * `apps/edge-api/tests/support/cloudflare-sockets-shim.ts`).
 *
 * `cloudflare:workers` is a real Workers-runtime built-in with no npm
 * package -- it does not exist as a resolvable module under plain
 * Node/vitest at all, so any test that merely IMPORTS
 * `paid-continuation-workflow.ts` (which statically imports
 * `WorkflowEntrypoint` from it as a base class for the real, future-wired
 * `PaidContinuationWorkflow` entrypoint) would otherwise crash at
 * module-load time before any test body even runs.
 *
 * Unlike the `cloudflare:sockets` shim (a deliberate throw-on-use stub,
 * because no test should ever reach a real socket), `WorkflowEntrypoint`
 * itself is inert at construction -- extending it and never invoking the
 * platform-only `run()` dispatch path performs no I/O. This shim is
 * therefore a genuine, minimal structural stand-in (constructor stores
 * `ctx`/`env`, nothing else) rather than a throw stub. Every test in this
 * checkpoint exercises the pure, dependency-injected orchestration function
 * (`runPaidContinuationWorkflow`) directly with fake `WorkflowStep`/
 * `WorkflowEvent` doubles -- never `new PaidContinuationWorkflow(...)` --
 * so this shim's only job is to let the module load without crashing.
 *
 * `wrangler`/esbuild's real production bundling never consults this file or
 * `vitest.config.ts`'s alias map at all -- it resolves the real
 * `cloudflare:workers` platform module natively, unaffected by this shim.
 */
export class WorkflowEntrypoint<Env = unknown, T = unknown> {
  protected ctx: unknown;
  protected env: Env;

  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  run(_event: unknown, _step: unknown): Promise<unknown> {
    return Promise.reject(
      new Error(
        'cloudflare-workers-shim: WorkflowEntrypoint.run() base implementation was actually ' +
          'invoked under vitest -- every real subclass overrides run(); this should never happen'
      )
    );
  }
}

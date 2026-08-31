/**
 * SUN-1221E6R-H2AWI-2 — a minimal, locally-scoped ambient declaration for
 * `cloudflare:workers`, mirroring the already-accepted
 * `types/cloudflare-sockets.d.ts` precedent (SUN-1221C) exactly, for the
 * exact same reason documented there: `@cloudflare/workers-types`'s own
 * root `index.d.ts` DOES declare this module, but pulling in that
 * package's full global surface (via a `/// <reference types=...>` or by
 * relying on transitive named-type imports resolving it) collides with
 * this codebase's own hand-rolled, more precise binding types in
 * `control-plane/config/env.ts`. Confirmed directly this checkpoint: `tsc
 * --project tsconfig.json` reports `Cannot find module 'cloudflare:workers'`
 * for a plain `import { WorkflowEntrypoint } from 'cloudflare:workers'`
 * even though `env.ts` already imports named types from
 * `@cloudflare/workers-types` elsewhere in the same program — this
 * project's established pattern is a narrow local declaration, not
 * debugging why the global one isn't merging.
 *
 * A brand-new ambient module declaration (as opposed to an augmentation of
 * an already-known module) must live in a file with no top-level
 * `import`/`export` of its own — this file is deliberately that: a pure
 * ambient `.d.ts`, picked up by the ordinary `src/**\/*` tsconfig
 * `include` glob like any other file, no `types` array entry needed.
 *
 * The shape below is a strict subset of the real `cloudflare:workers`
 * module (verified directly against `@cloudflare/workers-types`'s
 * `WorkflowEntrypoint` declaration): only the constructor/`run` shape this
 * checkpoint's `PaidContinuationWorkflow` entrypoint class actually needs.
 */
declare module 'cloudflare:workers' {
  export abstract class WorkflowEntrypoint<Env = unknown, T = unknown> {
    protected ctx: unknown;
    protected env: Env;
    constructor(ctx: unknown, env: Env);
    run(event: Readonly<{ payload: Readonly<T> }>, step: unknown): Promise<unknown>;
  }
}

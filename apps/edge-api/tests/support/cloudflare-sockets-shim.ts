/**
 * SUN-1221C — a vitest-only module-resolution shim for `cloudflare:sockets`
 * (aliased in `vitest.config.ts`, `cloudflare:sockets` -> this file).
 *
 * `cloudflare:sockets` is a real Workers-runtime built-in with no npm
 * package -- it does not exist as a resolvable module under plain
 * Node/vitest at all, so any test that merely IMPORTS
 * `web-context-v2-cdp-composition.ts` (which statically imports it to
 * build the real, DNS-rebinding-safe `SafeSocketHttpClient`) would
 * otherwise crash at module-load time before any test body even runs.
 *
 * `connect` here throws immediately if actually invoked -- deliberately,
 * not a working fake. No test in this repository should ever reach a
 * REAL socket connection this way: `dns-rebinding.test.ts` already proves
 * the DNS-safe connect logic itself via an injected `ConnectFn` (a real,
 * working fake there, never this shim), and every composition-level test
 * that builds a `web_context_verified.v2` route config only ever proves
 * the 402 CHALLENGE shape -- `createX402ServiceRoute`'s executor (the
 * only code path that would actually call `connect()`) never runs until
 * a real payment is verified, which no unit/integration test in this
 * repository ever does. A throw here is the correct signal if that
 * invariant is ever accidentally broken.
 *
 * `wrangler`/esbuild's real production bundling never consults this file
 * or `vitest.config.ts`'s alias map at all -- it resolves the real
 * `cloudflare:sockets` platform module natively, unaffected by this shim.
 */
export function connect(): never {
  throw new Error(
    'cloudflare-sockets-shim: connect() was actually invoked under vitest -- this should never ' +
      'happen (no test in this repository is expected to reach a real socket connection); if a ' +
      'new test genuinely needs one, inject a real fake ConnectFn instead of relying on this shim'
  );
}

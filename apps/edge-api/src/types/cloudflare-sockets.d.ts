/**
 * SUN-1221C — a minimal, locally-scoped ambient declaration for
 * `cloudflare:sockets`, used only by `web-context-v2-cdp-composition.ts`
 * (via `../cloudflare-sockets-ambient.ts`) to construct the real,
 * DNS-rebinding-safe `SafeSocketHttpClient`.
 *
 * `@cloudflare/workers-types`'s own root `index.d.ts` DOES declare this
 * module (confirmed by direct inspection), but pulling it in globally via
 * `/// <reference types="@cloudflare/workers-types" />` also globally
 * declares `D1Result`/`R2Objects`/`Queue`/`KVNamespaceListResult`/etc,
 * which collide with this codebase's own hand-rolled, more precise
 * binding types in `control-plane/config/env.ts` (proven directly: adding
 * that reference produced ~20 duplicate-identifier/incompatible-type
 * errors there, none pre-existing). This narrow declaration is enough to
 * type-check the one real import this checkpoint needs, without pulling
 * in the rest of that package's global surface.
 *
 * A brand-new ambient module declaration (as opposed to an augmentation
 * of an already-known module) must live in a file with no top-level
 * `import`/`export` of its own -- this file is deliberately that: a pure
 * ambient `.d.ts`, picked up by the ordinary `src/**\/*` tsconfig
 * `include` glob like any other file, no `types` array entry needed.
 *
 * The shape below is a strict subset of the real `cloudflare:sockets`
 * module (verified directly against `@cloudflare/workers-types`):
 * `.writable`/`.readable` are the same standard
 * `WritableStream<Uint8Array>`/`ReadableStream<Uint8Array>` already used
 * throughout this codebase, and `startTls`'s `expectedServerHostname`
 * option is the exact real, typed field this checkpoint's DNS-rebinding
 * fix depends on (confirmed present on the real platform's `TlsOptions`).
 */
declare module 'cloudflare:sockets' {
  export interface SocketOptions {
    secureTransport?: 'off' | 'on' | 'starttls';
    allowHalfOpen?: boolean;
  }
  export interface SocketAddress {
    hostname: string;
    port: number;
  }
  export interface TlsOptions {
    expectedServerHostname?: string;
  }
  export interface Socket {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
    opened: Promise<{ remoteAddress?: string; localAddress?: string }>;
    closed: Promise<void>;
    close(): Promise<void>;
    startTls(options?: TlsOptions): Socket;
  }
  export function connect(address: SocketAddress | string, options?: SocketOptions): Socket;
}

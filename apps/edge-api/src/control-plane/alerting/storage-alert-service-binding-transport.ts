/**
 * SUN-1222C storage-alert Service Binding transport.
 *
 * Replaces `buildHttpsWebhookTransport(STORAGE_RECLAMATION_ALERT_WEBHOOK_URL)`
 * as the `StorageAlertTransport` implementation used by
 * `reclaimStaleArtifactsScheduled` (see `../../index.ts`). Motivation: the
 * dedicated `siteborne-storage-alert-receiver` Worker is designed to be
 * internal-only (no public Custom Domain, no workers.dev route) — Cloudflare
 * Service Bindings are the documented mechanism for one Worker to invoke
 * another directly, without any public URL, DNS record, or TLS edge
 * certificate:
 * https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
 *
 * This module deliberately mirrors `buildHttpsWebhookTransport`'s shape
 * (`(payload) => Promise<{ delivered: boolean }>`, matching
 * `StorageAlertTransport` in `storage-alert-sweep.ts` exactly) so
 * `runStorageAlertSweep` and its caller's dedup/business logic need no
 * change at all — only the transport construction in
 * `reclaimStaleArtifactsScheduled` swaps from `buildHttpsWebhookTransport`
 * to `buildServiceBindingStorageAlertTransport`.
 *
 * The URL passed to `env.STORAGE_ALERT_RECEIVER.fetch(...)` is a synthetic
 * `Request` target only — Service Binding dispatch never touches public DNS
 * or resolves the hostname; it is routed directly to the bound Worker by
 * Cloudflare's runtime. `https://storage-alert.internal/...` is used here
 * (not `storage-alert.siteborne.net`) specifically so nobody mistakes this
 * for a real, publicly-routable hostname.
 *
 * The path token is appended exactly once per call, never logged: neither
 * this function nor its caller ever place the token or the constructed URL
 * into a thrown error, a console statement, or a returned value.
 */
import type { StorageAlertPayload, StorageAlertTransport } from './storage-alert-sweep';

const DEFAULT_TIMEOUT_MS = 10_000;

export interface BuildServiceBindingStorageAlertTransportOptions {
  readonly timeoutMs?: number;
  /** SUN-1222C qualification-only addendum: additional headers merged into
   * every request this transport instance sends. Exists solely so
   * `storage-alert-qualification-route.ts` can forward the receiver-side
   * `X-Siteborne-Storage-Alert-Qualification` bypass header AFTER its own
   * independent bearer authentication succeeds -- see that route's doc
   * comment and `storage-alert-receiver-entrypoint.ts`'s
   * `STORAGE_ALERT_QUALIFICATION_TOKEN` doc comment for the full bypass
   * contract. `reclaimStaleArtifactsScheduled` (`../../index.ts`) never
   * passes this option -- it has no qualification-token value in scope to
   * pass -- so the normal minute-cron path remains structurally incapable
   * of constructing this header regardless of `r2_delete_failures`. */
  readonly extraHeaders?: Readonly<Record<string, string>>;
}

/**
 * `fetcher` is the Service Binding (`env.STORAGE_ALERT_RECEIVER`, typed
 * `Fetcher` from `@cloudflare/workers-types` at the call site in
 * `../../index.ts`) — typed structurally here with the ambient DOM
 * `RequestInit`/`Response` (only the `fetch` method is used) so this
 * module does not need to import the Cloudflare-specific ambient types
 * itself, and so a test double needs to implement only this one method.
 * `Fetcher.fetch`'s real signature is a stricter, Cloudflare-flavored
 * variant of this (`RequestInit<CfProperties>`) that every real Service
 * Binding fetcher also accepts at runtime — `index.ts` narrows the type at
 * the call site with a single local cast, not by changing this module's
 * public (deliberately DOM-typed, easily-test-doubled) signature.
 */
export interface ServiceBindingFetcher {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export function buildServiceBindingStorageAlertTransport(
  fetcher: ServiceBindingFetcher,
  pathToken: string,
  options: BuildServiceBindingStorageAlertTransportOptions = {}
): StorageAlertTransport {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const extraHeaders = options.extraHeaders ?? {};

  return async function deliver(payload: StorageAlertPayload): Promise<{ delivered: boolean }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher.fetch(
        `https://storage-alert.internal/alert/${encodeURIComponent(pathToken)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...extraHeaders },
          body: JSON.stringify(payload),
          signal: controller.signal,
        }
      );
      // Mirrors `buildHttpsWebhookTransport`'s D12 §18 "2xx only counts as
      // delivered" contract exactly — the receiver returns 202 on success.
      return { delivered: response.status >= 200 && response.status < 300 };
    } catch {
      // Timeout (AbortError) or Service Binding dispatch failure — both are
      // delivery failures, never thrown past this boundary, mirroring
      // `buildHttpsWebhookTransport`'s own discipline.
      return { delivered: false };
    } finally {
      clearTimeout(timeout);
    }
  };
}

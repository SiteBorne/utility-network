/**
 * SUN-1222C-R4 — TEMPORARY storage-alert Service Binding qualification
 * route.
 *
 * Purpose: prove that `siteborne-utility-edge` can reach the internal-only
 * `siteborne-storage-alert-receiver` Worker through the REAL production
 * transport (`buildServiceBindingStorageAlertTransport`, the same function
 * `reclaimStaleArtifactsScheduled` uses in `../../index.ts`) end-to-end,
 * without fabricating a real `r2_delete_failures > 0` condition and without
 * requiring the receiver to have any public Custom Domain, workers.dev
 * route, or DNS record.
 *
 * This module is intentionally temporary scaffolding for one qualification
 * checkpoint (SUN-1222C-R4) — it is not part of the permanent Service
 * Binding migration (see `../alerting/storage-alert-service-binding-transport.ts`
 * and `../../index.ts`'s `reclaimStaleArtifactsScheduled`, both unmodified
 * by this file) and is expected to be reverted once qualification is
 * evidenced.
 *
 * Security properties (all fail-closed to `404`, mirroring
 * `storage-alert-receiver-entrypoint.ts`'s own discipline):
 *   - Authentication is a single opaque bearer secret,
 *     `STORAGE_ALERT_QUALIFICATION_TOKEN`, compared in constant time.
 *     Never provisioned via `[vars]`; never placed in a path or query
 *     string (unlike the receiver's own path-segment token) specifically
 *     so it cannot appear in access logs or Referer headers.
 *   - The token is never echoed, logged, or included in any response body
 *     on any code path, success or failure.
 *   - The request body is never parsed or trusted — the alert payload is
 *     constructed entirely server-side, so no caller input can reach the
 *     receiver, the SMTP transport, or the eventual mailbox content.
 *   - `r2_delete_failures` and `reclaimed_count` are hardcoded to `0`: this
 *     route never reads, computes, or depends on any real reclamation
 *     state, and is structurally incapable of mutating R2, D1, KV, or any
 *     Durable Object — it does not import or call `reclaimStaleArtifacts`,
 *     `runStorageAlertSweep`, or `reclaimStaleArtifactsScheduled`.
 *   - Exactly one Service Binding call per valid request; every invalid
 *     request (wrong method, missing/malformed/wrong bearer, unprovisioned
 *     qualification secret) returns before `env.STORAGE_ALERT_RECEIVER` or
 *     `buildServiceBindingStorageAlertTransport` is ever touched.
 */
import type { Context } from 'hono';
import type { Env } from '../config/env';
import {
  buildServiceBindingStorageAlertTransport,
  type ServiceBindingFetcher,
} from '../alerting/storage-alert-service-binding-transport';
import type { StorageAlertPayload } from '../alerting/storage-alert-sweep';

const NOT_FOUND = () => new Response(null, { status: 404 });
const BEARER_PREFIX = 'Bearer ';

/** Constant-time string comparison — identical discipline to
 * `storage-alert-receiver-entrypoint.ts`'s own `timingSafeEqual`: does not
 * short-circuit on the first mismatched byte, and still touches the full
 * candidate buffer on a length mismatch so response timing cannot be used
 * to recover the token. */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  if (bufA.length !== bufB.length) {
    let dummy = 0;
    for (let i = 0; i < bufB.length; i++) dummy |= bufB[i];
    return dummy === -1; // unreachable-true; always false in practice
  }
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) {
    diff |= bufA[i] ^ bufB[i];
  }
  return diff === 0;
}

export async function storageAlertQualificationRoute(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  const env = c.env;

  const expectedToken = env.STORAGE_ALERT_QUALIFICATION_TOKEN;
  if (!expectedToken) return NOT_FOUND(); // fail closed if unprovisioned

  const authHeader = c.req.header('authorization') ?? c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) return NOT_FOUND();

  const providedToken = authHeader.slice(BEARER_PREFIX.length);
  if (!timingSafeEqual(providedToken, expectedToken)) return NOT_FOUND();

  const receiver = env.STORAGE_ALERT_RECEIVER;
  const pathToken = env.STORAGE_ALERT_PATH_TOKEN;
  if (!receiver || !pathToken) return NOT_FOUND(); // fail closed if unprovisioned

  const payload: StorageAlertPayload = {
    event: 'siteborne.storage_reclamation.critical_alert',
    operation_class: 'artifact_reclamation_r2_delete_failure',
    r2_delete_failures: 0,
    reclaimed_count: 0,
    swept_at: new Date().toISOString(),
    sample_content_hashes: [`SITEBORNE-SMTP-PRODUCTION-QUALIFICATION-${crypto.randomUUID()}`],
  };

  const transport = buildServiceBindingStorageAlertTransport(
    // Same narrowing rationale as `../../index.ts`'s
    // `reclaimStaleArtifactsScheduled`: `Fetcher.fetch`'s Cloudflare-typed
    // signature is a stricter variant of the ambient DOM
    // `RequestInit`/`Response` that `ServiceBindingFetcher` deliberately
    // uses; every real Service Binding fetcher accepts a plain `string`
    // URL and ordinary `RequestInit` at runtime regardless.
    receiver as unknown as ServiceBindingFetcher,
    pathToken
  );

  try {
    const outcome = await transport(payload);
    if (!outcome.delivered) {
      // Sanitized failure: no token, no payload, no transport internals.
      return new Response(null, { status: 502 });
    }
    return new Response(null, { status: 202 });
  } catch {
    // Never thrown past this boundary in practice (the transport itself
    // never throws — see its own doc comment) but handled defensively so
    // no internal error detail can ever leak into the response.
    return new Response(null, { status: 502 });
  }
}

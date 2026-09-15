/**
 * SUN-1222C-STORAGE-ALERT-RECEIVER-LOCAL-BUILD
 *
 * Dedicated, minimal Cloudflare Worker whose only job is to receive the
 * existing `StorageAlertPayload` (see
 * `control-plane/alerting/storage-alert-sweep.ts`) from
 * `siteborne-utility-edge`'s `buildServiceBindingStorageAlertTransport`
 * (see `control-plane/alerting/storage-alert-service-binding-transport.ts`)
 * over a Cloudflare Service Binding -- not public HTTPS -- and forward it
 * as a plain-text operator email. This Worker is internal-only: it has no
 * `workers_dev` subdomain, no preview URLs, no routes, and no Custom
 * Domain (see `wrangler.storage-alert-receiver.toml`'s own doc comment for
 * why the earlier public-ingress design was retired).
 *
 * Transport: direct authenticated SMTP to the operator's own IONOS
 * mailbox (`storage@alerts.siteborne.net` -> `hello@siteborne.com`) over
 * `cloudflare:sockets`, via `smtp/ionos-smtp-transport.ts` -- implicit TLS
 * on port 465, then `AUTH PLAIN` (migrated from STARTTLS on port 587 by
 * SUN-1222C-SMTP-ROOT-CAUSE, after a live non-delivery probe isolated the
 * 587 failure to the STARTTLS upgrade step specifically and a second probe
 * proved 465 completes cleanly -- see that module's own doc comment for
 * both probes' results and the full current protocol sequence). This
 * replaced an earlier design built on Cloudflare Email Routing / the
 * `send_email` binding, abandoned before deployment once the operator
 * chose the IONOS-SMTP architecture instead.
 *
 * NOT YET DEPLOYED. This file is frozen local configuration only, exactly
 * like `workflow-host-entrypoint.ts` before its own deploy authorization --
 * see `wrangler.storage-alert-receiver.toml` for the full non-deployment
 * rationale and the exact separately-gated steps required before this may
 * ever be uploaded.
 *
 * Capability surface, by construction:
 *   - NO D1, NO R2, NO Workflow, NO Queue, NO CDP/facilitator/payment
 *     credential, NO provider adapter, NO public data API, NO Cloudflare
 *     Email Routing / `send_email` binding.
 *   - Exactly one secret, `ALERT_PATH_TOKEN`, used only as an unguessable
 *     URL-path capability token (never a header, to work unmodified with
 *     `buildHttpsWebhookTransport`, which sends only a JSON body and a
 *     JSON content-type header -- no bearer-header support to rely on).
 *   - Exactly one other secret, `IONOS_SMTP_PASSWORD`, the IONOS mailbox
 *     password -- never logged, never placed in a `[vars]` entry, sourced
 *     only from `env` at send time. NOT YET PROVISIONED (see
 *     `wrangler.storage-alert-receiver.toml`).
 *
 * Security posture:
 *   - Every non-matching path, wrong method (on a matching path), or wrong
 *     token returns an IDENTICAL 404 -- deliberately not 405/401/403, so a
 *     network observer or timing/response-shape oracle cannot distinguish
 *     "wrong token" from "wrong path" from "right token, wrong method".
 *   - Token comparison is constant-time (`timingSafeEqual` below) to avoid
 *     a byte-at-a-time timing side channel on the secret path segment.
 *   - The request body is bounded (`MAX_BODY_BYTES`) via a streaming read
 *     that aborts as soon as the cap is exceeded, independent of any
 *     (spoofable) `Content-Length` header.
 *   - Nothing this module receives is ever logged: not the path, not the
 *     token, not the raw body, not the parsed payload, not the rendered
 *     email text. On failure this returns a bare non-2xx status with no
 *     response body content derived from the request.
 *
 * SUN-1222C closure: the `POST /control/<token>` (Service-Binding/timeout
 * machinery isolation) and `POST /diagnostic/<token>` (non-delivery SMTP
 * connectivity probes, both port 587 STARTTLS and port 465 implicit TLS)
 * routes that previously lived here have been removed now that the SMTP
 * root-cause investigation they existed for is closed -- the STARTTLS
 * upgrade step on port 587 was isolated as the failure point, port 465
 * implicit TLS was proven clean, and the Service Binding timeout/cleanup
 * machinery was proven correct (both live, via those diagnostics, and in
 * the permanent Miniflare/workerd regression suite, which needs no live
 * route). `smtp/ionos-smtp-diagnostic.ts`, `smtp/ionos-smtp-implicit-tls-diagnostic.ts`,
 * and their own unit tests remain on disk as the forensic/regression record
 * of that investigation; they are simply no longer imported or reachable
 * from this Worker's `fetch` handler. See git history for the removed
 * routes' implementation.
 */

import { z } from 'zod';
import { sendStorageAlertViaIonosSmtp } from './smtp/ionos-smtp-transport';

/** Mirrors `StorageAlertPayload` in
 * `control-plane/alerting/storage-alert-sweep.ts` exactly -- this module
 * intentionally does not import that file (this Worker is a separate
 * deployable with its own, independent dependency graph; see the "no
 * shared runtime surface between the three scripts" rationale in
 * `wrangler.settlement-alert-worker.toml`), so the shape is duplicated
 * here as the wire contract, not the TypeScript type. */
const StorageAlertPayloadSchema = z
  .object({
    event: z.literal('siteborne.storage_reclamation.critical_alert'),
    operation_class: z.literal('artifact_reclamation_r2_delete_failure'),
    r2_delete_failures: z.number().int().nonnegative(),
    reclaimed_count: z.number().int().nonnegative(),
    swept_at: z.string().min(1),
    sample_content_hashes: z.array(z.string()).max(10),
  })
  .strict();

export type StorageAlertPayload = z.infer<typeof StorageAlertPayloadSchema>;

/** Comfortably above the largest legitimate payload (10 hashes + a handful
 * of small fields is well under 1 KiB serialized) while staying small
 * enough that no legitimate caller is ever at risk of being truncated. */
const MAX_BODY_BYTES = 8 * 1024;

export interface Env {
  readonly ALERT_PATH_TOKEN?: string;
  /** IONOS mailbox password for `storage@alerts.siteborne.net`. Absent
   * until separately provisioned via
   * `wrangler secret put IONOS_SMTP_PASSWORD --config
   * wrangler.storage-alert-receiver.toml`; the `fetch()` handler below
   * fails closed (no SMTP connection attempted) when it is undefined. */
  readonly IONOS_SMTP_PASSWORD?: string;
  /** SUN-1222C receiver-side delivery containment. Only the exact string
   * `"true"` permits normal `/alert/<token>` requests to reach
   * `sendStorageAlertViaIonosSmtp`; absent, `"false"`, or any other value
   * fails closed. Deliberately NOT set in `wrangler.storage-alert-receiver.toml`
   * `[vars]` -- an ordinary `versions upload`/`versions secret put` candidate
   * can therefore never enable autonomous production email merely by
   * existing, mirroring the fail-closed-absence design already proven for
   * `PAID_ROUTES_ENABLED` and its siblings on `siteborne-utility-edge` (see
   * `control-plane/config/production-payment.ts`). This is the sole
   * mechanism for a real send -- the one narrow, separately-authorized
   * qualification bypass that once let a single supervised, governed-payload
   * request through while this flag was absent/false has been removed now
   * that qualification is complete; see git history for its
   * implementation. */
  readonly STORAGE_ALERT_DELIVERY_ENABLED?: string;
}

// SUN-1222C closure: `STORAGE_ALERT_QUALIFICATION_TOKEN`, the
// `X-Siteborne-Storage-Alert-Qualification` header it gated, and
// `isGovernedQualificationPayload` (the narrow governed-payload check that
// bounded what that bypass could push through) have been removed now that
// the one supervised qualification attempt they existed for is complete and
// mailbox-confirmed. The permanent, sole mechanism for a real send is now
// `STORAGE_ALERT_DELIVERY_ENABLED === 'true'` below -- see git history for
// the removed bypass's implementation.

/** Constant-time string comparison -- deliberately does not short-circuit
 * on the first mismatched byte, so response timing cannot be used to
 * recover the token one byte at a time. Falls back to always-false on any
 * length mismatch (also without leaking *which* length via early return
 * timing beyond the unavoidable, non-secret-dependent length check
 * itself). */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  if (bufA.length !== bufB.length) {
    // Still touch bufB fully so this branch's cost doesn't itself leak
    // information beyond the (non-secret) fact that lengths differ.
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

/** Reads the body up to `MAX_BODY_BYTES`, returning `undefined` (and never
 * having buffered more than the cap) if the true byte length exceeds it --
 * independent of any `Content-Length` header, which is not trusted. */
async function readBoundedBody(request: Request): Promise<string | undefined> {
  const body = request.body;
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return undefined;
      }
      chunks.push(value);
    }
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

/** Renders only the already-approved, non-sensitive fields -- no artifact
 * content, no R2 key, no content hash beyond the payload's own bounded
 * sample list, no credential, no payment/settlement material (none of
 * which this payload shape can carry in the first place; this comment
 * documents the invariant, it does not enforce anything new). */
function renderAlertText(payload: StorageAlertPayload): string {
  const lines = [
    'SITEBORNE storage reclamation critical alert',
    '',
    `event: ${payload.event}`,
    `operation_class: ${payload.operation_class}`,
    `r2_delete_failures: ${payload.r2_delete_failures}`,
    `reclaimed_count: ${payload.reclaimed_count}`,
    `swept_at: ${payload.swept_at}`,
    `sample_content_hashes (${payload.sample_content_hashes.length}): ${payload.sample_content_hashes.join(', ') || '(none)'}`,
  ];
  return lines.join('\n');
}

/** Message construction itself (headers, dot-stuffing, CRLF) lives in
 * `smtp/smtp-message.ts`, invoked from inside `sendStorageAlertViaIonosSmtp`
 * -- this module only supplies the envelope (`SMTP_HOST`/.../`TO_ADDRESS`
 * below) and the already-rendered plain-text body. */
const SMTP_HOST = 'smtp.ionos.com';
const IMPLICIT_TLS_PORT = 465;
const FROM_ADDRESS = 'storage@alerts.siteborne.net';
const TO_ADDRESS = 'hello@siteborne.com';
const SUBJECT = 'SITEBORNE: storage reclamation critical alert';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const NOT_FOUND = () => new Response(null, { status: 404 });

    if (request.method !== 'POST') return NOT_FOUND();

    const token = env.ALERT_PATH_TOKEN;
    if (!token) return NOT_FOUND(); // fail closed if unprovisioned

    const url = new URL(request.url);

    const match = /^\/alert\/([^/]+)$/.exec(url.pathname);
    if (!match) return NOT_FOUND();

    const providedToken = match[1];
    if (!timingSafeEqual(providedToken, token)) return NOT_FOUND();

    const rawBody = await readBoundedBody(request);
    if (rawBody === undefined) return new Response(null, { status: 413 });

    let parsedJson: unknown;
    try {
      parsedJson = rawBody.length > 0 ? JSON.parse(rawBody) : {};
    } catch {
      return new Response(null, { status: 400 });
    }

    const parsed = StorageAlertPayloadSchema.safeParse(parsedJson);
    if (!parsed.success) return new Response(null, { status: 400 });

    // SUN-1222C delivery containment gate. Ordered AFTER path-token and
    // schema validation (so a malformed/unauthenticated request still gets
    // 404/400, not a signal that delivery is disabled) and BEFORE any
    // SMTP-transport code is reached -- no socket, no `IONOS_SMTP_PASSWORD`
    // read, on any path through this block. This is now the sole gate on a
    // real send: the qualification bypass that once let one supervised,
    // governed-payload request through while this flag was absent/false has
    // been removed now that qualification is complete -- see this file's
    // own history for that bypass's implementation.
    const normalDeliveryEnabled = env.STORAGE_ALERT_DELIVERY_ENABLED === 'true';
    if (!normalDeliveryEnabled) {
      // 503, not 502: this is an administrative/containment decision, not a
      // transport failure -- distinguishable in logs from a real SMTP
      // failure below, and (like every response on this path) triggers no
      // retry logic: `reclaimStaleArtifactsScheduled`'s Service Binding
      // transport already treats any non-2xx identically as
      // `{ delivered: false }` with no retry of its own, and reclamation
      // state itself was already committed to R2/D1 before this alert call
      // was ever made, so this response cannot corrupt it either way.
      return new Response(null, { status: 503 });
    }

    const bodyText = renderAlertText(parsed.data);

    const password = env.IONOS_SMTP_PASSWORD;
    if (!password) return new Response(null, { status: 502 }); // fail closed: unprovisioned

    try {
      await sendStorageAlertViaIonosSmtp(
        {
          host: SMTP_HOST,
          // SUN-1222C-SMTP-ROOT-CAUSE port migration: production delivery
          // uses implicit TLS on 465, not STARTTLS on 587 -- see
          // `smtp/ionos-smtp-transport.ts`'s own doc comment for the two
          // live probes that isolated the 587 failure to the STARTTLS
          // upgrade step and proved 465 completes cleanly.
          port: IMPLICIT_TLS_PORT,
          username: FROM_ADDRESS,
          password,
          from: FROM_ADDRESS,
          to: TO_ADDRESS,
        },
        { subject: SUBJECT, bodyText }
      );
    } catch {
      return new Response(null, { status: 502 });
    }

    return new Response(null, { status: 202 });
  },
};

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
 * `cloudflare:sockets`, via `smtp/ionos-smtp-transport.ts` -- STARTTLS on
 * port 587, then `AUTH PLAIN`. This replaced an earlier design built on
 * Cloudflare Email Routing / the `send_email` binding, abandoned before
 * deployment once the operator chose the IONOS-SMTP architecture instead
 * (see that module's own doc comment for the full protocol sequence).
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
 * SUN-1222C-SMTP-ROOT-CAUSE addendum: `POST /diagnostic/<token>` (same
 * `ALERT_PATH_TOKEN`, same constant-time check, same identical-404
 * discipline for every invalid request) runs `probeIonosSmtpConnectivity`
 * (`smtp/ionos-smtp-diagnostic.ts`) instead of `sendStorageAlertViaIonosSmtp`
 * -- a bounded, non-delivery connectivity probe that never reads
 * `env.IONOS_SMTP_PASSWORD` and structurally cannot authenticate or send
 * mail (see that module's own doc comment). Its JSON response body is
 * safe to return verbatim: every field is either a server-sent reply
 * code/text, a stage name, an elapsed duration, or a boolean -- never a
 * credential, because this path never reads one.
 */

import { z } from 'zod';
import { sendStorageAlertViaIonosSmtp } from './smtp/ionos-smtp-transport';
import {
  probeIonosSmtpConnectivity,
  DEFAULT_OVERALL_TIMEOUT_MS,
} from './smtp/ionos-smtp-diagnostic';
import { withTimeout, StageTimeoutError } from './smtp/smtp-stage-timeout';

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
}

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
const SMTP_PORT = 587;
const FROM_ADDRESS = 'storage@alerts.siteborne.net';
const TO_ADDRESS = 'hello@siteborne.com';
const SUBJECT = 'SITEBORNE: storage reclamation critical alert';

/**
 * SUN-1222C-SMTP-ROOT-CAUSE addendum: `POST /control/<token>?mode=...`
 * (same `ALERT_PATH_TOKEN`, same constant-time check, same identical-404
 * discipline) exercises the Service Binding dispatch/response path and the
 * shared `withTimeout` primitive WITHOUT ever opening a socket -- isolates
 * "does a call across the Service Binding return at all" and "does the
 * timeout/catch machinery itself work" from "is the SMTP/TLS path what's
 * actually hanging". This code path never imports or reaches
 * `cloudflare:sockets`, `env.IONOS_SMTP_PASSWORD`, or
 * `probeIonosSmtpConnectivity`/`sendStorageAlertViaIonosSmtp` -- see the
 * module-level doc comment above for the full capability-surface
 * invariant this addendum preserves.
 */
type ControlMode = 'IMMEDIATE' | 'DELAY_250MS' | 'OVERALL_TIMEOUT';

interface ControlResult {
  readonly control: ControlMode;
  readonly result: 'OK' | 'TIMED_OUT_AS_EXPECTED' | 'UNEXPECTED_RESOLVE' | 'UNEXPECTED_ERROR';
  readonly elapsed_ms: number;
}

/** Never touches a socket, a stream, or any secret -- see this function's
 * call site doc comment. `OVERALL_TIMEOUT` races the exact same
 * `withTimeout` primitive and the exact same duration
 * (`DEFAULT_OVERALL_TIMEOUT_MS`, imported from `ionos-smtp-diagnostic.ts`
 * rather than duplicated) that `probeIonosSmtpConnectivity`'s own
 * `DIAG_OVERALL` stage uses, against a promise that can structurally never
 * resolve -- proving (or disproving) that machinery in complete isolation
 * from any socket/stream involvement. */
async function runControl(mode: ControlMode): Promise<ControlResult> {
  const startedAt = Date.now();
  if (mode === 'IMMEDIATE') {
    return { control: mode, result: 'OK', elapsed_ms: Date.now() - startedAt };
  }
  if (mode === 'DELAY_250MS') {
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    return { control: mode, result: 'OK', elapsed_ms: Date.now() - startedAt };
  }
  // mode === 'OVERALL_TIMEOUT'
  try {
    await withTimeout(
      'CONTROL_OVERALL_TIMEOUT',
      new Promise<never>(() => {}),
      DEFAULT_OVERALL_TIMEOUT_MS
    );
    // Unreachable: the raced promise above never resolves or rejects on
    // its own, so `withTimeout` can only ever settle via its own timeout
    // rejection below. Kept as an explicit, typed branch rather than
    // asserting `never`, so a future change to this helper fails a test
    // instead of failing silently.
    return { control: mode, result: 'UNEXPECTED_RESOLVE', elapsed_ms: Date.now() - startedAt };
  } catch (err) {
    const timedOut = err instanceof StageTimeoutError;
    return {
      control: mode,
      result: timedOut ? 'TIMED_OUT_AS_EXPECTED' : 'UNEXPECTED_ERROR',
      elapsed_ms: Date.now() - startedAt,
    };
  }
}

const CONTROL_MODES: readonly ControlMode[] = ['IMMEDIATE', 'DELAY_250MS', 'OVERALL_TIMEOUT'];
function isControlMode(value: string | null): value is ControlMode {
  return value !== null && (CONTROL_MODES as readonly string[]).includes(value);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const NOT_FOUND = () => new Response(null, { status: 404 });

    if (request.method !== 'POST') return NOT_FOUND();

    const token = env.ALERT_PATH_TOKEN;
    if (!token) return NOT_FOUND(); // fail closed if unprovisioned

    const url = new URL(request.url);

    const controlMatch = /^\/control\/([^/]+)$/.exec(url.pathname);
    if (controlMatch) {
      const providedControlToken = controlMatch[1];
      if (!timingSafeEqual(providedControlToken, token)) return NOT_FOUND();
      const mode = url.searchParams.get('mode');
      if (!isControlMode(mode)) return NOT_FOUND();
      const result = await runControl(mode);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    const diagnosticMatch = /^\/diagnostic\/([^/]+)$/.exec(url.pathname);
    if (diagnosticMatch) {
      const providedDiagnosticToken = diagnosticMatch[1];
      if (!timingSafeEqual(providedDiagnosticToken, token)) return NOT_FOUND();
      const result = await probeIonosSmtpConnectivity({ host: SMTP_HOST, port: SMTP_PORT });
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 502,
        headers: { 'content-type': 'application/json' },
      });
    }

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

    const bodyText = renderAlertText(parsed.data);

    const password = env.IONOS_SMTP_PASSWORD;
    if (!password) return new Response(null, { status: 502 }); // fail closed: unprovisioned

    try {
      await sendStorageAlertViaIonosSmtp(
        {
          host: SMTP_HOST,
          port: SMTP_PORT,
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

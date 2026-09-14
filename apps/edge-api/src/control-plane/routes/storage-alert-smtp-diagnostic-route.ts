/**
 * SUN-1222C-SMTP-ROOT-CAUSE — TEMPORARY storage-alert SMTP connectivity
 * diagnostic route.
 *
 * Purpose: let the operator determine exactly which stage of the IONOS
 * STARTTLS handshake is hanging (the second live qualification attempt
 * observed wallTime=9979ms, cpuTime=4ms, outcome=canceled, zero logs --
 * consistent with a hang somewhere in the SMTP sequence, but not proof of
 * *which* stage) through the REAL production Service Binding path to
 * `siteborne-storage-alert-receiver`, WITHOUT ever authenticating to IONOS
 * or risking a real email send.
 *
 * Deliberately a separate route and a separate bearer secret
 * (`STORAGE_ALERT_SMTP_DIAGNOSTIC_TOKEN`) from
 * `storage-alert-qualification-route.ts`'s `STORAGE_ALERT_QUALIFICATION_TOKEN`:
 * this route can only ever cause the receiver to run
 * `probeIonosSmtpConnectivity` (`POST /diagnostic/<path-token>`, a
 * different receiver path than `/alert/<path-token>`) -- there is no code
 * path here, in the receiver's diagnostic branch, or in
 * `ionos-smtp-diagnostic.ts` itself capable of triggering `AUTH`,
 * `MAIL FROM`, `RCPT TO`, `DATA`, or any email send. Keeping the two
 * tokens distinct means this one can be shared/rotated more liberally
 * without ever risking a stray qualification email.
 *
 * Security properties (identical discipline to the qualification route):
 *   - Authentication is a single opaque bearer secret, compared in
 *     constant time, never provisioned via `[vars]`, never placed in a
 *     path or query string.
 *   - The token is never echoed, logged, or included in any response
 *     body on any code path.
 *   - The request body is never parsed or trusted -- this route takes no
 *     caller input at all.
 *   - Exactly one Service Binding call per valid request; every invalid
 *     request (wrong method, missing/malformed/wrong bearer, unprovisioned
 *     diagnostic secret) returns before `env.STORAGE_ALERT_RECEIVER` is
 *     ever touched.
 *   - The receiver's JSON diagnostic result is returned verbatim: every
 *     field in it is non-secret by construction (see
 *     `ionos-smtp-diagnostic.ts`'s own doc comment) -- a server-sent reply
 *     code/text, a stage name, an elapsed duration, or a boolean.
 *
 * Expected to be reverted (alongside the qualification route) once the
 * SMTP root-cause investigation this route exists for is closed.
 */
import type { Context } from 'hono';
import type { Env } from '../config/env';
import type { ServiceBindingFetcher } from '../alerting/storage-alert-service-binding-transport';

const NOT_FOUND = () => new Response(null, { status: 404 });
const BEARER_PREFIX = 'Bearer ';

/** SUN-1222C-SMTP-ROOT-CAUSE addendum: `?mode=IMMEDIATE|DELAY_250MS|
 * OVERALL_TIMEOUT` on this same route, same bearer, forwards to the
 * receiver's zero-network `/control/<token>` path instead of
 * `/diagnostic/<token>` -- isolates Service Binding dispatch/response and
 * the shared timeout primitive from the SMTP/TLS socket path. Not present
 * (or an unrecognized value) means the original real-diagnostic behavior,
 * unchanged. */
const CONTROL_MODES = ['IMMEDIATE', 'DELAY_250MS', 'OVERALL_TIMEOUT'] as const;
type ControlMode = (typeof CONTROL_MODES)[number];
function parseControlMode(value: string | null): ControlMode | undefined {
  return (CONTROL_MODES as readonly string[]).includes(value ?? '')
    ? (value as ControlMode)
    : undefined;
}

/** Service Binding call budget -- deliberately larger than the receiver's
 * own internal overall diagnostic budget (8s default in
 * `ionos-smtp-diagnostic.ts`) so the receiver always gets to finish and
 * return its own structured result before this caller-side budget could
 * ever cut it off mid-probe. */
const SERVICE_BINDING_TIMEOUT_MS = 12_000;

/** Constant-time string comparison -- identical discipline to
 * `storage-alert-qualification-route.ts`'s own `timingSafeEqual`. */
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

export async function storageAlertSmtpDiagnosticRoute(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  const env = c.env;

  const expectedToken = env.STORAGE_ALERT_SMTP_DIAGNOSTIC_TOKEN;
  if (!expectedToken) return NOT_FOUND(); // fail closed if unprovisioned

  const authHeader = c.req.header('authorization') ?? c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) return NOT_FOUND();

  const providedToken = authHeader.slice(BEARER_PREFIX.length);
  if (!timingSafeEqual(providedToken, expectedToken)) return NOT_FOUND();

  const receiver = env.STORAGE_ALERT_RECEIVER;
  const pathToken = env.STORAGE_ALERT_PATH_TOKEN;
  if (!receiver || !pathToken) return NOT_FOUND(); // fail closed if unprovisioned

  const controlMode = parseControlMode(c.req.query('mode') ?? null);
  const targetUrl = controlMode
    ? `https://storage-alert.internal/control/${encodeURIComponent(pathToken)}?mode=${controlMode}`
    : `https://storage-alert.internal/diagnostic/${encodeURIComponent(pathToken)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SERVICE_BINDING_TIMEOUT_MS);
  const callerStartedAt = Date.now();
  try {
    // Same narrowing rationale as `storage-alert-qualification-route.ts`:
    // `Fetcher.fetch`'s Cloudflare-typed signature (including its own
    // `AbortSignal` type) is a stricter variant of the ambient DOM
    // `RequestInit`/`Response` that `ServiceBindingFetcher` deliberately
    // uses; every real Service Binding fetcher accepts a plain `string`
    // URL, an ordinary `RequestInit`, and a DOM `AbortSignal` at runtime
    // regardless.
    const response = await (receiver as unknown as ServiceBindingFetcher).fetch(targetUrl, {
      method: 'POST',
      signal: controller.signal,
    });
    const bodyText = await response.text();
    const callerElapsedMs = Date.now() - callerStartedAt;
    if (!controlMode) {
      // Unchanged real-diagnostic behavior: forwarded verbatim, the
      // receiver's diagnostic JSON body is non-secret by construction (see
      // `ionos-smtp-diagnostic.ts`).
      return new Response(bodyText, {
        status: response.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    // Control path: merge in this caller's own elapsed time alongside the
    // receiver's self-reported `elapsed_ms`, so the two are directly
    // comparable per the isolation decision matrix (a large gap between
    // them, with the receiver side small, points at the Service Binding
    // dispatch/response path itself rather than the receiver's own logic).
    let receiverBody: Record<string, unknown> | undefined;
    try {
      const parsed: unknown = JSON.parse(bodyText);
      if (parsed && typeof parsed === 'object') receiverBody = parsed as Record<string, unknown>;
    } catch {
      // Non-JSON body -- fall through to the `receiverBody === undefined`
      // branch below rather than throwing.
    }
    return new Response(
      JSON.stringify({
        ...(receiverBody ?? { raw: bodyText }),
        receiver_elapsed_ms: receiverBody?.elapsed_ms,
        caller_elapsed_ms: callerElapsedMs,
      }),
      { status: response.status, headers: { 'content-type': 'application/json' } }
    );
  } catch {
    // Timeout (AbortError) or Service Binding dispatch failure -- no
    // internal detail leaked.
    return new Response(
      controlMode
        ? JSON.stringify({
            control: controlMode,
            result: 'CALLER_TIMEOUT_OR_DISPATCH_FAILURE',
            caller_elapsed_ms: Date.now() - callerStartedAt,
          })
        : null,
      { status: 502, headers: controlMode ? { 'content-type': 'application/json' } : {} }
    );
  } finally {
    clearTimeout(timeout);
  }
}

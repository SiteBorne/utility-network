/**
 * SUN-1221E5Q6G — `InjectedHttpClient` implementation that calls the
 * dedicated off-Cloudflare safe-egress executor (`services/webctx-safe-
 * egress`, a Modal App) instead of dialing `cloudflare:sockets` directly.
 * Drop-in replacement for `SafeSocketHttpClient`: same `InjectedHttpClient`
 * interface, same single-hop contract (`fetch()` performs exactly ONE HTTP
 * exchange for the URL it's given and never follows a redirect itself —
 * `SecureHttpClient`, `packages/provider-adapters/src/http/client.ts`,
 * already owns a well-tested Worker-side redirect loop that calls
 * `.fetch()` again per hop with `redirect: 'manual'`, independently
 * revalidating each redirect target with the same `validateUrl`/
 * `validateRedirectChain` this file's caller already runs — unchanged,
 * defense-in-depth, still authoritative on the Worker side even though the
 * executor is the authoritative safety boundary for the actual TCP/TLS
 * connection it makes).
 *
 * The executor never receives payment material of any kind (no EIP-3009
 * authorization, no facilitator credentials, no receipt-signing key, no
 * seller-wallet secret) — the request body this file sends is exactly
 * `services/webctx-safe-egress/src/webctx_safe_egress/schemas.py`'s
 * `WebctxFetchRequest`, which structurally has no field for any of that
 * (proven by that package's own `tests/test_no_payment_material.py`).
 *
 * Every thrown error is prefixed with a stable `WEBCTX_*` reason code
 * `errors.ts`'s `WEBCTX_DIAGNOSTIC_REASON_PATTERNS` already recognizes —
 * either one of the two new executor-transport-layer codes this checkpoint
 * added (`WEBCTX_EXECUTOR_UNAVAILABLE` / `WEBCTX_EXECUTOR_AUTH_FAILED`, for
 * failures reaching/authenticating against the executor itself) or one of
 * the executor's own already-established target-site codes (`schemas.py`'s
 * `WebctxFetchFailure.reason_code`, e.g. `WEBCTX_HTTP_PREMATURE_EOF`) —
 * `toAdapterResult`'s existing classification pipeline requires zero
 * changes to recognize either.
 */
import type { InjectedHttpClient } from '../types';

export interface ModalSafeEgressClientConfig {
  /** The deployed Web Function's URL, e.g.
   * `https://<workspace>--siteborne-webctx-safe-egress-fetch.modal.run` —
   * never hardcoded (the workspace subdomain doesn't exist until the App is
   * actually deployed); always read from `Env.MODAL_WEBCTX_ENDPOINT_URL`. */
  endpointUrl: string;
  /** Modal's own platform-enforced proxy-auth token pair
   * (`requires_proxy_auth=True` on the deployed endpoint) — dedicated,
   * environment-scoped credentials distinct from the OCR app's, per the
   * SUN-1221E5Q6G human-approved architecture. Never logged, never
   * included in any thrown error message. */
  proxyKey: string;
  proxySecret: string;
  /** Matches `WebctxFetchRequest.max_response_bytes`'s own upper bound
   * (`services/webctx-safe-egress/src/webctx_safe_egress/schemas.py`). */
  maxResponseBytes?: number;
  /** Wall-clock budget for the ENTIRE Worker->executor->target->Worker
   * round trip, sent as `WebctxFetchRequest.deadline_ms`. */
  deadlineMs?: number;
  /** Overridable only for tests — defaults to the real platform `fetch`. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const DEFAULT_DEADLINE_MS = 25_000;
const SECURITY_POLICY_VERSION = 1;
const REQUEST_VERSION = 1;

interface WebctxFetchSuccessBody {
  result_class: 'success';
  http_status: number;
  final_url: string;
  redirect_chain: Array<{ url: string; status: number }>;
  headers: Record<string, string>;
  content_base64: string;
  content_type: string | null;
  truncated: boolean;
  elapsed_ms: number;
}

interface WebctxFetchFailureBody {
  result_class: 'failure';
  reason_code: string;
  stage: string;
  message: string;
  elapsed_ms: number;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export class ModalSafeEgressClient implements InjectedHttpClient {
  constructor(private readonly config: ModalSafeEgressClientConfig) {}

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (init?.method && init.method.toUpperCase() !== 'GET') {
      // The current service contract (web_context_verified.v1/.v2) only
      // ever issues GET — same restriction SafeSocketHttpClient enforces
      // (socket-http-client.ts: "SafeSocketHttpClient only supports GET").
      throw new Error(
        `WEBCTX_URL_VALIDATION_FAILED: ModalSafeEgressClient only supports GET, got ${init.method}`
      );
    }

    const targetUrl = input instanceof URL ? input.toString() : input.toString();
    const doFetch = this.config.fetchImpl ?? globalThis.fetch;
    const deadlineMs = this.config.deadlineMs ?? DEFAULT_DEADLINE_MS;

    const body = JSON.stringify({
      request_version: REQUEST_VERSION,
      correlation_id: crypto.randomUUID(),
      target_url: targetUrl,
      retrieval_mode: 'direct',
      deadline_ms: deadlineMs,
      max_response_bytes: this.config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      security_policy_version: SECURITY_POLICY_VERSION,
      // Always true -- see this file's own doc comment: SecureHttpClient
      // owns the redirect loop, this client performs exactly one hop.
      single_hop: true,
    });

    let response: Response;
    try {
      response = await doFetch(this.config.endpointUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Modal-Key': this.config.proxyKey,
          'Modal-Secret': this.config.proxySecret,
        },
        body,
        signal: init?.signal ?? undefined,
      });
    } catch (err) {
      throw new Error(
        `WEBCTX_EXECUTOR_UNAVAILABLE: fetch to safe-egress executor failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { cause: err }
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(`WEBCTX_EXECUTOR_AUTH_FAILED: executor responded ${response.status}`);
    }
    if (!response.ok && response.status !== 400) {
      // 400 (malformed request per the executor's own schema validation)
      // is still parsed below as a structured failure body; anything else
      // non-2xx is an executor-layer problem, not a target-site one.
      throw new Error(`WEBCTX_EXECUTOR_UNAVAILABLE: executor responded ${response.status}`);
    }

    let parsed: WebctxFetchSuccessBody | WebctxFetchFailureBody;
    try {
      parsed = await response.json();
    } catch (err) {
      throw new Error(
        `WEBCTX_EXECUTOR_UNAVAILABLE: malformed executor response body: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    if (parsed.result_class === 'failure') {
      throw new Error(`${parsed.reason_code}: ${parsed.message}`, { cause: parsed });
    }

    const headers = new Headers();
    for (const [key, value] of Object.entries(parsed.headers ?? {})) {
      headers.set(key, value);
    }
    if (parsed.content_type && !headers.has('content-type')) {
      headers.set('content-type', parsed.content_type);
    }

    return new Response(base64ToBytes(parsed.content_base64), {
      status: parsed.http_status,
      headers,
    });
  }
}

export function buildModalSafeEgressClient(config: ModalSafeEgressClientConfig): InjectedHttpClient {
  return new ModalSafeEgressClient(config);
}

/**
 * SUN-1222C-R4-D12 — generic operator-controlled HTTPS webhook transport.
 *
 * The only outbound side effect the dedicated alert Worker performs (see
 * `../../settlement-alert-worker-entrypoint.ts`). Deliberately vendor-agnostic
 * (D12 §7): a plain `POST <configured URL>` with a JSON body — no
 * Slack/Discord/PagerDuty-specific schema or SDK. Bounded per-request
 * timeout, one attempt per call (D12 §17 — the sweep itself is the retry
 * mechanism across cron invocations, not this function).
 */
import type { SettlementAlertPayload, SettlementAlertTransport } from './settlement-alert-sweep';

const DEFAULT_TIMEOUT_MS = 10_000;

export interface BuildHttpsWebhookTransportOptions {
  readonly timeoutMs?: number;
  /** Injectable for tests only — real callers use the ambient global. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * D12 §19: the only destination-safety requirement is HTTPS — the URL
 * itself is deployment-time Worker secret configuration (same trust
 * boundary as every other secret this repository provisions via
 * `wrangler secret put`), not user- or request-supplied input, so no
 * additional SSRF allowlist is meaningful here.
 */
export function buildHttpsWebhookTransport(
  webhookUrl: string,
  options: BuildHttpsWebhookTransportOptions = {}
): SettlementAlertTransport {
  if (!webhookUrl.startsWith('https://')) {
    throw new Error(
      'settlement alert webhook URL must be HTTPS (D12 §19 destination-safety requirement)'
    );
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  return async function deliver(
    payload: SettlementAlertPayload
  ): Promise<{ delivered: boolean }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
        // D12 §18/§19: `fetch`'s own default is `redirect: 'follow'`,
        // which would silently retarget a configured destination to
        // whatever host a 3xx `Location` header names. `'manual'` keeps
        // the destination exactly the configured secret value; any 3xx
        // response is then classified as a delivery failure below (D12
        // §18: "3xx → follow only if platform fetch semantics safely
        // support it; otherwise failure" — this repo chooses "otherwise").
        redirect: 'manual',
      });
      // D12 §18: 2xx only counts as delivered for this sweep.
      return { delivered: response.status >= 200 && response.status < 300 };
    } catch {
      // Timeout (AbortError) or network error — both are delivery
      // failures, never thrown past this boundary (the sweep's own
      // per-record isolation also catches this, but this function is
      // self-contained regardless of caller behavior).
      return { delivered: false };
    } finally {
      clearTimeout(timeout);
    }
  };
}

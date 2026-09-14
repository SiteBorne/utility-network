/**
 * SUN-1222C-SMTP-ROOT-CAUSE Service-Binding-isolation addendum.
 *
 * Runs inside a real Miniflare/workerd runtime (`vitest.service-binding.config.ts`)
 * against a real, runtime-level Service Binding between two real Worker
 * instances -- the actual, unmodified caller route
 * (`storageAlertSmtpDiagnosticRoute`) and the actual, unmodified receiver
 * Worker (`storage-alert-receiver-entrypoint.ts`). Nothing about the
 * Service Binding dispatch/response path is mocked; `CONTROL_CLEANUP_HANG`
 * is the only mode that substitutes anything at all, and what it
 * substitutes is two never-resolving `Promise`s standing in for
 * `reader.cancel()`/`socket.close()` -- see that control mode's own doc
 * comment in `storage-alert-receiver-entrypoint.ts`.
 *
 * Zero external network access: no `cloudflare:sockets`, no
 * `smtp.ionos.com`, no `fetch()` to any external host. Zero production
 * secrets: the receiver Worker in this test is provisioned with only a
 * fixed, non-random, test-only `ALERT_PATH_TOKEN` literal and no
 * `IONOS_SMTP_PASSWORD` binding at all (see `vitest.service-binding.config.ts`).
 * Zero Cloudflare account access, zero Wrangler writes, zero production
 * deployment of any kind.
 */
import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';

const DIAGNOSTIC_TOKEN = 'test-only-diagnostic-token-not-a-secret';

interface ControlResponseBody {
  readonly control: string;
  readonly result: string;
  readonly receiver_elapsed_ms?: number;
  readonly caller_elapsed_ms?: number;
}

async function callControl(
  mode: 'IMMEDIATE' | 'DELAY_250MS' | 'OVERALL_TIMEOUT' | 'CLEANUP_HANG'
): Promise<{ response: Response; body: ControlResponseBody; callerElapsedMs: number }> {
  const startedAt = Date.now();
  const response = await SELF.fetch(
    `https://caller.test/internal/storage-alert-smtp-diagnostic?mode=${mode}`,
    { method: 'POST', headers: { authorization: `Bearer ${DIAGNOSTIC_TOKEN}` } }
  );
  const callerElapsedMs = Date.now() - startedAt;
  const body = (await response.json()) as ControlResponseBody;
  return { response, body, callerElapsedMs };
}

describe('storage-alert Service Binding timeout isolation (real Miniflare Service Binding, zero external network)', () => {
  it('CONTROL_IMMEDIATE: immediate receiver response propagates through the real Service Binding', async () => {
    const { response, body, callerElapsedMs } = await callControl('IMMEDIATE');
    expect(response.status).toBe(200);
    expect(body.control).toBe('IMMEDIATE');
    expect(body.result).toBe('OK');
    expect(body.receiver_elapsed_ms).toBeLessThan(500);
    expect(callerElapsedMs).toBeLessThan(2000);
  }, 15_000);

  it('CONTROL_DELAY_250MS: ~250ms async receiver response propagates normally, no caller timeout', async () => {
    const { response, body, callerElapsedMs } = await callControl('DELAY_250MS');
    expect(response.status).toBe(200);
    expect(body.control).toBe('DELAY_250MS');
    expect(body.result).toBe('OK');
    expect(body.receiver_elapsed_ms).toBeGreaterThanOrEqual(200);
    expect(body.receiver_elapsed_ms).toBeLessThan(2000);
    expect(callerElapsedMs).toBeLessThan(3000);
  }, 15_000);

  it('CONTROL_OVERALL_TIMEOUT: the real 8s receiver overall-timeout classification returns through the Service Binding before the caller real 12s outer timeout', async () => {
    const { response, body, callerElapsedMs } = await callControl('OVERALL_TIMEOUT');
    expect(response.status).toBe(200);
    expect(body.control).toBe('OVERALL_TIMEOUT');
    expect(body.result).toBe('TIMED_OUT_AS_EXPECTED');
    // Real, unmocked DEFAULT_OVERALL_TIMEOUT_MS = 8_000 in this suite.
    expect(body.receiver_elapsed_ms).toBeGreaterThanOrEqual(7500);
    expect(body.receiver_elapsed_ms).toBeLessThan(9500);
    // Proves the caller received the receiver's OWN structured result,
    // not its own 12_000ms AbortController firing: strictly less than
    // that outer deadline, and close to the receiver's own elapsed time
    // rather than sitting at ~12000ms.
    expect(callerElapsedMs).toBeLessThan(11_000);
    expect(callerElapsedMs).toBeGreaterThanOrEqual((body.receiver_elapsed_ms ?? 0) - 200);
  }, 20_000);

  it('CONTROL_CLEANUP_HANG: bounded cleanup (real CLEANUP_TIMEOUT_MS budget) still lets the handler return through the Service Binding even when both cleanup stand-ins never resolve -- the SUN-1222C-SMTP-ROOT-CAUSE regression, proven across a real Service Binding', async () => {
    const { response, body, callerElapsedMs } = await callControl('CLEANUP_HANG');
    expect(response.status).toBe(200);
    expect(body.control).toBe('CLEANUP_HANG');
    expect(body.result).toBe('OK');
    // Real, unmocked CLEANUP_TIMEOUT_MS = 1_000 raced twice (reader +
    // socket stand-ins); bounded well under a second-scale ceiling, not
    // hanging until the caller's own 12s deadline.
    expect(body.receiver_elapsed_ms).toBeLessThan(3000);
    expect(callerElapsedMs).toBeLessThan(5000);
  }, 15_000);
});

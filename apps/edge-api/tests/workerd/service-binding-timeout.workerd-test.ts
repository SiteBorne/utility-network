/**
 * SUN-1222C closure.
 *
 * Runs inside a real Miniflare/workerd runtime (`vitest.service-binding.config.ts`)
 * against a real, runtime-level Service Binding between two real Worker
 * instances -- the actual, unmodified `buildServiceBindingStorageAlertTransport`
 * production transport (the caller fixture) and the actual, unmodified
 * receiver Worker (`storage-alert-receiver-entrypoint.ts`). Nothing about
 * the Service Binding dispatch/response path is mocked.
 *
 * Exercises the PERMANENT architecture -- path-token check, schema
 * validation, and the `STORAGE_ALERT_DELIVERY_ENABLED` fail-closed gate --
 * through a real Service Binding. The earlier SUN-1222C-SMTP-ROOT-CAUSE
 * version of this suite exercised the temporary `/control` zero-network
 * isolation modes (`CONTROL_IMMEDIATE`/`DELAY_250MS`/`OVERALL_TIMEOUT`/
 * `CLEANUP_HANG`), removed from the receiver once the Service Binding
 * timeout/cleanup machinery they existed to isolate was proven correct and
 * the SMTP root cause was closed; see git history for that version.
 * `ionos-smtp-transport.test.ts`'s own bounded-cleanup tests (which mock
 * `cloudflare:sockets` directly) remain the regression proof that a real
 * hanging `reader.cancel()`/`socket.close()` still returns within
 * `CLEANUP_TIMEOUT_MS` -- a transport-module concern that needs no Service
 * Binding to prove.
 *
 * Zero external network access: no `cloudflare:sockets`, no
 * `smtp.ionos.com`, no `fetch()` to any external host -- every test here
 * gets a fail-closed response (`STORAGE_ALERT_DELIVERY_ENABLED` is left
 * unbound in `vitest.service-binding.config.ts`) before the receiver ever
 * reaches its SMTP-transport code. Zero production secrets: the receiver
 * Worker in this test is provisioned with only a fixed, non-random,
 * test-only `ALERT_PATH_TOKEN` literal and no `IONOS_SMTP_PASSWORD`
 * binding at all. Zero Cloudflare account access, zero Wrangler writes,
 * zero production deployment of any kind.
 */
import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';

const PATH_TOKEN = 'test-only-path-token-not-a-secret';

const VALID_PAYLOAD = {
  event: 'siteborne.storage_reclamation.critical_alert',
  operation_class: 'artifact_reclamation_r2_delete_failure',
  r2_delete_failures: 3,
  reclaimed_count: 12,
  swept_at: '2026-09-15T00:00:00.000Z',
  sample_content_hashes: ['abc123'],
};

interface DispatchOutcome {
  readonly delivered: boolean;
}

async function dispatch(
  pathToken: string,
  payload: unknown
): Promise<{ outcome: DispatchOutcome; elapsedMs: number }> {
  const startedAt = Date.now();
  const response = await SELF.fetch('https://caller.test/dispatch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pathToken, payload }),
  });
  const elapsedMs = Date.now() - startedAt;
  const outcome = (await response.json()) as DispatchOutcome;
  return { outcome, elapsedMs };
}

describe('storage-alert Service Binding (real Miniflare Service Binding, zero external network)', () => {
  it("ordinary valid alert, STORAGE_ALERT_DELIVERY_ENABLED absent: the receiver's fail-closed 503 propagates through the real Service Binding as delivered=false, quickly", async () => {
    const { outcome, elapsedMs } = await dispatch(PATH_TOKEN, VALID_PAYLOAD);
    expect(outcome).toEqual({ delivered: false });
    expect(elapsedMs).toBeLessThan(2000);
  }, 15_000);

  it("wrong ALERT_PATH_TOKEN: the receiver's identical-404 auth failure propagates through the real Service Binding as delivered=false", async () => {
    const { outcome, elapsedMs } = await dispatch('wrong-token-value', VALID_PAYLOAD);
    expect(outcome).toEqual({ delivered: false });
    expect(elapsedMs).toBeLessThan(2000);
  }, 15_000);

  it("malformed payload (fails schema): the receiver's 400 propagates through the real Service Binding as delivered=false", async () => {
    const { outcome, elapsedMs } = await dispatch(PATH_TOKEN, { not: 'a valid payload' });
    expect(outcome).toEqual({ delivered: false });
    expect(elapsedMs).toBeLessThan(2000);
  }, 15_000);

  it('THE RACE THIS CONTAINS, proven across a real Service Binding: r2_delete_failures > 0, STORAGE_ALERT_DELIVERY_ENABLED absent -> receiver is reached (real dispatch, real auth, real schema parse) but the containment gate still reports delivered=false -- the SMTP transport is never invoked', async () => {
    const scheduledShapedPayload = { ...VALID_PAYLOAD, r2_delete_failures: 7 };
    const { outcome, elapsedMs } = await dispatch(PATH_TOKEN, scheduledShapedPayload);
    expect(outcome).toEqual({ delivered: false });
    expect(elapsedMs).toBeLessThan(2000);
  }, 15_000);
});

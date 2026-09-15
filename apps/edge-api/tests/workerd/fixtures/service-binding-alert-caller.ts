/**
 * SUN-1222C closure — the `main` Worker entrypoint for
 * `vitest.service-binding.config.ts`'s real `@cloudflare/vitest-pool-workers`
 * Service Binding test.
 *
 * Replaces the earlier SUN-1222C-SMTP-ROOT-CAUSE fixture (which mounted the
 * temporary `storageAlertSmtpDiagnosticRoute`/`/control` machinery, both
 * removed once qualification and the SMTP root-cause investigation closed)
 * with a minimal caller that dispatches through the exact same, real,
 * unmodified `buildServiceBindingStorageAlertTransport` production
 * transport `reclaimStaleArtifactsScheduled` uses (`../../../src/index.ts`)
 * -- nothing reimplemented, nothing mocked on the caller side. This
 * exercises the PERMANENT architecture end-to-end through a real
 * runtime-level Service Binding: no D1/R2/KV/Queues/Workflows/AI/Browser
 * bindings and no production payment/bootstrap `[vars]` this suite has no
 * business touching, matching the SUN-1222C-SMTP-ROOT-CAUSE decision to use
 * the local integration-test path rather than a disposable/production
 * Cloudflare deployment.
 */
import { Hono } from 'hono';
import {
  buildServiceBindingStorageAlertTransport,
  type ServiceBindingFetcher,
} from '../../../src/control-plane/alerting/storage-alert-service-binding-transport';
import type { StorageAlertPayload } from '../../../src/control-plane/alerting/storage-alert-sweep';

interface CallerEnv {
  readonly STORAGE_ALERT_RECEIVER: ServiceBindingFetcher;
}

interface DispatchRequestBody {
  readonly pathToken: string;
  readonly payload: StorageAlertPayload;
}

const app = new Hono<{ Bindings: CallerEnv }>();

app.post('/dispatch', async (c) => {
  const { pathToken, payload } = (await c.req.json()) as DispatchRequestBody;
  const transport = buildServiceBindingStorageAlertTransport(
    c.env.STORAGE_ALERT_RECEIVER,
    pathToken
  );
  const outcome = await transport(payload);
  return new Response(JSON.stringify(outcome), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});

export default {
  fetch: app.fetch,
};

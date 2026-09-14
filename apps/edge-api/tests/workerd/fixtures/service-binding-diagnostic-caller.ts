/**
 * SUN-1222C-SMTP-ROOT-CAUSE Service-Binding-isolation addendum — the
 * `main` Worker entrypoint for `vitest.service-binding.config.ts`'s real
 * `@cloudflare/vitest-pool-workers` Service Binding test.
 *
 * Deliberately NOT the full production `src/index.ts` (that Worker needs
 * D1/R2/KV/Queues/Workflows/AI/Browser bindings and ten production
 * payment/bootstrap `[vars]` this experiment has no business touching or
 * reproducing — see the SUN-1222C-SMTP-ROOT-CAUSE decision to use the
 * local integration-test path instead of a disposable/production
 * Cloudflare deployment). This fixture mounts *only* the real,
 * unmodified `storageAlertSmtpDiagnosticRoute` handler at its real
 * production path, so the test exercises the exact same route logic
 * (bearer check, `SERVICE_BINDING_TIMEOUT_MS = 12_000` AbortController,
 * Service Binding `fetch`, response merging) that runs in production,
 * with nothing reimplemented or mocked on the caller side.
 */
import { Hono } from 'hono';
import type { Env } from '../../../src/control-plane/config/env';
import { storageAlertSmtpDiagnosticRoute } from '../../../src/control-plane/routes/storage-alert-smtp-diagnostic-route';

const app = new Hono<{ Bindings: Env }>();
app.post('/internal/storage-alert-smtp-diagnostic', storageAlertSmtpDiagnosticRoute);

export default {
  fetch: app.fetch,
};

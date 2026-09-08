/**
 * SUN-1222C-R4-D12 — dedicated unresolved-settlement alert Worker.
 *
 * This is the `main` module of a SEPARATE, THIRD Worker script
 * (`siteborne-settlement-alert`, see `wrangler.settlement-alert-worker.toml`
 * — not yet deployed, D12 authorization is implementation-only) alongside
 * the public API Worker (`siteborne-utility-edge`, `wrangler.toml`) and the
 * dedicated Workflow host (`siteborne-paid-continuation-runtime`,
 * `wrangler.paid-continuation-runtime.toml`, see
 * `./workflow-host-entrypoint.ts` for the precedent this file follows).
 *
 * This script is deliberately, structurally economically powerless (D12
 * §5/§22): it holds NO payment, settlement, executor-provider, facilitator,
 * or chain-write credential of any kind, and its only D1 access is the
 * narrow, injected `UnresolvedSettlementSource` read interface (see
 * `./control-plane/alerting/settlement-alert-sweep.ts`'s own doc comment
 * for why that interface — not the full repository class — is itself part
 * of the static capability proof). Its only outbound network call is one
 * `POST` to the operator-configured `SETTLEMENT_ALERT_WEBHOOK_URL` per
 * unresolved incident per sweep (`./control-plane/alerting/
 * settlement-alert-webhook-transport.ts`).
 *
 * `[[workflows]]`, `env.PAID_CONTINUATION_WORKFLOW`, `settle`, `verify`,
 * any CDP/facilitator client, and any executor-provider adapter are never
 * imported here, directly or transitively through the alerting module
 * (D12 §22 static capability audit — see the D12 evidence report for the
 * import-graph proof).
 *
 * `scheduled()` is the only meaningful handler (D12 §26:
 * `D12_PUBLIC_FETCH_HANDLER=ABSENT` in spirit — `fetch()` exists only to
 * satisfy the platform's module-worker build requirement, exactly as
 * `./workflow-host-entrypoint.ts` already documents for the same reason;
 * `wrangler.settlement-alert-worker.toml` binds no route and disables
 * `workers_dev`, so this inert 404 is never reachable in production).
 */
import type { D1Database, ScheduledController } from '@cloudflare/workers-types';
import { D1PaymentAttemptRepository } from './control-plane/repositories/d1/payment-attempts';
import { runSettlementAlertSweep } from './control-plane/alerting/settlement-alert-sweep';
import { buildHttpsWebhookTransport } from './control-plane/alerting/settlement-alert-webhook-transport';

export interface Env {
  readonly DB: D1Database;
  /**
   * Real secret, provisioned (once separately authorized — D12 §8/§28)
   * with `wrangler secret put SETTLEMENT_ALERT_WEBHOOK_URL --config
   * wrangler.settlement-alert-worker.toml`. Never a `[vars]` entry, never
   * logged, never returned from any handler, never included in any
   * evidence report. Optional in this type because §7's fail-safe
   * misconfiguration path (below) must be reachable without it.
   */
  readonly SETTLEMENT_ALERT_WEBHOOK_URL?: string;
}

/**
 * S7 (D12 §20/§28): if the webhook secret is not yet provisioned, fail
 * safe — no economic action (there is none to take), no crash loop, no
 * attempt to construct a transport from an empty string, and a clear,
 * secret-value-free operational diagnostic. This is the expected steady
 * state for `PASS_IMPLEMENTATION_READY_PENDING_SECRET`
 * (`D12_WEBHOOK_SECRET_PROVISIONED=NO` /
 * `D12_PRODUCTION_ACTIVATION=BLOCKED_PENDING_SECRET`): even if this script
 * were deployed with an active cron trigger before the secret exists, each
 * invocation would log this one line and return, never throwing, never
 * looping, never disclosing anything about the missing value beyond its
 * name.
 */
function logMisconfiguredNoSecret(): void {
  console.error(
    JSON.stringify({
      event: 'settlement_alert_worker_misconfigured',
      detail: 'SETTLEMENT_ALERT_WEBHOOK_URL is not set',
    })
  );
}

function logSweepComplete(result: {
  readonly consideredCount: number;
  readonly deliveredCount: number;
  readonly failedCount: number;
}): void {
  // Repo lint convention only allows `console.warn`/`console.error`
  // (matching `logSettlementAmbiguous`'s own D10 precedent) -- this is a
  // routine completion summary, not an error, but `warn` is the closest
  // permitted level for a structured operational log line.
  console.warn(
    JSON.stringify({
      event: 'settlement_alert_sweep_complete',
      considered_count: result.consideredCount,
      delivered_count: result.deliveredCount,
      failed_count: result.failedCount,
    })
  );
}

// Deliberately NOT typed as `ExportedHandler<Env>` (workers-types' own
// `Response` return type for `fetch` is incompatible with the global
// `Response` this repo's other entrypoints already return — see
// `./workflow-host-entrypoint.ts`, which hits the same platform-typing
// friction and resolves it the same way: a plain object literal, with only
// the `scheduled` handler's own parameters explicitly annotated).
export default {
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const webhookUrl = env.SETTLEMENT_ALERT_WEBHOOK_URL;
    if (!webhookUrl) {
      logMisconfiguredNoSecret();
      return;
    }
    const source = new D1PaymentAttemptRepository(env.DB);
    const transport = buildHttpsWebhookTransport(webhookUrl);
    const result = await runSettlementAlertSweep({ source, transport });
    logSweepComplete(result);
  },

  async fetch(_request: Request): Promise<Response> {
    return new Response('not found', { status: 404 });
  },
};

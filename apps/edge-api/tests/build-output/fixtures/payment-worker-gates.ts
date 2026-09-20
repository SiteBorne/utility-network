/**
 * SETTLEMENT-OBSERVABILITY-01 -- registry of emitted-bundle JWT gates, one per
 * payment-capable Worker. `payment-worker-release-invariant.test.ts` requires
 * this set to equal the set of Worker configs whose entry graph can reach the
 * CDP provider, so a repair can never qualify only half of the payment system.
 */
export interface PaymentWorkerGate {
  /** Repo-root wrangler config the Worker is built and deployed with. */
  readonly config: string;
  /** Deployed Worker script name (`name` in that config). */
  readonly scriptName: string;
  /** Probe entry bundled with that config's entry graph. */
  readonly probeEntry: string;
  /** Test file that builds `probeEntry` with `config` and runs it under workerd. */
  readonly gateTest: string;
}

export const PAYMENT_WORKER_GATES: readonly PaymentWorkerGate[] = [
  {
    config: 'wrangler.toml',
    scriptName: 'siteborne-utility-edge',
    probeEntry: 'apps/edge-api/tests/build-output/fixtures/cdp-jwt-bundle-probe-entry.ts',
    gateTest: 'apps/edge-api/tests/build-output/cdp-jwt-bundle-init.test.ts',
  },
  {
    config: 'wrangler.paid-continuation-runtime.toml',
    scriptName: 'siteborne-paid-continuation-runtime',
    probeEntry: 'apps/edge-api/tests/build-output/fixtures/cdp-jwt-host-bundle-probe-entry.ts',
    gateTest: 'apps/edge-api/tests/build-output/cdp-jwt-host-bundle-init.test.ts',
  },
];

/**
 * Worker configs whose graph imports the CDP composition but which are proven
 * never to be deployed (test-only harness configs). The release invariant
 * verifies each claim: the config must state it is never deployed and no deploy
 * command anywhere may pass it to `wrangler deploy` / `versions`.
 */
export interface NonDeployedPaymentGraphWorker {
  readonly config: string;
  readonly scriptName: string;
  readonly reason: string;
}

export const NON_DEPLOYED_PAYMENT_GRAPH_WORKERS: readonly NonDeployedPaymentGraphWorker[] = [
  {
    config: 'wrangler.worker-runtime-test.toml',
    scriptName: 'siteborne-worker-runtime-test',
    reason:
      'SUN-1201 test-only harness for scripts/test-worker-runtime.mts; only ever run under `wrangler dev --local`',
  },
];

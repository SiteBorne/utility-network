/**
 * R3-57A Phase 4 — EDGE/HOST environment coherence. The HOST must refuse an
 * envelope whose network differs from the network THIS host resolved, before
 * any state advance, provider dispatch or settlement. No real network/D1.
 */
import { describe, expect, it } from 'vitest';
import { resolvePaymentNetwork, PRODUCTION_NETWORK } from '@siteborne/protocol-x402';
import { runPaidContinuationWorkflow } from '../src/control-plane/workflows/paid-continuation-workflow';
import { resolveProductionAuthorizationInput } from '../src/control-plane/config/production-payment';
import { FakeWorkflowStep } from './support/fake-workflow-step';
import {
  buildDecryptedPayload,
  buildTestDependencies,
  buildTestMetadata,
  sealTestInput,
  TEST_NETWORK,
} from './support/paid-continuation-workflow-fixtures';

const PROD = 'eip155:8453';

async function run(opts: {
  metadataNetwork: string;
  contextNetwork?: string;
  hostNetwork: string;
}) {
  const metadata = buildTestMetadata({ network: opts.metadataNetwork } as never);
  const deps = await buildTestDependencies();
  const payload = buildDecryptedPayload(metadata);
  if (opts.contextNetwork) {
    (payload.settlementContext as { network: string }).network = opts.contextNetwork;
  }
  const input = await sealTestInput(metadata, { key: deps.envelopeKey, payload });
  (deps.reconciliation as { network: string }).network = opts.hostNetwork;
  const step = new FakeWorkflowStep();
  const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);
  return { result, step, deps };
}

describe('R3-57A EDGE/HOST environment mismatch fails closed', () => {
  for (const [name, m, h] of [
    ['EDGE preproduction + HOST production', TEST_NETWORK, PROD],
    ['EDGE production + HOST preproduction', PROD, TEST_NETWORK],
  ] as const) {
    it(`${name}: refused before executor, dispatch, settle`, async () => {
      const { result, step, deps } = await run({ metadataNetwork: m, hostNetwork: h });
      expect(result.status).toBe('workflow_internal_error');
      expect(result.error_code).toBe('environment_network_mismatch');
      expect(step.calls.map((c: { name: string }) => c.name)).toEqual(['open-envelope']);
      expect(deps.settle).not.toHaveBeenCalled();
      expect(deps.providerDispatch).toBeDefined();
    });
  }

  it('sealed settlement context disagreeing with AAD-bound metadata is refused', async () => {
    const { result, deps } = await run({
      metadataNetwork: TEST_NETWORK,
      contextNetwork: PROD,
      hostNetwork: TEST_NETWORK,
    });
    expect(result.error_code).toBe('environment_network_mismatch');
    expect(deps.settle).not.toHaveBeenCalled();
  });

  it('matching networks proceed past the guard', async () => {
    const { result } = await run({ metadataNetwork: TEST_NETWORK, hostNetwork: TEST_NETWORK });
    expect(result.error_code).not.toBe('environment_network_mismatch');
  });
});

describe('R3-57A network authorization gates (partial gates never yield production)', () => {
  const base = {
    PAYMENT_ENVIRONMENT: 'production',
    PRODUCTION_ENABLED: 'true',
    HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: 'true',
    PRODUCTION_CDP_CREDENTIALS_APPROVED: 'true',
  };
  it('all four gates -> production network', () => {
    expect(resolvePaymentNetwork(resolveProductionAuthorizationInput(base))).toBe(
      PRODUCTION_NETWORK
    );
  });
  for (const k of Object.keys(base) as (keyof typeof base)[]) {
    it(`missing ${k} -> preproduction network`, () => {
      const env = { ...base, [k]: undefined };
      expect(resolvePaymentNetwork(resolveProductionAuthorizationInput(env))).toBe(TEST_NETWORK);
    });
  }
  it('PAYMENT_ENVIRONMENT casing/garbage fails closed', () => {
    for (const v of ['Production', 'PRODUCTION', ' production', 'prod', '']) {
      const env = { ...base, PAYMENT_ENVIRONMENT: v };
      expect(resolvePaymentNetwork(resolveProductionAuthorizationInput(env))).toBe(TEST_NETWORK);
    }
  });
});

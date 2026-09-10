/**
 * SUN-1222C seller-identity determinism remediation.
 *
 * All counters in this file are local instrumentation. No real fetch,
 * authenticated CDP request, payment, provider, Workflow, or settlement is
 * permitted. The legacy hook deliberately models the installed SDK's maximum
 * observable fan-out (one fire-and-forget analytics POST plus four GET
 * attempts: the initial idempotent GET and axios-retry's three defaults).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ProductionAuthorizationInput } from '@siteborne/protocol-x402';
import {
  buildCdpSellerAddressLookup,
  resolveGovernedSellerAddress,
  resolveProductionCdpEvidenceProvider,
  type CdpAccountLookupClient,
  type ProductionCdpProviderDependencies,
} from '../src/control-plane/config/production-payment';

const SELLER = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1';
const AUTHORIZED: ProductionAuthorizationInput = {
  environment: 'production',
  productionEnabled: true,
  humanBootstrapAuthorized: true,
  productionCredentialsApproved: true,
};

const BINDINGS = {
  SELLER_WALLET_ADDRESS: SELLER,
  CDP_API_KEY_ID: 'synthetic-key-id',
  CDP_API_KEY_SECRET: 'synthetic-key-secret',
};

interface ActivityCounters {
  analyticsPosts: number;
  authenticatedGets: number;
  signatures: number;
  transactions: number;
  facilitatorVerify: number;
  facilitatorSettle: number;
  workflowCreations: number;
}

function zeroCounters(): ActivityCounters {
  return {
    analyticsPosts: 0,
    authenticatedGets: 0,
    signatures: 0,
    transactions: 0,
    facilitatorVerify: 0,
    facilitatorSettle: 0,
    workflowCreations: 0,
  };
}

function deterministicDeps(
  counters: ActivityCounters,
  legacyLookup?: () => Promise<string>
): ProductionCdpProviderDependencies {
  return {
    createFacilitatorClient: () =>
      ({
        verify: async () => {
          counters.facilitatorVerify += 1;
          return {};
        },
        settle: async () => {
          counters.facilitatorSettle += 1;
          return {};
        },
        getSupported: async () => ({}),
      }) as never,
    // Deliberately model the removed property. Casting keeps this test able to
    // prove a regression if request handling starts observing it again.
    ...(legacyLookup ? { getAuthenticatedSellerAddress: legacyLookup } : {}),
  } as ProductionCdpProviderDependencies;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pre-402 seller identity determinism', () => {
  it('does not invoke the legacy authenticated account lookup while selecting the production evidence provider', async () => {
    const activity = zeroCounters();

    const resolved = await resolveProductionCdpEvidenceProvider(
      AUTHORIZED,
      BINDINGS,
      deterministicDeps(activity, async () => {
        activity.analyticsPosts += 1;
        activity.authenticatedGets += 4;
        return SELLER;
      })
    );

    expect(resolved.evidenceMode).toBe('production');
    expect(activity).toEqual(zeroCounters());
  });

  it('valid configured seller resolution retains the exact governed payTo bytes', () => {
    expect(resolveGovernedSellerAddress(SELLER)).toBe(SELLER);
  });

  it.each([
    ['', 'missing'],
    ['not-an-address', 'malformed'],
    ['0x7f44A2dd237938F18632d4CcA40f4c690295E6E1', 'bad checksum'],
  ])('%s configured seller fails closed before facilitator construction (%s)', async (address) => {
    const activity = zeroCounters();
    let facilitatorConstructions = 0;
    const result = await resolveProductionCdpEvidenceProvider(
      AUTHORIZED,
      { ...BINDINGS, SELLER_WALLET_ADDRESS: address },
      {
        createFacilitatorClient: () => {
          facilitatorConstructions += 1;
          return deterministicDeps(activity).createFacilitatorClient();
        },
      }
    );
    expect(result).toEqual({ evidenceMode: 'fixture' });
    expect(facilitatorConstructions).toBe(0);
    expect(activity).toEqual(zeroCounters());
  });

  it('success selects a production provider but invokes no facilitator method', async () => {
    const activity = zeroCounters();
    const result = await resolveProductionCdpEvidenceProvider(
      AUTHORIZED,
      BINDINGS,
      deterministicDeps(activity)
    );
    expect(result.evidenceMode).toBe('production');
    expect(result.evidenceProvider).toBeDefined();
    expect(activity.facilitatorVerify).toBe(0);
    expect(activity.facilitatorSettle).toBe(0);
  });

  it('emits neither usage analytics nor error-reporting network requests on success', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    const activity = zeroCounters();
    const result = await resolveProductionCdpEvidenceProvider(
      AUTHORIZED,
      BINDINGS,
      deterministicDeps(activity)
    );
    expect(result.evidenceMode).toBe('production');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(activity.analyticsPosts).toBe(0);
  });

  it.each([
    ['429', new Error('synthetic 429')],
    ['500', new Error('synthetic 500')],
    ['timeout', new Error('synthetic timeout')],
    ['connection failure', new Error('synthetic connection failure')],
    ['response parse failure', new Error('synthetic response parse failure')],
  ])('does not invoke or retry a legacy lookup on %s', async (_kind, failure) => {
    const activity = zeroCounters();
    const result = await resolveProductionCdpEvidenceProvider(
      AUTHORIZED,
      BINDINGS,
      deterministicDeps(activity, async () => {
        activity.authenticatedGets += 1;
        throw failure;
      })
    );
    expect(result.evidenceMode).toBe('production');
    expect(activity.authenticatedGets).toBe(0);
  });

  it('does not inspect a malformed or mismatched legacy account response', async () => {
    const activity = zeroCounters();
    const result = await resolveProductionCdpEvidenceProvider(
      AUTHORIZED,
      BINDINGS,
      deterministicDeps(activity, async () => {
        activity.authenticatedGets += 1;
        return 'malformed-or-mismatched';
      })
    );
    expect(result.evidenceMode).toBe('production');
    expect(activity.authenticatedGets).toBe(0);
  });

  it('the explicit qualification helper still fails closed on authenticated seller mismatch', async () => {
    const client: CdpAccountLookupClient = {
      evm: {
        async getAccount() {
          return { address: '0x000000000000000000000000000000000000dEaD' };
        },
      },
    };
    await expect(buildCdpSellerAddressLookup(() => client, SELLER)()).rejects.toThrow(
      /seller_identity_mismatch/
    );
  });

  it('reaches no signer, transaction, facilitator, Workflow, or settlement operation', async () => {
    const activity = zeroCounters();
    const result = await resolveProductionCdpEvidenceProvider(
      AUTHORIZED,
      BINDINGS,
      deterministicDeps(activity)
    );
    expect(result.evidenceMode).toBe('production');
    expect(activity).toEqual(zeroCounters());
  });

  it('all four production compositions share the one local provider-selection path and contain no CDP account lookup', () => {
    const productionDir = fileURLToPath(
      new URL('../src/control-plane/production/', import.meta.url)
    );
    const compositions = [
      'verify-agent-output-v2-cdp-composition.ts',
      'web-context-v2-cdp-composition.ts',
      'company-evidence-graph-v2-cdp-composition.ts',
      'document-evidence-json-v2-cdp-composition.ts',
    ];

    for (const file of compositions) {
      const source = readFileSync(`${productionDir}/${file}`, 'utf8');
      expect(source.match(/resolveProductionCdpEvidenceProvider\(/g)).toHaveLength(1);
      expect(source.match(/payTo: env\.SELLER_WALLET_ADDRESS,\n/g)).toHaveLength(1);
      expect(source).not.toContain('buildCdpSellerAddressLookup');
      expect(source).not.toContain('buildProductionCdpAccountLookupClientFactory');
      expect(source).not.toContain('.evm.getAccount');
    }

    const resolverSource = readFileSync(
      fileURLToPath(new URL('../src/control-plane/config/production-payment.ts', import.meta.url)),
      'utf8'
    );
    expect(resolverSource).not.toContain("from '@coinbase/cdp-sdk'");
    expect(resolverSource.match(/export function resolveGovernedSellerAddress/g)).toHaveLength(1);
  });
});

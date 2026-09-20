/**
 * FIRST-PAID-VERIFY-WORKER-JWT-BUNDLE-INIT-REMEDIATION-01 -- source-level tests
 * for the JWT-module initialisation guard. The bundler-level defect itself is
 * only observable in the emitted bundle; see
 * `tests/build-output/cdp-jwt-bundle-init.test.ts` for the authoritative gate.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HTTPFacilitatorClient } from '@x402/core/server';
import type {
  PaymentSettlementContext,
  PaymentVerificationContext,
} from '@siteborne/protocol-x402';

const events: string[] = [];
let loadShouldFail = false;

/** Re-registered per test: vitest caches a `vi.mock` factory result across
 * `vi.resetModules()`, which would hide every load after the first. */
function registerAuthModuleMock(): void {
  vi.doMock('@coinbase/cdp-sdk/auth', () => {
    events.push('auth-module-loaded');
    if (loadShouldFail) throw new Error('simulated auth module load failure');
    return { generateJwt: () => 'never-called' };
  });
}

const NETWORK = 'eip155:8453' as const;
const REQUIREMENTS = {
  scheme: 'exact' as const,
  network: NETWORK,
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  amount: '17000',
  payTo: '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1',
  maxTimeoutSeconds: 60,
  extra: { quote_id: 'qte_' + '1'.repeat(24) },
};
const BASE = {
  service_id: 'verify_agent_output.v2' as const,
  service_version: 'v2' as const,
  scheme: 'exact' as const,
  network: NETWORK,
  asset: REQUIREMENTS.asset,
  payee: REQUIREMENTS.payTo,
  quote_id: REQUIREMENTS.extra.quote_id,
  requirement_id: 'req_' + '2'.repeat(24),
  payment_identifier: 'pay_' + '3'.repeat(28),
  amount: REQUIREMENTS.amount,
  nowIso: '2026-09-20T00:00:00.000Z',
  expiresAt: '2026-09-20T00:05:00.000Z',
  authorizationContext: { rail: 'cdp' as const },
  paymentPayload: { x402Version: 2, accepted: REQUIREMENTS, payload: { signature: '0x00' } },
  paymentRequirements: REQUIREMENTS,
};

/** Shaped like the SDK client: every operation builds auth headers via
 * `this.createAuthHeaders(path)` first, exactly as HTTPFacilitatorClient does. */
function sdkShapedFacilitator(authHeaders: (path: string) => Promise<unknown>) {
  return {
    async createAuthHeaders(path: string) {
      events.push(`createAuthHeaders:${path}`);
      return authHeaders(path);
    },
    async verify() {
      await (this as unknown as HTTPFacilitatorClient).createAuthHeaders('verify');
      return { isValid: true, payer: '0x' + '5'.repeat(40) };
    },
    async settle() {
      await (this as unknown as HTTPFacilitatorClient).createAuthHeaders('settle');
      return {
        success: true,
        transaction: '0x' + 'a'.repeat(64),
        network: NETWORK,
        payer: '0x' + '5'.repeat(40),
        amount: BASE.amount,
      };
    },
    async getSupported() {
      await (this as unknown as HTTPFacilitatorClient).createAuthHeaders('supported');
      return {
        kinds: [{ x402Version: 2, scheme: 'exact', network: NETWORK }],
        extensions: [],
        signers: {},
      };
    },
  } as unknown as HTTPFacilitatorClient;
}

const VERIFIED_EVIDENCE = {
  x402_version: 2 as const,
  scheme: 'exact' as const,
  network: NETWORK,
  quote_id: BASE.quote_id,
  requirement_id: BASE.requirement_id,
  payment_identifier: BASE.payment_identifier,
  verified: true,
  verifier_identity: 'cdp:facilitator',
  evidence_timestamp: BASE.nowIso,
  raw_evidence_hash: 'sha256:' + '4'.repeat(64),
  trust_class: 'external_verified' as const,
};

beforeEach(() => {
  events.length = 0;
  loadShouldFail = false;
  vi.resetModules();
  registerAuthModuleMock();
});

async function load() {
  const init = await import('../src/control-plane/evidence/cdp-auth-init');
  const provider = await import('../src/control-plane/evidence/cdp-provider');
  return { ...init, ...provider };
}

describe('withCdpAuthModuleInitialized', () => {
  it('initialises the SDK auth module before delegating createAuthHeaders, and forwards path and result', async () => {
    const { withCdpAuthModuleInitialized } = await load();
    const facilitator = sdkShapedFacilitator(async (path) => ({ headers: { path } }));
    const wrapped = withCdpAuthModuleInitialized(facilitator);

    await expect(wrapped.createAuthHeaders('settle')).resolves.toEqual({
      headers: { path: 'settle' },
    });
    expect(events).toEqual(['auth-module-loaded', 'createAuthHeaders:settle']);
  });

  it('loads the auth module once across many calls (idempotent, memoised)', async () => {
    const { withCdpAuthModuleInitialized } = await load();
    const wrapped = withCdpAuthModuleInitialized(sdkShapedFacilitator(async () => ({})));

    await wrapped.createAuthHeaders('verify');
    await wrapped.createAuthHeaders('settle');
    await wrapped.createAuthHeaders('supported');

    expect(events.filter((e) => e === 'auth-module-loaded')).toHaveLength(1);
  });

  it('returns clients without createAuthHeaders unchanged (test doubles)', async () => {
    const { withCdpAuthModuleInitialized } = await load();
    const double = { verify: async () => ({ isValid: true }) } as unknown as HTTPFacilitatorClient;
    expect(withCdpAuthModuleInitialized(double)).toBe(double);
    expect(events).toEqual([]);
  });

  it('does not alter the underlying facilitator object', async () => {
    const { withCdpAuthModuleInitialized } = await load();
    const facilitator = sdkShapedFacilitator(async () => ({}));
    const original = facilitator.createAuthHeaders;
    withCdpAuthModuleInitialized(facilitator);
    expect(facilitator.createAuthHeaders).toBe(original);
  });

  it('does not cache a failed load: the next call retries', async () => {
    const { ensureCdpAuthModuleInitialized } = await load();
    loadShouldFail = true;
    await expect(ensureCdpAuthModuleInitialized()).rejects.toThrow();
    expect(events).toEqual(['auth-module-loaded']);
    // A failed load must not poison the memo: the same module instance retries.
    loadShouldFail = false;
    vi.resetModules();
    registerAuthModuleMock();
    const retried = await load();
    await retried.ensureCdpAuthModuleInitialized();
    expect(events).toEqual(['auth-module-loaded', 'auth-module-loaded']);
  });
});

describe('CdpPaymentEvidenceProvider initialises JWT support on every facilitator path', () => {
  it('verify: module load precedes the /verify auth headers', async () => {
    const { CdpPaymentEvidenceProvider } = await load();
    const provider = new CdpPaymentEvidenceProvider(sdkShapedFacilitator(async () => ({})));

    const evidence = await provider.verify(BASE as PaymentVerificationContext);

    expect(evidence.verified).toBe(true);
    expect(events).toEqual(['auth-module-loaded', 'createAuthHeaders:verify']);
  });

  it('settle: module load precedes the /settle auth headers (a verified payment must also settle)', async () => {
    const { CdpPaymentEvidenceProvider } = await load();
    const provider = new CdpPaymentEvidenceProvider(sdkShapedFacilitator(async () => ({})));

    const settlement = await provider.settle(
      BASE as PaymentSettlementContext,
      VERIFIED_EVIDENCE,
      BASE.amount
    );

    expect(settlement.success).toBe(true);
    expect(events).toEqual(['auth-module-loaded', 'createAuthHeaders:settle']);
  });

  it('supported: module load precedes the /supported auth headers', async () => {
    const { checkCdpSupportsNetwork } = await load();

    const result = await checkCdpSupportsNetwork(
      sdkShapedFacilitator(async () => ({})),
      NETWORK,
      ['exact']
    );

    expect(result.ok).toBe(true);
    expect(events).toEqual(['auth-module-loaded', 'createAuthHeaders:supported']);
  });

  it('fails closed, without throwing, when the auth module cannot be loaded during verify', async () => {
    loadShouldFail = true;
    const { CdpPaymentEvidenceProvider } = await load();
    const provider = new CdpPaymentEvidenceProvider(sdkShapedFacilitator(async () => ({})));

    const evidence = await provider.verify(BASE as PaymentVerificationContext);

    expect(evidence.verified).toBe(false);
    expect(evidence.reason).toBe('facilitator_verify_unavailable');
    expect(evidence.trust_class).toBe('external_unverified');
    expect(events).not.toContain('createAuthHeaders:verify');
    expect(JSON.stringify(evidence)).not.toContain('simulated auth module load failure');
  });
});

/**
 * SUN-0900B checkpoint 1B — final live-harness recovery wiring.
 *
 * Credential-free adapter test for `NeverminedSandboxReconciliationClient`.
 * Mocks `fetch` at the transport boundary only — never the reconciliation
 * classifier logic (`reconcileNeverminedSettlement`/
 * `reconcileNeverminedSettlementForRecovery`, already proven standalone in
 * `packages/protocol-nevermined/src/settlement-recovery.test.ts`). Proves
 * the adapter itself: request shape (method/headers/URL), response
 * validation, and 403/404 normalization — never a live network call, never
 * a real credential, never `RUN_LIVE_NEVERMINED=1`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NeverminedLiveGuardDeniedError,
  NeverminedSandboxReconciliationClient,
} from '../src/control-plane/evidence/nevermined-reconciliation-client';

const DELEGATION_ID = 'del-adapter-test-0000000000000000';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('NeverminedSandboxReconciliationClient — construction (live guard)', () => {
  it('throws immediately, never lazily, when RUN_LIVE_NEVERMINED is absent', () => {
    expect(() =>
      NeverminedSandboxReconciliationClient.authenticated({
        apiKey: 'fixture-key-never-real',
        liveGuard: { runLiveNevermined: undefined, apiKeyEnvironment: 'sandbox' },
      })
    ).toThrow(NeverminedLiveGuardDeniedError);
  });

  it('throws when the api key environment is not sandbox, even with the flag set', () => {
    expect(() =>
      NeverminedSandboxReconciliationClient.authenticated({
        apiKey: 'fixture-key-never-real',
        liveGuard: { runLiveNevermined: '1', apiKeyEnvironment: 'live' },
      })
    ).toThrow(NeverminedLiveGuardDeniedError);
  });
});

describe('NeverminedSandboxReconciliationClient — transport boundary (fetch mocked)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let client: NeverminedSandboxReconciliationClient;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    client = NeverminedSandboxReconciliationClient.authenticated({
      apiKey: 'fixture-seller-key-never-real',
      liveGuard: { runLiveNevermined: '1', apiKeyEnvironment: 'sandbox' },
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('listDelegationTransactions issues exactly one GET, sandbox URL, seller bearer token, correct API version header', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        transactions: [
          {
            id: 'tx-1',
            providerTransactionId: '0x' + 'a'.repeat(64),
            amountCents: '1',
            currency: 'USDC',
            status: 'succeeded',
            failureReason: null,
            createdAt: '2026-08-12T08:17:11.444Z',
          },
        ],
      })
    );
    const result = await client.listDelegationTransactions(DELEGATION_ID);
    expect(result.transactions).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(
      `https://api.sandbox.nevermined.app/api/v1/delegation/${DELEGATION_ID}/transactions`
    );
    expect((options as RequestInit).method).toBe('GET');
    const headers = (options as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer fixture-seller-key-never-real');
    expect(headers['Nevermined-Version']).toBe('1.1');
  });

  it('getDelegation issues exactly one GET against the single-delegation endpoint', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        delegationId: DELEGATION_ID,
        provider: 'erc4337',
        status: 'Exhausted',
        currency: 'usdc',
        planId: null,
        providerPaymentMethodId: '0xSomeone',
      })
    );
    const result = await client.getDelegation(DELEGATION_ID);
    expect(result).toMatchObject({ delegationId: DELEGATION_ID, provider: 'erc4337' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(
      `https://api.sandbox.nevermined.app/api/v1/delegation/${DELEGATION_ID}`
    );
    expect((options as RequestInit).method).toBe('GET');
  });

  it('getDelegation normalizes a 404 (not found) and a 403 (not authorized) identically to null — never distinguished', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('not found', { status: 404 }));
    expect(await client.getDelegation(DELEGATION_ID)).toBeNull();

    fetchSpy.mockResolvedValueOnce(new Response('forbidden', { status: 403 }));
    expect(await client.getDelegation(DELEGATION_ID)).toBeNull();
  });

  it('listDelegationTransactions surfaces any non-2xx as a thrown error, not a silently-empty result', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('server error', { status: 500 }));
    await expect(client.listDelegationTransactions(DELEGATION_ID)).rejects.toThrow(
      /nevermined_reconciliation_http_500/
    );
  });

  it('a malformed transactions response (missing/wrong-shaped "transactions") throws rather than being guessed at', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { unexpected: 'shape' }));
    await expect(client.listDelegationTransactions(DELEGATION_ID)).rejects.toThrow(
      /malformed_transactions_response/
    );
  });

  it('a malformed delegation response throws rather than being guessed at', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { unexpected: 'shape' }));
    await expect(client.getDelegation(DELEGATION_ID)).rejects.toThrow(
      /malformed_delegation_response/
    );
  });

  it('never issues a mutating HTTP method — every real call this class can make is GET', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, { transactions: [] }));
    await client.listDelegationTransactions(DELEGATION_ID);
    fetchSpy.mockResolvedValue(jsonResponse(404, {}));
    await client.getDelegation(DELEGATION_ID);
    for (const call of fetchSpy.mock.calls) {
      const options = call[1] as RequestInit;
      expect(options.method).toBe('GET');
    }
  });
});

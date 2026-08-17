/**
 * SUN-1000 checkpoint 1P — deterministic contract tests for
 * `NeverminedHttpFacilitatorClient`, the direct HTTP replacement for
 * `@nevermined-io/payments`'s `Payments.getInstance().facilitator`.
 *
 * Every fixture body below is either the EXACT shape the installed SDK's
 * own source constructs/expects (`facilitator-api.js`, verified this
 * checkpoint), or a REAL response this repository has actually captured
 * from the live Nevermined sandbox in an earlier, already-accepted
 * checkpoint (1O-B2A's raw-fetch differential probes) -- never invented
 * shapes. No live network call anywhere in this file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NeverminedHttpFacilitatorClient,
  NeverminedHttpError,
  NEVERMINED_LOCKED_API_VERSION,
  buildNeverminedPaymentRequiredLocal,
  resolveNeverminedEnvironmentFromApiKey,
} from '../src/control-plane/evidence/nevermined-http-client';
import type { NeverminedPaymentRequired } from '@siteborne/protocol-nevermined';

const PAYMENT_REQUIRED: NeverminedPaymentRequired = {
  x402Version: 2,
  resource: { url: 'https://utility.siteborne.net/v2/nevermined/company/evidence-graph' },
  accepts: [
    {
      scheme: 'nvm:erc4337',
      network: 'eip155:84532',
      planId: '10268032069987826322514735824876788768903142706079143267509577311063526800318',
      extra: {
        version: '1',
        agentId: '8945215415179810337511916177281451484220450532075244586308753062965582716389',
        httpVerb: 'POST',
      },
    },
  ],
  extensions: {},
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function client(overrides: Partial<{ apiVersion: string; timeoutMs: number }> = {}) {
  return new NeverminedHttpFacilitatorClient({
    apiKey: 'sandbox:fixture-key-never-a-real-secret',
    environment: 'sandbox',
    ...overrides,
  });
}

describe('NeverminedHttpFacilitatorClient contract', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('verify: sends the exact request shape the SDK itself constructs (path, headers, body)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ isValid: true, payer: '0xBUYER', network: 'eip155:84532' })
    );
    await client().verifyPermissions({
      paymentRequired: PAYMENT_REQUIRED,
      accessToken: 'opaque-token',
      authorizedMaximum: '39000',
    });
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(new URL(url).toString()).toBe('https://api.sandbox.nevermined.app/api/v1/x402/verify');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: 'Bearer sandbox:fixture-key-never-a-real-secret',
      'Nevermined-Version': NEVERMINED_LOCKED_API_VERSION,
    });
    expect(JSON.parse(options.body)).toEqual({
      paymentRequired: PAYMENT_REQUIRED,
      x402AccessToken: 'opaque-token',
      maxAmount: '39000',
    });
  });

  it('verify: real captured rejection shape (1O-B2A, "Cannot order pay-as-you-go plan") is parsed correctly, not thrown', async () => {
    // Real captured response body, checkpoint 1O-B2A.
    fetchMock.mockResolvedValue(
      jsonResponse({
        isValid: false,
        invalidReason: 'Cannot order pay-as-you-go plan',
        payer: '0xCa7DD940B5071Bbcb238901794B900CF9db376E7',
        agentRequestId: 'arId-93af7c66-13dd-4a3f-8bb6-50ca7404197f',
        agentRequest: {
          agentRequestId: 'arId-93af7c66-13dd-4a3f-8bb6-50ca7404197f',
          agentId: '8945215415179810337511916177281451484220450532075244586308753062965582716389',
          balance: {
            planId: PAYMENT_REQUIRED.accepts[0]!.planId,
            balance: '0',
            isSubscriber: true,
          },
        },
      })
    );
    const result = await client().verifyPermissions({
      paymentRequired: PAYMENT_REQUIRED,
      accessToken: 'opaque-token',
      authorizedMaximum: '39000',
    });
    expect(result).toMatchObject({
      isValid: false,
      invalidReason: 'Cannot order pay-as-you-go plan',
      payer: '0xCa7DD940B5071Bbcb238901794B900CF9db376E7',
      agentRequestId: 'arId-93af7c66-13dd-4a3f-8bb6-50ca7404197f',
    });
  });

  it('verify: isValid true (real accepted shape)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        isValid: true,
        payer: '0xBUYER',
        network: 'eip155:84532',
        agentRequestId: 'arId-1',
      })
    );
    const result = await client().verifyPermissions({
      paymentRequired: PAYMENT_REQUIRED,
      accessToken: 'opaque-token',
      authorizedMaximum: '39000',
    });
    expect(result).toEqual({
      isValid: true,
      invalidReason: undefined,
      payer: '0xBUYER',
      network: 'eip155:84532',
      agentRequestId: 'arId-1',
    });
  });

  it('verify: malformed body (missing isValid) fails closed', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ payer: '0xBUYER' }));
    await expect(
      client().verifyPermissions({
        paymentRequired: PAYMENT_REQUIRED,
        accessToken: 'opaque-token',
        authorizedMaximum: '39000',
      })
    ).rejects.toThrow(NeverminedHttpError);
  });

  it('settle: sends the exact request shape, including optional agentRequestId', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, payer: '0xBUYER', transaction: '0x' + 'a'.repeat(64) })
    );
    await client().settlePermissions({
      paymentRequired: PAYMENT_REQUIRED,
      accessToken: 'opaque-token',
      authorizedMaximum: '39000',
      actualAmount: '12000',
      agentRequestId: 'arId-1',
    });
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(new URL(url).toString()).toBe('https://api.sandbox.nevermined.app/api/v1/x402/settle');
    expect(JSON.parse(options.body)).toEqual({
      paymentRequired: PAYMENT_REQUIRED,
      x402AccessToken: 'opaque-token',
      maxAmount: '12000',
      agentRequestId: 'arId-1',
    });
  });

  it('settle: agentRequestId omitted entirely (not sent as undefined) when absent', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, payer: '0xBUYER', transaction: '0x' + 'a'.repeat(64) })
    );
    await client().settlePermissions({
      paymentRequired: PAYMENT_REQUIRED,
      accessToken: 'opaque-token',
      authorizedMaximum: '39000',
      actualAmount: '12000',
    });
    const [, options] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(options.body)).not.toHaveProperty('agentRequestId');
  });

  it('settle: success field absent (matches two independently-confirmed real ERC-4337 settlements, SUN-0900B checkpoint 1B) is preserved as undefined, not coerced to false', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ payer: '0xBUYER', transaction: '0x' + 'b'.repeat(64), creditsRedeemed: '1' })
    );
    const result = await client().settlePermissions({
      paymentRequired: PAYMENT_REQUIRED,
      accessToken: 'opaque-token',
      authorizedMaximum: '39000',
      actualAmount: '12000',
    });
    expect(result.success).toBeUndefined();
    expect(result.transaction).toBe('0x' + 'b'.repeat(64));
  });

  it('settle: missing transaction reference fails closed', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));
    await expect(
      client().settlePermissions({
        paymentRequired: PAYMENT_REQUIRED,
        accessToken: 'opaque-token',
        authorizedMaximum: '39000',
        actualAmount: '12000',
      })
    ).rejects.toThrow(NeverminedHttpError);
  });

  it('real captured 404 envelope shape (1O-B2A meta/versions probe) is parsed into a structured NeverminedHttpError', async () => {
    // Real captured response body, checkpoint 1O-B2A.
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          message: 'Cannot GET /api/v1/versions',
          error: 'Not Found',
          statusCode: 404,
          code: 'BCK.HTTP.404',
          httpStatus: 404,
          category: 'validation',
          retryable: false,
          correlationId: 'a9af1177be8380a380b995171da942ce',
        },
        404
      )
    );
    let caught: unknown;
    try {
      await client().verifyPermissions({
        paymentRequired: PAYMENT_REQUIRED,
        accessToken: 'opaque-token',
        authorizedMaximum: '39000',
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NeverminedHttpError);
    const err = caught as NeverminedHttpError;
    expect(err.code).toBe('BCK.HTTP.404');
    expect(err.category).toBe('validation');
    expect(err.correlationId).toBe('a9af1177be8380a380b995171da942ce');
    expect(err.httpStatus).toBe(404);
  });

  it('401/403: authentication/authorization failure surfaces a structured error, never a silent success', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ message: 'Unauthorized', code: 'BCK.AUTH.0001' }, 401)
    );
    await expect(
      client().verifyPermissions({
        paymentRequired: PAYMENT_REQUIRED,
        accessToken: 'opaque-token',
        authorizedMaximum: '39000',
      })
    ).rejects.toMatchObject({ code: 'BCK.AUTH.0001', httpStatus: 401 });
  });

  it('provider 5xx surfaces a structured error', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Internal Server Error' }, 500));
    await expect(
      client().settlePermissions({
        paymentRequired: PAYMENT_REQUIRED,
        accessToken: 'opaque-token',
        authorizedMaximum: '39000',
        actualAmount: '12000',
      })
    ).rejects.toMatchObject({ httpStatus: 500 });
  });

  it('malformed (non-JSON) error body still fails closed with a safe default message', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>not json</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      })
    );
    await expect(
      client().verifyPermissions({
        paymentRequired: PAYMENT_REQUIRED,
        accessToken: 'opaque-token',
        authorizedMaximum: '39000',
      })
    ).rejects.toMatchObject({ httpStatus: 502 });
  });

  it('malformed (non-JSON) SUCCESS body fails closed rather than returning undefined fields', async () => {
    fetchMock.mockResolvedValue(
      new Response('not json at all', { status: 200, headers: { 'content-type': 'text/plain' } })
    );
    await expect(
      client().verifyPermissions({
        paymentRequired: PAYMENT_REQUIRED,
        accessToken: 'opaque-token',
        authorizedMaximum: '39000',
      })
    ).rejects.toThrow(NeverminedHttpError);
  });

  it('network error (fetch throws) is wrapped, never silently swallowed', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(
      client().verifyPermissions({
        paymentRequired: PAYMENT_REQUIRED,
        accessToken: 'opaque-token',
        authorizedMaximum: '39000',
      })
    ).rejects.toThrow(NeverminedHttpError);
  });

  it('timeout: an aborted request surfaces a distinct timeout error', async () => {
    fetchMock.mockImplementation(() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });
    await expect(
      client({ timeoutMs: 1 }).verifyPermissions({
        paymentRequired: PAYMENT_REQUIRED,
        accessToken: 'opaque-token',
        authorizedMaximum: '39000',
      })
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('version mismatch: default pin is NEVERMINED_LOCKED_API_VERSION; an explicit override is sent instead', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ isValid: true, payer: '0xBUYER' }));
    await client({ apiVersion: '1.19' }).verifyPermissions({
      paymentRequired: PAYMENT_REQUIRED,
      accessToken: 'opaque-token',
      authorizedMaximum: '39000',
    });
    const [, options] = fetchMock.mock.calls[0]!;
    expect(options.headers['Nevermined-Version']).toBe('1.19');
  });

  it('version mismatch: a malformed version fails closed at construction, never sending an invalid header', () => {
    expect(() => client({ apiVersion: 'v1.1' })).toThrow(/invalid Nevermined API version/);
    expect(() => client({ apiVersion: '1' })).toThrow(/invalid Nevermined API version/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('buildNeverminedPaymentRequiredLocal (pure, no network)', () => {
  it('reproduces the SDK-shaped PaymentRequired exactly', () => {
    const result = buildNeverminedPaymentRequiredLocal(PAYMENT_REQUIRED.accepts[0]!.planId, {
      endpoint: PAYMENT_REQUIRED.resource.url,
      agentId: PAYMENT_REQUIRED.accepts[0]!.extra!.agentId!,
      httpVerb: 'POST',
      network: 'eip155:84532',
    });
    expect(result).toEqual(PAYMENT_REQUIRED);
  });
});

describe('resolveNeverminedEnvironmentFromApiKey (pure, no network)', () => {
  it.each([
    ['sandbox:jwt', 'sandbox'],
    ['live:jwt', 'live'],
    ['sandbox-staging:jwt', 'staging_sandbox'],
    ['live-staging:jwt', 'staging_live'],
    ['unknownprefix:jwt', undefined],
    ['no-colon-at-all', undefined],
    ['', undefined],
  ])('%s -> %s', (key, expected) => {
    expect(resolveNeverminedEnvironmentFromApiKey(key)).toBe(expected);
  });
});

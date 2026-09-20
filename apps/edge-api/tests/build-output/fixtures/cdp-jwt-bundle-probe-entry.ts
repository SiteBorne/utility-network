/**
 * FIRST-PAID-VERIFY-WORKER-JWT-BUNDLE-INIT-REMEDIATION-01 -- build-output probe.
 *
 * Bundled by Wrangler (esbuild) together with the ENTIRE production Worker
 * graph and executed under real workerd by `cdp-jwt-bundle-init.test.ts`. It
 * drives the real `CdpPaymentEvidenceProvider` verify / settle / supported
 * paths and the real `@coinbase/cdp-sdk/x402` facilitator client with a public
 * synthetic Ed25519 credential (RFC 8032 section 7.1 TEST 1: a published test
 * vector, unrelated to any SITEBORNE or CDP project, never sent anywhere).
 * `fetch` is replaced with a local capture, so no network request is made.
 *
 * The probe deliberately imports NO additional CDP SDK module beyond what the
 * production graph already imports: an extra `@coinbase/cdp-sdk/auth` import
 * here could itself initialise the module under test and mask the defect. It
 * reports structural booleans only -- never the JWT, the key or its id.
 */
import { createCdpFacilitatorClient } from '@coinbase/cdp-sdk/x402';
import type {
  PaymentSettlementContext,
  PaymentVerificationContext,
} from '@siteborne/protocol-x402';

import worker from '../../../src/index';
import {
  CdpPaymentEvidenceProvider,
  checkCdpSupportsNetwork,
} from '../../../src/control-plane/evidence/cdp-provider';

const PROBE_PATH = '/__cdp_jwt_bundle_probe';
const SEED_HEX = '9d61b19deffd5a60ba844af492ec2cc4' + '4449c5697b326919703bac031cae7f60';
const PUBLIC_HEX = 'd75a980182b10ab7d54bfed3c964073a' + '0ee172f3daa62325af021a68f707511a';
const SYNTHETIC_KEY_ID = 'synthetic-control-non-secret-test-key-id';

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
const PAYLOAD = { x402Version: 2, accepted: REQUIREMENTS, payload: { signature: '0x00' } };
const BASE = {
  service_id: 'verify_agent_output.v2' as const,
  service_version: 'v2' as const,
  scheme: 'exact' as const,
  network: NETWORK,
  asset: REQUIREMENTS.asset,
  payee: REQUIREMENTS.payTo,
  quote_id: 'qte_' + '1'.repeat(24),
  requirement_id: 'req_' + '2'.repeat(24),
  payment_identifier: 'pay_' + '3'.repeat(28),
  amount: REQUIREMENTS.amount,
  nowIso: '2026-09-20T00:00:00.000Z',
  expiresAt: '2026-09-20T00:05:00.000Z',
  authorizationContext: { rail: 'cdp' as const },
  paymentPayload: PAYLOAD,
  paymentRequirements: REQUIREMENTS,
};

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from((hex.match(/../g) ?? []).map((pair) => parseInt(pair, 16)));
}

function syntheticSecret(): string {
  const raw = new Uint8Array(64);
  raw.set(hexToBytes(SEED_HEX));
  raw.set(hexToBytes(PUBLIC_HEX), 32);
  return btoa(String.fromCharCode(...raw));
}

function b64urlJson(segment: string): Record<string, unknown> {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)));
}

/** Structural facts about the Authorization header of one captured request. */
function describeJwt(headers: Headers | undefined, expectedPathSuffix: string) {
  const authorization = headers?.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const parts = token.split('.');
  if (parts.length !== 3) return { jwt_present: false };
  const header = b64urlJson(parts[0] as string);
  const claims = b64urlJson(parts[1] as string);
  const uris = Array.isArray(claims.uris) ? (claims.uris as unknown[]) : [];
  return {
    jwt_present: true,
    alg_eddsa: header.alg === 'EdDSA',
    nonce_hex_32: typeof header.nonce === 'string' && /^[0-9a-f]{32}$/.test(header.nonce),
    sub_matches_key_id: claims.sub === SYNTHETIC_KEY_ID,
    iss_cdp: claims.iss === 'cdp',
    uri_scoped: uris.length === 1 && String(uris[0]).endsWith(expectedPathSuffix),
    signature_present: (parts[2] as string).length > 0,
  };
}

/** Coarse, allow-listed failure token; never the raw message. */
function failureToken(error: unknown): string {
  const message = String((error as { message?: unknown } | undefined)?.message ?? error);
  if (/getRandomValues is not a function/.test(message)) return 'getRandomValues_not_a_function';
  if (/is not a function/.test(message)) return 'other_not_a_function';
  return 'other_failure';
}

async function runPath(
  label: 'verify' | 'settle' | 'supported',
  run: (
    provider: CdpPaymentEvidenceProvider,
    facilitator: ReturnType<typeof createCdpFacilitatorClient>
  ) => Promise<unknown>
) {
  const captured: { headers?: Headers } = {};
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const request = input instanceof Request ? input : undefined;
    captured.headers = new Headers(init?.headers ?? request?.headers);
    const url = String(request?.url ?? input);
    const body = url.endsWith('/supported')
      ? {
          kinds: [{ x402Version: 2, scheme: 'exact', network: NETWORK }],
          extensions: [],
          signers: {},
        }
      : url.endsWith('/settle')
        ? {
            success: true,
            transaction: '0x' + 'a'.repeat(64),
            network: NETWORK,
            payer: '0x' + '5'.repeat(40),
          }
        : { isValid: true, payer: '0x' + '5'.repeat(40) };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    const facilitator = createCdpFacilitatorClient({
      apiKeyId: SYNTHETIC_KEY_ID,
      apiKeySecret: syntheticSecret(),
    });
    const provider = new CdpPaymentEvidenceProvider(facilitator);
    const outcome = await run(provider, facilitator);
    const evidence = outcome as
      | { verified?: unknown; reason?: unknown; subreason?: unknown }
      | undefined;
    const verdict =
      label === 'verify'
        ? {
            verified: evidence?.verified === true,
            ...(typeof evidence?.reason === 'string' ? { reason: evidence.reason } : {}),
            ...(typeof evidence?.subreason === 'string' ? { subreason: evidence.subreason } : {}),
          }
        : {};
    return {
      path: label,
      reached_facilitator_fetch: captured.headers !== undefined,
      ...verdict,
      ...describeJwt(captured.headers, label),
    };
  } catch (error) {
    return {
      path: label,
      reached_facilitator_fetch: captured.headers !== undefined,
      failure: failureToken(error),
    };
  } finally {
    globalThis.fetch = realFetch;
  }
}

async function probe(): Promise<Response> {
  const results = [
    await runPath('verify', (provider) => provider.verify(BASE as PaymentVerificationContext)),
    await runPath('settle', (provider) =>
      provider.settle(
        BASE as PaymentSettlementContext,
        {
          x402_version: 2,
          scheme: 'exact',
          network: NETWORK,
          quote_id: BASE.quote_id,
          requirement_id: BASE.requirement_id,
          payment_identifier: BASE.payment_identifier,
          verified: true,
          verifier_identity: 'cdp:facilitator',
          evidence_timestamp: BASE.nowIso,
          raw_evidence_hash: 'sha256:' + '4'.repeat(64),
          trust_class: 'external_verified',
        },
        BASE.amount
      )
    ),
    await runPath('supported', (_provider, facilitator) =>
      checkCdpSupportsNetwork(facilitator, NETWORK, ['exact'])
    ),
  ];
  return Response.json({ results });
}

export default {
  ...worker,
  async fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> {
    if (new URL(request.url).pathname === PROBE_PATH) return probe();
    return (worker as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }).fetch(
      request,
      env,
      ctx
    );
  },
};

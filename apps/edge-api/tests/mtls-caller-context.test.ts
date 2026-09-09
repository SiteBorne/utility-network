/**
 * SUN-1222C-AGENT-TRUST-100-IMPLEMENTATION-A — mTLS caller-context derivation
 * and the optional-authorization policy primitive.
 *
 * Pure unit tests: no real Cloudflare request, no real certificate, no
 * network call, no economic effect (`REAL_WEBHOOK_CALLS=0`,
 * `ECONOMIC_EFFECT_USDC=0`). Every case constructs the exact
 * `IncomingRequestCfPropertiesTLSClientAuth` /
 * `...Placeholder` shape Cloudflare's own pinned `@cloudflare/workers-types`
 * declares (verified by direct source read, not assumed).
 */
import { describe, expect, it } from 'vitest';
import type {
  IncomingRequestCfPropertiesTLSClientAuth,
  IncomingRequestCfPropertiesTLSClientAuthPlaceholder,
} from '@cloudflare/workers-types';
import {
  deriveMtlsCallerContext,
  evaluateMtlsAuthorization,
  type MtlsCallerContext,
} from '../src/control-plane/security/mtls-caller-context';

const NOT_PRESENTED: IncomingRequestCfPropertiesTLSClientAuthPlaceholder = {
  certPresented: '0',
  certVerified: 'NONE',
  certRevoked: '0',
  certIssuerDN: '',
  certSubjectDN: '',
  certIssuerDNRFC2253: '',
  certSubjectDNRFC2253: '',
  certIssuerDNLegacy: '',
  certSubjectDNLegacy: '',
  certSerial: '',
  certIssuerSerial: '',
  certSKI: '',
  certIssuerSKI: '',
  certFingerprintSHA1: '',
  certFingerprintSHA256: '',
  certNotBefore: '',
  certNotAfter: '',
  certRFC9440: '',
  certRFC9440TooLarge: false,
  certChainRFC9440: '',
  certChainRFC9440TooLarge: false,
};

function presented(
  overrides: Partial<IncomingRequestCfPropertiesTLSClientAuth>
): IncomingRequestCfPropertiesTLSClientAuth {
  return {
    certPresented: '1',
    certVerified: 'SUCCESS',
    certRevoked: '0',
    certIssuerDN: 'CN=SITEBORNE Trusted CA, O=SITEBORNE',
    certSubjectDN: 'CN=agent-42.example, O=Example Corp',
    certIssuerDNRFC2253: 'CN=SITEBORNE Trusted CA,O=SITEBORNE',
    certSubjectDNRFC2253: 'CN=agent-42.example,O=Example Corp',
    certIssuerDNLegacy: 'CN=SITEBORNE Trusted CA, O=SITEBORNE',
    certSubjectDNLegacy: 'CN=agent-42.example, O=Example Corp',
    certSerial: '00936EACBE07F201DF',
    certIssuerSerial: '2489002934BDFEA34',
    certSKI: 'BB:AF:7E:02:3D:FA:A6:F1:3C:84:8E:AD:EE:38:98:EC:D9:32:32:D4',
    certIssuerSKI: 'AA:AF:7E:02:3D:FA:A6:F1:3C:84:8E:AD:EE:38:98:EC:D9:32:32:D4',
    certFingerprintSHA1: '6b9109f323999e52259cda7373ff0b4d26bd232e',
    certFingerprintSHA256:
      'acf77cf37b4156a2708e34c4eb755f9b5dbbe5ebb55adfec8f11493438d19e6ad3f157f81fa3b98278453d5652b0c1fd1d71e5695ae4d709803a4d3f39de9dea',
    certNotBefore: 'Dec 22 19:39:00 2018 GMT',
    certNotAfter: 'Dec 22 19:39:00 2099 GMT',
    certRFC9440: ':base64-DER-placeholder:',
    certRFC9440TooLarge: false,
    certChainRFC9440: '',
    certChainRFC9440TooLarge: false,
    ...overrides,
  };
}

describe('deriveMtlsCallerContext', () => {
  it('S1 — no cf.tlsClientAuth object at all (non-edge / local dev) -> not_presented', () => {
    expect(deriveMtlsCallerContext(undefined)).toEqual<MtlsCallerContext>({
      state: 'not_presented',
      identity: null,
    });
  });

  it('S2 — certPresented "0" placeholder -> not_presented', () => {
    expect(deriveMtlsCallerContext(NOT_PRESENTED)).toEqual<MtlsCallerContext>({
      state: 'not_presented',
      identity: null,
    });
  });

  it('S3 — certPresented "1", certVerified SUCCESS, not revoked -> valid, with stable identity', () => {
    const context = deriveMtlsCallerContext(presented({}));
    expect(context.state).toBe('valid');
    expect(context.identity).toEqual({
      fingerprintSha256:
        'acf77cf37b4156a2708e34c4eb755f9b5dbbe5ebb55adfec8f11493438d19e6ad3f157f81fa3b98278453d5652b0c1fd1d71e5695ae4d709803a4d3f39de9dea',
      issuerDN: 'CN=SITEBORNE Trusted CA, O=SITEBORNE',
    });
  });

  it('S4 — certVerified SUCCESS but certRevoked "1" -> revoked (revocation wins over chain trust)', () => {
    const context = deriveMtlsCallerContext(presented({ certRevoked: '1' }));
    expect(context).toEqual<MtlsCallerContext>({ state: 'revoked', identity: null });
  });

  it.each([
    'FAILED:self signed certificate',
    'FAILED:unable to verify the first certificate',
    'FAILED:certificate is not yet valid',
    'FAILED:certificate has expired',
    'FAILED',
  ] as const)('S5 — certVerified %s -> invalid', (certVerified) => {
    const context = deriveMtlsCallerContext(presented({ certVerified }));
    expect(context).toEqual<MtlsCallerContext>({ state: 'invalid', identity: null });
  });

  it('S6 — an unrecognized future certVerified value fails closed to unknown, not valid', () => {
    const context = deriveMtlsCallerContext(
      presented({ certVerified: 'SOME_FUTURE_VALUE_NOT_YET_ENUMERATED' as 'SUCCESS' })
    );
    expect(context.state).toBe('unknown');
    expect(context.identity).toBeNull();
  });

  it('S7 — spoofed-header immunity: the function has no Request/Headers parameter at all', () => {
    // This is a structural proof, not a runtime one: deriveMtlsCallerContext's
    // only parameter is the trusted cf.tlsClientAuth value. A caller who
    // tried to smuggle identity via `X-Client-Cert`, `Client-Cert`, or any
    // `Cf-Client-Cert-*` header has no code path into this function at all —
    // there is nothing to pass those headers *as*. We assert this by
    // confirming the function's arity is exactly 1 and that constructing a
    // Request with spoofed headers and reading only its (safe) `cf` field
    // reproduces the identical, header-independent result.
    expect(deriveMtlsCallerContext.length).toBe(1);

    const spoofedRequest = new Request('https://utility.siteborne.net/a2a', {
      headers: {
        'x-client-cert': 'FAKE-ADMIN-CERT',
        'client-cert': ':FAKE:',
        'cf-client-cert-verified': 'SUCCESS',
      },
    });
    // The only thing this module ever reads is cf.tlsClientAuth -- the
    // spoofed headers above are never even passed in.
    const cf = (spoofedRequest as unknown as { cf?: { tlsClientAuth?: unknown } }).cf;
    expect(deriveMtlsCallerContext(cf?.tlsClientAuth as never)).toEqual<MtlsCallerContext>({
      state: 'not_presented',
      identity: null,
    });
  });
});

describe('evaluateMtlsAuthorization', () => {
  const valid: MtlsCallerContext = {
    state: 'valid',
    identity: { fingerprintSha256: 'abc', issuerDN: 'CN=Test' },
  };
  const notPresented: MtlsCallerContext = { state: 'not_presented', identity: null };
  const invalid: MtlsCallerContext = { state: 'invalid', identity: null };
  const revoked: MtlsCallerContext = { state: 'revoked', identity: null };

  it("S8 — policy.required=false (today's only real usage): every state is authorized", () => {
    for (const context of [valid, notPresented, invalid, revoked]) {
      expect(evaluateMtlsAuthorization(context, { required: false })).toEqual({
        authorized: true,
      });
    }
  });

  it('S9 — policy.required=true, valid context -> authorized', () => {
    expect(evaluateMtlsAuthorization(valid, { required: true })).toEqual({ authorized: true });
  });

  it.each([
    ['not_presented', notPresented],
    ['invalid', invalid],
    ['revoked', revoked],
  ] as const)(
    'S10 — policy.required=true, %s context -> denied with a stable reason',
    (label, context) => {
      const decision = evaluateMtlsAuthorization(context, { required: true });
      expect(decision.authorized).toBe(false);
      expect(decision.reason).toBe(`mtls_required_but_state_is_${label}`);
    }
  );

  it('S11 — invariant: this module has zero knowledge of payment/x402/settlement', () => {
    // Structural, not behavioral: the exported surface has no parameter or
    // return field named/shaped like a payment authorization, and the
    // decision never depends on anything but (context, policy). This test
    // exists so that a future edit adding e.g. a `paymentAuthorized`
    // shortcut to `evaluateMtlsAuthorization` fails loudly rather than
    // silently creating a second economic-authorization path.
    const decision = evaluateMtlsAuthorization(valid, { required: false });
    expect(Object.keys(decision).sort()).toEqual(['authorized']);
  });
});

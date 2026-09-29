import { describe, expect, it } from 'vitest';
import {
  mapVerifiedMtlsPrincipal,
  validateMtlsPrincipalRegistry,
  type MtlsPrincipalRegistryRecord,
} from '../src/control-plane/security/mtls-principal';
import {
  authenticateResultPrincipal,
  buildResultAuthorizationRuntime,
} from '../src/control-plane/security/request-principal';
import { deriveMtlsCallerContext } from '../src/control-plane/security/mtls-caller-context';
import { canonicalSubjectReference } from '../src/control-plane/security/result-authorization';

const SKI = 'DD5C89ACBD3C82530BE5B31AF77C52E5C281B6D4';
const OTHER_SKI = 'AA5C89ACBD3C82530BE5B31AF77C52E5C281B6D4';
const SHA = 'aa'.repeat(32);
const SHA2 = 'bb'.repeat(32);
const NOW = '2026-09-22T12:00:00.000Z';
const KEY = new Uint8Array(32).fill(7);

const record = (over: Partial<MtlsPrincipalRegistryRecord> = {}): MtlsPrincipalRegistryRecord => ({
  issuer_ski: SKI,
  certificate_sha256: SHA,
  issuer: 'test:issuer',
  subject_id: 'test-subject',
  subject_type: 'workload',
  assurance_level: 'cryptographic_workload',
  ...over,
});

const valid = (ski: string, sha: string) =>
  ({ state: 'valid', identity: { fingerprintSha256: sha, issuerSKI: ski, issuerDN: 'CN=x' } }) as const;

const cf = (over: Record<string, string>) => ({
  certPresented: '1',
  certRevoked: '0',
  certVerified: 'SUCCESS',
  certFingerprintSHA256: SHA,
  certIssuerSKI: SKI,
  certIssuerDN: 'CN=anything',
  ...over,
});

function req(tls?: Record<string, string>, headers?: Record<string, string>) {
  const r = new Request('https://utility.siteborne.net/v3/verify/agent-output', { headers });
  if (tls) Object.defineProperty(r, 'cf', { value: { tlsClientAuth: tls } });
  return r;
}
const auth = (r: Request, registry = [record()]) =>
  authenticateResultPrincipal(r, { oidcIssuers: [], mtlsRegistry: registry, now: () => NOW });

describe('SKI + leaf-fingerprint registry match', () => {
  it('1 accepts correct SKI + fingerprint (separator/case tolerant)', () => {
    expect(mapVerifiedMtlsPrincipal(valid(SKI, SHA), [record()], NOW)).not.toBeNull();
    const colon = SKI.match(/../gu)!.join(':').toLowerCase();
    expect(mapVerifiedMtlsPrincipal(valid(colon, SHA.toUpperCase()), [record()], NOW)).not.toBeNull();
  });
  it('2 denies correct SKI + wrong fingerprint', () => {
    expect(mapVerifiedMtlsPrincipal(valid(SKI, SHA2), [record()], NOW)).toBeNull();
  });
  it('3 denies wrong SKI + correct fingerprint', () => {
    expect(mapVerifiedMtlsPrincipal(valid(OTHER_SKI, SHA), [record()], NOW)).toBeNull();
  });
  it('4 denies missing SKI', () => {
    expect(mapVerifiedMtlsPrincipal(valid('', SHA), [record()], NOW)).toBeNull();
  });
  it('5 malformed SKI: request denied, config rejected', () => {
    expect(mapVerifiedMtlsPrincipal(valid('not-hex', SHA), [record()], NOW)).toBeNull();
    expect(() => validateMtlsPrincipalRegistry([record({ issuer_ski: 'zz' })])).toThrow(
      'result_auth_mtls_registry_issuer_ski_invalid'
    );
    expect(() => validateMtlsPrincipalRegistry([record({ issuer_ski: '' })])).toThrow();
  });
  it('6 malformed fingerprint denied / rejected', () => {
    expect(mapVerifiedMtlsPrincipal(valid(SKI, 'abcd'), [record()], NOW)).toBeNull();
    expect(() => validateMtlsPrincipalRegistry([record({ certificate_sha256: 'abcd' })])).toThrow(
      'result_auth_mtls_registry_certificate_sha256_invalid'
    );
  });
  it('7-9 no cert / verification failure / revoked => denied', async () => {
    expect(await auth(req())).toBeNull();
    expect(await auth(req(cf({ certPresented: '0' })))).toBeNull();
    expect(await auth(req(cf({ certVerified: 'FAILED:self signed certificate' })))).toBeNull();
    expect(await auth(req(cf({ certRevoked: '1' })))).toBeNull();
    expect(deriveMtlsCallerContext(undefined).state).toBe('not_presented');
    expect(await auth(req(cf({})))).not.toBeNull();
  });
  it('10 caller headers cannot forge mTLS identity', async () => {
    const headers = {
      'X-Client-Cert-Sha256': SHA,
      'X-Client-Cert-Issuer-SKI': SKI,
      'Client-Cert': SHA,
      'X-Forwarded-Client-Cert': `Hash=${SHA}`,
    };
    expect(await auth(req(undefined, headers))).toBeNull();
  });
  it('11 rotated registered cert, same principal => same owner ref', () => {
    const registry = [record(), record({ certificate_sha256: SHA2 })];
    const a = mapVerifiedMtlsPrincipal(valid(SKI, SHA), registry, NOW)!;
    const b = mapVerifiedMtlsPrincipal(valid(SKI, SHA2), registry, NOW)!;
    const ref = (p: typeof a) => canonicalSubjectReference(p.subject, { key: KEY, keyVersion: 'k1' });
    expect(ref(a)).toBe(ref(b));
    expect(a.subject.credential_binding?.value).not.toBe(b.subject.credential_binding?.value);
  });
  it('12 unregistered rotated cert denied', () => {
    expect(mapVerifiedMtlsPrincipal(valid(SKI, SHA2), [record()], NOW)).toBeNull();
  });
  it('13 conflicting duplicate bindings rejected; identical duplicates tolerated', () => {
    expect(() =>
      validateMtlsPrincipalRegistry([record(), record({ subject_id: 'someone-else' })])
    ).toThrow('result_auth_mtls_registry_conflicting_binding');
    expect(() => validateMtlsPrincipalRegistry([record(), record()])).not.toThrow();
  });
  it('subject ref excludes fingerprint and SKI; different principal differs', () => {
    const a = mapVerifiedMtlsPrincipal(valid(SKI, SHA), [record()], NOW)!;
    const c = mapVerifiedMtlsPrincipal(
      valid(OTHER_SKI, SHA),
      [record({ issuer_ski: OTHER_SKI })],
      NOW
    )!;
    const ref = (p: typeof a) => canonicalSubjectReference(p.subject, { key: KEY, keyVersion: 'k1' });
    expect(ref(a)).toBe(ref(c));
    const d = mapVerifiedMtlsPrincipal(valid(SKI, SHA), [record({ subject_id: 'other' })], NOW)!;
    expect(ref(a)).not.toBe(ref(d));
  });
  it('rejects other invalid record fields', () => {
    expect(() => validateMtlsPrincipalRegistry([record({ issuer: ' ' })])).toThrow();
    expect(() => validateMtlsPrincipalRegistry([record({ subject_id: '' })])).toThrow();
    expect(() =>
      validateMtlsPrincipalRegistry([record({ subject_type: 'human' as never })])
    ).toThrow();
    expect(() =>
      validateMtlsPrincipalRegistry([record({ assurance_level: 'x' as never })])
    ).toThrow();
    expect(() => validateMtlsPrincipalRegistry([{ issuer_dn: 'CN=x' } as never])).toThrow();
  });
  it('runtime builder fails closed on a malformed registry (no DN fallback)', () => {
    const base = {
      RESULT_SUBJECT_REFERENCE_KEY: Buffer.from(KEY).toString('base64url'),
      RESULT_SUBJECT_REFERENCE_KEY_VERSION: 'k1',
    };
    expect(() =>
      buildResultAuthorizationRuntime({
        ...base,
        RESULT_AUTH_MTLS_REGISTRY_JSON: JSON.stringify([
          { ...record(), issuer_ski: undefined, issuer_dn: 'CN=x' },
        ]),
      })
    ).toThrow('result_auth_mtls_registry_issuer_ski_invalid');
    expect(
      buildResultAuthorizationRuntime({
        ...base,
        RESULT_AUTH_MTLS_REGISTRY_JSON: JSON.stringify([record()]),
      })
    ).not.toBeNull();
  });
});

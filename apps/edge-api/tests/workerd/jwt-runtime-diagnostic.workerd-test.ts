/**
 * FIRST-PAID-VERIFY-JWT-RUNTIME-VS-BOUND-SECRET-DIAGNOSTIC-01 — the same-invocation
 * local controls run inside real workerd against a throwaway Ed25519 credential
 * generated in-runtime, plus the outer-shape variants that Node's lenient
 * Buffer base64 decoding may treat differently from workerd's. No network.
 */
import { describe, expect, it } from 'vitest';

import { runJwtDiagnostic } from '../../src/control-plane/evidence/cdp-jwt-diagnostic';
import { generateJwt } from '@coinbase/cdp-sdk/auth';

import type { JwtDiagnosticDeps } from '../../src/control-plane/evidence/cdp-jwt-diagnostic';

const ID = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const b64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function throwaway(): Promise<string> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' } as never, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as { d: string; x: string };
  return b64(new Uint8Array([...b64url(jwk.d), ...b64url(jwk.x)]));
}

describe('JWT runtime diagnostic under real workerd', () => {
  // The vitest workers pool cannot load `@coinbase/cdp-sdk/x402` (its transitive
  // `zod` import fails under this pool's resolver; the esbuild-bundled Worker is
  // unaffected). So these deps use the same public `generateJwt` for both
  // controls; the production-shaped `createCdpFacilitatorClient` path is covered
  // by the Node full-stack suite and by the live canary itself.
  const RFC8032_SEED = '9d61b19deffd5a60ba844af492ec2cc4' + '4449c5697b326919703bac031cae7f60';
  const RFC8032_PUB = 'd75a980182b10ab7d54bfed3c964073a' + '0ee172f3daa62325af021a68f707511a';
  const hex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
  const deps: JwtDiagnosticDeps = {
    mintJwt: (args) => generateJwt(args),
    createSyntheticAuthHeaders: async (apiKeyId, apiKeySecret) =>
      generateJwt({
        apiKeyId,
        apiKeySecret,
        requestMethod: 'POST',
        requestHost: 'api.cdp.coinbase.com',
        requestPath: '/platform/v2/x402/verify',
      }),
    syntheticKeyId: 'synthetic-control-non-secret-test-key-id',
    syntheticKeySecret: b64(new Uint8Array([...hex(RFC8032_SEED), ...hex(RFC8032_PUB)])),
  };

  it('synthetic control and bound direct mint both PASS for a valid Ed25519 credential', async () => {
    const d = await runJwtDiagnostic({ apiKeyId: ID, apiKeySecret: await throwaway() }, deps);
    expect(d).toMatchObject({
      synthetic_jwt_control: 'PASS',
      bound_direct_jwt_mint: 'PASS',
      binding_algorithm: 'ED25519',
      binding_format: 'VALID',
    });
  });

  it('records how workerd treats quote/whitespace/CRLF variants (enums only)', async () => {
    const ed = await throwaway();
    const variants = {
      quoted: `"${ed}"`,
      newline: `${ed}\n`,
      crlf: `${ed}\r\n`,
      padded: ` ${ed} `,
    };
    const seen: Record<string, string> = {};
    for (const [name, secret] of Object.entries(variants)) {
      const d = await runJwtDiagnostic({ apiKeyId: ID, apiKeySecret: secret }, deps);
      seen[name] = `${d.binding_format}/${d.bound_direct_jwt_mint}/${d.bound_direct_failure_class}`;
      expect(d.synthetic_jwt_control).toBe('PASS');
    }
    // Informational: printed as enums only; behaviour differences vs Node are the point.
    console.info('WORKERD_VARIANTS', JSON.stringify(seen));
  });
});

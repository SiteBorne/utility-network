/**
 * FIRST-PAID-VERIFY-JWT-RUNTIME-VS-BOUND-SECRET-DIAGNOSTIC-01 — the ONLY file
 * that wires the pure diagnostic to the real `@coinbase/cdp-sdk`. Both controls
 * are local: `generateJwt` signs in-process and `createAuthHeaders` builds
 * headers without any fetch.
 *
 * Synthetic control material is the published RFC 8032 section 7.1 "TEST 1"
 * Ed25519 vector (seed and public key). It is a public test vector, unrelated
 * to any SITEBORNE or CDP project, carries no permission anywhere, is never sent
 * to CDP and is never persisted. It is assembled at runtime from two hex
 * halves, so no realistic secret literal exists in the tree.
 */
import { generateJwt } from '@coinbase/cdp-sdk/auth';
import { createCdpFacilitatorClient } from '@coinbase/cdp-sdk/x402';

import type { JwtDiagnosticDeps } from './cdp-jwt-diagnostic';

const RFC8032_TEST1_SEED_HEX =
  '9d61b19deffd5a60ba844af492ec2cc4' + '4449c5697b326919703bac031cae7f60';
const RFC8032_TEST1_PUBLIC_HEX =
  'd75a980182b10ab7d54bfed3c964073a' + '0ee172f3daa62325af021a68f707511a';

export const SYNTHETIC_CONTROL_KEY_ID = 'synthetic-control-non-secret-test-key-id';

export function syntheticControlSecret(): string {
  return Buffer.concat([
    Buffer.from(RFC8032_TEST1_SEED_HEX, 'hex'),
    Buffer.from(RFC8032_TEST1_PUBLIC_HEX, 'hex'),
  ]).toString('base64');
}

export function buildRealJwtDiagnosticDeps(): JwtDiagnosticDeps {
  return {
    mintJwt: (args) => generateJwt(args),
    createSyntheticAuthHeaders: async (apiKeyId, apiKeySecret, path) => {
      const client = createCdpFacilitatorClient({ apiKeyId, apiKeySecret });
      return client.createAuthHeaders(path);
    },
    syntheticKeyId: SYNTHETIC_CONTROL_KEY_ID,
    syntheticKeySecret: syntheticControlSecret(),
  };
}

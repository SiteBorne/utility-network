/**
 * FIRST-PAID-VERIFY-CDP-CREDENTIAL-REMEDIATION-01 — LOCAL-ONLY, OFFLINE CDP
 * credential validator for the human operator.
 *
 * Reads CDP_API_KEY_ID / CDP_API_KEY_SECRET from the operator's own shell,
 * asks the exact installed `@coinbase/cdp-sdk` `generateJwt` (the same call
 * the Worker's facilitator client makes, for the same three facilitator
 * paths) whether it can mint a JWT from them, and prints ONLY finite,
 * normalized enum lines.
 *
 * Guarantees, each enforced by tests/cdp-credential-validator.test.ts:
 *  - never imported by the Worker (lives outside `src/`, outside tsconfig)
 *  - no network call of any kind (`generateJwt` is local signing)
 *  - never prints, logs, or writes the key id, the secret, or a JWT
 *  - never prints `Error.message`, `cause`, or a stack: every failure is
 *    reduced to a member of `CDP_JWT_SUBREASONS` (or VALIDATOR_INTERNAL_ERROR)
 *  - every output line matches ^[A-Z0-9_]+=[A-Z0-9_]+$ or it is dropped
 *  - writes no file
 *
 * What a PASS proves and does not prove: it proves this operator copy of the
 * credential is well-formed and can sign. It does NOT prove the id/secret are
 * paired, that the key is active, or that Cloudflare holds the same bytes —
 * only the CDP server can answer the first two, and only a Worker-side check
 * can answer the third.
 */
import { generateJwt } from '@coinbase/cdp-sdk/auth';

import {
  classifyIdShape,
  classifySecretShape,
  isQuoted,
  type IdShape,
  type SecretShape,
} from '../src/control-plane/evidence/cdp-credential-shape';
import {
  CDP_JWT_SUBREASONS,
  classifyCdpJwtFailure,
} from '../src/control-plane/evidence/cdp-jwt-failure';

const FACILITATOR_HOST = 'api.cdp.coinbase.com';
const FACILITATOR_BASE_PATH = '/platform/v2/x402';

/** The three calls `createCdpFacilitatorClient` makes on every request. */
const MINT_TARGETS: ReadonlyArray<{ method: 'GET' | 'POST'; path: string }> = [
  { method: 'POST', path: `${FACILITATOR_BASE_PATH}/verify` },
  { method: 'POST', path: `${FACILITATOR_BASE_PATH}/settle` },
  { method: 'GET', path: `${FACILITATOR_BASE_PATH}/supported` },
];

export type MintJwt = (args: {
  apiKeyId: string;
  apiKeySecret: string;
  requestMethod: 'GET' | 'POST';
  requestHost: string;
  requestPath: string;
}) => Promise<string>;

export interface ValidatorDeps {
  mintJwt: MintJwt;
}

export type { IdShape, SecretShape };
export type KeyType = 'EC_PEM' | 'ED25519' | 'UNKNOWN';
export type FailureClass =
  | 'NONE'
  | 'VALIDATOR_INTERNAL_ERROR'
  | (typeof CDP_JWT_SUBREASONS)[number];

export interface ValidationResult {
  idPresent: boolean;
  secretPresent: boolean;
  idShape: IdShape;
  idQuoted: boolean;
  idSurroundingWhitespace: boolean;
  secretShape: SecretShape;
  secretQuoted: boolean;
  secretSurroundingWhitespace: boolean;
  secretCrlf: boolean;
  keyType: KeyType;
  jwtMint: 'PASS' | 'FAIL';
  failureClass: FailureClass;
}

function keyTypeFromJwt(jwt: string): KeyType {
  const parts = jwt.split('.');
  if (parts.length !== 3) return 'UNKNOWN';
  try {
    const alg = (
      JSON.parse(Buffer.from(parts[0] ?? '', 'base64url').toString('utf8')) as {
        alg?: unknown;
      }
    ).alg;
    if (alg === 'ES256') return 'EC_PEM';
    if (alg === 'EdDSA') return 'ED25519';
  } catch {
    // fall through: only an enum is ever reported
  }
  return 'UNKNOWN';
}

export async function validateCdpCredentials(
  env: Record<string, string | undefined>,
  deps: ValidatorDeps
): Promise<ValidationResult> {
  const id = env.CDP_API_KEY_ID ?? '';
  const secret = env.CDP_API_KEY_SECRET ?? '';
  const result: ValidationResult = {
    idPresent: id.length > 0,
    secretPresent: secret.length > 0,
    idShape: classifyIdShape(id),
    idQuoted: isQuoted(id),
    idSurroundingWhitespace: id !== id.trim(),
    secretShape: classifySecretShape(secret),
    secretQuoted: isQuoted(secret),
    secretSurroundingWhitespace: secret !== secret.trim(),
    secretCrlf: secret.includes('\r\n'),
    keyType: 'UNKNOWN',
    jwtMint: 'FAIL',
    failureClass: 'NONE',
  };
  try {
    let keyType: KeyType = 'UNKNOWN';
    for (const target of MINT_TARGETS) {
      // The JWT is held only long enough to read its `alg`; it is never
      // stored, returned, or printed.
      const jwt = await deps.mintJwt({
        apiKeyId: id,
        apiKeySecret: secret,
        requestMethod: target.method,
        requestHost: FACILITATOR_HOST,
        requestPath: target.path,
      });
      keyType = keyTypeFromJwt(typeof jwt === 'string' ? jwt : '');
    }
    result.keyType = keyType;
    result.jwtMint = 'PASS';
  } catch (error) {
    result.failureClass = classifyCdpJwtFailure(error);
  }
  return result;
}

const yn = (value: boolean): 'YES' | 'NO' => (value ? 'YES' : 'NO');
const LINE = /^[A-Z0-9_]+=[A-Z0-9_]+$/;

export function formatReport(result: ValidationResult): string[] {
  const lines = [
    `CDP_API_KEY_ID_PRESENT=${yn(result.idPresent)}`,
    `CDP_API_KEY_SECRET_PRESENT=${yn(result.secretPresent)}`,
    `CDP_API_KEY_ID_SHAPE=${result.idShape}`,
    `CDP_API_KEY_ID_QUOTED=${yn(result.idQuoted)}`,
    `CDP_API_KEY_ID_SURROUNDING_WHITESPACE=${yn(result.idSurroundingWhitespace)}`,
    `CDP_API_KEY_SECRET_SHAPE=${result.secretShape}`,
    `CDP_API_KEY_SECRET_QUOTED=${yn(result.secretQuoted)}`,
    `CDP_API_KEY_SECRET_SURROUNDING_WHITESPACE=${yn(result.secretSurroundingWhitespace)}`,
    `CDP_API_KEY_SECRET_CRLF=${yn(result.secretCrlf)}`,
    `CDP_KEY_TYPE=${result.keyType}`,
    `CDP_CREDENTIAL_FORMAT=${result.jwtMint === 'PASS' ? 'VALID' : 'INVALID'}`,
    `CDP_JWT_MINT=${result.jwtMint}`,
    `CDP_JWT_FAILURE_CLASS=${result.failureClass.toUpperCase()}`,
    'CDP_VALIDATOR_NETWORK_ACCESS=NONE',
  ];
  // Belt and braces: only enum-shaped lines can ever reach a stream.
  return lines.filter((line) => LINE.test(line));
}

export { classifyIdShape, classifySecretShape };

export const INTERNAL_ERROR_REPORT = [
  'CDP_CREDENTIAL_FORMAT=INVALID',
  'CDP_JWT_MINT=FAIL',
  'CDP_JWT_FAILURE_CLASS=VALIDATOR_INTERNAL_ERROR',
  'CDP_VALIDATOR_NETWORK_ACCESS=NONE',
];

function emit(lines: string[]): void {
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function main(): Promise<number> {
  const result = await validateCdpCredentials(process.env, {
    mintJwt: (args) => generateJwt(args),
  });
  emit(formatReport(result));
  return result.jwtMint === 'PASS' ? 0 : 1;
}

function isEntrypoint(): boolean {
  const entry = process.argv[1] ?? '';
  return /validate-cdp-credentials\.m?[jt]s$/.test(entry);
}

if (isEntrypoint()) {
  const fail = (): void => {
    emit(INTERNAL_ERROR_REPORT);
    process.exit(2);
  };
  process.on('uncaughtException', fail);
  process.on('unhandledRejection', fail);
  main().then(
    (code) => process.exit(code),
    () => fail()
  );
}

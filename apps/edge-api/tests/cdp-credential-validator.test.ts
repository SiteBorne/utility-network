/**
 * FIRST-PAID-VERIFY-CDP-CREDENTIAL-REMEDIATION-01 — the offline CDP credential
 * validator and the JWT-stage subclassifier.
 *
 * Every secret here is a throwaway generated in-process or an obvious
 * sentinel. Nothing reads a real credential, and nothing touches a network.
 */
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { generateJwt } from '@coinbase/cdp-sdk/auth';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  classifyFacilitatorVerifyFailure,
  FacilitatorAuthStageError,
} from '../src/control-plane/evidence/cdp-facilitator-failure';
import {
  CDP_JWT_SUBREASONS,
  classifyCdpJwtFailure,
} from '../src/control-plane/evidence/cdp-jwt-failure';
import {
  classifyIdShape,
  classifySecretShape,
  formatReport,
  INTERNAL_ERROR_REPORT,
  validateCdpCredentials,
  type MintJwt,
} from '../scripts/validate-cdp-credentials.mts';

const EDGE_API = resolve(__dirname, '..');
const SCRIPT = join(EDGE_API, 'scripts', 'validate-cdp-credentials.mts');
const TSX = join(EDGE_API, 'node_modules', '.bin', 'tsx');

const SENTINEL_SECRET = 'SENTINEL-not-a-real-credential-must-never-appear';
const SENTINEL_ID = 'SENTINEL-CDP-KEY-ID-must-never-appear-4d8e';
const UUID_ID = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';

const ecPem = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();
const ed = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' }) as {
  d: string;
  x: string;
};
const ed25519Secret = Buffer.concat([
  Buffer.from(ed.d, 'base64url'),
  Buffer.from(ed.x, 'base64url'),
]).toString('base64');

const realMint: MintJwt = (args) => generateJwt(args);
const JWT_SHAPE = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/;
const ENUM_LINE = /^[A-Z0-9_]+=[A-Z0-9_]+$/;

function run(env: Record<string, string>, tmp: string) {
  const child = spawnSync(TSX, [SCRIPT], {
    cwd: tmp,
    encoding: 'utf8',
    timeout: 60_000,
    env: { PATH: process.env.PATH ?? '', HOME: tmp, TMPDIR: tmp, ...env },
  });
  return { status: child.status, stdout: child.stdout, stderr: child.stderr };
}

function allFileContents(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...allFileContents(p));
    else out.push(readFileSync(p, 'utf8'));
  }
  return out;
}

describe('cdp-jwt-failure classifier (installed SDK error shapes)', () => {
  const call = (id: string, secret: string) =>
    realMint({
      apiKeyId: id,
      apiKeySecret: secret,
      requestMethod: 'POST',
      requestHost: 'api.cdp.coinbase.com',
      requestPath: '/platform/v2/x402/verify',
    });
  const classify = async (id: string, secret: string) => {
    try {
      await call(id, secret);
      return 'MINTED';
    } catch (error) {
      return classifyCdpJwtFailure(error);
    }
  };

  it('A/B: missing id and missing secret are distinguished', async () => {
    expect(await classify('', ecPem)).toBe('cdp_key_id_missing');
    expect(await classify(UUID_ID, '')).toBe('cdp_key_secret_missing');
  });

  it('C/D/E: invalid format, malformed PEM, and wrong encoding are format failures', async () => {
    expect(await classify(UUID_ID, SENTINEL_SECRET)).toBe('cdp_key_format_invalid');
    expect(await classify(UUID_ID, ecPem.slice(0, 80))).toBe('cdp_key_format_invalid');
    expect(await classify(UUID_ID, ecPem.replace(/\n/g, '\\n'))).toBe('cdp_key_format_invalid');
    expect(await classify(UUID_ID, randomBytes(32).toString('base64'))).toBe(
      'cdp_key_format_invalid'
    );
  });

  it('a 64-byte base64 value that is not a real Ed25519 pair is a parse failure', async () => {
    expect(await classify(UUID_ID, randomBytes(64).toString('base64'))).toBe(
      'cdp_key_parse_failed'
    );
  });

  it('F: valid supported EC and Ed25519 keys mint', async () => {
    expect(await classify(UUID_ID, ecPem)).toBe('MINTED');
    expect(await classify(UUID_ID, ed25519Secret)).toBe('MINTED');
  });

  it('G: an unrecognised error, or a sign-stage error, maps to a finite class', () => {
    expect(classifyCdpJwtFailure(new Error('Failed to generate EC JWT: boom'))).toBe(
      'cdp_jwt_signing_failed'
    );
    expect(classifyCdpJwtFailure(new Error(SENTINEL_SECRET))).toBe('cdp_jwt_unknown_failure');
    expect(classifyCdpJwtFailure(undefined)).toBe('cdp_jwt_unknown_failure');
    expect(classifyCdpJwtFailure({ message: 42 })).toBe('cdp_jwt_unknown_failure');
  });

  it('never returns anything outside the closed vocabulary', () => {
    for (const e of [new Error('x'), null, 'str', { message: SENTINEL_SECRET }]) {
      expect(CDP_JWT_SUBREASONS).toContain(classifyCdpJwtFailure(e));
    }
  });

  it('a JWT-stage facilitator failure carries the jwt subreason and nothing from the cause', () => {
    const cause = new Error(`Failed to generate EC JWT: ${SENTINEL_SECRET}`);
    const classified = classifyFacilitatorVerifyFailure(new FacilitatorAuthStageError(cause));
    expect(classified).toEqual({
      subreason: 'facilitator_jwt_generation_failed',
      retryability: 'operator_action_required',
      jwt_subreason: 'cdp_jwt_signing_failed',
    });
    expect(JSON.stringify(classified)).not.toContain(SENTINEL_SECRET);
  });

  it('non-JWT failures gain no jwt_subreason', () => {
    expect(classifyFacilitatorVerifyFailure(new TypeError('fetch failed'))).not.toHaveProperty(
      'jwt_subreason'
    );
  });
});

describe('validateCdpCredentials (in-process, real SDK)', () => {
  const v = (env: Record<string, string>, mint: MintJwt = realMint) =>
    validateCdpCredentials(env, { mintJwt: mint });

  it('valid EC key: format VALID, mint PASS, type EC_PEM', async () => {
    const r = await v({ CDP_API_KEY_ID: UUID_ID, CDP_API_KEY_SECRET: ecPem });
    expect(r).toMatchObject({
      jwtMint: 'PASS',
      keyType: 'EC_PEM',
      secretShape: 'PEM_MULTILINE',
      idShape: 'UUID',
    });
  });

  it('valid Ed25519 key: mint PASS, type ED25519, shape BASE64_64_BYTES', async () => {
    const r = await v({ CDP_API_KEY_ID: UUID_ID, CDP_API_KEY_SECRET: ed25519Secret });
    expect(r).toMatchObject({
      jwtMint: 'PASS',
      keyType: 'ED25519',
      secretShape: 'BASE64_64_BYTES',
    });
  });

  it('missing id / missing secret / absent env', async () => {
    expect((await v({ CDP_API_KEY_SECRET: ecPem })).failureClass).toBe('cdp_key_id_missing');
    expect((await v({ CDP_API_KEY_ID: UUID_ID })).failureClass).toBe('cdp_key_secret_missing');
    const none = await v({});
    expect(none).toMatchObject({ idPresent: false, secretPresent: false, jwtMint: 'FAIL' });
  });

  it('PEM with escaped newlines is diagnosed by shape as well as by failure class', async () => {
    const r = await v({ CDP_API_KEY_ID: UUID_ID, CDP_API_KEY_SECRET: ecPem.replace(/\n/g, '\\n') });
    expect(r).toMatchObject({
      jwtMint: 'FAIL',
      failureClass: 'cdp_key_format_invalid',
      secretShape: 'PEM_ESCAPED_NEWLINES',
    });
  });

  it('quoted, whitespace-padded, and CRLF secrets are flagged', async () => {
    expect(
      (await v({ CDP_API_KEY_ID: UUID_ID, CDP_API_KEY_SECRET: `"${ecPem}"` })).secretQuoted
    ).toBe(true);
    expect(
      (await v({ CDP_API_KEY_ID: UUID_ID, CDP_API_KEY_SECRET: `${ecPem}\n\n ` }))
        .secretSurroundingWhitespace
    ).toBe(true);
    expect(
      (await v({ CDP_API_KEY_ID: UUID_ID, CDP_API_KEY_SECRET: ecPem.replace(/\n/g, '\r\n') }))
        .secretCrlf
    ).toBe(true);
  });

  it('G: a signing failure whose message contains the secret is normalised', async () => {
    const mint: MintJwt = async () => {
      throw new Error(
        `Failed to generate EC JWT: signing exploded with ${SENTINEL_SECRET} ${SENTINEL_ID}`
      );
    };
    const r = await v({ CDP_API_KEY_ID: SENTINEL_ID, CDP_API_KEY_SECRET: SENTINEL_SECRET }, mint);
    expect(r).toMatchObject({ jwtMint: 'FAIL', failureClass: 'cdp_jwt_signing_failed' });
    const text = JSON.stringify(r) + formatReport(r).join('\n');
    expect(text).not.toContain(SENTINEL_SECRET);
    expect(text).not.toContain(SENTINEL_ID);
  });

  it('mints exactly the three facilitator paths the Worker mints, and never calls fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('network call attempted');
    });
    const seen: string[] = [];
    const mint: MintJwt = async (a) => {
      seen.push(`${a.requestMethod} ${a.requestHost}${a.requestPath}`);
      return realMint(a);
    };
    const r = await v({ CDP_API_KEY_ID: UUID_ID, CDP_API_KEY_SECRET: ecPem }, mint);
    expect(r.jwtMint).toBe('PASS');
    expect(seen).toEqual([
      'POST api.cdp.coinbase.com/platform/v2/x402/verify',
      'POST api.cdp.coinbase.com/platform/v2/x402/settle',
      'GET api.cdp.coinbase.com/platform/v2/x402/supported',
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('report lines are enum-only and contain no key material or JWT', async () => {
    const r = await v({ CDP_API_KEY_ID: UUID_ID, CDP_API_KEY_SECRET: ecPem });
    const lines = formatReport(r);
    expect(lines.length).toBeGreaterThan(10);
    for (const line of lines) expect(line).toMatch(ENUM_LINE);
    const text = lines.join('\n');
    expect(text).not.toContain(UUID_ID);
    expect(text).not.toContain('BEGIN');
    expect(text).not.toMatch(JWT_SHAPE);
  });

  it('shape helpers', () => {
    expect(classifyIdShape('organizations/abc/apiKeys/def')).toBe('ORG_PATH');
    expect(classifyIdShape('nope')).toBe('OTHER');
    expect(classifySecretShape('%%%')).toBe('OTHER');
    expect(classifySecretShape(randomBytes(20).toString('base64'))).toBe('BASE64_OTHER_LENGTH');
  });
});

describe('validator CLI as a real child process (secret-leak proofs)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), 'cdpval-'));
    dirs.push(d);
    return d;
  };

  const scenarios: Array<[string, Record<string, string>, number, RegExp]> = [
    [
      'sentinel garbage secret',
      { CDP_API_KEY_ID: SENTINEL_ID, CDP_API_KEY_SECRET: SENTINEL_SECRET },
      1,
      /FAILURE_CLASS=CDP_KEY_FORMAT_INVALID/,
    ],
    ['missing id', { CDP_API_KEY_SECRET: SENTINEL_SECRET }, 1, /FAILURE_CLASS=CDP_KEY_ID_MISSING/],
    ['missing secret', { CDP_API_KEY_ID: SENTINEL_ID }, 1, /FAILURE_CLASS=CDP_KEY_SECRET_MISSING/],
    [
      'valid EC key',
      { CDP_API_KEY_ID: UUID_ID, CDP_API_KEY_SECRET: ecPem },
      0,
      /CDP_JWT_MINT=PASS/,
    ],
    [
      'valid Ed25519 key',
      { CDP_API_KEY_ID: UUID_ID, CDP_API_KEY_SECRET: ed25519Secret },
      0,
      /CDP_KEY_TYPE=ED25519/,
    ],
    [
      'escaped-newline PEM',
      { CDP_API_KEY_ID: UUID_ID, CDP_API_KEY_SECRET: ecPem.replace(/\n/g, '\\n') },
      1,
      /SECRET_SHAPE=PEM_ESCAPED_NEWLINES/,
    ],
  ];

  it.each(scenarios)(
    '%s: normalised stdout, empty stderr, no leak, no file leak',
    (_n, env, code, expected) => {
      const dir = tmp();
      const { status, stdout, stderr } = run(env, dir);
      expect(status).toBe(code);
      expect(stdout).toMatch(expected);
      for (const line of stdout.trim().split('\n')) expect(line).toMatch(ENUM_LINE);
      expect(stderr).toBe('');
      const secrets = [env.CDP_API_KEY_SECRET, env.CDP_API_KEY_ID].filter((s): s is string => !!s);
      const pemBody = ecPem.split('\n')[1] ?? '';
      for (const out of [stdout, stderr]) {
        for (const s of secrets) expect(out).not.toContain(s);
        expect(out).not.toContain(pemBody);
        expect(out).not.toContain(ed25519Secret);
        expect(out).not.toMatch(JWT_SHAPE);
        expect(out).not.toMatch(/\bat .*\(.*:\d+:\d+\)/); // no stack frames
      }
      // No file the run created (tsx cache included) contains a credential or a JWT.
      for (const content of allFileContents(dir)) {
        for (const s of secrets) expect(content).not.toContain(s);
        expect(content).not.toMatch(JWT_SHAPE);
      }
    }
  );

  it('the internal-error report is a fixed enum block that contains no input', () => {
    expect(INTERNAL_ERROR_REPORT.length).toBeGreaterThan(0);
    for (const line of INTERNAL_ERROR_REPORT) expect(line).toMatch(ENUM_LINE);
    expect(INTERNAL_ERROR_REPORT.join('\n')).toContain('CDP_JWT_MINT=FAIL');
  });
});

describe('validator is not part of the Worker', () => {
  it('no Worker source imports the validator script', () => {
    const grep = spawnSync('grep', ['-rl', 'validate-cdp-credentials', join(EDGE_API, 'src')], {
      encoding: 'utf8',
    });
    expect(grep.stdout.trim()).toBe('');
  });

  it('the validator source contains no network primitive', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src).not.toMatch(/\bfetch\s*\(|node:https?|node:net|node:dns|XMLHttpRequest|WebSocket/);
    expect(src).not.toMatch(
      /console\.(log|error|warn|info|debug)|writeFile|appendFile|createWriteStream/
    );
  });
});

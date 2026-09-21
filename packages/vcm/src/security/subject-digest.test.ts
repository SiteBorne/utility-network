import { createHash, createHmac } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  SUBJECT_DIGEST_DOMAIN,
  SUBJECT_DIGEST_ERROR_CODES,
  SUBJECT_DIGEST_MIN_KEY_BITS,
  SUBJECT_DIGEST_TYPES,
  SUBJECT_DIGEST_VERSION,
  SubjectDigestError,
  computeSubjectDigest,
  type SubjectDigestKey,
  type SubjectDigestType,
} from './subject-digest';
import {
  RESULT_AUTHORIZATION_ENVELOPE_VERSION,
  RESULT_AUTHORIZATION_SHADOW_POLICY_VERSION,
  SUBJECT_AXES,
  evaluateResultAuthorizationShadow,
  projectResultShadowTelemetry,
  type CurrentReplayContext,
  type ResultAuthorizationEnvelopeV1,
  type SubjectSlot,
} from './result-authorization-shadow';

const hex = (c: string) => c.repeat(64);
const WALLET = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
const WALLET_LOWER = WALLET.toLowerCase();

const genKey = (
  version: string,
  over: { hash?: string; length?: number; usages?: KeyUsage[]; name?: string } = {}
): Promise<SubjectDigestKey> =>
  crypto.subtle
    .generateKey(
      { name: over.name ?? 'HMAC', hash: over.hash ?? 'SHA-256', length: over.length ?? 256 },
      false,
      over.usages ?? ['sign']
    )
    .then((key) => ({ version, key: key as CryptoKey }));

const codeOf = async (
  type: SubjectDigestType | string,
  value: unknown,
  key: SubjectDigestKey
): Promise<string> => {
  try {
    await computeSubjectDigest(type as SubjectDigestType, value, key);
    return 'NO_ERROR';
  } catch (e) {
    return e instanceof SubjectDigestError ? e.code : `UNTYPED:${String(e)}`;
  }
};

let k1: SubjectDigestKey;
let k1Other: SubjectDigestKey;
let k2: SubjectDigestKey;
beforeAll(async () => {
  k1 = await genKey('k1');
  k1Other = await genKey('k1'); // same label, different key material
  k2 = await genKey('k2');
});

describe('SubjectDigest v1: construction', () => {
  it('matches an independent HMAC-SHA-256 known answer (spec conformance)', async () => {
    // Deterministic test-only key material (clearly patterned; never a real key).
    const raw = new Uint8Array(32).fill(7);
    const key = await crypto.subtle.importKey(
      'raw',
      raw,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    // JCS of {domain, key_version, subject_type, value}: keys sorted, no spaces.
    const preimage = `{"domain":"siteborne.subject_digest.v1","key_version":"k1","subject_type":"payer_subject","value":"${WALLET_LOWER}"}`;
    const expected = createHmac('sha256', Buffer.from(raw)).update(preimage, 'utf8').digest('hex');
    const out = await computeSubjectDigest('payer_subject', WALLET, { version: 'k1', key });
    expect(out.subject_digest).toBe(expected);
    expect(SUBJECT_DIGEST_DOMAIN).toBe('siteborne.subject_digest.v1');
    expect(SUBJECT_DIGEST_VERSION).toBe('subject_digest.v1');
  });

  it('has a stable output shape: 64 lowercase hex plus the key version, nothing else', async () => {
    const out = await computeSubjectDigest('authenticated_caller_subject', 'principal-1', k1);
    expect(Object.keys(out).sort()).toEqual(['digest_key_version', 'subject_digest']);
    expect(out.subject_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(out.digest_key_version).toBe('k1');
  });

  it('is deterministic for a fixed subject, type, key, and version', async () => {
    const a = await computeSubjectDigest('payer_subject', WALLET, k1);
    const b = await computeSubjectDigest('payer_subject', WALLET, k1);
    expect(a).toEqual(b);
  });

  it('is keyed, not a bare hash: other key material or an unkeyed hash does not reproduce it', async () => {
    const d = (await computeSubjectDigest('payer_subject', WALLET, k1)).subject_digest;
    expect((await computeSubjectDigest('payer_subject', WALLET, k1Other)).subject_digest).not.toBe(
      d
    );
    for (const unkeyed of [WALLET, WALLET_LOWER]) {
      expect(d).not.toBe(createHash('sha256').update(unkeyed).digest('hex'));
    }
    expect(d).not.toContain(WALLET_LOWER.slice(2, 12));
  });

  it('separates subject types: identical values never share a digest across types', async () => {
    const caller = await computeSubjectDigest('authenticated_caller_subject', 'principal-1', k1);
    const signer = await computeSubjectDigest('request_signer_subject', 'principal-1', k1);
    expect(caller.subject_digest).not.toBe(signer.subject_digest);
    // Payer accepts only a wallet; a wallet is refused for the other axes, so
    // no value can be digested under two types that this scheme would conflate.
    expect(await codeOf('authenticated_caller_subject', WALLET, k1)).toBe(
      'SUBJECT_VALUE_WALLET_SHAPED_FOR_NON_PAYER'
    );
    expect(await codeOf('request_signer_subject', WALLET, k1)).toBe(
      'SUBJECT_VALUE_WALLET_SHAPED_FOR_NON_PAYER'
    );
    expect(await codeOf('payer_subject', 'principal-1', k1)).toBe('SUBJECT_VALUE_MALFORMED');
  });

  it('is sensitive to the subject value and to the key version', async () => {
    const base = await computeSubjectDigest('authenticated_caller_subject', 'principal-1', k1);
    const other = await computeSubjectDigest('authenticated_caller_subject', 'principal-2', k1);
    expect(other.subject_digest).not.toBe(base.subject_digest);
    // Same key material, different version label: the version is bound into the MAC input.
    const relabelled = { version: 'k9', key: k1.key };
    const v9 = await computeSubjectDigest(
      'authenticated_caller_subject',
      'principal-1',
      relabelled
    );
    expect(v9.digest_key_version).toBe('k9');
    expect(v9.subject_digest).not.toBe(base.subject_digest);
    // Different key AND version (a rotation): different digest, labelled accordingly.
    const rotated = await computeSubjectDigest('authenticated_caller_subject', 'principal-1', k2);
    expect(rotated.digest_key_version).toBe('k2');
    expect(rotated.subject_digest).not.toBe(base.subject_digest);
  });

  it('canonicalizes a payer wallet (case is not identity) but not opaque identifiers', async () => {
    const mixed = await computeSubjectDigest('payer_subject', WALLET, k1);
    const lower = await computeSubjectDigest('payer_subject', WALLET_LOWER, k1);
    expect(mixed).toEqual(lower);
    const other = '0x' + '1'.repeat(40);
    expect((await computeSubjectDigest('payer_subject', other, k1)).subject_digest).not.toBe(
      mixed.subject_digest
    );
    // Opaque identifiers are exact: no case folding.
    const a = await computeSubjectDigest('authenticated_caller_subject', 'Principal-1', k1);
    const b = await computeSubjectDigest('authenticated_caller_subject', 'principal-1', k1);
    expect(a.subject_digest).not.toBe(b.subject_digest);
  });
});

describe('SubjectDigest v1: malformed input and key handling', () => {
  it('rejects malformed, wallet-as-caller, and secret-shaped subjects with typed codes', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln';
    const rows: Array<[string, unknown, string]> = [
      ['payer_subject', 'not-an-address', 'SUBJECT_VALUE_MALFORMED'],
      ['payer_subject', '0x' + 'a'.repeat(39), 'SUBJECT_VALUE_MALFORMED'],
      ['payer_subject', '0x' + 'g'.repeat(40), 'SUBJECT_VALUE_MALFORMED'],
      ['payer_subject', '', 'SUBJECT_VALUE_MALFORMED'],
      ['payer_subject', null, 'SUBJECT_VALUE_MALFORMED'],
      ['payer_subject', 5, 'SUBJECT_VALUE_MALFORMED'],
      ['payer_subject', { a: 1 }, 'SUBJECT_VALUE_MALFORMED'],
      ['payer_subject', undefined, 'SUBJECT_VALUE_MALFORMED'],
      // 32-byte hex looks like a private key / tx hash / digest: refused everywhere.
      ['payer_subject', '0x' + 'a'.repeat(64), 'SUBJECT_VALUE_SECRET_SHAPED'],
      ['authenticated_caller_subject', 'a'.repeat(64), 'SUBJECT_VALUE_SECRET_SHAPED'],
      ['request_signer_subject', '0x' + 'a'.repeat(64), 'SUBJECT_VALUE_SECRET_SHAPED'],
      ['authenticated_caller_subject', jwt, 'SUBJECT_VALUE_SECRET_SHAPED'],
      ['payer_subject', jwt, 'SUBJECT_VALUE_SECRET_SHAPED'],
      // opaque-id shape
      ['authenticated_caller_subject', 'has space', 'SUBJECT_VALUE_MALFORMED'],
      ['authenticated_caller_subject', '-leading', 'SUBJECT_VALUE_MALFORMED'],
      ['authenticated_caller_subject', 'x'.repeat(129), 'SUBJECT_VALUE_MALFORMED'],
      ['authenticated_caller_subject', 'principalé', 'SUBJECT_VALUE_MALFORMED'],
      ['request_signer_subject', 'a\nb', 'SUBJECT_VALUE_MALFORMED'],
      // unknown subject types (economic/result subjects are reserved, not slots)
      ['economic_subject', 'principal-1', 'SUBJECT_TYPE_UNSUPPORTED'],
      ['result_subject', 'principal-1', 'SUBJECT_TYPE_UNSUPPORTED'],
      ['__proto__', 'principal-1', 'SUBJECT_TYPE_UNSUPPORTED'],
      ['', 'principal-1', 'SUBJECT_TYPE_UNSUPPORTED'],
    ];
    for (const [type, value, code] of rows) {
      expect(await codeOf(type, value, k1), `${type} ${String(value)}`).toBe(code);
    }
    expect(await codeOf('authenticated_caller_subject', 'x'.repeat(128), k1)).toBe('NO_ERROR');
  });

  it('documents the limits of the secret-shape heuristics (defense in depth, not a guarantee)', async () => {
    // False positive: a legitimate 64-hex principal id is indistinguishable from a
    // 32-byte secret/digest and is refused. A supplier of such ids must encode them.
    expect(await codeOf('authenticated_caller_subject', 'ab'.repeat(32), k1)).toBe(
      'SUBJECT_VALUE_SECRET_SHAPED'
    );
    // Bypass class: identifier-shaped credentials PASS the shape check. Only the HMAC
    // output ever leaves the function, but the supplier must never pass a credential.
    const identifierShapedCredentials = [
      'ab'.repeat(64), // 128-hex (e.g. an Ed25519 secret)
      'sk_live_' + 'A1b2C3d4'.repeat(4), // API-key style
      'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdEfGhIj', // base64url token
    ];
    for (const v of identifierShapedCredentials) {
      expect(await codeOf('authenticated_caller_subject', v, k1), v.slice(0, 8)).toBe('NO_ERROR');
    }
  });

  it('rejects unusable keys and malformed key versions', async () => {
    const aes = (await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
    ])) as CryptoKey;
    const badKeys: Array<[string, SubjectDigestKey]> = [
      ['not HMAC', { version: 'k1', key: aes }],
      ['HMAC/SHA-512', await genKey('k1', { hash: 'SHA-512' })],
      ['below minimum length', await genKey('k1', { length: SUBJECT_DIGEST_MIN_KEY_BITS - 128 })],
      ['verify-only usage', await genKey('k1', { usages: ['verify'] })],
      ['missing key', { version: 'k1', key: undefined as never }],
      ['null key', { version: 'k1', key: null as never }],
    ];
    for (const [label, key] of badKeys) {
      expect(await codeOf('payer_subject', WALLET, key), label).toBe('SUBJECT_KEY_INVALID');
    }
    for (const version of ['', 'K1', 'a b', 'a'.repeat(33), '-x', 5 as never, undefined as never]) {
      expect(await codeOf('payer_subject', WALLET, { version, key: k1.key }), String(version)).toBe(
        'SUBJECT_KEY_VERSION_MALFORMED'
      );
    }
    expect(await codeOf('payer_subject', WALLET, { version: 'a'.repeat(32), key: k1.key })).toBe(
      'NO_ERROR'
    );
  });

  it('works with a non-extractable key and never needs to read key material', async () => {
    expect(k1.key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', k1.key)).rejects.toBeDefined();
    const out = await computeSubjectDigest('payer_subject', WALLET, k1);
    expect(out.subject_digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('SubjectDigest v1: non-leakage', () => {
  it('never returns, embeds, or echoes the raw subject or the key', async () => {
    const out = await computeSubjectDigest('payer_subject', WALLET, k1);
    const wire = JSON.stringify(out);
    for (const raw of [WALLET, WALLET_LOWER, WALLET_LOWER.slice(2)]) {
      expect(wire).not.toContain(raw);
    }
    // Errors carry a code only.
    const secretValue = 'super-secret-principal!';
    let caught: unknown;
    try {
      await computeSubjectDigest('authenticated_caller_subject', secretValue, k1);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SubjectDigestError);
    const err = caught as SubjectDigestError;
    expect(SUBJECT_DIGEST_ERROR_CODES).toContain(err.code);
    expect(String(err) + err.message + JSON.stringify(err)).not.toContain(secretValue);
    let walletErr: unknown;
    try {
      await computeSubjectDigest('authenticated_caller_subject', WALLET, k1);
    } catch (e) {
      walletErr = e;
    }
    expect(String(walletErr) + JSON.stringify(walletErr)).not.toContain(WALLET_LOWER.slice(2, 20));
  });

  it('subject digests and raw wallets never reach the telemetry projection', async () => {
    const payer = await computeSubjectDigest('payer_subject', WALLET, k1);
    const caller = await computeSubjectDigest('authenticated_caller_subject', 'principal-1', k1);
    const slot = (d: { subject_digest: string; digest_key_version: string }): SubjectSlot => ({
      status: 'PRESENT',
      evidence_class: 'VERIFIED_EVIDENCE',
      ...d,
    });
    const absent: SubjectSlot = { status: 'ABSENT' };
    const subjects = {
      payer_subject: slot(payer),
      authenticated_caller_subject: slot(caller),
      request_signer_subject: absent,
    };
    const r = evaluateResultAuthorizationShadow(ctxWith(subjects), envWith(subjects));
    expect(r.classification).toBe('MATCH');
    const wire = JSON.stringify(projectResultShadowTelemetry(r, 'job_1'));
    for (const secret of [
      payer.subject_digest,
      caller.subject_digest,
      WALLET_LOWER,
      'principal-1',
    ]) {
      expect(wire).not.toContain(secret);
    }
  });
});

describe('SubjectDigest v1: envelope integration and drift guards', () => {
  it('covers exactly the envelope subject axes', () => {
    expect([...SUBJECT_DIGEST_TYPES]).toEqual([...SUBJECT_AXES]);
  });

  it('produces slots the envelope accepts; same subject+key+version matches, others do not', async () => {
    const slot = async (
      type: SubjectDigestType,
      value: string,
      key: SubjectDigestKey
    ): Promise<SubjectSlot> => ({
      status: 'PRESENT',
      evidence_class: 'VERIFIED_EVIDENCE',
      ...(await computeSubjectDigest(type, value, key)),
    });
    const absent: SubjectSlot = { status: 'ABSENT' };
    const stored = {
      payer_subject: absent,
      authenticated_caller_subject: await slot('authenticated_caller_subject', 'principal-1', k1),
      request_signer_subject: absent,
    };
    const run = async (value: string, key: SubjectDigestKey) => {
      const candidate = {
        ...stored,
        authenticated_caller_subject: await slot('authenticated_caller_subject', value, key),
      };
      return evaluateResultAuthorizationShadow(ctxWith(candidate), envWith(stored));
    };
    const same = await run('principal-1', k1);
    expect(same.classification).toBe('MATCH');
    expect(same.reason_codes).toEqual(['AUTHENTICATED_CALLER_SUBJECT_MATCH']);
    expect((await run('principal-2', k1)).reason_codes).toEqual([
      'AUTHENTICATED_CALLER_SUBJECT_MISMATCH',
    ]);
    // A rotation: candidate under a new key version is incomparable, not a mismatch.
    const rotated = await run('principal-1', k2);
    expect(rotated.reason_codes).toContain('SUBJECT_KEY_VERSION_INCOMPARABLE');
    expect(rotated.classification).not.toBe('MISMATCH');
  });

  it('does not treat a payer wallet as caller identity (payment != identity)', async () => {
    const payer = await computeSubjectDigest('payer_subject', WALLET, k1);
    const absent: SubjectSlot = { status: 'ABSENT' };
    const both = {
      payer_subject: {
        status: 'PRESENT',
        evidence_class: 'VERIFIED_EVIDENCE',
        ...payer,
      } as SubjectSlot,
      authenticated_caller_subject: absent,
      request_signer_subject: absent,
    };
    const r = evaluateResultAuthorizationShadow(ctxWith(both), envWith(both));
    expect(r.classification).toBe('INSUFFICIENT_EVIDENCE');
    expect(r.reason_codes).toContain('PAYER_MATCH_WITHOUT_AUTHENTICATED_SUBJECT');
  });
});

function ctxWith(candidate: CurrentReplayContext['candidate_subjects']): CurrentReplayContext {
  return {
    predicate: 'duplicate_same',
    job_id: 'job_1',
    payment_identifier_digest: hex('a'),
    payment_binding_digest: hex('b'),
    result_ref: 'job_1',
    result_content_digest: null,
    candidate_subjects: candidate,
  };
}

function envWith(stored: ResultAuthorizationEnvelopeV1['subjects']): ResultAuthorizationEnvelopeV1 {
  return {
    envelope_version: RESULT_AUTHORIZATION_ENVELOPE_VERSION,
    policy_version: RESULT_AUTHORIZATION_SHADOW_POLICY_VERSION,
    job_id: 'job_1',
    payment_identifier_digest: hex('a'),
    payment_binding_digest: hex('b'),
    result_ref: 'job_1',
    result_content_digest: null,
    subjects: stored,
    evidence_captured_at: '2026-01-01T00:00:00.000Z',
  };
}

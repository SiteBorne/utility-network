import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashPaymentObject } from '@siteborne/protocol-x402';
import { canonicalize, hashCanonical } from '../canonical';
import {
  RESULT_CONTENT_DIGEST_DOMAIN,
  RESULT_CONTENT_DIGEST_ERROR_CODES,
  RESULT_CONTENT_DIGEST_VERSION,
  RESULT_CONTENT_MAX_CANONICAL_BYTES,
  RESULT_CONTENT_MAX_DEPTH,
  ResultContentDigestError,
  compareResultContentDigest,
  computeResultContentDigest,
  isResultContentDigest,
  parseResultContentDigest,
} from './result-content-digest';
import {
  CONTENT_DIGEST_OUTCOMES,
  evaluateResultAuthorizationShadow,
  projectResultShadowTelemetry,
  RESULT_AUTHORIZATION_ENVELOPE_VERSION,
  RESULT_AUTHORIZATION_SHADOW_POLICY_VERSION,
  type CurrentReplayContext,
  type ResultAuthorizationEnvelopeV1,
  type SubjectSlot,
} from './result-authorization-shadow';

const hex = (c: string) => c.repeat(64);
const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const digestOf = (v: unknown) => computeResultContentDigest(v);
const codeOf = async (v: unknown) => {
  try {
    await computeResultContentDigest(v);
    return 'NO_ERROR';
  } catch (e) {
    return e instanceof ResultContentDigestError ? e.code : `UNTYPED:${String(e)}`;
  }
};

const ABSENT: SubjectSlot = { status: 'ABSENT' };
const noSubjects = {
  payer_subject: ABSENT,
  authenticated_caller_subject: ABSENT,
  request_signer_subject: ABSENT,
};
const someSubjects = {
  payer_subject: ABSENT,
  authenticated_caller_subject: {
    status: 'PRESENT',
    evidence_class: 'VERIFIED_EVIDENCE',
    subject_digest: hex('2'),
    digest_key_version: 'k1',
  } as SubjectSlot,
  request_signer_subject: ABSENT,
};
const ctx = (over: Partial<CurrentReplayContext> = {}): CurrentReplayContext => ({
  predicate: 'duplicate_same',
  job_id: 'job_1',
  payment_identifier_digest: hex('a'),
  payment_binding_digest: hex('b'),
  result_ref: 'job_1',
  result_content_digest: null,
  candidate_subjects: someSubjects,
  ...over,
});
const env = (over: Partial<ResultAuthorizationEnvelopeV1> = {}): ResultAuthorizationEnvelopeV1 => ({
  envelope_version: RESULT_AUTHORIZATION_ENVELOPE_VERSION,
  policy_version: RESULT_AUTHORIZATION_SHADOW_POLICY_VERSION,
  job_id: 'job_1',
  payment_identifier_digest: hex('a'),
  payment_binding_digest: hex('b'),
  result_ref: 'job_1',
  result_content_digest: null,
  subjects: someSubjects,
  evidence_captured_at: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('ResultContentDigest v1: definition', () => {
  it('matches an independently computed known answer (spec conformance)', async () => {
    // JCS of {content, domain}: keys sorted, no whitespace. Computed here with
    // node:crypto over a literal string, independent of the module under test.
    const literal =
      '{"content":{"a":1,"b":[true,null]},"domain":"siteborne.result_content_digest.v1"}';
    const d = await digestOf({ b: [true, null], a: 1 });
    expect(d).toBe(`result_content_digest.v1:sha256:${sha256Hex(literal)}`);
    expect(RESULT_CONTENT_DIGEST_DOMAIN).toBe('siteborne.result_content_digest.v1');
    expect(RESULT_CONTENT_DIGEST_VERSION).toBe('result_content_digest.v1');
  });

  it('has a stable, self-describing output shape', async () => {
    const d = await digestOf({ x: 1 });
    expect(d).toMatch(/^result_content_digest\.v1:sha256:[0-9a-f]{64}$/);
    expect(isResultContentDigest(d)).toBe(true);
    expect(parseResultContentDigest(d)).toEqual({ version: 1, hex: d.slice(-64) });
  });

  it('is deterministic and does not mutate or depend on anything but its input', async () => {
    const body = deepFreeze({ output: { a: [1, 2, { z: 'q' }] }, n: null });
    const a = await digestOf(body);
    const b = await digestOf(JSON.parse(JSON.stringify(body)));
    expect(a).toBe(b);
    expect(await digestOf(body)).toBe(a);
    expect(JSON.stringify(body)).toBe('{"output":{"a":[1,2,{"z":"q"}]},"n":null}');
  });
});

describe('ResultContentDigest v1: content integrity', () => {
  it('changes when any value, nested value, key, or type changes', async () => {
    const base = await digestOf({ a: { b: [1, { c: 'x' }] }, k: true });
    const variants: unknown[] = [
      { a: { b: [1, { c: 'y' }] }, k: true }, // nested value
      { a: { b: [2, { c: 'x' }] }, k: true }, // array element
      { a: { b: [1, { c: 'x' }] }, k: false }, // top-level value
      { a: { b: [1, { c: 'x' }] }, k: true, extra: 1 }, // added key
      { a: { b: [1, { c: 'x' }] } }, // removed key
      { a: { b: [1, { c: 'x' }] }, k: 1 }, // type: true vs 1
      { a: { b: ['1', { c: 'x' }] }, k: true }, // type: 1 vs "1"
      { a: { b: [1, { c: 'x' }, null] }, k: true }, // appended element
    ];
    const seen = new Set([base]);
    for (const v of variants) seen.add(await digestOf(v));
    expect(seen.size).toBe(variants.length + 1);
  });

  it('ignores object key order but respects array order (semantic vs non-semantic order)', async () => {
    expect(await digestOf({ a: 1, b: { y: 2, x: 1 } })).toBe(
      await digestOf({ b: { x: 1, y: 2 }, a: 1 })
    );
    expect(await digestOf({ list: [1, 2, 3] })).not.toBe(await digestOf({ list: [3, 2, 1] }));
    expect(await digestOf([{ a: 1 }, { b: 2 }])).not.toBe(await digestOf([{ b: 2 }, { a: 1 }]));
  });

  it('gives null, empty, and falsy contents distinct, valid digests; "absent" is not null', async () => {
    const values: unknown[] = [null, {}, [], '', 0, false, [null], { a: null }];
    const digests = await Promise.all(values.map(digestOf));
    expect(new Set(digests).size).toBe(values.length);
    // Absent content is the envelope value null -- never the digest of a null body.
    expect(digests[0]).not.toBeNull();
    expect(isResultContentDigest(null)).toBe(false);
    expect(await codeOf(undefined)).toBe('RESULT_CONTENT_NOT_SERIALIZABLE');
  });

  it('rejects content that cannot be serialized to the stored form', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const bad of [
      undefined,
      () => 1,
      Symbol('s'),
      BigInt(10),
      { n: BigInt(10) },
      cyclic,
      {
        toJSON() {
          throw new Error('boom');
        },
      },
    ]) {
      expect(await codeOf(bad)).toBe('RESULT_CONTENT_NOT_SERIALIZABLE');
    }
  });

  it('rejects an integer outside the JCS safe range rather than hashing a lossy value', async () => {
    expect(await codeOf({ n: 2 ** 60 })).toBe('RESULT_CONTENT_NOT_CANONICALIZABLE');
    expect(await codeOf({ n: Number.MAX_SAFE_INTEGER })).toBe('NO_ERROR');
  });

  it('digests the STORED form: values storage rewrites hash as their stored equivalent', async () => {
    // JSON.stringify turns NaN/Infinity into null and drops undefined/functions;
    // digesting the stored form keeps digest(persist-time) == digest(read-time).
    expect(await digestOf({ n: NaN, i: Infinity })).toBe(await digestOf({ n: null, i: null }));
    expect(await digestOf({ a: 1, u: undefined, f: () => 1 })).toBe(await digestOf({ a: 1 }));
    expect(await digestOf({ d: new Date(0) })).toBe(
      await digestOf({ d: '1970-01-01T00:00:00.000Z' })
    );
    expect(await digestOf({ z: -0 })).toBe(await digestOf({ z: 0 }));
  });

  it('digest(persist-time value) equals digest(value read back from a D1-shaped row)', async () => {
    // The persist-time value goes straight in; the read-time value goes through the
    // real storage path: whole-row JSON.stringify (INSERT) then JSON.parse (SELECT).
    const values: unknown[] = [
      {
        service_id: 'web-context',
        output: {
          items: [
            { t: 'a', n: 1.5 },
            { t: 'b', n: 0 },
          ],
        },
      },
      { s: 'quote " backslash \\ newline \n tab \t' },
      { s: String.fromCodePoint(0x1f600) },
      { s: String.fromCharCode(0xd800) }, // lone surrogate
      { s: String.fromCharCode(0, 31, 127) },
      { nested: { a: { b: { c: { d: [[[]]] } } } } },
      { f: 0.1 + 0.2, big: 1e21, tiny: 5e-324, neg: -1.5e-7 },
    ];
    for (const v of values) {
      const rowText = JSON.stringify({ status: 200, body: v, settleResponse: { success: true } });
      const reread = (JSON.parse(rowText) as { body: unknown }).body;
      expect(await digestOf(reread)).toBe(await digestOf(v));
    }
  });

  it('matches an independent hash for single-key bodies (JCS order is trivially fixed)', async () => {
    for (const v of [{ s: 'quote " backslash \\ newline \n tab \t' }, { n: [1, 2.5, -3] }]) {
      const literal = `{"content":${JSON.stringify(v)},"domain":"siteborne.result_content_digest.v1"}`;
      expect(await digestOf(v)).toBe(`result_content_digest.v1:sha256:${sha256Hex(literal)}`);
    }
  });

  it('orders integer-like keys numerically: deterministic and injective, but NOT RFC 8785 byte order', async () => {
    // Characterization of the governed canonicalizer (see report). RFC 8785 sorts by
    // UTF-16 code units ("10" < "2"); the repository canonicalizer emits "2" before "10".
    expect(canonicalize({ a: 3, '10': 1, '2': 2 })).toBe('{"2":2,"10":1,"a":3}');
    // Deterministic under insertion order...
    expect(await digestOf({ a: 3, '10': 1, '2': 2 })).toBe(
      await digestOf({ '2': 2, a: 3, '10': 1 })
    );
    // ...and still injective: distinct key/value assignments never share a digest.
    expect(await digestOf({ '1': 1, '01': 2 })).not.toBe(await digestOf({ '1': 2, '01': 1 }));
    expect(await digestOf({ '10': 1, '2': 2 })).not.toBe(await digestOf({ '10': 2, '2': 1 }));
  });

  it('applies no Unicode normalization: distinct code points are distinct content', async () => {
    const composed = { s: String.fromCharCode(0xe9) };
    const decomposed = { s: 'e' + String.fromCharCode(0x301) };
    expect(await digestOf(composed)).not.toBe(await digestOf(decomposed));
    // A lone surrogate is not silently replaced by U+FFFD.
    expect(await digestOf({ s: String.fromCharCode(0xd800) })).not.toBe(
      await digestOf({ s: String.fromCharCode(0xfffd) })
    );
  });

  it('refuses an own __proto__ key that the governed canonicalizer would silently drop', async () => {
    const hostile = JSON.parse('{"__proto__":{"x":1},"a":1}') as unknown;
    const plain = { a: 1 };
    // The problem this guards: base canonicalization collapses the two.
    expect(canonicalize(hostile)).toBe(canonicalize(plain));
    // The primitive does not let that collision reach a digest.
    expect(await codeOf(hostile)).toBe('RESULT_CONTENT_UNSUPPORTED_STRUCTURE');
    expect(await codeOf({ deep: [{ ok: 1 }, JSON.parse('{"__proto__":1}')] })).toBe(
      'RESULT_CONTENT_UNSUPPORTED_STRUCTURE'
    );
    expect(await codeOf(plain)).toBe('NO_ERROR');
    // An ordinary key named "constructor"/"prototype" is real content.
    expect(await digestOf({ constructor: 1 })).not.toBe(await digestOf({}));
  });

  it('bounds nesting depth without overflowing the stack', async () => {
    const nest = (n: number) => {
      let v: unknown = 'leaf';
      for (let i = 0; i < n; i++) v = [v];
      return v;
    };
    expect(await codeOf(nest(RESULT_CONTENT_MAX_DEPTH))).toBe('NO_ERROR');
    expect(await codeOf(nest(RESULT_CONTENT_MAX_DEPTH + 1))).toBe(
      'RESULT_CONTENT_UNSUPPORTED_STRUCTURE'
    );
    // Hostile depth is refused with a typed error, never an untyped RangeError:
    // moderately deep input is caught by the depth bound; absurdly deep input
    // overflows JSON.stringify first and is reported as not serializable.
    expect(await codeOf(nest(1_000))).toBe('RESULT_CONTENT_UNSUPPORTED_STRUCTURE');
    expect(await codeOf(nest(100_000))).toBe('RESULT_CONTENT_NOT_SERIALIZABLE');
  });

  it('bounds size at the canonical-byte ceiling, exactly at the boundary', async () => {
    // A JSON string of n chars canonicalizes to n + 2 bytes (the quotes).
    const atLimit = 'a'.repeat(RESULT_CONTENT_MAX_CANONICAL_BYTES - 2);
    expect(await codeOf(atLimit)).toBe('NO_ERROR');
    expect(await codeOf(atLimit + 'a')).toBe('RESULT_CONTENT_TOO_LARGE');
    // Size is measured in UTF-8 bytes, not characters.
    const wide = String.fromCharCode(0x20ac).repeat(
      Math.ceil(RESULT_CONTENT_MAX_CANONICAL_BYTES / 3)
    );
    expect(await codeOf(wide)).toBe('RESULT_CONTENT_TOO_LARGE');
  });

  it('errors are typed, carry only a code, and never echo the content', async () => {
    const secret = 'top-secret-result-body-value';
    const hostile = JSON.parse(`{"__proto__":{"k":"${secret}"},"v":"${secret}"}`) as unknown;
    let caught: unknown;
    try {
      await computeResultContentDigest(hostile);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ResultContentDigestError);
    const err = caught as ResultContentDigestError;
    expect(RESULT_CONTENT_DIGEST_ERROR_CODES).toContain(err.code);
    expect(String(err) + err.message + JSON.stringify(err)).not.toContain(secret);
  });
});

describe('ResultContentDigest v1: binding confusion', () => {
  const payload = { a: 1, b: ['x'] };

  it('cannot be confused with a payment digest or a PCC output_hash over the same JSON', async () => {
    const d = (await digestOf(payload)).slice(-64);
    // hashPaymentObject and PCC output_hash are both sha256(JCS(x)), no domain.
    expect(`sha256:${d}`).not.toBe(await hashPaymentObject(payload));
    expect(`sha256:${d}`).not.toBe(await hashCanonical(payload));
    expect(d).not.toBe(sha256Hex(canonicalize(payload)));
    // Domain matters: same content under a different tag is a different digest.
    expect(d).not.toBe(sha256Hex(canonicalize({ content: payload, domain: 'siteborne.other.v1' })));
  });

  it('is independent of job, service, payment, and result reference (content only)', async () => {
    // Identical released content at two different jobs digests identically.
    const body = { output: { answer: 42 } };
    expect(await digestOf(body)).toBe(await digestOf(structuredClone(body)));
    // Anything contextual is not folded in: adding it is a content change.
    expect(await digestOf({ ...body, job_id: 'job_1' })).not.toBe(await digestOf(body));
  });

  it('context binding lives in the envelope: same content + different result_ref, or same ref + different content, is a mismatch', async () => {
    const dA = await digestOf({ v: 'A' });
    const dB = await digestOf({ v: 'B' });
    const e = env({ result_content_digest: dA });
    // Same content, different result reference -> identity mismatch.
    const otherRef = evaluateResultAuthorizationShadow(
      ctx({ result_ref: 'job_2', result_content_digest: dA }),
      e
    );
    expect(otherRef.reason_codes).toEqual(['RESULT_IDENTITY_MISMATCH']);
    // Same reference, different content -> identity mismatch.
    const otherContent = evaluateResultAuthorizationShadow(ctx({ result_content_digest: dB }), e);
    expect(otherContent.classification).toBe('MISMATCH');
    expect(otherContent.reason_codes).toEqual(['RESULT_IDENTITY_MISMATCH']);
    // Same reference, same content -> no identity finding; subjects decide.
    const same = evaluateResultAuthorizationShadow(ctx({ result_content_digest: dA }), e);
    expect(same.reason_codes).not.toContain('RESULT_IDENTITY_MISMATCH');
  });

  it('is not circular with the PCC: the digest of the body is unaffected by carrier and lifecycle rewrites', async () => {
    // Workflow path: `body` is the already-signed PCC document.
    const makeBody = () => ({
      pcc: 'document',
      receipt: { output_hash: 'sha256:' + hex('e'), signature: 's' },
    });
    // Bound BEFORE any row exists, from an object that is never reused below.
    const bound = await digestOf(makeBody());

    // The digest rides OUTSIDE the digested body, beside status/body/settleResponse.
    const row = {
      status: 200,
      body: makeBody(),
      settleResponse: { success: true },
      carrier: { bound },
    };
    const afterCreate = JSON.parse(JSON.stringify(row)) as typeof row;
    expect(await digestOf(afterCreate.body)).toBe(bound);

    // persistReceipt's real rewrite: `{...existing, receipt_persisted, receipt_id, pcc, durableEvidence}`,
    // written and re-read through the row's JSON round trip.
    const existing = JSON.parse(JSON.stringify(row)) as typeof row;
    const rewritten = {
      ...existing,
      receipt_persisted: true,
      receipt_id: 'rcpt_1',
      pcc: makeBody(),
      durableEvidence: { pcc: makeBody() },
    };
    const afterRewrite = JSON.parse(JSON.stringify(rewritten)) as typeof rewritten;
    expect(await digestOf(afterRewrite.body)).toBe(bound);
    // Whereas the whole row is NOT stable across that rewrite -- why the row is
    // not the digested representation.
    expect(await digestOf(afterRewrite)).not.toBe(await digestOf(afterCreate));
    // And a body that genuinely changed is caught even when the carrier is intact.
    const tampered = { ...afterRewrite, body: { ...afterRewrite.body, pcc: 'other' } };
    expect(await digestOf(tampered.body)).not.toBe(afterRewrite.carrier.bound);
  });
});

describe('ResultContentDigest v1: versioning and read-side comparison', () => {
  it('parses only the exact self-describing format', () => {
    const good = `result_content_digest.v1:sha256:${hex('a')}`;
    expect(parseResultContentDigest(good)).toEqual({ version: 1, hex: hex('a') });
    expect(parseResultContentDigest(`result_content_digest.v2:sha256:${hex('a')}`)?.version).toBe(
      2
    );
    for (const bad of [
      hex('a'), // bare hex (a subject-digest shape) is not a content digest
      `sha256:${hex('a')}`, // governed-but-unversioned hash of another domain
      `result_content_digest.v0:sha256:${hex('a')}`,
      `result_content_digest.v01:sha256:${hex('a')}`,
      `result_content_digest.v1:sha256:${hex('A')}`,
      `result_content_digest.v1:sha256:${'a'.repeat(63)}`,
      `result_content_digest.v1:sha512:${hex('a')}`,
      `${good} `,
      ` ${good}`,
      `${good}\n`,
      '',
      null,
      undefined,
      5,
      {},
    ]) {
      expect(parseResultContentDigest(bad), String(bad)).toBeNull();
    }
  });

  it('compares content to a bound digest without throwing', async () => {
    const body = { r: [1, 2] };
    const bound = await digestOf(body);
    expect(await compareResultContentDigest(body, bound)).toBe('MATCH');
    expect(await compareResultContentDigest({ r: [2, 1] }, bound)).toBe('MISMATCH');
    expect(await compareResultContentDigest(body, 'garbage')).toBe('MALFORMED_DIGEST');
    expect(await compareResultContentDigest(body, null)).toBe('MALFORMED_DIGEST');
    expect(
      await compareResultContentDigest(body, `result_content_digest.v2:sha256:${hex('a')}`)
    ).toBe('UNSUPPORTED_VERSION');
    expect(await compareResultContentDigest(undefined, bound)).toBe('CONTENT_UNDIGESTABLE');
    expect(await compareResultContentDigest(JSON.parse('{"__proto__":1}'), bound)).toBe(
      'CONTENT_UNDIGESTABLE'
    );
  });
});

describe('ResultContentDigest v1: envelope integration (shadow only)', () => {
  it('the envelope accepts a correctly computed digest and rejects malformed ones', async () => {
    const good = await digestOf({ ok: true });
    const withDigest = evaluateResultAuthorizationShadow(
      ctx({ result_content_digest: good }),
      env({ result_content_digest: good })
    );
    expect(withDigest.classification).toBe('MATCH');
    for (const bad of [hex('a'), `sha256:${hex('a')}`, 'x', `${good}x`, 5]) {
      const c = evaluateResultAuthorizationShadow(
        ctx({ result_content_digest: bad as never }),
        env()
      );
      expect(c.classification, String(bad)).toBe('ERROR');
      const e = evaluateResultAuthorizationShadow(
        ctx(),
        env({ result_content_digest: bad as never })
      );
      expect(e.classification, String(bad)).toBe('ERROR');
    }
  });

  it('legacy nullable behaviour is preserved: a null digest on either side is not a mismatch', async () => {
    const good = await digestOf({ ok: true });
    for (const [c, e] of [
      [null, null],
      [good, null],
      [null, good],
    ] as const) {
      const r = evaluateResultAuthorizationShadow(
        ctx({ result_content_digest: c }),
        env({ result_content_digest: e })
      );
      expect(r.classification).toBe('MATCH');
      expect(r.reason_codes).not.toContain('RESULT_IDENTITY_MISMATCH');
    }
  });

  it('digests of different versions are incomparable, not a mismatch', () => {
    const v1 = `result_content_digest.v1:sha256:${hex('a')}`;
    const v2 = `result_content_digest.v2:sha256:${hex('b')}`;
    const r = evaluateResultAuthorizationShadow(
      ctx({ result_content_digest: v1 }),
      env({ result_content_digest: v2 })
    );
    expect(r.reason_codes).toContain('RESULT_CONTENT_DIGEST_VERSION_INCOMPARABLE');
    expect(r.reason_codes).not.toContain('RESULT_IDENTITY_MISMATCH');
    expect(r.classification).toBe('MATCH'); // subjects still decide
    // ...but content was NOT verified: MATCH here must never be read as "content verified".
    expect(r.content_digest_outcome).toBe('INCOMPARABLE');
    // Same version, different value remains a genuine mismatch.
    const same = evaluateResultAuthorizationShadow(
      ctx({ result_content_digest: v1 }),
      env({ result_content_digest: `result_content_digest.v1:sha256:${hex('c')}` })
    );
    expect(same.reason_codes).toEqual(['RESULT_IDENTITY_MISMATCH']);
    // Legacy path also carries the incomparability reason.
    const legacy = evaluateResultAuthorizationShadow(
      ctx({ result_content_digest: v1, candidate_subjects: noSubjects }),
      env({ result_content_digest: v2, subjects: noSubjects })
    );
    expect(legacy.classification).toBe('LEGACY_UNBOUND');
    expect(legacy.reason_codes).toEqual([
      'RESULT_CONTENT_DIGEST_VERSION_INCOMPARABLE',
      'STORED_SUBJECTS_ABSENT',
    ]);
  });

  it('reports whether content was actually verified, independent of the classification', async () => {
    const a = await digestOf({ v: 'A' });
    const b = await digestOf({ v: 'B' });
    const run = (c: string | null, e: string | null) =>
      evaluateResultAuthorizationShadow(
        ctx({ result_content_digest: c }),
        env({ result_content_digest: e })
      );
    // Verified: same digest, same version.
    expect(run(a, a).content_digest_outcome).toBe('BOUND_MATCH');
    // A subject MATCH with no content evidence is MATCH but NOT content-verified.
    for (const [c, e] of [
      [null, null],
      [a, null],
      [null, a],
    ] as const) {
      const r = run(c, e);
      expect(r.classification).toBe('MATCH');
      expect(r.content_digest_outcome).toBe('ABSENT');
    }
    expect(run(a, b).content_digest_outcome).toBe('BOUND_MISMATCH');
    expect(run(a, b).classification).toBe('MISMATCH');
    // Relabelling a stored digest's version cannot manufacture BOUND_MATCH.
    const relabelled = a.replace('.v1:', '.v2:');
    expect(run(b, relabelled).content_digest_outcome).toBe('INCOMPARABLE');
    expect(run(a, relabelled).content_digest_outcome).toBe('INCOMPARABLE');
    // Not evaluated when the comparison never got that far.
    expect(
      evaluateResultAuthorizationShadow(ctx({ predicate: 'first_seen' }), env())
        .content_digest_outcome
    ).toBe('NOT_EVALUATED');
    expect(evaluateResultAuthorizationShadow(ctx(), null).content_digest_outcome).toBe(
      'NOT_EVALUATED'
    );
    expect(evaluateResultAuthorizationShadow(null, env()).content_digest_outcome).toBe(
      'NOT_EVALUATED'
    );
  });

  it('the content-digest outcome vocabulary is closed, authority-free, and reaches telemetry', async () => {
    expect([...CONTENT_DIGEST_OUTCOMES]).toEqual([
      'BOUND_MATCH',
      'BOUND_MISMATCH',
      'ABSENT',
      'INCOMPARABLE',
      'NOT_EVALUATED',
    ]);
    for (const v of CONTENT_DIGEST_OUTCOMES) {
      expect(v).not.toMatch(/(^|_)(ALLOW|DENY|DENIED|AUTHORIZED|UNAUTHORIZED|GRANT|PERMIT)(_|$)/);
    }
    const d = await digestOf({ v: 1 });
    const rec = projectResultShadowTelemetry(
      evaluateResultAuthorizationShadow(
        ctx({ result_content_digest: d }),
        env({ result_content_digest: d })
      ),
      'job_1'
    );
    expect(rec.content_digest_outcome).toBe('BOUND_MATCH');
  });

  it('drift guard: the envelope accepts exactly the strings the primitive parses', () => {
    const candidates: unknown[] = [
      `result_content_digest.v1:sha256:${hex('a')}`,
      `result_content_digest.v2:sha256:${hex('a')}`,
      `result_content_digest.v999:sha256:${hex('a')}`,
      `result_content_digest.v1000:sha256:${hex('a')}`,
      `result_content_digest.v0:sha256:${hex('a')}`,
      `result_content_digest.v1:sha256:${hex('A')}`,
      `sha256:${hex('a')}`,
      hex('a'),
      '',
      ' ',
    ];
    for (const c of candidates) {
      const r = evaluateResultAuthorizationShadow(ctx({ result_content_digest: c as never }), null);
      expect(r.classification !== 'ERROR', String(c)).toBe(isResultContentDigest(c));
    }
  });

  it('telemetry projected from a digest-bearing evaluation never contains the digests', async () => {
    const good = await digestOf({ secret_body: 'do-not-leak' });
    const r = evaluateResultAuthorizationShadow(
      ctx({ result_content_digest: good }),
      env({ result_content_digest: good })
    );
    const wire = JSON.stringify(projectResultShadowTelemetry(r, 'job_1'));
    expect(wire).not.toContain(good.slice(-64));
    expect(wire).not.toContain('sha256');
    expect(wire).not.toContain('do-not-leak');
    expect(wire).not.toContain(hex('2'));
  });
});

function deepFreeze<T>(o: T): T {
  if (typeof o === 'object' && o !== null) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

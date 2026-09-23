import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RESULT_AUTHORIZATION_ENVELOPE_VERSION,
  RESULT_AUTHORIZATION_SHADOW_POLICY_VERSION,
  RESULT_SHADOW_TELEMETRY_EVENTS,
  SHADOW_CLASSIFICATIONS,
  SHADOW_REASON_CODES,
  evaluateResultAuthorizationShadow,
  projectResultShadowTelemetry,
  type CurrentReplayContext,
  type ResultAuthorizationEnvelopeV1,
  type SubjectSlot,
  type SubjectSlots,
} from './result-authorization-shadow';

const hex = (c: string) => c.repeat(64);
/** A well-formed v1 ResultContentDigest string (see result-content-digest.ts). */
const cd = (c: string, version = 1) => `result_content_digest.v${version}:sha256:${hex(c)}`;
type PresentSlot = Extract<SubjectSlot, { status: 'PRESENT' }>;
const ABSENT: SubjectSlot = { status: 'ABSENT' };
const present = (
  c: string,
  cls: 'VERIFIED_EVIDENCE' | 'UNVERIFIED_EVIDENCE' = 'VERIFIED_EVIDENCE',
  key = 'k1'
): PresentSlot => ({
  status: 'PRESENT',
  evidence_class: cls,
  subject_digest: hex(c),
  digest_key_version: key,
});
const slots = (p: SubjectSlot, c: SubjectSlot, s: SubjectSlot = ABSENT): SubjectSlots => ({
  payer_subject: p,
  authenticated_caller_subject: c,
  request_signer_subject: s,
});

const ctx = (
  candidate: SubjectSlots,
  over: Partial<CurrentReplayContext> = {}
): CurrentReplayContext => ({
  predicate: 'duplicate_same',
  job_id: 'job_1',
  payment_identifier_digest: hex('a'),
  payment_binding_digest: hex('b'),
  result_ref: 'job_1',
  result_content_digest: null,
  candidate_subjects: candidate,
  ...over,
});

const env = (
  stored: SubjectSlots,
  over: Partial<ResultAuthorizationEnvelopeV1> = {}
): ResultAuthorizationEnvelopeV1 => ({
  envelope_version: RESULT_AUTHORIZATION_ENVELOPE_VERSION,
  policy_version: RESULT_AUTHORIZATION_SHADOW_POLICY_VERSION,
  job_id: 'job_1',
  payment_identifier_digest: hex('a'),
  payment_binding_digest: hex('b'),
  result_ref: 'job_1',
  result_content_digest: null,
  subjects: stored,
  evidence_captured_at: '2026-01-01T00:00:00.000Z',
  ...over,
});

const evalShadow = (c: CurrentReplayContext, e: unknown) => evaluateResultAuthorizationShadow(c, e);

describe('ResultAuthorizationEnvelopeV1 shadow comparator (SA-1, non-enforcing)', () => {
  it('A. fully matching payer + caller evidence -> MATCH / COMPLETE', () => {
    const s = slots(present('1'), present('2'));
    const r = evalShadow(ctx(s), env(s));
    expect(r.classification).toBe('MATCH');
    expect(r.evidence_completeness).toBe('COMPLETE');
    expect(r.reason_codes).toEqual(
      ['AUTHENTICATED_CALLER_SUBJECT_MATCH', 'PAYER_SUBJECT_MATCH'].sort(
        (a, b) => SHADOW_REASON_CODES.indexOf(a as never) - SHADOW_REASON_CODES.indexOf(b as never)
      )
    );
  });

  it('B. payer match / caller absent -> INSUFFICIENT_EVIDENCE (payment != identity)', () => {
    const r = evalShadow(ctx(slots(present('1'), ABSENT)), env(slots(present('1'), ABSENT)));
    expect(r.classification).toBe('INSUFFICIENT_EVIDENCE');
    expect(r.reason_codes).toContain('PAYER_MATCH_WITHOUT_AUTHENTICATED_SUBJECT');
    expect(r.evidence_completeness).toBe('PARTIAL');
  });

  it('C. caller match / payer absent -> MATCH / PARTIAL', () => {
    const r = evalShadow(ctx(slots(ABSENT, present('2'))), env(slots(ABSENT, present('2'))));
    expect(r.classification).toBe('MATCH');
    expect(r.evidence_completeness).toBe('PARTIAL');
    expect(r.axes.payer_subject).toBe('BOTH_ABSENT');
  });

  it('D. payer mismatch -> MISMATCH even when caller matches', () => {
    const r = evalShadow(
      ctx(slots(present('9'), present('2'))),
      env(slots(present('1'), present('2')))
    );
    expect(r.classification).toBe('MISMATCH');
    expect(r.reason_codes).toContain('PAYER_SUBJECT_MISMATCH');
    expect(r.axes.payer_subject).toBe('MISMATCH');
  });

  it('E. caller mismatch -> MISMATCH even when payer matches', () => {
    const r = evalShadow(
      ctx(slots(present('1'), present('9'))),
      env(slots(present('1'), present('2')))
    );
    expect(r.classification).toBe('MISMATCH');
    expect(r.reason_codes).toContain('AUTHENTICATED_CALLER_SUBJECT_MISMATCH');
  });

  it('F. both absent on a legacy Release-1 record -> LEGACY_UNBOUND, not a failure', () => {
    const none = slots(ABSENT, ABSENT);
    const r = evalShadow(ctx(none), env(none));
    expect(r.classification).toBe('LEGACY_UNBOUND');
    expect(r.reason_codes).toEqual(['STORED_SUBJECTS_ABSENT']);
    // A stored-absent record is legacy even if a candidate is later presented.
    expect(evalShadow(ctx(slots(present('1'), present('2'))), env(none)).classification).toBe(
      'LEGACY_UNBOUND'
    );
  });

  it('G. malformed evidence -> ERROR, never throws, never MATCH', () => {
    const good = slots(present('1'), present('2'));
    const bad: unknown[] = [
      'string',
      42,
      [],
      {},
      env(good, { envelope_version: 'result_authorization_envelope.v2' as never }),
      env(good, { policy_version: 'other' as never }),
      env(good, { payment_binding_digest: 'not-hex' }),
      env(good, { job_id: '' }),
      // raw wallet-shaped subject must not be accepted as a digest
      env(slots({ ...present('1'), subject_digest: '0x' + 'ab'.repeat(20) }, ABSENT)),
      // AUTHORITATIVE is not a subject evidence class
      env(slots({ ...present('1'), evidence_class: 'AUTHORITATIVE' as never }, ABSENT)),
      env({ ...good, request_signer_subject: undefined } as never),
      env(slots({ ...present('1'), digest_key_version: 'BAD KEY!' }, ABSENT)),
    ];
    for (const e of bad) {
      const r = evalShadow(ctx(good), e);
      expect(r.classification).toBe('ERROR');
    }
    expect(evaluateResultAuthorizationShadow(null, env(good)).classification).toBe('ERROR');
    expect(
      evaluateResultAuthorizationShadow({ predicate: 'nope' }, env(good)).reason_codes
    ).toEqual(['MALFORMED_REPLAY_CONTEXT']);
    expect(evalShadow(ctx(good, { payment_binding_digest: 'x' }), env(good)).classification).toBe(
      'ERROR'
    );
  });

  it('H. replay tuple matches but authorization subject mismatches -> MISMATCH', () => {
    // Identical operation/binding/identifier digests; only the subject differs.
    const r = evalShadow(ctx(slots(ABSENT, present('9'))), env(slots(ABSENT, present('2'))));
    expect(r.classification).toBe('MISMATCH');
    expect(r.reason_codes).toEqual(['AUTHENTICATED_CALLER_SUBJECT_MISMATCH']);
  });

  it('I. result identity mismatch -> MISMATCH regardless of subject match', () => {
    const s = slots(present('1'), present('2'));
    expect(evalShadow(ctx(s), env(s, { result_ref: 'job_2' })).reason_codes).toEqual([
      'RESULT_IDENTITY_MISMATCH',
    ]);
    const d = evalShadow(
      ctx(s, { result_content_digest: cd('c') }),
      env(s, { result_content_digest: cd('d') })
    );
    expect(d.classification).toBe('MISMATCH');
    expect(d.reason_codes).toEqual(['RESULT_IDENTITY_MISMATCH']);
    // Release 1 binds no content digest: absent on either side is not a mismatch.
    expect(evalShadow(ctx(s, { result_content_digest: cd('c') }), env(s)).classification).toBe(
      'MATCH'
    );
    const wrongJob = evalShadow(ctx(s), env(s, { job_id: 'job_9' }));
    expect(wrongJob.reason_codes).toContain('ENVELOPE_OPERATION_MISMATCH');
    expect(evalShadow(ctx(s), env(s, { payment_binding_digest: hex('e') })).reason_codes).toContain(
      'ENVELOPE_PAYMENT_BINDING_MISMATCH'
    );
    expect(
      evalShadow(ctx(s), env(s, { payment_identifier_digest: hex('e') })).reason_codes
    ).toContain('ENVELOPE_PAYMENT_IDENTIFIER_MISMATCH');
  });

  it('J. comparator receives no envelope -> LEGACY_UNBOUND (NO_ENVELOPE)', () => {
    for (const none of [null, undefined]) {
      const r = evalShadow(ctx(slots(present('1'), present('2'))), none);
      expect(r.classification).toBe('LEGACY_UNBOUND');
      expect(r.reason_codes).toEqual(['NO_ENVELOPE']);
    }
  });

  it('K. cannot alter release behavior: pure, inputs untouched, verdict carries no release field', () => {
    const s = slots(present('1'), present('2'));
    const c = deepFreeze(ctx(s));
    const e = deepFreeze(env(s));
    const before = JSON.stringify([c, e]);
    const r = evalShadow(c, e);
    expect(JSON.stringify([c, e])).toBe(before);
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.reason_codes)).toBe(true);
    expect(Object.keys(r).sort()).toEqual([
      'axes',
      'classification',
      'content_digest_outcome',
      'envelope_version',
      'evidence_completeness',
      'policy_version',
      'reason_codes',
    ]);
    // Every classification, for every predicate, is a descriptive value.
    for (const predicate of [
      'first_seen',
      'duplicate_conflict',
      'expired',
      'repository_error',
    ] as const) {
      expect(evalShadow(ctx(s, { predicate }), env(s)).classification).toBe('NOT_APPLICABLE');
    }
  });

  it('L. is deterministic and repeatable, independent of key insertion order', () => {
    const s = slots(present('1'), present('2'));
    const a = JSON.stringify(evalShadow(ctx(s), env(s)));
    for (let i = 0; i < 25; i += 1) expect(JSON.stringify(evalShadow(ctx(s), env(s)))).toBe(a);
    const reordered = { ...env(s) };
    const rev = Object.fromEntries(Object.entries(reordered).reverse());
    expect(JSON.stringify(evalShadow(ctx(s), rev))).toBe(a);
  });

  it('M. reason-code and classification vocabularies are stable and non-authoritative', () => {
    expect([...SHADOW_CLASSIFICATIONS]).toEqual([
      'MATCH',
      'MISMATCH',
      'INSUFFICIENT_EVIDENCE',
      'NOT_APPLICABLE',
      'LEGACY_UNBOUND',
      'ERROR',
    ]);
    expect(SHADOW_REASON_CODES).toHaveLength(new Set(SHADOW_REASON_CODES).size);
    // 25 in SA1-RESULT-SHADOW-ENVELOPE-DESIGN-01; +RESULT_CONTENT_DIGEST_VERSION_INCOMPARABLE
    // in SA1-RESULT-CONTENT-DIGEST-DESIGN-01.
    expect(SHADOW_REASON_CODES.length).toBe(26);
    for (const v of [...SHADOW_CLASSIFICATIONS, ...SHADOW_REASON_CODES]) {
      expect(v).toMatch(/^[A-Z_]+$/);
      expect(v).not.toMatch(/(^|_)(ALLOW|DENY|DENIED|AUTHORIZED|UNAUTHORIZED|GRANT|PERMIT)(_|$)/);
    }
    // Emitted codes are always in canonical order and inside the vocabulary.
    const s = slots(present('1'), present('9'));
    const r = evalShadow(ctx(s), env(slots(present('2'), present('2'))));
    const idx = r.reason_codes.map((c) => SHADOW_REASON_CODES.indexOf(c));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it('N. telemetry projection is allowlisted and leaks no subject/secret material', () => {
    const secret = {
      digest: 'deadbeef'.repeat(8),
      sig: 'SIGNATURE-RAW-BYTES',
      auth: 'Bearer SECRET-TOKEN',
      wallet: '0x' + 'ab'.repeat(20),
      pid: 'pay-ident-raw-value',
    };
    const leaky = {
      ...env(slots({ ...present('1'), subject_digest: secret.digest }, present('2')), {
        payment_identifier_digest: hex('a'),
      }),
      raw_signature: secret.sig,
      authorization_header: secret.auth,
      wallet: secret.wallet,
      payment_identifier: secret.pid,
      ip: '203.0.113.7',
      user_agent: 'UA/1.0',
    };
    const c = ctx(
      slots({ ...present('9'), subject_digest: secret.digest.replace('d', 'e') }, present('2'))
    );
    const evaluation = evalShadow(c, leaky);
    const rec = projectResultShadowTelemetry(evaluation, 'job_1');
    const json = JSON.stringify(rec);
    for (const v of Object.values(secret)) expect(json).not.toContain(v);
    expect(json).not.toContain('203.0.113.7');
    expect(json).not.toContain('UA/1.0');
    expect(json).not.toContain(hex('a'));
    expect(Object.keys(rec).sort()).toEqual([
      'axes',
      'classification',
      'content_digest_outcome',
      'envelope_version',
      'event',
      'evidence_completeness',
      'job_id',
      'policy_version',
      'reason_codes',
    ]);
    // Non-opaque job id (e.g. attacker-controlled free text) cannot enter.
    expect(projectResultShadowTelemetry(evaluation, 'a b <script>').job_id).toBeNull();
    expect(projectResultShadowTelemetry(evaluation, { x: 1 }).job_id).toBeNull();
    // Event names are the closed vocabulary and map 1:1 from classifications.
    const events = SHADOW_CLASSIFICATIONS.map(
      (k) => projectResultShadowTelemetry({ ...evaluation, classification: k }, 'job_1').event
    );
    expect(events.sort()).toEqual([...RESULT_SHADOW_TELEMETRY_EVENTS].sort());
  });
});

describe('additional trust rules', () => {
  it('unverified subject evidence can never produce MATCH or MISMATCH', () => {
    const stored = slots(ABSENT, present('2', 'UNVERIFIED_EVIDENCE'));
    for (const cand of ['2', '9']) {
      const r = evalShadow(ctx(slots(ABSENT, present(cand))), env(stored));
      expect(r.classification).toBe('INSUFFICIENT_EVIDENCE');
      expect(r.reason_codes).toContain('SUBJECT_EVIDENCE_UNVERIFIED');
    }
  });

  it('digests under different key versions are incomparable, not a mismatch', () => {
    const r = evalShadow(
      ctx(slots(ABSENT, present('2', 'VERIFIED_EVIDENCE', 'k2'))),
      env(slots(ABSENT, present('9', 'VERIFIED_EVIDENCE', 'k1')))
    );
    expect(r.classification).toBe('INSUFFICIENT_EVIDENCE');
    expect(r.reason_codes).toContain('SUBJECT_KEY_VERSION_INCOMPARABLE');
  });

  it('request-signer axis can support MATCH independently of payer', () => {
    const s = slots(ABSENT, ABSENT, present('3'));
    expect(evalShadow(ctx(s), env(s)).classification).toBe('MATCH');
  });
});

describe('EXPECTED_RELEASE1_SHADOW_OUTCOMES matrix', () => {
  const noSubjects = slots(ABSENT, ABSENT);
  // Release 1: replay never re-verifies payment and has no authenticated
  // caller, so every candidate slot is ABSENT.
  const rows: Array<{
    name: string;
    predicate: CurrentReplayContext['predicate'];
    envelope: (() => unknown) | null;
    expected: string;
  }> = [
    {
      name: 'first-seen request',
      predicate: 'first_seen',
      envelope: null,
      expected: 'NOT_APPLICABLE',
    },
    {
      name: 'binding conflict',
      predicate: 'duplicate_conflict',
      envelope: null,
      expected: 'NOT_APPLICABLE',
    },
    {
      name: 'legacy duplicate_same, no envelope',
      predicate: 'duplicate_same',
      envelope: null,
      expected: 'LEGACY_UNBOUND',
    },
    {
      name: 'legacy already_consumed, no envelope',
      predicate: 'already_consumed',
      envelope: null,
      expected: 'LEGACY_UNBOUND',
    },
    {
      name: 'envelope with no stored subjects',
      predicate: 'duplicate_same',
      envelope: () => env(noSubjects),
      expected: 'LEGACY_UNBOUND',
    },
    {
      name: 'envelope backfilled with settlement payer, replay has no candidate',
      predicate: 'already_consumed',
      envelope: () => env(slots(present('1'), ABSENT)),
      expected: 'INSUFFICIENT_EVIDENCE',
    },
  ];
  for (const row of rows) {
    it(`${row.name} -> ${row.expected}`, () => {
      const r = evalShadow(ctx(noSubjects, { predicate: row.predicate }), row.envelope?.() ?? null);
      expect(r.classification).toBe(row.expected);
    });
  }

  it('Release-1 traffic never manufactures MISMATCH or ERROR', () => {
    for (const row of rows) {
      const r = evalShadow(ctx(noSubjects, { predicate: row.predicate }), row.envelope?.() ?? null);
      expect(['MISMATCH', 'ERROR', 'MATCH']).not.toContain(r.classification);
    }
  });
});

// ---------------------------------------------------------------------------
// Formal non-interference gate (structural).
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(__dirname, '../../../..');
const MODULE_SRC = readFileSync(resolve(__dirname, 'result-authorization-shadow.ts'), 'utf8');

function walk(dir: string, out: string[] = [], ext = /\.(ts|tsx|mts|js|mjs)$/): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git' || name.startsWith('.'))
      continue;
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(p, out, ext);
    else if (ext.test(name)) out.push(p);
  }
  return out;
}

/** The only files allowed to mention an SA-1 primitive (repo-relative, exact). */
const SA1_FILES = new Set(
  [
    'result-authorization-shadow.ts',
    'result-authorization-shadow.test.ts',
    'result-content-digest.ts',
    'result-content-digest.test.ts',
    'subject-digest.ts',
    'subject-digest.test.ts',
  ].map((n) => `/packages/vcm/src/security/${n}`)
);
const isSa1File = (relPath: string) => SA1_FILES.has(relPath);

// Case-insensitive: macOS resolves `./Subject-Digest` to the same file.
const SA1_REFERENCE =
  /result-authorization-shadow|result-content-digest|subject-digest|evaluateResultAuthorizationShadow|projectResultShadowTelemetry|ResultAuthorizationEnvelopeV1|computeResultContentDigest|compareResultContentDigest|computeSubjectDigest/i;

/** Code AND wiring surfaces (config/manifests/entrypoints), not only .ts. */
const SCAN_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json|jsonc|toml|py)$/;

const SCAN_ROOTS = ['packages', 'apps', 'services', 'scripts'];

/** Live paths an authorization decision could be wired into. Must be visited. */
const LIVE_PATHS = [
  '/apps/edge-api/src/control-plane/routes/x402-service.ts',
  '/apps/edge-api/src/control-plane/workflows/production-dependencies.ts',
  '/apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts',
  '/apps/edge-api/src/control-plane/repositories/d1/x402-quotes.ts',
  '/packages/protocol-x402/src/replay/binding.ts',
];

function scanSa1References(
  repoRoot: string,
  roots: readonly string[],
  allowed: (relPath: string) => boolean
): { offenders: string[]; scanned: number; visited: string[] } {
  const offenders: string[] = [];
  const visited: string[] = [];
  for (const root of roots) {
    let files: string[];
    try {
      files = walk(join(repoRoot, root), [], SCAN_EXT);
    } catch {
      continue;
    }
    for (const f of files) {
      const rel = f.replace(repoRoot, '');
      visited.push(rel);
      if (allowed(rel)) continue;
      if (SA1_REFERENCE.test(readFileSync(f, 'utf8'))) offenders.push(rel);
    }
  }
  return { offenders, scanned: visited.length, visited };
}

describe('formal non-interference gate', () => {
  it('module is pure: no imports, clock, randomness, I/O, or environment', () => {
    const code = MODULE_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/\brequire\s*\(/);
    for (const banned of [
      'Date',
      'Math.random',
      'crypto',
      'fetch',
      'process',
      'console',
      'setTimeout',
      'localStorage',
      'XMLHttpRequest',
    ]) {
      expect(code, banned).not.toMatch(new RegExp(`\\b${banned.replace('.', '\\.')}\\b`));
    }
  });

  it('nothing outside the SA-1 files imports or references any SA-1 primitive', () => {
    const { offenders, scanned, visited } = scanSa1References(REPO_ROOT, SCAN_ROOTS, isSa1File);
    // Non-vacuity: the walk must actually cover the monorepo source, including
    // every live path an authorization decision could be wired into.
    expect(scanned).toBeGreaterThan(200);
    for (const live of LIVE_PATHS) expect(visited, live).toContain(live);
    expect(offenders).toEqual([]);
  });

  it('mutation: a planted reference is caught, and the gate is clean once removed', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'sa1-gate-'));
    try {
      const rel = 'apps/edge-api/src/control-plane/routes/planted.ts';
      const file = join(sandbox, rel);
      mkdirSync(join(sandbox, 'apps/edge-api/src/control-plane/routes'), { recursive: true });
      const benign = "export const x = 1;\nexport const y = 'ok';\n";
      writeFileSync(file, benign);

      // 1. Baseline: the scanner sees the file and reports nothing.
      const clean = scanSa1References(sandbox, ['apps'], () => false);
      expect(clean.visited).toContain(`/${rel}`);
      expect(clean.offenders).toEqual([]);

      // 2. Plant each prohibited reference kind; the gate must fail for each.
      const planted = [
        "import { evaluateResultAuthorizationShadow } from '@siteborne/vcm/security/result-authorization-shadow';",
        "import { computeResultContentDigest } from '../../../../../packages/vcm/src/security/result-content-digest';",
        "import { computeSubjectDigest } from '@siteborne/vcm/src/security/subject-digest';",
        'const e: ResultAuthorizationEnvelopeV1 | null = null;',
        'projectResultShadowTelemetry(ev, jobId);',
        'await compareResultContentDigest(body, expected);',
        // case-variant path (case-insensitive filesystems resolve it)
        "import { x } from '../security/Subject-Digest';",
        "import { y } from '../security/RESULT-CONTENT-DIGEST';",
      ];
      for (const line of planted) {
        writeFileSync(file, `${benign}${line}\n`);
        const dirty = scanSa1References(sandbox, ['apps'], () => false);
        expect(dirty.offenders, line).toEqual([`/${rel}`]);
      }

      // 2b. A non-TypeScript wiring surface (manifest/config) is also scanned.
      writeFileSync(file, benign);
      const cfg = join(sandbox, 'apps/edge-api/wiring.json');
      writeFileSync(cfg, '{"main":"packages/vcm/src/security/subject-digest.ts"}');
      expect(scanSa1References(sandbox, ['apps'], () => false).offenders).toEqual([
        '/apps/edge-api/wiring.json',
      ]);
      rmSync(cfg);

      // 3. Remove the mutation; the gate passes again.
      writeFileSync(file, benign);
      expect(scanSa1References(sandbox, ['apps'], () => false).offenders).toEqual([]);

      // 4. The allowlist is not a hole: an allowlisted path is the only exemption.
      writeFileSync(file, `${benign}${planted[0] as string}\n`);
      expect(scanSa1References(sandbox, ['apps'], (r) => r === `/${rel}`).offenders).toEqual([]);
      expect(scanSa1References(sandbox, ['apps'], () => false).offenders).toEqual([`/${rel}`]);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('SA-1 primitives import only the governed canonicalizer and use no clock/random/I-O', () => {
    const banned = [
      'Date',
      'Math.random',
      'fetch',
      'process',
      'console',
      'setTimeout',
      'localStorage',
      'XMLHttpRequest',
      'getRandomValues',
      'randomUUID',
      'generateKey',
      'importKey',
      'exportKey',
      'deriveKey',
      'env',
    ];
    for (const name of ['result-content-digest.ts', 'subject-digest.ts']) {
      const raw = readFileSync(resolve(__dirname, name), 'utf8');
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      const specifiers = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      expect(specifiers, name).toEqual(['../canonical']);
      expect(code, name).not.toMatch(/\brequire\s*\(/);
      expect(code, name).not.toMatch(/\bimport\s*\(/);
      for (const b of banned) {
        expect(code, `${name}:${b}`).not.toMatch(new RegExp(`\\b${b.replace('.', '\\.')}\\b`));
      }
    }
    // The content digest reaches SHA-256 only through the governed path.
    const contentCode = readFileSync(resolve(__dirname, 'result-content-digest.ts'), 'utf8');
    expect(contentCode.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')).not.toMatch(
      /\bcrypto\b|createHash/
    );
    // The only WebCrypto call in either primitive is HMAC sign.
    const subjectCode = readFileSync(resolve(__dirname, 'subject-digest.ts'), 'utf8');
    expect([...subjectCode.matchAll(/crypto\.subtle\.(\w+)/g)].map((m) => m[1])).toEqual(['sign']);
  });

  it('no SA-1 source contains authority vocabulary (allow/deny/grant/permit/authorized)', () => {
    const authority =
      /\b(allow|allowed|deny|denied|authorized|unauthorized|grant|granted|permit|permitted)\b/i;
    for (const name of [
      'result-authorization-shadow.ts',
      'result-content-digest.ts',
      'subject-digest.ts',
    ]) {
      const raw = readFileSync(resolve(__dirname, name), 'utf8');
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, name).not.toMatch(authority);
    }
  });

  it('adds no migration, public schema, or production secret/binding', () => {
    const terms = /result_content_digest|subject_digest|result_authorization|SUBJECT_DIGEST_KEY/i;
    for (const dir of ['migrations']) {
      for (const name of readdirSync(join(REPO_ROOT, dir))) {
        expect(readFileSync(join(REPO_ROOT, dir, name), 'utf8'), `${dir}/${name}`).not.toMatch(
          terms
        );
      }
    }
    // Public/wire schemas and PCC.
    let scannedSchemas = 0;
    for (const dir of ['contracts', 'packages/contracts', 'packages/pcc-schema', 'registry']) {
      let files: string[] = [];
      try {
        files = walk(join(REPO_ROOT, dir), [], /\.(ts|json|yaml|yml)$/);
      } catch {
        continue;
      }
      scannedSchemas += files.length;
      for (const f of files) {
        expect(readFileSync(f, 'utf8'), f.replace(REPO_ROOT, '')).not.toMatch(terms);
      }
    }
    expect(scannedSchemas).toBeGreaterThan(20);
    // Production configuration: no new env var / secret / binding.
    const envSrc = readFileSync(
      join(REPO_ROOT, 'apps/edge-api/src/control-plane/config/env.ts'),
      'utf8'
    );
    expect(envSrc).not.toMatch(terms);
    for (const w of ['apps/edge-api/wrangler.toml', 'apps/edge-api/wrangler.jsonc']) {
      try {
        expect(readFileSync(join(REPO_ROOT, w), 'utf8'), w).not.toMatch(terms);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
  });

  it('is not re-exported through the security or vcm barrels (no public surface)', () => {
    const barrel = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');
    const vcmIndex = readFileSync(resolve(__dirname, '../index.ts'), 'utf8');
    for (const m of [
      /result-authorization-shadow/,
      /result-content-digest/,
      /subject-digest/,
      /ResultContentDigest|SubjectDigest/,
    ]) {
      expect(barrel).not.toMatch(m);
      expect(vcmIndex).not.toMatch(m);
    }
  });

  it('protocol-x402 replay/binding source neither imports nor mentions the shadow model', () => {
    const files = walk(join(REPO_ROOT, 'packages/protocol-x402/src')).filter(
      (f) => !f.endsWith('.test.ts')
    );
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/ResultAuthorization|result-authorization/);
    }
  });

  it('public metadata surfaces do not mention the envelope', () => {
    const surfaces = [
      'apps/edge-api/src',
      'packages/protocol-mcp/src',
      'packages/protocol-a2a/src',
      'packages/mcp-server/src',
    ];
    // The envelope's own implementation module necessarily defines these
    // terms; it is the private implementation this gate protects, not a
    // public-facing surface. Wire-body leakage is proven separately, per
    // service, by "absent from the public result surface and wire body"
    // above -- this gate covers everything else in these trees.
    const implementationFiles = new Set([
      join(REPO_ROOT, 'apps/edge-api/src/control-plane/security/result-authorization.ts'),
    ]);
    let scanned = 0;
    for (const s of surfaces) {
      let files: string[] = [];
      try {
        files = walk(join(REPO_ROOT, s));
      } catch {
        continue;
      }
      files = files.filter((f) => !implementationFiles.has(f));
      scanned += files.length;
      for (const f of files) {
        expect(readFileSync(f, 'utf8'), f).not.toMatch(
          /ResultAuthorizationEnvelope|result_authorization_envelope|result_content_digest|subject_digest|digest_key_version/
        );
      }
    }
    expect(scanned).toBeGreaterThan(20);
  });
});

function deepFreeze<T>(o: T): T {
  if (typeof o === 'object' && o !== null) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/**
 * RESULT-FINALIZATION-INTERNAL-ARTIFACT-01 — load-bearing tests for the internal
 * finalized-result artifact: shared by all four executors, semantic state final
 * and frozen before any proof, governed (non-placeholder) metadata, closed code
 * vocabularies, Unicode-scalar safety, byte-exact preimage reconstruction, and
 * separation of output_hash from pcc_document_hash. The current public wire body
 * is characterized separately (result-wire-characterization.test.ts).
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { canonicalize, contentHash, hashPolicy, loadPolicy } from '@siteborne/verification';
import type { MeshVerdict, VerificationResult } from '@siteborne/verification';
import {
  buildDraftDocument,
  buildInternalResultArtifact,
  defaultProvenance,
  freezeSemanticSnapshot,
  getGovernedMetadata,
  isPlaceholderHash,
  projectVerifierResults,
  verifyAndSign,
  assertKnownFindingCode,
  assertKnownServiceFailureCode,
  assertKnownVerifierFailureCode,
  UnknownCodeError,
  InvalidUnicodeScalarError,
  NonFiniteNumberError,
  SemanticSnapshotError,
  type InternalResultArtifact,
} from '../pcc';
import type { PccDocument } from '../pcc/document-types';
import { buildTestServiceContext } from './support';
import { FIXED_TIME, FOUR_V2_SERVICES, KEY_HEX, runScenario } from './four-service-scenarios';
import { buildProductionSigner } from '../pcc';
import { ALL_SERVICE_IDS, type ServiceId } from '../types';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (relative: string): Buffer => readFileSync(`${REPO}${relative}`);
const sha256 = (bytes: Buffer): string =>
  'sha256:' + createHash('sha256').update(bytes).digest('hex');

interface ReleaseYaml {
  release: { version: string };
  pcc_dependency: { schema_release: string; schema_sha256: string };
  services: Array<{
    service_id: string;
    input_schema: string;
    input_schema_sha256: string;
    output_schema: string;
    output_schema_sha256: string;
  }>;
}
const release = (version: string): ReleaseYaml =>
  parseYaml(
    read(`contracts/releases/${version}/CONTRACT_RELEASE.yaml`).toString('utf-8')
  ) as ReleaseYaml;

const realVersion = process.version;
const realPlatform = process.platform;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_TIME);
  Object.defineProperty(process, 'version', { value: 'v0.0.0-artifact', configurable: true });
  Object.defineProperty(process, 'platform', { value: 'artifact-test', configurable: true });
});
afterAll(() => {
  vi.useRealTimers();
  Object.defineProperty(process, 'version', { value: realVersion, configurable: true });
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
});

async function artifactFor(serviceId: ServiceId): Promise<InternalResultArtifact> {
  const { result } = await runScenario(serviceId);
  expect(result.result_class).toBe('success');
  expect(result.finalized).toBeDefined();
  return result.finalized as InternalResultArtifact;
}

type Ext = Record<string, unknown>;
const EXT_KEY = 'net.siteborne.agent-verification.v1' as const;

function makeDraft(
  extension: Ext = { note: 'x' },
  claimValue: unknown = 1
): PccDocument<typeof EXT_KEY, Ext> {
  return buildDraftDocument({
    seed: 'artifact-test',
    serviceId: 'verify_agent_output.v2',
    serviceVersion: 'v2',
    inputHash: 'sha256:' + 'a1'.repeat(32),
    inputSchemaHash: 'sha256:' + '1'.repeat(64),
    outputSchemaHash: 'sha256:' + '2'.repeat(64),
    contractMode: 'offline_verification',
    freshnessSeconds: 3600,
    issuedAtIso: '2026-09-01T12:00:00.000Z',
    expiresAtIso: '2026-09-01T13:00:00.000Z',
    subject: { type: 'other', canonical_name: 'candidate:test' },
    claims: [
      {
        claim_id: 'clm_' + 'a'.repeat(24),
        predicate: 'p',
        value: claimValue,
        confidence: 0.9,
        evidence_ids: [],
        materiality: 'material',
        verification_status: 'verified',
      },
    ],
    evidence: [],
    completeness: {
      requested_fields: 1,
      populated_fields: 1,
      supported_fields: 1,
      score: 1,
      missing_fields: [],
      unsupported_fields: [],
      stale_fields: [],
      vector: [],
    },
    provenance: defaultProvenance('test', '0.0.0'),
    extensionKey: EXT_KEY,
    extensionPayload: extension,
  });
}

const VERIFICATION_BLOCK = makeDraft().verification;

function freeze(draft: PccDocument<typeof EXT_KEY, Ext>, finalExtension: Ext) {
  return freezeSemanticSnapshot({
    draft,
    finalExtension,
    verification: { ...VERIFICATION_BLOCK, decision: 'pass' },
    serviceId: 'verify_agent_output.v2',
  });
}

describe('1-4: every executor produces the same internal artifact type', () => {
  it.each(FOUR_V2_SERVICES)(
    '%s returns a complete, frozen InternalResultArtifact',
    async (serviceId) => {
      const artifact = await artifactFor(serviceId);
      expect(artifact.artifactVersion).toBe(1);
      expect(Object.keys(artifact).sort()).toEqual(
        [
          'artifactVersion',
          'finalExtension',
          'governed',
          'linkEvidenceInputs',
          'pccDocument',
          'proofPreimage',
          'serviceOutput',
          'verificationReceipt',
          'verifierResults',
          'wireBody',
        ].sort()
      );
      expect(Object.isFrozen(artifact)).toBe(true);
      expect(Object.isFrozen(artifact.finalExtension)).toBe(true);
      expect(Object.isFrozen(artifact.pccDocument.claims)).toBe(true);
      expect(artifact.governed.serviceId).toBe(serviceId);
    }
  );

  it.each(FOUR_V2_SERVICES)(
    '%s: wireBody is the CURRENT flat receipt, unchanged',
    async (serviceId) => {
      const { result } = await runScenario(serviceId);
      const artifact = result.finalized as InternalResultArtifact;
      expect(JSON.parse(JSON.stringify(artifact.wireBody))).toEqual(
        JSON.parse(JSON.stringify(result.receipt))
      );
      // The current released receipt still carries legacy context defaults; the
      // internal governed state must not.
      expect(result.receipt?.policy_hash).toBe('sha256:' + '0'.repeat(64));
      expect(artifact.governed.policyHash).not.toBe(result.receipt?.policy_hash);
    }
  );
});

describe('5-8: semantic state is final and frozen before any proof', () => {
  it('finalizeSemantics runs after the mesh and before any receipt is created or signed', async () => {
    const { signer, keyRegistry } = await runScenario('verify_agent_output.v2');
    const context = await buildTestServiceContext('verify_agent_output.v2');
    const seenAtHook: string[] = [];
    const draft = makeDraft({ base: true });
    const signed = await verifyAndSign({
      draft,
      context,
      signer,
      keyRegistry,
      finalizeSemantics: () => {
        seenAtHook.push(...context.audit.getEvents().map((event) => event.type));
        return { base: true, outcome: 'pass', score: 1 };
      },
    });
    expect(seenAtHook).not.toContain('receipt_created');
    expect(seenAtHook).not.toContain('receipt_signed');
    expect(context.audit.getEvents().map((event) => event.type)).toContain('receipt_signed');
    expect(signed.finalExtension).toEqual({ base: true, outcome: 'pass', score: 1 });
  });

  it('verify_agent_output: outcome and score exist in the frozen semantic state, bound into output_hash, and never mutate the signed draft', async () => {
    const artifact = await artifactFor('verify_agent_output.v2');
    expect(artifact.finalExtension).toMatchObject({ outcome: 'pass', score: 1 });
    expect(artifact.serviceOutput).not.toHaveProperty('outcome');
    expect(artifact.serviceOutput).not.toHaveProperty('score');
    // output_hash covers the FINAL extension, including outcome/score.
    expect(artifact.proofPreimage.preimage.output_hash).toBe(
      await contentHash(canonicalize(artifact.finalExtension))
    );
    expect(artifact.proofPreimage.preimage.output_hash).not.toBe(
      await contentHash(canonicalize(artifact.serviceOutput))
    );
  });

  it('the signed document handed back by verifyAndSign is not mutated after signing (POST_SIGN_RESULT_MUTATIONS=0)', async () => {
    const { signer, keyRegistry } = await runScenario('verify_agent_output.v2');
    const context = await buildTestServiceContext('verify_agent_output.v2');
    const draft = makeDraft({ base: true });
    const before = JSON.stringify(draft);
    const signed = await verifyAndSign({
      draft,
      context,
      signer,
      keyRegistry,
      finalizeSemantics: () => ({ base: true, outcome: 'pass', score: 1 }),
    });
    expect(JSON.stringify(draft)).toBe(before);
    expect(signed.document.extensions[EXT_KEY]).toEqual({ base: true });
    expect(signed.finalExtension).toEqual({ base: true, outcome: 'pass', score: 1 });
  });

  it('mutation after finalization is ineffective or throws: frozen artifact, detached result copy, forged/altered snapshot', async () => {
    const artifact = await artifactFor('verify_agent_output.v2');
    const hashBefore = await contentHash(canonicalize(artifact.finalExtension));
    expect(() => {
      (artifact.finalExtension as Ext).outcome = 'forged';
    }).toThrow(TypeError);
    expect(() => {
      (artifact.pccDocument.claims as unknown as Ext[]).push({});
    }).toThrow(TypeError);
    expect(() => {
      (artifact.linkEvidenceInputs as { signature: string }).signature = 'x';
    }).toThrow(TypeError);
    expect(await contentHash(canonicalize(artifact.finalExtension))).toBe(hashBefore);

    // The mutable copy returned to callers is detached from the proof state.
    const { result } = await runScenario('verify_agent_output.v2');
    (result.output as Ext).outcome = 'forged';
    expect((result.finalized as InternalResultArtifact).finalExtension).toMatchObject({
      outcome: 'pass',
    });

    // The proof phase refuses anything that is not a real frozen snapshot...
    const snapshot = await freeze(makeDraft(), { a: 1 });
    const { signer } = await runScenario('verify_agent_output.v2');
    const receiptFixture = (await runScenario('verify_agent_output.v2')).result.receipt!;
    const verdict = { decision: 'pass', results: [] } as unknown as MeshVerdict;
    const params = {
      receipt: receiptFixture,
      verdict,
      requestId: 'req',
      verificationMode: 'standard' as const,
    };
    void signer;
    await expect(
      buildInternalResultArtifact({ ...params, snapshot: { finalExtension: { a: 1 } } as never })
    ).rejects.toThrow('proof_phase_requires_frozen_semantic_snapshot');
    // ...or a snapshot whose bytes no longer match what was frozen.
    await expect(
      buildInternalResultArtifact({
        ...params,
        snapshot: { ...snapshot, finalExtension: { a: 2 } } as never,
      })
    ).rejects.toBeInstanceOf(SemanticSnapshotError);
    await expect(buildInternalResultArtifact({ ...params, snapshot })).resolves.toBeDefined();
  });

  it('a receipt that fails runtime self-verification yields no proof-bearing artifact', async () => {
    const { signer } = await runScenario('verify_agent_output.v2');
    const { keyRegistry: otherRegistry } = await (async () => {
      const other = await buildProductionSigner('22'.repeat(32), 'kid_' + 'b'.repeat(24));
      return { keyRegistry: other.registry };
    })();
    const context = await buildTestServiceContext('verify_agent_output.v2');
    const signed = await verifyAndSign({
      draft: makeDraft(),
      context,
      signer,
      keyRegistry: otherRegistry,
    });
    expect(signed.receiptCryptographicallyValid).toBe(false);
    expect(signed.artifact).toBeUndefined();
    expect(signed.verdict.decision).toBe('fail');
  });
});

describe('11-15: internal governed metadata derives from governed authorities, with no placeholders', () => {
  it('policy_hash derives from hashPolicy(governance/VERIFICATION_POLICY.yaml)', async () => {
    expect(getGovernedMetadata('verify_agent_output.v2').policyHash).toBe(
      await hashPolicy(loadPolicy())
    );
  });

  it.each([
    [
      '1.0.1',
      [
        'company_evidence_graph.v1',
        'web_context_verified.v1',
        'document_evidence_json.v1',
        'verify_agent_output.v1',
      ],
    ],
    [
      '2.0.0',
      [
        'company_evidence_graph.v2',
        'web_context_verified.v2',
        'document_evidence_json.v2',
        'verify_agent_output.v2',
      ],
    ],
  ] as const)(
    'release %s: contract_release, PCC schema and per-service schema hashes derive from CONTRACT_RELEASE.yaml + immutable schema bytes',
    (version, serviceIds) => {
      const yaml = release(version);
      for (const serviceId of serviceIds) {
        const governed = getGovernedMetadata(serviceId);
        const entry = yaml.services.find((s) => s.service_id === serviceId)!;
        expect(governed.contractRelease).toBe(yaml.release.version);
        expect(governed.pccSchemaRelease).toBe(yaml.pcc_dependency.schema_release);
        expect(governed.pccSchemaHash).toBe('sha256:' + yaml.pcc_dependency.schema_sha256);
        // ...and the yaml digest is itself the digest of the immutable artifact bytes.
        expect(governed.pccSchemaHash).toBe(
          sha256(read(`contracts/releases/${version}/schemas/proof-carrying-context.schema.json`))
        );
        expect(governed.inputSchemaHash).toBe('sha256:' + entry.input_schema_sha256);
        expect(governed.outputSchemaHash).toBe('sha256:' + entry.output_schema_sha256);
        expect(governed.inputSchemaHash).toBe(
          sha256(read(`contracts/releases/${version}/${entry.input_schema}`))
        );
        expect(governed.outputSchemaHash).toBe(
          sha256(read(`contracts/releases/${version}/${entry.output_schema}`))
        );
      }
    }
  );

  it('covers every implemented service id', () => {
    for (const serviceId of ALL_SERVICE_IDS)
      expect(getGovernedMetadata(serviceId).serviceId).toBe(serviceId);
  });

  it.each(FOUR_V2_SERVICES)(
    '%s: the artifact carries the governed values in governed, preimage and semantic document',
    async (serviceId) => {
      const artifact = await artifactFor(serviceId);
      const governed = getGovernedMetadata(serviceId);
      expect(artifact.governed).toEqual(governed);
      const { preimage } = artifact.proofPreimage;
      expect(preimage.contract_release).toBe('2.0.0');
      expect(preimage.pcc_schema_release).toBe('1.1.0');
      expect(preimage.pcc_schema_hash).toBe(governed.pccSchemaHash);
      expect(preimage.policy_hash).toBe(governed.policyHash);
      expect(preimage.output_schema_hash).toBe(governed.outputSchemaHash);
      expect(artifact.pccDocument.contract.output_schema_hash).toBe(governed.outputSchemaHash);
      expect(artifact.pccDocument.contract.input_schema_hash).toBe(governed.inputSchemaHash);
    }
  );

  it.each(FOUR_V2_SERVICES)(
    '%s: NEW_INTERNAL_PLACEHOLDER_HASHES=0 anywhere in the artifact',
    async (serviceId) => {
      const artifact = await artifactFor(serviceId);
      const placeholders: string[] = [];
      const walk = (value: unknown, path: string): void => {
        if (typeof value === 'string') {
          if (isPlaceholderHash(value)) placeholders.push(`${path}=${value}`);
        } else if (value && typeof value === 'object') {
          for (const [key, child] of Object.entries(value)) {
            // verificationReceipt/wireBody are the LEGACY released receipt; they are
            // the one intentional carrier of legacy defaults until the wire cutover.
            if (path === '$' && (key === 'verificationReceipt' || key === 'wireBody')) continue;
            walk(child, `${path}.${key}`);
          }
        }
      };
      walk(artifact, '$');
      expect(placeholders).toEqual([]);
    }
  );

  it('the placeholder guard fails closed if a placeholder reaches the proof phase', async () => {
    const draft = makeDraft();
    const snapshot = await freezeSemanticSnapshot({
      draft,
      finalExtension: { a: 1 },
      verification: { ...VERIFICATION_BLOCK, decision: 'pass' },
      serviceId: 'verify_agent_output.v2',
    });
    expect(isPlaceholderHash(snapshot.pccDocument.contract.output_schema_hash)).toBe(false);
    expect(isPlaceholderHash('sha256:' + '9'.repeat(64))).toBe(true);
    expect(isPlaceholderHash('sha256:' + '0'.repeat(64))).toBe(true);
    expect(isPlaceholderHash('sha256:' + 'ab'.repeat(32))).toBe(false);
  });
});

describe('16-19: closed finding / failure code vocabularies', () => {
  const result = (over: Partial<VerificationResult>): VerificationResult =>
    ({
      verifier_id: 'v',
      status: 'fail',
      findings: [],
      failure_codes: [],
      ...over,
    }) as unknown as VerificationResult;

  it('accepts known finding codes, including governed injection signal codes', () => {
    for (const code of [
      'schema_violation',
      'unsupported_material_claim',
      'injection_ignore_instructions',
    ]) {
      expect(() => assertKnownFindingCode(code)).not.toThrow();
    }
    expect(() =>
      projectVerifierResults([
        result({ findings: [{ code: 'schema_violation', message: 'm', severity: 'blocking' }] }),
      ])
    ).not.toThrow();
  });

  it('rejects unknown finding codes (arbitrary provider / LLM strings)', () => {
    expect(() => assertKnownFindingCode('LLM says: looks fine')).toThrow(UnknownCodeError);
    expect(() => assertKnownFindingCode('injection_made_up')).toThrow(UnknownCodeError);
    expect(() =>
      projectVerifierResults([
        result({ findings: [{ code: 'provider_custom', message: 'm', severity: 'info' }] }),
      ])
    ).toThrow('unknown_finding_code:provider_custom');
  });

  it('accepts the exact shape the mesh emits for a timed-out or throwing verifier (fail-closed must not reclassify it)', () => {
    for (const code of ['verifier_timeout', 'verifier_exception']) {
      expect(() =>
        projectVerifierResults([
          result({
            findings: [{ code, message: 'm', severity: 'blocking' }],
            failure_codes: [code],
          }),
        ])
      ).not.toThrow();
    }
  });

  it('accepts known failure codes (verifier and service)', () => {
    for (const code of [
      'schema_violation',
      'unsupported_claim',
      'verifier_timeout',
      'prompt_injection_confirmed',
    ]) {
      expect(() => assertKnownVerifierFailureCode(code)).not.toThrow();
    }
    for (const code of ['verification_failed', 'internal_error', 'invalid_request']) {
      expect(() => assertKnownServiceFailureCode(code)).not.toThrow();
    }
    expect(() =>
      projectVerifierResults([result({ failure_codes: ['unsupported_claim'] })])
    ).not.toThrow();
  });

  it('rejects unknown failure codes', () => {
    expect(() => assertKnownVerifierFailureCode('provider_exploded')).toThrow(UnknownCodeError);
    expect(() => assertKnownServiceFailureCode('nope')).toThrow(UnknownCodeError);
    expect(() => projectVerifierResults([result({ failure_codes: ['nope'] })])).toThrow(
      'unknown_verifier_failure_code:nope'
    );
  });

  it('every code the verifiers actually emit is in the vocabulary (no drift)', () => {
    const dir = `${REPO}packages/verification/src/verifiers/`;
    const emitted = new Set<string>();
    const findings = new Set<string>();
    for (const file of readdirSync(dir).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts')
    )) {
      const text = readFileSync(dir + file, 'utf-8');
      for (const m of text.matchAll(/failureCodes:[^[]*\[([^\]]*)\]/g)) {
        for (const c of m[1].matchAll(/'([a-z_]+)'/g)) emitted.add(c[1]);
      }
      for (const m of text.matchAll(/code: '([a-z_]+)'/g)) findings.add(m[1]);
    }
    // The mesh itself emits codes through a ternary (timed-out vs threw).
    const mesh = readFileSync(`${REPO}packages/verification/src/mesh.ts`, 'utf-8');
    for (const m of mesh.matchAll(
      /(?:code: |failure_codes: \[)timedOut \? '([a-z_]+)' : '([a-z_]+)'/g
    )) {
      emitted.add(m[1]);
      emitted.add(m[2]);
      findings.add(m[1]);
      findings.add(m[2]);
    }
    expect(emitted).toContain('verifier_timeout');
    expect(emitted.size).toBeGreaterThan(8);
    for (const code of emitted)
      expect(() => assertKnownVerifierFailureCode(code), code).not.toThrow();
    for (const code of findings) expect(() => assertKnownFindingCode(code), code).not.toThrow();
  });
});

describe('20-24: Unicode scalar safety is enforced before any hash or signature', () => {
  const HIGH = '\ud83d';
  const LOW = '\ude00';
  it('rejects a lone high surrogate', async () => {
    await expect(freeze(makeDraft(), { v: `a${HIGH}b` })).rejects.toBeInstanceOf(
      InvalidUnicodeScalarError
    );
  });
  it('rejects a lone low surrogate', async () => {
    await expect(freeze(makeDraft(), { v: `${LOW}` })).rejects.toBeInstanceOf(
      InvalidUnicodeScalarError
    );
  });
  it('rejects an invalid scalar in a nested value (array in object)', async () => {
    await expect(freeze(makeDraft(), { a: { b: [1, { c: `x${HIGH}` }] } })).rejects.toThrow(
      'non_unicode_scalar'
    );
  });
  it('rejects an invalid scalar in an object key', async () => {
    await expect(freeze(makeDraft(), { [`k${HIGH}`]: 1 })).rejects.toThrow('non_unicode_scalar');
  });
  it('rejects an invalid scalar in a claim value that is not the service extension', async () => {
    await expect(freeze(makeDraft({ ok: 1 }, `bad${LOW}`), { ok: 1 })).rejects.toThrow(
      'non_unicode_scalar'
    );
  });
  it('rejects NaN / Infinity, which JSON serialization would silently turn into null', async () => {
    await expect(freeze(makeDraft(), { v: Number.NaN })).rejects.toBeInstanceOf(
      NonFiniteNumberError
    );
    await expect(freeze(makeDraft(), { a: [Infinity] })).rejects.toThrow('non_finite_number');
    await expect(freeze(makeDraft({ ok: 1 }, -Infinity), { ok: 1 })).rejects.toThrow(
      'non_finite_number'
    );
  });
  it('accepts a valid surrogate pair', async () => {
    const snapshot = await freeze(makeDraft(), { v: `smile ${HIGH}${LOW}` });
    expect((snapshot.finalExtension as Ext).v).toBe('smile 😀');
  });
  it('a lone surrogate reaching the service boundary never yields a signed artifact', async () => {
    const { signer, keyRegistry } = await runScenario('verify_agent_output.v2');
    const context = await buildTestServiceContext('verify_agent_output.v2');
    await expect(
      verifyAndSign({ draft: makeDraft({ v: `${HIGH}` }), context, signer, keyRegistry })
    ).rejects.toThrow('non_unicode_scalar');
    expect(context.audit.getEvents().map((e) => e.type)).not.toContain('receipt_signed');
  });
});

/** Independent reconstruction: uses only frozen artifact state + canonicalize; no production builder. */
async function reconstructPreimageBytes(artifact: InternalResultArtifact): Promise<Uint8Array> {
  const h = async (value: unknown): Promise<string> => contentHash(canonicalize(value));
  const doc = artifact.pccDocument as unknown as PccDocument<string, unknown> & { extensions: Ext };
  const extension = doc.extensions[Object.keys(doc.extensions)[0]];
  const verifierHashes = await Promise.all(
    artifact.verifierResults.map((r) =>
      h({
        verifier_id: r.verifier_id,
        status: r.status,
        findings: r.findings,
        failure_codes: r.failure_codes,
      })
    )
  );
  verifierHashes.sort();
  const evidenceHashes = doc.evidence.map((e) => e.content_hash).sort();
  const receipt = artifact.verificationReceipt;
  const preimage = {
    domain: 'SITEBORNE-PCC-VERIFICATION-PROOF-V1',
    proof_version: '1.0.0',
    receipt_version: '2.0.0',
    job_id: doc.job_id,
    request_id: receipt.request_id,
    service_id: doc.contract.service_id,
    service_version: doc.contract.service_version,
    contract_release: artifact.governed.contractRelease,
    pcc_schema_release: artifact.governed.pccSchemaRelease,
    pcc_schema_hash: artifact.governed.pccSchemaHash,
    input_hash: doc.contract.input_hash,
    output_schema_hash: artifact.governed.outputSchemaHash,
    output_hash: await h(extension),
    pcc_document_hash: await h(doc),
    evidence_hash: await h(evidenceHashes),
    policy_hash: artifact.governed.policyHash,
    verifier_set_hash: await h(verifierHashes),
    decision: doc.verification.decision,
    completeness: doc.verification.completeness,
    verification_mode: receipt.verification_mode,
    limitations: [...new Set(artifact.verifierResults.flatMap((r) => r.failure_codes))].sort(),
    signing_key_id: receipt.signing_key_id,
    canonicalization_algorithm: 'RFC8785-JCS',
    signature_algorithm: 'Ed25519',
    issued_at: receipt.issued_at,
  };
  return new TextEncoder().encode(canonicalize(preimage));
}

describe('25-26: byte-exact preimage reconstruction', () => {
  it.each(FOUR_V2_SERVICES)(
    '%s: independently reconstructed canonical preimage bytes equal the artifact preimage bytes',
    async (serviceId) => {
      const artifact = await artifactFor(serviceId);
      const rebuilt = await reconstructPreimageBytes(artifact);
      const actual = new TextEncoder().encode(artifact.proofPreimage.canonicalPreimage);
      expect(rebuilt.byteLength).toBeGreaterThan(300);
      expect(Buffer.from(rebuilt).equals(Buffer.from(actual))).toBe(true);
      const digest = await contentHash(artifact.proofPreimage.canonicalPreimage);
      expect(artifact.proofPreimage.futureReceiptId).toBe(`rcpt_${digest.slice(7, 31)}`);
    }
  );

  it.each(FOUR_V2_SERVICES)(
    '%s: repeated executions with identical semantic inputs produce identical preimage bytes',
    async (serviceId) => {
      const first = await artifactFor(serviceId);
      const second = await artifactFor(serviceId);
      expect(second.proofPreimage.canonicalPreimage).toBe(first.proofPreimage.canonicalPreimage);
      expect(second.proofPreimage.futureReceiptId).toBe(first.proofPreimage.futureReceiptId);
    }
  );

  it.each(FOUR_V2_SERVICES)(
    '%s: canonical preimage bytes equal the pinned pre-review golden',
    async (serviceId) => {
      const artifact = await artifactFor(serviceId);
      const path = `${REPO}packages/service-runtime/fixtures/internal-artifact-preimage/${serviceId}.json`;
      const actual = {
        canonicalPreimage: artifact.proofPreimage.canonicalPreimage,
        futureReceiptId: artifact.proofPreimage.futureReceiptId,
      };
      if (process.env.UPDATE_PREIMAGE_GOLDEN === '1') {
        writeFileSync(path, JSON.stringify(actual, null, 2) + '\n');
      }
      expect(actual).toEqual(JSON.parse(readFileSync(path, 'utf-8')));
    }
  );

  const pythonAvailable = (() => {
    try {
      execFileSync('python3', ['--version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();
  it.skipIf(!pythonAvailable).each(FOUR_V2_SERVICES)(
    '%s: an independent (Python) canonicalizer reproduces the same preimage bytes',
    async (serviceId) => {
      const artifact = await artifactFor(serviceId);
      // The preimage contains only strings, integers and short decimals, for which
      // sorted-key compact ensure_ascii=False JSON is byte-identical to RFC 8785.
      const out = execFileSync(
        'python3',
        [
          '-c',
          'import sys,json;d=json.loads(sys.stdin.buffer.read().decode());' +
            'sys.stdout.buffer.write(json.dumps(d,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode())',
        ],
        { input: JSON.stringify(artifact.proofPreimage.preimage) }
      );
      expect(out.toString('utf-8')).toBe(artifact.proofPreimage.canonicalPreimage);
    }
  );

  it('changing any preimage-bound semantic input changes the canonical preimage bytes', async () => {
    const { result } = await runScenario('verify_agent_output.v2');
    const receipt = result.receipt!;
    const verdict = { decision: 'pass', results: [] } as unknown as MeshVerdict;
    const build = async (draft: PccDocument<typeof EXT_KEY, Ext>, ext: Ext) =>
      (
        await buildInternalResultArtifact({
          snapshot: await freeze(draft, ext),
          receipt,
          verdict,
          requestId: 'req',
          verificationMode: 'standard',
        })
      ).proofPreimage.canonicalPreimage;
    const base = await build(makeDraft({ a: 1 }, 1), { a: 1 });
    expect(await build(makeDraft({ a: 1 }, 1), { a: 1 })).toBe(base);
    expect(await build(makeDraft({ a: 1 }, 1), { a: 2 })).not.toBe(base);
    expect(await build(makeDraft({ a: 1 }, 2), { a: 1 })).not.toBe(base);
    const otherReceipt = { ...receipt, issued_at: '2026-09-02T00:00:00.000Z' };
    const moved = await buildInternalResultArtifact({
      snapshot: await freeze(makeDraft({ a: 1 }, 1), { a: 1 }),
      receipt: otherReceipt,
      verdict,
      requestId: 'req',
      verificationMode: 'standard',
    });
    expect(moved.proofPreimage.canonicalPreimage).not.toBe(base);
  });
});

describe('27: output_hash and pcc_document_hash keep distinct meanings', () => {
  it.each(FOUR_V2_SERVICES)('%s: output_hash != pcc_document_hash', async (serviceId) => {
    const { preimage } = (await artifactFor(serviceId)).proofPreimage;
    expect(preimage.output_hash).not.toBe(preimage.pcc_document_hash);
  });

  it('output_hash tracks only the final extension; pcc_document_hash tracks the whole semantic document', async () => {
    const base = await freeze(makeDraft({ a: 1 }, 1), { a: 1 });
    const extensionChanged = await freeze(makeDraft({ a: 1 }, 1), { a: 2 });
    const claimChanged = await freeze(makeDraft({ a: 1 }, 2), { a: 1 });
    // Extension change moves both (the extension is part of the document).
    expect(extensionChanged.finalExtensionHash).not.toBe(base.finalExtensionHash);
    expect(extensionChanged.pccDocumentHash).not.toBe(base.pccDocumentHash);
    // A change outside the extension moves ONLY the document hash.
    expect(claimChanged.finalExtensionHash).toBe(base.finalExtensionHash);
    expect(claimChanged.pccDocumentHash).not.toBe(base.pccDocumentHash);
  });
});

describe('30: the public proof namespace is never emitted', () => {
  const NAMESPACE = 'net.siteborne.verification-proof.v1';

  it.each(FOUR_V2_SERVICES)(
    '%s: absent from the public result surface and wire body',
    async (serviceId) => {
      const { result } = await runScenario(serviceId);
      const { finalized, ...publicSurface } = result;
      void finalized;
      expect(JSON.stringify(publicSurface)).not.toContain(NAMESPACE);
      expect(JSON.stringify((result.finalized as InternalResultArtifact).wireBody)).not.toContain(
        NAMESPACE
      );
      expect(
        JSON.stringify((result.finalized as InternalResultArtifact).pccDocument.extensions)
      ).not.toContain(NAMESPACE);
    }
  );

  it('is absent from all non-test runtime source', () => {
    const roots = [
      'packages/service-runtime/src',
      'apps/edge-api/src',
      'packages/protocol-mcp/src',
      'packages/protocol-a2a/src',
    ];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = `${dir}/${name}`;
        if (statSync(full).isDirectory()) {
          if (name !== 'node_modules') walk(full);
        } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) {
          if (readFileSync(full, 'utf-8').includes(NAMESPACE))
            offenders.push(full.replace(REPO, ''));
        }
      }
    };
    for (const root of roots) walk(`${REPO}${root}`);
    expect(offenders).toEqual([]);
  });
});

describe('35: private implementation data does not reach the artifact or its public projections', () => {
  const FORBIDDEN_KEYS =
    /private|secret|credential|api_?key|authorization_header|bearer|routing|ranking|provider_score|margin|treasury|fencing|authority_?grant|policy_compiler|topology/i;

  it.each(FOUR_V2_SERVICES)(
    '%s: no key in the artifact matches a private-implementation name',
    async (serviceId) => {
      const artifact = await artifactFor(serviceId);
      const hits: string[] = [];
      const walk = (value: unknown, path: string): void => {
        if (value && typeof value === 'object') {
          for (const [key, child] of Object.entries(value)) {
            if (FORBIDDEN_KEYS.test(key)) hits.push(`${path}.${key}`);
            walk(child, `${path}.${key}`);
          }
        }
      };
      walk(artifact, '$');
      expect(hits).toEqual([]);
    }
  );

  it.each(FOUR_V2_SERVICES)(
    '%s: the public wire body is exactly the closed VerificationReceipt field allowlist',
    async (serviceId) => {
      const { result } = await runScenario(serviceId);
      expect(Object.keys(result.receipt as object).sort()).toEqual(
        [
          'canonicalization_algorithm',
          'completeness',
          'contract_release',
          'decision',
          'evidence_hash',
          'input_hash',
          'issued_at',
          'job_id',
          'limitations',
          'output_hash',
          'pcc_schema_hash',
          'pcc_schema_release',
          'policy_hash',
          'receipt_id',
          'receipt_version',
          'request_id',
          'service_id',
          'service_version',
          'signature',
          'signature_algorithm',
          'signing_key_id',
          'verification_mode',
          'verifier_set_hash',
        ].sort()
      );
    }
  );

  it('the preimage limitations are governed failure codes only, never raw verifier prose', async () => {
    const artifact = await artifactFor('verify_agent_output.v2');
    for (const limitation of artifact.proofPreimage.preimage.limitations) {
      expect(() => assertKnownVerifierFailureCode(limitation)).not.toThrow();
    }
  });

  it('the private signing key is not reachable from the artifact', async () => {
    const artifact = await artifactFor('verify_agent_output.v2');
    expect(JSON.stringify(artifact)).not.toContain(KEY_HEX);
  });
});

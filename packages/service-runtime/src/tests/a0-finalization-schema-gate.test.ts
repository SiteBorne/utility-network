/**
 * R3-A0-FINALIZATION-GATE-AND-PROVENANCE-03 — A0 finalization schema gate.
 *
 * BACKGROUND: verifyAndSign() (packages/service-runtime/src/pcc/
 * verify-and-sign.ts) previously computed `schemaValidAfterFinalization`
 * AFTER issuing the cryptographic receipt and building the
 * InternalResultArtifact, but never used that boolean to gate anything --
 * a schema-invalid finalized result could still be signed and delivered.
 * Fixed: `schemaValidAfterFinalization` (when a schema is actually
 * registered for the service) now gates delivery -- see the
 * `schemaGateFailed` branch in verify-and-sign.ts.
 *
 * INJECTION BOUNDARY: `finalizeSemantics`, a first-class parameter of
 * verifyAndSign(), is the exact trust boundary the mesh's mandatory
 * SchemaVerifier CANNOT see: SchemaVerifier (packages/verification/src/
 * verifiers/schema-verifier.ts) validates `candidate.output = draft` -- the
 * PRE-finalization draft -- before finalizeSemantics ever runs. Every real
 * service (agent-verification/service.ts) supplies a finalizeSemantics that
 * computes verdict-dependent fields (outcome/score) from application logic;
 * a bug in that application logic (e.g. an off-by-something score
 * computation) is exactly the kind of malformed-at-the-real-boundary data
 * this test injects -- no `as any` cast is used anywhere in this file.
 *
 * ENFORCED (invariant) behavior: a draft that is schema-valid pre-finalization
 * but whose finalizeSemantics output is schema-invalid post-finalization must
 * NOT be signed-and-delivered as an accepted result. Proven below against the
 * real signed wire body (.v3/vnext path); the .v2 legacy-path test documents
 * a separate, narrower finding (see its own comment) rather than re-proving
 * the same invariant.
 */
import { describe, expect, it } from 'vitest';
import type { MeshVerdict } from '@siteborne/verification';
import { buildDraftDocument, defaultProvenance, verifyAndSign } from '../pcc';
import { createFixtureSigner } from '../pcc/test-signer';
import { buildTestServiceContext } from './support';

const EXT_KEY = 'net.siteborne.agent-verification.v1' as const;
type Ext = Record<string, unknown>;

function makeValidPreFinalizationDraft() {
  // A schema-valid draft extension: `outcome`/`score` are present with
  // placeholder-but-valid values, exactly as agent-verification/service.ts
  // builds its draft before finalizeSemantics runs.
  return buildDraftDocument({
    seed: 'a0-schema-gate-test',
    serviceId: 'verify_agent_output.v2',
    serviceVersion: 'v2',
    inputHash: 'sha256:' + 'a1'.repeat(32),
    inputSchemaHash: 'sha256:' + '1'.repeat(64),
    outputSchemaHash: 'sha256:' + '2'.repeat(64),
    contractMode: 'offline_verification',
    freshnessSeconds: 3600,
    issuedAtIso: '2026-09-01T12:00:00.000Z',
    expiresAtIso: '2026-09-01T13:00:00.000Z',
    subject: { type: 'other', canonical_name: 'candidate:a0-schema-gate' },
    claims: [],
    evidence: [],
    completeness: {
      requested_fields: 0,
      populated_fields: 0,
      supported_fields: 0,
      score: 1,
      missing_fields: [],
      unsupported_fields: [],
      stale_fields: [],
      vector: [],
    },
    provenance: defaultProvenance('test', '0.0.0'),
    extensionKey: EXT_KEY,
    // Placeholder outcome/score: valid per the output schema (enum member,
    // 0..1 range) so the mesh's mandatory SchemaVerifier passes.
    extensionPayload: { outcome: 'pass', score: 1 } as Ext,
  });
}

describe('A0 finalization schema gate', () => {
  it('mesh SchemaVerifier validates the PRE-finalization draft, not the post-finalization extension', async () => {
    // Establishes the injection boundary claim: the mesh verdict is
    // computed before finalizeSemantics runs, so it cannot see whatever
    // finalizeSemantics produces.
    const { signer, registry: keyRegistry } = await createFixtureSigner();
    const context = await buildTestServiceContext('verify_agent_output.v2');
    const draft = makeValidPreFinalizationDraft();

    let verdictSeenByHook: MeshVerdict | undefined;
    await verifyAndSign({
      draft,
      context,
      signer,
      keyRegistry,
      finalizeSemantics: (verdict) => {
        verdictSeenByHook = verdict;
        return draft.extensions[EXT_KEY] as Ext;
      },
    });

    expect(verdictSeenByHook?.verification.schema_valid).toBe(true);
    expect(verdictSeenByHook?.decision).toBe('pass');
  });

  it('legacy .v2 path: schema check runs against the frozen `finalized` object, which re-spreads the PRE-finalization draft extension, not finalizeSemantics\'s return value', async () => {
    // Separate, narrower finding surfaced while fixing the A0 gate: for
    // legacy (non-vnext) services, `finalized.extensions` comes from
    // `{...draft}`, so it never observes whatever finalizeSemantics
    // computed. Corrupting ONLY finalizeSemantics's return value (as the
    // .v3 test below does) therefore cannot reproduce an invalid delivery
    // on this path -- the schema check below is validating the still-valid
    // draft payload (score: 1), so it correctly reports valid. This is
    // expected, verified behavior for this fixture, not a gap in the fix;
    // the actual invariant is proven against the real signed wire body by
    // the .v3 test below, which is the path every current real service
    // (agent-verification/service.ts) delivers over.
    const { signer, registry: keyRegistry } = await createFixtureSigner();
    const context = await buildTestServiceContext('verify_agent_output.v2');
    const draft = makeValidPreFinalizationDraft();

    const signed = await verifyAndSign({
      draft,
      context,
      signer,
      keyRegistry,
      finalizeSemantics: () => ({ outcome: 'pass', score: 7 }) as Ext,
    });

    expect(signed.schemaValidAfterFinalization).toBe(true);
    expect(signed.verdict.decision).toBe('pass');
  });

  it('v3 / vnext wire path: a schema-invalid finalized result must not be delivered as a valid signed result', async () => {
    // .v3 services take the artifactVersion===2 (vnext) path in
    // verify-and-sign.ts: `deliveredDocument = artifact.wireBody`, which is
    // built from `snapshot.pccDocument` (the REAL post-finalization
    // extension, unlike the legacy .v2 path's `finalized` object which
    // silently re-spreads the stale pre-finalization draft extension). This
    // proves the defect against the object that is actually cryptographically
    // signed and returned as `signed.document`, not merely against the
    // advisory `schemaValidAfterFinalization` flag.
    const { signer, registry: keyRegistry } = await createFixtureSigner();
    const context = await buildTestServiceContext('verify_agent_output.v3');
    const draft = buildDraftDocument({
      seed: 'a0-schema-gate-test-v3',
      serviceId: 'verify_agent_output.v3',
      serviceVersion: 'v3',
      inputHash: 'sha256:' + 'a1'.repeat(32),
      inputSchemaHash: 'sha256:' + '1'.repeat(64),
      outputSchemaHash: 'sha256:' + '2'.repeat(64),
      contractMode: 'offline_verification',
      freshnessSeconds: 3600,
      issuedAtIso: '2026-09-01T12:00:00.000Z',
      expiresAtIso: '2026-09-01T13:00:00.000Z',
      subject: { type: 'other', canonical_name: 'candidate:a0-schema-gate-v3' },
      claims: [],
      evidence: [],
      completeness: {
        requested_fields: 0,
        populated_fields: 0,
        supported_fields: 0,
        score: 1,
        missing_fields: [],
        unsupported_fields: [],
        stale_fields: [],
        vector: [],
      },
      provenance: defaultProvenance('test', '0.0.0'),
      extensionKey: EXT_KEY,
      extensionPayload: { outcome: 'pass', score: 1 } as Ext,
    });

    const signed = await verifyAndSign({
      draft,
      context,
      signer,
      keyRegistry,
      finalizeSemantics: () => ({ outcome: 'pass', score: 7 }) as Ext,
    });

    // Ground truth: schema check (run on the real signed wireBody for v3)
    // correctly flags the invalidity.
    expect(signed.schemaValidAfterFinalization).toBe(false);
    expect(signed.schemaErrors.length).toBeGreaterThan(0);

    // REQUIRED (A0 invariant, now enforced): an artifact whose delivered
    // wireBody is schema-invalid must not be handed back as a usable,
    // self-verifying signed artifact.
    expect(signed.artifact).toBeUndefined();

    // REQUIRED: the schema-invalid value must not surface in the delivered
    // document dressed up as an accepted result -- the caller falls back to
    // the pre-finalization-shaped `finalized` document with the decision
    // forced to 'fail', not the invalid score:7 wireBody.
    expect((signed.document.extensions[EXT_KEY] as Ext).score).not.toBe(7);
    expect(signed.document.verification.decision).toBe('fail');
    expect(signed.document.verification.deterministic_failures).toEqual(
      expect.arrayContaining([expect.stringContaining('final_schema_validation_failed')])
    );
  });
});

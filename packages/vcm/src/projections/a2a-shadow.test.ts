/**
 * A2A shadow projection parity (METADATA-VCM-IMPL-03B §V-§VIII).
 * `A2A_EXISTING_PROJECTION_ENTRYPOINT` =
 * `packages/protocol-a2a/src/card.ts#buildUnsignedSiteborneAgentCard` -- a
 * pure function returning `AgentCard` directly, already unsigned (signing is
 * a separate boundary in `signing.ts`), so no wrapper/export change to
 * protocol-a2a was needed to compare against it.
 */
import { BAZAAR_PAYMENT_POLICY, resolveServiceRoute } from '@siteborne/protocol-x402';
import {
  A2A_PROTOCOL_VERSION,
  buildUnsignedSiteborneAgentCard,
  SITEBORNE_A2A_INTERFACE_URL,
  SITEBORNE_A2A_ORIGIN,
  SITEBORNE_MTLS_SECURITY_SCHEME_DESCRIPTION,
  SITEBORNE_MTLS_SECURITY_SCHEME_KEY,
  SITEBORNE_SERVICE_IDS,
  SITEBORNE_X402_EXTENSION_URI,
} from '@siteborne/protocol-a2a';
import type { SiteborneServiceId } from '@siteborne/protocol-x402';
import { describe, expect, it } from 'vitest';
import { compareProjections, summarizeDifferences, unexplainedDifferences } from '../comparator';
import { project } from '../effective-view';
import { emptyOverlay } from '../runtime-overlay';
import { makeFixtureModel, makeFixtureService } from '../test-fixtures';
import type { CanonicalServiceIdValue } from '../service-id';
import { projectA2aFromVcm } from './a2a-shadow';
import type { A2aProjectionContext } from './types';

const GENERATED_AT = '2026-09-18T00:00:00.000Z' as never;

// AGENT_CARD_LITERALS mirrors the literal values card.ts hardcodes inline
// (name/description/version/documentationUrl/provider/capability flags).
// The real builder has no other authority for these either -- they are not
// derived from registry, governance, or any typed export -- so copying them
// verbatim here is faithful, not independently authored, exactly like the
// real system's own treatment of them.
const AGENT_CARD_LITERALS = {
  agentName: 'SITEBORNE Utility Network',
  agentDescription:
    'Four bounded evidence, context, document, and verification services with PCC receipts and x402 payment enforcement.',
  agentVersion: '1.0.0',
  documentationUrl: 'https://siteborne.net/docs/a2a',
  provider: { organization: 'SITEBORNE', url: 'https://siteborne.com' },
};

function realContext(
  effectiveProductionStatusByServiceId: Partial<Record<SiteborneServiceId, boolean>> = {},
  mtlsProductionActive = false
): A2aProjectionContext {
  return {
    ...AGENT_CARD_LITERALS,
    interfaceUrl: SITEBORNE_A2A_INTERFACE_URL,
    protocolVersion: A2A_PROTOCOL_VERSION,
    x402ExtensionUri: SITEBORNE_X402_EXTENSION_URI,
    x402Version: 2,
    resourceOrigin: SITEBORNE_A2A_ORIGIN,
    serviceOrder: SITEBORNE_SERVICE_IDS as readonly CanonicalServiceIdValue[],
    resourcePath: (serviceId) => resolveServiceRoute(serviceId as SiteborneServiceId).path,
    scheme: (serviceId) => BAZAAR_PAYMENT_POLICY[serviceId as SiteborneServiceId].scheme,
    effectiveProductionStatusByServiceId: effectiveProductionStatusByServiceId as Readonly<
      Partial<Record<CanonicalServiceIdValue, boolean>>
    >,
    mtlsSecurityScheme: mtlsProductionActive
      ? {
          key: SITEBORNE_MTLS_SECURITY_SCHEME_KEY,
          description: SITEBORNE_MTLS_SECURITY_SCHEME_DESCRIPTION,
        }
      : null,
  };
}

/** Builds a VCM effective view carrying real registry facts (title,
 * description, capabilities, declared limitations, contract refs) for all
 * eight real service ids, via the real legacy importer fixtures already
 * proven in METADATA-VCM-IMPL-01/02 registry-parity tests -- not
 * hand-typed duplicate literals that could silently drift from the
 * registry. */
async function realEightServiceEffectiveView() {
  const { legacyRegistryToVCM } = await import('../legacy/import-registry');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const registryDir = path.resolve(__dirname, '../../../../registry/services');
  const files = fs
    .readdirSync(registryDir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const legacyFiles = files.map((file) =>
    JSON.parse(fs.readFileSync(path.join(registryDir, file), 'utf8'))
  );
  const model = await legacyRegistryToVCM(legacyFiles, {
    vcmSchemaVersion: '0.3.0',
    vcmReleaseVersion: '0.1.0',
    runtimeSourceCommit: 'a'.repeat(40),
    compiledAt: GENERATED_AT,
  });
  const overlay = emptyOverlay(GENERATED_AT);
  return project(model, overlay, { generatedAt: GENERATED_AT });
}

describe('projectA2aFromVcm -- RED: module must exist', () => {
  it('is a function', () => {
    expect(typeof projectA2aFromVcm).toBe('function');
  });
});

describe('projectA2aFromVcm -- unit shape', () => {
  it('produces exactly one skill per service, in the declared serviceOrder', async () => {
    const svcA = makeFixtureService({ id: { family: 'company_evidence_graph', generation: 'v2' } });
    const svcB = makeFixtureService({ id: { family: 'web_context_verified', generation: 'v2' } });
    const model = makeFixtureModel([svcA, svcB]);
    const view = await project(model, emptyOverlay(GENERATED_AT), { generatedAt: GENERATED_AT });
    const context: A2aProjectionContext = {
      ...realContext(),
      serviceOrder: ['web_context_verified.v2', 'company_evidence_graph.v2'],
    };
    const card = projectA2aFromVcm(view, context);
    expect(card.skills.map((s) => s.id)).toEqual([
      'web_context_verified.v2',
      'company_evidence_graph.v2',
    ]);
  });

  it('never emits a stronger security claim than the effective view supports (mTLS off by default)', async () => {
    const model = makeFixtureModel();
    const view = await project(model, emptyOverlay(GENERATED_AT), { generatedAt: GENERATED_AT });
    const card = projectA2aFromVcm(view, realContext());
    expect(card.securitySchemes).toEqual({});
  });

  it('declares the mTLS scheme only when the context explicitly supplies it', async () => {
    const model = makeFixtureModel();
    const view = await project(model, emptyOverlay(GENERATED_AT), { generatedAt: GENERATED_AT });
    const card = projectA2aFromVcm(view, realContext({}, true));
    expect(card.securitySchemes.mtls).toBeDefined();
  });

  it('root securityRequirements is always empty (x402 is the sole economic gate, per ADR)', async () => {
    const model = makeFixtureModel();
    const view = await project(model, emptyOverlay(GENERATED_AT), { generatedAt: GENERATED_AT });
    const card = projectA2aFromVcm(view, realContext());
    expect(card.securityRequirements).toEqual([]);
  });
});

describe('projectA2aFromVcm -- real-data parity against buildUnsignedSiteborneAgentCard()', () => {
  it('reproduces the real Agent Card content with zero unexplained differences', async () => {
    const effective = await realEightServiceEffectiveView();
    const existing = buildUnsignedSiteborneAgentCard();
    const shadow = projectA2aFromVcm(effective, realContext());

    const differences = compareProjections(existing, shadow, {
      governedDifferences: [
        {
          // signatures[] is always [] pre-signing on both sides; nothing to
          // classify here in practice, kept for completeness/documentation.
          pathPattern: /^signatures/,
          classification: 'INTENTIONAL_GOVERNED_DIFFERENCE',
          reason: 'Signing is a separate boundary; both sides are pre-signature.',
        },
      ],
    });
    const unexplained = unexplainedDifferences(differences);
    if (unexplained.length > 0) {
      console.error('A2A_UNEXPLAINED_DIFFERENCES', JSON.stringify(unexplained, null, 2));
    }
    expect(unexplained).toEqual([]);
    expect(existing.skills).toHaveLength(8);
    expect(shadow.skills).toHaveLength(8);

    const summary = summarizeDifferences(differences);
    expect(summary.UNEXPLAINED_DIFFERENCE).toBe(0);
  });
});

describe('projectA2aFromVcm -- adversarial mutation detection', () => {
  async function baseline() {
    const effective = await realEightServiceEffectiveView();
    const existing = buildUnsignedSiteborneAgentCard();
    const shadow = projectA2aFromVcm(effective, realContext());
    return { existing, shadow };
  }

  it('detects a missing skill', async () => {
    const { existing, shadow } = await baseline();
    const mutated = { ...shadow, skills: shadow.skills.slice(1) };
    const diff = unexplainedDifferences(compareProjections(existing, mutated));
    expect(diff.length).toBeGreaterThan(0);
  });

  it('detects an extra skill', async () => {
    const { existing, shadow } = await baseline();
    const mutated = { ...shadow, skills: [...shadow.skills, shadow.skills[0]] };
    const diff = unexplainedDifferences(compareProjections(existing, mutated));
    expect(diff.length).toBeGreaterThan(0);
  });

  it('detects a changed service id', async () => {
    const { existing, shadow } = await baseline();
    const mutated = {
      ...shadow,
      skills: shadow.skills.map((s, i) => (i === 0 ? { ...s, id: 'mutated_id' } : s)),
    };
    const diff = unexplainedDifferences(compareProjections(existing, mutated));
    expect(diff.some((d) => d.path === 'skills[0].id')).toBe(true);
  });

  it('detects a changed description', async () => {
    const { existing, shadow } = await baseline();
    const mutated = {
      ...shadow,
      skills: shadow.skills.map((s, i) => (i === 0 ? { ...s, description: 'mutated' } : s)),
    };
    const diff = unexplainedDifferences(compareProjections(existing, mutated));
    expect(diff.some((d) => d.path === 'skills[0].description')).toBe(true);
  });

  it('detects a changed tag', async () => {
    const { existing, shadow } = await baseline();
    const mutated = {
      ...shadow,
      skills: shadow.skills.map((s, i) =>
        i === 0 ? { ...s, tags: [...s.tags, 'mutated_tag'] } : s
      ),
    };
    const diff = unexplainedDifferences(compareProjections(existing, mutated));
    expect(diff.length).toBeGreaterThan(0);
  });

  it('detects a stronger, unsupported security claim (mtls advertised without context authorization)', async () => {
    const { existing, shadow } = await baseline();
    const mutated = { ...shadow, securitySchemes: { mtls: { fabricated: true } } };
    const diff = unexplainedDifferences(compareProjections(existing, mutated));
    expect(diff.length).toBeGreaterThan(0);
  });
});

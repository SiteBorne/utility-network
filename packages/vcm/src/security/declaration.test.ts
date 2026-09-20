import { describe, expect, it } from 'vitest';
import { ECONOMIC_SERVICE_IDS, buildEconomicOffer } from '@siteborne/pricing';
import { buildSecurityDeclarationV1 } from './declaration';
import { projectPublicSecurityDeclaration, SecurityDeclarationError } from './project';
import { scanForPrivateLeaks, validateSecurityDeclaration } from './validate';
import { EVIDENCE_CLASSES, IMPLEMENTATION_STATUSES } from './vocabulary';

const decl = buildSecurityDeclarationV1();
const binding = (id: string) => {
  const b = decl.capabilitySecurityBindings.find((x) => x.id === id);
  if (!b) throw new Error(`no binding ${id}`);
  return b;
};

describe('canonical security declaration v1', () => {
  it('is valid, versioned, and deterministic', () => {
    expect(validateSecurityDeclaration(decl)).toEqual([]);
    expect(decl.schemaVersion).toBe('security_declaration.v1');
    expect(JSON.stringify(buildSecurityDeclarationV1())).toBe(JSON.stringify(decl));
    expect(decl.compatibility.bindsToDeploymentVersion).toBe(false);
    expect(decl.truthLevelCeiling).toBe('CONFIGURED');
  });

  it('uses exactly the four-value status vocabulary', () => {
    expect(decl.implementationStatus.vocabulary).toEqual([...IMPLEMENTATION_STATUSES]);
  });

  it('admits exactly the two governed first-release paid capabilities', () => {
    const purchasable = decl.capabilitySecurityBindings
      .filter((b) => b.purchasable)
      .map((b) => b.id);
    expect(purchasable.sort()).toEqual([
      'verify_agent_output.v2/standard',
      'web_context_verified.v2/direct',
    ]);
  });

  it('keeps every other capability and mode closed with no profile', () => {
    const closedIds = [
      'web_context_verified.v2/rendered',
      'verify_agent_output.v2/independent_reproduction',
      'company_evidence_graph.v2/standard',
      'document_evidence_json.v2/extraction',
      'verify_agent_output.v1/standard',
      'web_context_verified.v1/direct',
      'company_evidence_graph.v2/nevermined',
      'document_evidence_json.v2/nevermined',
      'web_context_verified.v2/nevermined',
      'verify_agent_output.v2/nevermined',
    ];
    for (const id of closedIds) {
      const b = binding(id);
      expect(b.available, id).toBe(false);
      expect(b.purchasable, id).toBe(false);
      expect(b.securityProfile, id).toBeNull();
      expect(b.implementationStatus, id).toBe('UNSUPPORTED');
    }
  });

  it('covers every governed service id and mode', () => {
    for (const serviceId of ECONOMIC_SERVICE_IDS) {
      for (const m of buildEconomicOffer(serviceId).modes) {
        expect(decl.capabilitySecurityBindings.some((b) => b.id === `${serviceId}/${m.mode}`)).toBe(
          true
        );
      }
    }
    expect(decl.capabilitySecurityBindings.some((b) => b.id === 'mcp:siteborne_get_quote')).toBe(
      true
    );
    expect(
      decl.capabilitySecurityBindings.some((b) => b.id === 'mcp:siteborne_get_service_health')
    ).toBe(true);
  });

  it('separates the three effect axes for paid evidence services', () => {
    for (const id of ['verify_agent_output.v2/standard', 'web_context_verified.v2/direct']) {
      const b = binding(id);
      expect(b.executionEffect).toBe('read_only');
      expect(b.economicEffects).toEqual(['authorize', 'settle']);
      expect(b.settlementReversibility).toBe('irreversible');
      expect(b.informationEffect.dataFlow).not.toBe('none');
    }
    expect(binding('web_context_verified.v2/direct').informationEffect.dataFlow).toBe(
      'outbound_public_web_retrieval'
    );
    expect(binding('verify_agent_output.v2/standard').informationEffect.dataFlow).toBe(
      'supplied_material_only_no_egress'
    );
  });

  it('never claims result retrieval that does not exist', () => {
    const get = (id: string) => decl.resultSecurity.find((s) => s.id === id)!;
    expect(get('caller_bound_retrieval').status).toBe('UNSUPPORTED');
    expect(get('public_result_retrieval').status).toBe('UNSUPPORTED');
    expect(get('caller_bound_retrieval').qualification).toBe('not_exercised');
  });

  it('never lets evidence imply identity or widen authority', () => {
    expect(decl.evidenceSemantics.map((e) => e.evidenceClass)).toEqual([...EVIDENCE_CLASSES]);
    for (const e of decl.evidenceSemantics) {
      expect(e.mayImplyIdentity).toBe(false);
      expect(e.mayWidenAuthority).toBe(false);
    }
    expect(decl.evidenceSemantics.find((e) => e.evidenceClass === 'IDENTITY_PROOF')!.status).toBe(
      'UNSUPPORTED'
    );
  });

  it('declares no unimplemented mechanism as enforced', () => {
    for (const n of decl.unsupportedSecurityFeatures) {
      expect(['UNSUPPORTED', 'DECLARED_FUTURE']).toContain(n.status);
    }
  });

  it('states no refund automation and no runtime self-check', () => {
    expect(decl.economicSecurity.find((s) => s.id === 'refund_reversal_automation')!.status).toBe(
      'UNSUPPORTED'
    );
    expect(
      decl.runtimeQualification.find((s) => s.id === 'runtime_self_check_absent')!.status
    ).toBe('UNSUPPORTED');
  });
});

describe('public projection', () => {
  const pub = projectPublicSecurityDeclaration(decl);

  it('exposes no private field or internal-looking value', () => {
    expect(scanForPrivateLeaks(pub)).toEqual([]);
    expect(JSON.stringify(pub)).not.toContain('privateEvidenceRef');
  });

  it('carries the canonical bindings one to one', () => {
    expect(pub.capabilitySecurityBindings.map((b) => b.id)).toEqual(
      decl.capabilitySecurityBindings.map((b) => b.id)
    );
  });

  it('is deterministic', () => {
    expect(JSON.stringify(projectPublicSecurityDeclaration(buildSecurityDeclarationV1()))).toBe(
      JSON.stringify(pub)
    );
  });

  it('refuses to project an unknown schema version', () => {
    expect(() =>
      projectPublicSecurityDeclaration({ ...decl, schemaVersion: 'security_declaration.v2' })
    ).toThrow(SecurityDeclarationError);
  });

  it('leaks nothing even if a private field is added to a canonical statement', () => {
    const tampered = {
      ...decl,
      policySemantics: decl.policySemantics.map((p, i) =>
        i === 0 ? ({ ...p, routingWeights: [0.3, 0.7], secretThreshold: 0.91 } as typeof p) : p
      ),
    };
    const out = JSON.stringify(projectPublicSecurityDeclaration(tampered));
    expect(out).not.toContain('routingWeights');
    expect(out).not.toContain('secretThreshold');
  });
});

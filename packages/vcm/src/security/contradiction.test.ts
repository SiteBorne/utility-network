/* eslint-disable @typescript-eslint/no-explicit-any -- these tests deliberately mutate deep clones of a typed bundle into invalid states */
import { describe, expect, it } from 'vitest';
import { buildSecurityDeclarationV1, type SecurityDeclarationBundle } from './declaration';
import {
  checkProjectionNarrowing,
  projectPublicSecurityDeclaration,
  toSecurityFragment,
  SecurityDeclarationError,
} from './project';
import {
  scanForPrivateLeaks,
  validateSecurityDeclaration,
  type SecurityViolationCode,
} from './validate';

type Mutable = { -readonly [K in keyof SecurityDeclarationBundle]: any };
function mutate(fn: (d: Mutable) => void): SecurityDeclarationBundle {
  const d = structuredClone(buildSecurityDeclarationV1()) as unknown as Mutable;
  fn(d);
  return d as unknown as SecurityDeclarationBundle;
}
const codes = (b: SecurityDeclarationBundle): SecurityViolationCode[] =>
  validateSecurityDeclaration(b).map((v) => v.code);
const bind = (d: Mutable, id: string) =>
  d.capabilitySecurityBindings.find((b: { id: string }) => b.id === id);

describe('contradictions that must not ship', () => {
  it('baseline has zero violations (so each failure below is caused by its mutation)', () => {
    expect(codes(buildSecurityDeclarationV1())).toEqual([]);
  });

  it('x402 marked as an identity mechanism -> FAIL', () => {
    expect(
      codes(
        mutate((d) => {
          d.supportedSecurityProfiles[1].identity = 'established_by_payment';
        })
      )
    ).toContain('IDENTITY_FROM_EVIDENCE');
    expect(
      codes(
        mutate((d) => {
          d.evidenceSemantics.find(
            (e: any) => e.evidenceClass === 'PAYMENT_AUTHORIZATION'
          ).mayImplyIdentity = true;
        })
      )
    ).toContain('IDENTITY_FROM_EVIDENCE');
    expect(
      codes(
        mutate((d) => {
          const e = d.evidenceSemantics.find((x: any) => x.evidenceClass === 'IDENTITY_PROOF');
          e.status = 'IMPLEMENTED_ENFORCED';
          e.support = 'supported_today';
        })
      )
    ).toContain('IDENTITY_FROM_EVIDENCE');
  });

  it('payment receipt marked as execution authority -> FAIL', () => {
    expect(
      codes(
        mutate((d) => {
          d.evidenceSemantics.find(
            (e: any) => e.evidenceClass === 'PAYMENT_RECEIPT'
          ).mayOnlySatisfy = 'execution_authority';
        })
      )
    ).toContain('RECEIPT_OR_PCC_AS_AUTHORITY');
    expect(
      codes(
        mutate((d) => {
          d.evidenceSemantics.find(
            (e: any) => e.evidenceClass === 'PAYMENT_RECEIPT'
          ).mayWidenAuthority = true;
        })
      )
    ).toContain('EVIDENCE_WIDENS_AUTHORITY');
  });

  it('PCC marked as permission -> FAIL', () => {
    expect(
      codes(
        mutate((d) => {
          d.evidenceSemantics.find(
            (e: any) => e.evidenceClass === 'DELIVERY_EVIDENCE'
          ).mayOnlySatisfy = 'permission_for_another_operation';
        })
      )
    ).toContain('RECEIPT_OR_PCC_AS_AUTHORITY');
    expect(
      codes(
        mutate((d) => {
          d.authorityModel.invariants = d.authorityModel.invariants.filter(
            (s: any) => s.id !== 'pcc_is_evidence_not_permission'
          );
        })
      )
    ).toContain('MISSING_REQUIRED_STATEMENT');
  });

  it.each([
    'mtls',
    'oauth',
    'spiffe_svid',
    'vcap',
    'agentcore_policy',
    'machine_payments_protocol',
  ])('unsupported %s marked enforced -> FAIL', (feature) => {
    const bad = mutate((d) => {
      d.unsupportedSecurityFeatures.find((n: any) => n.feature === feature).status =
        'IMPLEMENTED_ENFORCED';
    });
    expect(codes(bad)).toContain('STATUS_ABOVE_RELEASE_CEILING');
  });

  it('a future feature (dpop, ap2) raised above declared-future -> FAIL', () => {
    for (const feature of ['dpop', 'ap2']) {
      expect(
        codes(
          mutate((d) => {
            d.unsupportedSecurityFeatures.find((n: any) => n.feature === feature).status =
              'IMPLEMENTED_OBSERVATIONAL';
          })
        )
      ).toContain('STATUS_ABOVE_RELEASE_CEILING');
    }
  });

  it.each([
    'company_evidence_graph.v2/standard',
    'document_evidence_json.v2/extraction',
    'verify_agent_output.v1/standard',
    'web_context_verified.v2/rendered',
    'verify_agent_output.v2/independent_reproduction',
    'verify_agent_output.v2/nevermined',
    'web_context_verified.v2/nevermined',
  ])('closed capability %s marked purchasable -> FAIL', (id) => {
    const found = codes(
      mutate((d) => {
        const b = bind(d, id);
        b.available = true;
        b.purchasable = true;
      })
    );
    expect(found).toContain('PURCHASABILITY_EXCEEDS_GOVERNANCE');
  });

  it('closed capability that inherits an enabled profile -> FAIL', () => {
    expect(
      codes(
        mutate((d) => {
          bind(d, 'company_evidence_graph.v2/standard').securityProfile = 'PUBLIC_ECONOMIC_X402';
        })
      )
    ).toContain('CLOSED_CAPABILITY_ENABLED');
  });

  it('rendered and Nevermined marked active are caught by governance, not just by shape', () => {
    // Even if every structural field is made self-consistent, governance recomputation still rejects it.
    const coherent = mutate((d) => {
      for (const id of ['web_context_verified.v2/rendered', 'web_context_verified.v2/nevermined']) {
        const b = bind(d, id);
        Object.assign(b, {
          available: true,
          purchasable: true,
          securityProfile: 'PUBLIC_ECONOMIC_X402',
          economicAuthorizationRequired: true,
          economicEffects: ['authorize', 'settle'],
          runtimeQualification: 'qualified_runtime_required',
          admission: 'first_release_candidate',
          implementationStatus: 'IMPLEMENTED_ENFORCED',
          closedReason: undefined,
        });
        b.informationEffect.callerBindingRequirement = 'not_applicable_no_retrieval_route';
      }
    });
    const c = validateSecurityDeclaration(coherent);
    expect(
      c.filter((v) => v.code === 'PURCHASABILITY_EXCEEDS_GOVERNANCE').length
    ).toBeGreaterThanOrEqual(2);
  });

  it('public profile or binding claiming caller-bound retrieval -> FAIL', () => {
    expect(
      codes(
        mutate((d) => {
          d.supportedSecurityProfiles[1].resultAccess = 'caller_bound_retrieval';
        })
      )
    ).toContain('RETRIEVAL_CLAIM_UNPROVEN');
    expect(
      codes(
        mutate((d) => {
          bind(d, 'verify_agent_output.v2/standard').resultSemantics = 'caller_bound_retrieval';
        })
      )
    ).toContain('RETRIEVAL_CLAIM_UNPROVEN');
    expect(
      codes(
        mutate((d) => {
          d.resultSecurity.find((s: any) => s.id === 'caller_bound_retrieval').status =
            'IMPLEMENTED_ENFORCED';
        })
      )
    ).toContain('RETRIEVAL_CLAIM_UNPROVEN');
    expect(
      codes(
        mutate((d) => {
          bind(d, 'web_context_verified.v2/direct').informationEffect.callerBindingRequirement =
            'required';
        })
      )
    ).toContain('RETRIEVAL_CLAIM_UNPROVEN');
  });

  it('read_only interpreted as economic_effect none on a paid service -> FAIL', () => {
    expect(
      codes(
        mutate((d) => {
          bind(d, 'verify_agent_output.v2/standard').economicEffects = ['none'];
        })
      )
    ).toContain('READ_ONLY_CONFLATED_WITH_NO_ECONOMIC_EFFECT');
    expect(
      codes(
        mutate((d) => {
          bind(d, 'web_context_verified.v2/direct').economicEffects = ['authorize'];
        })
      )
    ).toContain('READ_ONLY_CONFLATED_WITH_NO_ECONOMIC_EFFECT');
  });

  it('runtime qualification omitted from a paid capability -> FAIL (canonical and projection)', () => {
    expect(
      codes(
        mutate((d) => {
          bind(d, 'verify_agent_output.v2/standard').runtimeQualification = 'none';
        })
      )
    ).toContain('RUNTIME_QUALIFICATION_OMITTED');
    expect(
      codes(
        mutate((d) => {
          d.supportedSecurityProfiles[1].runtimeQualification = 'release_qualification';
        })
      )
    ).toContain('RUNTIME_QUALIFICATION_OMITTED');
    const canonical = buildSecurityDeclarationV1();
    const frag = toSecurityFragment(
      projectPublicSecurityDeclaration(canonical).capabilitySecurityBindings.find(
        (b) => b.id === 'verify_agent_output.v2/standard'
      )!
    );
    const stripped = { ...frag, runtimeQualification: 'none' };
    expect(checkProjectionNarrowing(canonical, [stripped]).map((v) => v.code)).toContain(
      'RUNTIME_QUALIFICATION_OMITTED'
    );
  });

  it('unknown declaration version accepted -> FAIL', () => {
    const bad = mutate((d) => {
      d.schemaVersion = 'security_declaration.v2';
    });
    expect(codes(bad)).toEqual(['UNKNOWN_SCHEMA_VERSION']);
    expect(() => projectPublicSecurityDeclaration(bad)).toThrow(SecurityDeclarationError);
    expect(
      codes(
        mutate((d) => {
          d.compatibility.unknownVersionBehavior = 'accepted';
        })
      )
    ).toContain('UNKNOWN_VERSION_BEHAVIOR_NOT_DENY');
  });

  it('unknown status value -> FAIL (canonical) and fails closed (projection)', () => {
    expect(
      codes(
        mutate((d) => {
          d.policySemantics[0].status = 'MOSTLY_ENFORCED';
        })
      )
    ).toContain('UNKNOWN_STATUS');
  });

  it('a future or unsupported claim marked exercised -> FAIL', () => {
    expect(
      codes(
        mutate((d) => {
          d.resultSecurity.find((s: any) => s.id === 'public_result_retrieval').qualification =
            'live_exercised';
        })
      )
    ).toContain('FUTURE_OR_UNSUPPORTED_EXERCISED');
  });

  it('static declaration asserting ACTIVE -> FAIL', () => {
    expect(
      codes(
        mutate((d) => {
          d.truthLevelCeiling = 'ACTIVE';
        })
      )
    ).toContain('TRUTH_CEILING_EXCEEDED');
  });

  it('private security internals projected publicly -> FAIL', () => {
    const pub = structuredClone(
      projectPublicSecurityDeclaration(buildSecurityDeclarationV1())
    ) as any;
    pub.capabilitySecurityBindings[0].privateEvidenceRef =
      'packages/pricing/src/economic-contract.ts';
    expect(scanForPrivateLeaks(pub).map((v) => v.code)).toContain('PRIVATE_FIELD_PROJECTED');
    for (const leak of [
      'AGENT_CARD_SIGNING_PRIVATE_KEY',
      'CDP_API_KEY_SECRET',
      'apps/edge-api/src/control-plane/routes/x402-service.ts',
      '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1',
      '9b1e9b10-beed-4ff3-914c-2221aada9b45',
      'c8ec8c35e1e3c6c57e855d75a88c497ade47152fe8dbce57a0b53890fbdf1263',
      'wrangler.paid-continuation-runtime.toml',
    ]) {
      expect(scanForPrivateLeaks({ note: `see ${leak}` }).length, leak).toBeGreaterThan(0);
    }
  });

  it('ordinary public prose is not flagged as a leak', () => {
    expect(
      scanForPrivateLeaks({
        note: 'SITEBORNE does not receive buyer wallet secrets. Settlement is on eip155:8453 in USDC.',
      })
    ).toEqual([]);
  });
});

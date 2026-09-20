/* eslint-disable @typescript-eslint/no-explicit-any -- these tests deliberately mutate deep clones of a typed bundle into invalid states */
import { describe, expect, it } from 'vitest';
import { buildSecurityDeclarationV1, type SecurityDeclarationBundle } from './declaration';
import { SecurityDeclarationError } from './project';
import {
  SITEBORNE_SECURITY_DECLARATION_EXTENSION_URI,
  a2aSecurityExtension,
  buildSecurityPublication,
  catalogSecurityBlock,
  mcpSecurityMetaByToolName,
  openApiOperationSecurity,
} from './publication';
import { scanForPrivateLeaks } from './validate';

const publication = buildSecurityPublication();
const mutate = (fn: (d: any) => void): SecurityDeclarationBundle => {
  const d = structuredClone(buildSecurityDeclarationV1()) as any;
  fn(d);
  return d;
};
const binding = (d: any, id: string) => d.capabilitySecurityBindings.find((b: any) => b.id === id);

describe('publication is derived from, and never broader than, the canonical declaration', () => {
  it('builds from the canonical declaration and passes its own leak/narrowing checks', () => {
    expect(publication.fragments).toHaveLength(
      buildSecurityDeclarationV1().capabilitySecurityBindings.length
    );
    expect(scanForPrivateLeaks(publication.compact)).toEqual([]);
    expect(publication.ref.declarationVersion).toBe(
      buildSecurityDeclarationV1().declarationVersion
    );
  });

  it('refuses to publish a canonical declaration that has become contradictory', () => {
    expect(() =>
      buildSecurityPublication(
        mutate((d) => {
          d.supportedSecurityProfiles[1].identity = 'established_by_payment';
        })
      )
    ).toThrow(SecurityDeclarationError);
  });

  it('refuses to publish when a closed capability is made purchasable', () => {
    expect(() =>
      buildSecurityPublication(
        mutate((d) => {
          const b = binding(d, 'web_context_verified.v2/rendered');
          b.purchasable = true;
          b.available = true;
        })
      )
    ).toThrow(SecurityDeclarationError);
  });

  it('refuses to publish an unsupported mechanism marked enforced', () => {
    expect(() =>
      buildSecurityPublication(
        mutate((d) => {
          d.unsupportedSecurityFeatures.find((f: any) => f.feature === 'mtls').status =
            'IMPLEMENTED_ENFORCED';
        })
      )
    ).toThrow(SecurityDeclarationError);
  });

  it('never carries a private field into the published output (canonical private field injected)', () => {
    const d = mutate((x) => {
      binding(x, 'verify_agent_output.v2/standard').privateEvidenceRef = 'sealed-internal://x';
      binding(x, 'verify_agent_output.v2/standard').routingWeight = 0.7;
    });
    const p = buildSecurityPublication(d);
    const text = JSON.stringify([p.compact, p.fragments, p.ref]);
    expect(text).not.toContain('sealed-internal');
    expect(text).not.toContain('routingWeight');
  });

  it('per-surface fragments carry the truth-level ceiling beside the status', () => {
    for (const f of publication.fragments) expect(f.truthLevelCeiling).toBe('CONFIGURED');
  });
});

describe('surface helpers', () => {
  const tools = { siteborne_web_context_verified: 'web_context_verified.v2' };
  it('MCP: keys only by tool name, only net.siteborne/security* keys', () => {
    const map = mcpSecurityMetaByToolName(publication, tools, ['siteborne_get_quote']);
    expect(Object.keys(map).sort()).toEqual([
      'siteborne_get_quote',
      'siteborne_web_context_verified',
    ]);
    for (const meta of Object.values(map)) {
      for (const k of Object.keys(meta)) expect(k.startsWith('net.siteborne/security')).toBe(true);
    }
  });
  it('unknown ids produce no block (never an invented one)', () => {
    expect(catalogSecurityBlock(publication, 'nope.v9')).toBeNull();
    expect(openApiOperationSecurity(publication, 'nope.v9')).toBeNull();
    expect(mcpSecurityMetaByToolName(publication, { x: 'nope.v9' }, [])).toEqual({});
  });
  it('A2A: additive, not required, no auth scheme, URN identifier', () => {
    const ext = a2aSecurityExtension(publication);
    expect(ext.required).toBe(false);
    expect(ext.uri).toBe(SITEBORNE_SECURITY_DECLARATION_EXTENSION_URI);
    expect(ext.uri.startsWith('urn:')).toBe(true);
    expect(JSON.stringify(ext.params)).not.toMatch(/securitySchemes|securityRequirements/);
  });
  it('the Release-1 paid pair is the only purchasable set on every helper', () => {
    for (const id of ['web_context_verified.v2', 'verify_agent_output.v2']) {
      const block = catalogSecurityBlock(publication, id)!;
      expect((block.modes as any[]).some((m) => m.purchasable)).toBe(true);
    }
    const purchasable = publication.fragments.filter((f) => f.purchasable).map((f) => f.capability);
    expect(purchasable.sort()).toEqual(['verify_agent_output.v2', 'web_context_verified.v2']);
  });
});

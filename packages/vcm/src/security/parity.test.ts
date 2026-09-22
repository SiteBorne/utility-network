/* eslint-disable @typescript-eslint/no-explicit-any -- these tests deliberately mutate deep clones of a typed bundle into invalid states */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ECONOMIC_SERVICE_IDS } from '@siteborne/pricing';
import {
  V2_PAID_SERVICE_IDS,
  buildV2PaidOpenApiOperations,
  projectServiceEconomics,
} from '@siteborne/protocol-x402';
import type { SiteborneServiceId } from '@siteborne/protocol-x402';
import {
  MCP_SERVICE_TOOLS,
  MCP_TOOL_NAMES,
  buildSiteborneMcpDefinitionAuthorityInputs,
} from '@siteborne/protocol-mcp';
import { buildUnsignedSiteborneAgentCard } from '@siteborne/protocol-a2a';
import { getRuntimeEffectiveView } from '../runtime-model';
import { buildSecurityDeclarationV1 } from './declaration';
import {
  checkA2aParity,
  checkEconomicParity,
  checkMcpParity,
  checkModeGateParity,
  checkOpenApiModeEnums,
  checkOpenApiParity,
  checkVcmParity,
} from './parity';

const d = buildSecurityDeclarationV1();
const msgs = (v: readonly { path: string; message: string }[]) =>
  v.map((x) => `${x.path}: ${x.message}`);

describe('MCP parity', () => {
  const inputs = buildSiteborneMcpDefinitionAuthorityInputs();
  const tools = [...inputs.serviceTools, ...inputs.utilityTools];
  it('the live MCP tool definitions agree with the declaration', () => {
    expect(tools.length).toBe(MCP_TOOL_NAMES.length);
    expect(msgs(checkMcpParity(d, tools, MCP_SERVICE_TOOLS as Record<string, string>))).toEqual([]);
  });
  it('detects a paid tool annotated read-only', () => {
    const bad = tools.map((t) =>
      t.name in MCP_SERVICE_TOOLS
        ? { ...t, annotations: { ...t.annotations, readOnlyHint: true } }
        : t
    );
    expect(
      checkMcpParity(d, bad, MCP_SERVICE_TOOLS as Record<string, string>).length
    ).toBeGreaterThan(0);
  });
  it('detects an MCP _meta key implying authentication', () => {
    const bad = [{ ...tools[0]!, _meta: { 'net.siteborne/securityScheme': 'mtls' } }];
    expect(
      checkMcpParity(d, bad, MCP_SERVICE_TOOLS as Record<string, string>).length
    ).toBeGreaterThan(0);
  });
});

describe('A2A parity', () => {
  it('the default agent card declares no authentication and agrees with the declaration', () => {
    const card = buildUnsignedSiteborneAgentCard({}, false) as any;
    expect(Object.keys(card.securitySchemes ?? {})).toEqual([]);
    expect(msgs(checkA2aParity(d, card))).toEqual([]);
  });
  it('detects an agent card that declares mTLS while the declaration does not enforce it', () => {
    const card = buildUnsignedSiteborneAgentCard({}, true) as any;
    expect(Object.keys(card.securitySchemes ?? {}).length).toBeGreaterThan(0);
    expect(checkA2aParity(d, card).some((v) => /mutual TLS/.test(v.message))).toBe(true);
  });
});

describe('OpenAPI parity', () => {
  const doc = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          '../../../contracts/generated/openapi/service-contracts.openapi.json',
          import.meta.url
        )
      ),
      'utf8'
    )
  );
  it('the generated OpenAPI artifact agrees with the declaration', () => {
    expect(msgs(checkOpenApiParity(d, doc))).toEqual([]);
  });
  it('detects an invented authentication scheme', () => {
    const bad = {
      ...doc,
      components: { ...doc.components, securitySchemes: { oauth: { type: 'oauth2' } } },
    };
    expect(checkOpenApiParity(d, bad).length).toBeGreaterThan(0);
  });
  it('the live paid-operations builder offers only purchasable modes', () => {
    const ops = buildV2PaidOpenApiOperations({ destination: null, productionEnabled: {} });
    let checked = 0;
    for (const id of V2_PAID_SERVICE_IDS) {
      const prefix = id.split('.')[0]!.replace(/_/g, '');
      const key = Object.keys(ops.schemas).find(
        (k) => k.toLowerCase().startsWith(prefix) && k.endsWith('V2Input')
      );
      expect(key, id).toBeTruthy();
      expect(msgs(checkOpenApiModeEnums(d, id as never, ops.schemas[key!] as never))).toEqual([]);
      checked++;
    }
    expect(checked).toBe(V2_PAID_SERVICE_IDS.length);
  });
  it('detects an input schema that offers a closed mode', () => {
    const bad = { properties: { retrieval_mode: { enum: ['direct', 'rendered'] } } };
    expect(checkOpenApiModeEnums(d, 'web_context_verified.v2', bad).length).toBe(1);
    const bad2 = {
      properties: { verification_mode: { enum: ['standard', 'independent_reproduction'] } },
    };
    expect(checkOpenApiModeEnums(d, 'verify_agent_output.v2', bad2).length).toBe(1);
  });
});

describe('economic and catalog projection parity', () => {
  const projections = ECONOMIC_SERVICE_IDS.map((id) =>
    projectServiceEconomics(id as SiteborneServiceId, {
      productionEnabled: false,
      destination: null,
    })
  );
  it('every governed economic projection agrees with the declaration', () => {
    expect(msgs(checkEconomicParity(d, projections))).toEqual([]);
  });
  it('the admitted capabilities are exact-scheme, priced in USD, at the governed amounts', () => {
    const admitted = d.capabilitySecurityBindings.filter((b) => b.purchasable);
    expect(admitted.length).toBe(2);
    const byId = Object.fromEntries(projections.map((p) => [p.service_id, p]));
    expect(byId['verify_agent_output.v2']!.modes.find((m) => m.mode === 'standard')!.amount).toBe(
      '0.017'
    );
    expect(byId['web_context_verified.v2']!.modes.find((m) => m.mode === 'direct')!.amount).toBe(
      '0.008'
    );
  });
  it('detects a projection that marks a closed capability production-enabled', () => {
    const bad = projections.map((p) =>
      p.service_id === 'company_evidence_graph.v2' ? { ...p, production_enabled: true } : p
    );
    expect(checkEconomicParity(d, bad).length).toBeGreaterThan(0);
  });
});

describe('route mode gate parity', () => {
  it('what the route accepts equals what the declaration makes purchasable', () => {
    expect(msgs(checkModeGateParity(d))).toEqual([]);
  });
});

describe('VCM parity', () => {
  it('the static effective view never exceeds the declaration ceiling and agrees on mechanisms', async () => {
    const view = await getRuntimeEffectiveView('0'.repeat(40));
    expect(view.services.length).toBeGreaterThan(0);
    expect(msgs(checkVcmParity(d, view.services as never))).toEqual([]);
    for (const s of view.services)
      for (const sec of s.security) expect(['IMPLEMENTED', 'CONFIGURED']).toContain(sec.truthLevel);
  });
  it('detects a VCM/declaration disagreement about mTLS', () => {
    const bad = buildSecurityDeclarationV1() as any;
    const clone = structuredClone(bad);
    clone.unsupportedSecurityFeatures.find((n: any) => n.feature === 'mtls').status =
      'IMPLEMENTED_ENFORCED';
    expect(
      checkVcmParity(clone, [{ security: [{ mechanismKind: 'mtls', truthLevel: 'IMPLEMENTED' }] }])
        .length
    ).toBe(1);
  });
});

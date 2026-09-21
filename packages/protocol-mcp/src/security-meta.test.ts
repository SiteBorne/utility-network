import { describe, expect, it } from 'vitest';
import { buildSiteborneMcpDefinitionAuthorityInputs } from './server';

describe('additive security _meta injection', () => {
  const base = buildSiteborneMcpDefinitionAuthorityInputs();
  const byName = (i: ReturnType<typeof buildSiteborneMcpDefinitionAuthorityInputs>) =>
    Object.fromEntries([...i.serviceTools, ...i.utilityTools].map((t) => [t.name, t]));

  it('with nothing injected the definitions are exactly as before', () => {
    const none = buildSiteborneMcpDefinitionAuthorityInputs({ securityMetaByToolName: {} });
    expect(none).toEqual(base);
  });

  it('accepts only net.siteborne/security* keys and never overrides an existing key', () => {
    const injected = buildSiteborneMcpDefinitionAuthorityInputs({
      securityMetaByToolName: {
        siteborne_retrieve_verified_web_context: {
          'net.siteborne/security': [{ mode: 'direct' }],
          'net.siteborne/paymentRequired': false,
          'net.siteborne/serviceId': 'evil',
          'net.siteborne/inputSchema': 'evil',
          'other/key': 1,
        },
      },
    });
    const before = byName(base).siteborne_retrieve_verified_web_context!;
    const after = byName(injected).siteborne_retrieve_verified_web_context!;
    expect(after._meta).toEqual({
      ...before._meta,
      'net.siteborne/security': [{ mode: 'direct' }],
    });
    expect(after.inputSchema).toEqual(before.inputSchema);
    expect(after.annotations).toEqual(before.annotations);
  });

  it('a utility tool gains _meta only from allowed keys; unknown tool names are ignored', () => {
    const injected = buildSiteborneMcpDefinitionAuthorityInputs({
      securityMetaByToolName: {
        siteborne_get_quote: { 'net.siteborne/security': [], 'x/y': 1 },
        not_a_tool: { 'net.siteborne/security': [] },
      },
    });
    const q = byName(injected).siteborne_get_quote!;
    expect(q._meta).toEqual({ 'net.siteborne/security': [] });
    expect(byName(injected).not_a_tool).toBeUndefined();
    expect(byName(injected).siteborne_get_service_health!._meta).toBeUndefined();
  });
});

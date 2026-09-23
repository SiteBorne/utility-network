import { describe, expect, it } from 'vitest';
import { authenticateResultPrincipal } from '../src/control-plane/security/request-principal';

describe('shared REST/MCP/A2A verified-principal boundary', () => {
  it('never treats arbitrary identity headers or protocol metadata as a principal', async () => {
    const request = new Request('https://utility.siteborne.net/v3/result', {
      headers: {
        'X-User': 'buyer-1',
        'X-Principal': 'buyer-1',
        'X-Email': 'buyer@example.test',
        'X-Subject': 'buyer-1',
        'X-Agent-Card-Identity': 'agent-1',
        'MCP-Client-Name': 'buyer-1',
        Authorization: 'Basic self-asserted',
      },
    });
    expect(
      await authenticateResultPrincipal(request, {
        oidcIssuers: [],
        mtlsRegistry: [],
        now: () => '2026-09-22T12:00:00.000Z',
      })
    ).toBeNull();
  });

  it('maps only Cloudflare-owned verified mTLS facts through the registry', async () => {
    const request = new Request('https://utility.siteborne.net/a2a');
    Object.defineProperty(request, 'cf', {
      value: {
        tlsClientAuth: {
          certPresented: '1',
          certRevoked: '0',
          certVerified: 'SUCCESS',
          certFingerprintSHA256: 'AA:BB',
          certIssuerDN: 'CN=SITEBORNE Test CA',
        },
      },
    });
    const principal = await authenticateResultPrincipal(request, {
      oidcIssuers: [],
      mtlsRegistry: [
        {
          issuer_dn: 'CN=SITEBORNE Test CA',
          certificate_sha256: 'aabb',
          issuer: 'siteborne:mtls:workloads',
          subject_id: 'agent-1',
          subject_type: 'agent',
          assurance_level: 'cryptographic_workload',
        },
      ],
      now: () => '2026-09-22T12:00:00.000Z',
    });
    expect(principal?.subject).toMatchObject({
      subject_id: 'agent-1',
      authentication_method: 'mtls',
    });
  });
});

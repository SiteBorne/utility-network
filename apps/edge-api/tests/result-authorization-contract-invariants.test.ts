import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const read = (path: string) => readFileSync(repo(path), 'utf8');

describe('result-authorization contract and shortcut invariants', () => {
  it('publishes OIDC or mTLS security only for the buyer-authorized v3 operations', () => {
    const openapi = JSON.parse(
      read('contracts/releases/3.0.0/openapi/service-contracts.openapi.json')
    ) as {
      paths: Record<string, { post: Record<string, unknown> }>;
      components: { securitySchemes: Record<string, unknown> };
    };
    const buyerPaths = ['/v3/document/evidence-json', '/v3/verify/agent-output'];
    for (const path of buyerPaths) {
      expect(openapi.paths[path]?.post.security).toEqual([{ oidcBearer: [] }, { mutualTLS: [] }]);
      expect(openapi.paths[path]?.post['x-result-authorization']).toEqual({
        policy: 'buyer_subject_binding.v1',
        required_subject_match: true,
        existence_hiding: true,
      });
    }
    expect(openapi.paths['/v3/company/evidence-graph']?.post.security).toBeUndefined();
    expect(openapi.paths['/v3/web/context']?.post.security).toBeUndefined();
    expect(Object.keys(openapi.components.securitySchemes).sort()).toEqual([
      'mutualTLS',
      'oidcBearer',
    ]);
  });

  it('contains no payer, wallet, quote, or payment-identifier authorization shortcut', () => {
    const source = read('apps/edge-api/src/control-plane/security/result-authorization.ts');
    const policy = source.slice(
      source.indexOf('export function evaluateResultReleaseAuthorization'),
      source.indexOf('export function publicResultAuthorizationError')
    );
    expect(policy).not.toMatch(/payer|wallet|quote|payment_identifier|paymentIdentifier/iu);
  });

  it('contains no arbitrary inbound identity-header authority path', () => {
    const source = read('apps/edge-api/src/control-plane/security/request-principal.ts');
    expect(source).not.toMatch(/headers\.get\(['"]X-(?:User|Principal|Email|Subject)/iu);
    expect(source).not.toMatch(/headers\.get\(['"](?:Client-Cert|X-Client-Cert)/iu);
  });

  it('keeps raw identity, credential, payment, and artifact fields out of the PCC schemas', () => {
    for (const path of ['contracts/releases/3.0.0/schemas/proof-carrying-context.schema.json']) {
      const source = read(path);
      expect(source).not.toMatch(
        /owner_subject_ref|authority_context_id|policy_evaluation_id|raw_jwt|oauth_token|api_key|payment_identifier/iu
      );
    }
  });
});

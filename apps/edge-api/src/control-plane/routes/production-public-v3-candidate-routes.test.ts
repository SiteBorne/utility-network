import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { Env } from '../config/env';
import {
  companyEvidenceGraphV3CandidateRoute,
  documentEvidenceJsonV3CandidateRoute,
  verifyAgentOutputV3CandidateRoute,
  webContextVerifiedV3CandidateRoute,
} from './production-public-v3-candidate-routes';

function app(): Hono<{ Bindings: Env }> {
  const candidate = new Hono<{ Bindings: Env }>();
  candidate.post('/v3/company/evidence-graph', companyEvidenceGraphV3CandidateRoute);
  candidate.post('/v3/web/context', webContextVerifiedV3CandidateRoute);
  candidate.post('/v3/document/evidence-json', documentEvidenceJsonV3CandidateRoute);
  candidate.post('/v3/verify/agent-output', verifyAgentOutputV3CandidateRoute);
  return candidate;
}

const request = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' };

describe('Release 3 candidate activation gates', () => {
  it.each([
    '/v3/company/evidence-graph',
    '/v3/web/context',
    '/v3/document/evidence-json',
    '/v3/verify/agent-output',
  ])('%s is absent unless the exact governed release is selected', async (path) => {
    const response = await app().request(path, request, {
      PAID_ROUTES_ENABLED: 'true',
      COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED: 'true',
      WEB_CONTEXT_V2_CDP_ROUTE_ENABLED: 'true',
      DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED: 'true',
      VERIFY_V2_CDP_ROUTE_ENABLED: 'true',
      BUYER_AUTHORIZED_V3_ROUTE_ENABLED: 'true',
    } as Env);
    expect(response.status).toBe(404);
  });

  it.each([
    '/v3/company/evidence-graph',
    '/v3/web/context',
    '/v3/document/evidence-json',
    '/v3/verify/agent-output',
  ])('%s fails closed before composition when durable PCC storage is unavailable', async (path) => {
    const response = await app().request(path, request, {
      RESULT_CONTRACT_RELEASE_SELECTION: '3.0.0-public-candidate',
      PAID_ROUTES_ENABLED: 'true',
      COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED: 'true',
      WEB_CONTEXT_V2_CDP_ROUTE_ENABLED: 'true',
      DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED: 'true',
      VERIFY_V2_CDP_ROUTE_ENABLED: 'true',
      BUYER_AUTHORIZED_V3_ROUTE_ENABLED: 'true',
    } as Env);
    expect(response.status).toBe(503);
  });

  it.each(['/v3/document/evidence-json', '/v3/verify/agent-output'])(
    '%s stays absent when only the public-v3 release selector is enabled',
    async (path) => {
      const response = await app().request(path, request, {
        RESULT_CONTRACT_RELEASE_SELECTION: '3.0.0-public-candidate',
        PAID_ROUTES_ENABLED: 'true',
        DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED: 'true',
        VERIFY_V2_CDP_ROUTE_ENABLED: 'true',
      } as Env);
      expect(response.status).toBe(404);
    }
  );
});

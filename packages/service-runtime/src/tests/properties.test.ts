/**
 * Property-based tests for service-runtime invariants, using fast-check
 * with deterministic, bounded, no-network generators (matching the
 * discipline established in packages/provider-adapters and
 * packages/verification).
 */
import { describe, expect, it, beforeAll } from 'vitest';
import fc from 'fast-check';
import { createHash } from 'node:crypto';
import { SecSubmissionsAdapter, PublicHttpAdapter } from '@siteborne/provider-adapters';
import type { AuditEventSink as AdapterAuditEventSink } from '@siteborne/provider-adapters';
import type { KeyRegistry, Signer } from '@siteborne/verification';
import { CompanyEvidenceGraphService } from '../services/company-evidence/service';
import { WebContextVerifiedService } from '../services/web-context/service';
import { VerifyAgentOutputService } from '../services/agent-verification/service';
import {
  buildTestServiceContext,
  createFixtureSigner,
  jsonHttpClient,
  textHttpClient,
} from './support';
import type { AgentVerificationInput } from '../services/agent-verification/types';

const noopAdapterAudit: AdapterAuditEventSink = { async log() {}, getEvents: () => [], clear() {} };

describe('service-runtime properties', () => {
  let signer: Signer;
  let keyRegistry: KeyRegistry;
  beforeAll(async () => {
    ({ signer, registry: keyRegistry } = await createFixtureSigner());
  });

  it('property: identical AgentVerificationInput always produces the identical input_hash', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 10 }),
          fc.oneof(fc.string(), fc.integer(), fc.boolean())
        ),
        async (candidateOutput) => {
          const context = await buildTestServiceContext('verify_agent_output.v1');
          const service = new VerifyAgentOutputService({ signer, keyRegistry });
          const input: AgentVerificationInput = {
            verification_contract: { claims: [], deterministic_requirements: [] },
            candidate_output: candidateOutput,
            required_schema: {},
            verification_mode: 'standard',
          };

          const resultA = await service.execute(input, context);
          const resultB = await service.execute(input, context);

          expect(resultA.input_hash).toBe(resultB.input_hash);
          expect(resultA.input_hash).toBe(
            'sha256:' + createHash('sha256').update(JSON.stringify(input)).digest('hex')
          );
        }
      ),
      { numRuns: 30 }
    );
  });

  it('property: company_evidence_graph.v1 completeness always satisfies supported <= populated <= requested, for any subset of requested field groups', async () => {
    const allGroups = [
      'identity',
      'sec_submissions',
      'xbrl_facts',
      'recent_filings',
      'website_evidence',
      'regulatory_mentions',
      'public_repository_signals',
    ] as const;

    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.constantFrom(...allGroups), {
          minLength: 1,
          maxLength: allGroups.length,
        }),
        async (groups) => {
          const context = await buildTestServiceContext('company_evidence_graph.v1');
          const httpClient = jsonHttpClient({});
          const service = new CompanyEvidenceGraphService({
            httpClient,
            secSubmissions: new SecSubmissionsAdapter(
              httpClient,
              context.clock,
              context.artifact_store,
              noopAdapterAudit
            ),
            publicHttp: new PublicHttpAdapter(
              httpClient,
              context.clock,
              context.artifact_store,
              noopAdapterAudit
            ),
            signer,
            keyRegistry,
          });

          const result = await service.execute(
            { identifiers: { cik: '0000320193' }, requested_field_groups: [...groups] },
            context
          );
          const completeness = result.completeness!;
          expect(completeness.supported_fields).toBeLessThanOrEqual(completeness.populated_fields);
          expect(completeness.populated_fields).toBeLessThanOrEqual(completeness.requested_fields);
        }
      ),
      { numRuns: 25 }
    );
  });

  it('property: web_context_verified.v1 rendered mode never performs a network call, for any target_url', async () => {
    await fc.assert(
      fc.asyncProperty(fc.webUrl(), async (url) => {
        const context = await buildTestServiceContext('web_context_verified.v1');
        const httpClient = textHttpClient('<html></html>');
        const service = new WebContextVerifiedService({
          httpClient,
          publicHttp: new PublicHttpAdapter(
            httpClient,
            context.clock,
            context.artifact_store,
            noopAdapterAudit
          ),
          signer,
          keyRegistry,
        });

        const result = await service.execute(
          { target_url: url, retrieval_mode: 'rendered' },
          context
        );

        expect(result.result_class).toBe('dependency_unavailable');
        expect(httpClient.callCount).toBe(0);
      }),
      { numRuns: 25 }
    );
  });
});

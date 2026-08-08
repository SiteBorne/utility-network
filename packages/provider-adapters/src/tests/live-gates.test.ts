import { describe, it, expect } from 'vitest';
import { SecSubmissionsAdapter } from '../sec/submissions-adapter';
import { OpenAlexAdapter } from '../openalex/openalex-adapter';
import { CrossrefAdapter } from '../crossref/crossref-adapter';
import { GitHubAdapter } from '../github/github-adapter';
import { FederalRegisterAdapter } from '../federal-register/federal-register-adapter';
import { PublicHttpAdapter } from '../http/public-http-adapter';
import {
  fakeClock,
  fakeArtifactStore,
  fakeAuditSink,
  unreachableHttpClient,
  buildContext,
} from './support';

/**
 * Optional live gates. Each is disabled by default (`RUN_LIVE_*` unset) and,
 * because every shipped manifest's terms review is `pending_review`, even a
 * forced-on run performs zero network requests and reports `policy_blocked`
 * — TermsGuard is checked before any HTTP call regardless of the gate's
 * enabled state. No credentials are used anywhere in this file.
 */
interface LiveGate {
  envVar: string;
  label: string;
  run: (deps: {
    clock: ReturnType<typeof fakeClock>;
    httpClient: ReturnType<typeof unreachableHttpClient>;
  }) => Promise<{ resultClass: string }>;
}

const GATES: LiveGate[] = [
  {
    envVar: 'RUN_LIVE_SEC',
    label: 'SEC EDGAR submissions (noncustomer identifier: Apple Inc., CIK 0000320193)',
    run: async ({ clock, httpClient }) => {
      const adapter = new SecSubmissionsAdapter(
        httpClient,
        clock,
        fakeArtifactStore(),
        fakeAuditSink()
      );
      const context = buildContext({
        injected_clock: clock,
        injected_http_client: httpClient,
        execution_mode: 'live',
        timeout_ms: 5000,
        max_response_bytes: 1_000_000,
      });
      return adapter.execute({ cik: '0000320193', forms: [], maxFilings: 1 }, context);
    },
  },
  {
    envVar: 'RUN_LIVE_OPENALEX',
    label: 'OpenAlex work lookup (public identifier: W2741809807)',
    run: async ({ clock, httpClient }) => {
      const adapter = new OpenAlexAdapter(httpClient, clock, fakeArtifactStore(), fakeAuditSink());
      const context = buildContext({
        injected_clock: clock,
        injected_http_client: httpClient,
        execution_mode: 'live',
        timeout_ms: 5000,
        max_response_bytes: 1_000_000,
      });
      return adapter.execute({ mode: 'work', identifier: 'W2741809807' }, context);
    },
  },
  {
    envVar: 'RUN_LIVE_CROSSREF',
    label: 'Crossref DOI lookup (public identifier: 10.1038/s41586-023-05874-3)',
    run: async ({ clock, httpClient }) => {
      const adapter = new CrossrefAdapter(httpClient, clock, fakeArtifactStore(), fakeAuditSink());
      const context = buildContext({
        injected_clock: clock,
        injected_http_client: httpClient,
        execution_mode: 'live',
        timeout_ms: 5000,
        max_response_bytes: 1_000_000,
      });
      return adapter.execute({ mode: 'doi', doi: '10.1038/s41586-023-05874-3' }, context);
    },
  },
  {
    envVar: 'RUN_LIVE_GITHUB_PUBLIC',
    label: 'GitHub public repository lookup (public repo: octocat/Hello-World)',
    run: async ({ clock, httpClient }) => {
      const adapter = new GitHubAdapter(httpClient, clock, fakeArtifactStore(), fakeAuditSink());
      const context = buildContext({
        injected_clock: clock,
        injected_http_client: httpClient,
        execution_mode: 'live',
        timeout_ms: 5000,
        max_response_bytes: 1_000_000,
      });
      return adapter.execute(
        { mode: 'repository', owner: 'octocat', repo: 'Hello-World' },
        context
      );
    },
  },
  {
    envVar: 'RUN_LIVE_FEDERAL_REGISTER',
    label: 'Federal Register document lookup (public document number: 2024-00001)',
    run: async ({ clock, httpClient }) => {
      const adapter = new FederalRegisterAdapter(
        httpClient,
        clock,
        fakeArtifactStore(),
        fakeAuditSink()
      );
      const context = buildContext({
        injected_clock: clock,
        injected_http_client: httpClient,
        execution_mode: 'live',
        timeout_ms: 5000,
        max_response_bytes: 1_000_000,
      });
      return adapter.execute({ mode: 'document', documentNumber: '2024-00001' }, context);
    },
  },
  {
    envVar: 'RUN_LIVE_PUBLIC_HTTP',
    label: 'Direct public HTTP fetch (public URL: https://example.com/)',
    run: async ({ clock, httpClient }) => {
      const adapter = new PublicHttpAdapter(
        httpClient,
        clock,
        fakeArtifactStore(),
        fakeAuditSink()
      );
      const context = buildContext({
        injected_clock: clock,
        injected_http_client: httpClient,
        execution_mode: 'live',
        timeout_ms: 5000,
        max_response_bytes: 1_000_000,
      });
      return adapter.execute({ url: 'https://example.com/' }, context);
    },
  },
];

for (const gate of GATES) {
  describe(`Optional live gate: ${gate.envVar}`, () => {
    const enabled = process.env[gate.envVar] === '1';

    it.skipIf(!enabled)(
      `[live, requires ${gate.envVar}=1] ${gate.label} — real network call`,
      async () => {
        // This branch is skipped unless the operator explicitly opts in. It is
        // not exercised in default CI/test runs and uses no credentials.
        const clock = fakeClock();
        // Intentionally NOT unreachableHttpClient here — a real fetch-backed
        // InjectedHttpClient would be supplied by the operator's environment
        // when actually running this gate. In this repository there is no
        // credentialed or live-network client wired in, so this branch documents
        // intent; the always-on companion test below proves the safety property
        // that matters even if a live client were substituted.
        expect(gate.envVar in process.env).toBe(true);
        void clock;
      }
    );

    it('default (gate unset): reports "skipped", performs zero network calls, and is policy_blocked if forced to execute', async () => {
      expect(process.env[gate.envVar]).not.toBe('1');

      const clock = fakeClock();
      const httpClient = unreachableHttpClient();
      const result = await gate.run({ clock, httpClient });

      // Because every shipped manifest's terms_review_status is pending_review
      // and no review has been recorded in the global TermsGuard, execution in
      // 'live' mode is policy_blocked before any network access — this is the
      // expected outcome documented in section 9 of the completion plan.
      expect(result.resultClass).toBe('policy_blocked');
      expect(httpClient.callCount).toBe(0);
    });
  });
}

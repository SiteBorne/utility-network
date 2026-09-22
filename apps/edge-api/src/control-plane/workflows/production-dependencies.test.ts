/**
 * SUN-1221E6R-H2BF4 — direct, UNMOCKED unit coverage for
 * `buildProductionPaidContinuationWorkflowDependencies`'s own fail-closed
 * guards.
 *
 * `paid-continuation-workflow-entrypoint.test.ts` (H2BF1) proves the
 * ENTRYPOINT CLASS correctly delegates to and fails closed on whatever
 * this function returns — but it does so with this entire module
 * `vi.mock`'d at the boundary, so it never actually exercises this
 * function's own guard logic. That left a real coverage gap: H2BF4's own
 * mutation-matrix proof (removing the
 * `PAYMENT_CONTINUATION_ENCRYPTION_KEY` guard below) silently passed
 * against the mocked suite. This file closes that gap by calling the
 * REAL function directly, mocking nothing.
 *
 * Only the guards reachable without a real D1Database/CDP composition are
 * covered here (unsupported service, missing `DB`, missing
 * `PAYMENT_CONTINUATION_ENCRYPTION_KEY`, and — SUN-1222D-PRE-WORKFLOW-
 * DISPATCH-FIX — the two new services' own composition-level fail-closed
 * gates, which ARE reachable without a real D1Database because they
 * short-circuit before ever touching `db`) — the guards ordered BEFORE
 * any real composition-function call that would need a live D1/CDP
 * account. The `routeConfig.unavailable` passthrough and
 * successful-path construction for `web_context_verified.v2`/
 * `verify_agent_output.v2` are already exhaustively covered by
 * `web-context-v2-cdp-composition.test.ts` / `verify-agent-output-v2-cdp-
 * composition.test.ts` (the two composition functions this function
 * calls, unmodified, for exactly that logic) — re-proving them here
 * through a third layer would test the same code a third time for no new
 * coverage. `company-evidence-graph-v2-cdp-composition.test.ts` and
 * `document-evidence-json-v2-cdp-composition.test.ts` cover the same for
 * the two SUN-1222D-PRE-WORKFLOW-DISPATCH-FIX additions.
 */
import { describe, it, expect } from 'vitest';
import {
  buildProductionPaidContinuationWorkflowDependencies,
  __TEST_ONLY_SUPPORTED_SERVICES,
} from './production-dependencies';
import type { PaidContinuationWorkflowHostEnv } from './paid-continuation-workflow';

const PUBLIC_V3_SERVICES = ['company_evidence_graph.v3', 'web_context_verified.v3'] as const;

function minimalHostEnv(
  overrides: Partial<PaidContinuationWorkflowHostEnv> = {}
): PaidContinuationWorkflowHostEnv {
  return {
    DB: {} as never,
    PAYMENT_CONTINUATION_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    PAID_RECEIPT_SIGNING_PRIVATE_KEY: undefined,
    PAID_RECEIPT_SIGNING_KEY_ID: undefined,
    SELLER_WALLET_ADDRESS: '0x7f44a2dd237938f18632d4cca40f4c690295e6e1',
    // Required (non-optional) fields on `Env` -- unlike the
    // `PAID_RECEIPT_SIGNING_*`/`MODAL_WEBCTX_*` fields below, these
    // cannot be `undefined`. Harmless placeholders: every test in this
    // file only exercises guards that short-circuit before these values
    // are ever read.
    CDP_API_KEY_ID: 'unused-test-placeholder',
    CDP_API_KEY_SECRET: 'unused-test-placeholder',
    PAYMENT_ENVIRONMENT: undefined,
    PRODUCTION_ENABLED: undefined,
    HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: undefined,
    PRODUCTION_CDP_CREDENTIALS_APPROVED: undefined,
    MODAL_WEBCTX_ENDPOINT_URL: undefined,
    MODAL_WEBCTX_PROXY_KEY: undefined,
    MODAL_WEBCTX_PROXY_SECRET: undefined,
    MODAL_DOCWORKER_ENDPOINT_URL: undefined,
    MODAL_DOCWORKER_PROXY_KEY: undefined,
    MODAL_DOCWORKER_PROXY_SECRET: undefined,
    ARTIFACTS: undefined,
    BASE_RPC_URL: undefined,
    BASE_SEPOLIA_RPC_URL: undefined,
    ...overrides,
  };
}

const FOUR_SERVICES = [
  'company_evidence_graph.v2',
  'web_context_verified.v2',
  'document_evidence_json.v2',
  'verify_agent_output.v2',
];

describe('SUN-1221E6R-H2BF4 buildProductionPaidContinuationWorkflowDependencies (real function, unmocked)', () => {
  it('fails closed on an unsupported/unknown service', async () => {
    const result = await buildProductionPaidContinuationWorkflowDependencies(
      minimalHostEnv(),
      'not_a_real_service'
    );
    expect('unavailable' in result && result.unavailable).toBe(true);
    expect('unavailable' in result && result.reason).toContain('unsupported service');
  });

  it('fails closed when DB is missing', async () => {
    const result = await buildProductionPaidContinuationWorkflowDependencies(
      minimalHostEnv({ DB: undefined as never }),
      'web_context_verified.v2'
    );
    expect('unavailable' in result && result.unavailable).toBe(true);
    expect('unavailable' in result && result.reason).toContain('D1 database binding');
  });

  it('MUTATION_G_TARGET: fails closed when PAYMENT_CONTINUATION_ENCRYPTION_KEY is missing -- this is the exact guard SUN-1221E6R-H2BF4 §37 mutation G proves is load-bearing (removing it was proven, this checkpoint, to silently pass the entrypoint-level mocked suite alone)', async () => {
    const result = await buildProductionPaidContinuationWorkflowDependencies(
      minimalHostEnv({ PAYMENT_CONTINUATION_ENCRYPTION_KEY: undefined }),
      'web_context_verified.v2'
    );
    expect('unavailable' in result && result.unavailable).toBe(true);
    expect('unavailable' in result && result.reason).toBe(
      'PAYMENT_CONTINUATION_ENCRYPTION_KEY is missing'
    );
  });

  it('all four supported services are recognized before the DB/key guards short-circuit', async () => {
    for (const service of FOUR_SERVICES) {
      const result = await buildProductionPaidContinuationWorkflowDependencies(
        minimalHostEnv({ DB: undefined as never }),
        service
      );
      // Reaches the DB guard (not the "unsupported service" guard) --
      // proves all four real service names are accepted by the allowlist.
      expect('unavailable' in result && result.reason).toContain('D1 database binding');
    }
  });

  // ---------------------------------------------------------------------
  // SUN-1222D-PRE-WORKFLOW-DISPATCH-FIX §10/§17 -- RED/GREEN for the two
  // newly-supported services' OWN composition-level dependency gates.
  // Before this checkpoint's fix, both cases below returned `unavailable:
  // true, reason: 'unsupported service: ...'` from the OLD
  // `SUPPORTED_SERVICES` allowlist -- a completely different, wrong
  // failure reason proving the architectural blocker. After the fix, the
  // service IS recognized and the failure reason instead comes from the
  // real, reused composition function's own genuine external-dependency
  // gate (MODAL_WEBCTX_*/MODAL_DOCWORKER_*/ARTIFACTS), never from the
  // service-allowlist check.
  // ---------------------------------------------------------------------

  it('COMPANY_WORKFLOW_DEPENDENCY: company_evidence_graph.v2 is recognized and fails closed on its own real MODAL_WEBCTX_* gate (never "unsupported service")', async () => {
    const result = await buildProductionPaidContinuationWorkflowDependencies(
      minimalHostEnv({
        PAID_RECEIPT_SIGNING_PRIVATE_KEY: 'test-key-material',
        PAID_RECEIPT_SIGNING_KEY_ID: 'test-key-id',
      }),
      'company_evidence_graph.v2'
    );
    expect('unavailable' in result && result.unavailable).toBe(true);
    expect('unavailable' in result && result.reason).not.toContain('unsupported service');
    expect('unavailable' in result && result.reason).toContain(
      'MODAL_WEBCTX_* safe-egress executor credentials are missing'
    );
  });

  it('DOCUMENT_WORKFLOW_DEPENDENCY: document_evidence_json.v2 is recognized and fails closed on its own real ARTIFACTS gate (never "unsupported service")', async () => {
    const result = await buildProductionPaidContinuationWorkflowDependencies(
      minimalHostEnv({
        PAID_RECEIPT_SIGNING_PRIVATE_KEY: 'test-key-material',
        PAID_RECEIPT_SIGNING_KEY_ID: 'test-key-id',
      }),
      'document_evidence_json.v2'
    );
    expect('unavailable' in result && result.unavailable).toBe(true);
    expect('unavailable' in result && result.reason).not.toContain('unsupported service');
    expect('unavailable' in result && result.reason).toContain('ARTIFACTS R2 bucket binding');
  });

  it('DOCUMENT_WORKFLOW_DEPENDENCY: document_evidence_json.v2 fails closed on its own real MODAL_DOCWORKER_* gate once ARTIFACTS is present', async () => {
    const result = await buildProductionPaidContinuationWorkflowDependencies(
      minimalHostEnv({
        PAID_RECEIPT_SIGNING_PRIVATE_KEY: 'test-key-material',
        PAID_RECEIPT_SIGNING_KEY_ID: 'test-key-id',
        ARTIFACTS: {} as never,
      }),
      'document_evidence_json.v2'
    );
    expect('unavailable' in result && result.unavailable).toBe(true);
    expect('unavailable' in result && result.reason).toContain(
      'MODAL_DOCWORKER_* document-worker executor credentials are missing'
    );
  });

  // ---------------------------------------------------------------------
  // SUN-1222D-PRE-WORKFLOW-DISPATCH-FIX §11 -- registry coherence.
  // ---------------------------------------------------------------------

  it('REGISTRY_COHERENCE: supported service count is exactly 6', () => {
    expect(__TEST_ONLY_SUPPORTED_SERVICES.size).toBe(6);
  });

  it('REGISTRY_COHERENCE: supports the four v2 services and only the two public v3 candidates', () => {
    expect([...__TEST_ONLY_SUPPORTED_SERVICES].sort()).toEqual(
      [...FOUR_SERVICES, ...PUBLIC_V3_SERVICES].sort()
    );
  });

  it.each(PUBLIC_V3_SERVICES)(
    'PUBLIC_V3_WORKFLOW_DISPATCH: %s reaches its governed production composition',
    async (serviceId) => {
      const result = await buildProductionPaidContinuationWorkflowDependencies(
        minimalHostEnv(),
        serviceId
      );
      expect('unavailable' in result && result.unavailable).toBe(true);
      expect('unavailable' in result && result.reason).toContain(
        'PAID_RECEIPT_SIGNING_PRIVATE_KEY is missing'
      );
      expect('unavailable' in result && result.reason).not.toContain('unsupported service');
    }
  );

  it('REGISTRY_COHERENCE: an unknown service has no dependency factory', () => {
    expect(__TEST_ONLY_SUPPORTED_SERVICES.has('not_a_real_service')).toBe(false);
  });

  it('REGISTRY_COHERENCE: no v1 service is accidentally supported', () => {
    for (const v1 of [
      'company_evidence_graph.v1',
      'web_context_verified.v1',
      'document_evidence_json.v1',
      'verify_agent_output.v1',
    ]) {
      expect(__TEST_ONLY_SUPPORTED_SERVICES.has(v1)).toBe(false);
    }
  });

  it('REGISTRY_COHERENCE: no unreleased/Nevermined-fallback service is accidentally supported', () => {
    for (const other of [
      'document_evidence_json.v3',
      'verify_agent_output.v3',
      'nevermined.v1',
      'nevermined_fallback',
      'unreleased_service.v3',
    ]) {
      expect(__TEST_ONLY_SUPPORTED_SERVICES.has(other)).toBe(false);
    }
  });
});

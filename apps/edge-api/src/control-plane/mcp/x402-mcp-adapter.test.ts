import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildExactPaymentRequirement,
  buildPaymentRequired,
  buildQuote,
  encodePaymentRequiredHeaderSafe,
  encodePaymentResponseHeaderSafe,
  type SiteborneServiceId,
} from '@siteborne/protocol-x402';
import type { PaymentPayload, SettleResponse } from '@x402/core/types';
import { describe, expect, it } from 'vitest';
import { createMcpX402ServiceBoundary, type McpX402RouteHandler } from './x402-mcp-adapter';
import { consumeVerifiedPrincipal } from '../security/verified-principal-context';
import type { VerifiedPrincipalEvidence } from '../security/result-authorization';

const FIXTURE_CONTEXT = {
  protocol_version: '2026-07-28' as const,
  client_name: 'test-client',
  client_version: '1.0.0',
};

async function realPaymentPayload(): Promise<PaymentPayload> {
  const quote = await buildQuote({
    service_id: 'company_evidence_graph.v2',
    service_version: 'v2',
    contract_release: '2.0.0',
    input_hash: 'sha256:' + '1'.repeat(64),
    pricing_key: 'company_evidence_graph_v2',
    scheme: 'exact',
    network: 'eip155:8453',
    asset: '0xUSDC',
    amount: '31200',
    payee: '0xPayee',
    issued_at: '2026-08-09T00:00:00.000Z',
    expires_at: '2026-08-09T00:05:00.000Z',
  });
  const { requirement } = await buildExactPaymentRequirement({
    quote,
    resource_id: 'https://utility.siteborne.net/v2/company/evidence-graph',
    maxTimeoutSeconds: 60,
  });
  return { x402Version: 2, accepted: requirement, payload: { signature: '0xdeadbeef' } };
}

// -----------------------------------------------------------------------
// §22 static settlement-authority audit: this adapter must NEVER import
// anything from the settlement/facilitator/Workflow layer. A grep on the
// adapter's own source (not its transitive dependency tree, which
// legitimately includes the settlement layer inside the real production
// route functions this adapter is HANDED, not itself importing) proves it
// by construction rather than by promise.
// -----------------------------------------------------------------------
describe('x402-mcp-adapter settlement-authority static audit', () => {
  const source = readFileSync(fileURLToPath(new URL('./x402-mcp-adapter.ts', import.meta.url)), {
    encoding: 'utf-8',
  });

  it('never calls settle(), verify(), or a facilitator/Workflow method directly', () => {
    // Matches an actual call expression, not merely the substring
    // "settle" (which appears legitimately in doc comments describing
    // what this file does NOT do).
    expect(source).not.toMatch(/\.settle\(/);
    expect(source).not.toMatch(/\.settlePayment\(/);
    expect(source).not.toMatch(/\.verifyPayment\(/);
  });

  // Every real `import ... from '...'` statement, extracted with a regex
  // that spans multi-line `import { a, b, c } from '...'` blocks (a naive
  // per-line `startsWith('import')` filter would silently drop named
  // imports that sit on their own line, letting a real settlement import
  // through undetected as long as it wasn't the very first name in the
  // list) -- doc comments (which legitimately mention "facilitator" and
  // "paid-continuation-workflow.ts" in prose, describing what this file
  // does NOT do / where the real settlement code lives) are excluded by
  // construction, since this only matches actual `import` syntax.
  // `^import\b` anchored to true column 0 (multiline mode) -- every real
  // import statement in this file starts at column 0; every comment line
  // that happens to contain the word "imports" is indented (` * ...` for
  // block comments, `// ...` for line comments), so this can never match
  // inside a comment, unlike a plain (non-anchored) `import` substring
  // search which matched "imports" inside "This file imports no
  // settlement..." and pulled in everything up to the next real `from`.
  const importStatements = [...source.matchAll(/^import\b[\s\S]*?from\s+['"][^'"]+['"];?/gm)]
    .map((m) => m[0])
    .join('\n');

  it('imports nothing from the settlement/facilitator/CDP/Workflow layer', () => {
    expect(importStatements).not.toMatch(/paid-continuation-workflow/);
    expect(importStatements).not.toMatch(/cdp-provider/);
    expect(importStatements).not.toMatch(/CdpPaymentEvidenceProvider/);
    expect(importStatements).not.toMatch(/PAID_CONTINUATION_WORKFLOW/);
    expect(importStatements).not.toMatch(/facilitator/i);
  });

  it('only imports pure header codecs from protocol-x402, never a settlement provider constructor', () => {
    expect(importStatements).toMatch(/decodePaymentRequiredHeaderSafe/);
    expect(importStatements).toMatch(/encodePaymentSignatureHeaderSafe/);
    expect(importStatements).not.toMatch(/EvidenceProvider/);
  });
});

describe('createMcpX402ServiceBoundary', () => {
  const verifiedPrincipal: VerifiedPrincipalEvidence = {
    verification_status: 'VERIFIED',
    evidence_type: 'cryptographically_authenticated',
    verifier_id: 'siteborne.identity-evidence-verifier.v1',
    subject: {
      schema_version: 'result_subject.v1',
      subject_type: 'human',
      issuer: 'https://identity.siteborne.test',
      subject_id: 'buyer-1',
      authentication_method: 'oidc',
      assurance_level: 'verified_single_factor',
      authenticated_at: '2026-09-22T12:00:00.000Z',
      credential_binding: null,
    },
  };

  it.each(['document_evidence_json.v3', 'verify_agent_output.v3'] as const)(
    'injects only the server-owned verified principal for %s before handler dispatch',
    async (serviceId) => {
      const handler: McpX402RouteHandler = async (c) => {
        const principal = consumeVerifiedPrincipal(c.req.raw);
        return principal
          ? c.json({ subject_id: principal.subject.subject_id }, 200)
          : c.json({ error: 'authentication_required' }, 401);
      };
      const authenticated = createMcpX402ServiceBoundary(
        {} as never,
        { [serviceId]: handler },
        'https://utility.siteborne.net',
        verifiedPrincipal
      );
      const allowed = await authenticated.execute(
        serviceId,
        { client_name: 'attacker', _meta: { principal: 'attacker' } },
        { ...FIXTURE_CONTEXT, client_name: 'attacker' },
        undefined
      );
      expect(allowed).toMatchObject({ outcome: 'fulfilled', result: { subject_id: 'buyer-1' } });

      const unauthenticated = createMcpX402ServiceBoundary(
        {} as never,
        { [serviceId]: handler },
        'https://utility.siteborne.net'
      );
      expect(
        await unauthenticated.execute(
          serviceId,
          { client_name: 'buyer-1', _meta: { principal: 'buyer-1' } },
          { ...FIXTURE_CONTEXT, client_name: 'buyer-1' },
          undefined
        )
      ).toMatchObject({ outcome: 'rejected', code: 'authentication_required' });
    }
  );

  it('translates a genuinely unpaid call into an HTTP request with no PAYMENT-SIGNATURE header', async () => {
    let capturedHeader: string | null | undefined;
    const handler: McpX402RouteHandler = async (c) => {
      capturedHeader = c.req.header('PAYMENT-SIGNATURE');
      const quote = await buildQuote({
        service_id: 'company_evidence_graph.v2',
        service_version: 'v2',
        contract_release: '2.0.0',
        input_hash: 'sha256:' + '3'.repeat(64),
        pricing_key: 'company_evidence_graph_v2',
        scheme: 'exact',
        network: 'eip155:8453',
        asset: '0xUSDC',
        amount: '31200',
        payee: '0xPayee',
        issued_at: '2026-08-09T00:00:00.000Z',
        expires_at: '2026-08-09T00:05:00.000Z',
      });
      const { requirement } = await buildExactPaymentRequirement({
        quote,
        resource_id: 'https://utility.siteborne.net/v2/company/evidence-graph',
        maxTimeoutSeconds: 60,
      });
      const paymentRequired = buildPaymentRequired({
        resource: { url: 'https://utility.siteborne.net/v2/company/evidence-graph' },
        accepts: [requirement],
      });
      c.header('PAYMENT-REQUIRED', encodePaymentRequiredHeaderSafe(paymentRequired));
      return c.json({ error: 'payment_required', x402_version: 2 }, 402);
    };
    const boundary = createMcpX402ServiceBoundary(
      {} as never,
      { 'company_evidence_graph.v2': handler },
      'https://utility.siteborne.net'
    );

    const outcome = await boundary.execute(
      'company_evidence_graph.v2',
      { company_name: 'Acme' },
      FIXTURE_CONTEXT,
      undefined
    );

    // Hono's c.req.header() returns `undefined`, not `null`, for an
    // absent header -- this is a real assertion on Hono's actual
    // contract, not a stylistic choice.
    expect(capturedHeader).toBeUndefined();
    expect(outcome.outcome).toBe('payment_required');
  });

  it('a real PaymentPayload is encoded into PAYMENT-SIGNATURE using the same encoder REST expects, and reaches the handler', async () => {
    const paymentPayload = await realPaymentPayload();
    let capturedBody: unknown;
    let capturedHeaderPresent = false;
    const handler: McpX402RouteHandler = async (c) => {
      capturedHeaderPresent = c.req.header('PAYMENT-SIGNATURE') !== undefined;
      capturedBody = await c.req.json();
      return c.json({ service_id: 'company_evidence_graph.v2', output: { ok: true } }, 200);
    };
    const boundary = createMcpX402ServiceBoundary(
      {} as never,
      { 'company_evidence_graph.v2': handler },
      'https://utility.siteborne.net'
    );

    const outcome = await boundary.execute(
      'company_evidence_graph.v2',
      { company_name: 'Acme' },
      FIXTURE_CONTEXT,
      paymentPayload
    );

    expect(capturedHeaderPresent).toBe(true);
    expect(capturedBody).toEqual({ company_name: 'Acme' });
    expect(outcome.outcome).toBe('fulfilled');
  });

  it('a 402 response with a real PAYMENT-REQUIRED header is decoded into the outcome.paymentRequired object', async () => {
    const quote = await buildQuote({
      service_id: 'company_evidence_graph.v2',
      service_version: 'v2',
      contract_release: '2.0.0',
      input_hash: 'sha256:' + '2'.repeat(64),
      pricing_key: 'company_evidence_graph_v2',
      scheme: 'exact',
      network: 'eip155:8453',
      asset: '0xUSDC',
      amount: '31200',
      payee: '0xPayee',
      issued_at: '2026-08-09T00:00:00.000Z',
      expires_at: '2026-08-09T00:05:00.000Z',
    });
    const { requirement } = await buildExactPaymentRequirement({
      quote,
      resource_id: 'https://utility.siteborne.net/v2/company/evidence-graph',
      maxTimeoutSeconds: 60,
    });
    const paymentRequired = buildPaymentRequired({
      resource: { url: 'https://utility.siteborne.net/v2/company/evidence-graph' },
      accepts: [requirement],
    });
    const handler: McpX402RouteHandler = async (c) => {
      c.header('PAYMENT-REQUIRED', encodePaymentRequiredHeaderSafe(paymentRequired));
      return c.json({ error: 'payment_required', x402_version: 2, quote_id: quote.quote_id }, 402);
    };
    const boundary = createMcpX402ServiceBoundary(
      {} as never,
      { 'company_evidence_graph.v2': handler },
      'https://utility.siteborne.net'
    );

    const outcome = await boundary.execute(
      'company_evidence_graph.v2',
      { company_name: 'Acme' },
      FIXTURE_CONTEXT,
      undefined
    );

    expect(outcome.outcome).toBe('payment_required');
    if (outcome.outcome === 'payment_required') {
      expect(outcome.paymentRequired).toEqual(paymentRequired);
    }
  });

  it('a 200 response returns the whole body (the governed PCC document) as the fulfilled result, and decodes PAYMENT-RESPONSE', async () => {
    const settleResponse: SettleResponse = {
      success: true,
      transaction: '0xabc123',
      network: 'eip155:8453',
      payer: '0xBuyer',
    };
    // SUN-1222C-PCC-WIRE-RESULT-IMPLEMENTATION: the REST route's 200 body
    // *is* the governed v2 wire result now -- the full PCC document
    // (`DurableCachedResult.body`, see its doc comment in
    // paid-continuation-workflow.ts) -- never a bespoke envelope with a
    // nested `output` field. `additionalProperties: false` on the accepted
    // 2.0.0 schema's base PCC ref means no sibling metadata field can
    // legally sit alongside it.
    const realPccDocument = { pcc_version: '1.0.0', job_id: 'job_xyz', subject: {}, claims: [] };
    const handler: McpX402RouteHandler = async (c) => {
      c.header('PAYMENT-RESPONSE', encodePaymentResponseHeaderSafe(settleResponse));
      return c.json(realPccDocument, 200);
    };
    const boundary = createMcpX402ServiceBoundary(
      {} as never,
      { 'company_evidence_graph.v2': handler },
      'https://utility.siteborne.net'
    );

    const outcome = await boundary.execute(
      'company_evidence_graph.v2',
      { company_name: 'Acme' },
      FIXTURE_CONTEXT,
      await realPaymentPayload()
    );

    expect(outcome.outcome).toBe('fulfilled');
    if (outcome.outcome === 'fulfilled') {
      // Proves the whole-body identity: result must be exactly the PCC
      // document the REST route returned, byte-identical, never unwrapped
      // to a sub-field.
      expect(outcome.result).toEqual(realPccDocument);
      expect(outcome.paymentResponse).toEqual(settleResponse);
    }
  });

  it('a non-200/402 error response is passed through verbatim as rejected, never fabricating new economics', async () => {
    // Simulates the REST route's real 409 duplicate-conflict passthrough.
    const rejectingHandler: McpX402RouteHandler = async (c) =>
      c.json(
        {
          code: 'duplicate_conflict',
          message: 'a different payload already consumed this identifier',
        },
        409
      );
    const boundary = createMcpX402ServiceBoundary(
      {} as never,
      { 'company_evidence_graph.v2': rejectingHandler },
      'https://utility.siteborne.net'
    );

    const outcome = await boundary.execute(
      'company_evidence_graph.v2',
      { company_name: 'Acme' },
      FIXTURE_CONTEXT,
      await realPaymentPayload()
    );

    expect(outcome.outcome).toBe('rejected');
    if (outcome.outcome === 'rejected') {
      expect(outcome.code).toBe('duplicate_conflict');
      expect(outcome.message).toBe('a different payload already consumed this identifier');
    }
  });

  it('a service with no wired handler is rejected rather than silently no-op-ing', async () => {
    const boundary = createMcpX402ServiceBoundary({} as never, {}, 'https://utility.siteborne.net');

    const outcome = await boundary.execute(
      'company_evidence_graph.v2' as SiteborneServiceId,
      {},
      FIXTURE_CONTEXT,
      undefined
    );

    expect(outcome.outcome).toBe('rejected');
    if (outcome.outcome === 'rejected') {
      expect(outcome.code).toBe('service_not_wired');
    }
  });
});

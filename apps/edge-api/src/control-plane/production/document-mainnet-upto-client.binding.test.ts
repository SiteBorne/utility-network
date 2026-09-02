/**
 * SUN-1222C-R3B §22-23 — proves, against the REAL protocol-x402 quote and
 * `upto` requirement builders (not a reimplementation), that:
 *
 *  (a) a payment authorization built against one document's 402 cannot be
 *      reused against a different, more expensive document request
 *      (REQUEST_BODY_ECONOMIC_BINDING); and
 *  (b) a `document_evidence_json.v2` payment authorization cannot be
 *      reused against another SITEBORNE service, even one that also uses
 *      the `upto` scheme (SERVICE_PRICE_BINDING).
 *
 * This is deliberately a protocol-level test (no HTTP, no Miniflare, no
 * live network) — it exercises the exact functions the real route and
 * the real mainnet client both depend on.
 */
import { describe, expect, it } from 'vitest';
import {
  buildQuote,
  buildUptoPaymentRequirement,
  validateUptoAuthorization,
  hashPaymentObject,
  type Quote,
} from '@siteborne/protocol-x402';

const NOW = '2026-01-01T00:00:00.000Z';
const LATER = '2026-01-01T00:05:00.000Z';
const NETWORK = 'eip155:8453';
const ASSET = '0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913';
const PAY_TO = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1';

async function documentQuote(
  overrides: Partial<Parameters<typeof buildQuote>[0]> = {}
): Promise<Quote> {
  return buildQuote({
    service_id: 'document_evidence_json.v2',
    service_version: 'v2',
    contract_release: '2.0.0',
    input_hash: await hashPaymentObject({ artifact_id: 'doc/cheap-one-pager.pdf' }),
    pricing_key: 'document_evidence_json_max_job',
    scheme: 'upto',
    network: NETWORK,
    asset: ASSET,
    amount: '190000',
    payee: PAY_TO,
    issued_at: NOW,
    expires_at: LATER,
    ...overrides,
  });
}

describe('document_evidence_json.v2 upto request-body economic binding', () => {
  it('a requirement built from quote A validates against quote A', async () => {
    const quoteA = await documentQuote();
    const { requirement } = await buildUptoPaymentRequirement({
      quote: quoteA,
      resource_id: 'doc/cheap-one-pager.pdf',
      maxTimeoutSeconds: 60,
    });
    const outcome = validateUptoAuthorization({
      requirement,
      actualAmount: '12000',
      quote: quoteA,
      resourceId: 'doc/cheap-one-pager.pdf',
      nowIso: NOW,
    });
    expect(outcome).toBe('valid');
  });

  it('a requirement built from quote A (cheap doc) is rejected against quote B (a different, more expensive document)', async () => {
    const quoteA = await documentQuote(); // priced/hashed for the cheap one-pager
    const quoteB = await documentQuote({
      // A materially different request — different input_hash changes
      // quote_id/binding_hash even though every other field is identical.
      input_hash: await hashPaymentObject({ artifact_id: 'doc/expensive-50-page-table-heavy.pdf' }),
    });
    expect(quoteA.quote_id).not.toBe(quoteB.quote_id);

    const { requirement } = await buildUptoPaymentRequirement({
      quote: quoteA,
      resource_id: 'doc/cheap-one-pager.pdf',
      maxTimeoutSeconds: 60,
    });

    // Attempt to settle the cheap-quote-derived requirement against the
    // expensive document's quote — must fail, not silently succeed.
    const outcome = validateUptoAuthorization({
      requirement,
      actualAmount: '190000',
      quote: quoteB,
      resourceId: 'doc/expensive-50-page-table-heavy.pdf',
      nowIso: NOW,
    });
    expect(outcome).not.toBe('valid');
    expect(outcome).toBe('quote_mismatch');
  });

  it('a document_evidence_json.v2 requirement cannot be validated against a company_evidence_graph.v2 quote', async () => {
    const documentSideQuote = await documentQuote();
    const companyQuote = await buildQuote({
      service_id: 'company_evidence_graph.v2',
      service_version: 'v2',
      contract_release: '2.0.0',
      input_hash: await hashPaymentObject({ company_name: 'Example Corp' }),
      pricing_key: 'company_evidence_graph_max_job',
      scheme: 'upto',
      network: NETWORK,
      asset: ASSET,
      amount: '39000',
      payee: PAY_TO,
      issued_at: NOW,
      expires_at: LATER,
    });

    const { requirement } = await buildUptoPaymentRequirement({
      quote: documentSideQuote,
      resource_id: 'doc/cheap-one-pager.pdf',
      maxTimeoutSeconds: 60,
    });

    const outcome = validateUptoAuthorization({
      requirement,
      actualAmount: '12000',
      quote: companyQuote,
      resourceId: 'doc/cheap-one-pager.pdf',
      nowIso: NOW,
    });
    expect(outcome).not.toBe('valid');
    expect(outcome).toBe('quote_mismatch');
  });

  it('an expired quote is rejected even with an otherwise-matching requirement', async () => {
    const quote = await documentQuote();
    const { requirement } = await buildUptoPaymentRequirement({
      quote,
      resource_id: 'doc/cheap-one-pager.pdf',
      maxTimeoutSeconds: 60,
    });
    const outcome = validateUptoAuthorization({
      requirement,
      actualAmount: '12000',
      quote,
      resourceId: 'doc/cheap-one-pager.pdf',
      // one millisecond at-or-after expiry — inclusive-of-expiry-invalid
      nowIso: LATER,
    });
    expect(outcome).toBe('expired');
  });

  it('an actual settlement amount above the frozen 190000 ceiling is rejected', async () => {
    const quote = await documentQuote();
    const { requirement } = await buildUptoPaymentRequirement({
      quote,
      resource_id: 'doc/cheap-one-pager.pdf',
      maxTimeoutSeconds: 60,
    });
    const outcome = validateUptoAuthorization({
      requirement,
      actualAmount: '190001',
      quote,
      resourceId: 'doc/cheap-one-pager.pdf',
      nowIso: NOW,
    });
    expect(outcome).toBe('actual_exceeds_maximum');
  });
});

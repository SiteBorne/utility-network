/**
 * No-network / no-credential proof (directive §32). Every SUN-0700A
 * checkpoint-1 code path — quote building, requirement construction,
 * challenge building, header codecs, payload structural validation — must
 * perform zero real network calls and require zero CDP/wallet credentials.
 * This test installs a `fetch` spy that throws if ever invoked, exercises
 * every public entry point, and asserts no `CDP_`-prefixed environment
 * variable is read by any of this package's own source (grep-based, since
 * a runtime spy cannot prove a negative about *unreached* code paths).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildQuote } from '../quote/quote';
import { buildExactPaymentRequirement } from '../requirements/exact';
import { buildPaymentRequired } from '../challenge/payment-required';
import {
  decodePaymentRequiredHeaderSafe,
  decodePaymentSignatureHeaderSafe,
  decodePaymentResponseHeaderSafe,
  encodePaymentRequiredHeaderSafe,
} from '../codec/headers';
import { validatePaymentPayloadStructure } from '../payload/parser';
import { resolveServiceMaxPriceUsd, usdToAtomicUnits } from '../pricing/mapping';
import type { PaymentEvidenceContext } from '../evidence/types';

describe('no-network proof', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(() => {
      throw new Error('network call attempted during a SUN-0700A checkpoint-1 code path');
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('the entire quote -> requirement -> challenge -> codec -> payload-validation path performs zero fetch calls', async () => {
    const priceUsd = resolveServiceMaxPriceUsd('company_evidence_graph');
    const amount = usdToAtomicUnits(priceUsd, 6);
    const quote = await buildQuote({
      service_id: 'company_evidence_graph.v1',
      service_version: 'v1',
      contract_release: '1.0.0',
      input_hash: 'sha256:' + '1'.repeat(64),
      pricing_key: 'company_evidence_graph',
      scheme: 'exact',
      network: 'eip155:8453',
      asset: '0xUSDC',
      amount,
      payee: '0xPayee',
      issued_at: '2026-08-09T00:00:00.000Z',
      expires_at: '2026-08-09T00:05:00.000Z',
    });
    const { requirement } = await buildExactPaymentRequirement({
      quote,
      resource_id: 'https://api.siteborne.dev/v1/company_evidence_graph',
      maxTimeoutSeconds: 60,
    });
    const challenge = buildPaymentRequired({
      resource: { url: 'https://api.siteborne.dev/v1/company_evidence_graph' },
      accepts: [requirement],
    });
    const header = encodePaymentRequiredHeaderSafe(challenge);
    const decoded = decodePaymentRequiredHeaderSafe(header);
    expect(decoded.ok).toBe(true);

    decodePaymentSignatureHeaderSafe('!!!');
    decodePaymentResponseHeaderSafe('!!!');

    validatePaymentPayloadStructure(
      {
        x402Version: 2,
        resource: { url: 'https://api.siteborne.dev/v1/company_evidence_graph' },
        accepted: requirement,
        payload: {},
      },
      {
        quote,
        resource_id: 'https://api.siteborne.dev/v1/company_evidence_graph',
        now_iso: '2026-08-09T00:01:00.000Z',
      }
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('directive §33: the checkpoint-3 evidence/linkage lifecycle path (canAdvanceToVerified, canAdvanceToSettled, usage-result, PaymentServiceLink) performs zero fetch calls — "verify"/"settle" here mean local structural validation against modeled evidence only, never a real facilitator /verify or /settle call', async () => {
    const ctx: PaymentEvidenceContext = {
      service_id: 'company_evidence_graph.v1',
      service_version: 'v1',
      scheme: 'exact',
      network: 'eip155:8453',
      asset: '0xUSDC',
      payee: '0xPayee',
      quote_id: 'qte_' + '1'.repeat(24),
      requirement_id: 'req_' + '1'.repeat(24),
      payment_identifier: 'pay_' + '1'.repeat(28),
      amount: '39000',
      nowIso: '2026-08-09T00:00:00.000Z',
      expiresAt: '2026-08-09T00:05:00.000Z',
    };
    const { syntheticVerificationEvidenceSuccess, syntheticSettlementEvidenceSuccess } =
      await import('../evidence/fixtures');
    const { canAdvanceToVerified } = await import('../evidence/verification');
    const { canAdvanceToSettled } = await import('../evidence/settlement');
    const { buildUsageResult } = await import('../linkage/usage-result');
    const { buildPaymentServiceLink } = await import('../linkage/payment-service-link');
    const { hashPaymentObject } = await import('../canonical');

    const verificationEvidence = await syntheticVerificationEvidenceSuccess(ctx);
    expect(canAdvanceToVerified(verificationEvidence, ctx, 'fixture')).toEqual({ allowed: true });

    const verificationHash = await hashPaymentObject(verificationEvidence);
    const settlementEvidence = await syntheticSettlementEvidenceSuccess(
      ctx,
      verificationHash,
      ctx.amount
    );
    expect(canAdvanceToSettled(settlementEvidence, ctx, 'fixture', verificationHash)).toEqual({
      allowed: true,
    });

    const usageResult = await buildUsageResult({
      quote_id: ctx.quote_id,
      requirement_id: ctx.requirement_id,
      payment_identifier: ctx.payment_identifier,
      service_id: ctx.service_id,
      service_version: 'v1',
      request_input_hash: 'sha256:' + '1'.repeat(64),
      service_output_hash: 'sha256:' + '2'.repeat(64),
      verification_receipt_id: 'rcpt_' + '1'.repeat(24),
      verification_receipt_hash: 'sha256:' + '4'.repeat(64),
      resource_metrics_hash: 'sha256:' + '3'.repeat(64),
      actual_amount: '1',
      authorized_maximum: '1',
    });
    await buildPaymentServiceLink({
      payment_identifier: ctx.payment_identifier,
      quote_id: ctx.quote_id,
      requirement_id: ctx.requirement_id,
      service_id: ctx.service_id,
      service_version: 'v1',
      request_input_hash: 'sha256:' + '1'.repeat(64),
      job_id: 'job_' + '1'.repeat(24),
      service_output_hash: usageResult.service_output_hash,
      verification_receipt_id: usageResult.verification_receipt_id,
      verification_receipt_hash: 'sha256:' + '4'.repeat(64),
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('directive §36 (checkpoint 4): building and locally validating all four Bazaar discovery declarations performs zero fetch calls — no facilitator request, no Bazaar listing query/search, no DID resolution, no wallet/RPC/CDP call', async () => {
    const { buildSiteborneDiscoveryDeclaration } = await import('../bazaar/discovery');
    const { validateSiteborneDiscoveryResource } = await import('../bazaar/validator');
    const { ALL_BAZAAR_SERVICE_IDS } = await import('../bazaar/registry-source');

    for (const serviceId of ALL_BAZAAR_SERVICE_IDS) {
      const resource = await buildSiteborneDiscoveryDeclaration({
        serviceId,
        nowIso: '2026-08-10T00:00:00.000Z',
        expiresInSeconds: 300,
        maxTimeoutSeconds: 120,
      });
      const validation = validateSiteborneDiscoveryResource(serviceId, resource);
      expect(validation.valid).toBe(true);
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('no-credential proof (static source audit)', () => {
  const SRC_DIR = fileURLToPath(new URL('..', import.meta.url));

  function collectTsFiles(dir: string): string[] {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectTsFiles(full));
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        files.push(full);
      }
    }
    return files;
  }

  it('no source file in this package references a CDP_-prefixed environment variable', () => {
    const files = collectTsFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      expect(content).not.toMatch(/CDP_API_KEY|CDP_WALLET|process\.env\.CDP_/);
    }
  });

  it('no source file in this package imports a facilitator/wallet client (@x402/core/facilitator, viem, wagmi)', () => {
    const files = collectTsFiles(SRC_DIR);
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      expect(content).not.toMatch(/@x402\/core\/facilitator|from ['"]viem|from ['"]wagmi/);
    }
  });

  it('the only @x402/extensions subpaths imported anywhere in this package are payment-identifier and bazaar — never sign-in-with-x, offer-receipt, or builder-code (those pull in viem/jose/tweetnacl/@noble/curves/@scure/base transitively; bazaar itself was verified to import only ajv — see fixtures/x402-spec-baseline.json)', () => {
    const files = collectTsFiles(SRC_DIR);
    const allowedSubpaths = new Set([
      '@x402/extensions/payment-identifier',
      '@x402/extensions/bazaar',
    ]);
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      const matches = content.match(/@x402\/extensions\/[a-z-]+/g) ?? [];
      for (const match of matches) {
        expect(allowedSubpaths.has(match)).toBe(true);
      }
    }
  });

  it('no source file in this package imports the offer-receipt extension subpath (jose/viem/@noble/curves) — SUN-0700A checkpoint 4 deliberately defers Signed Offers & Receipts, see docs/decisions/0050-signed-offers-and-receipts-decision.md', () => {
    const files = collectTsFiles(SRC_DIR);
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      expect(content).not.toMatch(/@x402\/extensions\/offer-receipt/);
      expect(content).not.toMatch(/from ['"]jose['"]/);
    }
  });

  it('no source file in this package calls the Bazaar client-query functions (withBazaar, .listResources, .search) — SUN-0700A only ever declares/validates discovery metadata locally, never queries a live Bazaar catalog', () => {
    const files = collectTsFiles(SRC_DIR);
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      expect(content).not.toMatch(/\bwithBazaar\b/);
      expect(content).not.toMatch(/\.listResources\s*\(/);
      expect(content).not.toMatch(/extensions\.bazaar\.search\s*\(/);
    }
  });

  it('no source file in this package directly opens governance/RISK_LIMITS.yaml — pricing must be consumed through @siteborne/pricing (see docs/decisions/0042); documenting the boundary in a comment is fine, actually opening the file is not', () => {
    const files = collectTsFiles(SRC_DIR);
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      expect(content).not.toMatch(/readFileSync\([^)]*RISK_LIMITS/);
      expect(content).not.toMatch(/new URL\([^)]*RISK_LIMITS/);
    }
  });
});

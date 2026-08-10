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

  it('the only @x402/extensions subpath imported anywhere in this package is payment-identifier — not sign-in-with-x, offer-receipt, bazaar, or builder-code (those pull in viem/jose/tweetnacl/siwe transitively)', () => {
    const files = collectTsFiles(SRC_DIR);
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      const matches = content.match(/@x402\/extensions\/[a-z-]+/g) ?? [];
      for (const match of matches) {
        expect(match).toBe('@x402/extensions/payment-identifier');
      }
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

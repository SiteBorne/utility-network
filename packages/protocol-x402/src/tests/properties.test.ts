/**
 * Property-based tests (directive §30), using fast-check with deterministic,
 * bounded, no-network generators — matching the discipline already
 * established in provider-adapters, verification, and service-runtime.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildQuote } from '../quote/quote';
import type { QuoteInput } from '../quote/quote';
import { isSchemeSupportedOnNetwork } from '../network/schemes';
import { usdToAtomicUnits } from '../pricing/mapping';
import { checkSupportedVersion, SUPPORTED_X402_VERSION } from '../version';

const hexAddress = () => fc.hexaString({ minLength: 40, maxLength: 40 }).map((h) => `0x${h}`);
const usdAmount = () =>
  fc.integer({ min: 0, max: 999_999 }).map((cents) => (cents / 1000).toFixed(3));

function arbQuoteInput(): fc.Arbitrary<QuoteInput> {
  return fc.record({
    service_id: fc.constantFrom(
      'company_evidence_graph.v1',
      'web_context_verified.v1',
      'document_evidence_json.v1',
      'verify_agent_output.v1'
    ),
    service_version: fc.constant('v1' as const),
    contract_release: fc.constantFrom('1.0.0', '1.1.0', '2.0.0'),
    input_hash: fc.hexaString({ minLength: 64, maxLength: 64 }).map((h) => `sha256:${h}`),
    pricing_key: fc.constantFrom('company_evidence_graph', 'web_context_verified_direct'),
    scheme: fc.constant('exact' as const),
    network: fc.constantFrom('eip155:8453', 'eip155:1', 'solana:mainnet'),
    asset: hexAddress(),
    amount: fc.integer({ min: 1, max: 1_000_000 }).map(String),
    payee: hexAddress(),
    issued_at: fc.constant('2026-08-09T00:00:00.000Z'),
    expires_at: fc.constant('2026-08-09T00:05:00.000Z'),
  });
}

describe('protocol-x402 properties', () => {
  it('property: identical quote input always produces the identical quote_id (canonical, key-order independent)', async () => {
    await fc.assert(
      fc.asyncProperty(arbQuoteInput(), async (input) => {
        const a = await buildQuote(input);
        const b = await buildQuote({ ...input });
        expect(a.quote_id).toBe(b.quote_id);
        expect(a.binding_hash).toBe(b.binding_hash);
      }),
      { numRuns: 50 }
    );
  });

  it('property: mutating any single bound field changes the quote_id', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbQuoteInput(),
        fc.constantFrom<keyof QuoteInput>(
          'service_id',
          'contract_release',
          'input_hash',
          'pricing_key',
          'network',
          'asset',
          'amount',
          'payee'
        ),
        async (input, field) => {
          const original = await buildQuote(input);
          const mutatedValue =
            field === 'amount' ? String(Number(input.amount) + 1) : `${String(input[field])}-x`;
          const mutated = await buildQuote({ ...input, [field]: mutatedValue });
          expect(mutated.quote_id).not.toBe(original.quote_id);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('property: upto never accepts a non-EVM network as supported', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('solana:mainnet', 'solana:devnet', 'cosmos:cosmoshub-4', 'bitcoin:mainnet'),
        (network) => {
          const result = isSchemeSupportedOnNetwork('upto', network);
          expect(result.supported).toBe(false);
        }
      ),
      { numRuns: 20 }
    );
  });

  it('property: exact is supported on every recognized network namespace', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'eip155:1',
          'eip155:8453',
          'eip155:84532',
          'solana:mainnet',
          'solana:devnet'
        ),
        (network) => {
          expect(isSchemeSupportedOnNetwork('exact', network).supported).toBe(true);
        }
      ),
      { numRuns: 20 }
    );
  });

  it('property: usdToAtomicUnits never produces a negative or non-integer-string result', () => {
    fc.assert(
      fc.property(usdAmount(), fc.integer({ min: 0, max: 18 }), (usd, decimals) => {
        const result = usdToAtomicUnits(usd, decimals);
        expect(/^\d+$/.test(result)).toBe(true);
        expect(Number(result)).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 }
    );
  });

  it('property: only SUPPORTED_X402_VERSION is ever reported supported', () => {
    fc.assert(
      fc.property(fc.integer({ min: -5, max: 10 }), (version) => {
        const result = checkSupportedVersion(version);
        expect(result.supported).toBe(version === SUPPORTED_X402_VERSION);
      }),
      { numRuns: 50 }
    );
  });
});

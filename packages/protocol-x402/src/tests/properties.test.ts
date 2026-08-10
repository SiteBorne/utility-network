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
import { computeBindingDigest, bindingsAreIdentical } from '../replay/binding';
import type { PaymentAttemptBinding } from '../replay/binding';
import { isCanonicalAtomicAmount } from '../requirements/upto';
import { InMemoryPaymentAttemptRepository } from '../replay/repository';
import { acquirePaymentAttempt } from '../replay/idempotency';

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

  function arbBinding(): fc.Arbitrary<PaymentAttemptBinding> {
    return fc.record({
      payment_identifier: fc.hexaString({ minLength: 24, maxLength: 24 }).map((h) => `pay_${h}`),
      quote_id: fc.hexaString({ minLength: 24, maxLength: 24 }).map((h) => `qte_${h}`),
      requirement_id: fc.hexaString({ minLength: 24, maxLength: 24 }).map((h) => `req_${h}`),
      service_id: fc.constantFrom(
        'company_evidence_graph.v1',
        'web_context_verified.v1',
        'document_evidence_json.v1',
        'verify_agent_output.v1'
      ),
      service_version: fc.constant('v1' as const),
      contract_release: fc.constantFrom('1.0.0', '1.1.0'),
      request_input_hash: fc.hexaString({ minLength: 64, maxLength: 64 }).map((h) => `sha256:${h}`),
      resource_id: fc.constantFrom(
        'https://api.siteborne.dev/v1/a',
        'https://api.siteborne.dev/v1/b'
      ),
      scheme: fc.constantFrom('exact' as const, 'upto' as const),
      network: fc.constantFrom('eip155:8453', 'eip155:1'),
      asset: hexAddress(),
      amount: fc.integer({ min: 1, max: 1_000_000 }).map(String),
      payee: hexAddress(),
    });
  }

  it('property: binding digest is deterministic and key-insertion-order irrelevant', async () => {
    await fc.assert(
      fc.asyncProperty(arbBinding(), async (binding) => {
        const a = await computeBindingDigest(binding);
        const b = await computeBindingDigest({ ...binding });
        expect(a).toBe(b);
        expect(bindingsAreIdentical(binding, { ...binding })).toBe(true);
      }),
      { numRuns: 50 }
    );
  });

  it('property: mutating any single immutable binding field changes the digest', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbBinding(),
        fc.constantFrom<keyof PaymentAttemptBinding>(
          'payment_identifier',
          'quote_id',
          'requirement_id',
          'service_id',
          'contract_release',
          'request_input_hash',
          'resource_id',
          'scheme',
          'network',
          'asset',
          'amount',
          'payee'
        ),
        async (binding, field) => {
          const mutatedValue = `${String(binding[field])}-x`;
          const mutated = { ...binding, [field]: mutatedValue };
          const a = await computeBindingDigest(binding);
          const b = await computeBindingDigest(mutated);
          expect(a).not.toBe(b);
          expect(bindingsAreIdentical(binding, mutated)).toBe(false);
        }
      ),
      { numRuns: 60 }
    );
  });

  it('property: isCanonicalAtomicAmount accepts every non-negative integer string it produces from a bounded fc.nat, and rejects any value with a decimal point or sign', () => {
    fc.assert(
      fc.property(fc.nat({ max: Number.MAX_SAFE_INTEGER }), (n) => {
        expect(isCanonicalAtomicAmount(String(n))).toBe(true);
      }),
      { numRuns: 100 }
    );
    fc.assert(
      fc.property(fc.nat({ max: 1_000_000 }), fc.constantFrom('.', '-', '+', 'e'), (n, symbol) => {
        expect(isCanonicalAtomicAmount(`${n}${symbol}1`)).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  it('property: replay classification is monotonic — a first_seen identifier never spontaneously reverts to first_seen on a later call', async () => {
    await fc.assert(
      fc.asyncProperty(arbBinding(), async (binding) => {
        const repo = new InMemoryPaymentAttemptRepository();
        const first = await acquirePaymentAttempt(repo, {
          binding,
          nowIso: '2026-08-09T00:00:00.000Z',
          ttlMs: 5 * 60 * 1000,
        });
        expect(first.status).toBe('first_seen');
        const second = await acquirePaymentAttempt(repo, {
          binding,
          nowIso: '2026-08-09T00:00:01.000Z',
          ttlMs: 5 * 60 * 1000,
        });
        expect(second.status).not.toBe('first_seen');
        expect(second.status).toBe('duplicate_same');
      }),
      { numRuns: 30 }
    );
  });

  it('property: a payment identifier never acquires two conflicting owners under concurrent acquisition', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbBinding(),
        fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 3, maxLength: 8 }),
        async (binding, amounts) => {
          const repo = new InMemoryPaymentAttemptRepository();
          const bindings = amounts.map((amount) => ({ ...binding, amount: String(amount) }));
          const results = await Promise.all(
            bindings.map((b) =>
              acquirePaymentAttempt(repo, {
                binding: b,
                nowIso: '2026-08-09T00:00:00.000Z',
                ttlMs: 5 * 60 * 1000,
              })
            )
          );
          const owners = new Set(
            results
              .filter((r) => r.status === 'first_seen')
              .map((r) => (r as { record: { binding_digest: string } }).record.binding_digest)
          );
          expect(owners.size).toBeLessThanOrEqual(1);
        }
      ),
      { numRuns: 20 }
    );
  });
});

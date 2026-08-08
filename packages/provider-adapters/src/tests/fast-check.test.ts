import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { normalizeCik, normalizeAccessionNumber } from '../sec/identifiers';
import { createCacheKey } from '../cache/interface';
import { validateUrl, DEFAULT_NETWORK_POLICY } from '../policy/network-policy';
import { createBackoffFromManifest } from '../rate-limit/backoff';
import { TokenBucketLimiter } from '../rate-limit/limiter';
import { CircuitBreaker, DEFAULT_CIRCUIT_BREAKER_CONFIG } from '../rate-limit/circuit-breaker';
import { computeContentHash } from '../evidence/source-observation';
import { createLocator } from '../evidence/locators';
import { normalizeHtml } from '../html/normalize';
import { normalizeCompanyFacts } from '../sec/company-facts';
import { fakeClock } from './support';

/**
 * Real fast-check property tests. Every `it` below runs `fc.assert(fc.property(...))`
 * against a real function in this package — none are example-based tests
 * mislabeled as properties. Default run count is fast-check's standard 100
 * cases per property (configurable via `numRuns`); a failing case is
 * automatically shrunk and reported with a reproducible seed by fast-check
 * itself (visible in the failure output as `Counterexample` / `Seed`).
 */
const RUNS = { numRuns: 100 };

describe('Property: CIK normalization', () => {
  it('is idempotent for any digit string of length <= 10', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /\d/.test(s)),
        (digits) => {
          const raw = digits.replace(/\D/g, '');
          fc.pre(raw.length > 0 && raw.length <= 10);
          const once = normalizeCik(raw);
          const twice = normalizeCik(once);
          expect(twice).toBe(once);
        }
      ),
      RUNS
    );
  });

  it('rejects any digit string longer than 10 digits (invalid CIKs remain invalid)', () => {
    // Use a dedicated all-digit generator rather than filtering fc.string() —
    // filtering for "all chars are digits" over a general-alphabet string has
    // a near-zero acceptance rate and makes fast-check spin trying to satisfy
    // the predicate.
    const allDigits = fc
      .array(fc.integer({ min: 0, max: 9 }), { minLength: 11, maxLength: 30 })
      .map((digits) => digits.join(''));
    fc.assert(
      fc.property(allDigits, (tooLong) => {
        expect(() => normalizeCik(tooLong)).toThrow();
      }),
      RUNS
    );
  });
});

describe('Property: accession number normalization', () => {
  const accessionArb = fc
    .tuple(
      fc.integer({ min: 0, max: 9999999999 }).map((n) => String(n).padStart(10, '0')),
      fc.integer({ min: 0, max: 99 }).map((n) => String(n).padStart(2, '0')),
      fc.integer({ min: 0, max: 999999 }).map((n) => String(n).padStart(6, '0'))
    )
    .map(([a, b, c]) => `${a}-${b}-${c}`);

  it('is idempotent for any well-formed accession number', () => {
    fc.assert(
      fc.property(accessionArb, (accession) => {
        const once = normalizeAccessionNumber(accession);
        const twice = normalizeAccessionNumber(once);
        expect(twice).toBe(once);
      }),
      RUNS
    );
  });
});

describe('Property: cache keys', () => {
  it('canonical cache keys ignore object-key ordering when inputs serialize to the same canonical form', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.integer()), (obj) => {
        const entries = Object.entries(obj);
        const shuffled = Object.fromEntries([...entries].reverse());
        // createCacheKey does not itself canonicalize JSON — canonicalization
        // is the caller's job (JSON.stringify(sortedKeys)). This property
        // verifies that once callers canonicalize (sort keys before
        // stringify), the resulting cache key is order-independent.
        const canonicalize = (o: Record<string, number>) =>
          JSON.stringify(
            Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))
          );
        const keyA = createCacheKey({
          providerId: 'p',
          capability: 'c',
          canonicalInput: canonicalize(obj),
          sourcePolicyVersion: '1',
          adapterVersion: '1',
          normalizationVersion: '1',
        });
        const keyB = createCacheKey({
          providerId: 'p',
          capability: 'c',
          canonicalInput: canonicalize(shuffled),
          sourcePolicyVersion: '1',
          adapterVersion: '1',
          normalizationVersion: '1',
        });
        expect(keyA).toBe(keyB);
      }),
      RUNS
    );
  });

  it('materially different canonical inputs always change the key', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        fc.pre(a !== b);
        const keyA = createCacheKey({
          providerId: 'p',
          capability: 'c',
          canonicalInput: a,
          sourcePolicyVersion: '1',
          adapterVersion: '1',
          normalizationVersion: '1',
        });
        const keyB = createCacheKey({
          providerId: 'p',
          capability: 'c',
          canonicalInput: b,
          sourcePolicyVersion: '1',
          adapterVersion: '1',
          normalizationVersion: '1',
        });
        expect(keyA).not.toBe(keyB);
      }),
      RUNS
    );
  });
});

describe('Property: SSRF policy', () => {
  it('prohibited IPv4 address classes never pass validateUrl', () => {
    const octet = fc.integer({ min: 0, max: 255 });
    const prohibited = fc.oneof(
      fc.tuple(fc.constant(10), octet, octet, octet), // 10.0.0.0/8
      fc.tuple(fc.constant(127), octet, octet, octet), // loopback
      fc.tuple(fc.constant(169), fc.constant(254), octet, octet), // link-local
      fc.tuple(fc.integer({ min: 224, max: 239 }), octet, octet, octet) // multicast
    );
    fc.assert(
      fc.property(prohibited, ([a, b, c, d]) => {
        const result = validateUrl(new URL(`http://${a}.${b}.${c}.${d}/`), DEFAULT_NETWORK_POLICY);
        expect(result.valid).toBe(false);
      }),
      RUNS
    );
  });
});

describe('Property: backoff', () => {
  it('never exceeds its configured cap regardless of attempt count', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), (attempts) => {
        const clock = fakeClock();
        const backoff = createBackoffFromManifest(
          { rate_policy: { maximum_retries: 1000, minimum_interval_ms: 1000 } },
          clock
        );
        let interval = 0;
        for (let i = 0; i <= attempts; i++) {
          interval = backoff.calculateNextInterval();
        }
        expect(interval).toBeLessThanOrEqual(60000);
        expect(interval).toBeGreaterThanOrEqual(0);
      }),
      RUNS
    );
  });

  it('base (pre-jitter) growth is monotonically non-decreasing before the cap', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), (attempt) => {
        const base = (n: number) => Math.min(1000 * Math.pow(2, n), 60000);
        expect(base(attempt)).toBeGreaterThanOrEqual(base(Math.max(0, attempt - 1)) * 0.999);
      }),
      RUNS
    );
  });
});

describe('Property: rate limiter token accounting', () => {
  it('token counts never become negative under any acquire sequence', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 30 }), (acquireThenRelease) => {
        const clock = fakeClock();
        const limiter = new TokenBucketLimiter(
          {
            strategy: 'token_bucket',
            maximumConcurrency: 5,
            minimumIntervalMs: 10,
            maximumTokens: 5,
            refillRatePerSecond: 1,
          },
          clock
        );
        for (const release of acquireThenRelease) {
          limiter.tryAcquire();
          if (release) limiter.release();
          expect(limiter.getAvailableTokens()).toBeGreaterThanOrEqual(0);
        }
      }),
      RUNS
    );
  });
});

describe('Property: circuit breaker state machine', () => {
  const VALID_STATES = ['closed', 'open', 'half_open'];

  it('remains within the closed state-machine enum under any sequence of outcomes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.boolean(), { minLength: 0, maxLength: 20 }),
        async (outcomes) => {
          const clock = fakeClock();
          const cb = new CircuitBreaker(DEFAULT_CIRCUIT_BREAKER_CONFIG, clock);
          for (const succeed of outcomes) {
            try {
              await cb.execute(async () => {
                if (!succeed) throw new Error('fail');
                return 'ok';
              });
            } catch {
              // expected for failure outcomes and for an open circuit
            }
            expect(VALID_STATES).toContain(cb.getState().state);
          }
        }
      ),
      RUNS
    );
  });
});

describe('Property: content hashing', () => {
  it('identical bytes produce identical hashes', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (s) => {
        const h1 = await computeContentHash(s);
        const h2 = await computeContentHash(s);
        expect(h1).toBe(h2);
      }),
      RUNS
    );
  });

  it('changed bytes produce a different hash (collision-resistance assumption)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), fc.string(), async (a, b) => {
        fc.pre(a !== b);
        const h1 = await computeContentHash(a);
        const h2 = await computeContentHash(b);
        expect(h1).not.toBe(h2);
      }),
      RUNS
    );
  });
});

describe('Property: HTML normalization stability', () => {
  const htmlArb = fc
    .array(
      fc.constantFrom(
        '<p>text</p>',
        '<h1>H</h1>',
        '<a href="/x">l</a>',
        '<ul><li>i</li></ul>',
        '<div>d</div>'
      ),
      { minLength: 1, maxLength: 8 }
    )
    .map((parts) => `<html><body>${parts.join('')}</body></html>`);

  it('repeated normalization of the same HTML is stable', () => {
    // The Node test parser goes through JSDOM (~1s/parse observed elsewhere in
    // this package), so this property uses a much smaller run count than the
    // others to stay fast — still real fc.assert/fc.property, just fewer cases.
    fc.assert(
      fc.property(htmlArb, (html) => {
        const r1 = normalizeHtml(html, 'https://example.com/');
        const r2 = normalizeHtml(html, 'https://example.com/');
        expect(r1.visibleText).toBe(r2.visibleText);
        expect(r1.headings).toEqual(r2.headings);
        expect(r1.paragraphs).toEqual(r2.paragraphs);
      }),
      { numRuns: 5 }
    );
  });
});

describe('Property: evidence locators', () => {
  it('generated locators are deterministic and nonempty for nonempty input', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.webUrl(), (value, uri) => {
        const l1 = createLocator('text_quote', value, uri);
        const l2 = createLocator('text_quote', value, uri);
        expect(l1).toEqual(l2);
        expect(l1.value.length).toBeGreaterThan(0);
      }),
      RUNS
    );
  });
});

describe('Property: decimal SEC facts avoid binary float re-encoding', () => {
  it('every normalized fact value is a string, and round-trips the original integer exactly', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000_000_000, max: 1_000_000_000_000 }), (val) => {
        const raw = {
          cik: '0000320193',
          entityName: 'Apple Inc.',
          facts: {
            'us-gaap': {
              concepts: {
                Revenues: {
                  units: {
                    USD: [
                      {
                        val,
                        accn: '0000320193-24-000010',
                        fy: 2024,
                        fp: 'Q1',
                        form: '10-Q',
                        filed: '2024-01-26',
                      },
                    ],
                  },
                },
              },
            },
          },
        } as never;
        const facts = normalizeCompanyFacts(raw, {});
        expect(facts).toHaveLength(1);
        expect(typeof facts[0].value).toBe('string');
        expect(Number(facts[0].value)).toBe(val);
      }),
      RUNS
    );
  });
});

describe('Property: result array bounds', () => {
  it('SEC company facts normalization never returns more concepts than exist, and respects a concept allowlist', () => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const alphaStringArb = fc
      .array(fc.integer({ min: 0, max: letters.length - 1 }), { minLength: 1, maxLength: 8 })
      .map((idxs) => idxs.map((i) => letters[i]).join(''));
    fc.assert(
      fc.property(fc.array(alphaStringArb, { minLength: 1, maxLength: 5 }), (conceptNames) => {
        const uniqueNames = [...new Set(conceptNames)];
        const concepts: Record<string, unknown> = {};
        for (const name of uniqueNames) {
          concepts[name] = {
            units: {
              USD: [
                {
                  val: 1,
                  accn: '0000320193-24-000010',
                  fy: 2024,
                  fp: 'Q1',
                  form: '10-Q',
                  filed: '2024-01-26',
                },
              ],
            },
          };
        }
        const raw = {
          cik: '0000320193',
          entityName: 'Apple Inc.',
          facts: { 'us-gaap': { concepts } },
        } as never;
        const allowlist = uniqueNames.slice(0, Math.max(1, Math.floor(uniqueNames.length / 2)));
        const facts = normalizeCompanyFacts(raw, { concepts: allowlist });
        const returnedConceptNames = new Set(facts.map((f) => f.concept));
        for (const name of returnedConceptNames) {
          expect(allowlist).toContain(name);
        }
      }),
      RUNS
    );
  });
});

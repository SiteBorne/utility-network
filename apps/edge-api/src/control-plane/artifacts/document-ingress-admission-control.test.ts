/**
 * SUN-1222C0-R1 — genuine RED→GREEN→mutation-proof coverage for the
 * document-ingress distributed admission control. Uses the real
 * `InMemoryDocumentIngressAdmissionRepository` (mirrors
 * `artifact-reclamation.test.ts`'s own stated preference for real
 * implementations over hand-rolled mocks wherever the interface itself is
 * what's under test) — its atomicity guarantee is a property of the
 * interface contract, not a stub, so proving it here is meaningful.
 */
import { describe, expect, it } from 'vitest';
import {
  checkDocumentIngressAdmission,
  extractDocumentIngressSourceKey,
  normalizeSourceKey,
  DOCUMENT_INGRESS_PER_SOURCE_LIMIT,
  DOCUMENT_INGRESS_GLOBAL_LIMIT,
  DOCUMENT_INGRESS_ADMISSION_WINDOW_SECONDS,
  type DocumentIngressAdmissionDeps,
} from './document-ingress-admission-control';
import { InMemoryDocumentIngressAdmissionRepository } from '../repositories/in-memory';
import type {
  DocumentIngressAdmissionRepository,
  RepositoryResponse,
} from '../repositories/interfaces';
import { ok } from '../repositories/interfaces';

function deps(
  repository: DocumentIngressAdmissionRepository,
  nowMs: number
): DocumentIngressAdmissionDeps {
  return { repository, nowMs: () => nowMs };
}

const T0 = Date.parse('2026-09-10T00:00:00.000Z');

describe('normalizeSourceKey', () => {
  it('normalizes IPv4 leading zeros to the same key', () => {
    expect(normalizeSourceKey('192.168.001.010')).toBe(normalizeSourceKey('192.168.1.10'));
    expect(normalizeSourceKey('192.168.1.10')).toBe('192.168.1.10');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(normalizeSourceKey(' 2001:DB8::1 ')).toBe(normalizeSourceKey('2001:db8::1'));
  });

  it('collapses equivalent IPv6 :: shorthand and fully-expanded forms to the same key', () => {
    const shorthand = normalizeSourceKey('2001:db8::1');
    const expanded = normalizeSourceKey('2001:0db8:0000:0000:0000:0000:0000:0001');
    expect(shorthand).toBe(expanded);
  });

  it('collapses IPv4-mapped IPv6 with leading zeros to the same key as its clean form', () => {
    const a = normalizeSourceKey('::ffff:1.2.3.4');
    const b = normalizeSourceKey('::ffff:001.002.003.004');
    expect(a).toBe(b);
  });

  it('strips a zone id (not part of address identity for quota purposes)', () => {
    expect(normalizeSourceKey('fe80::1%eth0')).toBe(normalizeSourceKey('fe80::1'));
  });

  it('does NOT collapse two genuinely different addresses to the same key', () => {
    expect(normalizeSourceKey('192.168.1.10')).not.toBe(normalizeSourceKey('192.168.1.11'));
    expect(normalizeSourceKey('2001:db8::1')).not.toBe(normalizeSourceKey('2001:db8::2'));
    expect(normalizeSourceKey('2001:db8::1')).not.toBe(normalizeSourceKey('192.168.1.10'));
  });

  it('canonicalizes ::1 (loopback) and :: (unspecified) deterministically without throwing', () => {
    expect(() => normalizeSourceKey('::1')).not.toThrow();
    expect(() => normalizeSourceKey('::')).not.toThrow();
    expect(normalizeSourceKey('::1')).not.toBe(normalizeSourceKey('::'));
  });
});

describe('extractDocumentIngressSourceKey', () => {
  function headerMap(headers: Record<string, string>) {
    return (name: string) => headers[name.toLowerCase()];
  }

  it('trusts ONLY cf-connecting-ip', () => {
    const key = extractDocumentIngressSourceKey(headerMap({ 'cf-connecting-ip': '203.0.113.9' }));
    expect(key).toBe('203.0.113.9');
  });

  it('§18 SOURCE_SPOOFING_MATRIX: never trusts X-Forwarded-For as a fallback identity', () => {
    // A caller supplying ONLY a forged X-Forwarded-For, with no real
    // CF-Connecting-IP, must fail closed (null), not silently adopt the
    // attacker-controlled value.
    const key = extractDocumentIngressSourceKey(
      headerMap({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' })
    );
    expect(key).toBeNull();
  });

  it('ignores an attacker-supplied X-Forwarded-For even when a real CF-Connecting-IP is also present', () => {
    const trusted = extractDocumentIngressSourceKey(
      headerMap({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '6.6.6.6' })
    );
    const attackerClaimed = extractDocumentIngressSourceKey(
      headerMap({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '9.9.9.9' })
    );
    // Same real identity, different forged headers -- must resolve to the
    // exact same key, proving the forged header changes nothing.
    expect(trusted).toBe(attackerClaimed);
  });

  it('returns null (fail-closed signal) when cf-connecting-ip is missing or empty', () => {
    expect(extractDocumentIngressSourceKey(headerMap({}))).toBeNull();
    expect(extractDocumentIngressSourceKey(headerMap({ 'cf-connecting-ip': '' }))).toBeNull();
    expect(extractDocumentIngressSourceKey(headerMap({ 'cf-connecting-ip': '   ' }))).toBeNull();
  });
});

describe('checkDocumentIngressAdmission — per-source axis', () => {
  it('§16 GREEN: admits requests within the per-source limit', async () => {
    const repo = new InMemoryDocumentIngressAdmissionRepository();
    const d = deps(repo, T0);
    for (let i = 0; i < DOCUMENT_INGRESS_PER_SOURCE_LIMIT; i++) {
      const decision = await checkDocumentIngressAdmission(d, 'source-a');
      expect(decision.allowed).toBe(true);
    }
  });

  it('§16 exact boundary: the (limit+1)-th request from the same source in the same window is rejected with scope per_source', async () => {
    const repo = new InMemoryDocumentIngressAdmissionRepository();
    const d = deps(repo, T0);
    for (let i = 0; i < DOCUMENT_INGRESS_PER_SOURCE_LIMIT; i++) {
      await checkDocumentIngressAdmission(d, 'source-a');
    }
    const rejected = await checkDocumentIngressAdmission(d, 'source-a');
    expect(rejected.allowed).toBe(false);
    expect(rejected.scope).toBe('per_source');
    expect(rejected.retryAfterSeconds).toBe(DOCUMENT_INGRESS_ADMISSION_WINDOW_SECONDS);
  });

  it('§16 subsequent over-limit requests also stay rejected', async () => {
    const repo = new InMemoryDocumentIngressAdmissionRepository();
    const d = deps(repo, T0);
    for (let i = 0; i < DOCUMENT_INGRESS_PER_SOURCE_LIMIT; i++) {
      await checkDocumentIngressAdmission(d, 'source-a');
    }
    const first = await checkDocumentIngressAdmission(d, 'source-a');
    const second = await checkDocumentIngressAdmission(d, 'source-a');
    expect(first.allowed).toBe(false);
    expect(second.allowed).toBe(false);
  });

  it('§16 a new, independent source has its own independent quota', async () => {
    const repo = new InMemoryDocumentIngressAdmissionRepository();
    const d = deps(repo, T0);
    for (let i = 0; i < DOCUMENT_INGRESS_PER_SOURCE_LIMIT; i++) {
      await checkDocumentIngressAdmission(d, 'source-a');
    }
    const exhaustedSourceRejected = await checkDocumentIngressAdmission(d, 'source-a');
    const freshSourceAdmitted = await checkDocumentIngressAdmission(d, 'source-b');
    expect(exhaustedSourceRejected.allowed).toBe(false);
    expect(freshSourceAdmitted.allowed).toBe(true);
  });

  it('§16 window reset: a source exhausted in one window is admissible again once the window advances', async () => {
    const repo = new InMemoryDocumentIngressAdmissionRepository();
    for (let i = 0; i < DOCUMENT_INGRESS_PER_SOURCE_LIMIT; i++) {
      await checkDocumentIngressAdmission(deps(repo, T0), 'source-a');
    }
    const stillInWindow = await checkDocumentIngressAdmission(deps(repo, T0 + 1000), 'source-a');
    expect(stillInWindow.allowed).toBe(false);

    const nextWindow = T0 + DOCUMENT_INGRESS_ADMISSION_WINDOW_SECONDS * 1000;
    const afterReset = await checkDocumentIngressAdmission(deps(repo, nextWindow), 'source-a');
    expect(afterReset.allowed).toBe(true);
  });

  it('§17 SOURCE_LIMIT_CONCURRENCY=PASS: N concurrent requests racing the last remaining slot admit at most 1', async () => {
    const repo = new InMemoryDocumentIngressAdmissionRepository();
    // Consume all but one slot sequentially first.
    for (let i = 0; i < DOCUMENT_INGRESS_PER_SOURCE_LIMIT - 1; i++) {
      await checkDocumentIngressAdmission(deps(repo, T0), 'source-race');
    }
    const CONCURRENT = 25;
    const results = await Promise.all(
      Array.from({ length: CONCURRENT }, () =>
        checkDocumentIngressAdmission(deps(repo, T0), 'source-race')
      )
    );
    const admitted = results.filter((r) => r.allowed).length;
    expect(admitted).toBe(1); // exactly the one remaining slot, never more
  });
});

describe('checkDocumentIngressAdmission — global axis', () => {
  it('§19 GLOBAL_ABUSE_BOUND=PASS: many distinct sources are each individually within their own per-source limit, but the aggregate is still bounded', async () => {
    const repo = new InMemoryDocumentIngressAdmissionRepository();
    const d = deps(repo, T0);
    let admittedCount = 0;
    let firstRejectionScope: string | undefined;
    // Each of many distinct synthetic sources makes only 1 request --
    // individually far below DOCUMENT_INGRESS_PER_SOURCE_LIMIT -- but the
    // sheer number of distinct sources exceeds the global budget.
    for (let i = 0; i < DOCUMENT_INGRESS_GLOBAL_LIMIT + 10; i++) {
      const decision = await checkDocumentIngressAdmission(d, `botnet-source-${i}`);
      if (decision.allowed) {
        admittedCount++;
      } else if (firstRejectionScope === undefined) {
        firstRejectionScope = decision.scope;
      }
    }
    expect(admittedCount).toBe(DOCUMENT_INGRESS_GLOBAL_LIMIT);
    expect(firstRejectionScope).toBe('global');
  });

  it('per-source is checked BEFORE global: a source already over its own limit is rejected with scope per_source even if global budget remains', async () => {
    const repo = new InMemoryDocumentIngressAdmissionRepository();
    const d = deps(repo, T0);
    for (let i = 0; i < DOCUMENT_INGRESS_PER_SOURCE_LIMIT; i++) {
      await checkDocumentIngressAdmission(d, 'source-a');
    }
    const decision = await checkDocumentIngressAdmission(d, 'source-a');
    expect(decision.allowed).toBe(false);
    expect(decision.scope).toBe('per_source');
  });
});

describe('checkDocumentIngressAdmission — §14 fail-closed on repository failure', () => {
  class ThrowingRepository implements DocumentIngressAdmissionRepository {
    async admitAndIncrement(): Promise<RepositoryResponse<{ admitted: boolean }>> {
      return { ok: false, error: { code: 'DATABASE_ERROR', message: 'simulated D1 outage' } };
    }
    async deleteWindowsOlderThan(): Promise<RepositoryResponse<number>> {
      return ok(0);
    }
  }

  it('MUTATION_TARGET §14 LIMITER_FAILURE_FAILS_CLOSED=YES: a repository error on the per-source axis fails closed, never falls back to unlimited', async () => {
    const decision = await checkDocumentIngressAdmission(
      deps(new ThrowingRepository(), T0),
      'any-source'
    );
    expect(decision.allowed).toBe(false);
    expect(decision.scope).toBe('limiter_unavailable');
  });

  class GlobalThrowingRepository implements DocumentIngressAdmissionRepository {
    async admitAndIncrement(windowKey: string): Promise<RepositoryResponse<{ admitted: boolean }>> {
      if (windowKey.startsWith('global:')) {
        return { ok: false, error: { code: 'DATABASE_ERROR', message: 'simulated D1 outage' } };
      }
      return ok({ admitted: true });
    }
    async deleteWindowsOlderThan(): Promise<RepositoryResponse<number>> {
      return ok(0);
    }
  }

  it('a repository error on the global axis (after per-source admits) also fails closed', async () => {
    const decision = await checkDocumentIngressAdmission(
      deps(new GlobalThrowingRepository(), T0),
      'any-source'
    );
    expect(decision.allowed).toBe(false);
    expect(decision.scope).toBe('limiter_unavailable');
  });
});

import { describe, it, expect } from 'vitest';
import {
  validateUrl,
  validateRedirectChain,
  DEFAULT_NETWORK_POLICY,
} from '../policy/network-policy';
import { PublicHttpAdapter } from '../http/public-http-adapter';
import {
  fakeClock,
  fakeArtifactStore,
  fakeAuditSink,
  unreachableHttpClient,
  buildContext,
} from './support';

/**
 * SSRF and destination-verification coverage.
 *
 * Exact status of each guarantee:
 * - URL and IP-literal validation: implemented and tested (this file).
 * - Injected DNS-answer validation: not implemented — `validateUrl` inspects
 *   the literal hostname in the URL; it does not resolve DNS and cannot
 *   reject a hostname whose *resolved* address is prohibited. There is no
 *   injected resolver in this codebase to test against. Documented as a gap,
 *   not claimed as covered.
 * - Redirect revalidation: implemented and tested — `SecureHttpClient.fetch`
 *   re-runs `validateUrl` against every `Location` target before following it.
 * - Connection pinning / rebinding protection: not implemented. `fetch()` is
 *   supplied by the runtime; nothing in this package binds the TCP connection
 *   to the address that was validated, so a DNS answer that changes between
 *   validation and connection (classic TOCTOU rebinding) is not defended
 *   against. blocked_external / scaffolded only — not proven here.
 */
describe('SSRF — URL and IP-literal validation (implemented, tested)', () => {
  const cases: Array<[string, string]> = [
    ['http://10.0.0.1/', 'IPv4 private range (10.0.0.0/8)'],
    ['http://172.16.0.1/', 'IPv4 private range (172.16.0.0/12)'],
    ['http://192.168.1.1/', 'IPv4 private range (192.168.0.0/16)'],
    ['http://127.0.0.1/', 'IPv4 loopback'],
    ['http://169.254.169.254/', 'IPv4 link-local (cloud metadata candidate)'],
    ['http://224.0.0.1/', 'IPv4 multicast'],
    ['http://0.0.0.0/', 'IPv4 reserved (0.0.0.0/8)'],
    ['http://255.255.255.255/', 'IPv4 reserved (broadcast range)'],
    ['http://localhost/', 'localhost hostname'],
    ['http://localhost.localdomain/', 'localhost subdomain'],
    ['http://[::1]/', 'IPv6 loopback'],
    ['http://[fe80::1]/', 'IPv6 link-local'],
    ['http://example.com:22/', 'blocked port (SSH)'],
    ['http://example.com:6379/', 'blocked port (Redis)'],
    ['ftp://example.com/', 'unsupported scheme'],
    ['file:///etc/passwd', 'unsupported scheme (file)'],
  ];

  for (const [url, description] of cases) {
    it(`rejects ${description}: ${url}`, () => {
      const result = validateUrl(new URL(url), DEFAULT_NETWORK_POLICY);
      expect(result.valid).toBe(false);
    });
  }

  it('accepts a well-formed public HTTPS URL', () => {
    const result = validateUrl(new URL('https://example.com/path'), DEFAULT_NETWORK_POLICY);
    expect(result.valid).toBe(true);
  });

  it('rejects fc00::/7 IPv6 unique-local', () => {
    const result = validateUrl(new URL('http://[fc00::1]/'), DEFAULT_NETWORK_POLICY);
    expect(result.valid).toBe(false);
  });

  it('rejects fd00::/8 IPv6 unique-local (the locally-assigned half of fc00::/7)', () => {
    const result = validateUrl(new URL('http://[fd12:3456:789a::1]/'), DEFAULT_NETWORK_POLICY);
    expect(result.valid).toBe(false);
  });

  it('rejects an IPv4-mapped IPv6 literal wrapping a private IPv4 address', () => {
    const result = validateUrl(new URL('http://[::ffff:192.168.1.1]/'), DEFAULT_NETWORK_POLICY);
    expect(result.valid).toBe(false);
  });

  it('rejects an IPv4-mapped IPv6 literal wrapping a loopback IPv4 address', () => {
    const result = validateUrl(new URL('http://[::ffff:127.0.0.1]/'), DEFAULT_NETWORK_POLICY);
    expect(result.valid).toBe(false);
  });

  it('accepts an IPv4-mapped IPv6 literal wrapping a public IPv4 address', () => {
    const result = validateUrl(new URL('http://[::ffff:93.184.216.34]/'), DEFAULT_NETWORK_POLICY);
    expect(result.valid).toBe(true);
  });
});

describe('SSRF — redirect chain revalidation (implemented, tested)', () => {
  it('rejects a redirect chain whose target is a prohibited address', () => {
    const result = validateRedirectChain(
      [new URL('https://example.com/'), new URL('http://169.254.169.254/latest/meta-data/')],
      DEFAULT_NETWORK_POLICY
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Redirect target invalid/);
  });

  it('rejects a redirect loop', () => {
    const result = validateRedirectChain(
      [
        new URL('https://example.com/a'),
        new URL('https://example.com/b'),
        new URL('https://example.com/a'),
      ],
      DEFAULT_NETWORK_POLICY
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/loop/i);
  });

  it('rejects a chain exceeding the configured redirect bound', () => {
    const policy = { ...DEFAULT_NETWORK_POLICY, maxRedirects: 2 };
    const chain = [
      new URL('https://example.com/1'),
      new URL('https://example.com/2'),
      new URL('https://example.com/3'),
      new URL('https://example.com/4'),
    ];
    const result = validateRedirectChain(chain, policy);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/exceeds maximum/);
  });

  it('accepts a short, distinct, valid redirect chain', () => {
    const result = validateRedirectChain(
      [new URL('https://example.com/a'), new URL('https://example.com/b')],
      DEFAULT_NETWORK_POLICY
    );
    expect(result.valid).toBe(true);
  });
});

describe('SSRF — PublicHttpAdapter fails closed with zero fetch calls', () => {
  const prohibitedUrls = [
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1/',
    'http://192.168.1.1/',
    'http://localhost/',
    'ftp://example.com/',
  ];

  for (const url of prohibitedUrls) {
    it(`rejects ${url} with invalid_request and makes no HTTP call`, async () => {
      const clock = fakeClock();
      const httpClient = unreachableHttpClient();
      const adapter = new PublicHttpAdapter(
        httpClient,
        clock,
        fakeArtifactStore(),
        fakeAuditSink()
      );
      const context = buildContext({ injected_clock: clock, injected_http_client: httpClient });

      const result = await adapter.execute({ url }, context);

      expect(result.resultClass).toBe('invalid_request');
      expect(httpClient.callCount).toBe(0);
    });
  }
});

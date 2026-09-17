import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { app } from '../src/index';

const EXPECTED_CONTACT = 'mailto:security@siteborne.net';
const EXPECTED_EXPIRES = '2027-08-31T23:59:59Z';

function fields(body: string, name: string): string[] {
  return body
    .split(/\r?\n/)
    .filter((line) => line.startsWith(`${name}:`))
    .map((line) => line.slice(name.length + 1).trim());
}

function expectRfc9116Document(body: string, canonical: string) {
  expect(new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(body))).toBe(
    body
  );
  expect(fields(body, 'Contact')).toEqual([EXPECTED_CONTACT]);
  expect(fields(body, 'Expires')).toEqual([EXPECTED_EXPIRES]);
  expect(Number.isNaN(Date.parse(EXPECTED_EXPIRES))).toBe(false);
  expect(Date.parse(EXPECTED_EXPIRES)).toBeGreaterThan(Date.now());
  expect(fields(body, 'Canonical')).toEqual([canonical]);
  expect(fields(body, 'Policy')).toEqual([]);
  expect(fields(body, 'Encryption')).toEqual([]);
  expect(body).not.toMatch(/PRIVATE_KEY|API_KEY|SECRET|token=/i);
}

describe('RFC 9116 security.txt', () => {
  it('serves a public utility-host document with the correct media type and canonical URI', async () => {
    const response = await app.request('https://utility.siteborne.net/.well-known/security.txt');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')?.toLowerCase()).toBe('text/plain; charset=utf-8');
    expectRfc9116Document(body, 'https://utility.siteborne.net/.well-known/security.txt');
  });

  it('is independent of payment gates and performs no payment/provider binding access', async () => {
    const noEconomicBindingAccess = new Proxy(
      { ENVIRONMENT: 'production', DB: undefined, PAID_ROUTES_ENABLED: 'true' },
      {
        get(target, property, receiver) {
          if (property in target) return Reflect.get(target, property, receiver);
          throw new Error(`unexpected payment/provider binding access: ${String(property)}`);
        },
      }
    );
    const response = await app.request(
      'https://utility.siteborne.net/.well-known/security.txt',
      {},
      noEconomicBindingAccess as never
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(`Contact: ${EXPECTED_CONTACT}`);
  });

  it('keeps unsupported methods on the existing request-validation path', async () => {
    const response = await app.request('https://utility.siteborne.net/.well-known/security.txt', {
      method: 'POST',
    });
    expect(response.status).toBe(415);
    expect(await response.text()).not.toContain(`Contact: ${EXPECTED_CONTACT}`);
  });

  it('provides an independently canonicalized apex static artifact', async () => {
    const path = new URL('../../network-site/.well-known/security.txt', import.meta.url);
    const headersPath = new URL('../../network-site/_headers', import.meta.url);
    expect(existsSync(path)).toBe(true);
    expect(existsSync(headersPath)).toBe(true);
    if (!existsSync(path)) return;
    const body = await readFile(path, 'utf8');
    expectRfc9116Document(body, 'https://siteborne.net/.well-known/security.txt');
    if (!existsSync(headersPath)) return;
    const headers = await readFile(headersPath, 'utf8');
    expect(headers).toContain('/.well-known/security.txt');
    expect(headers.toLowerCase()).toContain('content-type: text/plain; charset=utf-8');
  });

  it('uses the security contact explicitly authorized by the repository policy', async () => {
    const policy = await readFile(new URL('../../../SECURITY.md', import.meta.url), 'utf8');
    expect(policy).toContain('Report security issues to **security@siteborne.net**');
    expect(policy).not.toContain('This is pre-production software');
    expect(policy).not.toContain('(once domain configured)');
  });
});

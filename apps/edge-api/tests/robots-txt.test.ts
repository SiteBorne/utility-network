import { describe, expect, it } from 'vitest';
import { app } from '../src/index';

describe('robots.txt', () => {
  it('serves plain text, not an HTML fallback', async () => {
    const response = await app.request('https://utility.siteborne.net/robots.txt');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')?.toLowerCase()).toBe('text/plain; charset=utf-8');
    expect(body).not.toMatch(/<html/i);
    expect(new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(body))).toBe(
      body
    );
  });

  it('disallows paid/execution surfaces and allows public discovery surfaces', async () => {
    const response = await app.request('https://utility.siteborne.net/robots.txt');
    const body = await response.text();

    expect(body).toMatch(/Disallow:\s*\/v1\//);
    expect(body).toMatch(/Disallow:\s*\/v2\//);
    expect(body).toMatch(/Disallow:\s*\/v3\//);
    expect(body).toMatch(/Allow:\s*\/\.well-known\//);
    expect(body).toMatch(/Allow:\s*\/openapi\.json/);
  });
});

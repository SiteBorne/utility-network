/**
 * SUN-1100 checkpoint 2: `GET /.well-known/mcp-registry-auth` proves domain
 * control to the MCP Registry's HTTP authentication mechanism
 * (https://modelcontextprotocol.io/registry/authentication#http-authentication).
 * Public proof only -- no private key material must ever appear here.
 */
import { describe, it, expect } from 'vitest';
import { app } from '../src/index';

describe('GET /.well-known/mcp-registry-auth', () => {
  it('returns the expected MCP Registry proof line format', async () => {
    const res = await app.request('/.well-known/mcp-registry-auth');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body.trim()).toMatch(/^v=MCPv1; k=ed25519; p=[A-Za-z0-9+/]+=*$/);
  });

  it('the public key decodes to exactly 32 bytes (a valid Ed25519 public key)', async () => {
    const res = await app.request('/.well-known/mcp-registry-auth');
    const body = await res.text();
    const match = body.trim().match(/p=([A-Za-z0-9+/=]+)$/);
    expect(match).not.toBeNull();
    const decoded = Buffer.from(match![1], 'base64');
    expect(decoded.length).toBe(32);
  });

  it('never leaks private key material (no PEM markers, no "priv")', async () => {
    const res = await app.request('/.well-known/mcp-registry-auth');
    const body = await res.text();
    expect(body).not.toContain('PRIVATE KEY');
    expect(body.toLowerCase()).not.toContain('priv');
  });

  it('POST is not the expected method (GET-only, matches other well-known routes)', async () => {
    const res = await app.request('/.well-known/mcp-registry-auth', { method: 'POST' });
    expect(res.status).not.toBe(200);
  });
});

/**
 * SUN-1200 checkpoint F remediation — the real-workerd regression this
 * checkpoint's own incident required. Every other test file in this
 * repository drives the app via `app.request(...)`, a plain in-process
 * Hono fetch call running in Node.js/V8 -- never inside an actual
 * `workerd` isolate. That is exactly why ~600 existing tests never
 * caught the real incident: `createX402ServiceRoute`'s
 * `new Ajv2020({...}).compile(config.inputSchema)` (before this
 * checkpoint's fix) used `new Function(...)` internally, which real
 * Cloudflare Workers reject when triggered during request handling --
 * confirmed live via `wrangler tail` during this checkpoint's second
 * cutover attempt (`EvalError: Code generation from strings disallowed
 * for this context`).
 *
 * This file runs via `@cloudflare/vitest-pool-workers`
 * (`vitest.workerd.config.ts`, `pnpm test:workerd`), which executes
 * `SELF.fetch(...)` against the real Worker entrypoint
 * (`apps/edge-api/src/index.ts`) inside a genuine `workerd` runtime,
 * configured with the exact production `compatibility_date`/
 * `compatibility_flags` (`wrangler.workerd-test.toml`, mirroring the
 * real repo-root `wrangler.toml`).
 *
 * Deliberately stays on the default/preproduction path (no ADR 0055
 * production gates set) -- `createX402ServiceRoute`'s input-schema
 * compilation happens unconditionally, before any evidenceMode
 * branching, so it is fully exercised here without needing (or
 * risking) real CDP credentials or a real network call; the exact
 * production-challenge field values (mainnet network/asset/payTo/amount)
 * are separately proven, with mocked SDKs, by
 * `index-cdp-facilitator-wiring.test.ts` and
 * `production-cdp-full-stack-mock.test.ts`. This suite's claim is
 * narrower and complementary: the real Worker, under the real runtime
 * restrictions, does not crash constructing a paid route at all.
 */
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { decodePaymentRequiredHeaderSafe, type PaymentRequired } from '@siteborne/protocol-x402';

async function get402(path: string, body: unknown) {
  const res = await SELF.fetch(`https://workerd-test.invalid${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res;
}

describe('real workerd: paid-route construction does not crash (SUN-1200 checkpoint F)', () => {
  it('web_context_verified.v2: an unsigned request reaches a real 402, not a 500 -- proves createX402ServiceRoute no longer performs request-time AJV compilation under real workerd', async () => {
    const res = await get402('/v2/web/context', {
      target_url: 'https://acme.example/',
      retrieval_mode: 'direct',
    });
    expect(res.status).toBe(402);
    const headerValue = res.headers.get('PAYMENT-REQUIRED');
    expect(headerValue).toBeTruthy();
    const decoded = decodePaymentRequiredHeaderSafe(headerValue!);
    expect(decoded.ok).toBe(true);
    const challenge = (decoded as { ok: true; value: PaymentRequired }).value;
    expect(challenge.accepts[0]!.scheme).toBe('exact');
    // Default/preproduction path (no ADR 0055 gates set in this suite's
    // env) -- testnet, not mainnet. The mainnet-field proof lives in the
    // mocked-SDK suites named above.
    expect(challenge.accepts[0]!.network).toBe('eip155:84532');
  });

  it('document_evidence_json.v2: an unsigned request reaches a real 402 with an upto scheme, not a 500', async () => {
    const res = await get402('/v2/document/evidence-json', {
      artifact_reference: {
        artifact_id: 'doc/workerd-fixture.pdf',
        media_type: 'application/pdf',
        size_bytes: 1,
      },
    });
    expect(res.status).toBe(402);
    const headerValue = res.headers.get('PAYMENT-REQUIRED');
    expect(headerValue).toBeTruthy();
    const decoded = decodePaymentRequiredHeaderSafe(headerValue!);
    expect(decoded.ok).toBe(true);
    const challenge = (decoded as { ok: true; value: PaymentRequired }).value;
    expect(challenge.accepts[0]!.scheme).toBe('upto');
    expect(challenge.accepts[0]!.network).toBe('eip155:84532');
  });

  it('a malformed input still fails closed with a normal 400, never a 500, under real workerd', async () => {
    const res = await get402('/v2/web/context', { target_url: 'https://acme.example/' }); // missing required retrieval_mode
    expect(res.status).toBe(400);
  });

  it('health remains reachable under real workerd (unaffected by the paid-route fix)', async () => {
    const res = await SELF.fetch('https://workerd-test.invalid/health');
    expect(res.status).toBe(200);
  });
});

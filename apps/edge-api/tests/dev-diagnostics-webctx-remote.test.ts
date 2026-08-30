/**
 * SUN-1221E5Q — structural non-reachability proof for the dev-only
 * `webctx-remote-diagnostic.ts` seam (SUN-1221E5Q architecture approval).
 *
 * This suite proves, without ever invoking `cloudflare:sockets` (unavailable
 * outside the real Workers runtime — that's what the one authorized
 * `wrangler dev --remote` invocation is for), that:
 *
 *  1. the real production app (`apps/edge-api/src/index.ts`) never gains
 *     this route — nothing imports the diagnostic file;
 *  2. the diagnostic file's own source contains zero references to any
 *     x402/facilitator/signing-secret identifier;
 *  3. the diagnostic route itself fails closed (404) whenever
 *     `DIAGNOSTIC_SEAM_ENABLED` is anything other than the literal string
 *     `'true'`, matching the "unreachable by construction, not discipline"
 *     claim in the file's own doc comment.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import productionApp from '../src/index';
import diagnosticApp from '../src/dev-diagnostics/webctx-remote-diagnostic';

const DIAGNOSTIC_FILE = join(
  __dirname,
  '..',
  'src',
  'dev-diagnostics',
  'webctx-remote-diagnostic.ts'
);

const FORBIDDEN_ECONOMIC_IDENTIFIERS = [
  'x402-service',
  'facilitator',
  'createCdpFacilitatorClient',
  'CDP_API_KEY_ID',
  'CDP_API_KEY_SECRET',
  'CDP_WALLET_SECRET',
  'PAID_RECEIPT_SIGNING_PRIVATE_KEY',
  'signTypedData',
  'EIP-3009',
  'PAYMENT-SIGNATURE',
  '.settle(',
  'facilitatorClient.verify',
];

describe('SUN-1221E5Q: dev-only webctx-remote-diagnostic seam is structurally non-economic and production-unreachable', () => {
  it('nothing in apps/edge-api/src imports the diagnostic file — production bundle never contains it', () => {
    const srcDir = join(__dirname, '..', 'src');
    const offenders: string[] = [];
    // An actual ES-module import/re-export of the diagnostic module, not a
    // bare mention of the string "dev-diagnostics" (which legitimately
    // appears in unrelated files' doc comments/exclusion filters, e.g. the
    // SUN-1216 walk test that excludes this directory by name).
    const IMPORT_PATTERN = /from\s+['"][^'"]*dev-diagnostics\/webctx-remote-diagnostic['"]/;

    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'dev-diagnostics') continue; // the file's own home
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.ts')) {
          const text = readFileSync(full, 'utf8');
          if (IMPORT_PATTERN.test(text)) offenders.push(full);
        }
      }
    }
    walk(srcDir);

    expect(offenders).toEqual([]);
  });

  it('the real production app 404s on the diagnostic path (the route was never registered there)', async () => {
    const res = await productionApp.request('/__diag/webctx-remote');
    expect(res.status).toBe(404);
  });

  it('the diagnostic file source contains none of the forbidden economic/facilitator/signing-secret identifiers', () => {
    const source = readFileSync(DIAGNOSTIC_FILE, 'utf8');
    // Strip doc-comment lines (which legitimately name these identifiers to
    // explain what is NOT imported) — only code lines matter for this proof.
    const codeOnly = source
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith('*') && !trimmed.startsWith('//') && !trimmed.startsWith('/**');
      })
      .join('\n');

    for (const identifier of FORBIDDEN_ECONOMIC_IDENTIFIERS) {
      expect(codeOnly.includes(identifier), `forbidden identifier "${identifier}" found in code`).toBe(
        false
      );
    }
  });

  it('the diagnostic route 404s when DIAGNOSTIC_SEAM_ENABLED is unset (fail-closed default)', async () => {
    const res = await diagnosticApp.request('/__diag/webctx-remote', {}, {});
    expect(res.status).toBe(404);
  });

  it.each(['false', 'TRUE', '1', 'yes', ''])(
    'the diagnostic route 404s for DIAGNOSTIC_SEAM_ENABLED=%j (only the exact literal "true" gates it open)',
    async (value) => {
      const res = await diagnosticApp.request(
        '/__diag/webctx-remote',
        {},
        { DIAGNOSTIC_SEAM_ENABLED: value }
      );
      expect(res.status).toBe(404);
    }
  );
});

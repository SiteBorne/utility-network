/**
 * SUN-1206 Checkpoint L regression: the real production entrypoint must
 * reject every paid-service route before constructing payment economics while
 * no governed production service executor exists.  The test-only paid-service
 * entrypoint remains available to exercise the payment/state-machine stack;
 * this file proves that graph is not selected by production configuration.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { D1Database } from '@cloudflare/workers-types';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/index';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../migrations', import.meta.url));

const ROUTES: ReadonlyArray<{ path: string; body: unknown; nevermined?: boolean }> = [
  {
    path: '/v1/company/evidence-graph',
    body: { identifiers: { cik: '0000320193' }, requested_field_groups: ['identity'] },
  },
  {
    path: '/v1/web/context',
    body: { target_url: 'https://example.com/', retrieval_mode: 'direct' },
  },
  {
    path: '/v1/document/evidence-json',
    body: {
      artifact_reference: {
        artifact_id: 'doc/unavailable.pdf',
        media_type: 'application/pdf',
        size_bytes: 1,
      },
    },
  },
  {
    path: '/v1/verify/agent-output',
    body: {
      verification_contract: { claims: [], deterministic_requirements: [] },
      candidate_output: {},
      required_schema: {},
      verification_mode: 'standard',
    },
  },
  {
    path: '/v2/company/evidence-graph',
    body: { identifiers: { cik: '0000320193' }, requested_field_groups: ['identity'] },
  },
  {
    path: '/v2/web/context',
    body: { target_url: 'https://example.com/', retrieval_mode: 'direct' },
  },
  {
    path: '/v2/document/evidence-json',
    body: {
      artifact_reference: {
        artifact_id: 'doc/unavailable.pdf',
        media_type: 'application/pdf',
        size_bytes: 1,
      },
    },
  },
  {
    path: '/v2/verify/agent-output',
    body: {
      verification_contract: { claims: [], deterministic_requirements: [] },
      candidate_output: {},
      required_schema: {},
      verification_mode: 'standard',
    },
  },
  {
    path: '/v2/nevermined/company/evidence-graph',
    body: { identifiers: { cik: '0000320193' }, requested_field_groups: ['identity'] },
    nevermined: true,
  },
  {
    path: '/v2/nevermined/web/context',
    body: { target_url: 'https://example.com/', retrieval_mode: 'direct' },
    nevermined: true,
  },
  {
    path: '/v2/nevermined/document/evidence-json',
    body: {
      artifact_reference: {
        artifact_id: 'doc/unavailable.pdf',
        media_type: 'application/pdf',
        size_bytes: 1,
      },
    },
    nevermined: true,
  },
  {
    path: '/v2/nevermined/verify/agent-output',
    body: {
      verification_contract: { claims: [], deterministic_requirements: [] },
      candidate_output: {},
      required_schema: {},
      verification_mode: 'standard',
    },
    nevermined: true,
  },
];

async function migrate(db: D1Database): Promise<void> {
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const statements = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
      .split(';')
      .map((raw) =>
        raw
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('--'))
          .join(' ')
          .trim()
      )
      .filter(Boolean);
    for (const statement of statements) await db.exec(statement);
  }
}

describe('SUN-1206 production paid-service fixture isolation', () => {
  let miniflare: Miniflare;
  let db: D1Database;
  let persistencePath: string;

  beforeAll(async () => {
    persistencePath = mkdtempSync(join(tmpdir(), 'siteborne-sun1206-fixture-isolation-'));
    miniflare = new Miniflare({
      modules: true,
      script: `export default { fetch() { return new Response('ok') } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: persistencePath,
    });
    db = await miniflare.getD1Database('DB');
    await db.exec('PRAGMA foreign_keys = ON');
    await migrate(db);
  }, 30_000);

  afterAll(async () => {
    await miniflare.dispose();
    rmSync(persistencePath, { recursive: true, force: true });
  });

  for (const route of ROUTES) {
    it(`${route.path} is unavailable before payment and cannot emit fixture output`, async () => {
      const response = await app.request(
        route.path,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(route.body),
        },
        {
          ENVIRONMENT: 'production',
          PAID_ROUTES_ENABLED: 'true',
          NEVERMINED_ROUTES_ENABLED: route.nevermined ? 'true' : undefined,
          DB: db,
        } as never
      );

      expect(response.status).toBe(503);
      expect(response.headers.get('PAYMENT-REQUIRED')).toBeNull();
      expect(response.headers.get('PAYMENT-RESPONSE')).toBeNull();
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toEqual({
        error: 'service_executor_not_configured',
        message:
          'Paid service execution is unavailable until a governed production executor is configured',
      });
      expect(JSON.stringify(body)).not.toContain('fixture');
    });
  }
});

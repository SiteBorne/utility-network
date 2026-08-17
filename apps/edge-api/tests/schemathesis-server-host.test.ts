/**
 * SUN-1000 checkpoint 1I — deterministic, credential-free local HTTP
 * server host for the pinned Schemathesis campaign.
 *
 * This is deliberately a Vitest test file, not a bare `tsx`/`node`
 * script: this project's workspace TS/ESM/top-level-await dependency
 * graph (proven by 150+ passing test files) only resolves cleanly
 * through Vitest's own transform pipeline — a bare `tsx`/`node`
 * invocation of the same import graph fails on `packages/verification`'s
 * top-level `await` and on ESM/CJS interop between workspace-linked
 * packages. Rather than fight that with a custom bundler pipeline, this
 * reuses the exact tooling every other suite in this repository already
 * relies on.
 *
 * Boots exactly the same real Miniflare-backed D1 database + real Hono
 * app construction (`buildPaidServicesApp`, `evidenceMode: 'fixture'`)
 * already used in `x402-service-route.test.ts` — no new test double, no
 * new fixture-mode invention. The only new piece is binding this
 * already-proven app to a real, ephemeral local HTTP port via
 * `@hono/node-server`, so Schemathesis (a separate Python process, run
 * by `scripts/security/run-schemathesis.ts`) can send it real HTTP
 * requests. `/v1/nevermined/*` is not mounted by this harness at all —
 * only `buildPaidServicesApp`'s own app, not the full `index.ts` app —
 * so no Nevermined/CDP credential or network call is possible here.
 *
 * Coordination with the external orchestrator is file-based, in the
 * process's own gitignored `.security-tools/` directory: this test
 * writes a ready-info JSON file once the server is listening, then
 * polls for a stop-sentinel file (written by the orchestrator once the
 * Schemathesis campaign finishes) before shutting down cleanly. A
 * bounded maximum wait protects against ever hanging indefinitely if
 * the orchestrator fails to signal completion.
 */
import { readFileSync, readdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { serve, type ServerType } from '@hono/node-server';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { buildPaidServicesApp } from '../src/control-plane/routes/paid-services';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../migrations', import.meta.url));
const SECURITY_TOOLS_DIR = fileURLToPath(new URL('../../../.security-tools', import.meta.url));
const READY_INFO_PATH = join(SECURITY_TOOLS_DIR, 'schemathesis-server-ready.json');
const STOP_SENTINEL_PATH = join(SECURITY_TOOLS_DIR, 'schemathesis-server-stop');
const MAX_WAIT_MS = 5 * 60_000;
const POLL_INTERVAL_MS = 500;

function runMigrations(db: D1Database): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.reduce(async (prev, file) => {
    await prev;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const statements = sql
      .split(';')
      .map((raw) =>
        raw
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && !l.startsWith('--'))
          .join(' ')
          .trim()
      )
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await db.exec(stmt);
    }
  }, Promise.resolve());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Guarded so this file is safe to sit in the ordinary `apps/edge-api/tests/`
// glob picked up by `pnpm test`/`pnpm check` — without this guard, an
// ordinary test run would spend up to 5 minutes waiting for a stop
// signal only `scripts/security/run-schemathesis.ts` ever sends. Only
// that orchestrator sets `SCHEMATHESIS_SERVER_HOST=true`.
const isOrchestratorRun = process.env.SCHEMATHESIS_SERVER_HOST === 'true';

describe.skipIf(!isOrchestratorRun)('schemathesis local server host', () => {
  let tempDir: string;
  let mf: Miniflare;
  let server: ServerType;

  beforeAll(async () => {
    rmSync(STOP_SENTINEL_PATH, { force: true });
    rmSync(READY_INFO_PATH, { force: true });

    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-schemathesis-'));
    mf = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: tempDir,
    });
    const db = await mf.getD1Database('DB');
    await db.exec('PRAGMA foreign_keys = ON');
    await runMigrations(db);

    const app = await buildPaidServicesApp({ db, evidenceMode: 'fixture' });

    server = await new Promise<ServerType>((resolve) => {
      const s = serve({ fetch: app.fetch, port: 0 }, (info) => {
        resolve(s);
        void info;
      });
    });
  }, 30_000);

  afterAll(async () => {
    server?.close();
    await mf?.dispose();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it(
    'serves the real paid-services app over HTTP until signaled to stop',
    async () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : undefined;
      if (!port) {
        throw new Error('schemathesis_server_no_port: server did not bind a real TCP port');
      }
      const url = `http://127.0.0.1:${port}`;
      writeFileSync(READY_INFO_PATH, JSON.stringify({ url, pid: process.pid }));

      const deadline = Date.now() + MAX_WAIT_MS;
      while (!existsSync(STOP_SENTINEL_PATH) && Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
      }
      // Reaching the deadline without a stop signal is not itself a
      // test failure — the orchestrator's own timeout/kill is the real
      // safety net; this loop bound only prevents an unbounded hang if
      // both mechanisms somehow fail simultaneously.
    },
    MAX_WAIT_MS + 30_000
  );
});

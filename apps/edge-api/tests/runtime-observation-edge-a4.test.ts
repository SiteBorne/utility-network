/**
 * R3-A4-55 — EDGE runtime version observation on `GET /health`.
 *
 * The running Worker reports the platform-injected `CF_VERSION_METADATA`
 * verbatim. It never echoes a caller value, and no authority path reads it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateHealthResponse } from '@siteborne/contracts';
import { app } from '../src/index';
import { runtimeVersionReport } from '../src/runtime-observation';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SRC = join(ROOT, 'apps/edge-api/src');
const VERSION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VERSION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const META = {
  id: VERSION_A,
  tag: 'release-3-a4-provenance-edge-01',
  timestamp: '2026-09-28T15:00:00.000Z',
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'generated' ? [] : sourceFiles(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });
}

describe('EDGE runtime observation (R3-A4-55)', () => {
  it('reports CF_VERSION_METADATA verbatim with the edge deployment unit', async () => {
    const res = await app.request('/health', {}, { CF_VERSION_METADATA: META });
    expect(res.status).toBe(200);
    const json = validateHealthResponse(await res.json());
    expect(json.runtime).toEqual({
      deployment_unit: 'siteborne-utility-edge',
      platform_version_id: VERSION_A,
      platform_version_tag: 'release-3-a4-provenance-edge-01',
      platform_version_timestamp: '2026-09-28T15:00:00.000Z',
    });
  });

  it('omits runtime when the binding is absent (unchanged pre-A4 shape)', async () => {
    const res = await app.request('/health');
    const json = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(json).sort()).toEqual(['status', 'timestamp', 'uptime_seconds', 'version']);
  });

  it('never echoes a caller-supplied expected version', async () => {
    const res = await app.request(
      `/health?expected_version_id=${VERSION_B}&platform_version_id=${VERSION_B}`,
      { headers: { 'x-expected-version-id': VERSION_B, 'cf-version-metadata': VERSION_B } },
      { CF_VERSION_METADATA: META }
    );
    const text = await res.text();
    expect(text).not.toContain(VERSION_B);
    expect(JSON.parse(text).runtime.platform_version_id).toBe(VERSION_A);
  });

  it('empty tag/timestamp are reported as null, missing id reports nothing', () => {
    expect(runtimeVersionReport({ id: VERSION_A, tag: '', timestamp: '' }, 'u')).toEqual({
      deployment_unit: 'u',
      platform_version_id: VERSION_A,
      platform_version_tag: null,
      platform_version_timestamp: null,
    });
    expect(runtimeVersionReport({ id: '', tag: 't', timestamp: 't' }, 'u')).toBeNull();
    expect(runtimeVersionReport(undefined, 'u')).toBeNull();
  });

  it('health response schema rejects extra runtime keys (no smuggled fields)', () => {
    expect(() =>
      validateHealthResponse({
        status: 'ok',
        timestamp: '2026-09-28T15:00:00.000Z',
        version: '0.0.0',
        uptime_seconds: 0,
        runtime: {
          deployment_unit: 'siteborne-utility-edge',
          platform_version_id: VERSION_A,
          platform_version_tag: null,
          platform_version_timestamp: null,
          authorized: true,
        },
      })
    ).toThrow();
  });

  it('CF_VERSION_METADATA is read only by the observation module and the Env type', () => {
    const readers = sourceFiles(SRC)
      .filter((p) => readFileSync(p, 'utf8').includes('CF_VERSION_METADATA'))
      .map((p) => relative(ROOT, p))
      .sort();
    expect(readers).toEqual([
      'apps/edge-api/src/control-plane/config/env.ts',
      'apps/edge-api/src/routes/health.ts',
      'apps/edge-api/src/runtime-observation.ts',
    ]);
  });

  it('the observation module imports nothing and touches no D1, Workflow, provider or secret', () => {
    const text = readFileSync(join(SRC, 'runtime-observation.ts'), 'utf8');
    expect(text).not.toMatch(/^\s*import\s/m);
    expect(text).not.toMatch(/\bDB\b|\.prepare\(|Workflow\b|\.create\(|fetch\(|SECRET|PRIVATE_KEY/);
  });

  it('wrangler.toml declares the canonical version_metadata binding', () => {
    const toml = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
    expect(toml).toMatch(/\n\[version_metadata\]\nbinding = "CF_VERSION_METADATA"\n/);
  });
});

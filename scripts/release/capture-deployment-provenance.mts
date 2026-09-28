#!/usr/bin/env tsx
/**
 * R3-A4: capture one source -> build -> artifact -> platform version ->
 * deployment -> runtime-observation provenance chain as sealed Evidence
 * Graph records, and evaluate it. READ-ONLY: runs git reads, hashes a local
 * `wrangler deploy --dry-run --outdir` output, and issues only GET requests
 * to the Cloudflare API (or reads previously saved GET responses).
 *
 * usage:
 *   tsx scripts/release/capture-deployment-provenance.mts \
 *     --unit <worker-script-name> --environment production \
 *     --build-root <clean checkout at the source commit> \
 *     --build-dir <dry-run outdir> --config <wrangler config path> \
 *     --version-id <cloudflare version uuid> \
 *     [--version-json <saved GET versions/{id}?include=modules>] \
 *     [--deployments-json <saved GET scripts/{name}/deployments>] \
 *     [--observed-at <ISO>] [--captured-at <ISO>] [--max-age-ms <n>]
 *
 * Live mode needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildProvenanceRecords,
  evaluateProvenanceChain,
  type Environment,
} from '../../packages/evidence-graph/src/index.ts';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2)
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const req = (k: string) => {
  const v = args.get(k);
  if (!v) {
    console.error(`missing --${k}`);
    process.exit(2);
  }
  return v;
};

const unit = req('unit');
const environment = req('environment') as Environment;
const buildRoot = req('build-root');
const buildDir = req('build-dir');
const config = req('config');
const versionId = req('version-id');
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const git = (a: string[]) =>
  execFileSync('git', ['-C', buildRoot, ...a], { encoding: 'utf8' }).trim();

interface CfVersion {
  id: string;
  number?: number;
  created_on: string;
  main_module: string;
  modules?: { name: string; content_base64: string }[];
  annotations?: Record<string, string>;
}
interface CfDeployment {
  id: string;
  created_on: string;
  strategy: string;
  versions: { version_id: string; percentage: number }[];
  annotations?: Record<string, string>;
}

async function cf(path: string): Promise<unknown> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account)
    throw new Error('live mode needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID');
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json()) as { success?: boolean };
  if (!res.ok || !body.success) throw new Error(`GET ${path} failed: ${res.status}`);
  return body;
}

const commit = git(['rev-parse', 'HEAD']);
const dirty = git(['status', '--porcelain']).length > 0;
const pushedRefs = git(['branch', '-r', '--contains', commit]);
const repository = git(['config', '--get', 'remote.origin.url']);
const lockfile = (() => {
  try {
    return sha256(execFileSync('git', ['-C', buildRoot, 'show', `${commit}:pnpm-lock.yaml`]));
  } catch {
    return null;
  }
})();
const wranglerVersion = JSON.parse(
  readFileSync(join(buildRoot, 'node_modules/wrangler/package.json'), 'utf8')
).version;
const pnpmVersion = execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim();

const localModules = readdirSync(buildDir)
  .filter((f) => f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.wasm'))
  .map((name) => {
    const bytes = readFileSync(join(buildDir, name));
    return { name, sha256: sha256(bytes), size: bytes.length };
  });

const versionBody = args.has('version-json')
  ? JSON.parse(readFileSync(args.get('version-json')!, 'utf8'))
  : await cf(`/workers/workers/${unit}/versions/${versionId}?include=modules`);
const v = (versionBody as { result: CfVersion }).result;
if (v.id !== versionId) throw new Error(`version response is for ${v.id}, not ${versionId}`);
const platformModules = (v.modules ?? []).map((m) => {
  const bytes = Buffer.from(m.content_base64, 'base64');
  return { name: m.name, sha256: sha256(bytes), size: bytes.length };
});

const deploymentsBody = args.has('deployments-json')
  ? JSON.parse(readFileSync(args.get('deployments-json')!, 'utf8'))
  : await cf(`/workers/scripts/${unit}/deployments`);
const latest = [
  ...(deploymentsBody as { result: { deployments: CfDeployment[] } }).result.deployments,
].sort((a, b) => String(b.created_on).localeCompare(String(a.created_on)))[0];

const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const observedAt = args.get('observed-at') ?? now;
const capturedAt = args.get('captured-at') ?? now;
const running = latest.versions.find((x) => x.version_id === versionId);

const records = await buildProvenanceRecords({
  environment,
  deployment_unit: unit,
  captured_at: capturedAt,
  actor: `capture-deployment-provenance.mts@${process.env.USER ?? 'unknown'}`,
  source: {
    repository,
    commit,
    ref: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    reachable_from_protected_ref: pushedRefs.length > 0,
  },
  build: {
    dirty,
    toolchain: {
      node: process.version,
      wrangler: wranglerVersion,
      package_manager: `pnpm@${pnpmVersion}`,
      lockfile_sha256: lockfile,
    },
    command: `wrangler deploy --dry-run --outdir <outdir> --config ${config}`,
    config_path: config,
    main_module: v.main_module,
    modules: localModules,
  },
  platform_version: {
    id: v.id,
    number: v.number ?? null,
    created_on: v.created_on,
    main_module: v.main_module,
    modules: platformModules,
    annotations: {
      message: v.annotations?.['workers/message'],
      tag: v.annotations?.['workers/tag'],
    },
    evidence_source: `GET /accounts/{account}/workers/workers/${unit}/versions/${versionId}?include=modules`,
  },
  deployment: {
    id: latest.id,
    created_on: latest.created_on,
    strategy: latest.strategy,
    traffic: latest.versions.map((x) => ({ version_id: x.version_id, percentage: x.percentage })),
    annotations: { message: latest.annotations?.['workers/message'] },
    evidence_source: `GET /accounts/{account}/workers/scripts/${unit}/deployments`,
  },
  observation: {
    kind: 'PLATFORM_ACTIVE_DEPLOYMENT',
    observed_at: observedAt,
    deployment_id: latest.id,
    version_id: running ? versionId : latest.versions[0].version_id,
    traffic_percentage: running ? running.percentage : null,
    evidence_source: `GET /accounts/{account}/workers/scripts/${unit}/deployments (latest by created_on)`,
  },
});

const chain = await evaluateProvenanceChain(
  records,
  { environment, deployment_unit: unit, platform_version_id: versionId },
  { now: capturedAt, maxObservationAgeMs: Number(args.get('max-age-ms') ?? 3_600_000) }
);

process.stdout.write(`${JSON.stringify({ records, chain }, null, 2)}\n`);

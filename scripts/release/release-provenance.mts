#!/usr/bin/env tsx
/**
 * R3-A4-55: staged release provenance capture.
 *
 * Every stage seals NEW content-addressed records whose parents are the
 * previous stage's records and writes them to <records-dir>/<stage>.json.
 * Earlier stage files are never rewritten: a stage refuses to run if its own
 * output already exists.
 *
 *   A SOURCE     git commit of the clean build root
 *   B BUILD      runs `wrangler deploy --dry-run --outdir` itself, recording
 *                the exact toolchain (node, pnpm, wrangler, lockfile digest)
 *                and build command identity as ORIGINAL_RELEASE_TOOLCHAIN
 *   C ARTIFACT   sha256 of the exact output modules (build repeated N times,
 *                all digests must agree)
 *   D UPLOAD     GET of the immutable platform version, module bytes hashed
 *   E VERIFY     platform bytes == artifact, or exit 1
 *   F DEPLOYMENT GET of the deployment id and allocation
 *   G RUNTIME    platform view (GET deployments) + the running code's own
 *                CF_VERSION_METADATA report (edge: GET /health, host: a saved
 *                Workers Logs `siteborne.runtime_version` event)
 *   H PERSIST    renders append-only INSERT SQL for `wrangler d1 execute
 *                --file`; this tool never executes it
 *
 * The tool is read-only toward Cloudflare (GET only) and production D1 (it
 * writes nothing). Uploads and deployments are separate, separately
 * authorized operator commands.
 *
 * usage:
 *   tsx --tsconfig tsconfig.base.json scripts/release/release-provenance.mts <stage> --records <dir> [options]
 *   local      --unit U --environment E --config C --build-root R [--repeat 2] [--source-ref REF]
 *   upload     --version-id V [--version-json F]
 *   deployment [--deployments-json F]
 *   runtime    [--health-url URL | --health-json F | --log-event-json F] [--observed-at ISO]
 *   persist    --out-sql F
 *   evaluate   [--now ISO] [--max-age-ms N]
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { classifySourceRef } from './source-ref-tiers.mts';
import {
  EvidenceGraph,
  buildCommandIdentity,
  evaluateProvenanceChain,
  packageManagerIdentity,
  parseRuntimeVersionReport,
  projectProvenance,
  recordArtifactStage,
  recordBuildStage,
  recordDeploymentStage,
  recordPlatformObservationStage,
  recordSourceStage,
  recordVersionStage,
  renderEvidenceInsertSql,
  sealRuntimeSelfReport,
  verifyRecordId,
  verifyUploadStage,
  type ArtifactRecord,
  type DeploymentRecord,
  type Environment,
  type ModuleDigest,
  type PlatformVersionRecord,
  type ProvenanceRecord,
  type StageContext,
} from '../../packages/evidence-graph/src/index.ts';

const [stage, ...rest] = process.argv.slice(2);
const args = new Map<string, string>();
for (let i = 0; i < rest.length; i += 2) args.set(rest[i].replace(/^--/, ''), rest[i + 1]);
const req = (k: string): string => {
  const v = args.get(k);
  if (!v) fail(`missing --${k}`);
  return v!;
};
function fail(msg: string): never {
  console.error(`release-provenance: ${msg}`);
  process.exit(1);
}

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const recordsDir = resolve(req('records'));
mkdirSync(recordsDir, { recursive: true });

const STAGE_FILES = ['A-source', 'B-build', 'C-artifact', 'D-upload', 'F-deployment', 'G-runtime'];

interface StageFile {
  readonly context: StageContext;
  readonly records: ProvenanceRecord[];
}

async function readStage(name: string): Promise<StageFile> {
  const p = join(recordsDir, `${name}.json`);
  if (!existsSync(p)) fail(`stage ${name} has not run`);
  const f = JSON.parse(readFileSync(p, 'utf8')) as StageFile;
  for (const r of f.records) {
    if (!(await verifyRecordId(r))) fail(`${name}: record ${r.record_id} does not hash to its id`);
  }
  return f;
}
function writeStage(name: string, f: StageFile): void {
  const p = join(recordsDir, `${name}.json`);
  if (existsSync(p)) fail(`stage ${name} already recorded; evidence is never rewritten`);
  writeFileSync(p, `${JSON.stringify(f, null, 2)}\n`, { flag: 'wx' });
}
async function allRecords(): Promise<{ context: StageContext; records: ProvenanceRecord[] }> {
  const present = STAGE_FILES.filter((n) => existsSync(join(recordsDir, `${n}.json`)));
  const files = await Promise.all(present.map(readStage));
  return { context: files[0].context, records: files.flatMap((f) => f.records) };
}
function one<T extends ProvenanceRecord['record_type']>(
  records: ProvenanceRecord[],
  type: T
): Extract<ProvenanceRecord, { record_type: T }> {
  const found = records.filter((r) => r.record_type === type);
  if (found.length !== 1) fail(`expected exactly one ${type}, found ${found.length}`);
  return found[0] as Extract<ProvenanceRecord, { record_type: T }>;
}

async function cfGet(path: string): Promise<unknown> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) fail('live reads need CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID');
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json()) as { success?: boolean };
  if (!res.ok || !body.success) fail(`GET ${path} failed: ${res.status}`);
  return body;
}

function hashModules(dir: string): ModuleDigest[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.wasm'))
    .sort()
    .map((name) => {
      const bytes = readFileSync(join(dir, name));
      return { name, sha256: sha256(bytes), size: bytes.length };
    });
}

async function stageLocal(): Promise<void> {
  const root = resolve(req('build-root'));
  const config = req('config');
  const repeat = Number(args.get('repeat') ?? '2');
  const git = (a: string[]) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();
  const commit = git(['rev-parse', 'HEAD']);
  if (git(['status', '--porcelain']).length > 0) fail(`build root ${root} is dirty`);
  const context: StageContext = {
    environment: req('environment') as Environment,
    deployment_unit: req('unit'),
    captured_at: nowIso(),
    actor: `release-provenance.mts@${process.env.USER ?? 'unknown'}`,
  };

  // STAGE A
  const source = await recordSourceStage(context, {
    repository: git(['config', '--get', 'remote.origin.url']),
    commit,
    ref: args.get('source-ref') ?? git(['rev-parse', '--abbrev-ref', 'HEAD']),
    ...(() => {
      const t = classifySourceRef(commit, root, git(['config', '--get', 'remote.origin.url']));
      return {
        reachable_from_protected_ref: t.protected_ref,
        remote_reachable: t.remote_reachable,
        approved_release_ref: t.approved_release_ref,
      };
    })(),
  });
  writeStage('A-source', { context, records: [source] });

  // STAGE B (+ C inputs): the tool runs the build, so the recorded toolchain
  // and command are the ones that produced these bytes.
  const pnpmVersion = execFileSync('pnpm', ['--version'], { cwd: root, encoding: 'utf8' }).trim();
  const wranglerVersion = JSON.parse(
    readFileSync(join(root, 'node_modules/wrangler/package.json'), 'utf8')
  ).version as string;
  const builds: { argv: string[]; outdir: string; modules: ModuleDigest[] }[] = [];
  for (let i = 0; i < repeat; i++) {
    const outdir = mkdtempSync(join(tmpdir(), `a4-build-${i}-`));
    const argv = [
      'exec',
      'wrangler',
      'deploy',
      '--dry-run',
      '--outdir',
      outdir,
      '--config',
      config,
    ];
    execFileSync('pnpm', argv, { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
    builds.push({ argv: ['pnpm', ...argv], outdir, modules: hashModules(outdir) });
  }
  const digests = new Set(
    builds.map((b) => JSON.stringify(b.modules.map((m) => [m.name, m.sha256])))
  );
  for (const [n, b] of builds.entries()) {
    const main = b.modules.find((m) => m.name.endsWith('.js'));
    console.error(`BUILD_${n + 1}: main=${main?.name} sha256=${main?.sha256}`);
  }
  if (digests.size !== 1) fail(`build is not reproducible across ${repeat} runs`);
  if (git(['status', '--porcelain']).length > 0) fail('build dirtied the source tree');
  const mainModule = (() => {
    const candidates = builds[0].modules.filter((m) => m.name.endsWith('.js'));
    if (candidates.length !== 1) fail(`expected one main .js module, found ${candidates.length}`);
    return candidates[0].name;
  })();
  const build = await recordBuildStage(context, source, {
    dirty: false,
    toolchain: {
      node: process.version,
      wrangler: wranglerVersion,
      package_manager: packageManagerIdentity(
        readFileSync(join(root, 'package.json'), 'utf8'),
        pnpmVersion
      ),
      lockfile_sha256: sha256(readFileSync(join(root, 'pnpm-lock.yaml'))),
    },
    toolchain_provenance: 'ORIGINAL_RELEASE_TOOLCHAIN',
    command: buildCommandIdentity(builds[0].argv, builds[0].outdir),
    config_path: config,
    main_module: mainModule,
    modules: builds[0].modules,
  });
  writeStage('B-build', { context, records: [build] });

  // STAGE C
  const artifact = await recordArtifactStage(context, build, builds[0].modules);
  writeStage('C-artifact', { context, records: [artifact] });
  for (const b of builds) rmSync(b.outdir, { recursive: true, force: true });
  await report();
}

async function stageUpload(): Promise<void> {
  const { context, records } = await allRecords();
  const artifact = one(records, 'ArtifactRecord') as ArtifactRecord;
  const versionId = req('version-id');
  const body = args.has('version-json')
    ? JSON.parse(readFileSync(args.get('version-json')!, 'utf8'))
    : await cfGet(
        `/workers/workers/${context.deployment_unit}/versions/${versionId}?include=modules`
      );
  const v = (
    body as {
      result: {
        id: string;
        number?: number;
        created_on: string;
        main_module: string;
        modules?: { name: string; content_base64: string }[];
        annotations?: Record<string, string>;
      };
    }
  ).result;
  if (v.id !== versionId) fail(`version response is for ${v.id}, not ${versionId}`);
  const modules = (v.modules ?? []).map((m) => {
    const bytes = Buffer.from(m.content_base64, 'base64');
    return { name: m.name, sha256: sha256(bytes), size: bytes.length };
  });
  // STAGE D
  const version = await recordVersionStage({ ...context, captured_at: nowIso() }, artifact, {
    id: v.id,
    number: v.number ?? null,
    created_on: v.created_on,
    main_module: v.main_module,
    modules,
    annotations: {
      message: v.annotations?.['workers/message'],
      tag: v.annotations?.['workers/tag'],
    },
    evidence_source: `GET /accounts/{account}/workers/workers/${context.deployment_unit}/versions/${versionId}?include=modules`,
  });
  // STAGE E
  const verdict = verifyUploadStage(artifact, version);
  if (!verdict.verified) fail(`VERIFY failed: ${verdict.detail}`);
  writeStage('D-upload', { context, records: [version] });
  process.stdout.write(
    `${JSON.stringify({ stage: 'E-verify', ...verdict, version_id: v.id }, null, 2)}\n`
  );
}

async function stageDeployment(): Promise<void> {
  const { context, records } = await allRecords();
  const version = one(records, 'PlatformVersionRecord') as PlatformVersionRecord;
  const body = args.has('deployments-json')
    ? JSON.parse(readFileSync(args.get('deployments-json')!, 'utf8'))
    : await cfGet(`/workers/scripts/${context.deployment_unit}/deployments`);
  const latest = [
    ...(
      body as {
        result: {
          deployments: {
            id: string;
            created_on: string;
            strategy: string;
            versions: { version_id: string; percentage: number }[];
            annotations?: Record<string, string>;
          }[];
        };
      }
    ).result.deployments,
  ].sort((a, b) => b.created_on.localeCompare(a.created_on))[0];
  const at = nowIso();
  // STAGE F
  const deployment = await recordDeploymentStage({ ...context, captured_at: at }, version, {
    id: latest.id,
    created_on: latest.created_on,
    strategy: latest.strategy,
    traffic: latest.versions.map((x) => ({ version_id: x.version_id, percentage: x.percentage })),
    annotations: { message: latest.annotations?.['workers/message'] },
    evidence_source: `GET /accounts/{account}/workers/scripts/${context.deployment_unit}/deployments`,
  });
  // STAGE G (platform view)
  const running = latest.versions.find((x) => x.version_id === version.platform_version_id);
  const observation = await recordPlatformObservationStage(
    { ...context, captured_at: at },
    deployment,
    {
      kind: 'PLATFORM_ACTIVE_DEPLOYMENT',
      observed_at: at,
      deployment_id: latest.id,
      version_id: running ? version.platform_version_id : latest.versions[0].version_id,
      traffic_percentage: running ? running.percentage : null,
      evidence_source: `GET /accounts/{account}/workers/scripts/${context.deployment_unit}/deployments (latest by created_on)`,
    }
  );
  writeStage('F-deployment', { context, records: [deployment, observation] });
  await report();
}

async function stageRuntime(): Promise<void> {
  const { context, records } = await allRecords();
  const deployment = one(records, 'DeploymentRecord') as DeploymentRecord;
  let raw: unknown;
  let surface: string;
  if (args.has('health-url')) {
    const url = args.get('health-url')!;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) fail(`GET ${url} -> ${res.status}`);
    raw = ((await res.json()) as { runtime?: unknown }).runtime;
    surface = `GET ${url}#runtime`;
  } else if (args.has('health-json')) {
    raw = (JSON.parse(readFileSync(args.get('health-json')!, 'utf8')) as { runtime?: unknown })
      .runtime;
    surface = `GET /health#runtime (saved: ${args.get('health-json')})`;
  } else {
    const ev = JSON.parse(readFileSync(req('log-event-json'), 'utf8')) as Record<string, unknown>;
    if (ev.event !== 'siteborne.runtime_version')
      fail('log event is not siteborne.runtime_version');
    raw = ev;
    surface = 'Workers Logs event siteborne.runtime_version';
  }
  const at = args.get('observed-at') ?? nowIso();
  // STAGE G (running code's own report)
  const obs = await sealRuntimeSelfReport({
    environment: context.environment,
    deployment_unit: context.deployment_unit,
    captured_at: nowIso(),
    observed_at: at,
    actor: context.actor,
    observation_surface: surface,
    evidence_source: surface,
    parent_ids: [deployment.record_id],
    report: parseRuntimeVersionReport(raw),
  });
  writeStage('G-runtime', { context, records: [obs] });
  await report();
}

async function stagePersist(): Promise<void> {
  const { records } = await allRecords();
  const graph = new EvidenceGraph();
  await projectProvenance(graph, records);
  const out = resolve(req('out-sql'));
  if (existsSync(out)) fail(`${out} exists; evidence SQL is never rewritten`);
  // STAGE H: rendered only. Applying it is a separately authorized operator step.
  writeFileSync(out, await renderEvidenceInsertSql(graph.allNodes(), graph.allEdges()), {
    flag: 'wx',
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        stage: 'H-persist',
        sql: out,
        nodes: graph.allNodes().length,
        edges: graph.allEdges().length,
        conflicts: graph.conflicts(),
      },
      null,
      2
    )}\n`
  );
}

async function report(): Promise<void> {
  const { context, records } = await allRecords();
  const chain = await evaluateProvenanceChain(
    records,
    { environment: context.environment, deployment_unit: context.deployment_unit },
    {
      now: args.get('now') ?? nowIso(),
      maxObservationAgeMs: Number(args.get('max-age-ms') ?? 3_600_000),
    }
  );
  const artifact = records.find((r) => r.record_type === 'ArtifactRecord') as
    | ArtifactRecord
    | undefined;
  const build = records.find((r) => r.record_type === 'BuildRecord');
  const source = records.find((r) => r.record_type === 'SourceRecord');
  // Local-only chains have no platform links yet; report the local link directly.
  const localBound =
    !!artifact &&
    !!build &&
    !!source &&
    build.record_type === 'BuildRecord' &&
    source.record_type === 'SourceRecord' &&
    build.source_commit === source.source_commit &&
    build.module_set_digest === artifact.module_set_digest &&
    build.artifact_sha256 === artifact.artifact_sha256 &&
    [source, build, artifact].every((r) => r.proof.binding === 'CRYPTOGRAPHICALLY_BOUND');
  process.stdout.write(
    `${JSON.stringify(
      {
        deployment_unit: context.deployment_unit,
        source_commit: source?.record_type === 'SourceRecord' ? source.source_commit : null,
        artifact_sha256: artifact?.artifact_sha256 ?? null,
        module_set_digest: artifact?.module_set_digest ?? null,
        toolchain: build?.record_type === 'BuildRecord' ? build.toolchain : null,
        build_command: build?.record_type === 'BuildRecord' ? build.build_command : null,
        local_source_to_artifact: localBound ? 'CRYPTOGRAPHICALLY_BOUND' : 'UNBOUND',
        chain,
      },
      null,
      2
    )}\n`
  );
}

switch (stage) {
  case 'local':
    await stageLocal();
    break;
  case 'upload':
    await stageUpload();
    break;
  case 'deployment':
    await stageDeployment();
    break;
  case 'runtime':
    await stageRuntime();
    break;
  case 'persist':
    await stagePersist();
    break;
  case 'evaluate':
    await report();
    break;
  default:
    fail(`unknown stage ${String(stage)}`);
}

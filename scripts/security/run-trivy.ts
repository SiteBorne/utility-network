#!/usr/bin/env tsx
/**
 * SUN-1000 checkpoint 1B — deterministic Trivy gate.
 *
 * This repository has no Dockerfile, no container image build, and no
 * IaC/Kubernetes/cloud-infrastructure definitions (verified: no
 * `Dockerfile`, `docker-compose*`, `*.tf`, or `k8s`/`kustomize` manifests
 * exist anywhere in the tree). Per this checkpoint's own instruction not
 * to scan imaginary infrastructure, Trivy's relevant scope here is
 * **filesystem dependency vulnerabilities + misconfiguration scanning**
 * (`trivy fs`) — not container/IaC scanning, which does not apply until
 * SITEBORNE actually ships a container image or IaC definitions (a
 * later, separate concern).
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { bootstrapAll } from './bootstrap';

export class RepositoryCacheDirError extends Error {}

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUTPUT_DIR = join(REPO_ROOT, 'security', 'output');
const OUTPUT_PATH = join(OUTPUT_DIR, 'trivy.json');

interface TrivyVuln {
  VulnerabilityID: string;
  PkgName: string;
  InstalledVersion: string;
  FixedVersion?: string;
  Severity: string;
}
interface TrivyMisconfig {
  ID: string;
  Severity: string;
  Title: string;
}
interface TrivyResultEntry {
  Target: string;
  Vulnerabilities?: TrivyVuln[];
  Misconfigurations?: TrivyMisconfig[];
}
interface TrivyReport {
  SchemaVersion: number;
  ArtifactName: string;
  Results?: TrivyResultEntry[];
}

const BLOCKING_SEVERITIES = new Set(['CRITICAL', 'HIGH']);

/**
 * SUN-1000 checkpoint 1F — optional external cache-directory override.
 *
 * Trivy's vulnerability DB (~108 MB) and its extraction/working files
 * must land somewhere with real free space. This repository's default
 * disk has repeatedly been at or near capacity (checkpoint 1B: 1.1 GiB
 * free; checkpoint 1F baseline: 2.9 GiB free — both on the single local
 * APFS container, there is no separate higher-capacity volume on this
 * host). Rather than hard-coding a personal absolute path into source,
 * accept a non-secret override via `TRIVY_CACHE_DIR`; when unset, Trivy
 * falls through to its own built-in default cache location unchanged
 * (no behavior change for any caller that doesn't opt in). The
 * repository source tree itself is never a valid cache target — reject
 * it outright rather than silently caching inside tracked files.
 */
export function resolveCacheDir(
  env: Record<string, string | undefined>,
  repoRoot: string
): string | undefined {
  const override = env.TRIVY_CACHE_DIR;
  if (!override) return undefined;
  const resolved = join(override);
  if (resolved === repoRoot || resolved.startsWith(repoRoot + '/')) {
    throw new RepositoryCacheDirError(
      `TRIVY_CACHE_DIR must not be inside the repository source tree (got: ${resolved})`
    );
  }
  return resolved;
}

async function main(): Promise<void> {
  const { trivy } = await bootstrapAll();
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const cacheDir = resolveCacheDir(process.env, REPO_ROOT);
  const cacheArgs = cacheDir ? ['--cache-dir', cacheDir] : [];

  const result = spawnSync(
    trivy,
    [
      'fs',
      '--scanners',
      'vuln,misconfig',
      '--format',
      'json',
      '--output',
      OUTPUT_PATH,
      '--skip-dirs',
      'node_modules,.security-tools,dist,.venv,services/modal-worker/.venv',
      '--exit-code',
      '0', // never let trivy's own exit code stand in for our policy decision — we classify the JSON ourselves below
      ...cacheArgs,
      REPO_ROOT,
    ],
    { cwd: REPO_ROOT, stdio: 'inherit' }
  );

  if (result.status !== 0) {
    console.error(`TRIVY TOOL ERROR: exit code ${result.status}`);
    process.exitCode = 1;
    return;
  }
  if (!existsSync(OUTPUT_PATH)) {
    console.error('TRIVY FAILED: no structured output produced.');
    process.exitCode = 1;
    return;
  }

  const report = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8')) as TrivyReport;
  let vulns = 0;
  let blockingVulns = 0;
  let misconfigs = 0;
  let blockingMisconfigs = 0;
  for (const entry of report.Results ?? []) {
    for (const v of entry.Vulnerabilities ?? []) {
      vulns += 1;
      if (BLOCKING_SEVERITIES.has(v.Severity)) blockingVulns += 1;
    }
    for (const m of entry.Misconfigurations ?? []) {
      misconfigs += 1;
      if (BLOCKING_SEVERITIES.has(m.Severity)) blockingMisconfigs += 1;
    }
  }

  // eslint-disable-next-line no-console
  console.log('Trivy summary:', {
    schema_version: report.SchemaVersion,
    targets_scanned: report.Results?.length ?? 0,
    scope:
      'filesystem dependencies + misconfiguration (no Dockerfile/IaC exists in this repository)',
    total_vulnerabilities: vulns,
    blocking_critical_high_vulnerabilities: blockingVulns,
    total_misconfigurations: misconfigs,
    blocking_critical_high_misconfigurations: blockingMisconfigs,
    output: OUTPUT_PATH,
  });

  if (blockingVulns > 0 || blockingMisconfigs > 0) {
    console.error(
      `TRIVY: ${blockingVulns} blocking vulnerabilit${blockingVulns === 1 ? 'y' : 'ies'}, ${blockingMisconfigs} blocking misconfiguration(s). See ${OUTPUT_PATH}.`
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error('TRIVY BOOTSTRAP/EXECUTION FAILURE:', e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
}

import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const repositoryRoot = resolve(import.meta.dirname, '..');
const configPath = join(repositoryRoot, '.gitleaks.toml');

function run(command: string, args: string[], input?: string): string {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    input,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${String(result.status)}`);
  }
  return result.stdout;
}

const trackedFiles = run('git', ['ls-files', '-z'])
  .split('\0')
  .filter((path) => path.length > 0);

if (trackedFiles.length === 0) throw new Error('No tracked files were found');

const missingTrackedFiles = trackedFiles.filter((path) => {
  try {
    return !statSync(join(repositoryRoot, path)).isFile();
  } catch {
    return true;
  }
});
if (missingTrackedFiles.length > 0) {
  throw new Error(`Tracked files missing from the working tree: ${missingTrackedFiles.join(', ')}`);
}

const ignoredTrackedFiles = run('git', ['ls-files', '-ci', '--exclude-standard'])
  .split('\n')
  .filter((path) => path.length > 0);
if (ignoredTrackedFiles.length > 0) {
  throw new Error(`Tracked files are excluded by ignore rules: ${ignoredTrackedFiles.join(', ')}`);
}

const requiredClasses: Array<{ label: string; matches: (path: string) => boolean }> = [
  {
    label: 'tracked source',
    matches: (path) =>
      /^(apps|packages|services)\//.test(path) && /\.(cjs|js|json|mjs|py|ts|tsx)$/.test(path),
  },
  {
    label: 'package and TypeScript configuration',
    matches: (path) =>
      basename(path) === 'package.json' ||
      basename(path) === 'pnpm-lock.yaml' ||
      /^tsconfig.*\.json$/.test(basename(path)) ||
      /\.config\.(cjs|js|mjs|ts)$/.test(path),
  },
  {
    label: 'governance state',
    matches: (path) => path === 'TASKS.yaml' || path === 'PROJECT_STATE.yaml',
  },
  { label: 'documentation and reports', matches: (path) => path.startsWith('docs/') },
  { label: 'migrations', matches: (path) => path.startsWith('migrations/') },
  {
    label: 'shell and repository scripts',
    matches: (path) => path.startsWith('scripts/') || path.endsWith('.sh'),
  },
  {
    label: 'tracked generated artifacts',
    matches: (path) => path.includes('/generated/'),
  },
  {
    label: 'live-test source',
    matches: (path) => path.includes('/tests/live/') && /\.(js|py|ts)$/.test(path),
  },
];

for (const requiredClass of requiredClasses) {
  if (!trackedFiles.some(requiredClass.matches)) {
    throw new Error(`Secret-scan scope has no file in required class: ${requiredClass.label}`);
  }
}

const config = readFileSync(configPath, 'utf8');
if (/^\s*paths\s*=/mu.test(config)) {
  throw new Error(
    'Path-wide Gitleaks allowlists are forbidden because they create tracked-file blind spots'
  );
}
if (!/\[extend\][\s\S]*useDefault\s*=\s*true/u.test(config)) {
  throw new Error('Gitleaks default rules are not enabled');
}

const probePaths = [
  'apps/edge-api/src/secret-scope-probe.ts',
  'package.json',
  'TASKS.yaml',
  'PROJECT_STATE.yaml',
  'docs/reports/secret-scope-probe.md',
  'migrations/secret-scope-probe.sql',
  'scripts/secret-scope-probe.sh',
  'packages/contracts/generated/secret-scope-probe.json',
  'apps/edge-api/tests/live/secret-scope-probe.ts',
];

const probeRoot = mkdtempSync(join(tmpdir(), 'siteborne-secret-scope-'));
try {
  // Construct a well-known synthetic detector canary at runtime so the
  // scanner's own source never contains a token-shaped literal.
  const detectorCanary = ['g', 'h', 'p', '_'].join('') + randomBytes(27).toString('base64url');
  for (const relativePath of probePaths) {
    const probePath = join(probeRoot, relativePath);
    mkdirSync(dirname(probePath), { recursive: true });
    writeFileSync(probePath, `secret_scan_canary=${detectorCanary}\n`, { mode: 0o600 });

    const result = spawnSync(
      'gitleaks',
      ['dir', probePath, `--config=${configPath}`, '--redact', '--no-banner', '--exit-code=7'],
      { cwd: repositoryRoot, encoding: 'utf8' }
    );
    if (result.status !== 7) {
      throw new Error(
        `Gitleaks did not detect the redacted canary in ${relativePath} (status ${String(result.status)})`
      );
    }
  }
} finally {
  rmSync(probeRoot, { recursive: true, force: true });
}

const trackedBytes = trackedFiles.reduce(
  (total, path) => total + statSync(join(repositoryRoot, path)).size,
  0
);

console.log(
  `Secret-scan scope OK: ${trackedFiles.length} tracked files (${trackedBytes} bytes), ${requiredClasses.length} required classes, ${probePaths.length} redacted detector probes`
);

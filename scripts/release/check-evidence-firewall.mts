#!/usr/bin/env tsx
/**
 * R3-A4-55: run the Evidence Graph authority firewall (F4, F6-F9) against a
 * checkout, e.g. a release candidate worktree. Read-only. Exit 1 on any
 * violation.
 *
 * usage: tsx --tsconfig tsconfig.base.json scripts/release/check-evidence-firewall.mts --root <checkout>
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  AUTHORITY_MODULES,
  checkReleaseCaptureBoundary,
  checkRuntimeObservationBoundary,
  importsEvidenceGraph,
  type BoundaryViolation,
} from '../../packages/evidence-graph/src/index.ts';

const i = process.argv.indexOf('--root');
const root = resolve(i > 0 ? process.argv[i + 1] : '.');

function walk(dir: string, keep: (p: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory())
      return name === 'node_modules' || name === 'generated' ? [] : walk(p, keep);
    return keep(p) ? [p] : [];
  });
}

const runtime = new Map(
  walk(join(root, 'apps/edge-api/src'), (p) => p.endsWith('.ts') && !p.endsWith('.test.ts')).map(
    (p) => [relative(root, p), readFileSync(p, 'utf8')] as const
  )
);
const violations: (BoundaryViolation | { rule: 'F4'; file: string; detail: string })[] = [
  ...checkRuntimeObservationBoundary(runtime),
];
for (const m of AUTHORITY_MODULES) {
  const text = runtime.get(m);
  if (text !== undefined && importsEvidenceGraph(text)) {
    violations.push({ rule: 'F4', file: m, detail: 'authority module imports the evidence graph' });
  }
}
for (const p of walk(
  join(root, 'scripts/release'),
  (x) => /\.(mts|ts)$/.test(x) && !x.endsWith('.test.ts')
)) {
  violations.push(...checkReleaseCaptureBoundary(relative(root, p), readFileSync(p, 'utf8')));
}

const authorityPresent = AUTHORITY_MODULES.filter((m) => runtime.has(m));
process.stdout.write(
  `${JSON.stringify(
    {
      root,
      runtime_files_checked: runtime.size,
      authority_modules_present: authorityPresent.length,
      version_metadata_readers: [...runtime]
        .filter(([, t]) => t.includes('CF_VERSION_METADATA'))
        .map(([f]) => f),
      violations,
      EVIDENCE_AUTHORITY_FIREWALL: violations.length === 0 ? 'PASS' : 'FAIL',
    },
    null,
    2
  )}\n`
);
process.exit(violations.length === 0 ? 0 : 1);

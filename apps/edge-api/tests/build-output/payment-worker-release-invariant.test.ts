/**
 * SETTLEMENT-OBSERVABILITY-01 -- multi-Worker release invariant.
 *
 * The JWT bundle-init defect was repaired and qualified on the public API
 * Worker only, while the payment Workflow ran in a SEPARATE Worker script
 * (`siteborne-paid-continuation-runtime`) built from a different config, that no
 * gate covered and that a public-canary version override cannot reach.
 *
 * This test enumerates every Worker config in the repo whose entry graph can
 * perform CDP/x402 authentication and requires set equality with the Workers
 * that have an emitted-bundle JWT gate (`fixtures/payment-worker-gates.ts`). A
 * new payment-capable Worker without a gate -- or a gate for a Worker that no
 * longer exists -- fails the release.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  NON_DEPLOYED_PAYMENT_GRAPH_WORKERS,
  PAYMENT_WORKER_GATES,
} from './fixtures/payment-worker-gates';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

/** A module specifier that means "this graph can mint CDP/x402 auth". */
const PAYMENT_SPECIFIER = /^@coinbase\/cdp-sdk(\/|$)/;
const PAYMENT_MODULE = /control-plane\/evidence\/cdp-provider(\.[cm]?[jt]s)?$/;

const IMPORT_PATTERNS = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
];

function tomlString(toml: string, key: string): string | undefined {
  return new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm').exec(toml)?.[1];
}

function resolveRelative(fromFile: string, specifier: string): string | undefined {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    base.replace(/\.[cm]?js$/, '.ts'),
    `${base}.ts`,
    path.join(base, 'index.ts'),
  ];
  return candidates.find((candidate) => existsSync(candidate) && /\.[cm]?[jt]s$/.test(candidate));
}

/** Whether the static + dynamic import graph rooted at `entry` reaches the CDP
 * provider or the CDP SDK. Relative imports only: workspace packages are
 * credential-independent by ADR and are not followed. */
function reachesPaymentAuth(entry: string): boolean {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    if (PAYMENT_MODULE.test(file.replace(/\\/g, '/'))) return true;
    const source = readFileSync(file, 'utf8');
    for (const pattern of IMPORT_PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        const specifier = match[1] as string;
        if (PAYMENT_SPECIFIER.test(specifier)) return true;
        if (specifier.startsWith('.')) {
          const resolved = resolveRelative(file, specifier);
          if (resolved) queue.push(resolved);
        }
      }
    }
  }
  return false;
}

function discoverPaymentCapableWorkers(): string[] {
  return readdirSync(REPO_ROOT)
    .filter((name) => /^wrangler(\..+)?\.toml$/.test(name))
    .flatMap((name) => {
      const toml = readFileSync(path.join(REPO_ROOT, name), 'utf8');
      const main = tomlString(toml, 'main');
      const scriptName = tomlString(toml, 'name');
      if (!main || !scriptName) return [];
      const entry = path.join(REPO_ROOT, main);
      return existsSync(entry) && reachesPaymentAuth(entry) ? [scriptName] : [];
    })
    .sort();
}

describe('payment-capable Worker release invariant', () => {
  it('discovers exactly the payment-graph Workers: gated Workers plus the proven never-deployed set', () => {
    const discovered = discoverPaymentCapableWorkers();
    const gated = PAYMENT_WORKER_GATES.map((gate) => gate.scriptName);
    const exempt = NON_DEPLOYED_PAYMENT_GRAPH_WORKERS.map((worker) => worker.scriptName);
    expect(gated.filter((name) => exempt.includes(name))).toEqual([]);
    expect([...gated, ...exempt].sort()).toEqual(discovered);
  });

  it('PAYMENT_CAPABLE_WORKERS (deployable) equals QUALIFIED_PAYMENT_WORKERS (set equality)', () => {
    const exempt = NON_DEPLOYED_PAYMENT_GRAPH_WORKERS.map((worker) => worker.scriptName);
    const paymentCapable = discoverPaymentCapableWorkers().filter((name) => !exempt.includes(name));
    const qualified = PAYMENT_WORKER_GATES.map((gate) => gate.scriptName).sort();
    expect(qualified).toEqual(paymentCapable);
  });

  it('every exempt Worker is proven never deployed: config says so and no deploy command names it', () => {
    const deployCommand = /wrangler[^\n]*\b(deploy|versions)\b(?![^\n]*--dry-run)/;
    const commandSources = [
      readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
      ...readdirSync(path.join(REPO_ROOT, '.github/workflows')).map((file) =>
        readFileSync(path.join(REPO_ROOT, '.github/workflows', file), 'utf8')
      ),
    ];
    for (const worker of NON_DEPLOYED_PAYMENT_GRAPH_WORKERS) {
      const config = readFileSync(path.join(REPO_ROOT, worker.config), 'utf8');
      expect(tomlString(config, 'name'), worker.config).toBe(worker.scriptName);
      expect(config, worker.config).toMatch(/NEVER deployed/);
      for (const source of commandSources) {
        for (const line of source.split('\n')) {
          if (line.includes(worker.config) || line.includes(worker.scriptName)) {
            expect(deployCommand.test(line), line).toBe(false);
          }
        }
      }
    }
  });

  it('every gate names a real config, a real probe entry and a real gate test', () => {
    for (const gate of PAYMENT_WORKER_GATES) {
      const config = path.join(REPO_ROOT, gate.config);
      expect(existsSync(config), gate.config).toBe(true);
      expect(tomlString(readFileSync(config, 'utf8'), 'name')).toBe(gate.scriptName);
      expect(existsSync(path.join(REPO_ROOT, gate.probeEntry)), gate.probeEntry).toBe(true);
      expect(existsSync(path.join(REPO_ROOT, gate.gateTest)), gate.gateTest).toBe(true);
    }
  });

  it('each gate test builds its own Worker config (no gate silently reuses another config)', () => {
    for (const gate of PAYMENT_WORKER_GATES) {
      const source = readFileSync(path.join(REPO_ROOT, gate.gateTest), 'utf8');
      const probe = path.basename(gate.probeEntry, '.ts');
      expect(source, gate.gateTest).toContain(probe);
      if (gate.config !== 'wrangler.toml') {
        // Non-root configs must be passed to Wrangler explicitly.
        expect(source, gate.gateTest).toContain(path.basename(gate.config));
        expect(source, gate.gateTest).toContain("'--config'");
      }
    }
  });

  it('would fail if a payment-capable Worker had no gate (negative control)', () => {
    const exempt = NON_DEPLOYED_PAYMENT_GRAPH_WORKERS.map((worker) => worker.scriptName);
    const paymentCapable = discoverPaymentCapableWorkers().filter((name) => !exempt.includes(name));
    expect(paymentCapable).toContain('siteborne-paid-continuation-runtime');
    const withoutHost = PAYMENT_WORKER_GATES.filter(
      (gate) => gate.scriptName !== 'siteborne-paid-continuation-runtime'
    ).map((gate) => gate.scriptName);
    expect(withoutHost.sort()).not.toEqual(paymentCapable);
  });
});

#!/usr/bin/env -S npx tsx
/**
 * SUN-1205 checkpoint K (§3) — `pnpm production:preflight`.
 *
 * A real, actually-invoked production-readiness preflight. Distinct from
 * `apps/edge-api/src/control-plane/config/env.ts`'s `validateProductionBindings`
 * (a runtime function never wired into the live request path) and
 * `production-payment.ts`'s `checkProductionBindingsPresent` (wired into
 * the live request path, but only checks the three CDP secrets, and only
 * runs once a request is already in flight): this script is a *release-gate*
 * check, meant to be run by a human/CI before an upload, that combines:
 *
 *   1. Binding presence — calls `validateProductionBindings` (SUN-1205
 *      fixed it to require only `DB`, the sole binding any live source
 *      path dereferences) against a real Env-shaped object built from
 *      `wrangler.toml`'s own declared bindings, never from guesses.
 *   2. Non-secret [vars] presence in `wrangler.toml` itself — the
 *      candidate's own committed config is the source of truth for these
 *      (SELLER_WALLET_ADDRESS, AGENT_CARD_SIGNING_KEY_ID), NOT
 *      `wrangler secret list` — they are deliberately plaintext, per
 *      wrangler.toml's own comment (`[vars] values are plaintext:
 *      committed to this file... Only genuinely non-secret configuration
 *      belongs here`). Treating them as secrets would be a category
 *      error this preflight deliberately avoids.
 *   3. Real secret NAME presence in the target Cloudflare account — calls
 *      `wrangler secret list` (read-only, lists names only, never values)
 *      for the credentials that are genuinely secret material (the two
 *      CDP API secrets, the Nevermined API key under either name,
 *      AGENT_CARD_SIGNING_PRIVATE_KEY paired with its [vars] KEY_ID).
 *
 * This script performs ZERO mutating Cloudflare API calls: it only ever
 * calls `wrangler secret list` (a read). It never prints, logs, or embeds
 * any secret VALUE — only secret NAMES, which `wrangler secret list`
 * itself never exposes values for.
 *
 * Exit code 0 = preflight PASS. Exit code 1 = preflight FAIL (missing
 * binding, missing var, or missing secret name). Exit code 2 = could not
 * determine (e.g. `wrangler secret list` failed for an auth/network
 * reason distinct from "secret missing").
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import {
  validateProductionBindings,
  type Env,
} from '../apps/edge-api/src/control-plane/config/env';
// NOTE: `production-payment.ts` cannot be imported directly by a bare
// `tsx` script at repo root -- it transitively imports
// `@siteborne/protocol-x402`, a workspace package that is never built to
// `dist/` outside Vitest's aliased resolution (the same cross-package
// resolution limitation documented in `scripts/test-worker-runtime.mts`).
// Its `checkProductionBindingsPresent` logic (two required CDP secret
// names, presence-only) is hand-mirrored below as `CDP_REQUIRED_SECRETS`;
// equivalence with the real function is proven separately by
// `apps/edge-api/tests/*` Vitest tests that import the real module.
const CDP_REQUIRED_SECRETS = ['CDP_API_KEY_ID', 'CDP_API_KEY_SECRET'] as const;
const NEVERMINED_API_KEY_NAMES = ['NVM_API_KEY', 'NEVERMINED_API_KEY'] as const;
const REQUIRED_VARS = [
  'SELLER_WALLET_ADDRESS',
  'AGENT_CARD_SIGNING_KEY_ID',
  'NVM_ENVIRONMENT',
] as const;

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WRANGLER_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'wrangler');
const argv = process.argv.slice(2);
const configPathIndex = argv.indexOf('--config-path');
const CONFIG_ONLY = argv.includes('--config-only');
const WRANGLER_TOML =
  configPathIndex >= 0 && argv[configPathIndex + 1]
    ? argv[configPathIndex + 1]!
    : join(REPO_ROOT, 'wrangler.toml');
const PAID_SERVICES_SOURCE = join(
  REPO_ROOT,
  'apps',
  'edge-api',
  'src',
  'control-plane',
  'routes',
  'paid-services.ts'
);

const REQUIRED_VAR_VALUES = {
  ENVIRONMENT: 'production',
  PCC_VERSION: '1.0.0',
  NVM_ENVIRONMENT: 'sandbox',
} as const;

const ECONOMIC_ACTIVATION_VALUES = {
  PAYMENT_ENVIRONMENT: 'production',
  PRODUCTION_ENABLED: 'true',
  PRODUCTION_CDP_CREDENTIALS_APPROVED: 'true',
  HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: 'true',
  PAID_ROUTES_ENABLED: 'true',
} as const;

/** Source of truth: the D1 binding this repo's real request path
 * dereferences. Parsed from wrangler.toml so this preflight fails loudly
 * if the config's binding name ever drifts from what env.ts expects,
 * rather than silently assuming a name. */
function parseD1BindingName(): string | null {
  const toml = readFileSync(WRANGLER_TOML, 'utf-8');
  const match = /\[\[d1_databases\]\]\s*\nbinding\s*=\s*"([^"]+)"/.exec(toml);
  return match ? match[1] : null;
}

function parseScalar(name: string): string | null {
  const toml = readFileSync(WRANGLER_TOML, 'utf-8');
  const match = new RegExp(`^${name}\\s*=\\s*"([^"]+)"`, 'm').exec(toml);
  return match?.[1] ?? null;
}

/** Parses the [vars] table's simple `KEY = "value"` lines (this repo's
 * wrangler.toml never nests structured values under [vars]). Stops at the
 * next `[section]` header. */
function parseVarsTable(): Record<string, string> {
  const toml = readFileSync(WRANGLER_TOML, 'utf-8');
  const lines = toml.split('\n');
  const startIdx = lines.findIndex((l) => l.trim() === '[vars]');
  if (startIdx === -1) return {};
  const vars: Record<string, string> = {};
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\[/.test(line)) break; // next section
    const match = /^([A-Z0-9_]+)\s*=\s*"([^"]*)"/.exec(line.trim());
    if (match) vars[match[1]] = match[2];
  }
  return vars;
}

function listRemoteSecretNames(): string[] {
  const raw = execFileSync(WRANGLER_BIN, ['secret', 'list', '--config', WRANGLER_TOML], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`wrangler secret list did not return parseable JSON: ${raw.slice(0, 500)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('wrangler secret list returned a non-array JSON payload');
  }
  return parsed
    .map((entry) =>
      typeof entry === 'object' && entry && 'name' in entry
        ? (entry as { name: unknown }).name
        : undefined
    )
    .filter((name): name is string => typeof name === 'string');
}

function main(): void {
  console.log('[production:preflight] SUN-1205 checkpoint K -- production release-gate preflight.');
  console.log('[production:preflight] This performs ZERO mutating Cloudflare API calls.');

  const localFailures: string[] = [];
  const providerBlockers: string[] = [];
  const externalFailures: string[] = [];

  // --- Layer 1: binding presence, against wrangler.toml's declared name ---
  const d1BindingName = parseD1BindingName();
  if (d1BindingName !== 'DB') {
    localFailures.push(
      `wrangler.toml's D1 binding name is ${JSON.stringify(d1BindingName)}, expected "DB" ` +
        `(the name env.ts's validateProductionBindings and every live source reference assume).`
    );
  } else {
    // Isolates this call to just the binding-presence question -- secret
    // presence is checked separately (Layer 3, against the real target
    // account), so validateProductionBindings's secret sub-check is
    // neutralized here with placeholder, non-secret dummy values.
    const fakeBoundEnv = {
      DB: {},
      SELLER_WALLET_ADDRESS: 'placeholder',
      CDP_API_KEY_ID: 'placeholder',
      CDP_API_KEY_SECRET: 'placeholder',
      NVM_API_KEY: 'placeholder',
    } as unknown as Env;
    try {
      validateProductionBindings(fakeBoundEnv);
      console.log('[production:preflight] PASS: required binding(s) present -- DB.');
    } catch (err) {
      localFailures.push(
        `validateProductionBindings rejected the declared bindings: ${String(err)}`
      );
    }
  }

  // --- Layer 2: non-secret [vars] presence, from the candidate's own committed config ---
  const vars = parseVarsTable();
  const missingVars = REQUIRED_VARS.filter((name) => !vars[name]);
  if (missingVars.length > 0) {
    localFailures.push(`wrangler.toml's [vars] table is missing: ${missingVars.join(', ')}`);
  } else {
    console.log(
      `[production:preflight] PASS: required [vars] present -- ${REQUIRED_VARS.join(', ')}.`
    );
  }

  for (const [name, expected] of Object.entries(REQUIRED_VAR_VALUES)) {
    if (vars[name] !== expected) {
      localFailures.push(
        `wrangler.toml [vars].${name} is ${JSON.stringify(vars[name] ?? null)}, expected ${JSON.stringify(expected)}`
      );
    }
  }
  const activeEconomicVars = Object.entries(ECONOMIC_ACTIVATION_VALUES)
    .filter(([name, active]) => vars[name] === active)
    .map(([name]) => name);
  if (activeEconomicVars.length > 0) {
    localFailures.push(
      `pre-upload candidate contains active economic/cutover vars: ${activeEconomicVars.join(', ')}`
    );
  } else {
    console.log(
      '[production:preflight] PASS: economic/cutover vars are absent or fail-closed in the pre-upload candidate.'
    );
  }

  const main = parseScalar('main');
  if (main !== 'apps/edge-api/src/index.ts') {
    localFailures.push(
      `wrangler.toml main is ${JSON.stringify(main)}, expected production index.ts`
    );
  }
  const compatibilityDate = parseScalar('compatibility_date');
  if (compatibilityDate !== '2026-08-05') {
    localFailures.push(
      `wrangler.toml compatibility_date is ${JSON.stringify(compatibilityDate)}, expected "2026-08-05"`
    );
  }

  if (localFailures.length === 0) {
    console.log('[production:preflight] PRODUCTION_CONFIG_DRIFT_CHECK: PASS');
  } else {
    console.error('[production:preflight] PRODUCTION_CONFIG_DRIFT_CHECK: FAIL');
  }

  if (CONFIG_ONLY) {
    if (localFailures.length > 0) {
      for (const failure of localFailures) console.error(`  - ${failure}`);
      process.exit(1);
    }
    console.log('[production:preflight] CONFIG-ONLY RESULT: PASS');
    process.exit(0);
  }

  // The release gate must describe what the production source really builds,
  // not just whether payment credentials exist. These markers are load-bearing
  // constructor calls in the production paid-route source: while present, the
  // service executor is deterministic fixture infrastructure rather than a
  // live provider implementation. Payment-provider fail-closed behavior does
  // not make canned service data production-ready.
  const paidServicesSource = readFileSync(PAID_SERVICES_SOURCE, 'utf-8');
  const fixtureServiceMarkers = [
    'buildFixtureRegistry',
    'createFixtureSigner',
    'FixtureDocumentWorkerBridge',
    "execution_mode: 'fixture'",
  ].filter((marker) => paidServicesSource.includes(marker));
  if (fixtureServiceMarkers.length > 0) {
    providerBlockers.push(
      `production paid-service executors remain fixture-backed (${fixtureServiceMarkers.join(', ')})`
    );
  }

  // --- Layer 3: real secret NAME presence in the target Cloudflare account ---
  let remoteSecretNames: string[];
  try {
    remoteSecretNames = listRemoteSecretNames();
  } catch (err) {
    console.error(
      `[production:preflight] INDETERMINATE: could not list remote secret names (auth/network issue, ` +
        `not itself proof secrets are missing): ${String(err)}`
    );
    process.exit(2);
  }
  const remoteSet = new Set(remoteSecretNames);
  console.log(
    `[production:preflight] wrangler secret list returned ${remoteSecretNames.length} secret name(s) ` +
      '(names only -- no values were read, logged, or printed).'
  );

  const missingSecrets: string[] = [];
  for (const name of CDP_REQUIRED_SECRETS) {
    if (!remoteSet.has(name)) missingSecrets.push(name);
  }
  const hasNeverminedCredential = NEVERMINED_API_KEY_NAMES.some((n) => remoteSet.has(n));
  if (!hasNeverminedCredential) {
    missingSecrets.push('NVM_API_KEY (or deprecated alias NEVERMINED_API_KEY)');
  }

  // AGENT_CARD_SIGNING_PRIVATE_KEY (real secret) must be present alongside
  // the already-committed [vars] AGENT_CARD_SIGNING_KEY_ID (env.ts's own
  // doc comment: both or neither). resolveAgentCardSigningIdentity fails
  // closed to the ephemeral dev identity on a partial pair rather than
  // throwing -- but a partial pair in the REAL target account still means
  // production Agent Card signing is effectively unconfigured, worth
  // surfacing here.
  const hasPrivateKey = remoteSet.has('AGENT_CARD_SIGNING_PRIVATE_KEY');
  const hasKeyIdVar = Boolean(vars.AGENT_CARD_SIGNING_KEY_ID);
  if (hasKeyIdVar && !hasPrivateKey) {
    missingSecrets.push('AGENT_CARD_SIGNING_PRIVATE_KEY');
  }

  if (missingSecrets.length > 0) {
    externalFailures.push(
      `missing required real secret name(s) in the target Cloudflare account: ${missingSecrets.join(', ')}`
    );
  } else {
    console.log('[production:preflight] PASS: all required real secret names are present.');
  }

  if (localFailures.length > 0 || providerBlockers.length > 0) {
    console.error('[production:preflight] FAIL (repository-owned blocker):');
    for (const f of [...localFailures, ...providerBlockers]) console.error(`  - ${f}`);
    for (const f of externalFailures) console.error(`  - external: ${f}`);
    console.error('[production:preflight] PREFLIGHT RESULT: FAIL');
    process.exit(1);
  }

  if (externalFailures.length > 0) {
    console.error('[production:preflight] EXTERNAL_BLOCK:');
    for (const f of externalFailures) console.error(`  - ${f}`);
    console.error('[production:preflight] PREFLIGHT RESULT: EXTERNAL_BLOCK');
    process.exit(1);
  }

  console.log('[production:preflight] PREFLIGHT RESULT: PASS');
  process.exit(0);
}

main();

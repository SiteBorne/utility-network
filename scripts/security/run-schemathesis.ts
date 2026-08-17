#!/usr/bin/env tsx
/**
 * SUN-1000 checkpoint 1I — deterministic Schemathesis API property-
 * testing gate.
 *
 * Orchestrates: (1) a local, credential-free Vitest-hosted HTTP server
 * exercising the real paid-services Hono app (`evidenceMode: 'fixture'`,
 * no Nevermined/CDP calls — see
 * `apps/edge-api/tests/schemathesis-server-host.test.ts` for why this
 * runs under Vitest rather than bare `tsx`/`node`); (2) the pinned
 * Schemathesis CLI, run against the authoritative committed OpenAPI
 * document (`packages/contracts/generated/openapi/
 * service-contracts.openapi.json`, the same drift-checked artifact
 * `pnpm openapi:generate:check` already guards).
 *
 * `/quotes/{service_id}` is excluded from the live campaign: the
 * OpenAPI generator itself marks that operation
 * `'x-implementation-status': 'not_implemented'` /
 * `'x-production-enabled': false` — a deliberately documented
 * preproduction placeholder, not a real implemented route. Testing it
 * would only ever observe a 404 for a route everyone already knows
 * doesn't exist yet; excluding it is disclosed here, not silent.
 *
 * Known, disclosed `$ref`-name mismatch (checkpoint 1I discovery, NOT
 * fixed in the committed generator this checkpoint): the 4 paid-service
 * operations' request/response schemas reference component names
 * (`CompanyEvidenceGraphInput`, etc.) derived from each service ID's own
 * slug, but the actually-registered component names
 * (`CompanyEvidenceInput`, etc.) are derived from each schema file's
 * base name — the two derivations disagree whenever a service ID's slug
 * doesn't literally match its schema file's base name. A corrected
 * generator fix was written, verified to resolve the mismatch cleanly,
 * and then deliberately reverted: the repository's `contracts:
 * compat:check` gate classifies any change to these already-frozen
 * `contracts/releases/1.0.0` fields as `required_version_bump: major`
 * — bumping a frozen contract release is a separate governance decision
 * this checkpoint has no authority to make unilaterally. Rather than
 * either silently leaving Schemathesis unable to load the schema at all,
 * or bundling a contract-release version bump into a testing-gate
 * checkpoint, this orchestrator patches only its own ephemeral,
 * never-committed copy of the schema before handing it to Schemathesis
 * — the committed artifact and the frozen baseline are both left
 * completely untouched.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { bootstrapAll } from './bootstrap';

const KNOWN_REF_NAME_MISMATCHES: Record<string, string> = {
  CompanyEvidenceGraphInput: 'CompanyEvidenceInput',
  CompanyEvidenceGraphOutput: 'CompanyEvidenceOutput',
  WebContextVerifiedInput: 'WebContextInput',
  WebContextVerifiedOutput: 'WebContextOutput',
  DocumentEvidenceJsonInput: 'DocumentEvidenceInput',
  DocumentEvidenceJsonOutput: 'DocumentEvidenceOutput',
  VerifyAgentOutputInput: 'AgentVerificationInput',
  VerifyAgentOutputOutput: 'AgentVerificationOutput',
};

/** Rewrites every `#/components/schemas/<oldName>` `$ref` in the schema
 * text to point at the real, registered component name — a pure
 * string-level patch (the mismatched names never collide with any real
 * substring elsewhere in this schema) applied only to an in-memory/
 * temp-file copy, never to the committed artifact. */
export function patchKnownRefMismatches(schemaJsonText: string): string {
  let patched = schemaJsonText;
  for (const [badName, goodName] of Object.entries(KNOWN_REF_NAME_MISMATCHES)) {
    patched = patched
      .split(`#/components/schemas/${badName}"`)
      .join(`#/components/schemas/${goodName}"`);
  }
  return patched;
}

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUTPUT_DIR = join(REPO_ROOT, 'security', 'output');
const OUTPUT_PATH = join(OUTPUT_DIR, 'schemathesis.json');
const SECURITY_TOOLS_DIR = join(REPO_ROOT, '.security-tools');
const READY_INFO_PATH = join(SECURITY_TOOLS_DIR, 'schemathesis-server-ready.json');
const STOP_SENTINEL_PATH = join(SECURITY_TOOLS_DIR, 'schemathesis-server-stop');
const SCHEMA_PATH = join(
  REPO_ROOT,
  'packages',
  'contracts',
  'generated',
  'openapi',
  'service-contracts.openapi.json'
);
const SERVER_TEST_FILE = join(
  REPO_ROOT,
  'apps',
  'edge-api',
  'tests',
  'schemathesis-server-host.test.ts'
);
const REPORT_DIR = join(OUTPUT_DIR, 'schemathesis-report');

const SERVER_READY_TIMEOUT_MS = 30_000;
const SERVER_READY_POLL_MS = 250;
const SERVER_SHUTDOWN_TIMEOUT_MS = 15_000;

// Bounded, CI-safe campaign parameters — a real property-based
// exploration, not an unbounded fuzz run and not a load test (that is
// a separate, later SUN-1000 criterion).
const MAX_EXAMPLES_PER_OPERATION = 25;
const REQUEST_TIMEOUT_SECONDS = 5;
const SEED = 20260816; // fixed for CI reproducibility, matching this checkpoint's date

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Schemathesis's own exit-code contract: 0 = every check passed, 1 =
 * genuine findings (schema violations / unexpected errors), anything
 * else = a tool-level failure (bad args, crash, schema load error) —
 * never itself a "clean" result. Pulled out as a pure function so the
 * classification logic is unit-testable without spawning the real
 * binary. */
export function classifySchemathesisExit(
  status: number | null
): 'PASS' | 'FINDINGS' | 'TOOL_ERROR' {
  if (status === 0) return 'PASS';
  if (status === 1) return 'FINDINGS';
  return 'TOOL_ERROR';
}

/** Parses the server-ready JSON payload the Vitest-hosted local server
 * writes, failing closed (throwing) on any malformed or incomplete
 * content rather than silently proceeding with an undefined target
 * URL. Pulled out as a pure function so malformed-payload handling is
 * unit-testable without actually booting the server. */
export function parseServerReadyInfo(raw: string): { url: string; pid: number } {
  const parsed: unknown = JSON.parse(raw);
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as { url?: unknown }).url !== 'string' ||
    !(parsed as { url: string }).url.startsWith('http://127.0.0.1:') ||
    typeof (parsed as { pid?: unknown }).pid !== 'number'
  ) {
    throw new Error(`schemathesis_server_malformed_ready_info: ${raw}`);
  }
  return parsed as { url: string; pid: number };
}

async function waitForServerReady(): Promise<{ url: string; pid: number }> {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (existsSync(READY_INFO_PATH)) {
      try {
        return parseServerReadyInfo(readFileSync(READY_INFO_PATH, 'utf-8'));
      } catch {
        // File may be mid-write, or not yet fully flushed — retry.
      }
    }
    await sleep(SERVER_READY_POLL_MS);
  }
  throw new Error('schemathesis_server_not_ready: timed out waiting for local server to start');
}

async function main(): Promise<void> {
  if (!existsSync(SCHEMA_PATH)) {
    console.error(`SCHEMATHESIS: no OpenAPI schema found at ${SCHEMA_PATH}.`);
    console.error('Run `pnpm openapi:generate:check` (or the underlying generator) first.');
    process.exitCode = 1;
    return;
  }

  const { schemathesis } = await bootstrapAll();
  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(SECURITY_TOOLS_DIR, { recursive: true });
  rmSync(READY_INFO_PATH, { force: true });
  rmSync(STOP_SENTINEL_PATH, { force: true });
  rmSync(REPORT_DIR, { recursive: true, force: true });

  // Patch known $ref-name mismatches (see the top-of-file comment) into
  // an ephemeral, gitignored copy only — the committed artifact and the
  // frozen contracts baseline are never touched by this script.
  const patchedSchemaPath = join(SECURITY_TOOLS_DIR, 'schemathesis-patched-schema.json');
  writeFileSync(patchedSchemaPath, patchKnownRefMismatches(readFileSync(SCHEMA_PATH, 'utf-8')));

  const serverProc = spawn('npx', ['vitest', 'run', SERVER_TEST_FILE, '--reporter=basic'], {
    cwd: REPO_ROOT,
    env: { ...process.env, SCHEMATHESIS_SERVER_HOST: 'true' },
    stdio: 'inherit',
  });

  let serverInfo: { url: string; pid: number } | undefined;
  let schemathesisResult: ReturnType<typeof spawnSync> | undefined;
  try {
    serverInfo = await waitForServerReady();
    // eslint-disable-next-line no-console
    console.log(`Schemathesis target server ready: ${serverInfo.url}`);

    schemathesisResult = spawnSync(
      schemathesis,
      [
        'run',
        patchedSchemaPath,
        '-u',
        serverInfo.url,
        '--exclude-path-regex',
        '^/quotes/.*',
        '-n',
        String(MAX_EXAMPLES_PER_OPERATION),
        '--seed',
        String(SEED),
        '--request-timeout',
        String(REQUEST_TIMEOUT_SECONDS),
        '-c',
        'not_a_server_error,status_code_conformance,content_type_conformance,response_schema_conformance',
        '--report',
        'junit',
        '--report-dir',
        REPORT_DIR,
      ],
      { cwd: REPO_ROOT, stdio: 'inherit' }
    );
  } finally {
    writeFileSync(STOP_SENTINEL_PATH, String(Date.now()));
    const shutdownDeadline = Date.now() + SERVER_SHUTDOWN_TIMEOUT_MS;
    await new Promise<void>((resolve) => {
      serverProc.once('exit', () => resolve());
      const check = setInterval(() => {
        if (serverProc.exitCode !== null || Date.now() > shutdownDeadline) {
          clearInterval(check);
          resolve();
        }
      }, 200);
    });
    if (serverProc.exitCode === null) {
      serverProc.kill('SIGKILL');
    }
    rmSync(STOP_SENTINEL_PATH, { force: true });
    rmSync(READY_INFO_PATH, { force: true });
  }

  if (!serverInfo) {
    console.error('SCHEMATHESIS: local target server never became ready.');
    process.exitCode = 1;
    return;
  }
  if (!schemathesisResult) {
    console.error('SCHEMATHESIS: campaign did not execute.');
    process.exitCode = 1;
    return;
  }

  const classification = classifySchemathesisExit(schemathesisResult.status);
  if (classification === 'TOOL_ERROR') {
    console.error(`SCHEMATHESIS TOOL ERROR: exit code ${schemathesisResult.status}`);
    process.exitCode = 1;
    return;
  }

  const junitPath = join(REPORT_DIR, 'junit.xml');
  const summary = {
    schema_path: SCHEMA_PATH,
    patched_schema_path: patchedSchemaPath,
    ref_name_patches_applied: KNOWN_REF_NAME_MISMATCHES,
    target_url: serverInfo.url,
    excluded_operations: ['/quotes/{service_id} (x-implementation-status: not_implemented)'],
    max_examples_per_operation: MAX_EXAMPLES_PER_OPERATION,
    request_timeout_seconds: REQUEST_TIMEOUT_SECONDS,
    seed: SEED,
    checks: [
      'not_a_server_error',
      'status_code_conformance',
      'content_type_conformance',
      'response_schema_conformance',
    ],
    exit_code: schemathesisResult.status,
    junit_report: existsSync(junitPath) ? junitPath : null,
    report_dir: REPORT_DIR,
  };
  writeFileSync(OUTPUT_PATH, JSON.stringify(summary, null, 2));

  // eslint-disable-next-line no-console
  console.log('Schemathesis summary:', summary);

  if (classification === 'FINDINGS') {
    console.error(`SCHEMATHESIS: campaign found blocking issues. See ${REPORT_DIR}.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(
      'SCHEMATHESIS BOOTSTRAP/EXECUTION FAILURE:',
      e instanceof Error ? e.message : String(e)
    );
    process.exitCode = 1;
  });
}

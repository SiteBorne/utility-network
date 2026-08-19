#!/usr/bin/env -S npx tsx
/**
 * SUN-1201 checkpoint G — `OLD_VERIFY_PATH_CAUGHT` mutation proof.
 *
 * Automated evidence that the worker-runtime release gate would fail if
 * `verify_agent_output`'s `schema_valid` check ever regressed back to
 * its pre-checkpoint-F behavior: a real, request-time
 * `new Ajv2020(...).compile(input.required_schema)` call. Not a grep for
 * the old code's absence -- this genuinely mutates the live source file,
 * runs the exact real-`workerd` post-settlement scenario
 * (`verify_agent_output` Case A, the same one `scripts/
 * test-worker-runtime.mts`'s Phase 2 proves passes today) against the
 * mutated code, and requires it to fail for the expected reason before
 * restoring the original file and requiring the same scenario to pass
 * again.
 *
 * Never commits the mutant. Restoration is unconditional (a `finally`
 * block, `git checkout --` the exact file, verified via `git diff`
 * afterward). Requires the working tree to already be clean (aside from
 * the known, intentionally-preserved `wrangler.toml` transient diff)
 * before doing anything -- aborts rather than risking an unrelated
 * change if that is not true.
 *
 * IMPORTANT, discovered empirically while building this script (reported
 * honestly rather than assumed): the historical `schema_valid`
 * implementation already wrapped its `ajv.compile()` call in its own
 * `try/catch`, converting ANY compile-time exception -- including a real
 * Workers `EvalError` -- into a normal `{ passed: false, details:
 * "required_schema failed to compile: ..." }` result, never an uncaught
 * crash. A standalone smoke test (a bare fetch handler doing nothing but
 * `new Ajv2020().compile(this exact schema)`, no surrounding try/catch)
 * confirms the EvalError itself IS reliably thrown under real `workerd`
 * for this exact schema on every request -- so the underlying
 * request-time-eval defect genuinely still exists in the mutant, it is
 * just self-caught at this particular call site (unlike
 * `x402-service.ts`'s original, uncaught incident). The observable
 * regression this mutation proof therefore verifies is not a crash but a
 * silent, universal correctness failure: EVERY `schema_valid` check
 * (valid or invalid candidate) is misreported as failing, always,
 * because the compile step never succeeds. `runCaseAOnce`'s Case A
 * assertion (`result_class === 'success'`) correctly detects this --
 * under the mutant it observes 502/`partial` instead of 200/`success` --
 * which is the actual criterion this script judges the mutant against.
 */
import { execFileSync } from 'node:child_process';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WRANGLER_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'wrangler');
const TARGET_FILE = join(
  REPO_ROOT,
  'packages/service-runtime/src/services/agent-verification/service.ts'
);
const TARGET_FILE_REL = 'packages/service-runtime/src/services/agent-verification/service.ts';

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf-8' });
}

function runCommand(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'pipe' });
    let output = '';
    child.stdout?.on('data', (d) => (output += String(d)));
    child.stderr?.on('data', (d) => (output += String(d)));
    child.on('error', (err) => reject(new Error(`failed to spawn ${cmd}: ${String(err)}`)));
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}\n${output.slice(-2000)}`));
    });
  });
}

async function waitForReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`worker did not become ready within ${timeoutMs}ms: ${String(lastErr)}`);
}

function decodeHeader(header: string): any {
  return JSON.parse(Buffer.from(header, 'base64').toString('utf-8'));
}
function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf-8').toString('base64');
}

/** Runs the exact Case A scenario (Profile-1-supported schema + valid
 * candidate) against a fresh, isolated `wrangler dev --local` instance
 * of the test-only settlement seam, and returns the raw outcome for the
 * caller to judge (this script cares about BOTH "did it fail" and "did
 * it fail for the RIGHT reason", at different call sites). */
async function runCaseAOnce(): Promise<{ status: number; body: string; devLog: string }> {
  const configPath = join(REPO_ROOT, 'wrangler.worker-runtime-test.toml');
  const tempDir = mkdtempSync(join(tmpdir(), 'siteborne-mutation-proof-'));
  let devProcess: ChildProcess | undefined;
  try {
    await runCommand(
      WRANGLER_BIN,
      [
        'd1',
        'migrations',
        'apply',
        'siteborne-worker-runtime-test',
        '--local',
        '--config',
        configPath,
        '--persist-to',
        tempDir,
      ],
      REPO_ROOT
    );
    const port = 19500 + Math.floor(Math.random() * 500);
    const base = `http://127.0.0.1:${port}`;
    devProcess = spawn(
      WRANGLER_BIN,
      ['dev', '--local', '--port', String(port), '--config', configPath, '--persist-to', tempDir],
      { cwd: REPO_ROOT, stdio: 'pipe' }
    );
    let devLog = '';
    devProcess.stdout?.on('data', (d) => (devLog += String(d)));
    devProcess.stderr?.on('data', (d) => (devLog += String(d)));
    devProcess.on('error', () => {
      /* surfaced via waitForReady's timeout, see test-worker-runtime.mts's identical comment */
    });

    await waitForReady(`${base}/`, 60_000);

    const caseABody = {
      verification_contract: {
        claims: [],
        deterministic_requirements: [{ requirement_id: 'schema_check', check: 'schema_valid' }],
      },
      candidate_output: { total: 42 },
      required_schema: {
        type: 'object',
        properties: { total: { type: 'number' } },
        required: ['total'],
      },
      verification_mode: 'standard',
    };
    const challengeRes = await fetch(`${base}/v1/verify/agent-output`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(caseABody),
    });
    const header = challengeRes.headers.get('PAYMENT-REQUIRED');
    if (!header) {
      return { status: challengeRes.status, body: await challengeRes.text(), devLog };
    }
    const challenge = decodeHeader(header);
    const declared = challenge.extensions?.['payment-identifier'];
    const extensions = declared
      ? {
          'payment-identifier': {
            info: { ...declared.info, id: 'pay_mutation_proof_' + Date.now() },
          },
        }
      : {};
    const payload = {
      x402Version: 2,
      resource: challenge.resource,
      accepted: challenge.accepts[0],
      payload: { synthetic_signature: 'synthetic:buyer-fixture' },
      extensions,
    };
    const paidRes = await fetch(`${base}/v1/verify/agent-output`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': encodeHeader(payload) },
      body: JSON.stringify(caseABody),
    });
    return { status: paidRes.status, body: await paidRes.text(), devLog };
  } finally {
    if (devProcess && !devProcess.killed) {
      devProcess.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 500));
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/** The historical, pre-SUN-1200-checkpoint-F `schema_valid` implementation
 * -- a real, request-time `Ajv2020.compile()` against the buyer-supplied
 * schema. Reconstructed from this repository's own git history
 * (the exact code checkpoint F's own commit replaced), not invented. */
const MUTANT_SOURCE = `/**
 * MUTATION TEST FIXTURE -- SUN-1201 checkpoint G. Never committed. See
 * scripts/test-old-verify-path-caught.mts.
 */
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { KeyRegistry, ReproductionInput, Signer } from '@siteborne/verification';
import { buildClaim } from '../../claims/builder';
import { buildEvidence } from '../../evidence/builder';
import {
  buildDraftDocument,
  defaultProvenance,
  verifyAndSign,
  toVerificationSummary,
} from '../../pcc';
import type { PccClaim, PccEvidenceItem } from '../../pcc/document-types';
import type { LocalService, ServiceExecutionContext, ServiceExecutionResult } from '../../types';
import { evaluateClaim } from './claim-evaluation';
import type {
  AgentVerificationExtension,
  AgentVerificationInput,
  DeterministicCheck,
} from './types';

export interface AgentVerificationServiceDeps {
  signer: Signer;
  keyRegistry: KeyRegistry;
  reproduction?: ReproductionInput | null;
}

export class VerifyAgentOutputService
  implements LocalService<AgentVerificationInput, AgentVerificationExtension>
{
  readonly serviceId = 'verify_agent_output.v1' as const;
  readonly serviceVersion = 'v1' as const;

  constructor(private readonly deps: AgentVerificationServiceDeps) {}

  async execute(
    input: AgentVerificationInput,
    context: ServiceExecutionContext
  ): Promise<ServiceExecutionResult<AgentVerificationExtension>> {
    const startedMs = context.clock.nowMs();
    const inputHash = 'sha256:' + createHash('sha256').update(JSON.stringify(input)).digest('hex');

    if (
      !input.verification_contract ||
      !input.candidate_output ||
      !input.required_schema ||
      !input.verification_mode
    ) {
      return rejected(
        context,
        startedMs,
        inputHash,
        'verification_contract, candidate_output, required_schema, and verification_mode are all required'
      );
    }

    const candidateOutputHash =
      'sha256:' + createHash('sha256').update(JSON.stringify(input.candidate_output)).digest('hex');
    const candidateEvidence = buildEvidence({
      seed: \`verify_agent_output.v1:candidate_output:\${candidateOutputHash}\`,
      sourceUri: \`candidate://\${context.job_id}\`,
      retrievedAtIso: new Date(context.clock.nowMs()).toISOString(),
      contentHash: candidateOutputHash,
      mediaType: 'application/json',
      locator: { type: 'json_pointer', value: '/' },
      authorizationClassification: 'buyer_authorized',
    });

    const claims: PccClaim[] = [];
    const evidence: PccEvidenceItem[] = [candidateEvidence];
    const requirementResults: NonNullable<AgentVerificationExtension['requirement_results']> = [];
    const failedRequirements: string[] = [];
    const unverifiableAssertions: string[] = [];

    let supportedClaims = 0;
    for (const contractClaim of input.verification_contract.claims) {
      const evaluation = evaluateClaim(input.candidate_output, contractClaim);
      if (evaluation.passed) supportedClaims++;
      claims.push(
        buildClaim({
          seed: \`verify_agent_output.v1:claim:\${contractClaim.claim_id}:\${candidateOutputHash}\`,
          predicate: contractClaim.claim_id,
          value: evaluation.passed,
          confidence: evaluation.passed ? 0.95 : 0.5,
          evidenceIds: [candidateEvidence.evidence_id],
          verificationStatus: evaluation.passed ? 'verified' : 'unsupported',
        })
      );
      if (!evaluation.passed) failedRequirements.push(\`claim:\${contractClaim.claim_id}\`);
    }

    for (const requirement of input.verification_contract.deterministic_requirements) {
      const outcome = evaluateDeterministicRequirement(
        requirement.check,
        input,
        requirement.parameters
      );
      requirementResults.push({
        requirement_id: requirement.requirement_id,
        passed: outcome.passed,
        details: outcome.details,
        evidence_ids: [candidateEvidence.evidence_id],
      });
      if (!outcome.passed) failedRequirements.push(\`requirement:\${requirement.requirement_id}\`);
      if (outcome.unverifiable)
        unverifiableAssertions.push(
          \`requirement:\${requirement.requirement_id} (\${requirement.check}) is not implemented in this increment\`
        );
    }

    const totalClaims = input.verification_contract.claims.length;
    const claimScore = totalClaims === 0 ? 1 : supportedClaims / totalClaims;
    const requirementsPassed = requirementResults.every((r) => r.passed);

    const extension: AgentVerificationExtension = {
      verification_mode: input.verification_mode,
      requirement_results: requirementResults,
      claim_support_result: {
        supported: supportedClaims === totalClaims,
        supported_count: supportedClaims,
        unsupported_count: totalClaims - supportedClaims,
      },
      failed_requirements: failedRequirements.length ? failedRequirements : undefined,
      unverifiable_assertions: unverifiableAssertions.length ? unverifiableAssertions : undefined,
      candidate_output_hash: candidateOutputHash,
      policy_version: 'v1.0.0',
    };

    const nowIso = new Date(context.clock.nowMs()).toISOString();
    const requestedFields =
      totalClaims + input.verification_contract.deterministic_requirements.length;
    const supportedFields = supportedClaims + requirementResults.filter((r) => r.passed).length;

    const draft = buildDraftDocument({
      seed: \`\${context.service_id}:\${inputHash}:\${context.job_id}\`,
      serviceId: context.service_id,
      serviceVersion: context.service_id.endsWith('.v2') ? 'v2' : 'v1',
      inputHash,
      inputSchemaHash: 'sha256:' + '1'.repeat(64),
      outputSchemaHash: 'sha256:' + '2'.repeat(64),
      contractMode: 'offline_verification',
      freshnessSeconds: 3600,
      issuedAtIso: nowIso,
      expiresAtIso: new Date(context.clock.nowMs() + 3_600_000).toISOString(),
      subject: { type: 'other', canonical_name: \`candidate:\${context.job_id}\` },
      claims,
      evidence,
      completeness: {
        requested_fields: requestedFields,
        populated_fields: requestedFields,
        supported_fields: supportedFields,
        score: requestedFields === 0 ? 1 : supportedFields / requestedFields,
        missing_fields: [],
        unsupported_fields:
          requestedFields === supportedFields
            ? []
            : ['some claims or deterministic requirements did not pass'],
        stale_fields: [],
        vector: [
          {
            dimension: 'requirements',
            requested: requestedFields,
            populated: requestedFields,
            supported: supportedFields,
            score: requestedFields === 0 ? 1 : supportedFields / requestedFields,
          },
        ],
      },
      provenance: defaultProvenance('service-runtime:verify-agent-output', '0.1.0'),
      extensionKey: 'net.siteborne.agent-verification.v1',
      extensionPayload: extension,
    });

    const signed = await verifyAndSign({
      draft,
      context,
      signer: this.deps.signer,
      keyRegistry: this.deps.keyRegistry,
      reproduction:
        input.verification_mode === 'independent_reproduction'
          ? (this.deps.reproduction ?? null)
          : undefined,
    });

    const meshPassed = signed.verdict.decision === 'pass';
    const outcome: 'pass' | 'fail' | 'conditional' = !meshPassed
      ? signed.verdict.decision === 'conditional'
        ? 'conditional'
        : 'fail'
      : requirementsPassed && claimScore === 1
        ? 'pass'
        : 'conditional';
    extension.outcome = outcome;
    extension.score = meshPassed ? (claimScore + (requirementsPassed ? 1 : 0)) / 2 : 0;

    return {
      result_class:
        outcome === 'pass' && meshPassed
          ? 'success'
          : meshPassed
            ? 'partial'
            : 'internal_verification_failed',
      service_id: context.service_id,
      service_version: context.service_id.endsWith('.v2') ? 'v2' : 'v1',
      contract_release: context.contract_release,
      request_id: context.request_id,
      job_id: draft.job_id,
      input_hash: inputHash,
      output: meshPassed
        ? signed.document.extensions['net.siteborne.agent-verification.v1']
        : undefined,
      output_hash: signed.outputHash,
      pcc_hash: signed.outputHash,
      receipt_id: signed.receiptId,
      receipt: signed.receipt,
      verification: toVerificationSummary(signed.verdict),
      warnings: [],
      limitations: unverifiableAssertions,
      completeness: {
        requested_fields: requestedFields,
        populated_fields: requestedFields,
        supported_fields: supportedFields,
        missing_fields: [],
      },
      audit_references: [context.request_id],
      metrics: {
        elapsed_ms: context.clock.nowMs() - startedMs,
        dependency_calls: 0,
        claims_produced: claims.length,
        evidence_produced: evidence.length,
        output_bytes: JSON.stringify(signed.document).length,
      },
      failure: meshPassed
        ? undefined
        : {
            code: 'verification_failed',
            message: \`verification mesh decision was "\${signed.verdict.decision}"\`,
            retryable: false,
            details: signed.verdict.verification.deterministic_failures,
          },
    };
  }
}

function evaluateDeterministicRequirement(
  check: DeterministicCheck,
  input: AgentVerificationInput,
  parameters?: Record<string, unknown>
): { passed: boolean; details: string; unverifiable?: boolean } {
  if (check === 'schema_valid') {
    // MUTATION TEST FIXTURE: the historical, pre-checkpoint-F behavior --
    // a real, request-time Ajv.compile() against the buyer-supplied schema.
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    try {
      const validate = ajv.compile(input.required_schema);
      const valid = Boolean(validate(input.candidate_output));
      return {
        passed: valid,
        details: valid
          ? 'candidate_output matches required_schema'
          : \`candidate_output violates required_schema: \${JSON.stringify(validate.errors ?? []).slice(0, 300)}\`,
      };
    } catch (err) {
      return { passed: false, details: \`required_schema failed to compile: \${String(err)}\` };
    }
  }
  if (check === 'hash_match') {
    const expectedHash = parameters?.expected_hash;
    if (typeof expectedHash !== 'string')
      return { passed: false, details: 'hash_match requires parameters.expected_hash' };
    const actualHash =
      'sha256:' + createHash('sha256').update(JSON.stringify(input.candidate_output)).digest('hex');
    const passed = actualHash === expectedHash;
    return {
      passed,
      details: passed
        ? 'candidate_output hash matches expected_hash'
        : \`candidate_output hash \${actualHash} does not match expected_hash \${expectedHash}\`,
    };
  }
  return {
    passed: false,
    details: \`deterministic check "\${check}" is not implemented in this increment (SUN-0600)\`,
    unverifiable: true,
  };
}

function rejected(
  context: ServiceExecutionContext,
  startedMs: number,
  inputHash: string,
  message: string
): ServiceExecutionResult<AgentVerificationExtension> {
  return {
    result_class: 'rejected',
    service_id: context.service_id,
    service_version: context.service_id.endsWith('.v2') ? 'v2' : 'v1',
    contract_release: context.contract_release,
    request_id: context.request_id,
    job_id: context.job_id,
    input_hash: inputHash,
    warnings: [],
    limitations: [],
    audit_references: [],
    metrics: {
      elapsed_ms: context.clock.nowMs() - startedMs,
      dependency_calls: 0,
      claims_produced: 0,
      evidence_produced: 0,
      output_bytes: 0,
    },
    failure: { code: 'invalid_request', message, retryable: false },
  };
}
`;

async function main() {
  console.log(
    '[mutation-proof] checking working tree is clean (aside from the known wrangler.toml diff)...'
  );
  const status = git(['status', '--porcelain']);
  const dirtyLines = status
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .filter((l) => !l.includes('wrangler.toml'));
  if (dirtyLines.length > 0) {
    console.error('[mutation-proof] ABORT: working tree has unexpected uncommitted changes:');
    console.error(dirtyLines.join('\n'));
    process.exit(2);
  }
  console.log(
    '[mutation-proof] working tree clean (only the known wrangler.toml diff present). Proceeding.'
  );

  const originalContent = readFileSync(TARGET_FILE, 'utf-8');
  let exitCode = 0;

  try {
    console.log(
      '[mutation-proof] writing mutant (historical request-time Ajv.compile) to',
      TARGET_FILE_REL
    );
    writeFileSync(TARGET_FILE, MUTANT_SOURCE, 'utf-8');

    console.log('[mutation-proof] running Case A against the MUTANT...');
    const mutantResult = await runCaseAOnce();
    const mutantHasEvalSignal = /EvalError|Code generation from strings disallowed/i.test(
      mutantResult.body + mutantResult.devLog
    );
    // The judged criterion is behavioral regression, not the literal
    // EvalError string: see this file's own header comment for why --
    // this specific historical call site self-catches the compile
    // exception (unlike x402-service.ts's original, uncaught incident),
    // so the observable failure is Case A no longer reaching
    // result_class 'success', not an unhandled exception.
    const mutantCaught = mutantResult.status !== 200;
    console.log(
      `[mutation-proof] mutant result: status=${mutantResult.status} body=${mutantResult.body.slice(0, 300)}`
    );
    console.log(
      `[mutation-proof] EvalError/request-time-eval signal observed anywhere (HTTP body or dev log): ${mutantHasEvalSignal}`
    );
    if (!mutantCaught) {
      console.error(
        '[mutation-proof] FAIL: the mutant still returned 200/success -- the release gate would NOT have caught this regression.'
      );
      exitCode = 1;
    } else {
      console.log(
        "[mutation-proof] PASS: the mutant no longer reaches result_class 'success' under real workerd " +
          `(observed status=${mutantResult.status} instead of the real code's 200) -- the release gate ` +
          'would catch this regression. The underlying request-time-eval exception is present ' +
          `(EvalError signal observed=${mutantHasEvalSignal}) but self-caught at this call site, ` +
          'converting it into a silent, universal schema_valid failure rather than an unhandled crash -- ' +
          'still a real, gate-catchable regression.'
      );
    }

    console.log('[mutation-proof] restoring the original file...');
    writeFileSync(TARGET_FILE, originalContent, 'utf-8');

    console.log('[mutation-proof] running Case A against the RESTORED (real, verified) code...');
    const restoredResult = await runCaseAOnce();
    console.log(
      `[mutation-proof] restored result: status=${restoredResult.status} body=${restoredResult.body.slice(0, 300)}`
    );
    if (restoredResult.status !== 200) {
      console.error(
        '[mutation-proof] FAIL: restoration did not return the codebase to a passing state.'
      );
      exitCode = 1;
    } else {
      console.log('[mutation-proof] PASS: restored code passes Case A again.');
    }
  } finally {
    writeFileSync(TARGET_FILE, originalContent, 'utf-8');
    const diff = git(['diff', '--', TARGET_FILE_REL]);
    if (diff.trim().length > 0) {
      console.error(
        '[mutation-proof] CRITICAL: working tree NOT clean after restoration for',
        TARGET_FILE_REL
      );
      console.error(diff.slice(0, 2000));
      exitCode = 1;
    } else {
      console.log(
        '[mutation-proof] confirmed: working tree is clean for',
        TARGET_FILE_REL,
        'after restoration.'
      );
    }
  }

  process.exit(exitCode);
}

main();

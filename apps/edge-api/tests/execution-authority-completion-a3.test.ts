/**
 * R3-A3-EXECUTION-AUTHORITY-COMPLETION-AUDIT-40 — proof tests for the
 * remaining A3 execution/commit-authority guarantees the completion audit
 * could not find explicit coverage for. Test-only: no production code is
 * changed by this file.
 *
 * Already-proven guarantees are cited, not duplicated:
 *   settlement single-owner CAS        -> settlement-authority-invariant-a3.test.ts,
 *                                         paid-continuation-workflow-crash-matrix.test.ts (5/6/7/10)
 *   sole settle() call site            -> settle-sole-ownership.test.ts
 *   HTTP/MCP handler identity          -> settlement-authority-invariant-a3.test.ts (gap 2)
 *   cron never settles                 -> settlement-authority-invariant-a3.test.ts (gap 3)
 *   route never re-runs the executor   -> x402-workflow-integration.test.ts
 *   artifact reclaim fence             -> artifact-reclaim-ownership-a3.test.ts
 *
 * A3-EXEC-FENCE-1 (whole-instance replay re-spending provider cost) was
 * reproduced here as an it.fails RED and is closed by
 * R3-A3-PROVIDER-EXECUTION-AUTHORITY-41; see
 * provider-execution-authority-a3.test.ts for the in-flight ambiguity race.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { runPaidContinuationWorkflow } from '../src/control-plane/workflows/paid-continuation-workflow';
import { FakeWorkflowStep } from './support/fake-workflow-step';
import {
  TEST_JOB_ID,
  TEST_PAYMENT_IDENTIFIER,
  buildSuccessfulExecutorOutcome,
  buildTestDependencies,
  buildTestMetadata,
  sealTestInput,
} from './support/paid-continuation-workflow-fixtures';

const SRC_ROOT = fileURLToPath(new URL('../src', import.meta.url));
const PACKAGES_ROOT = fileURLToPath(new URL('../../../packages', import.meta.url));

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'generated' || entry === 'dist') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.d.ts') &&
      !entry.endsWith('.test.ts') &&
      !full.includes(`${join('src', 'tests')}`)
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Comment-aware line scanner, same technique as settle-sole-ownership.test.ts. */
function findCodeMatches(pattern: RegExp, files: readonly string[]): string[] {
  const matches: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf-8').split('\n');
    let inBlockComment = false;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]!;
      const trimmed = raw.trim();
      if (inBlockComment) {
        if (trimmed.includes('*/')) inBlockComment = false;
        continue;
      }
      if (trimmed.startsWith('/*')) {
        if (!trimmed.includes('*/')) inBlockComment = true;
        continue;
      }
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      const codePart = raw.split('//')[0] ?? raw;
      if (pattern.test(codePart)) matches.push(`${relative(SRC_ROOT, file)}:${i + 1}`);
    }
  }
  return matches;
}

const EDGE_SRC_FILES = listTsFiles(SRC_ROOT);

describe('A3-40 start authority: provider execution has exactly one production entry', () => {
  it('the service executor is invoked only inside the Workflow invoke-executor step (plus the non-production in-process test binding)', () => {
    const sites = findCodeMatches(/\bexecutor\(/, EDGE_SRC_FILES);
    expect(sites.map((s) => s.split(':')[0]).sort()).toEqual([
      'control-plane/testing/in-process-workflow-binding.ts',
      'control-plane/workflows/paid-continuation-workflow.ts',
    ]);
  });

  it('the in-process test binding is unreachable from the production Worker entry (index.ts)', () => {
    const index = readFileSync(join(SRC_ROOT, 'index.ts'), 'utf-8');
    expect(index).not.toMatch(/in-process-workflow-binding/);
    expect(index).not.toMatch(/routes\/paid-services'/);
  });

  it('Workflow instances are created only by the verified-intent handoff and owner-intent recovery', () => {
    // `workflow.create({` may put `id:` on the following line, so match the
    // Workflow-binding receiver rather than the object literal.
    const sites = findCodeMatches(/\bworkflow\.create\(/, EDGE_SRC_FILES);
    expect(sites.map((s) => s.split(':')[0]).sort()).toEqual([
      'control-plane/continuation/handoff.ts',
      'control-plane/continuation/owner-recovery.ts',
    ]);
  });
});

describe('A3-40 PCC and result authorization carry no execution, commit, or settlement authority', () => {
  const EFFECT_PATTERNS: readonly RegExp[] = [
    /\bexecutor\(/,
    /\.settle\(/,
    /\.recordSettlementPending\(/,
    /\.recordSettledExternal\(/,
    /\bworkflow\.create\(/,
    /createOrJoinPaidContinuation\(/,
    /dispatchWorkflowOwnerIntent\(/,
  ];
  const PCC_AND_RESULT_AUTH_FILES = [
    join(SRC_ROOT, 'control-plane', 'results', 'pcc-result-artifact.ts'),
    join(SRC_ROOT, 'control-plane', 'security', 'result-authorization.ts'),
    join(SRC_ROOT, 'control-plane', 'security', 'request-principal.ts'),
    join(SRC_ROOT, 'control-plane', 'security', 'verified-principal-context.ts'),
    join(SRC_ROOT, 'control-plane', 'repositories', 'd1', 'result-authorization.ts'),
    ...listTsFiles(join(PACKAGES_ROOT, 'service-runtime', 'src', 'pcc')),
    ...listTsFiles(join(PACKAGES_ROOT, 'pcc-schema', 'src')),
  ];

  for (const pattern of EFFECT_PATTERNS) {
    it(`no PCC or result-authorization module calls ${pattern.source}`, () => {
      expect(findCodeMatches(pattern, PCC_AND_RESULT_AUTH_FILES)).toEqual([]);
    });
  }

  it('mutation guard: the scanner detects an effect call when one is present', () => {
    expect(findCodeMatches(/\.settle\(/, [join(SRC_ROOT, 'control-plane', 'workflows', 'paid-continuation-workflow.ts')]).length).toBeGreaterThan(0);
  });
});

describe('A3-40 execution success is necessary but never sufficient for settlement', () => {
  it('an attempt that never reached verified can neither execute nor settle (A3-41: the provider fence now stops it before execution)', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({ seedSettlement: { lifecycleStage: 'acquired' } });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });

    const result = await runPaidContinuationWorkflow({ payload: input }, new FakeWorkflowStep(), deps);

    expect(deps.executor).not.toHaveBeenCalled();
    expect(deps.settle).not.toHaveBeenCalled();
    expect(result.error_code).toBe('provider_replay_fenced:acquired');
    expect(deps.resultReceiptPersistence.results.size).toBe(0);
  });

  it('execution success alone never settles: an executed attempt whose pre-settle CAS is refused never reaches settle()', async () => {
    const metadata = buildTestMetadata();
    // The executor succeeds, but the row is pushed off `executed` before the
    // settlement CAS: settle() must never be reached.
    const deps = await buildTestDependencies();
    const repo = deps.settlementRepository;
    const original = repo.transitionLifecycleStage.bind(repo);
    repo.transitionLifecycleStage = async (id, from, to) => {
      const r = await original(id, from, to);
      repo.rows.get(id)!.lifecycleStage = 'settlement_failed';
      return r;
    };
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });

    const result = await runPaidContinuationWorkflow({ payload: input }, new FakeWorkflowStep(), deps);

    expect(deps.executor).toHaveBeenCalledTimes(1);
    expect(deps.settle).not.toHaveBeenCalled();
    expect(result.status).toBe('settlement_rejected');
    expect(deps.resultReceiptPersistence.results.size).toBe(0);
  });

  it('a rejected executor outcome never reaches settlement or result persistence', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({
      executor: vi.fn(async () => buildSuccessfulExecutorOutcome({ result_class: 'failed' as never })),
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });

    const result = await runPaidContinuationWorkflow({ payload: input }, new FakeWorkflowStep(), deps);

    expect(result.status).toBe('executor_rejected');
    expect(deps.settle).not.toHaveBeenCalled();
    expect(deps.resultReceiptPersistence.results.size).toBe(0);
  });
});

describe('A3-40 retry policy bounds: neither provider dispatch nor settlement is ever retried', () => {
  it('invoke-executor and settle both declare 0 retries (A3-41: providers are not idempotent)', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies();
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();

    await runPaidContinuationWorkflow({ payload: input }, step, deps);

    const byName = new Map(step.calls.map((c) => [c.name, c.config]));
    expect(byName.get('invoke-executor')?.retries?.limit).toBe(0);
    expect(byName.get('settle')?.retries?.limit).toBe(0);
  });
});

describe('A3-40 stale replay: result release stays first-writer, settlement stays single', () => {
  it('a full replay whose executor returns a divergent output never replaces the released result and never settles twice', async () => {
    const metadata = buildTestMetadata();
    const firstOutcome = buildSuccessfulExecutorOutcome();
    const staleOutcome = buildSuccessfulExecutorOutcome({
      output: { text: 'divergent-late-result' },
      output_hash: 'sha256:divergent-output-hash',
    });
    const executor = vi
      .fn()
      .mockResolvedValueOnce(firstOutcome)
      .mockResolvedValueOnce(staleOutcome);
    const deps = await buildTestDependencies({ executor });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });

    const first = await runPaidContinuationWorkflow({ payload: input }, new FakeWorkflowStep(), deps);
    const released = deps.resultReceiptPersistence.results.get(TEST_JOB_ID);
    const replay = await runPaidContinuationWorkflow({ payload: input }, new FakeWorkflowStep(), deps);

    expect(first.status).toBe('settled');
    expect(replay.error_code).toBe('provider_replay_fenced:settled');
    expect(executor).toHaveBeenCalledTimes(1); // A3-41: the stale output is never even produced
    expect(deps.settle).toHaveBeenCalledTimes(1);
    expect(deps.resultReceiptPersistence.results.get(TEST_JOB_ID)).toBe(released);
    expect(deps.settlementRepository.rows.get(TEST_PAYMENT_IDENTIFIER)?.lifecycleStage).toBe(
      'settled'
    );
  });
});

describe('A3-EXEC-FENCE-1 (closed by A3-41): provider invocation is fenced on current authority', () => {
  // Formerly an it.fails RED. invoke-executor now reads canonical payment
  // state and the durable dispatch claim before any provider call.
  it(
    'a whole-instance replay for an already-settled payment must not invoke the provider a second time',
    async () => {
      const metadata = buildTestMetadata();
      const deps = await buildTestDependencies();
      const input = await sealTestInput(metadata, { key: deps.envelopeKey });

      await runPaidContinuationWorkflow({ payload: input }, new FakeWorkflowStep(), deps);
      expect(deps.settlementRepository.rows.get(TEST_PAYMENT_IDENTIFIER)?.lifecycleStage).toBe(
        'settled'
      );

      await runPaidContinuationWorkflow({ payload: input }, new FakeWorkflowStep(), deps);

      expect(deps.executor).toHaveBeenCalledTimes(1);
    }
  );

  it('control: replay adds neither a provider invocation nor a settlement', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies();
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });

    await runPaidContinuationWorkflow({ payload: input }, new FakeWorkflowStep(), deps);
    await runPaidContinuationWorkflow({ payload: input }, new FakeWorkflowStep(), deps);

    expect(deps.executor).toHaveBeenCalledTimes(1);
    expect(deps.settle).toHaveBeenCalledTimes(1);
  });
});

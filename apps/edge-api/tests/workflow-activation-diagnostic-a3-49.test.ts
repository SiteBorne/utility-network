/**
 * R3-A3-WORKFLOW-ACTIVATION-DIAGNOSTIC-49 — the pre-provider activation
 * discriminator and the exact future probe input.
 *
 * The marker `a3_workflow_activation_diagnostic_01` is returned as
 * `error_detail` on the open-envelope failure terminal result of the
 * diagnostic runtime only. Run against d939f3b the "marker PRESENT" cases are
 * RED (marker absent); every zero-effect case passes on both lines.
 *
 * The probe cases drive the real `PaidContinuationWorkflow.run()` through the
 * real `buildProductionPaidContinuationWorkflowDependencies` (production
 * vars from wrangler.paid-continuation-runtime.toml, throwaway test secrets),
 * with a D1 double that refuses every write and a `fetch` that throws.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  PaidContinuationWorkflow,
  runPaidContinuationWorkflow,
} from '../src/control-plane/workflows/paid-continuation-workflow';
import type {
  PaidContinuationWorkflowEvent,
  PaidContinuationWorkflowHostEnv,
  PaidContinuationWorkflowStep,
} from '../src/control-plane/workflows/paid-continuation-workflow';
import type { WorkflowContinuationInput } from '../src/control-plane/continuation/types';
import { FakeWorkflowStep } from './support/fake-workflow-step';
import {
  buildTestDependencies,
  buildTestMetadata,
  sealTestInput,
  generateTestKey,
  TEST_JOB_ID,
} from './support/paid-continuation-workflow-fixtures';

const MARKER = 'a3_workflow_activation_diagnostic_01';

/** The exact input the future production probe submits as instance params.
 * `v: 0` fails `parseEnvelope` before any key is touched, so it cannot
 * decrypt under any key; `valid_before_unix: 1` means that even a decrypt
 * would stop at check-authorization-expiry, before invoke-executor. Every
 * identifier is in the synthetic `a3-activation-probe-` namespace, so none
 * match a buyer, payment attempt, job, or owner intent. */
function probeInput(): WorkflowContinuationInput {
  return {
    envelope: {
      v: 0,
      key_id: 'a3-activation-probe',
      iv_b64: '',
      ciphertext_b64: '',
      aad_fingerprint: 'a3-activation-probe',
    },
    metadata: {
      job_id: 'a3-activation-probe-job-01',
      payment_identifier: 'a3-activation-probe-pay-01',
      service: 'verify_agent_output.v2',
      network: 'eip155:8453',
      asset: '0x0000000000000000000000000000000000000000',
      pay_to: '0x0000000000000000000000000000000000000000',
      amount_atomic: '0',
      valid_before_unix: 1,
    },
    request_id: 'a3-activation-probe-req-01',
  } as unknown as WorkflowContinuationInput;
}

/** A D1 double that answers every read with "no rows" and throws on any
 * write, recording every statement it sees. */
function readOnlyD1() {
  const statements: string[] = [];
  const writes: string[] = [];
  const refuse = (sql: string) => async () => {
    writes.push(sql);
    throw new Error(`D1 write refused in activation probe: ${sql}`);
  };
  const db = {
    prepare(sql: string) {
      statements.push(sql);
      const stmt = {
        bind: () => stmt,
        first: async () => null,
        all: async () => ({ results: [], success: true, meta: {} }),
        raw: async () => [],
        run: refuse(sql),
      };
      return stmt;
    },
    batch: refuse('batch'),
    exec: refuse('exec'),
    dump: refuse('dump'),
  };
  return { db, statements, writes };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function productionShapedEnv(db: unknown): Promise<PaidContinuationWorkflowHostEnv> {
  const envelopeKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  return {
    DB: db as never,
    PAYMENT_CONTINUATION_ENCRYPTION_KEY: btoa(String.fromCharCode(...envelopeKeyBytes)),
    PAID_RECEIPT_SIGNING_PRIVATE_KEY: toHex(crypto.getRandomValues(new Uint8Array(32))),
    PAID_RECEIPT_SIGNING_KEY_ID: 'kid_a3activationprobe0000000',
    SELLER_WALLET_ADDRESS: '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1',
    CDP_API_KEY_ID: 'a3-activation-probe-test-key-id',
    CDP_API_KEY_SECRET: 'a3-activation-probe-test-key-secret',
    PAYMENT_ENVIRONMENT: 'production',
    PRODUCTION_ENABLED: 'true',
    HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: 'true',
    PRODUCTION_CDP_CREDENTIALS_APPROVED: 'true',
    MODAL_WEBCTX_ENDPOINT_URL: undefined,
    MODAL_WEBCTX_PROXY_KEY: undefined,
    MODAL_WEBCTX_PROXY_SECRET: undefined,
    MODAL_DOCWORKER_ENDPOINT_URL: undefined,
    MODAL_DOCWORKER_PROXY_KEY: undefined,
    MODAL_DOCWORKER_PROXY_SECRET: undefined,
    ARTIFACTS: undefined,
    BASE_RPC_URL: undefined,
    BASE_SEPOLIA_RPC_URL: undefined,
  } as PaidContinuationWorkflowHostEnv;
}

function recordingStep() {
  const names: string[] = [];
  const step = {
    do: async (name: string, _config: unknown, cb: () => Promise<unknown>) => {
      names.push(name);
      return cb();
    },
    sleep: async () => {
      names.push('sleep');
    },
  } as unknown as PaidContinuationWorkflowStep;
  return { step, names };
}

async function runProbeThroughRealEntrypoint() {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (req) => {
    throw new Error(`external fetch refused in activation probe: ${String(req)}`);
  });
  const d1 = readOnlyD1();
  const env = await productionShapedEnv(d1.db);
  const workflow = new PaidContinuationWorkflow({} as never, env as never);
  const { step, names } = recordingStep();
  const event = { payload: probeInput() } as PaidContinuationWorkflowEvent;
  const result = await workflow.run(event, step);
  return { result, d1, names, fetchCalls: fetchSpy.mock.calls.length };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('A3-49 activation discriminator: marker', () => {
  it('NEW_MARKER_PRESENT: the probe through the real entrypoint returns the diagnostic marker', async () => {
    const { result } = await runProbeThroughRealEntrypoint();
    expect(result.status).toBe('workflow_internal_error');
    expect(result.error_code).toBe('unsupported_version');
    expect(result.error_detail).toBe(MARKER);
  });

  it('NEW_MARKER_PRESENT: a well-formed envelope sealed under a different key (decrypt_failed) also carries the marker', async () => {
    const deps = await buildTestDependencies();
    const input = await sealTestInput(buildTestMetadata(), { key: await generateTestKey() });
    const result = await runPaidContinuationWorkflow(
      { payload: input } as PaidContinuationWorkflowEvent,
      new FakeWorkflowStep() as unknown as PaidContinuationWorkflowStep,
      deps
    );
    expect(result.error_code).toBe('decrypt_failed');
    expect(result.error_detail).toBe(MARKER);
  });

  it('MARKER_SCOPE: a run whose envelope opens never carries the marker (authorization_expired path)', async () => {
    const deps = await buildTestDependencies({ clock: () => 3_000_000_000 });
    const input = await sealTestInput(buildTestMetadata(), { key: deps.envelopeKey });
    const result = await runPaidContinuationWorkflow(
      { payload: input } as PaidContinuationWorkflowEvent,
      new FakeWorkflowStep() as unknown as PaidContinuationWorkflowStep,
      deps
    );
    expect(result.status).toBe('authorization_expired');
    expect(result.error_detail).toBeUndefined();
  });

  it('MARKER_SCOPE: a successful run never carries the marker', async () => {
    const deps = await buildTestDependencies();
    const input = await sealTestInput(buildTestMetadata(), { key: deps.envelopeKey });
    const result = await runPaidContinuationWorkflow(
      { payload: input } as PaidContinuationWorkflowEvent,
      new FakeWorkflowStep() as unknown as PaidContinuationWorkflowStep,
      deps
    );
    expect(result.status).toBe('settled');
    expect(result.error_detail).toBeUndefined();
  });
});

describe('A3-49 activation probe: effect boundary (holds on old and new runtime)', () => {
  it('the probe builds real production dependencies, stops at open-envelope, and makes no external call', async () => {
    const { result, names, fetchCalls } = await runProbeThroughRealEntrypoint();
    expect(result.status).toBe('workflow_internal_error');
    expect(result.job_id).toBe('a3-activation-probe-job-01');
    // A3-51A: the constant diagnostic step precedes open-envelope on the
    // diagnostic-v2 runtime (see workflow-activation-diagnostic-a3-51a.test.ts).
    expect(names).toEqual(['a3-activation-diagnostic', 'open-envelope']);
    expect(fetchCalls).toBe(0);
  });

  it('the probe performs zero D1 writes and never touches provider-dispatch or payment state', async () => {
    const { d1 } = await runProbeThroughRealEntrypoint();
    expect(d1.writes).toEqual([]);
    for (const sql of d1.statements) {
      expect(sql).toMatch(/^\s*SELECT\b/i);
      expect(sql).not.toMatch(/payment_workflow_owner_intents|provider_dispatched_at|payment_attempts/i);
    }
    // The only read is the job lookup, which finds no synthetic job.
    expect(d1.statements).toEqual(['SELECT * FROM jobs WHERE id = ?']);
  });

  it('with counting fakes: zero executor, dispatch-claim, settle, reconciliation, result, receipt, or finalization calls', async () => {
    const deps = await buildTestDependencies();
    const executor = vi.fn(deps.executor);
    const claim = vi.spyOn(deps.providerDispatch, 'claim');
    const step = new FakeWorkflowStep();
    const result = await runPaidContinuationWorkflow(
      { payload: probeInput() } as PaidContinuationWorkflowEvent,
      step as unknown as PaidContinuationWorkflowStep,
      { ...deps, executor }
    );
    expect(result.status).toBe('workflow_internal_error');
    expect(step.calls.map((c) => c.name)).toEqual(['open-envelope']);
    expect(executor).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(deps.providerDispatch.claims.size).toBe(0);
    expect(deps.settle).not.toHaveBeenCalled();
    expect(deps.reconciliationChecker).not.toHaveBeenCalled();
    expect(deps.resultReceiptPersistence.persistResultCallCount).toBe(0);
    expect(deps.resultReceiptPersistence.persistReceiptCallCount).toBe(0);
    expect(deps.finalizationPersistence.providerFailures).toEqual([]);
    expect(deps.finalizationPersistence.linkEvidenceWrites).toBe(0);
    expect(deps.finalizationPersistence.settledFinalizations).toBe(0);
    expect(deps.settlementRepository.rows.get('a3-activation-probe-pay-01')).toBeUndefined();
    // The seeded fixture job is untouched: the probe's synthetic job id
    // matches no job, so no state event is written.
    expect(deps.jobPersistence.events).toEqual([]);
    expect(deps.jobPersistence.jobs.get(TEST_JOB_ID)?.current_state).toBe('LOCKED');
  });

  it('defense in depth: even a decryptable probe payload would stop at check-authorization-expiry, before invoke-executor', async () => {
    const deps = await buildTestDependencies({ clock: () => Date.now() / 1000 });
    const executor = vi.fn(deps.executor);
    const input = await sealTestInput(buildTestMetadata({ valid_before_unix: 1 }), {
      key: deps.envelopeKey,
    });
    const step = new FakeWorkflowStep();
    const result = await runPaidContinuationWorkflow(
      { payload: input } as PaidContinuationWorkflowEvent,
      step as unknown as PaidContinuationWorkflowStep,
      { ...deps, executor }
    );
    expect(result.status).toBe('authorization_expired');
    expect(step.calls.map((c) => c.name)).toEqual(['open-envelope', 'check-authorization-expiry']);
    expect(executor).not.toHaveBeenCalled();
    expect(deps.providerDispatch.claims.size).toBe(0);
    expect(deps.settle).not.toHaveBeenCalled();
  });
});

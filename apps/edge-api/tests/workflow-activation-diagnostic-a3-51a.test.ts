/**
 * R3-A3-WORKFLOW-ACTIVATION-OBSERVABILITY-RESOLUTION-51A — the pre-effect
 * diagnostic step and its REST step-output discriminator.
 *
 * The diagnostic-v2 runtime's `PaidContinuationWorkflow.run()` first runs a
 * constant step, `a3-activation-diagnostic`, whose scalar string output
 * `a3_workflow_activation_diagnostic_02` is readable through Cloudflare's
 * `GET .../instances/{id}/step?name=<exact>&type=step`. Run against d939f3b
 * the "step PRESENT" cases are RED (no such step); every zero-effect case
 * passes on both lines. Literals, not imports, so this file runs unchanged
 * against the canonical source.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PaidContinuationWorkflow } from '../src/control-plane/workflows/paid-continuation-workflow';
import type {
  PaidContinuationWorkflowEvent,
  PaidContinuationWorkflowHostEnv,
  PaidContinuationWorkflowStep,
} from '../src/control-plane/workflows/paid-continuation-workflow';
import type { WorkflowContinuationInput } from '../src/control-plane/continuation/types';

const STEP_NAME = 'a3-activation-diagnostic';
const STEP_MARKER = 'a3_workflow_activation_diagnostic_02';

/** Identical to the A3-49 probe input: `v: 0` fails `parseEnvelope` before
 * any key is touched; every identifier is synthetic. */
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

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** D1 double: every read finds nothing, every write throws; all recorded. */
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

/** Production-shaped env behind a Proxy that records every property read. */
function recordingEnv(db: unknown, overrides: Record<string, unknown> = {}) {
  const reads: string[] = [];
  const envelopeKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const base: Record<string, unknown> = {
    DB: db,
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
    ...overrides,
  };
  const env = new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop === 'string') reads.push(prop);
      return Reflect.get(target, prop, receiver);
    },
  });
  return { env: env as unknown as PaidContinuationWorkflowHostEnv, reads };
}

type StepRecord = {
  name: string;
  config: unknown;
  status: 'complete' | 'errored';
  output?: unknown;
  /** Effect counters observed at the moment this step's callback settled. */
  fetchCallsAtEnd: number;
  d1StatementsAtEnd: number;
  envReadsAtEnd: number;
};

/** Mirrors the engine's step.do contract closely enough for ordering and
 * output: runs the callback once, records its settled value or error. */
function recordingStep(counters: () => { fetch: number; d1: number; env: number }) {
  const records: StepRecord[] = [];
  const step = {
    do: async (name: string, config: unknown, cb: () => Promise<unknown>) => {
      try {
        const output = await cb();
        const c = counters();
        records.push({
          name,
          config,
          status: 'complete',
          output,
          fetchCallsAtEnd: c.fetch,
          d1StatementsAtEnd: c.d1,
          envReadsAtEnd: c.env,
        });
        return output;
      } catch (e) {
        const c = counters();
        records.push({
          name,
          config,
          status: 'errored',
          fetchCallsAtEnd: c.fetch,
          d1StatementsAtEnd: c.d1,
          envReadsAtEnd: c.env,
        });
        throw e;
      }
    },
    sleep: async () => {
      records.push({
        name: 'sleep',
        config: undefined,
        status: 'complete',
        fetchCallsAtEnd: 0,
        d1StatementsAtEnd: 0,
        envReadsAtEnd: 0,
      });
    },
  } as unknown as PaidContinuationWorkflowStep;
  return { step, records };
}

async function runProbe(envOverrides: Record<string, unknown> = {}) {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (req) => {
    throw new Error(`external fetch refused in activation probe: ${String(req)}`);
  });
  const d1 = readOnlyD1();
  const { env, reads } = recordingEnv(d1.db, envOverrides);
  const workflow = new PaidContinuationWorkflow({} as never, env as never);
  // Constructing the entrypoint may read env; count only reads made by run().
  const envReadsBeforeRun = reads.length;
  const { step, records } = recordingStep(() => ({
    fetch: fetchSpy.mock.calls.length,
    d1: d1.statements.length,
    env: reads.length - envReadsBeforeRun,
  }));
  const event = { payload: probeInput() } as PaidContinuationWorkflowEvent;
  let result: Awaited<ReturnType<PaidContinuationWorkflow['run']>> | undefined;
  let thrown: unknown;
  try {
    result = await workflow.run(event, step);
  } catch (e) {
    thrown = e;
  }
  return { result, thrown, records, d1, fetchCalls: fetchSpy.mock.calls.length };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('A3-51A activation discriminator: diagnostic step', () => {
  it('NEW_STEP_PRESENT: the probe runs the diagnostic step first, complete', async () => {
    const { records } = await runProbe();
    expect(records[0]?.name).toBe(STEP_NAME);
    expect(records[0]?.status).toBe('complete');
    expect(records.filter((r) => r.name === STEP_NAME)).toHaveLength(1);
  });

  it('NEW_STEP_OUTPUT_MATCH: its output is exactly the scalar marker string', async () => {
    const { records } = await runProbe();
    const diagnostic = records.find((r) => r.name === STEP_NAME);
    expect(typeof diagnostic?.output).toBe('string');
    expect(diagnostic?.output).toBe(STEP_MARKER);
  });

  it('the diagnostic step has zero retries, a short timeout, and is not marked sensitive (output not redacted)', async () => {
    const { records } = await runProbe();
    const diagnostic = records.find((r) => r.name === STEP_NAME);
    expect(diagnostic?.config).toEqual({
      retries: { limit: 0, delay: '1 second' },
      timeout: '5 seconds',
    });
    expect(diagnostic?.config).not.toHaveProperty('sensitive');
  });

  it('the diagnostic step still runs, before the fail-closed throw, when host dependencies are unavailable', async () => {
    const { records, thrown, fetchCalls, d1 } = await runProbe({ CDP_API_KEY_SECRET: undefined });
    expect(records.map((r) => r.name)).toEqual([STEP_NAME]);
    expect(records[0]?.output).toBe(STEP_MARKER);
    expect(String(thrown)).toMatch(/dependencies_unavailable/);
    expect(fetchCalls).toBe(0);
    expect(d1.writes).toEqual([]);
  });
});

describe('A3-51A probe: pre-effect boundary (holds on old and new runtime)', () => {
  it('the probe stops at open-envelope: invoke-executor and every later step are never entered', async () => {
    const { result, records } = await runProbe();
    expect(result?.status).toBe('workflow_internal_error');
    expect(result?.error_code).toBe('unsupported_version');
    const names = records.map((r) => r.name);
    expect(names[names.length - 1]).toBe('open-envelope');
    expect(records[records.length - 1]?.status).toBe('errored');
    for (const later of [
      'check-authorization-expiry',
      'invoke-executor',
      'generate-pcc',
      'settle',
      'persist-result',
    ]) {
      expect(names).not.toContain(later);
    }
    expect(names.filter((n) => n !== STEP_NAME)).toEqual(['open-envelope']);
  });

  it('zero external fetches, zero D1 writes, and only the synthetic job lookup is read', async () => {
    const { d1, fetchCalls } = await runProbe();
    expect(fetchCalls).toBe(0);
    expect(d1.writes).toEqual([]);
    expect(d1.statements).toEqual(['SELECT * FROM jobs WHERE id = ?']);
    for (const sql of d1.statements) {
      expect(sql).not.toMatch(
        /payment_workflow_owner_intents|provider_dispatched_at|payment_attempts/i
      );
    }
  });
});

describe('A3-51A diagnostic step: purity (vacuous on the canonical runtime)', () => {
  it('DIAGNOSTIC_STEP_EXTERNAL_IO=NO: no fetch, no D1 statement, no env read before the diagnostic step settles', async () => {
    const { records } = await runProbe();
    const diagnostic = records.find((r) => r.name === STEP_NAME);
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.fetchCallsAtEnd).toBe(0);
    expect(diagnostic?.d1StatementsAtEnd).toBe(0);
    expect(diagnostic?.envReadsAtEnd).toBe(0);
  });

  it('the diagnostic step precedes open-envelope', async () => {
    const { records } = await runProbe();
    const names = records.map((r) => r.name);
    expect(names).toEqual([STEP_NAME, 'open-envelope']);
  });
});

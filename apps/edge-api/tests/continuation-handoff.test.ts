/**
 * SUN-1221E6R-H2AWI-3 Task 3.1 — durable handoff creation/join.
 *
 * Every Workflow interaction here is against a fake `WorkflowBindingLike`
 * double -- no live Workflow resource, no wrangler, no deployment. Keys
 * are locally generated via Web Crypto, never a production secret.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createOrJoinPaidContinuation,
  type WorkflowBindingLike,
  type WorkflowInstanceLike,
} from '../src/control-plane/continuation/handoff';
import { deriveWorkflowInstanceId } from '../src/control-plane/continuation/instance-id';
import { openContinuationEnvelope } from '../src/control-plane/continuation/envelope';
import type { ContinuationEnvelopeMetadata } from '../src/control-plane/continuation/types';

async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
}

function metadata(paymentIdentifier: string): ContinuationEnvelopeMetadata {
  return {
    job_id: 'job_' + paymentIdentifier,
    payment_identifier: paymentIdentifier,
    service: 'web_context_verified.v2',
    network: 'eip155:8453',
    asset: '0xUSDC',
    pay_to: '0xseller',
    amount_atomic: '9000',
    valid_before_unix: 4102444800,
  };
}

/** A fake `WorkflowBindingLike` whose `create()` throws Cloudflare's real,
 * verified duplicate-ID error shape (a bare `Error`, per
 * developers.cloudflare.com/workflows/build/workers-api/#create -- no
 * dedicated exported error class exists) for any ID already present in
 * `instances`. */
function buildFakeWorkflowBinding(instances = new Map<string, WorkflowInstanceLike>()) {
  const createCalls: string[] = [];
  const getCalls: string[] = [];
  const binding: WorkflowBindingLike = {
    async create(options) {
      createCalls.push(options.id);
      if (instances.has(options.id)) {
        throw new Error(`Workflow instance ${options.id} already exists`);
      }
      const instance: WorkflowInstanceLike = {
        id: options.id,
        status: vi.fn().mockResolvedValue({ status: 'running' }),
      };
      instances.set(options.id, instance);
      return instance;
    },
    async get(id) {
      getCalls.push(id);
      const found = instances.get(id);
      if (!found) throw new Error(`no such Workflow instance ${id}`);
      return found;
    },
  };
  return { binding, createCalls, getCalls, instances };
}

describe('createOrJoinPaidContinuation (SUN-1221E6R-H2AWI-3 Task 3.1)', () => {
  it('creates a new instance, deriving the id from deriveWorkflowInstanceId (reused, not reimplemented)', async () => {
    const { binding, createCalls } = buildFakeWorkflowBinding();
    const key = await generateKey();
    const md = metadata('pay_abc');

    const result = await createOrJoinPaidContinuation(
      { workflow: binding, envelopeKey: key, envelopeKeyId: 'v1' },
      { paymentIdentifier: 'pay_abc', payload: { hello: 'world' }, metadata: md, requestId: 'req_1' }
    );

    expect(result.outcome).toBe('created');
    const expectedId = await deriveWorkflowInstanceId('pay_abc');
    expect(result.instanceId).toBe(expectedId);
    expect(createCalls).toEqual([expectedId]);
  });

  it('seals the envelope with sealContinuationEnvelope such that openContinuationEnvelope round-trips the original payload', async () => {
    const { binding } = buildFakeWorkflowBinding();
    const key = await generateKey();
    const md = metadata('pay_roundtrip');
    const payload = { executorInput: { a: 1 }, actualAmount: '9000' };

    let capturedParams: unknown;
    const capturingBinding: WorkflowBindingLike = {
      async create(options) {
        capturedParams = options.params;
        return binding.create(options);
      },
      get: binding.get,
    };

    await createOrJoinPaidContinuation(
      { workflow: capturingBinding, envelopeKey: key, envelopeKeyId: 'v1' },
      { paymentIdentifier: 'pay_roundtrip', payload, metadata: md, requestId: 'req_2' }
    );

    const params = capturedParams as { envelope: unknown; metadata: unknown; request_id: string };
    expect(params.metadata).toEqual(md);
    expect(params.request_id).toBe('req_2');
    const opened = await openContinuationEnvelope({
      envelope: params.envelope as never,
      expectedMetadata: md,
      keyMaterial: key,
    });
    expect(opened).toEqual(payload);
  });

  it('a duplicate call with the same payment_identifier joins the existing instance via get(), never creating a second instance (mutation-sensitive: removing the get() fallback must fail this test)', async () => {
    const { binding, createCalls, getCalls } = buildFakeWorkflowBinding();
    const key = await generateKey();
    const md = metadata('pay_dup');
    const deps = { workflow: binding, envelopeKey: key, envelopeKeyId: 'v1' };
    const input = {
      paymentIdentifier: 'pay_dup',
      payload: { x: 1 },
      metadata: md,
      requestId: 'req_a',
    };

    const first = await createOrJoinPaidContinuation(deps, input);
    const second = await createOrJoinPaidContinuation(deps, { ...input, requestId: 'req_b' });

    expect(first.outcome).toBe('created');
    expect(second.outcome).toBe('joined');
    expect(createCalls).toHaveLength(2); // both attempts call create() ...
    expect(getCalls).toHaveLength(1); // ... but only the second falls through to get()
    if (first.outcome !== 'create_failed' && second.outcome !== 'create_failed') {
      expect(second.instanceId).toBe(first.instanceId);
      expect(second.instance).toBe(first.instance);
    }
  });

  it('a genuine create() failure (get() also fails) resolves to create_failed, never a settle fallback', async () => {
    const key = await generateKey();
    const md = metadata('pay_fail');
    const failingBinding: WorkflowBindingLike = {
      async create() {
        throw new Error('transient platform failure');
      },
      async get() {
        throw new Error('no such instance');
      },
    };

    const result = await createOrJoinPaidContinuation(
      { workflow: failingBinding, envelopeKey: key, envelopeKeyId: 'v1' },
      { paymentIdentifier: 'pay_fail', payload: {}, metadata: md, requestId: 'req_x' }
    );

    expect(result.outcome).toBe('create_failed');
    if (result.outcome === 'create_failed') {
      expect(result.error).toBeInstanceOf(Error);
    }
  });
});

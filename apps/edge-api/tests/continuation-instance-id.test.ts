/**
 * SUN-1221E6R-H2AWI-1b -- deterministic Cloudflare Workflow instance ID.
 *
 * Frozen algorithm: `siteborne-wf-` + lowercase hex SHA-256 of the UTF-8
 * bytes of `paymentIdentifier`, truncated to 48 hex chars (13 + 48 = 61
 * chars, under Cloudflare Workflows' 64-char instance ID limit).
 *
 * NOTE on the function's declared return type: see the doc comment atop
 * `../src/control-plane/continuation/instance-id.ts` -- the plan document's
 * interface line reads `deriveWorkflowInstanceId(paymentIdentifier: string):
 * string`, but the same document mandates using `crypto.subtle.digest`,
 * which has no synchronous form. This implementation is therefore async
 * (`Promise<string>`), matching this package's only other
 * `crypto.subtle.digest` caller (`control-plane/artifacts/store.ts`'s
 * `computeHash`). Every test below awaits the call accordingly. This
 * discrepancy is recorded in the H2AWI-1 evidence report, not silently
 * absorbed.
 */
import { describe, expect, it } from 'vitest';
import { deriveWorkflowInstanceId } from '../src/control-plane/continuation/instance-id';

describe('deriveWorkflowInstanceId (SUN-1221E6R-H2AWI-1b)', () => {
  it('known deterministic vector: "pay_abc" -> a fixed, hardcoded SHA-256-derived id', async () => {
    // Vector independently computed via `python3 -c "import hashlib;
    // print(hashlib.sha256(b'pay_abc').hexdigest())"` ==
    // 0d20809df0229b75ab747c8e41d962a64b42ef348d5b5af40c43bbf2ade71dc9,
    // truncated to the first 48 hex chars.
    const id = await deriveWorkflowInstanceId('pay_abc');
    expect(id).toBe('siteborne-wf-0d20809df0229b75ab747c8e41d962a64b42ef348d5b5af4');
  });

  it('is deterministic: identical input yields byte-identical output across repeated calls', async () => {
    const first = await deriveWorkflowInstanceId('pay_repeat_test');
    const second = await deriveWorkflowInstanceId('pay_repeat_test');
    const third = await deriveWorkflowInstanceId('pay_repeat_test');
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it('different payment_identifier values produce different ids', async () => {
    const a = await deriveWorkflowInstanceId('pay_A');
    const b = await deriveWorkflowInstanceId('pay_B');
    expect(a).not.toBe(b);
  });

  it('matches the frozen shape: siteborne-wf- prefix followed by exactly 48 lowercase hex chars', async () => {
    const id = await deriveWorkflowInstanceId('pay_shape_test');
    expect(id).toMatch(/^siteborne-wf-[0-9a-f]{48}$/);
  });

  it('is exactly 61 chars, safely under Cloudflare Workflow instance id 64-char limit', async () => {
    const id = await deriveWorkflowInstanceId('pay_length_test');
    expect(id.length).toBe(61);
    expect(id.length).toBeLessThanOrEqual(64);
  });

  it('boundary length: a 1-char identifier still derives a valid id', async () => {
    const id = await deriveWorkflowInstanceId('p');
    expect(id).toMatch(/^siteborne-wf-[0-9a-f]{48}$/);
  });

  it('boundary length: a 2048-char identifier still derives a valid id of fixed output length', async () => {
    const long = 'p'.repeat(2048);
    const id = await deriveWorkflowInstanceId(long);
    expect(id).toMatch(/^siteborne-wf-[0-9a-f]{48}$/);
    expect(id.length).toBe(61);
  });

  it('rejects an empty-string identifier -- fails closed rather than silently hashing empty input', async () => {
    await expect(deriveWorkflowInstanceId('')).rejects.toThrow(TypeError);
  });

  it('rejects a non-string identifier at runtime -- fails closed', async () => {
    // @ts-expect-error -- deliberately passing a wrong runtime type to prove the runtime guard fires, not just the type system
    await expect(deriveWorkflowInstanceId(undefined)).rejects.toThrow(TypeError);
  });

  it('is stable across a fresh module evaluation (pure function, no cached/module-level runtime state)', async () => {
    const freshModule = await import('../src/control-plane/continuation/instance-id');
    const a = await deriveWorkflowInstanceId('pay_restart_test');
    const b = await freshModule.deriveWorkflowInstanceId('pay_restart_test');
    expect(a).toBe(b);
  });
});

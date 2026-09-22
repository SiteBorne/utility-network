/**
 * Worker-safe runtime bootstrap (METADATA-VCM-IMPL-04A). Proves the static
 * JSON-import path produces the same real-data result the filesystem-based
 * registry-parity suite already proves parity for, and that it is cached
 * per isolate (module-level memoization, not per call).
 */
import { describe, expect, it } from 'vitest';
import { getRuntimeEffectiveView, resetRuntimeEffectiveViewCacheForTests } from './runtime-model';

const COMMIT = 'a'.repeat(40);

describe('getRuntimeEffectiveView', () => {
  it('builds all 12 real services with zero LegacyImportError', async () => {
    resetRuntimeEffectiveViewCacheForTests();
    const view = await getRuntimeEffectiveView(COMMIT);
    expect(view.services).toHaveLength(12);
  });

  it('memoizes per isolate: a second call for the same commit returns the identical promise-resolved object', async () => {
    resetRuntimeEffectiveViewCacheForTests();
    const first = await getRuntimeEffectiveView(COMMIT);
    const second = await getRuntimeEffectiveView(COMMIT);
    expect(second).toBe(first);
  });

  it('rebuilds when the runtime source commit changes', async () => {
    resetRuntimeEffectiveViewCacheForTests();
    const first = await getRuntimeEffectiveView(COMMIT);
    const second = await getRuntimeEffectiveView('b'.repeat(40));
    expect(second).not.toBe(first);
    expect(second.services).toHaveLength(12);
  });

  it('produces a digest deterministically (same commit, fresh cache, same digest)', async () => {
    resetRuntimeEffectiveViewCacheForTests();
    const first = await getRuntimeEffectiveView(COMMIT);
    resetRuntimeEffectiveViewCacheForTests();
    const second = await getRuntimeEffectiveView(COMMIT);
    expect(second.digest).toBe(first.digest);
  });
});

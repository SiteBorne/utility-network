/**
 * SUN-1222C-document-artifact-production-closure — unit coverage for
 * `reclaimStaleArtifactsScheduled`, the function wired into `index.ts`'s
 * scheduled handler to close the previously-unwired R2/D1 physical
 * reclamation gap (`artifact-reclamation.ts`'s own doc comment; confirmed
 * by trace that no caller wired it to any trigger before this change).
 *
 * Mirrors `index.scheduled-export-shape.test.ts`'s own convention:
 * exercises the exported function directly (not the Workers runtime),
 * with injected/absent bindings rather than real R2/D1.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { reclaimStaleArtifactsScheduled } from './index';
import type { Env } from './control-plane/config/env';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reclaimStaleArtifactsScheduled', () => {
  it('is a safe no-op when DB is absent', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      reclaimStaleArtifactsScheduled({
        DB: undefined,
        ARTIFACTS: {} as Env['ARTIFACTS'],
      } as unknown as Pick<Env, 'DB' | 'ARTIFACTS'>)
    ).resolves.toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('is a safe no-op when ARTIFACTS is absent', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      reclaimStaleArtifactsScheduled({
        DB: {} as Env['DB'],
        ARTIFACTS: undefined,
      } as unknown as Pick<Env, 'DB' | 'ARTIFACTS'>)
    ).resolves.toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('never throws even if both bindings are absent', async () => {
    await expect(
      reclaimStaleArtifactsScheduled({} as unknown as Pick<Env, 'DB' | 'ARTIFACTS'>)
    ).resolves.toBeUndefined();
  });
});

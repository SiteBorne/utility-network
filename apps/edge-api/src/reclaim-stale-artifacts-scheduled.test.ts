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

  describe('storage-alert Service Binding wiring', () => {
    // A correctly-shaped, zero-row D1 response (`success: true` is required
    // by `getD1Failure`/`toRepositoryResponse` in
    // `repositories/d1/shared.ts`) so `reclaimStaleArtifacts` resolves with
    // `r2_delete_failures: 0` instead of throwing on a malformed fake. With
    // zero failures, `runStorageAlertSweep`'s own `shouldAlert` never fires
    // regardless of binding/token presence -- these tests therefore prove
    // the wiring accepts the new `Env` shape (present or absent) and never
    // throws or dispatches spuriously, matching this file's existing
    // convention of testing wiring/gating rather than the full R2/D1
    // success path (covered separately by `artifact-reclamation.test.ts`
    // and `storage-alert-sweep.test.ts`).
    function envWithNoReclaimableArtifacts(
      overrides: Partial<Env>
    ): Pick<Env, 'DB' | 'ARTIFACTS' | 'STORAGE_ALERT_RECEIVER' | 'STORAGE_ALERT_PATH_TOKEN'> {
      return {
        DB: {
          prepare: () => ({ bind: () => ({ all: async () => ({ success: true, results: [] }) }) }),
        } as unknown as Env['DB'],
        ARTIFACTS: {} as Env['ARTIFACTS'],
        ...overrides,
      } as unknown as Pick<
        Env,
        'DB' | 'ARTIFACTS' | 'STORAGE_ALERT_RECEIVER' | 'STORAGE_ALERT_PATH_TOKEN'
      >;
    }

    it('accepts STORAGE_ALERT_RECEIVER absent and never dispatches when there is nothing to alert on', async () => {
      const fetchSpy = vi.fn();
      await expect(
        reclaimStaleArtifactsScheduled(
          envWithNoReclaimableArtifacts({
            STORAGE_ALERT_RECEIVER: undefined,
            STORAGE_ALERT_PATH_TOKEN: 'tok',
          })
        )
      ).resolves.toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('accepts STORAGE_ALERT_PATH_TOKEN absent and never dispatches when there is nothing to alert on', async () => {
      const fetchSpy = vi.fn();
      await expect(
        reclaimStaleArtifactsScheduled(
          envWithNoReclaimableArtifacts({
            STORAGE_ALERT_RECEIVER: { fetch: fetchSpy } as unknown as Env['STORAGE_ALERT_RECEIVER'],
            STORAGE_ALERT_PATH_TOKEN: undefined,
          })
        )
      ).resolves.toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('never dispatches when both the Service Binding and token are present but nothing needs alerting', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
      await expect(
        reclaimStaleArtifactsScheduled(
          envWithNoReclaimableArtifacts({
            STORAGE_ALERT_RECEIVER: { fetch: fetchSpy } as unknown as Env['STORAGE_ALERT_RECEIVER'],
            STORAGE_ALERT_PATH_TOKEN: 'tok',
          })
        )
      ).resolves.toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});

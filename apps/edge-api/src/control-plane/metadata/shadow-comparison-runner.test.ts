/**
 * METADATA-VCM-IMPL-04A §XIII/§XXI: the one place both A2A and MCP wiring
 * call into VCM for `shadow_compare`. Its return value is never usable to
 * serve anything -- it returns `void` -- and it must swallow every failure
 * mode (missing input, a throwing shadow-builder, a throwing telemetry
 * sink) without ever propagating to the caller. Reuses IMPL-03B's proven
 * `compareProjections`/`summarizeDifferences` -- no independently-authored
 * normalization logic here.
 */
import { describe, expect, it, vi } from 'vitest';
import { runShadowComparison } from './shadow-comparison-runner';
import * as telemetry from '../telemetry/metadata-projection-telemetry';

describe('runShadowComparison', () => {
  it('returns void even on a perfect match', async () => {
    const spy = vi.spyOn(telemetry, 'recordMetadataProjectionComparison');
    const result = await runShadowComparison({
      surface: 'a2a',
      existing: { a: 1 },
      buildShadow: () => ({ a: 1 }),
    });
    expect(result).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'a2a', fellBackToLegacy: false })
    );
    spy.mockRestore();
  });

  it('records fellBackToLegacy=true on a real mismatch, but returns void (never the shadow value)', async () => {
    const spy = vi.spyOn(telemetry, 'recordMetadataProjectionComparison');
    const result = await runShadowComparison({
      surface: 'mcp',
      existing: { a: 1 },
      buildShadow: () => ({ a: 2 }),
    });
    expect(result).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'mcp', fellBackToLegacy: true })
    );
    spy.mockRestore();
  });

  it('a synchronous throw inside buildShadow never propagates', async () => {
    await expect(
      runShadowComparison({
        surface: 'a2a',
        existing: { a: 1 },
        buildShadow: () => {
          throw new Error('vcm projection exploded');
        },
      })
    ).resolves.toBeUndefined();
  });

  it('an async rejection inside buildShadow never propagates', async () => {
    await expect(
      runShadowComparison({
        surface: 'mcp',
        existing: { a: 1 },
        buildShadow: async () => {
          throw new Error('vcm projection exploded asynchronously');
        },
      })
    ).resolves.toBeUndefined();
  });

  it('a throwing telemetry sink never propagates', async () => {
    const spy = vi.spyOn(telemetry, 'recordMetadataProjectionComparison').mockImplementation(() => {
      throw new Error('telemetry backend unavailable');
    });
    await expect(
      runShadowComparison({ surface: 'a2a', existing: { a: 1 }, buildShadow: () => ({ a: 1 }) })
    ).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it('applies caller-supplied governed-difference rules (e.g. A2A pre-signature signatures[])', async () => {
    const spy = vi.spyOn(telemetry, 'recordMetadataProjectionComparison');
    await runShadowComparison({
      surface: 'a2a',
      existing: { signatures: [] },
      buildShadow: () => ({ signatures: [] }),
      governedDifferences: [
        {
          pathPattern: /^signatures/,
          classification: 'INTENTIONAL_GOVERNED_DIFFERENCE',
          reason: 'test',
        },
      ],
    });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ fellBackToLegacy: false }));
    spy.mockRestore();
  });
});

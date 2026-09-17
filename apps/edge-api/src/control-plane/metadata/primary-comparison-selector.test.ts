import { describe, expect, it, vi } from 'vitest';
import * as vcm from '@siteborne/vcm';
import * as telemetry from '../telemetry/metadata-projection-telemetry';
import { selectPrimaryProjection } from './primary-comparison-selector';

describe('selectPrimaryProjection', () => {
  it('selects the complete VCM object on validated semantic match', async () => {
    const legacy = { producer: 'same', nested: { value: 1 } };
    const primary = { producer: 'same', nested: { value: 1 } };
    const result = await selectPrimaryProjection({
      surface: 'a2a',
      buildLegacy: () => legacy,
      buildPrimary: () => primary,
      validatePrimary: () => undefined,
    });

    expect(result.selectedProducer).toBe('vcm');
    expect(result.selected).toBe(primary);
    expect(result.legacy).toBe(legacy);
  });

  it('selects the complete legacy object on semantic mismatch', async () => {
    const legacy = { producer: 'legacy', untouched: 'legacy-only' };
    const primary = { producer: 'vcm', untouched: 'vcm-only' };
    const result = await selectPrimaryProjection({
      surface: 'mcp',
      buildLegacy: () => legacy,
      buildPrimary: () => primary,
      validatePrimary: () => undefined,
    });

    expect(result.selectedProducer).toBe('legacy');
    expect(result.selected).toBe(legacy);
    expect(result.reason).toBe('semantic_mismatch');
  });

  it('selects legacy when the primary projector throws', async () => {
    const legacy = { producer: 'legacy' };
    const result = await selectPrimaryProjection({
      surface: 'a2a',
      buildLegacy: () => legacy,
      buildPrimary: () => {
        throw new Error('projector unavailable');
      },
      validatePrimary: () => undefined,
    });

    expect(result.selected).toBe(legacy);
    expect(result.reason).toBe('primary_projection_failure');
  });

  it('selects legacy when primary validation throws', async () => {
    const legacy = { producer: 'legacy' };
    const primary = { producer: 'vcm' };
    const result = await selectPrimaryProjection({
      surface: 'mcp',
      buildLegacy: () => legacy,
      buildPrimary: () => primary,
      validatePrimary: () => {
        throw new Error('invalid primary');
      },
    });

    expect(result.selected).toBe(legacy);
    expect(result.primary).toBe(primary);
    expect(result.reason).toBe('primary_validation_failure');
  });

  it('fails closed when the legacy builder throws before a usable reference exists', async () => {
    const buildPrimary = vi.fn(() => ({ producer: 'vcm' }));
    await expect(
      selectPrimaryProjection({
        surface: 'a2a',
        buildLegacy: () => {
          throw new Error('legacy unavailable');
        },
        buildPrimary,
        validatePrimary: () => undefined,
      })
    ).rejects.toThrow('legacy unavailable');
    expect(buildPrimary).not.toHaveBeenCalled();
  });

  it('fails closed when both producer closures throw', async () => {
    const buildPrimary = vi.fn(() => {
      throw new Error('primary unavailable');
    });
    await expect(
      selectPrimaryProjection({
        surface: 'mcp',
        buildLegacy: () => {
          throw new Error('legacy unavailable');
        },
        buildPrimary,
        validatePrimary: () => undefined,
      })
    ).rejects.toThrow('legacy unavailable');
    expect(buildPrimary).not.toHaveBeenCalled();
  });

  it('selects legacy when the shared comparator throws', async () => {
    const legacy = { producer: 'legacy' };
    const primary = { producer: 'legacy' };
    const spy = vi.spyOn(vcm, 'compareProjections').mockImplementation(() => {
      throw new Error('comparison unavailable');
    });

    const result = await selectPrimaryProjection({
      surface: 'a2a',
      buildLegacy: () => legacy,
      buildPrimary: () => primary,
      validatePrimary: () => undefined,
    });

    expect(result.selected).toBe(legacy);
    expect(result.reason).toBe('comparison_failure');
    spy.mockRestore();
  });

  it('does not mix fields from the two producer objects', async () => {
    const legacy = { shared: 'legacy', legacyOnly: true };
    const primary = { shared: 'vcm', primaryOnly: true };
    const result = await selectPrimaryProjection<{
      shared: string;
      legacyOnly?: boolean;
      primaryOnly?: boolean;
    }>({
      surface: 'mcp',
      buildLegacy: () => legacy,
      buildPrimary: () => primary,
      validatePrimary: () => undefined,
    });

    expect(result.selected).toBe(legacy);
    expect(result.selected).toEqual({ shared: 'legacy', legacyOnly: true });
    expect(result.selected).not.toHaveProperty('primaryOnly');
  });

  it('keeps the safe selection when lifecycle telemetry throws', async () => {
    const legacy = { value: 1 };
    const primary = { value: 1 };
    const spy = vi.spyOn(telemetry, 'recordMetadataProjectionLifecycle').mockImplementation(() => {
      throw new Error('telemetry unavailable');
    });

    const result = await selectPrimaryProjection({
      surface: 'a2a',
      buildLegacy: () => legacy,
      buildPrimary: () => primary,
      validatePrimary: () => undefined,
    });

    expect(result.selected).toBe(primary);
    spy.mockRestore();
  });
});

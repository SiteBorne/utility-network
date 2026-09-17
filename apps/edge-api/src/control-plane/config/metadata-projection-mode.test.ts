/**
 * METADATA-VCM-IMPL-04A §VII/§XIV: one strict allow-list parser shared by
 * both A2A and MCP call sites. Absent or malformed config must fail toward
 * `legacy` -- never toward any VCM-serving state -- and `vcm_primary_compare`/
 * `vcm_only` must be recognized as valid enum members (closed 4-value type)
 * but structurally refused as *servable* in this checkpoint.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  METADATA_PROJECTION_MODES,
  parseMetadataProjectionMode,
  resolveAuthorizedMetadataProjectionMode,
} from './metadata-projection-mode';

describe('parseMetadataProjectionMode', () => {
  it('absent config parses safely to legacy', () => {
    expect(parseMetadataProjectionMode(undefined, 'a2a')).toBe('legacy');
  });

  it('empty string parses safely to legacy', () => {
    expect(parseMetadataProjectionMode('', 'a2a')).toBe('legacy');
  });

  it('an unrecognized value parses safely to legacy and logs once', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(parseMetadataProjectionMode('VCM_ONLY', 'mcp')).toBe('legacy');
    expect(spy).toHaveBeenCalledTimes(1);
    const [line] = spy.mock.calls[0] as [string];
    expect(line).toContain('mcp');
    expect(line).toContain('VCM_ONLY');
    spy.mockRestore();
  });

  it('a boolean-shaped typo ("true") parses safely to legacy', () => {
    expect(parseMetadataProjectionMode('true', 'a2a')).toBe('legacy');
  });

  it('recognizes each of the four exact literals', () => {
    for (const mode of METADATA_PROJECTION_MODES) {
      expect(parseMetadataProjectionMode(mode, 'a2a')).toBe(mode);
    }
  });

  it('is case-sensitive (no implicit normalization)', () => {
    expect(parseMetadataProjectionMode('Shadow_Compare', 'a2a')).toBe('legacy');
  });
});

describe('resolveAuthorizedMetadataProjectionMode', () => {
  it.each(['a2a', 'mcp'] as const)('authorizes legacy independently for %s', (surface) => {
    expect(resolveAuthorizedMetadataProjectionMode('legacy', surface)).toBe('legacy');
  });

  it.each(['a2a', 'mcp'] as const)('authorizes shadow_compare independently for %s', (surface) => {
    expect(resolveAuthorizedMetadataProjectionMode('shadow_compare', surface)).toBe(
      'shadow_compare'
    );
  });

  it.each(['a2a', 'mcp'] as const)(
    'authorizes vcm_primary_compare independently for %s',
    (surface) => {
      expect(resolveAuthorizedMetadataProjectionMode('vcm_primary_compare', surface)).toBe(
        'vcm_primary_compare'
      );
    }
  );

  it.each(['a2a', 'mcp'] as const)('refuses vcm_only independently for %s', (surface) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(resolveAuthorizedMetadataProjectionMode('vcm_only', surface)).toBe('legacy');
    expect(spy).toHaveBeenCalledTimes(1);
    const [line] = spy.mock.calls[0] as [string];
    expect(line).toContain(surface);
    expect(line).toContain('vcm_only');
    spy.mockRestore();
  });

  it('end-to-end: a raw "vcm_only" env value never reaches a servable mode', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const parsed = parseMetadataProjectionMode('vcm_only', 'a2a');
    const authorized = resolveAuthorizedMetadataProjectionMode(parsed, 'a2a');
    expect(authorized).toBe('legacy');
    spy.mockRestore();
  });

  it.each(['a2a', 'mcp'] as const)(
    'keeps an invalid raw value safely resolved to legacy for %s',
    (surface) => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const parsed = parseMetadataProjectionMode('not-a-mode', surface);
      expect(resolveAuthorizedMetadataProjectionMode(parsed, surface)).toBe('legacy');
      spy.mockRestore();
    }
  );

  it.each(['a2a', 'mcp'] as const)(
    'keeps a missing raw value safely resolved to legacy for %s',
    (surface) => {
      const parsed = parseMetadataProjectionMode(undefined, surface);
      expect(resolveAuthorizedMetadataProjectionMode(parsed, surface)).toBe('legacy');
    }
  );
});
